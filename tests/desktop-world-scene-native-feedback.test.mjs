import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..')

async function compileAndRun(name, sources, mainSource) {
  const root = await mkdtemp(path.join(os.tmpdir(), `aos-${name}-`))
  const main = path.join(root, 'main.swift')
  const executable = path.join(root, name)
  try {
    await writeFile(main, mainSource)
    execFileSync('swiftc', [
      '-module-cache-path', path.join(root, 'module-cache'),
      ...sources.map((source) => path.join(repoRoot, source)),
      main,
      '-o', executable,
    ], { cwd: repoRoot, stdio: 'pipe' })
    return execFileSync(executable, [], { cwd: repoRoot, encoding: 'utf8' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

const interactionDocument = `
func interactions(
    trigger: [String: Any] = ["phase": "start"],
    amplitude: Any = 18
) -> [String: Any] {
    [
        "contract": "aos.scene.cartridge.interactions.v1",
        "schemaVersion": 1,
        "affordances": [],
        "interactions": [[
            "id": "tap-ripple",
            "affordanceId": "body",
            "recognizer": ["implementation": "aos.scene.gesture.tap", "parameters": [:]],
            "response": ["implementation": "aos.scene.response.drop", "parameters": [:]],
            "nativeEffect": [
                "implementation": "aos.scene.effect.desktop-ripple",
                "trigger": trigger,
                "parameters": ["amplitude": amplitude],
            ],
        ]],
    ]
}
`

test('native ripple Metal program compiles without AOS or live DesktopWorld', async () => {
  const source = await readFile(
    path.join(repoRoot, 'src/display/desktop-world-native-effect-renderer.swift'),
    'utf8',
  )
  const match = source.match(/private let aosDesktopWorldNativeRippleShader = #"""([\s\S]*?)"""#/u)
  assert.ok(match, 'native ripple shader source marker is missing')
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-native-ripple-metal-'))
  try {
    const metal = path.join(root, 'desktop-world-native-ripple.metal')
    const compiler = path.join(root, 'compile-metal.swift')
    const executable = path.join(root, 'compile-metal')
    await writeFile(metal, match[1])
    await writeFile(compiler, `
import Foundation
import Metal

let source = try String(contentsOfFile: CommandLine.arguments[1], encoding: .utf8)
guard let device = MTLCreateSystemDefaultDevice() else {
    preconditionFailure("Metal device is unavailable")
}
let library = try device.makeLibrary(source: source, options: nil)
precondition(library.makeFunction(name: "desktopWorldNativeRippleVertex") != nil)
precondition(library.makeFunction(name: "desktopWorldNativeRippleFragment") != nil)
`)
    execFileSync('swiftc', [
      '-module-cache-path', path.join(root, 'module-cache'),
      compiler,
      '-o', executable,
    ], {
      cwd: repoRoot,
      stdio: 'pipe',
    })
    execFileSync(executable, [metal], { cwd: repoRoot, stdio: 'pipe' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('native feedback contract rejects type drift and resolves bounded world coordinates', async () => {
  const output = await compileAndRun('native-feedback-contract', [
    'src/daemon/desktop-world-scene-stage-readiness.swift',
    'src/daemon/desktop-world-native-effect-contract.swift',
  ], `
import Foundation

${interactionDocument}

guard let binding = AOSDesktopWorldNativeEffectContract.parseBindings(
    interactions()
)?.first else {
    preconditionFailure("valid native feedback did not parse")
}
precondition(binding.affordanceID == "body")
precondition(binding.trigger == .gesture(.start))
precondition(binding.ripple.amplitude == 18)
precondition(binding.ripple.durationMilliseconds == 900)
precondition(AOSDesktopWorldNativeEffectContract.parseBindings(
    interactions(amplitude: true)
) == nil)

var duplicate = interactions()
var duplicateValues = duplicate["interactions"] as! [[String: Any]]
duplicateValues.append([
    "id": "tap-ripple",
    "affordanceId": "other",
    "recognizer": ["implementation": "aos.scene.gesture.tap", "parameters": [:]],
    "response": ["implementation": "aos.scene.response.drop", "parameters": [:]],
])
duplicate["interactions"] = duplicateValues
precondition(AOSDesktopWorldNativeEffectContract.parseBindings(duplicate) == nil)

var duplicateTrigger = interactions(trigger: ["input": "pointer_down"])
var duplicateTriggerValues = duplicateTrigger["interactions"] as! [[String: Any]]
var secondTrigger = duplicateTriggerValues[0]
secondTrigger["id"] = "other-ripple"
duplicateTriggerValues.append(secondTrigger)
duplicateTrigger["interactions"] = duplicateTriggerValues
precondition(AOSDesktopWorldNativeEffectContract.parseBindings(duplicateTrigger) == nil)

var fractionalDuration = interactions()
var values = fractionalDuration["interactions"] as! [[String: Any]]
var value = values[0]
var effect = value["nativeEffect"] as! [String: Any]
var parameters = effect["parameters"] as! [String: Any]
parameters["durationMs"] = 900.5
effect["parameters"] = parameters
value["nativeEffect"] = effect
values[0] = value
fractionalDuration["interactions"] = values
precondition(AOSDesktopWorldNativeEffectContract.parseBindings(fractionalDuration) == nil)

let identity = AOSDesktopWorldSceneStageIdentity(
    canvasGeneration: 3,
    topologyGeneration: 4
)
let request = AOSDesktopWorldNativeEffectContract.request(
    binding: binding,
    authorization: (ownerID: "example.consumer", resourceID: "companion/main", revision: 7),
    identity: identity,
    event: [
        "interactionId": "tap-ripple",
        "gesture": ["phase": "start"],
        "coordinates": ["desktopWorld": ["x": 1900, "y": 620]],
    ]
)
precondition(request?.desktopWorldOrigin.x == 1900)
precondition(request?.desktopWorldOrigin.y == 620)
precondition(request?.resourceRevision == 7)
precondition(AOSDesktopWorldNativeEffectContract.request(
    binding: binding,
    authorization: (ownerID: "example.consumer", resourceID: "companion/main", revision: 7),
    identity: identity,
    event: [
        "interactionId": "tap-ripple",
        "gesture": ["phase": "end"],
        "coordinates": ["desktopWorld": ["x": 1900, "y": 620]],
    ]
) == nil)

guard let pointerBinding = AOSDesktopWorldNativeEffectContract.parseBindings(
    interactions(trigger: ["input": "pointer_down"])
)?.first else {
    preconditionFailure("valid pointer-down native feedback did not parse")
}
precondition(pointerBinding.trigger == .pointerDown(button: "left"))
precondition(AOSDesktopWorldNativeEffectContract.parseBindings(
    interactions(trigger: ["input": "pointer_down", "button": true])
) == nil)
let pointerRequest = AOSDesktopWorldNativeEffectContract.pointerRequest(
    binding: pointerBinding,
    authorization: (ownerID: "example.consumer", resourceID: "companion/main", revision: 8),
    identity: identity,
    affordanceID: "body",
    phase: "down",
    button: "left",
    point: CGPoint(x: 2100, y: 500)
)
precondition(pointerRequest?.desktopWorldOrigin.x == 2100)
precondition(pointerRequest?.resourceRevision == 8)
precondition(AOSDesktopWorldNativeEffectContract.pointerRequest(
    binding: pointerBinding,
    authorization: (ownerID: "example.consumer", resourceID: "companion/main", revision: 8),
    identity: identity,
    affordanceID: "body",
    phase: "up",
    button: "left",
    point: CGPoint(x: 2100, y: 500)
) == nil)
precondition(AOSDesktopWorldNativeEffectContract.pointerRequest(
    binding: pointerBinding,
    authorization: (ownerID: "example.consumer", resourceID: "companion/main", revision: 8),
    identity: identity,
    affordanceID: "body",
    phase: "down",
    button: "right",
    point: CGPoint(x: 2100, y: 500)
) == nil)
print("PASS native feedback contract")
`)
  assert.match(output, /PASS native feedback contract/u)
})

test('native feedback authorization commits atomically with scene operations', async () => {
  const output = await compileAndRun('native-feedback-authorization', [
    'src/shared/desktop-world-resource-identity.swift',
    'src/shared/scene-extension-identifier.swift',
    'src/daemon/scene-lease-registry.swift',
    'src/daemon/desktop-world-scene-result-coordinator.swift',
    'src/daemon/desktop-world-scene-stage-readiness.swift',
    'src/daemon/desktop-world-native-effect-contract.swift',
    'src/daemon/desktop-world-scene-controller.swift',
    'src/daemon/scene-event.swift',
    'src/daemon/desktop-world-scene-event-router.swift',
  ], `
import Foundation

${interactionDocument}

func readyController() -> (AOSDesktopWorldSceneController, AOSDesktopWorldSceneTopologyDescriptor) {
    let controller = AOSDesktopWorldSceneController()
    let identity = AOSDesktopWorldSceneStageIdentity(canvasGeneration: 3, topologyGeneration: 4)
    let topology = AOSDesktopWorldSceneTopologyDescriptor(
        identity: identity,
        segments: [AOSDesktopWorldSceneStageSegment(displayID: 7, index: 0)]
    )
    precondition(controller.configureInitial(topology))
    precondition(controller.recordReady(
        topology: topology,
        displayID: 7,
        index: 0,
        manifest: ["name": "desktop-world-stage"]
    ))
    return (controller, topology)
}

func broadcast(_ action: AOSDesktopWorldSceneBarrierAction) -> AOSDesktopWorldSceneBarrierBroadcast {
    guard case .broadcast(let broadcast) = action else {
        preconditionFailure("expected scene broadcast")
    }
    return broadcast
}

func result(_ broadcast: AOSDesktopWorldSceneBarrierBroadcast, status: String = "ok") -> [String: Any] {
    var value: [String: Any] = [
        "operation_id": broadcast.operationID,
        "barrier_phase": broadcast.phase.rawValue,
        "canvas_generation": broadcast.canvasGeneration,
        "topology_generation": broadcast.topologyGeneration,
        "segment_display_id": 7,
        "segment_index": 0,
        "status": status,
    ]
    if broadcast.phase == .prepare || broadcast.phase == .commit {
        value["candidate_fingerprint"] = "candidate"
    }
    if status == "error" { value["code"] = "SCENE_EXTENSION_IMPORT_FAILED" }
    return value
}

@discardableResult
func settleSuccess(
    _ controller: AOSDesktopWorldSceneController,
    _ admitted: AOSDesktopWorldSceneBarrierAction
) -> AOSDesktopWorldSceneDelivery {
    var current = broadcast(admitted)
    while true {
        let actions = controller.acceptResult(
            identity: AOSDesktopWorldSceneStageIdentity(
                canvasGeneration: current.canvasGeneration,
                topologyGeneration: current.topologyGeneration
            ),
            payload: result(current)
        )
        if let next = actions.compactMap({ action -> AOSDesktopWorldSceneBarrierBroadcast? in
            if case .broadcast(let value) = action { return value }
            return nil
        }).first {
            current = next
            continue
        }
        guard let completion = actions.compactMap({ action -> AOSDesktopWorldSceneResultCompletion? in
            if case .complete(let value) = action { return value }
            return nil
        }).first,
              let delivery = controller.complete(
                completion,
                operationID: current.operationID
              ) else {
            preconditionFailure("scene operation did not complete")
        }
        return delivery
    }
}

func requestEvent(_ phase: String) -> [String: Any] {
    [
        "interactionId": "tap-ripple",
        "gesture": ["phase": phase],
        "coordinates": ["desktopWorld": ["x": 900, "y": 600]],
    ]
}

let authorization: [String: Any] = [
    "capabilities": [
        "aos.scene.desktop_frame_texture",
        "aos.scene.native_sheet_effect",
    ],
    "digest": String(repeating: "a", count: 64),
    "extensionId": "companion",
    "framebufferProofIds": [],
    "ownerId": "example.consumer",
    "resourceRevision": 1,
    "sceneAbi": "aos.scene.projection.v1",
    "threeRevision": "183",
]

let (unauthorized, unauthorizedTopology) = readyController()
guard case .stageUnavailable = unauthorized.admitOperation(
    topology: unauthorizedTopology,
    key: unauthorized.key(owner: "example.consumer", resource: "companion/main"),
    owner: "example.consumer",
    resource: "companion/main",
    operationName: "mount",
    operation: ["op": "mount", "interactions": interactions()],
    connectionID: UUID(),
    ref: "unauthorized"
) else { preconditionFailure("native feedback mount borrowed missing authority") }

let (controller, topology) = readyController()
let key = controller.key(owner: "example.consumer", resource: "companion/main")
let connection = UUID()
guard case .accepted(let mount) = controller.admitOperation(
    topology: topology,
    key: key,
    owner: "example.consumer",
    resource: "companion/main",
    operationName: "mount",
    operation: ["op": "mount", "interactions": interactions()],
    extensionAuthorization: authorization,
    connectionID: connection,
    ref: "mount"
) else { preconditionFailure("mount rejected") }
precondition(controller.nativeEffectRequest(
    identity: topology.identity,
    key: key,
    event: requestEvent("start")
) == nil)
precondition(settleSuccess(controller, mount).payload["status"] as? String == "ok")
let mounted = controller.nativeEffectRequest(
    identity: topology.identity,
    key: key,
    event: requestEvent("start")
)
precondition(mounted?.resourceRevision == 1)
precondition(mounted.map(controller.authorizesNativeEffect) == true)

let canonicalEvent: [String: Any] = [
    "contract": "aos.scene.event.v1",
    "schemaVersion": 1,
    "type": "gesture",
    "sequence": 1,
    "stageId": "desktop-world/main",
    "ownerId": "example.consumer",
    "resourceId": "companion/main",
    "affordanceId": "body",
    "interactionId": "tap-ripple",
    "gesture": [
        "id": "gesture-1",
        "kind": "tap",
        "phase": "start",
        "pointerSessionId": "pointer-1",
        "cancellationReason": NSNull(),
    ],
    "coordinates": [
        "origin": ["x": 900, "y": 600],
        "previous": NSNull(),
        "current": ["x": 900, "y": 600],
        "desktopWorld": ["x": 900, "y": 600],
        "native": ["x": 900, "y": 480],
        "delta": ["x": 0, "y": 0],
        "totalDelta": ["x": 0, "y": 0],
    ],
    "topology": NSNull(),
    "response": [
        "kind": "drop",
        "objectId": "body",
        "point": ["x": 900, "y": 600],
        "applied": true,
        "revision": 1,
    ],
    "at": 1000,
]
var nativeRequests: [AOSDesktopWorldNativeEffectRequest] = []
var publicEvents = 0
let router = AOSDesktopWorldSceneEventRouter(
    scene: controller,
    nativeFeedback: { nativeRequests.append($0) }
) { _, _, _ in
    publicEvents += 1
    return true
}
router.handle(identity: topology.identity, payload: [
    "lease_key": key,
    "event_type": "gesture",
    "event": canonicalEvent,
])
precondition(nativeRequests.count == 1)
precondition(publicEvents == 0)
precondition(
    (router.snapshot()["by_outcome"] as? [String: Int])?["unsubscribed"] == 1
)

guard case .accepted(let transaction) = controller.admitOperation(
    topology: topology,
    key: key,
    owner: "example.consumer",
    resource: "companion/main",
    operationName: "transact",
    operation: [
        "op": "transact",
        "transaction": ["expectedRevision": 1],
        "interactions": interactions(
            trigger: ["input": "pointer_down"],
            amplitude: 26
        ),
    ],
    connectionID: connection,
    ref: "transact"
) else { preconditionFailure("transaction rejected") }
_ = settleSuccess(controller, transaction)
precondition(controller.nativeEffectRequest(
    identity: topology.identity,
    key: key,
    event: requestEvent("start")
) == nil)
let transacted = controller.nativePointerEffectRequest(
    ownerID: "example.consumer",
    resourceID: "companion/main",
    resourceRevision: 2,
    affordanceID: "body",
    canvasGeneration: topology.identity.canvasGeneration,
    phase: "down",
    button: "left",
    point: CGPoint(x: 900, y: 600)
)
precondition(transacted?.resourceRevision == 2)
precondition(transacted?.binding.ripple.amplitude == 26)
precondition(controller.nativePointerEffectRequest(
    ownerID: "example.consumer",
    resourceID: "companion/main",
    resourceRevision: 1,
    affordanceID: "body",
    canvasGeneration: topology.identity.canvasGeneration,
    phase: "down",
    button: "left",
    point: CGPoint(x: 900, y: 600)
) == nil)

guard case .stageUnavailable = controller.admitOperation(
    topology: topology,
    key: key,
    owner: "example.consumer",
    resource: "companion/main",
    operationName: "transact",
    operation: ["op": "transact", "transaction": ["expectedRevision": 1]],
    connectionID: connection,
    ref: "stale"
) else { preconditionFailure("stale transaction was admitted") }

guard case .accepted(let remove) = controller.admitOperation(
    topology: topology,
    key: key,
    owner: "example.consumer",
    resource: "companion/main",
    operationName: "remove",
    operation: ["op": "remove"],
    connectionID: connection,
    ref: "remove"
) else { preconditionFailure("remove rejected") }
_ = settleSuccess(controller, remove)
precondition(controller.nativeEffectRequest(
    identity: topology.identity,
    key: key,
    event: requestEvent("start")
) == nil)

let (failed, failedTopology) = readyController()
let failedKey = failed.key(owner: "example.consumer", resource: "companion/main")
guard case .accepted(let failedMountAction) = failed.admitOperation(
    topology: failedTopology,
    key: failedKey,
    owner: "example.consumer",
    resource: "companion/main",
    operationName: "mount",
    operation: ["op": "mount", "interactions": interactions()],
    extensionAuthorization: authorization,
    connectionID: UUID(),
    ref: "failed"
) else { preconditionFailure("failed mount admission rejected") }
let failedMount = broadcast(failedMountAction)
let abortActions = failed.acceptResult(
    identity: failedTopology.identity,
    payload: result(failedMount, status: "error")
)
guard let abort = abortActions.compactMap({ action -> AOSDesktopWorldSceneBarrierBroadcast? in
    if case .broadcast(let value) = action { return value }
    return nil
}).first else { preconditionFailure("abort missing") }
let completionActions = failed.acceptResult(
    identity: failedTopology.identity,
    payload: result(abort)
)
guard let failedCompletion = completionActions.compactMap({ action -> AOSDesktopWorldSceneResultCompletion? in
    if case .complete(let value) = action { return value }
    return nil
}).first else { preconditionFailure("failed completion missing") }
_ = failed.complete(failedCompletion, operationID: abort.operationID)
precondition(failed.nativeEffectRequest(
    identity: failedTopology.identity,
    key: failedKey,
    event: requestEvent("start")
) == nil)
print("PASS native feedback authorization")
`)
  assert.match(output, /PASS native feedback authorization/u)
})

test('native feedback lifecycle is bounded, single-flight, and fully disposable', async () => {
  const output = await compileAndRun('native-feedback-lifecycle', [
    'src/daemon/desktop-world-native-feedback-controller.swift',
  ], `
import Foundation

enum AOSDesktopPixelLimits {
    static let interactiveMaximumPixelsPerDisplay = 1_048_576
}

protocol AOSDesktopFrameCancelling { func cancel() }
final class AOSDesktopFrameCancellation: AOSDesktopFrameCancelling {
    var canceled = false
    func cancel() { canceled = true }
}

struct AOSDesktopFrameWarmConfiguration {
    let canvasGeneration: UInt64
    let displayIDs: [UInt32]
    let excludingWindowIDs: [Int]
    let maximumPixelsPerDisplay: Int
    let topologyGeneration: UInt64
}
struct AOSDesktopPixelFrame { let displayID: UInt32 }
struct AOSDesktopPixelFrameSet { let frames: [AOSDesktopPixelFrame] }
protocol AOSDesktopPixelFrameSetCapturing: AnyObject {
    func capturePrewarmedFrames(
        _ configuration: AOSDesktopFrameWarmConfiguration,
        completion: @escaping (Result<AOSDesktopPixelFrameSet, Error>) -> Void
    ) -> AOSDesktopFrameCancelling
}

struct AOSDesktopWorldResourceIdentity: Equatable {
    let ownerID: String
    let resourceID: String
}
struct AOSDesktopWorldNativeRippleParameters: Equatable {
    let amplitude: Double
    let durationMilliseconds: Int
}
struct AOSDesktopWorldNativeEffectBinding: Equatable {
    let ripple: AOSDesktopWorldNativeRippleParameters
}
struct AOSDesktopWorldNativeEffectRequest {
    let binding: AOSDesktopWorldNativeEffectBinding
    let canvasGeneration: UInt64
    let desktopWorldOrigin: CGPoint
    let ownerID: String
    let resourceID: String
    let resourceRevision: Int
    let topologyGeneration: UInt64
}

enum PreparationFailure: Error { case unavailable }

final class Capturer: AOSDesktopPixelFrameSetCapturing {
    var pending: [(Result<AOSDesktopPixelFrameSet, Error>) -> Void] = []
    var cancellations: [AOSDesktopFrameCancellation] = []
    func capturePrewarmedFrames(
        _ configuration: AOSDesktopFrameWarmConfiguration,
        completion: @escaping (Result<AOSDesktopPixelFrameSet, Error>) -> Void
    ) -> AOSDesktopFrameCancelling {
        pending.append(completion)
        let cancellation = AOSDesktopFrameCancellation()
        cancellations.append(cancellation)
        return cancellation
    }
    func completeNext() {
        pending.removeFirst()(.success(AOSDesktopPixelFrameSet(
            frames: [AOSDesktopPixelFrame(displayID: 7), AOSDesktopPixelFrame(displayID: 9)]
        )))
    }
}

@MainActor
final class Runtime: AOSDesktopWorldNativeFeedbackRuntime {
    var completion: (() -> Void)?
    var disposed = false
    func present(onComplete: @escaping () -> Void) { completion = onComplete }
    func dispose() { disposed = true; completion = nil }
    func complete() { let value = completion; completion = nil; value?() }
}

final class Host: AOSDesktopWorldNativeFeedbackHosting {
    let context = AOSDesktopWorldNativeFeedbackCaptureContext(
        canvasGeneration: 3,
        displayIDs: [7, 9],
        excludingWindowIDs: [101, 102],
        topologyGeneration: 4
    )
    @MainActor var installCount = 0
    @MainActor var onInstall: (() -> Void)?
    @MainActor var prepareCount = 0
    @MainActor var prepareFails = false
    @MainActor var releaseCount = 0
    @MainActor var removeCount = 0
    @MainActor var runtimes: [Runtime] = []
    @MainActor var shutdownCount = 0
    func captureContext() -> AOSDesktopWorldNativeFeedbackCaptureContext? { context }
    @MainActor func prepare() throws {
        prepareCount += 1
        if prepareFails { throw PreparationFailure.unavailable }
    }
    @MainActor func install(
        request: AOSDesktopWorldNativeEffectRequest,
        frames: AOSDesktopPixelFrameSet
    ) throws -> AOSDesktopWorldNativeFeedbackInstallation {
        installCount += 1
        let runtime = Runtime()
        runtimes.append(runtime)
        onInstall?()
        return AOSDesktopWorldNativeFeedbackInstallation(
            identity: AOSDesktopWorldResourceIdentity(
                ownerID: "aos.desktop-world",
                resourceID: "native-sheet/main"
            ),
            runtime: runtime
        )
    }
    @MainActor func remove(
        canvasGeneration: UInt64,
        topologyGeneration: UInt64,
        identity: AOSDesktopWorldResourceIdentity
    ) { removeCount += 1 }
    @MainActor func releasePreparedResources() { releaseCount += 1 }
    @MainActor func shutdown() { shutdownCount += 1 }
}

func pumpUntil(_ predicate: () -> Bool) {
    let deadline = Date().addingTimeInterval(1)
    while !predicate() && Date() < deadline {
        RunLoop.current.run(until: Date().addingTimeInterval(0.002))
    }
    precondition(predicate())
}

let request = AOSDesktopWorldNativeEffectRequest(
    binding: AOSDesktopWorldNativeEffectBinding(
        ripple: AOSDesktopWorldNativeRippleParameters(
            amplitude: 18,
            durationMilliseconds: 900
        )
    ),
    canvasGeneration: 3,
    desktopWorldOrigin: CGPoint(x: 900, y: 600),
    ownerID: "example.consumer",
    resourceID: "companion/main",
    resourceRevision: 1,
    topologyGeneration: 4
)
var authorized = true
let host = Host()
let capturer = Capturer()
var deadlines: [(delay: TimeInterval, item: DispatchWorkItem)] = []
let controller = AOSDesktopWorldNativeFeedbackController(
    host: host,
    capturer: capturer,
    scheduleDeadline: { deadlines.append(($0, $1)) },
    authorize: { _ in authorized }
)

precondition(!controller.trigger(request))
precondition(capturer.pending.isEmpty)
controller.reconcileAvailability(true)
pumpUntil { MainActor.assumeIsolated { host.prepareCount == 1 } }
precondition(controller.trigger(request))
precondition(!controller.trigger(request))
capturer.completeNext()
pumpUntil { MainActor.assumeIsolated { host.installCount == 1 } }
MainActor.assumeIsolated { host.runtimes.last?.complete() }
pumpUntil { MainActor.assumeIsolated { host.removeCount == 1 } }

MainActor.assumeIsolated {
    host.onInstall = { controller.cancelAll() }
}
precondition(controller.trigger(request))
capturer.completeNext()
pumpUntil { MainActor.assumeIsolated { host.installCount == 2 } }
pumpUntil { MainActor.assumeIsolated { host.removeCount == 2 } }
precondition(MainActor.assumeIsolated { host.runtimes.last?.disposed == true })
MainActor.assumeIsolated { host.onInstall = nil }

controller.reconcileAvailability(false)
controller.reconcileAvailability(true)
pumpUntil { MainActor.assumeIsolated { host.prepareCount == 2 } }
RunLoop.current.run(until: Date().addingTimeInterval(0.02))
precondition(MainActor.assumeIsolated { host.releaseCount == 0 })

for index in 0..<100 {
    precondition(controller.trigger(request))
    capturer.completeNext()
    pumpUntil { MainActor.assumeIsolated { host.installCount == index + 3 } }
    MainActor.assumeIsolated { host.runtimes.last?.complete() }
    pumpUntil { MainActor.assumeIsolated { host.removeCount == index + 3 } }
}
precondition(MainActor.assumeIsolated {
    host.runtimes.allSatisfy(\\.disposed)
})

precondition(controller.trigger(request))
capturer.completeNext()
pumpUntil { MainActor.assumeIsolated { host.installCount == 103 } }
precondition(deadlines.last?.delay == 1.15)
deadlines.last?.item.perform()
precondition(!controller.trigger(request))
pumpUntil { MainActor.assumeIsolated { host.removeCount == 103 } }

precondition(controller.trigger(request))
let timeoutCapture = capturer.cancellations.last!
precondition(deadlines.last?.delay == 0.75)
deadlines.last?.item.perform()
precondition(timeoutCapture.canceled)
capturer.completeNext()
RunLoop.current.run(until: Date().addingTimeInterval(0.02))
precondition(MainActor.assumeIsolated { host.installCount == 103 })

precondition(controller.trigger(request))
let unauthorizedCapture = capturer.cancellations.last!
authorized = false
controller.reconcileAuthorization()
precondition(unauthorizedCapture.canceled)
capturer.completeNext()
RunLoop.current.run(until: Date().addingTimeInterval(0.02))
precondition(MainActor.assumeIsolated { host.installCount == 103 })
precondition(!controller.trigger(request))

authorized = true
controller.reconcileAvailability(false)
pumpUntil { MainActor.assumeIsolated { host.releaseCount == 1 } }
precondition(!controller.trigger(request))
controller.shutdown()
precondition(MainActor.assumeIsolated { host.shutdownCount == 1 })
precondition(MainActor.assumeIsolated { host.installCount == host.removeCount })
precondition(!controller.trigger(request))

let failedHost = Host()
MainActor.assumeIsolated { failedHost.prepareFails = true }
let failedCapturer = Capturer()
let failedController = AOSDesktopWorldNativeFeedbackController(
    host: failedHost,
    capturer: failedCapturer,
    scheduleDeadline: { _, _ in },
    authorize: { _ in true }
)
failedController.reconcileAvailability(true)
pumpUntil { MainActor.assumeIsolated { failedHost.prepareCount == 1 } }
precondition(!failedController.trigger(request))
precondition(failedCapturer.pending.isEmpty)
failedController.shutdown()
print("PASS native feedback lifecycle")
`)
  assert.match(output, /PASS native feedback lifecycle/u)
})
