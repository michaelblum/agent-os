import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createSceneEventEnvelope } from '../packages/toolkit/scene/scene-response-runtime.js'

const repoRoot = path.resolve(import.meta.dirname, '..')

function aimCommitEvent() {
  return createSceneEventEnvelope({
    identity: {
      ownerId: 'example.consumer',
      resourceId: 'companion/main',
      stageId: 'desktop-world/main',
    },
    frame: {
      affordanceId: 'body-hit',
      cancelReason: null,
      coordinates: {
        desktop_world: { x: 900, y: 600 },
        native: { x: 900, y: 480 },
      },
      current: { x: 900, y: 600 },
      delta: { x: 20, y: 15 },
      gesture_id: 'gesture-1',
      gesture_type: 'drag',
      interactionId: 'aim-body',
      origin: { x: 400, y: 300 },
      phase: 'end',
      pointer: { capture_id: 'pointer-1' },
      previous: { x: 880, y: 585 },
      total_delta: { x: 500, y: 300 },
    },
    response: {
      angle: 0.5404195002705842,
      applied: true,
      distance: 583.09518948453,
      kind: 'aim_commit',
      objectId: 'body',
      origin: { x: 400, y: 300 },
      pointer: { x: 900, y: 600 },
      position: [900, 600, 0],
      revision: 2,
      route: 'line',
    },
    sequence: 7,
    topology: {
      displays: [{ bounds: [0, 0, 1920, 1080], displayId: 7, index: 0 }],
    },
    at: 1_721_000_000_000,
  })
}

test('toolkit aim-and-commit events cross canonical routing with bounded rejection diagnostics', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-scene-event-routing-'))
  const eventPath = path.join(root, 'event.json')
  const main = path.join(root, 'main.swift')
  const executable = path.join(root, 'scene-event-routing-proof')
  try {
    await writeFile(eventPath, `${JSON.stringify(aimCommitEvent())}\n`)
    await writeFile(main, `
import Foundation

func readyController() -> (AOSDesktopWorldSceneController, AOSDesktopWorldSceneStageIdentity) {
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
    return (controller, identity)
}

let bytes = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
guard let event = try JSONSerialization.jsonObject(with: bytes) as? [String: Any] else {
    preconditionFailure("event fixture did not decode")
}
precondition(aosCanonicalSceneEvent(event) != nil)

let (controller, identity) = readyController()
let connection = UUID()
let key = controller.key(owner: "example.consumer", resource: "companion/main")
guard case .accepted = controller.updateSubscriptions(
    key: key,
    connectionID: connection,
    ref: "follow-ref",
    adding: Set(["gesture"]),
    removing: [],
    removeAll: false
) else { preconditionFailure("subscription rejected") }

let diagnostics = AOSDesktopWorldSceneEventRouteDiagnostics(now: { 1234 })
var delivered: [String: Any]?
let router = AOSDesktopWorldSceneEventRouter(
    scene: controller,
    diagnostics: diagnostics
) { route, eventType, value in
    precondition(route.connectionID == connection)
    precondition(route.ref == "follow-ref")
    precondition(eventType == "gesture")
    delivered = value
    return true
}
router.handle(identity: identity, payload: [
    "lease_key": key,
    "event_type": "gesture",
    "event": event,
])
precondition((delivered?["response"] as? [String: Any])?["kind"] as? String == "aim_commit")

var wrongIdentity = event
wrongIdentity["ownerId"] = "different.consumer"
router.handle(identity: identity, payload: [
    "lease_key": key,
    "event_type": "gesture",
    "event": wrongIdentity,
])
router.handle(identity: identity, payload: [
    "lease_key": key,
    "event_type": "gesture",
    "event": ["contract": "invalid"],
])
router.record(.staleTopology)

let failingDiagnostics = AOSDesktopWorldSceneEventRouteDiagnostics(now: { 2345 })
let failingRouter = AOSDesktopWorldSceneEventRouter(
    scene: controller,
    diagnostics: failingDiagnostics
) { _, _, _ in false }
failingRouter.handle(identity: identity, payload: [
    "lease_key": key,
    "event_type": "gesture",
    "event": event,
])

let stageDiagnostics = AOSDesktopWorldSceneEventRouteDiagnostics(now: { 3000 })
let stageRouter = AOSDesktopWorldSceneEventRouter(
    scene: controller,
    diagnostics: stageDiagnostics
) { _, _, _ in true }
_ = controller.stageRemoved(code: "SCENE_STAGE_REMOVED")
stageRouter.handle(identity: identity, payload: [
    "lease_key": key,
    "event_type": "gesture",
    "event": event,
])

let (unsubscribedController, unsubscribedIdentity) = readyController()
let unsubscribedDiagnostics = AOSDesktopWorldSceneEventRouteDiagnostics(now: { 3456 })
let unsubscribedRouter = AOSDesktopWorldSceneEventRouter(
    scene: unsubscribedController,
    diagnostics: unsubscribedDiagnostics
) { _, _, _ in true }
unsubscribedRouter.handle(identity: unsubscribedIdentity, payload: [
    "lease_key": unsubscribedController.key(owner: "example.consumer", resource: "companion/main"),
    "event_type": "gesture",
    "event": event,
])

let snapshot = diagnostics.snapshot()
let counts = snapshot["by_outcome"] as? [String: Int]
precondition(Set(snapshot.keys) == Set(["contract", "total", "failures", "by_outcome", "last_failure"]))
precondition(snapshot["contract"] as? String == "aos.desktop-world.scene-event-routing.v1")
precondition(snapshot["total"] as? Int == 4)
precondition(snapshot["failures"] as? Int == 3)
precondition(counts?["enqueued"] == 1)
precondition(counts?["identity_mismatch"] == 1)
precondition(counts?["invalid_event"] == 1)
precondition(counts?["stale_topology"] == 1)
let lastFailure = snapshot["last_failure"] as? [String: Any]
precondition(Set(lastFailure?.keys.map { $0 } ?? []) == Set(["at", "code"]))
precondition(lastFailure?["code"] as? String == "stale_topology")
precondition(lastFailure?["at"] as? Double == 1234)
precondition((failingDiagnostics.snapshot()["by_outcome"] as? [String: Int])?["enqueue_failed"] == 1)
precondition((stageDiagnostics.snapshot()["by_outcome"] as? [String: Int])?["stage_unavailable"] == 1)
precondition((unsubscribedDiagnostics.snapshot()["by_outcome"] as? [String: Int])?["unsubscribed"] == 1)

let firstClockEntered = DispatchSemaphore(value: 0)
let releaseFirstClock = DispatchSemaphore(value: 0)
let firstRecordFinished = DispatchSemaphore(value: 0)
let secondRecordFinished = DispatchSemaphore(value: 0)
let clockLock = NSLock()
var clockCalls = 0
let orderedDiagnostics = AOSDesktopWorldSceneEventRouteDiagnostics(now: {
    clockLock.lock()
    clockCalls += 1
    let call = clockCalls
    clockLock.unlock()
    if call == 1 {
        firstClockEntered.signal()
        releaseFirstClock.wait()
    }
    return Double(call)
})
DispatchQueue.global().async {
    orderedDiagnostics.record(.identityMismatch)
    firstRecordFinished.signal()
}
precondition(firstClockEntered.wait(timeout: .now() + 1) == .success)
DispatchQueue.global().async {
    orderedDiagnostics.record(.invalidEvent)
    secondRecordFinished.signal()
}
precondition(secondRecordFinished.wait(timeout: .now() + 0.05) == .timedOut)
releaseFirstClock.signal()
precondition(firstRecordFinished.wait(timeout: .now() + 1) == .success)
precondition(secondRecordFinished.wait(timeout: .now() + 1) == .success)
let orderedFailure = orderedDiagnostics.snapshot()["last_failure"] as? [String: Any]
precondition(orderedFailure?["code"] as? String == "invalid_event")
precondition(orderedFailure?["at"] as? Double == 2)
print("PASS desktop world scene event routing")
`)
    execFileSync('swiftc', [
      '-module-cache-path', path.join(root, 'module-cache'),
      path.join(repoRoot, 'src/daemon/scene-lease-registry.swift'),
      path.join(repoRoot, 'src/daemon/desktop-world-scene-result-coordinator.swift'),
      path.join(repoRoot, 'src/daemon/desktop-world-scene-stage-readiness.swift'),
      path.join(repoRoot, 'src/daemon/desktop-world-scene-controller.swift'),
      path.join(repoRoot, 'src/daemon/scene-event.swift'),
      path.join(repoRoot, 'src/daemon/desktop-world-scene-event-router.swift'),
      main,
      '-o', executable,
    ], { cwd: repoRoot, stdio: 'pipe' })
    const output = execFileSync(executable, [eventPath], { cwd: repoRoot, encoding: 'utf8' })
    assert.match(output, /PASS desktop world scene event routing/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('daemon snapshot exposes scene route outcomes without scene payloads', async () => {
  const [router, transport, daemon] = await Promise.all([
    readFile(path.join(repoRoot, 'src/daemon/desktop-world-scene-event-router.swift'), 'utf8'),
    readFile(path.join(repoRoot, 'src/daemon/desktop-world-scene-transport-controller.swift'), 'utf8'),
    readFile(path.join(repoRoot, 'src/daemon/unified.swift'), 'utf8'),
  ])
  assert.match(transport, /eventRouter\.record\(\.staleTopology\)/u)
  assert.match(transport, /eventRouter\.handle\(identity: stageIdentity\(topology\), payload: payload\)/u)
  assert.match(daemon, /"desktop_world_scene_event_routing": desktopWorldSceneEventRouting\.snapshot\(\)/u)
  assert.match(router, /"by_outcome": byOutcome/u)
  assert.doesNotMatch(router, /"event": event/u)
  assert.doesNotMatch(router, /"payload": payload/u)
})
