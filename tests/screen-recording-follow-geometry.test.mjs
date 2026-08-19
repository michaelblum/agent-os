import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..')
const daemonRoot = path.join(repoRoot, 'src/daemon')
const sources = [
  path.join(repoRoot, 'src/perceive/display-topology.swift'),
  path.join(daemonRoot, 'public-capture-transfer.swift'),
  path.join(daemonRoot, 'operation-owner-root.swift'),
  path.join(daemonRoot, 'operation-spawn-record.swift'),
  path.join(daemonRoot, 'operation-state.swift'),
  path.join(daemonRoot, 'operation-store.swift'),
  path.join(daemonRoot, 'operation-registry.swift'),
  path.join(daemonRoot, 'operation-resource-broker.swift'),
  path.join(daemonRoot, 'operation-resource-transaction.swift'),
  path.join(daemonRoot, 'operation-resource-claim.swift'),
  path.join(daemonRoot, 'operation-control.swift'),
  path.join(daemonRoot, 'operation-recovery.swift'),
  path.join(daemonRoot, 'screen-recording-geometry.swift'),
  path.join(daemonRoot, 'screen-recording-follow-geometry.swift'),
]

async function compileAndRun(source) {
  const root = await mkdtemp(path.join(process.env.TMPDIR ?? os.tmpdir(), 'aos-m3d-follow-'))
  const support = path.join(root, 'Support.swift')
  const main = path.join(root, 'main.swift')
  const binary = path.join(root, 'follow-geometry')
  try {
    await writeFile(support, String.raw`
import CoreGraphics
import Foundation

struct CaptureApplicationFact {
    let applicationName: String
    let processID: pid_t
}

struct CaptureWindowFact {
    let frame: CGRect
    let owningApplication: CaptureApplicationFact?
    let title: String?
    let windowID: Int
    let windowLayer: Int
}
`)
    await writeFile(main, source)
    execFileSync('swiftc', [
      '-warnings-as-errors',
      '-module-cache-path', path.join(root, 'module-cache'),
      ...sources,
      support,
      main,
      '-o', binary,
    ], { cwd: repoRoot, stdio: 'pipe' })
    return execFileSync(binary, [], { cwd: repoRoot, encoding: 'utf8' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('production parser, validator, durable CAS, coordinator, and deadline are exact', async () => {
  const output = await compileAndRun(String.raw`
import Foundation

final class FakeTimer: AOSScreenRecordingFollowTimerControlling {
    private(set) var schedules: [UInt64] = []
    private(set) var cancels = 0
    var handler: (() -> Void)?
    func schedule(deadlineNanoseconds: UInt64, _ handler: @escaping () -> Void) {
        schedules.append(deadlineNanoseconds)
        self.handler = handler
    }
    func cancel() { cancels += 1; handler = nil }
    func fire() { let value = handler; handler = nil; value?() }
}

func topology() -> AOSDisplayTopologySnapshot {
    let native = AOSDisplayTopologyBounds(x: 0, y: 0, width: 1_920, height: 1_080)
    return try! buildAOSDisplayTopologySnapshot(
        observation: [AOSDisplayTopologyObservationMember(
            runtimeDisplayID: 42,
            displayUUID: nil,
            label: "",
            isMain: true,
            isMirrored: false,
            nativeBounds: native,
            nativeVisibleBounds: native,
            scaleFactor: 2,
            rotation: 0
        )],
        screensHaveSeparateSpaces: true
    )
}

func identity(_ id: String, _ generation: UInt64) -> [String: Any] {
    ["id": id, "generation": generation]
}

func binding(observation: UInt64, state: UInt64, windowID: Int = 77) -> [String: Any] {
    [
        "target": identity("target", 1),
        "observation": identity("observation", observation),
        "state": identity("state", state),
        "session": identity("session", 1),
        "navigation": identity("navigation", 1),
        "frame": identity("frame", 1),
        "source_window": ["window_id": windowID, "owner_pid": 700],
    ]
}

func region(_ x: Double, _ y: Double, _ width: Double = 200, _ height: Double = 100) -> [String: Any] {
    [
        "kind": "region",
        "display_ordinal": 1,
        "global_bounds": ["x": x, "y": y, "width": width, "height": height],
    ]
}

func request(mode: [String: Any], tracks: [String: Any]) throws -> AOSScreenRecordingRequest {
    try AOSScreenRecordingRequest.validatingPublicValue([
        "schema_version": AOSScreenRecordingRequest.schemaVersion,
        "request_id": "request-1",
        "canonical_parameter_digest": String(repeating: "a", count: 64),
        "topology": try aosDisplayTopologyWireValue(topology()),
        "target": region(100, 100),
        "geometry": mode,
        "duration_ms": 10_000,
        "frame_rate": 30,
        "max_pixel_count": 8_294_400,
        "max_queue_frames": 4,
        "max_output_bytes": 100_000_000,
        "tracks": tracks,
        "codec": "h264",
        "container": "quicktime",
    ])
}

func update(
    operation: AOSOperationIdentity,
    expected: UInt64,
    observation: UInt64,
    state: UInt64,
    x: Double,
    windowID: Int = 77
) throws -> AOSScreenRecordingFollowUpdateRequest {
    try AOSScreenRecordingFollowUpdateRequest.validatingPublicValue([
        "request_id": "update-\(observation)-\(state)-\(Int(x))",
        "canonical_parameter_digest": String(repeating: "b", count: 64),
        "selector": [
            "operation_id": operation.id,
            "operation_generation": operation.generation,
        ],
        "expected_geometry_generation": expected,
        "topology": try aosDisplayTopologyWireValue(topology()),
        "target": region(x, 100),
        "binding": binding(observation: observation, state: state, windowID: windowID),
    ])
}

func windows() -> [CaptureWindowFact] {
    [CaptureWindowFact(
        frame: CGRect(x: 0, y: 0, width: 1_000, height: 800),
        owningApplication: CaptureApplicationFact(applicationName: "", processID: 700),
        title: nil,
        windowID: 77,
        windowLayer: 0
    )]
}

let trackSets: [[String: Any]] = [
    ["video": true, "system_audio": false, "microphone": false],
    ["video": true, "system_audio": true, "microphone": false],
    ["video": true, "system_audio": false, "microphone": true],
    ["video": true, "system_audio": true, "microphone": true],
]
for tracks in trackSets {
    let fixed = try request(mode: ["mode": "fixed"], tracks: tracks)
    let geometry = try AOSScreenRecordingGeometryValidator.resolve(fixed)
    precondition(geometry.mode == .fixed)
    precondition(geometry.geometryGeneration == 1)
    precondition(geometry.followBinding == nil)
    precondition(fixed.tracks.systemAudio == (tracks["system_audio"] as! Bool))
    precondition(fixed.tracks.microphone == (tracks["microphone"] as! Bool))
}

let followedRequest = try request(mode: [
    "mode": "caller_followed",
    "binding": binding(observation: 1, state: 1),
    "update_interval_ms": 100,
    "update_deadline_ms": 500,
], tracks: trackSets[3])
let initial = try AOSScreenRecordingGeometryValidator.resolve(followedRequest)
try AOSScreenRecordingGeometryValidator.validateCurrentBinding(
    initial,
    observedTopology: topology(),
    windowFacts: windows()
)
precondition(initial.mode == .callerFollowed)
precondition(initial.pixelWidth == 400 && initial.pixelHeight == 200)

let registration = AOSOperationAdapterRegistration(
    id: "screen-recording-adapter",
    revision: 2,
    operationClass: "screen_recording",
    capabilityIDs: ["record_screen"],
    resourceDeclarations: []
)
let adapterRegistry = try AOSAdapterRegistrySnapshot.make(
    revision: 2,
    registrations: [registration]
)
var now: UInt64 = 1_000_000_000
var nextID = 0
let registry = try AOSOperationRegistry(
    store: AOSInMemoryOperationStateStore(),
    daemonGeneration: 9,
    adapterRegistry: adapterRegistry,
    clock: { now },
    idFactory: { nextID += 1; return "operation-\(nextID)" }
)
_ = try registry.mutateDurably { state in
    let generation = state.allocateGeneration()
    state.barrier.state = .open
    state.barrier.generation = generation
    state.barrier.openSnapshot = try AOSOpenBarrierSnapshot.make(
        barrierGeneration: generation,
        registry: state.adapterRegistry
    )
}
let owner = AOSMechanicalOwnerRoot(
    ownerID: "owner",
    effectiveUID: 501,
    pid: 100,
    pidGeneration: 2,
    executableIdentityDigest: String(repeating: "c", count: 64)
)
let operation = try registry.prepareOperation(
    ownerRoot: owner,
    attribution: AOSOperationAttribution(projectID: "project", taskID: "task"),
    capabilityID: "record_screen",
    adapterRegistrationID: registration.id,
    adapterRegistrationRevision: registration.revision,
    requestedBounds: followedRequest.requestedBounds,
    screenRecordingGeometry: .initial(initial)
)
_ = try registry.transitionOperation(operation.identity, to: .starting)
_ = try registry.transitionOperation(operation.identity, to: .active)

let timer = FakeTimer()
var nativeCalls: [AOSScreenRecordingGeometry] = []
var pendingNative: ((Result<Void, Error>) -> Void)?
var stops: [(AOSStopIntent, AOSOperationCoreError)] = []
let coordinator = AOSScreenRecordingFollowGeometryCoordinator(
    operation: operation.identity,
    registry: registry,
    observeTopology: topology,
    observeWindows: windows,
    nativeUpdate: { geometry, completion in
        nativeCalls.append(geometry)
        pendingNative = completion
    },
    clock: { now },
    timer: timer,
    stopOperation: { stops.append(($0, $1)) }
)
let active = try coordinator.activate()
precondition(active.nextUpdateNotBeforeNanoseconds == 1_100_000_000)
precondition(active.nextDeadlineNanoseconds == 1_500_000_000)
precondition(timer.schedules == [1_500_000_000])

now = 1_100_000_000
let first = try update(
    operation: operation.identity,
    expected: 1,
    observation: 2,
    state: 2,
    x: 120
)
var firstResult: Result<AOSScreenRecordingGeometryState, AOSOperationCoreError>?
coordinator.submit(first) { firstResult = $0 }
precondition(nativeCalls.count == 1)
let reserved = try registry.inspect(operation.identity).screenRecordingGeometry!
precondition(reserved.accepted.geometryGeneration == 1)
precondition(reserved.pendingUpdate != nil)
precondition(firstResult == nil)

var loser: Result<AOSScreenRecordingGeometryState, AOSOperationCoreError>?
coordinator.submit(first) { loser = $0 }
if case .failure(.generationConflict)? = loser {} else {
    preconditionFailure("concurrent stale request won")
}
precondition(nativeCalls.count == 1)

pendingNative?(.success(()))
guard case .success(let committed)? = firstResult else {
    preconditionFailure("native success was not committed")
}
precondition(committed.accepted.geometryGeneration == 2)
precondition(committed.accepted.sourceRect.x == 120)
precondition(committed.pendingUpdate == nil)
precondition(committed.nextDeadlineNanoseconds == 1_600_000_000)
precondition(timer.schedules == [1_500_000_000, 1_600_000_000])

let acceptedDigest = committed.accepted.bindingDigest
let acceptedDeadline = committed.nextDeadlineNanoseconds
let stale = try update(
    operation: operation.identity,
    expected: 1,
    observation: 3,
    state: 3,
    x: 130
)
var staleResult: Result<AOSScreenRecordingGeometryState, AOSOperationCoreError>?
coordinator.submit(stale) { staleResult = $0 }
if case .failure(.generationConflict)? = staleResult {} else {
    preconditionFailure("stale generation accepted")
}
precondition(nativeCalls.count == 1)
let afterStale = try registry.inspect(operation.identity).screenRecordingGeometry!
precondition(afterStale.accepted.bindingDigest == acceptedDigest)
precondition(afterStale.nextDeadlineNanoseconds == acceptedDeadline)

let repeatedObservation = try update(
    operation: operation.identity,
    expected: 2,
    observation: 2,
    state: 3,
    x: 140
)
coordinator.submit(repeatedObservation) { result in
    if case .failure(.generationConflict) = result {} else {
        preconditionFailure("reused observation accepted")
    }
}
precondition(nativeCalls.count == 1)
precondition(stops.isEmpty)

let drift = try update(
    operation: operation.identity,
    expected: 2,
    observation: 3,
    state: 3,
    x: 140,
    windowID: 88
)
coordinator.submit(drift) { result in
    if case .failure(.recordingTargetDrift) = result {} else {
        preconditionFailure("source discontinuity was not terminal drift")
    }
}
precondition(nativeCalls.count == 1)
precondition(stops.last?.0 == .adapterFailed)
precondition(stops.last?.1 == .recordingTargetDrift)

stops.removeAll()
now = 1_600_000_000
timer.fire()
precondition(stops.count == 1)
precondition(stops[0].0 == .deadline)
precondition(stops[0].1 == .recordingFollowTimeout)
let expired = try registry.inspect(operation.identity).screenRecordingGeometry!
precondition(expired.deadlineState == .expired)
precondition(expired.accepted.geometryGeneration == 2)

let publicValue = aosScreenRecordingGeometryPublicValue(expired)
precondition(publicValue["mode"] as? String == "caller_followed")
precondition(publicValue["geometry_generation"] as? UInt64 == 2)
precondition(publicValue["binding_digest"] as? String == acceptedDigest)
precondition(publicValue["pending_update"] as? Bool == false)
precondition((publicValue["next_deadline"] as? [String: Any])?["state"] as? String == "expired")

print("follow-geometry: fixed-tracks=4 admission=1 native-winner=1 stale-reject=2 drift=1 deadline=1 projections=1")
`)
  assert.match(output, /fixed-tracks=4/u)
  assert.match(output, /native-winner=1/u)
  assert.match(output, /deadline=1/u)
})

test('production adapter executes the injected native update seam and projectors', () => {
  const childEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('NODE_TEST_')),
  )
  const output = execFileSync(process.execPath, [
    '--test',
    '--test-reporter=tap',
    '--test-name-pattern=production lifecycle and custody owners close terminal fault phases with fake dependencies',
    'tests/screen-recording-fake.test.mjs',
  ], { cwd: repoRoot, env: childEnv, encoding: 'utf8' })
  assert.match(output, /# pass 1/u)
  assert.match(output, /# fail 0/u)
})
