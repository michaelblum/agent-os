import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '..')
const transferSource = path.join(
  root,
  'src/daemon/public-capture-transfer.swift',
)

test('public capture transfer streams and verifies a frame above 32 MiB', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'aos-public-capture-'))
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

let byteCount = 33 * 1024 * 1024 + 17
var original = Data(count: byteCount)
original.withUnsafeMutableBytes { raw in
    guard let base = raw.baseAddress else { return }
    let bytes = base.assumingMemoryBound(to: UInt8.self)
    for index in 0..<byteCount {
        bytes[index] = UInt8(truncatingIfNeeded: index &* 31 &+ 17)
    }
}

var reconstructed = Data()
var expectedChunkIndex = 0
let descriptor = try aosStreamPublicCaptureData(
    original,
    captureID: "11111111-1111-4111-8111-111111111111",
    topologyIdentity: "sha256:" + String(repeating: "a", count: 64),
    displayID: 42,
    frameIndex: 0,
    emitChunk: { event in
        require(event["chunk_index"] as? Int == expectedChunkIndex, "chunk order drifted")
        require(event["frame_index"] as? Int == 0, "frame order drifted")
        require((event["display_id"] as? NSNumber)?.uint32Value == 42, "display identity drifted")
        guard let encoded = event["bytes_base64"] as? String,
              let chunk = Data(base64Encoded: encoded) else {
            return false
        }
        require(chunk.count <= aosPublicCaptureChunkBytes, "chunk exceeded its bound")
        reconstructed.append(chunk)
        expectedChunkIndex += 1
        return true
    }
)
require(byteCount > 32 * 1024 * 1024, "fixture did not cross the socket budget")
require(descriptor.byteCount == byteCount, "byte count drifted")
require(descriptor.chunkCount == expectedChunkIndex, "chunk count drifted")
require(descriptor.sha256 == aosPublicCaptureSHA256(original), "producer digest drifted")
require(reconstructed == original, "reassembly changed bytes")
require(aosPublicCaptureSHA256(reconstructed) == descriptor.sha256, "consumer digest drifted")

var canceledChunks = 0
do {
    _ = try aosStreamPublicCaptureData(
        original,
        captureID: "22222222-2222-4222-8222-222222222222",
        topologyIdentity: "sha256:" + String(repeating: "b", count: 64),
        displayID: 7,
        frameIndex: 1,
        emitChunk: { _ in
            canceledChunks += 1
            return canceledChunks < 2
        }
    )
    require(false, "consumer disconnect failed open")
} catch AOSPublicCaptureTransferError.canceled {
    require(canceledChunks == 2, "consumer disconnect emitted extra chunks")
}
`)
    const compile = spawnSync(
      'xcrun',
      ['swiftc', '-O', transferSource, main, '-o', executable],
      { cwd: root, encoding: 'utf8' },
    )
    assert.equal(compile.status, 0, compile.stderr || compile.stdout)
    const run = spawnSync(executable, [], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
    })
    assert.equal(run.status, 0, run.stderr || run.stdout)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})
