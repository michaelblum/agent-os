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
const eventStreamSource = path.join(root, 'shared/swift/ipc/event-stream.swift')

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

test('production event stream reconnects after an oversized unterminated frame', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'aos-event-stream-reader-'))
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

func readLine(_ fd: Int32) -> Bool {
    var byte: UInt8 = 0
    while read(fd, &byte, 1) == 1 {
        if byte == UInt8(ascii: "\n") { return true }
    }
    return false
}

@discardableResult
func writeAll(_ fd: Int32, _ bytes: [UInt8]) -> Bool {
    var offset = 0
    while offset < bytes.count {
        let written = bytes.withUnsafeBytes { raw -> Int in
            guard let base = raw.baseAddress else { return -1 }
            return write(fd, base.advanced(by: offset), bytes.count - offset)
        }
        guard written > 0 else { return false }
        offset += written
    }
    return true
}

final class QueuedConnector {
    private var descriptors: [Int32]
    private let lock = NSLock()
    private var storedCalls = 0

    init(_ descriptors: [Int32]) {
        self.descriptors = descriptors
    }

    func connect(_ path: String, _ timeout: Int32) -> Int32 {
        lock.lock()
        defer { lock.unlock() }
        storedCalls += 1
        return descriptors.isEmpty ? -1 : descriptors.removeFirst()
    }

    var calls: Int {
        lock.lock()
        defer { lock.unlock() }
        return storedCalls
    }
}

let first = makePair()
let second = makePair()
let connector = QueuedConnector([first.0, second.0])
let server = DispatchGroup()
let response = Array("{\"v\":1,\"status\":\"success\",\"data\":{}}\n".utf8)
let firstPeerRelease = DispatchSemaphore(value: 0)

server.enter()
DispatchQueue.global(qos: .userInitiated).async {
    defer {
        close(first.1)
        server.leave()
    }
    require(readLine(first.1), "first subscription was not received")
    require(writeAll(first.1, response), "first subscription response failed")
    usleep(20_000)
    require(
        writeAll(first.1, [UInt8](repeating: UInt8(ascii: "x"), count: 65)),
        "oversized unterminated event frame was not delivered"
    )
    require(
        firstPeerRelease.wait(timeout: .now() + 15) == .success,
        "first event peer was not released"
    )
}

server.enter()
DispatchQueue.global(qos: .userInitiated).async {
    defer {
        close(second.1)
        server.leave()
    }
    require(readLine(second.1), "reconnect subscription was not received")
    require(writeAll(second.1, response), "reconnect subscription response failed")
}

let reconnected = DispatchSemaphore(value: 0)
var stream: DaemonEventStream!
stream = DaemonEventStream(
    socketPath: "/unused",
    initialBackoffSec: 0,
    maxBackoffSec: 0,
    connectTimeoutMs: 1,
    maximumFrameBytes: 64,
    connector: { connector.connect($0, $1) }
)
stream.onReconnect = {
    stream.stop()
    reconnected.signal()
}
stream.start()
require(
    reconnected.wait(timeout: .now() + 10) == .success,
    "oversized event frame wedged the production read loop"
)
require(connector.calls >= 2, "oversized event frame did not reach reconnect")
firstPeerRelease.signal()
require(server.wait(timeout: .now() + 5) == .success, "event stream peers did not settle")
print("PASS")
`)
    const compile = spawnSync(
      'xcrun',
      ['swiftc', ...sources, eventStreamSource, main, '-o', executable],
      { cwd: root, encoding: 'utf8' },
    )
    assert.equal(compile.status, 0, compile.stderr || compile.stdout)
    const run = spawnSync(executable, [], {
      cwd: root,
      encoding: 'utf8',
      timeout: 20_000,
    })
    assert.equal(run.status, 0, run.stderr || run.stdout)
    assert.match(run.stdout, /PASS/u)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})
