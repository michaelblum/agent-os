import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '..')

const supportSource = String.raw`
import CoreGraphics
import Foundation

enum AOSOperationCoreError: Error, Equatable, CustomStringConvertible {
    case invalidRecord(String)
    case recordingBoundsExceeded
    case recordingTargetDrift

    var description: String {
        switch self {
        case .invalidRecord(let value): return "OPERATION_RECORD_INVALID:\(value)"
        case .recordingBoundsExceeded: return "SCREEN_RECORDING_BOUNDS_EXCEEDED"
        case .recordingTargetDrift: return "SCREEN_RECORDING_TARGET_DRIFT"
        }
    }
}

struct AOSOperationIdentity: Codable, Equatable {
    let id: String
    let generation: UInt64
}

struct AOSOperationRequestedBounds: Codable, Equatable {
    let durationMilliseconds: UInt64
    let frameRate: UInt64
    let pixelCount: UInt64
    let queueFrames: UInt64
    let maximumOutputBytes: UInt64
}

struct AOSOperationProgress: Codable, Equatable {
    var frameCount: UInt64
    var byteCount: UInt64
    var elapsedMilliseconds: UInt64
    var droppedFrameCount: UInt64
}

enum AOSOperationDigest {
    static func canonicalData<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(value)
    }
}

struct AOSDisplayTopologyBounds: Codable, Equatable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct AOSDisplayTopologyPoint: Codable, Equatable {
    let x: Double
    let y: Double
}

enum AOSDisplayTopologyMemberIdentity: Codable, Equatable {
    case displayIDFallback(UInt32)
}

struct AOSDisplayTopologyDisplay: Codable, Equatable {
    let runtimeDisplayID: UInt32
    let ordinal: Int
    let isMain: Bool
    let memberIdentity: AOSDisplayTopologyMemberIdentity
    let nativeBounds: AOSDisplayTopologyBounds
    let nativeVisibleBounds: AOSDisplayTopologyBounds
    let desktopWorldBounds: AOSDisplayTopologyBounds
    let visibleDesktopWorldBounds: AOSDisplayTopologyBounds
    let scaleFactor: Double
    let rotation: Double
}

struct AOSDisplayTopologySnapshot: Codable, Equatable {
    let identity: String
    let usesDisplayIDFallback: Bool
    let screensHaveSeparateSpaces: Bool
    let desktopWorldOriginNative: AOSDisplayTopologyPoint
    let nativeBounds: AOSDisplayTopologyBounds
    let nativeVisibleBounds: AOSDisplayTopologyBounds
    let desktopWorldBounds: AOSDisplayTopologyBounds
    let visibleDesktopWorldBounds: AOSDisplayTopologyBounds
    let displays: [AOSDisplayTopologyDisplay]
}

func boundsValue(_ value: AOSDisplayTopologyBounds) -> [String: Any] {
    ["x": value.x, "y": value.y, "width": value.width, "height": value.height]
}

func aosDisplayTopologyWireValue(
    _ snapshot: AOSDisplayTopologySnapshot
) throws -> [String: Any] {
    [
        "schema": "aos.display-topology.v1",
        "identity": snapshot.identity,
        "uses_display_id_fallback": snapshot.usesDisplayIDFallback,
        "screens_have_separate_spaces": snapshot.screensHaveSeparateSpaces,
        "desktop_world_origin_native": [
            "x": snapshot.desktopWorldOriginNative.x,
            "y": snapshot.desktopWorldOriginNative.y,
        ],
        "native_bounds": boundsValue(snapshot.nativeBounds),
        "native_visible_bounds": boundsValue(snapshot.nativeVisibleBounds),
        "desktop_world_bounds": boundsValue(snapshot.desktopWorldBounds),
        "visible_desktop_world_bounds": boundsValue(snapshot.visibleDesktopWorldBounds),
        "displays": snapshot.displays.map { display in
            let member: [String: Any]
            switch display.memberIdentity {
            case .displayIDFallback(let id):
                member = ["kind": "display_id_fallback", "display_id_fallback": id]
            }
            return [
                "ordinal": display.ordinal,
                "is_main": display.isMain,
                "member_identity": member,
                "native_bounds": boundsValue(display.nativeBounds),
                "native_visible_bounds": boundsValue(display.nativeVisibleBounds),
                "desktop_world_bounds": boundsValue(display.desktopWorldBounds),
                "visible_desktop_world_bounds": boundsValue(display.visibleDesktopWorldBounds),
                "scale_factor": display.scaleFactor,
                "rotation": display.rotation,
            ]
        },
    ]
}

func validateAOSDisplayTopologyWireValue(_ value: Any) throws -> AOSDisplayTopologySnapshot {
    guard let topology = value as? AOSDisplayTopologySnapshot else {
        throw AOSOperationCoreError.invalidRecord("topology")
    }
    return topology
}

struct CaptureApplicationFact {
    let processID: Int32
}

struct CaptureWindowFact {
    let frame: CGRect
    let owningApplication: CaptureApplicationFact?
    let windowID: Int
}
`

const harnessSource = String.raw`
import Foundation

enum HarnessFailure: Error { case injectedSave }

@main
struct ScreenRecordingOwnerHarness {
    static func display(
        id: UInt32,
        ordinal: Int,
        main: Bool,
        x: Double = 0,
        scale: Double = 2,
        rotation: Double = 0
    ) -> AOSDisplayTopologyDisplay {
        let native = AOSDisplayTopologyBounds(x: x, y: 0, width: 100, height: 80)
        return AOSDisplayTopologyDisplay(
            runtimeDisplayID: id,
            ordinal: ordinal,
            isMain: main,
            memberIdentity: .displayIDFallback(id),
            nativeBounds: native,
            nativeVisibleBounds: native,
            desktopWorldBounds: native,
            visibleDesktopWorldBounds: native,
            scaleFactor: scale,
            rotation: rotation
        )
    }

    static func topology(
        scale: Double = 2,
        rotation: Double = 0,
        peer: Bool = false
    ) -> AOSDisplayTopologySnapshot {
        var displays = [display(id: 1, ordinal: 1, main: true, scale: scale, rotation: rotation)]
        if peer { displays.append(display(id: 2, ordinal: 2, main: false, x: 100)) }
        let bounds = AOSDisplayTopologyBounds(x: 0, y: 0, width: 100, height: 80)
        return AOSDisplayTopologySnapshot(
            identity: "forged-stable-identity",
            usesDisplayIDFallback: true,
            screensHaveSeparateSpaces: false,
            desktopWorldOriginNative: AOSDisplayTopologyPoint(x: 0, y: 0),
            nativeBounds: bounds,
            nativeVisibleBounds: bounds,
            desktopWorldBounds: bounds,
            visibleDesktopWorldBounds: bounds,
            displays: displays
        )
    }

    static func request(overrides: [String: Any] = [:]) -> [String: Any] {
        var value: [String: Any] = [
            "schema_version": "aos.screen-recording.request.v1",
            "request_id": "recording-1",
            "canonical_parameter_digest": String(repeating: "a", count: 64),
            "topology": topology(),
            "target": ["kind": "display", "display_ordinal": 1],
            "duration_ms": 1_000,
            "frame_rate": 30,
            "max_pixel_count": 1_000_000,
            "max_queue_frames": 3,
            "max_output_bytes": 10_000,
            "tracks": ["video": true, "system_audio": false, "microphone": false],
            "codec": "h264",
            "container": "quicktime",
        ]
        for (key, replacement) in overrides { value[key] = replacement }
        return value
    }

    static func expectInvalid(_ value: [String: Any]) throws {
        do {
            _ = try AOSScreenRecordingRequest.validatingPublicValue(value)
            fatalError("accepted invalid request")
        } catch AOSOperationCoreError.invalidRecord { return }
    }

    static func expectDrift(
        _ geometry: AOSScreenRecordingGeometry,
        _ observed: AOSDisplayTopologySnapshot
    ) throws {
        do {
            try AOSScreenRecordingGeometryValidator.validateCurrentBinding(
                geometry,
                observedTopology: observed,
                windowFacts: []
            )
            fatalError("accepted topology drift")
        } catch AOSOperationCoreError.recordingTargetDrift { return }
    }

    static func require(_ condition: @autoclosure () -> Bool, _ message: String) {
        if !condition() { fatalError(message) }
    }

    static func main() throws {
        let admitted = try AOSScreenRecordingRequest.validatingPublicValue(request())
        let geometry = try AOSScreenRecordingGeometryValidator.resolve(admitted)
        try AOSScreenRecordingGeometryValidator.validateCurrentBinding(
            geometry,
            observedTopology: topology(),
            windowFacts: []
        )
        try expectDrift(geometry, topology(scale: 1.5))
        try expectDrift(geometry, topology(rotation: 90))
        try expectDrift(geometry, topology(peer: true))

        try expectInvalid(request(overrides: ["request_id": "bad id"]))
        try expectInvalid(request(overrides: ["duration_ms": true]))
        try expectInvalid(request(overrides: ["frame_rate": 29.5]))
        try expectInvalid(request(overrides: [
            "target": ["kind": "display", "display_ordinal": true],
        ]))
        try expectInvalid(request(overrides: [
            "target": ["kind": "display", "display_ordinal": 1.5],
        ]))
        try expectInvalid(request(overrides: [
            "target": ["kind": "display", "display_ordinal": 16],
        ]))

        require(aosExactOperationWireIdentity(
            ["artifact_id": "artifact-1", "artifact_generation": 1],
            idKey: "artifact_id",
            generationKey: "artifact_generation"
        ) == AOSOperationIdentity(id: "artifact-1", generation: 1), "valid selector rejected")
        for invalid: Any in [true, 1.5, NSNumber(value: UInt64.max)] {
            require(aosExactOperationWireIdentity(
                ["artifact_id": "artifact-1", "artifact_generation": invalid],
                idKey: "artifact_id",
                generationKey: "artifact_generation"
            ) == nil, "lossy selector accepted")
        }
        require(aosExactOperationWireIdentity(
            ["artifact_id": "bad id", "artifact_generation": 1],
            idKey: "artifact_id",
            generationKey: "artifact_generation"
        ) == nil, "malformed selector id accepted")
        require(aosArtifactReleaseDestinationPath(
            "/" + String(repeating: "x", count: 4_096)
        ) == nil, "oversized destination accepted")

        var timeline = AOSScreenRecordingProgressTimeline(maximumDurationMilliseconds: 1_000)
        require(timeline.elapsedMilliseconds(atNanoseconds: 4_000_000_000) == 0, "startup counted")
        require(timeline.admitCaptureStart(atNanoseconds: 5_000_000_000), "start not admitted")
        require(timeline.admitStop(atNanoseconds: 6_000_000_000), "stop not admitted")
        require(timeline.elapsedMilliseconds(atNanoseconds: 8_500_000_000) == 1_000, "drain counted")

        let bounds = admitted.requestedBounds
        var stored: [AOSOperationProgress] = []
        let progress = try aosPersistScreenRecordingProgress(
            frameCount: 4,
            byteCount: 512,
            elapsedMilliseconds: 1_000,
            bounds: bounds
        ) { stored.append($0) }
        require(progress.frameCount == 4 && progress.byteCount == 512, "nonzero progress lost")
        require(stored == [progress], "durable progress not published")
        var reportedSuccess = false
        do {
            try aosPersistScreenRecordingProgress(
                frameCount: 5,
                byteCount: 640,
                elapsedMilliseconds: 1_000,
                bounds: bounds
            ) { _ in throw HarnessFailure.injectedSave }
            reportedSuccess = true
        } catch HarnessFailure.injectedSave {}
        require(!reportedSuccess, "save failure produced false success")
        do {
            try aosPersistScreenRecordingProgress(
                frameCount: 34,
                byteCount: 1_024,
                elapsedMilliseconds: 1_000,
                bounds: bounds
            ) { _ in }
            fatalError("unbounded frame progress accepted")
        } catch AOSOperationCoreError.recordingBoundsExceeded {}
        print("screen-recording-owner-harness: 20 assertions")
    }
}
`

test('production request, geometry, timeline, and progress owners reject lossy state', async () => {
  const temporaryRoot = await mkdtemp(path.join(process.env.TMPDIR ?? os.tmpdir(), 'aos-screen-recording-owner-'))
  try {
    const support = path.join(temporaryRoot, 'Support.swift')
    const harness = path.join(temporaryRoot, 'Harness.swift')
    const binary = path.join(temporaryRoot, 'screen-recording-owner-harness')
    await Promise.all([writeFile(support, supportSource), writeFile(harness, harnessSource)])
    const compile = spawnSync('swiftc', [
      path.join(root, 'src/daemon/public-capture-transfer.swift'),
      support,
      path.join(root, 'src/daemon/screen-recording-geometry.swift'),
      harness,
      '-o', binary,
    ], { encoding: 'utf8' })
    assert.equal(compile.status, 0, compile.stderr || compile.stdout)
    const run = spawnSync(binary, [], { encoding: 'utf8' })
    assert.equal(run.status, 0, run.stderr || run.stdout)
    assert.match(run.stdout, /20 assertions/u)
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

test('runtime ownership wires topology validation and throwing progress before effects', async () => {
  const [adapter, geometry, unified] = await Promise.all([
    readFile(path.join(root, 'src/daemon/screen-recording-operation-adapter.swift'), 'utf8'),
    readFile(path.join(root, 'src/daemon/screen-recording-geometry.swift'), 'utf8'),
    readFile(path.join(root, 'src/daemon/unified.swift'), 'utf8'),
  ])
  assert.match(geometry, /let admittedTopology: AOSDisplayTopologySnapshot/u)
  assert.match(geometry, /canonicalTopologyData\(observedTopology\)[\s\S]*canonicalTopologyData\(geometry\.admittedTopology\)/u)
  const frameValidation = adapter.indexOf('try validateBinding()')
  const frameAppend = adapter.indexOf('try encoder.append(sampleBuffer)')
  const frameProgress = adapter.indexOf('try persistProgress(progress)')
  assert.ok(frameValidation >= 0 && frameValidation < frameAppend && frameAppend < frameProgress)
  assert.doesNotMatch(adapter, /try\?\s+aosPersistScreenRecordingProgress/u)
  assert.ok((adapter.match(/try aosPersistScreenRecordingProgress/gu) ?? []).length >= 2)
  assert.match(unified, /aosExactOperationWireIdentity/u)
  assert.match(unified, /aosArtifactReleaseDestinationPath/u)
})

test('runtime-shaped custody validates while false action, state, path, and media pairs fail', () => {
  const schemaPath = path.join(root, 'shared/schemas/aos-artifact-v1.schema.json')
  const python = String.raw`
import copy, json, sys
from jsonschema import Draft202012Validator
schema = json.load(open(sys.argv[1], encoding="utf-8"))
validator = Draft202012Validator(schema)
base = {
  "schema_version": "aos.artifact.custody-result.v1",
  "action": "reveal",
  "artifact": {"artifact_id": "artifact-1", "artifact_generation": 1},
  "state": "offered", "byte_count": 512,
  "content_digest": "a" * 64,
  "media_type": "video/quicktime; codecs=avc1",
  "path": "/tmp/artifact.mov"
}
assert validator.is_valid(base)
bad = []
value = copy.deepcopy(base); value.update(action="remove", state="offered"); value.pop("path"); bad.append(value)
value = copy.deepcopy(base); value.update(action="remove", state="removed"); bad.append(value)
value = copy.deepcopy(base); value.update(action="release", state="removed"); bad.append(value)
value = copy.deepcopy(base); value.pop("path"); bad.append(value)
value = copy.deepcopy(base); value["media_type"] = "video/quicktime; codecs=hevc"; bad.append(value)
assert all(not validator.is_valid(value) for value in bad)
print("custody-schema: 1 positive, 5 negative")
`
  const result = spawnSync('python3', ['-c', python, schemaPath], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stdout, /1 positive, 5 negative/u)
})
