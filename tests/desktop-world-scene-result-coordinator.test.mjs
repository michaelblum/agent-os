import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..')
const coordinatorSource = path.join(repoRoot, 'src/daemon/desktop-world-scene-result-coordinator.swift')

test('DesktopWorld scene replacement uses an all-segment prepare and commit barrier', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-scene-segment-result-'))
  const main = path.join(root, 'main.swift')
  const executable = path.join(root, 'scene-result-proof')
  try {
    await writeFile(main, `
import Foundation

func result(
    _ operationID: String,
    _ phase: String,
    _ displayID: UInt32,
    _ index: Int,
    _ status: String,
    _ code: String? = nil,
    fingerprint: String? = "candidate",
    canvas: UInt64 = 3,
    topology: UInt64 = 4,
    snapshot: [String: Any]? = nil
) -> [String: Any] {
    var value: [String: Any] = [
        "operation_id": operationID,
        "barrier_phase": phase,
        "segment_display_id": displayID,
        "segment_index": index,
        "canvas_generation": canvas,
        "topology_generation": topology,
        "status": status,
    ]
    if let code { value["code"] = code }
    if let fingerprint { value["candidate_fingerprint"] = fingerprint }
    if let snapshot { value["snapshot"] = snapshot }
    return value
}

func broadcast(_ action: AOSDesktopWorldSceneBarrierAction?) -> AOSDesktopWorldSceneBarrierBroadcast? {
    guard let action else { return nil }
    if case .broadcast(let value) = action { return value }
    return nil
}

func broadcast(_ actions: [AOSDesktopWorldSceneBarrierAction]) -> AOSDesktopWorldSceneBarrierBroadcast? {
    for action in actions { if case .broadcast(let value) = action { return value } }
    return nil
}

func completion(_ actions: [AOSDesktopWorldSceneBarrierAction]) -> AOSDesktopWorldSceneResultCompletion? {
    for action in actions { if case .complete(let value) = action { return value } }
    return nil
}

func retires(_ actions: [AOSDesktopWorldSceneBarrierAction]) -> Bool {
    actions.contains { if case .retire = $0 { return true }; return false }
}

let segments: [(displayID: UInt32, index: Int)] = [(7, 0), (9, 1)]
let operation: [String: Any] = ["op": "mount"]
let success = AOSDesktopWorldSceneResultCoordinator()
let initial = broadcast(success.begin(
    operationID: "success",
    leaseKey: "owner::main",
    owner: "owner",
    operation: "mount",
    operationPayload: operation,
    resource: "main",
    canvasGeneration: 3,
    topologyGeneration: 4,
    segments: segments
))
precondition(initial?.phase == .prepare)
precondition(success.begin(operationID: "overlap", leaseKey: "owner::main", owner: "owner", operation: "play", operationPayload: ["op": "play"], resource: "main", canvasGeneration: 3, topologyGeneration: 4, segments: segments) == nil)
precondition(success.accept(result("unknown", "prepare", 7, 0, "ok")).isEmpty)
precondition(success.accept(result("success", "prepare", 42, 0, "ok")).isEmpty)
precondition(success.accept(result("success", "prepare", 7, 1, "ok")).isEmpty)
precondition(success.accept(result("success", "prepare", 7, 0, "ok")).isEmpty)
precondition(success.accept(result("success", "prepare", 7, 0, "ok")).isEmpty)
let commit = broadcast(success.accept(result("success", "prepare", 9, 1, "ok")))
precondition(commit?.phase == .commit)
precondition(success.accept(result("success", "commit", 7, 0, "ok", snapshot: ["renderer": "three"])).isEmpty)
let completed = completion(success.accept(result("success", "commit", 9, 1, "ok")))
precondition(completed?.payload["status"] as? String == "ok")
precondition((completed?.payload["snapshot"] as? [String: Any])?["renderer"] as? String == "three")
precondition(success.hasPending(leaseKey: "owner::main") == false)

let preparationFailure = AOSDesktopWorldSceneResultCoordinator()
_ = preparationFailure.begin(operationID: "prepare-failure", leaseKey: "owner::main", owner: "owner", operation: "mount", operationPayload: operation, resource: "main", canvasGeneration: 3, topologyGeneration: 4, segments: segments)
let abort = broadcast(preparationFailure.accept(result("prepare-failure", "prepare", 9, 1, "error", "SCENE_EXTENSION_IMPORT_TIMEOUT")))
precondition(abort?.phase == .abort)
precondition(preparationFailure.accept(result("prepare-failure", "abort", 7, 0, "ok", fingerprint: nil)).isEmpty)
let aborted = completion(preparationFailure.accept(result("prepare-failure", "abort", 9, 1, "ok", fingerprint: nil)))
precondition(aborted?.payload["status"] as? String == "error")
precondition(aborted?.payload["code"] as? String == "SCENE_EXTENSION_IMPORT_TIMEOUT")

let unknownFailure = AOSDesktopWorldSceneResultCoordinator()
_ = unknownFailure.begin(operationID: "unknown-failure", leaseKey: "owner::main", owner: "owner", operation: "mount", operationPayload: operation, resource: "main", canvasGeneration: 3, topologyGeneration: 4, segments: segments)
precondition(broadcast(unknownFailure.accept(result("unknown-failure", "prepare", 9, 1, "error", "SCENE_FUTURE_UNKNOWN")))?.phase == .abort)
precondition(unknownFailure.accept(result("unknown-failure", "abort", 7, 0, "ok", fingerprint: nil)).isEmpty)
let unknownAborted = completion(unknownFailure.accept(result("unknown-failure", "abort", 9, 1, "ok", fingerprint: nil)))
precondition(unknownAborted?.payload["status"] as? String == "error")
precondition(unknownAborted?.payload["code"] as? String == "SCENE_SEGMENT_FAILED")

let commitFailure = AOSDesktopWorldSceneResultCoordinator()
_ = commitFailure.begin(operationID: "commit-failure", leaseKey: "owner::main", owner: "owner", operation: "mount", operationPayload: operation, resource: "main", canvasGeneration: 3, topologyGeneration: 4, segments: segments)
_ = commitFailure.accept(result("commit-failure", "prepare", 7, 0, "ok"))
_ = commitFailure.accept(result("commit-failure", "prepare", 9, 1, "ok"))
precondition(commitFailure.accept(result("commit-failure", "commit", 7, 0, "ok")).isEmpty)
let release = broadcast(commitFailure.accept(result("commit-failure", "commit", 9, 1, "error")))
precondition(release?.phase == .release)
_ = commitFailure.accept(result("commit-failure", "release", 7, 0, "ok", fingerprint: nil))
let released = completion(commitFailure.accept(result("commit-failure", "release", 9, 1, "ignored", fingerprint: nil)))
precondition(released?.payload["status"] as? String == "error")

let releaseFailure = AOSDesktopWorldSceneResultCoordinator()
_ = releaseFailure.begin(operationID: "release-failure", leaseKey: "owner::main", owner: "owner", operation: "mount", operationPayload: operation, resource: "main", canvasGeneration: 3, topologyGeneration: 4, segments: segments)
_ = releaseFailure.accept(result("release-failure", "prepare", 7, 0, "ok"))
_ = releaseFailure.accept(result("release-failure", "prepare", 9, 1, "ok"))
_ = releaseFailure.accept(result("release-failure", "commit", 7, 0, "error"))
precondition(retires(releaseFailure.accept(result("release-failure", "release", 7, 0, "error"))))

let prepareDivergence = AOSDesktopWorldSceneResultCoordinator()
_ = prepareDivergence.begin(operationID: "prepare-divergence", leaseKey: "owner::main", owner: "owner", operation: "mount", operationPayload: operation, resource: "main", canvasGeneration: 3, topologyGeneration: 4, segments: segments)
_ = prepareDivergence.accept(result("prepare-divergence", "prepare", 7, 0, "ok", fingerprint: "left"))
precondition(broadcast(prepareDivergence.accept(result("prepare-divergence", "prepare", 9, 1, "ok", fingerprint: "right")))?.phase == .abort)

let fingerprintFailure = AOSDesktopWorldSceneResultCoordinator()
_ = fingerprintFailure.begin(operationID: "fingerprint", leaseKey: "owner::main", owner: "owner", operation: "mount", operationPayload: operation, resource: "main", canvasGeneration: 3, topologyGeneration: 4, segments: segments)
_ = fingerprintFailure.accept(result("fingerprint", "prepare", 7, 0, "ok", fingerprint: "prepared"))
_ = fingerprintFailure.accept(result("fingerprint", "prepare", 9, 1, "ok", fingerprint: "prepared"))
precondition(fingerprintFailure.accept(result("fingerprint", "commit", 7, 0, "ok", fingerprint: "changed")).isEmpty)
precondition(broadcast(fingerprintFailure.accept(result("fingerprint", "commit", 9, 1, "ok", fingerprint: "changed")))?.phase == .release)

let malformedCleanup = AOSDesktopWorldSceneResultCoordinator()
_ = malformedCleanup.begin(operationID: "malformed-cleanup", leaseKey: "owner::main", owner: "owner", operation: "mount", operationPayload: operation, resource: "main", canvasGeneration: 3, topologyGeneration: 4, segments: segments)
_ = malformedCleanup.accept(result("malformed-cleanup", "prepare", 7, 0, "error", "SCENE_EXTENSION_IMPORT_TIMEOUT"))
var missingStatus = result("malformed-cleanup", "abort", 7, 0, "ok", fingerprint: nil)
missingStatus.removeValue(forKey: "status")
precondition(malformedCleanup.accept(missingStatus).isEmpty)
precondition(broadcast(malformedCleanup.accept(result("malformed-cleanup", "abort", 9, 1, "ok", fingerprint: nil)))?.phase == .release)

let topologyFailure = AOSDesktopWorldSceneResultCoordinator()
_ = topologyFailure.begin(operationID: "topology", leaseKey: "owner::main", owner: "owner", operation: "mount", operationPayload: operation, resource: "main", canvasGeneration: 3, topologyGeneration: 4, segments: segments)
precondition(retires(topologyFailure.accept(result("topology", "prepare", 7, 0, "ok", topology: 5))))

let canvasFailure = AOSDesktopWorldSceneResultCoordinator()
_ = canvasFailure.begin(operationID: "canvas", leaseKey: "owner::main", owner: "owner", operation: "mount", operationPayload: operation, resource: "main", canvasGeneration: 3, topologyGeneration: 4, segments: segments)
precondition(retires(canvasFailure.accept(result("canvas", "prepare", 7, 0, "ok", canvas: 4))))

let disconnect = AOSDesktopWorldSceneResultCoordinator()
_ = disconnect.begin(operationID: "disconnect", leaseKey: "owner::main", owner: "owner", operation: "mount", operationPayload: operation, resource: "main", canvasGeneration: 3, topologyGeneration: 4, segments: segments)
precondition(broadcast(disconnect.ownerDisconnected(leaseKey: "owner::main"))?.phase == .abort)
precondition(disconnect.accept(result("disconnect", "abort", 7, 0, "ok", fingerprint: nil)).isEmpty)
precondition(broadcast(disconnect.accept(result("disconnect", "abort", 9, 1, "ok", fingerprint: nil)))?.phase == .release)
precondition(disconnect.accept(result("disconnect", "release", 7, 0, "ok", fingerprint: nil)).isEmpty)
let disconnected = completion(disconnect.accept(result("disconnect", "release", 9, 1, "ok", fingerprint: nil)))
precondition(disconnected?.payload["status"] as? String == "error")
precondition(disconnected?.payload["code"] as? String == "SCENE_OWNER_DISCONNECTED")
precondition(disconnected?.payload["release_lease"] as? Bool == true)

let timeout = AOSDesktopWorldSceneResultCoordinator()
_ = timeout.begin(operationID: "timeout", leaseKey: "owner::main", owner: "owner", operation: "mount", operationPayload: operation, resource: "main", canvasGeneration: 3, topologyGeneration: 4, segments: segments)
precondition(broadcast(timeout.expire(operationID: "timeout", phase: .prepare, topologyGeneration: 4))?.phase == .abort)
precondition(retires(timeout.expire(operationID: "timeout", phase: .abort, topologyGeneration: 4)))

let direct = AOSDesktopWorldSceneResultCoordinator()
precondition(broadcast(direct.begin(operationID: "play", leaseKey: "owner::main", owner: "owner", operation: "play", operationPayload: ["op": "play"], resource: "main", canvasGeneration: 3, topologyGeneration: 4, segments: segments))?.phase == .apply)
precondition(direct.accept(result("play", "apply", 7, 0, "ok", fingerprint: nil)).isEmpty)
precondition(completion(direct.accept(result("play", "apply", 9, 1, "ok", fingerprint: nil)))?.payload["status"] as? String == "ok")
`)
    execFileSync('swiftc', [
      '-module-cache-path', path.join(root, 'module-cache'),
      coordinatorSource,
      main,
      '-o', executable,
    ], { cwd: repoRoot, stdio: 'pipe' })
    execFileSync(executable, [], { cwd: repoRoot, stdio: 'pipe' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('DesktopWorld stage results are origin-attributed and controller-coordinated', async () => {
  const [stage, daemon, controller, transport, surface] = await Promise.all([
    readFile(path.join(repoRoot, 'packages/toolkit/components/desktop-world-stage/index.js'), 'utf8'),
    readFile(path.join(repoRoot, 'src/daemon/unified.swift'), 'utf8'),
    readFile(path.join(repoRoot, 'src/daemon/desktop-world-scene-controller.swift'), 'utf8'),
    readFile(path.join(repoRoot, 'src/daemon/desktop-world-scene-transport-controller.swift'), 'utf8'),
    readFile(path.join(repoRoot, 'src/display/desktop-world-surface.swift'), 'utf8'),
  ])
  assert.match(stage, /barrier_phase: barrierPhase/u)
  assert.match(stage, /candidate_fingerprint: candidateFingerprint/u)
  assert.doesNotMatch(stage, /if \(surface\.isPrimary\) \{[\s\S]{0,160}desktop_world_stage\.scene\.result/u)
  assert.match(surface, /payload\["segment_display_id"\] = Int\(segment\.displayID\)/u)
  assert.match(surface, /payload\["canvas_generation"\] = self\.lifecycleGeneration/u)
  assert.match(surface, /payload\["topology_generation"\] = self\.topologyGeneration/u)
  assert.match(surface, /self\.segments\.contains\(where: \{ \$0 === segment \}\)/u)
  assert.match(daemon, /desktopWorldSceneTransport\.handleResult\(target: target, payload: inner \?\? \[:\]\)/u)
  assert.match(transport, /private func authenticatedTopology\(/u)
  assert.match(transport, /canvasGeneration == target\.value/u)
  assert.match(transport, /scene\.acceptResult\(identity: stageIdentity\(topology\), payload: payload\)/u)
  assert.match(transport, /aosCanonicalDesktopWorldSceneResultErrorCode\(/u)
  assert.doesNotMatch(daemon, /canonicalSceneStageFailureCode/u)
  assert.match(controller, /return results\.accept\(payload\)/u)
  assert.match(transport, /barrier_phase": broadcast\.phase\.rawValue/u)
  assert.match(transport, /postMessageToDesktopWorldSceneStage/u)
  assert.doesNotMatch(transport, /postMessageToCurrentCanvasAsync\(canvasID: Self\.stageCanvasID, payload: \[/u)
  assert.match(transport, /retireDesktopWorldSceneStageAsync/u)
  assert.doesNotMatch(daemon, /private func dispatchSceneBarrierActions|private func ensureSceneStage/u)
})

test('DesktopWorld native orchestration pins lease refs and serializes topology retirement', async () => {
  const [daemon, controller, transport, leases, canvas] = await Promise.all([
    readFile(path.join(repoRoot, 'src/daemon/unified.swift'), 'utf8'),
    readFile(path.join(repoRoot, 'src/daemon/desktop-world-scene-controller.swift'), 'utf8'),
    readFile(path.join(repoRoot, 'src/daemon/desktop-world-scene-transport-controller.swift'), 'utf8'),
    readFile(path.join(repoRoot, 'src/daemon/scene-lease-registry.swift'), 'utf8'),
    readFile(path.join(repoRoot, 'src/display/canvas.swift'), 'utf8'),
  ])

  assert.match(leases, /struct AOSSceneLeaseToken: Equatable/u)
  assert.match(leases, /guard operationTokens\[token\.key\] == token else \{ return nil \}/u)
  assert.match(leases, /closing\.insert\(key\)/u)
  assert.match(controller, /operationTokens\[operationID\] = token/u)
  assert.match(controller, /completeOperation\(token, releaseLease: releaseLease\)/u)
  assert.match(controller, /operation: "close",\s*operationPayload: \["op": "close"\]/u)
  assert.match(
    transport,
    /scene\.withAuthorizedBroadcast\([\s\S]{0,500}postMessageToDesktopWorldSceneStage/u,
    'native posting must execute inside the controller-owned authorization barrier',
  )
  assert.doesNotMatch(controller, /func canBroadcast/u)
  assert.doesNotMatch(daemon, /"desktop_world_stage\.scene\.release"/u)
  assert.doesNotMatch(daemon, /AOSSceneLeaseRegistry|AOSDesktopWorldSceneResultCoordinator|AOSDesktopWorldSceneStageReadiness/u)

  assert.match(canvas, /surface\.lifecycleGeneration == topology\.canvasGeneration/u)
  assert.match(canvas, /surface\.topologyGeneration == topology\.generation/u)
  assert.match(canvas, /surface\.sceneBarrierTopology\(\) == topology/u)
  assert.match(transport, /func topologySettled\(_ payload: \[String: Any\]\)/u)
  assert.match(controller, /private var retirement:/u)
  assert.match(controller, /func settleRetirement/u)
  assert.match(controller, /readiness\.currentIdentity\(\)\.map\(\{ \$0 == topology\.identity \}\) \?\? true/u)
  assert.match(controller, /readiness\.invalidateIfCurrent\(identity\)[\s\S]{0,800}invalidateLocked/u)
  assert.match(controller, /AOSDesktopWorldSceneRetirementRequest/u)
  assert.match(controller, /guard let pending = retirement, pending\.request == request else \{ return \.stale \}/u)
  assert.match(
    transport,
    /retireDesktopWorldSceneStageAsync\([\s\S]{0,600}settleRetirement\(request, outcome: outcome\)[\s\S]{0,300}deliveries\.forEach\(self\.deliver\)/u,
    'client invalidation must be released only after the exact native retirement callback settles',
  )
  assert.match(canvas, /completion\?\(\.superseded\)/u)
  assert.match(
    daemon,
    /if canvasInfo\.id == self\.sceneStageCanvasID \{[\s\S]{0,180}desktopWorldSceneTransport\.stageRemoved\(\)/u,
    'removing the native stage must retire the exact scene generation and its leases',
  )
  assert.match(transport, /eventRouter\.handle\(identity: stageIdentity\(topology\), payload: payload\)/u)
})

test('DesktopWorld scene controller owns readiness, leases, barriers, subscriptions, and retirement', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-scene-controller-'))
  const main = path.join(root, 'main.swift')
  const executable = path.join(root, 'scene-controller-proof')
  try {
    await writeFile(main, `
import Foundation

func broadcast(_ actions: [AOSDesktopWorldSceneBarrierAction]) -> AOSDesktopWorldSceneBarrierBroadcast? {
    for action in actions { if case .broadcast(let value) = action { return value } }
    return nil
}

func completion(_ actions: [AOSDesktopWorldSceneBarrierAction]) -> AOSDesktopWorldSceneResultCompletion? {
    for action in actions { if case .complete(let value) = action { return value } }
    return nil
}

func result(_ operationID: String, _ phase: String, _ displayID: Int, _ index: Int, _ fingerprint: String?) -> [String: Any] {
    var payload: [String: Any] = [
        "operation_id": operationID,
        "barrier_phase": phase,
        "segment_display_id": displayID,
        "segment_index": index,
        "canvas_generation": 3,
        "topology_generation": 4,
        "status": "ok",
    ]
    if let fingerprint { payload["candidate_fingerprint"] = fingerprint }
    return payload
}

func readyController(_ controller: AOSDesktopWorldSceneController) -> AOSDesktopWorldSceneTopologyDescriptor {
    let topology = AOSDesktopWorldSceneTopologyDescriptor(
        identity: AOSDesktopWorldSceneStageIdentity(canvasGeneration: 3, topologyGeneration: 4),
        segments: [
            AOSDesktopWorldSceneStageSegment(displayID: 7, index: 0),
            AOSDesktopWorldSceneStageSegment(displayID: 9, index: 1),
        ]
    )
    let manifest: [String: Any] = ["name": "desktop-world-stage"]
    precondition(controller.configureInitial(topology))
    precondition(controller.recordReady(topology: topology, displayID: 7, index: 0, manifest: manifest) == false)
    precondition(controller.recordReady(topology: topology, displayID: 9, index: 1, manifest: manifest))
    return topology
}

let controller = AOSDesktopWorldSceneController()
let identity = AOSDesktopWorldSceneStageIdentity(canvasGeneration: 3, topologyGeneration: 4)
let segments = [
    AOSDesktopWorldSceneStageSegment(displayID: 7, index: 0),
    AOSDesktopWorldSceneStageSegment(displayID: 9, index: 1),
]
let topology = AOSDesktopWorldSceneTopologyDescriptor(identity: identity, segments: segments)
let manifest: [String: Any] = ["name": "desktop-world-stage"]
precondition(controller.configureInitial(topology))
precondition(controller.recordReady(topology: topology, displayID: 7, index: 0, manifest: manifest) == false)
precondition(controller.recordReady(topology: topology, displayID: 9, index: 1, manifest: manifest))

let connection = UUID()
let key = controller.key(owner: "owner", resource: "main")
guard case .accepted(let events) = controller.updateSubscriptions(
    key: key,
    connectionID: connection,
    ref: "ref-1",
    adding: Set(["gesture"]),
    removing: [],
    removeAll: false
) else { preconditionFailure("subscription rejected") }
precondition(events == Set(["gesture"]))
var routed = false
let routedOutcome = controller.withEventRoute(identity: identity, key: key, event: "gesture") { route in
    routed = route.connectionID == connection && route.ref == "ref-1"
    return true
}
precondition(routed)
precondition(routedOutcome == .delivered)

let operation: [String: Any] = ["op": "mount", "document": ["revision": 1]]
guard case .accepted(let initial) = controller.admitOperation(
    topology: topology,
    key: key,
    owner: "owner",
    resource: "main",
    operationName: "mount",
    operation: operation,
    connectionID: connection,
    ref: "ref-2"
) else { preconditionFailure("operation rejected") }
guard case .broadcast(let first) = initial else { preconditionFailure("missing prepare") }
precondition(first.phase == .prepare)
precondition(controller.acceptResult(identity: identity, payload: result(first.operationID, "prepare", 7, 0, "digest")).isEmpty)
let commitActions = controller.acceptResult(identity: identity, payload: result(first.operationID, "prepare", 9, 1, "digest"))
precondition(broadcast(commitActions)?.phase == .commit)
precondition(controller.acceptResult(identity: identity, payload: result(first.operationID, "commit", 7, 0, "digest")).isEmpty)
let completed = controller.acceptResult(identity: identity, payload: result(first.operationID, "commit", 9, 1, "digest"))
guard let final = completion(completed), let delivery = controller.complete(final, operationID: first.operationID) else {
    preconditionFailure("operation did not settle")
}
precondition(delivery.route.connectionID == connection)
precondition(delivery.route.ref == "ref-2")

let next = AOSDesktopWorldSceneTopologyDescriptor(
    identity: AOSDesktopWorldSceneStageIdentity(canvasGeneration: 3, topologyGeneration: 5),
    segments: segments
)
guard case .retire(let replacementRetirement)? = controller.topologySettled(next, code: "SCENE_TOPOLOGY_CHANGED") else {
    preconditionFailure("topology replacement did not retire")
}
precondition(replacementRetirement.identity == next.identity)
guard case .recoverable(let replacementDeliveries) = controller.settleRetirement(
    replacementRetirement,
    outcome: .retired
) else { preconditionFailure("topology replacement did not settle") }
precondition(replacementDeliveries.count == 1)
precondition(replacementDeliveries[0].payload["code"] as? String == "SCENE_TOPOLOGY_CHANGED")

let atomic = AOSDesktopWorldSceneController()
let atomicTopology = readyController(atomic)
let atomicConnection = UUID()
let atomicKey = atomic.key(owner: "atomic", resource: "main")
guard case .accepted = atomic.updateSubscriptions(
    key: atomicKey,
    connectionID: atomicConnection,
    ref: "atomic-ref",
    adding: Set(["gesture"]),
    removing: [],
    removeAll: false
) else { preconditionFailure("atomic subscription rejected") }
guard case .accepted(let atomicAction) = atomic.admitOperation(
    topology: atomicTopology,
    key: atomicKey,
    owner: "atomic",
    resource: "main",
    operationName: "play",
    operation: ["op": "play"],
    connectionID: atomicConnection,
    ref: "atomic-ref"
), case .broadcast(let atomicBroadcast) = atomicAction else {
    preconditionFailure("atomic operation rejected")
}
let enteredPost = DispatchSemaphore(value: 0)
let releasePost = DispatchSemaphore(value: 0)
let broadcastFinished = DispatchSemaphore(value: 0)
let invalidationFinished = DispatchSemaphore(value: 0)
let stateLock = NSLock()
var broadcastAccepted = false
var invalidationPlan: AOSDesktopWorldSceneInvalidationPlan?
DispatchQueue.global().async {
    let accepted = atomic.withAuthorizedBroadcast(atomicBroadcast, topology: atomicTopology) {
        enteredPost.signal()
        releasePost.wait()
        return true
    }
    stateLock.lock()
    broadcastAccepted = accepted
    stateLock.unlock()
    broadcastFinished.signal()
}
precondition(enteredPost.wait(timeout: .now() + 1) == .success)
DispatchQueue.global().async {
    let plan = atomic.invalidateStage(identity: atomicTopology.identity, code: "SCENE_STAGE_REMOVED")
    stateLock.lock()
    invalidationPlan = plan
    stateLock.unlock()
    invalidationFinished.signal()
}
precondition(invalidationFinished.wait(timeout: .now() + 0.05) == .timedOut)
releasePost.signal()
precondition(broadcastFinished.wait(timeout: .now() + 1) == .success)
precondition(invalidationFinished.wait(timeout: .now() + 1) == .success)
stateLock.lock()
let acceptedBeforeInvalidation = broadcastAccepted
let retired = invalidationPlan
stateLock.unlock()
precondition(acceptedBeforeInvalidation)
guard case .retire(let atomicRetirement)? = retired else {
    preconditionFailure("atomic retirement request missing")
}
var postInvalidationEvent = false
let postInvalidationOutcome = atomic.withEventRoute(identity: atomicTopology.identity, key: atomicKey, event: "gesture") { _ in
    postInvalidationEvent = true
    return true
}
precondition(postInvalidationEvent == false)
precondition(postInvalidationOutcome == .stageUnavailable)
precondition(atomic.acceptResult(
    identity: atomicTopology.identity,
    payload: result(atomicBroadcast.operationID, "apply", 7, 0, nil)
).isEmpty)
precondition(atomic.complete(
    AOSDesktopWorldSceneResultCompletion(payload: ["lease_key": atomicKey, "operation": "play"]),
    operationID: atomicBroadcast.operationID
) == nil)
precondition(atomic.stageRemoved(code: "SCENE_STAGE_REMOVED") == nil)
guard case .recoverable(let atomicDeliveries) = atomic.settleRetirement(
    atomicRetirement,
    outcome: .retired
) else { preconditionFailure("atomic retirement did not settle") }
precondition(atomicDeliveries.count == 1)
precondition(atomicDeliveries[0].route.ref == "atomic-ref")
precondition(atomicDeliveries[0].payload["code"] as? String == "SCENE_STAGE_REMOVED")

let superseding = AOSDesktopWorldSceneController()
let supersededTopology = readyController(superseding)
let supersedingConnection = UUID()
let supersedingKey = superseding.key(owner: "superseding", resource: "main")
guard case .accepted = superseding.updateSubscriptions(
    key: supersedingKey,
    connectionID: supersedingConnection,
    ref: "superseding-ref",
    adding: Set(["gesture"]),
    removing: [],
    removeAll: false
) else { preconditionFailure("superseding subscription rejected") }
guard case .retire(let supersededRetirement)? = superseding.invalidateStage(
    identity: supersededTopology.identity,
    code: "SCENE_STAGE_REMOVED"
) else { preconditionFailure("superseded retirement missing") }
let successorTopology = AOSDesktopWorldSceneTopologyDescriptor(
    identity: AOSDesktopWorldSceneStageIdentity(canvasGeneration: 3, topologyGeneration: 6),
    segments: segments
)
precondition(superseding.topologySettled(successorTopology, code: "SCENE_TOPOLOGY_CHANGED") == nil)
precondition(superseding.recordReady(
    topology: successorTopology,
    displayID: 7,
    index: 0,
    manifest: manifest
) == false)
precondition(superseding.recordReady(
    topology: successorTopology,
    displayID: 9,
    index: 1,
    manifest: manifest
))
precondition(superseding.isReady(successorTopology) == false)
guard case .stageUnavailable = superseding.admitOperation(
    topology: successorTopology,
    key: supersedingKey,
    owner: "superseding",
    resource: "main",
    operationName: "play",
    operation: ["op": "play"],
    connectionID: supersedingConnection,
    ref: "blocked-ref"
) else { preconditionFailure("successor admitted before retirement settled") }
guard case .recoverable(let supersededDeliveries) = superseding.settleRetirement(
    supersededRetirement,
    outcome: .superseded
) else { preconditionFailure("superseded retirement did not settle") }
precondition(supersededDeliveries.count == 1)
precondition(superseding.isReady(successorTopology))
guard case .accepted = superseding.admitOperation(
    topology: successorTopology,
    key: supersedingKey,
    owner: "superseding",
    resource: "main",
    operationName: "play",
    operation: ["op": "play"],
    connectionID: UUID(),
    ref: "successor-ref"
) else { preconditionFailure("successor not admitted after retirement settled") }

let tokenized = AOSDesktopWorldSceneController()
let firstTokenTopology = readyController(tokenized)
guard case .retire(let firstRetirement)? = tokenized.invalidateStage(
    identity: firstTokenTopology.identity,
    code: "SCENE_STAGE_REMOVED"
) else { preconditionFailure("first retirement token missing") }
let secondTokenTopology = AOSDesktopWorldSceneTopologyDescriptor(
    identity: AOSDesktopWorldSceneStageIdentity(canvasGeneration: 3, topologyGeneration: 7),
    segments: segments
)
precondition(tokenized.topologySettled(secondTokenTopology, code: "SCENE_TOPOLOGY_CHANGED") == nil)
precondition(tokenized.recordReady(topology: secondTokenTopology, displayID: 7, index: 0, manifest: manifest) == false)
precondition(tokenized.recordReady(topology: secondTokenTopology, displayID: 9, index: 1, manifest: manifest))
guard case .retire(let secondRetirement)? = tokenized.stageRemoved(code: "SCENE_STAGE_REMOVED") else {
    preconditionFailure("second retirement token missing")
}
guard case .stale = tokenized.settleRetirement(firstRetirement, outcome: .superseded) else {
    preconditionFailure("stale retirement callback was accepted")
}
guard case .recoverable = tokenized.settleRetirement(secondRetirement, outcome: .alreadyAbsent) else {
    preconditionFailure("latest retirement token did not settle")
}

let failedRetirement = AOSDesktopWorldSceneController()
let failedTopology = readyController(failedRetirement)
let failedConnection = UUID()
let failedKey = failedRetirement.key(owner: "failed", resource: "main")
guard case .accepted = failedRetirement.updateSubscriptions(
    key: failedKey,
    connectionID: failedConnection,
    ref: "failed-ref",
    adding: Set(["gesture"]),
    removing: [],
    removeAll: false
) else { preconditionFailure("failed-retirement subscription rejected") }
guard case .retire(let failureRequest)? = failedRetirement.invalidateStage(
    identity: failedTopology.identity,
    code: "SCENE_STAGE_REMOVED"
) else { preconditionFailure("failed retirement request missing") }
guard case .terminal(let failureDeliveries) = failedRetirement.settleRetirement(
    failureRequest,
    outcome: .failed
) else { preconditionFailure("failed retirement did not become terminal") }
precondition(failureDeliveries.count == 1)
precondition(failureDeliveries[0].payload["code"] as? String == "SCENE_STAGE_RETIRE_FAILED")
precondition(failedRetirement.configureInitial(failedTopology) == false)
let invalidRecoveryTopology = AOSDesktopWorldSceneTopologyDescriptor(
    identity: AOSDesktopWorldSceneStageIdentity(canvasGeneration: 4, topologyGeneration: 1),
    segments: []
)
precondition(failedRetirement.configureInitial(invalidRecoveryTopology) == false)
precondition(failedRetirement.configureInitial(failedTopology) == false)
let recoveredTopology = AOSDesktopWorldSceneTopologyDescriptor(
    identity: AOSDesktopWorldSceneStageIdentity(canvasGeneration: 4, topologyGeneration: 1),
    segments: segments
)
precondition(failedRetirement.configureInitial(recoveredTopology))

let disconnected = AOSDesktopWorldSceneController()
let disconnectedTopology = readyController(disconnected)
let disconnectedConnection = UUID()
let disconnectedKey = disconnected.key(owner: "disconnect", resource: "main")
guard case .accepted = disconnected.updateSubscriptions(
    key: disconnectedKey,
    connectionID: disconnectedConnection,
    ref: "disconnect-ref",
    adding: Set(["gesture"]),
    removing: [],
    removeAll: false
) else { preconditionFailure("disconnect subscription rejected") }
let disconnectPlan = disconnected.beginDisconnect(
    connectionID: disconnectedConnection,
    topology: disconnectedTopology
)
precondition(disconnectPlan.invalidation == nil)
guard let close = broadcast(disconnectPlan.barrierActions) else {
    preconditionFailure("disconnect close barrier missing")
}
precondition(close.phase == .apply)
precondition(disconnected.acceptResult(
    identity: disconnectedTopology.identity,
    payload: result(close.operationID, "apply", 7, 0, nil)
).isEmpty)
let closeActions = disconnected.acceptResult(
    identity: disconnectedTopology.identity,
    payload: result(close.operationID, "apply", 9, 1, nil)
)
guard let closeCompletion = completion(closeActions),
      let closeDelivery = disconnected.complete(closeCompletion, operationID: close.operationID) else {
    preconditionFailure("disconnect close did not settle")
}
precondition(closeDelivery.route.ref == "disconnect-ref")
precondition(closeDelivery.payload["status"] as? String == "ok")
var disconnectedEvent = false
let disconnectedEventOutcome = disconnected.withEventRoute(
    identity: disconnectedTopology.identity,
    key: disconnectedKey,
    event: "gesture"
) { _ in disconnectedEvent = true; return true }
precondition(disconnectedEvent == false)
precondition(disconnectedEventOutcome == .unsubscribed)
let duplicateDisconnect = disconnected.beginDisconnect(
    connectionID: disconnectedConnection,
    topology: disconnectedTopology
)
precondition(duplicateDisconnect.barrierActions.isEmpty)
precondition(duplicateDisconnect.invalidation == nil)

let expired = AOSDesktopWorldSceneController()
let expiredTopology = readyController(expired)
let expiredConnection = UUID()
let expiredKey = expired.key(owner: "expired", resource: "main")
guard case .accepted(let expiringAction) = expired.admitOperation(
    topology: expiredTopology,
    key: expiredKey,
    owner: "expired",
    resource: "main",
    operationName: "play",
    operation: ["op": "play"],
    connectionID: expiredConnection,
    ref: "expired-ref"
), case .broadcast(let expiring) = expiringAction else {
    preconditionFailure("expiring operation rejected")
}
guard let release = broadcast(expired.expire(
    operationID: expiring.operationID,
    phase: .apply,
    topologyGeneration: expiredTopology.identity.topologyGeneration
)) else { preconditionFailure("expiry release barrier missing") }
precondition(release.phase == .release)
precondition(expired.acceptResult(
    identity: expiredTopology.identity,
    payload: result(release.operationID, "release", 7, 0, nil)
).isEmpty)
let expiredActions = expired.acceptResult(
    identity: expiredTopology.identity,
    payload: result(release.operationID, "release", 9, 1, nil)
)
guard let expiredCompletion = completion(expiredActions),
      let expiredDelivery = expired.complete(expiredCompletion, operationID: release.operationID) else {
    preconditionFailure("expired operation did not settle")
}
precondition(expiredDelivery.route.ref == "expired-ref")
precondition(expiredDelivery.payload["code"] as? String == "SCENE_SEGMENT_TIMEOUT")
precondition(expired.acceptResult(
    identity: expiredTopology.identity,
    payload: result(release.operationID, "release", 9, 1, nil)
).isEmpty)
precondition(expired.complete(expiredCompletion, operationID: release.operationID) == nil)
`)
    execFileSync('swiftc', [
      '-module-cache-path', path.join(root, 'module-cache'),
      path.join(repoRoot, 'src/daemon/scene-lease-registry.swift'),
      path.join(repoRoot, 'src/daemon/desktop-world-scene-result-coordinator.swift'),
      path.join(repoRoot, 'src/daemon/desktop-world-scene-stage-readiness.swift'),
      path.join(repoRoot, 'src/daemon/desktop-world-scene-controller.swift'),
      main,
      '-o', executable,
    ], { cwd: repoRoot, stdio: 'pipe' })
    execFileSync(executable, [], { cwd: repoRoot, stdio: 'pipe' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('DesktopWorld stage readiness requires every exact-generation segment', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-scene-stage-readiness-'))
  const main = path.join(root, 'main.swift')
  const executable = path.join(root, 'scene-readiness-proof')
  const readinessSource = path.join(repoRoot, 'src/daemon/desktop-world-scene-stage-readiness.swift')
  try {
    await writeFile(main, `
import Foundation

let readiness = AOSDesktopWorldSceneStageReadiness()
let first = AOSDesktopWorldSceneStageIdentity(canvasGeneration: 3, topologyGeneration: 4)
let second = AOSDesktopWorldSceneStageIdentity(canvasGeneration: 3, topologyGeneration: 5)
let segments = [
    AOSDesktopWorldSceneStageSegment(displayID: 7, index: 0),
    AOSDesktopWorldSceneStageSegment(displayID: 9, index: 1),
]
let manifest: [String: Any] = ["name": "desktop-world-stage", "surface": "desktop-world"]
precondition(readiness.configure(identity: first, segments: segments))
precondition(readiness.record(identity: first, displayID: 7, index: 0, manifest: manifest) == false)
precondition(readiness.isReady(for: first) == false)
precondition(readiness.record(identity: first, displayID: 9, index: 1, manifest: manifest))
precondition(readiness.isReady(for: first))
precondition(readiness.record(identity: first, displayID: 9, index: 0, manifest: manifest) == false)
precondition(readiness.configure(identity: second, segments: segments))
precondition(readiness.isReady(for: first) == false)
precondition(readiness.isReady(for: second) == false)
precondition(readiness.record(identity: first, displayID: 7, index: 0, manifest: manifest) == false)
precondition(readiness.record(identity: second, displayID: 7, index: 0, manifest: manifest) == false)
precondition(readiness.invalidateIfCurrent(second))
precondition(readiness.invalidateIfCurrent(second) == false)
precondition(readiness.record(identity: second, displayID: 9, index: 1, manifest: manifest) == false)
precondition(readiness.isReady(for: second) == false)
`)
    execFileSync('swiftc', [
      '-module-cache-path', path.join(root, 'module-cache'),
      readinessSource,
      main,
      '-o', executable,
    ], { cwd: repoRoot, stdio: 'pipe' })
    execFileSync(executable, [], { cwd: repoRoot, stdio: 'pipe' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
