import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '..')
const sources = [
  'shared/swift/ipc/runtime-paths.swift',
  'shared/swift/ipc/connection.swift',
  'shared/swift/ipc/ndjson.swift',
  'shared/swift/ipc/request-client.swift',
].map((source) => path.join(root, source))

test('production daemon session enforces one deadline and bounded NDJSON frames', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'aos-daemon-reader-'))
  try {
    const main = path.join(temp, 'main.swift')
    const executable = path.join(temp, 'proof')
    await writeFile(main, String.raw`
import Foundation

func require(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        fputs(message + "\n", stderr)
        exit(1)
    }
}

func makePair() -> (Int32, Int32) {
    var descriptors: [Int32] = [-1, -1]
    require(socketpair(AF_UNIX, SOCK_STREAM, 0, &descriptors) == 0, "socketpair failed")
    _ = disableSigPipe(descriptors[0])
    _ = disableSigPipe(descriptors[1])
    return (descriptors[0], descriptors[1])
}

do {
    let (client, peer) = makePair()
    defer { close(peer) }
    let session = DaemonSession(socketPath: "/unused", maximumFrameBytes: 64)
    session.fd = client
    defer { session.disconnect() }
    let first = Array("{\"v\":1,\"status\":\"success\",".utf8)
    let second = Array("\"data\":{}}".utf8) + [UInt8(ascii: "\n")]
    _ = first.withUnsafeBytes { write(peer, $0.baseAddress, $0.count) }
    _ = second.withUnsafeBytes { write(peer, $0.baseAddress, $0.count) }
    let decoded = session.readOneJSON(timeoutMs: 100)
    require(decoded?["status"] as? String == "success", "fragmented valid frame failed")
}

do {
    let (client, peer) = makePair()
    let session = DaemonSession(socketPath: "/unused", maximumFrameBytes: 64)
    session.fd = client
    let writer = DispatchGroup()
    writer.enter()
    DispatchQueue.global(qos: .utility).async {
        defer {
            close(peer)
            writer.leave()
        }
        var byte = UInt8(ascii: "x")
        for _ in 0..<100 {
            if write(peer, &byte, 1) != 1 { return }
            usleep(10_000)
        }
    }
    let started = DispatchTime.now().uptimeNanoseconds
    let decoded = session.readOneJSON(timeoutMs: 120)
    let elapsed = DispatchTime.now().uptimeNanoseconds - started
    session.disconnect()
    require(decoded == nil, "byte-drip frame unexpectedly decoded")
    require(elapsed >= 80_000_000, "reader returned before exercising its budget")
    require(elapsed < 400_000_000, "byte drip extended the absolute deadline")
    require(writer.wait(timeout: .now() + 2) == .success, "drip writer did not stop")
}

do {
    let (client, peer) = makePair()
    defer { close(peer) }
    let session = DaemonSession(socketPath: "/unused", maximumFrameBytes: 64)
    session.fd = client
    defer { session.disconnect() }
    let oversized = [UInt8](repeating: UInt8(ascii: "z"), count: 65)
    _ = oversized.withUnsafeBytes { write(peer, $0.baseAddress, $0.count) }
    require(session.readOneJSON(timeoutMs: 100) == nil, "oversized frame failed open")

    var reader = NDJSONReader(maximumFrameBytes: 64)
    require(!reader.append(oversized, count: oversized.count), "frame cap accepted overflow")
    require(reader.bufferedByteCount == 0, "rejected overflow consumed buffer memory")
}

print("PASS")
`)
    const compile = spawnSync(
      'xcrun',
      ['swiftc', ...sources, main, '-o', executable],
      { cwd: root, encoding: 'utf8' },
    )
    assert.equal(compile.status, 0, compile.stderr || compile.stdout)
    const run = spawnSync(executable, [], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10_000,
    })
    assert.equal(run.status, 0, run.stderr || run.stdout)
    assert.match(run.stdout, /PASS/u)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})
