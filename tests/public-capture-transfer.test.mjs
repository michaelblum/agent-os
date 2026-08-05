import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '..')
const transferSource = path.join(
  root,
  'src/daemon/public-capture-transfer.swift',
)
const brokerSource = path.join(root, 'src/daemon/desktop-pixel-broker.swift')
const displayGeometrySource = path.join(
  root,
  'src/shared/desktop-world-display-geometry.swift',
)
const displayTopologySource = path.join(
  root,
  'src/perceive/display-topology.swift',
)
const controllerSource = path.join(
  root,
  'src/daemon/public-capture-controller.swift',
)
const controllerTestsSource = path.join(
  root,
  'tests/lib/public-capture-controller-tests.swift',
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

test('public capture foreground wire decoder rejects non-canonical numbers and shapes', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'aos-public-capture-wire-'))
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

func rejected(_ body: () throws -> Void, _ message: String) {
    do {
        try body()
        require(false, message)
    } catch {}
}

let captureID = "11111111-1111-4111-8111-111111111111"
let topologyIdentity = "sha256:" + String(repeating: "a", count: 64)
let digest = String(repeating: "b", count: 64)
let byte = Data([0x89]).base64EncodedString()

func chunkMessage() -> [String: Any] {
    [
        "v": 1,
        "service": "see",
        "event": "capture_chunk",
        "ts": 1.25,
        "ref": captureID,
        "data": [
            "capture_id": captureID,
            "topology_identity": topologyIdentity,
            "display_id": 42,
            "frame_index": 0,
            "chunk_index": 0,
            "chunk_count": 1,
            "byte_count": 1,
            "sha256": digest,
            "bytes_base64": byte,
        ],
    ]
}

func frameMetadata() -> [String: Any] {
    [
        "display_id": 42,
        "frame_index": 0,
        "chunk_count": 1,
        "byte_count": 1,
        "sha256": digest,
        "width": 1,
        "height": 1,
        "capture_source": "display",
        "window_fallback": false,
    ]
}

if case .chunk(let chunk) = try aosDecodePublicCaptureForegroundMessage(
    chunkMessage(),
    captureID: captureID,
    topologyIdentity: topologyIdentity,
    maximumByteCount: 64
) {
    require(chunk.displayID == 42 && chunk.chunk == Data([0x89]), "valid chunk changed")
} else {
    require(false, "valid chunk did not decode")
}
_ = try aosDecodePublicCaptureFrameWireValue(frameMetadata())

require(aosExactJSONInteger(true) == nil, "boolean repaired to an integer")
require(aosExactJSONInteger(-1, minimum: 0) == nil, "negative integer crossed a bound")
require(aosExactJSONInteger(NSNumber(value: 42.0)) == nil, "floating token 42.0 was repaired")
require(
    aosExactJSONInteger(NSNumber(value: Int64(9_007_199_254_740_993))) == nil,
    "lossy JSON integer crossed the safe-integer bound"
)
require(
    aosExactJSONInteger(NSNumber(value: UInt64.max)) == nil,
    "overflowing unsigned integer wrapped"
)

var topExtra = chunkMessage()
topExtra["extra"] = true
rejected({ _ = try aosDecodePublicCaptureForegroundMessage(
    topExtra, captureID: captureID, topologyIdentity: topologyIdentity,
    maximumByteCount: 64
) }, "extra top-level key passed")
var topMissing = chunkMessage()
topMissing.removeValue(forKey: "ref")
rejected({ _ = try aosDecodePublicCaptureForegroundMessage(
    topMissing, captureID: captureID, topologyIdentity: topologyIdentity,
    maximumByteCount: 64
) }, "missing top-level key passed")

for (name, value) in [
    ("boolean", true as Any),
    ("negative", -1 as Any),
    ("floating", NSNumber(value: 42.0) as Any),
    ("lossy", NSNumber(value: Int64(9_007_199_254_740_993)) as Any),
    ("uint32_overflow", NSNumber(value: UInt64(UInt32.max) + 1) as Any),
] {
    var message = chunkMessage()
    var data = message["data"] as! [String: Any]
    data["display_id"] = value
    message["data"] = data
    rejected({ _ = try aosDecodePublicCaptureForegroundMessage(
        message, captureID: captureID, topologyIdentity: topologyIdentity,
        maximumByteCount: 64
    ) }, "\(name) chunk display id passed")
}

var chunkExtra = chunkMessage()
var chunkExtraData = chunkExtra["data"] as! [String: Any]
chunkExtraData["path"] = "/private/frame.png"
chunkExtra["data"] = chunkExtraData
rejected({ _ = try aosDecodePublicCaptureForegroundMessage(
    chunkExtra, captureID: captureID, topologyIdentity: topologyIdentity,
    maximumByteCount: 64
) }, "extra chunk key passed")
var chunkMissing = chunkMessage()
var chunkMissingData = chunkMissing["data"] as! [String: Any]
chunkMissingData.removeValue(forKey: "bytes_base64")
chunkMissing["data"] = chunkMissingData
rejected({ _ = try aosDecodePublicCaptureForegroundMessage(
    chunkMissing, captureID: captureID, topologyIdentity: topologyIdentity,
    maximumByteCount: 64
) }, "missing chunk key passed")
var overBudget = chunkMessage()
var overBudgetData = overBudget["data"] as! [String: Any]
overBudgetData["byte_count"] = 65
overBudget["data"] = overBudgetData
rejected({ _ = try aosDecodePublicCaptureForegroundMessage(
    overBudget, captureID: captureID, topologyIdentity: topologyIdentity,
    maximumByteCount: 64
) }, "chunk byte budget failed open")

let final: [String: Any] = [
    "v": 1,
    "status": "success",
    "ref": captureID,
    "data": [
        "capture_id": captureID,
        "topology_identity": topologyIdentity,
        "frames": [frameMetadata()],
    ],
]
if case .success(let frames) = try aosDecodePublicCaptureForegroundMessage(
    final, captureID: captureID, topologyIdentity: topologyIdentity,
    maximumByteCount: 64
) {
    require(frames.count == 1, "valid final frame list changed")
} else {
    require(false, "valid final response did not decode")
}

var finalExtra = final
finalExtra["service"] = "see"
rejected({ _ = try aosDecodePublicCaptureForegroundMessage(
    finalExtra, captureID: captureID, topologyIdentity: topologyIdentity,
    maximumByteCount: 64
) }, "extra final envelope key passed")
var finalMissing = final
var finalMissingData = finalMissing["data"] as! [String: Any]
finalMissingData.removeValue(forKey: "frames")
finalMissing["data"] = finalMissingData
rejected({ _ = try aosDecodePublicCaptureForegroundMessage(
    finalMissing, captureID: captureID, topologyIdentity: topologyIdentity,
    maximumByteCount: 64
) }, "missing final response key passed")

for (name, value) in [
    ("boolean", true as Any),
    ("negative", -1 as Any),
    ("floating", NSNumber(value: 42.0) as Any),
    ("lossy", NSNumber(value: Int64(9_007_199_254_740_993)) as Any),
    ("overflow", NSNumber(value: UInt64(UInt32.max) + 1) as Any),
] {
    var metadata = frameMetadata()
    metadata["display_id"] = value
    rejected({ _ = try aosDecodePublicCaptureFrameWireValue(metadata) },
             "\(name) final display id passed")
}
var metadataExtra = frameMetadata()
metadataExtra["extra"] = true
rejected({ _ = try aosDecodePublicCaptureFrameWireValue(metadataExtra) },
         "extra final metadata key passed")
var metadataMissing = frameMetadata()
metadataMissing.removeValue(forKey: "width")
rejected({ _ = try aosDecodePublicCaptureFrameWireValue(metadataMissing) },
         "missing final metadata key passed")
var windowOverflow = frameMetadata()
windowOverflow["capture_source"] = "window"
windowOverflow["window_id"] = NSNumber(value: UInt64(UInt32.max) + 1)
rejected({ _ = try aosDecodePublicCaptureFrameWireValue(windowOverflow) },
         "overflowing final window id passed")

print("PASS")
`)
    const compile = spawnSync(
      'xcrun',
      ['swiftc', transferSource, main, '-o', executable],
      { cwd: root, encoding: 'utf8' },
    )
    assert.equal(compile.status, 0, compile.stderr || compile.stdout)
    const run = spawnSync(executable, [], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
    })
    assert.equal(run.status, 0, run.stderr || run.stdout)
    assert.match(run.stdout, /PASS/u)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('public capture runtime decoder validates canonical topology before capture', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'aos-public-capture-decoder-'))
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

final class AOSNativeDesktopPixelAcquirer:
    AOSDesktopPixelAcquiring,
    AOSDesktopPixelWarmAcquiring
{
    func snapshot(
        _ request: AOSDesktopPixelSnapshotRequest,
        completion: @escaping (Result<AOSDesktopPixelFrameSet, Error>) -> Void
    ) -> AOSDesktopFrameCancelling {
        AOSDesktopFrameCancellation()
    }

    func openWarm(
        _ request: AOSDesktopPixelSnapshotRequest,
        completion: @escaping (Result<AOSDesktopPixelWarmSource, Error>) -> Void
    ) -> AOSDesktopFrameCancelling {
        AOSDesktopFrameCancellation()
    }
}

try runPublicCaptureControllerTests()
print("PASS")
`)
    const compile = spawnSync(
      'xcrun',
      [
        'swiftc',
        displayGeometrySource,
        brokerSource,
        displayTopologySource,
        transferSource,
        controllerSource,
        controllerTestsSource,
        main,
        '-o',
        executable,
      ],
      { cwd: root, encoding: 'utf8' },
    )
    assert.equal(compile.status, 0, compile.stderr || compile.stdout)
    const run = spawnSync(executable, [], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
    })
    assert.equal(run.status, 0, run.stderr || run.stdout)
    assert.match(run.stdout, /PASS/u)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('public capture foreground deadline and error projection are closed', async () => {
  const [pipeline, pool] = await Promise.all([
    readFile(path.join(root, 'src/perceive/capture-pipeline.swift'), 'utf8'),
    readFile(path.join(root, 'src/daemon/desktop-frame-warm-pool.swift'), 'utf8'),
  ])
  const publicRoute = pipeline.slice(
    pipeline.indexOf('private func aosPublicCaptureErrorCode'),
    pipeline.indexOf('// MARK: - Argument Parsing'),
  )
  assert.match(pool, /aosPublicCaptureDaemonTransactionBudget: TimeInterval = 24/u)
  assert.match(pipeline, /aosPublicCaptureForegroundBudgetMilliseconds\s*=\s*\n\s*Int\(aosPublicCaptureDaemonTransactionBudget \* 1_000\) \+ 1_000/u)
  assert.match(publicRoute, /DispatchTime\.now\(\)\.uptimeNanoseconds/u)
  assert.match(publicRoute, /case "DESKTOP_FRAME_BUSY":[\s\S]*return "CAPTURE_BUSY"/u)
  assert.match(publicRoute, /case "DESKTOP_FRAME_PERMISSION_DENIED":[\s\S]*return "PERMISSION_DENIED"/u)
  assert.match(publicRoute, /"DESKTOP_FRAME_TOPOLOGY_MISMATCH":[\s\S]*return "CAPTURE_TOPOLOGY_MISMATCH"/u)
  assert.match(publicRoute, /default:\s*\n\s*return "CAPTURE_FAILED"/u)
  assert.equal((publicRoute.match(/code: "DAEMON_UNREACHABLE"/gu) ?? []).length, 1)
  assert.equal((publicRoute.match(/readOneJSON\(/gu) ?? []).length, 1)
})
