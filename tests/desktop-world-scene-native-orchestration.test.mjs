import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..')

test('DesktopWorld hosts use current non-persistent source', async () => {
  const [surface, scheme] = await Promise.all([
    readFile(path.join(repoRoot, 'src/display/desktop-world-surface.swift'), 'utf8'),
    readFile(path.join(repoRoot, 'src/display/canvas.swift'), 'utf8'),
  ])
  assert.match(surface, /private let websiteDataStore = WKWebsiteDataStore\.nonPersistent\(\)/u)
  assert.match(surface, /config\.websiteDataStore = websiteDataStore/u)
  assert.match(scheme, /request\.cachePolicy = \.reloadIgnoringLocalCacheData/u)
  assert.match(scheme, /aosSchemeOriginalURLResponse\(response, requestURL: url\)/u)
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
  assert.match(controller, /let actions = results\.accept\(payload\)/u)
  assert.match(controller, /revokeReleasedProjectionAuthorizationLocked\(actions\)/u)
  assert.match(controller, /return actions/u)
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
  assert.match(controller, /private\(set\) var retirement:/u)
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

  const triggerBody = daemon.match(
    /private func triggerNativeSheetEffect\([\s\S]*?\n    \}/u,
  )?.[0] ?? ''
  const gestureBody = daemon.match(
    /private func updateNativeSheetEffect\([\s\S]*?\n    \}/u,
  )?.[0] ?? ''
  assert.match(triggerBody, /desktopWorldNativeFeedback\.trigger\(request\)/u)
  assert.match(gestureBody, /desktopWorldNativeFeedback\.handleGesture\(/u)
  assert.doesNotMatch(triggerBody, /DispatchQueue\.main\.async/u)
  assert.doesNotMatch(gestureBody, /DispatchQueue\.main\.async/u)
})
