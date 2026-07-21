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

test('DesktopWorld stage results are origin-attributed and daemon-coordinated', async () => {
  const [stage, daemon, surface] = await Promise.all([
    readFile(path.join(repoRoot, 'packages/toolkit/components/desktop-world-stage/index.js'), 'utf8'),
    readFile(path.join(repoRoot, 'src/daemon/unified.swift'), 'utf8'),
    readFile(path.join(repoRoot, 'src/display/desktop-world-surface.swift'), 'utf8'),
  ])
  assert.match(stage, /barrier_phase: barrierPhase/u)
  assert.match(stage, /candidate_fingerprint: candidateFingerprint/u)
  assert.doesNotMatch(stage, /if \(surface\.isPrimary\) \{[\s\S]{0,160}desktop_world_stage\.scene\.result/u)
  assert.match(surface, /payload\["segment_display_id"\] = Int\(segment\.displayID\)/u)
  assert.match(surface, /payload\["canvas_generation"\] = self\.lifecycleGeneration/u)
  assert.match(surface, /payload\["topology_generation"\] = self\.topologyGeneration/u)
  assert.match(surface, /self\.segments\.contains\(where: \{ \$0 === segment \}\)/u)
  assert.match(daemon, /handleSceneStageResult\(target: target, payload: inner \?\? \[:\]\)/u)
  assert.match(daemon, /authenticatedSceneStageTopology\(target: target, payload: payload\)/u)
  assert.match(daemon, /canvasGeneration == target\.value/u)
  assert.match(daemon, /barrier_phase": broadcast\.phase\.rawValue/u)
  assert.match(daemon, /postMessageToDesktopWorldSceneStage/u)
  assert.doesNotMatch(daemon, /postMessageToCurrentCanvasAsync\(canvasID: sceneStageCanvasID, payload: \[/u)
  assert.match(daemon, /retireDesktopWorldSceneStageAsync/u)
})

test('DesktopWorld native orchestration pins lease refs and serializes topology retirement', async () => {
  const [daemon, leases, canvas] = await Promise.all([
    readFile(path.join(repoRoot, 'src/daemon/unified.swift'), 'utf8'),
    readFile(path.join(repoRoot, 'src/daemon/scene-lease-registry.swift'), 'utf8'),
    readFile(path.join(repoRoot, 'src/display/canvas.swift'), 'utf8'),
  ])

  assert.match(leases, /struct AOSSceneLeaseToken: Equatable/u)
  assert.match(leases, /guard operationTokens\[token\.key\] == token else \{ return nil \}/u)
  assert.match(leases, /closing\.insert\(key\)/u)
  assert.match(daemon, /sceneOperationTokens\[operationID\] = token/u)
  assert.match(daemon, /completeOperation\(\s*token,\s*releaseLease:/u)
  assert.match(daemon, /operation: "close",\s*operationPayload: \["op": "close"\]/u)
  assert.doesNotMatch(daemon, /"desktop_world_stage\.scene\.release"/u)

  assert.match(canvas, /surface\.lifecycleGeneration == topology\.canvasGeneration/u)
  assert.match(canvas, /surface\.topologyGeneration == topology\.generation/u)
  assert.match(canvas, /surface\.sceneBarrierTopology\(\) == topology/u)
  assert.match(daemon, /private func handleSceneStageTopologySettled\(_ payload: \[String: Any\]\)/u)
  assert.equal((daemon.match(/sceneStageReadiness\.configure\(/gu) ?? []).length, 2, 'only the guarded initial path and topology transition may configure readiness')
  assert.match(daemon, /sceneStageReadiness\.currentIdentity\(\)\.map\(\{ \$0 == identity \}\) \?\? true/u)
  assert.match(daemon, /sceneStageLifecycleLock\.lock\(\)[\s\S]{0,1200}sceneStageReadiness\.configure/u)
  assert.match(daemon, /sceneStageReadiness\.invalidateIfCurrent\(identity\)[\s\S]{0,400}sceneLeases\.invalidateAll\(\)/u)
  assert.match(daemon, /sceneStageRetiringIdentity = identity/u)
  assert.match(daemon, /sceneStageReadiness\.clear\(\)[\s\S]{0,120}sceneStageRetiringIdentity = nil/u)
  assert.match(
    daemon,
    /if canvasInfo\.id == self\.sceneStageCanvasID \{[\s\S]{0,500}self\.invalidateSceneStage\(identity: identity, code: "SCENE_STAGE_REMOVED"\)/u,
    'removing the native stage must retire the exact scene generation and its leases',
  )
  assert.match(
    daemon,
    /private func handleSceneStageEvent\([\s\S]{0,1200}sceneStageLifecycleLock\.lock\(\)[\s\S]{0,500}sceneStageReadiness\.isReady\(for: identity\)[\s\S]{0,700}writer\?\.enqueue\(bytes\)[\s\S]{0,80}sceneStageLifecycleLock\.unlock\(\)/u,
    'gesture routing and outbound admission must remain linearized with stage invalidation',
  )
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
