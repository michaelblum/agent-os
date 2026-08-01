#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/aos-desktop-world-devtools.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

cat >"$TMP/main.swift" <<'SWIFT'
import Foundation

func require(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        FileHandle.standardError.write(Data("FAIL: \(message)\n".utf8))
        exit(1)
    }
}

func created(_ result: AOSDesktopWorldDevToolsMutationResult) -> AOSDesktopWorldDevToolsSessionState {
    guard case .success(let state) = result else { fatalError("session was not created") }
    return state
}

func stageSnapshot() -> [String: Any] {
    [
        "contract": aosDesktopWorldDevToolsStageContract,
        "sequence": 1,
        "status": "available",
        "world": [
            "displays": [[
                "id": "main", "index": 0,
                "bounds": [200.0, 0.0, 1440.0, 900.0],
                "scaleFactor": 2.0,
                "nativeBounds": [0.0, 0.0, 1440.0, 900.0],
            ]],
            "nodes": [["id": "body", "resourceId": "companion/main", "parentId": NSNull(), "kind": "mesh", "implementation": "aos.scene.geometry.primitive", "position": [100.0, 200.0, 0.0], "visible": true]],
            "hitRegions": [], "affordances": [], "gestures": [[
                "id": "gesture-1", "resourceId": "companion/main", "affordanceId": "body",
                "interactionId": "travel", "kind": "drag", "phase": "cancel",
                "pointerSessionId": NSNull(),
            ]], "routes": [],
        ],
        "resources": [[
            "id": "companion/main", "owner": "example.consumer", "sceneId": "scene", "revision": 1,
            "suspended": false, "objectCount": 1, "descriptorCount": 2, "animationCount": 1,
            "signalCount": 1, "interactionCount": 1, "implementations": ["aos.scene.geometry.primitive"],
            "allocations": ["geometries": 1, "materials": 1, "textures": 0, "programs": 1],
            "lifecycle": "active", "errorCode": NSNull(),
        ]],
        "interactions": [[
            "id": "travel", "resourceId": "companion/main", "owner": "example.consumer",
            "active": false, "suspended": false, "recognizers": ["drag"],
            "regionCount": 0, "errorCode": NSNull(),
        ]],
        "performance": [
            "enabled": true, "recording": false, "sampleCount": 1,
            "targetFps": 60.0, "budgetMs": 16.6667,
            "currentFps": 60.0, "p95FrameMs": 16.0, "avgFrameMs": 16.0,
            "maxFrameMs": 17.0,
            "avgRenderMs": 4.0, "avgUpdateMs": 2.0, "avgGpuMs": NSNull(),
            "drawCalls": 4.0, "triangles": 120.0, "geometries": 1.0, "textures": 0.0,
            "programs": 1.0, "backingPixels": 5_184_000.0,
            "backingWidth": 2_880.0, "backingHeight": 1_800.0,
            "damagedPixelPercentage": 12.5, "avgDamagedPixelPercentage": 10.0,
            "effectiveDevicePixelRatio": 2.0, "estimatedBackingBytes": 207_360_000.0,
            "msaaSamples": 4.0, "requestedDevicePixelRatio": 2.0, "state": "stable",
        ],
        "counters": [
            "displays": 1, "resources": 1, "nodes": 1, "hitRegions": 0,
            "affordances": 0, "activeGestures": 0, "activeRoutes": 0, "errors": 0,
        ],
        "events": [["sequence": 1, "kind": "scene.mount", "resourceId": NSNull(), "code": NSNull(), "at": 100.0]],
        "lastError": NSNull(),
    ]
}

var nativeWarmState = AOSDesktopWorldDevToolsNativeStageFacts(
    displayCount: 1,
    errorCode: nil,
    generation: 2,
    state: "warming"
)
let registry = AOSDesktopWorldDevToolsSessionRegistry(
    nativeStageFacts: { nativeWarmState }
)
guard let parsedUpdate = AOSDesktopWorldDevToolsUpdateRequest.parse([
    "selected_resource": NSNull(),
    "active_tab": "interactions",
    "filters": ["query": "route", "event_kinds": ["gesture.update"], "errors_only": true],
    "recording": true,
]) else { fatalError("valid typed update request did not parse") }
if case .clear = parsedUpdate.selectedResource {} else { fatalError("typed parser lost the clear patch") }
require(parsedUpdate.activeTab == .interactions, "typed parser lost active tab")
require(parsedUpdate.filters?.query == "route", "typed parser lost filter query")
require(parsedUpdate.filters?.eventKinds == ["gesture.update"], "typed parser lost event kinds")
require(parsedUpdate.filters?.errorsOnly == true, "typed parser lost errors-only filter")
require(parsedUpdate.recording == true, "typed parser lost recording state")
require(AOSDesktopWorldDevToolsUpdateRequest.parse(["selected_resource": 7]) == nil, "typed parser accepted an invalid selected resource")
require(AOSDesktopWorldDevToolsUpdateRequest.parse(["filters": ["unknown": true]]) == nil, "typed parser accepted an unknown filter")

let patchRegistry = AOSDesktopWorldDevToolsSessionRegistry()
let patchBase = created(patchRegistry.create(selectedResource: "companion/main"))
let cleared = created(patchRegistry.update(
    sessionID: patchBase.id,
    expectedRevision: patchBase.revision,
    selectedResource: .clear
))
require(cleared.selectedResource == nil, "clear patch did not remove selected resource")
let restored = created(patchRegistry.update(
    sessionID: patchBase.id,
    expectedRevision: cleared.revision,
    selectedResource: .set("companion/main")
))
require(restored.selectedResource == "companion/main", "set patch did not restore selected resource")
_ = patchRegistry.close(sessionID: patchBase.id)

let freshnessRegistry = AOSDesktopWorldDevToolsSessionRegistry()
let freshnessRequest = "freshness-request-1"
let freshnessSession = created(freshnessRegistry.create(stageRequestID: freshnessRequest))
let pendingFreshness = freshnessRegistry.snapshot(sessionID: freshnessSession.id)!
let pendingFreshnessSession = pendingFreshness["session"] as! [String: Any]
require(pendingFreshnessSession["stageSnapshotReady"] as? Bool == false, "headless session started fresh")
require(freshnessRegistry.recordStageSnapshot(stageSnapshot(), requestID: "unrelated-request"), "unrelated stage receipt failed")
let unrelatedFreshness = freshnessRegistry.snapshot(sessionID: freshnessSession.id)!
let unrelatedFreshnessSession = unrelatedFreshness["session"] as! [String: Any]
require(unrelatedFreshnessSession["stageSnapshotReady"] as? Bool == false, "unrelated receipt satisfied headless freshness")
require(freshnessRegistry.recordStageSnapshot(stageSnapshot(), requestID: freshnessRequest), "correlated stage receipt failed")
let completedFreshness = freshnessRegistry.snapshot(sessionID: freshnessSession.id)!
let completedFreshnessSession = completedFreshness["session"] as! [String: Any]
require(completedFreshnessSession["stageSnapshotReady"] as? Bool == true, "correlated receipt did not satisfy freshness")
_ = freshnessRegistry.close(sessionID: freshnessSession.id)

let first = created(registry.create(selectedResource: "companion/main"))
require(registry.instrumentationConfiguration().enabled, "created session did not enable instrumentation")
require(!registry.instrumentationConfiguration().recording, "recording enabled unexpectedly")

let panel = AOSDesktopWorldDevToolsHost(kind: .panel, id: "aos-desktop-world-devtools")
let prepared: AOSDesktopWorldDevToolsTransferPlan
switch registry.prepareHostTransfer(sessionID: first.id, expectedRevision: first.revision, next: panel) {
case .prepared(let plan): prepared = plan
default: fatalError("panel transfer was not prepared")
}
let attached = created(registry.commitHostTransfer(token: prepared.token))
require(attached.host == panel, "panel host was not committed")
require(registry.state(hostID: panel.id)?.id == first.id, "host did not resolve to its session")

let second = created(registry.create())
switch registry.prepareHostTransfer(sessionID: second.id, expectedRevision: second.revision, next: panel) {
case .busy: break
default: fatalError("shared interactive host was not rejected")
}
let sameCanvasDifferentKind = AOSDesktopWorldDevToolsHost(kind: .external, id: panel.id)
switch registry.prepareHostTransfer(sessionID: second.id, expectedRevision: second.revision, next: sameCanvasDifferentKind) {
case .busy: break
default: fatalError("shared canvas host was not rejected across host kinds")
}

let external = AOSDesktopWorldDevToolsHost(kind: .external, id: "consumer-slot")
let transfer: AOSDesktopWorldDevToolsTransferPlan
switch registry.prepareHostTransfer(sessionID: first.id, expectedRevision: attached.revision, next: external) {
case .prepared(let plan): transfer = plan
default: fatalError("external transfer was not prepared")
}
require(transfer.previous == panel, "transfer did not retain previous host")
require(registry.abortHostTransfer(token: transfer.token), "transfer abort failed")
require(registry.state(sessionID: first.id)?.host == panel, "aborted transfer changed the host")

let retry: AOSDesktopWorldDevToolsTransferPlan
switch registry.prepareHostTransfer(sessionID: first.id, expectedRevision: attached.revision, next: external) {
case .prepared(let plan): retry = plan
default: fatalError("retry transfer was not prepared")
}
let transferred = created(registry.commitHostTransfer(token: retry.token))
require(transferred.host == external, "external host was not committed")
require(transferred.revision == attached.revision + 1, "host transfer did not advance revision")
require(registry.state(hostID: panel.id) == nil, "transferred panel host remained owned")
require(registry.state(hostID: external.id)?.id == first.id, "external host did not resolve to its session")
require(transferred.ownedPanelIDs == [panel.id], "transferred session forgot its daemon-owned panel")

let filters = AOSDesktopWorldDevToolsFilters(query: "gesture", eventKinds: ["error", "gesture", "gesture"], errorsOnly: true)
let updated = created(registry.update(
    sessionID: first.id,
    expectedRevision: transferred.revision,
    activeTab: .interactions,
    filters: filters,
    recording: true
))
require(updated.filters.eventKinds == ["error", "gesture"], "filters were not canonicalized")
require(registry.instrumentationConfiguration().recording, "recording state did not enable stage recording")
switch registry.update(sessionID: first.id, expectedRevision: transferred.revision, recording: false) {
case .conflict(let current): require(current == updated.revision, "conflict returned wrong revision")
default: fatalError("stale update was not rejected")
}

var leaked = stageSnapshot()
leaked["transcript"] = "secret"
leaked["native"] = ["desktopFrameWarm": ["pixels": "secret"]]
require(registry.recordStageSnapshot(leaked), "valid stage snapshot with unknown renderer field was rejected")
nativeWarmState = AOSDesktopWorldDevToolsNativeStageFacts(
    displayCount: 1,
    errorCode: nil,
    generation: 3,
    nativeEffectActiveInstanceCount: 0,
    nativeEffectActiveSheetCount: 0,
    nativeEffectAcceptedCount: 2,
    nativeEffectAttemptedCount: 3,
    nativeEffectCompletedCount: 1,
    nativeEffectDisposedCount: 1,
    nativeEffectFailedCount: 1,
    nativeEffectLastErrorCode: "NATIVE_EFFECT_CAPTURE_TIMEOUT",
    nativeEffectLastOwnerID: "example.consumer",
    nativeEffectLastPresentationLatencyMilliseconds: 31,
    nativeEffectLastRenderBackingPixelCount: 480_000,
    nativeEffectLastRenderBackingPixelPercentage: 8.25,
    nativeEffectLastRenderTriangleCount: 12_000,
    nativeEffectLastProgramDigest: String(repeating: "a", count: 64),
    nativeEffectLastProgramID: "example.ripple",
    nativeEffectLastProgramRevision: 1,
    nativeEffectLastResourceID: "companion/main",
    nativeEffectLastResourceRevision: 3,
    nativeEffectPresentedCount: 1,
    nativeEffectRejectedCount: 1,
    nativeEffectRetainedBufferCount: 0,
    nativeEffectRetainedTextureCount: 0,
    nativeEffectRetainedViewCount: 0,
    nativeEffectState: "ready",
    state: "ready"
)
let canonical = registry.snapshot(sessionID: first.id)!
require(canonical["stageSnapshotRevision"] as? Int == 1, "session snapshot lost the stage receipt revision")
let canonicalSession = canonical["session"] as! [String: Any]
require(canonicalSession["stageSnapshotReady"] as? Bool == true, "interactive session reported pending freshness")
let stage = canonical["stage"] as! [String: Any]
require(stage["transcript"] == nil, "unknown renderer content crossed the daemon boundary")
require(stage["lastError"] is NSNull, "canonical stage omitted required null lastError")
let native = stage["native"] as! [String: Any]
let warm = native["desktopFrameWarm"] as! [String: Any]
require(warm["displayCount"] as? Int == 1, "native warm display count was lost")
require(warm["generation"] as? Int == 3, "native warm generation was lost")
require(warm["state"] as? String == "ready", "native warm state was lost")
require(warm["errorCode"] == nil || warm["errorCode"] is NSNull, "native warm status invented an error")
require(warm["pixels"] == nil, "renderer-supplied native content crossed the daemon boundary")
let nativeEffect = native["nativeEffect"] as! [String: Any]
require(nativeEffect["state"] as? String == "ready", "native effect state was lost")
require(nativeEffect["attemptedCount"] as? Int == 3, "native effect attempts were lost")
require(nativeEffect["acceptedCount"] as? Int == 2, "native effect accepts were lost")
require(nativeEffect["presentedCount"] as? Int == 1, "native effect presentations were lost")
require(nativeEffect["completedCount"] as? Int == 1, "native effect completions were lost")
require(nativeEffect["disposedCount"] as? Int == 1, "native effect disposals were lost")
require(nativeEffect["activeInstanceCount"] as? Int == 0, "native effect runtime count was lost")
require(nativeEffect["activeSheetCount"] as? Int == 0, "native effect sheet count was lost")
require(nativeEffect["retainedBufferCount"] as? Int == 0, "native effect buffer count was lost")
require(nativeEffect["retainedTextureCount"] as? Int == 0, "native effect texture count was lost")
require(nativeEffect["retainedViewCount"] as? Int == 0, "native effect view count was lost")
require(nativeEffect["rejectedCount"] as? Int == 1, "native effect rejections were lost")
require(nativeEffect["failedCount"] as? Int == 1, "native effect failures were lost")
require(nativeEffect["lastErrorCode"] as? String == "NATIVE_EFFECT_CAPTURE_TIMEOUT", "native effect error was lost")
require(nativeEffect["lastPresentationLatencyMs"] as? Int == 31, "native effect latency was lost")
require(nativeEffect["lastRenderBackingPixelCount"] as? Int == 480_000, "native effect backing pixels were lost")
require(nativeEffect["lastRenderBackingPixelPercentage"] as? Double == 8.25, "native effect backing percentage was lost")
require(nativeEffect["lastRenderTriangleCount"] as? Int == 12_000, "native effect triangle count was lost")
let lastExecution = nativeEffect["lastExecution"] as! [String: Any]
require(lastExecution["ownerId"] as? String == "example.consumer", "native effect owner identity was lost")
require(lastExecution["resourceId"] as? String == "companion/main", "native effect resource identity was lost")
require(lastExecution["resourceRevision"] as? Int == 3, "native effect resource revision was lost")
require(lastExecution["programId"] as? String == "example.ripple", "native effect program identity was lost")
require(lastExecution["programRevision"] as? Int == 1, "native effect program revision was lost")
require(lastExecution["programDigest"] as? String == String(repeating: "a", count: 64), "native effect program digest was lost")
require(nativeEffect["parameters"] == nil, "native effect parameters crossed the diagnostics boundary")
let canonicalWorld = stage["world"] as! [String: Any]
let canonicalDisplay = (canonicalWorld["displays"] as! [[String: Any]])[0]
require(canonicalDisplay["bounds"] as? [Double] == [200.0, 0.0, 1440.0, 900.0], "DesktopWorld display bounds drifted")
require(canonicalDisplay["nativeBounds"] as? [Double] == [0.0, 0.0, 1440.0, 900.0], "native display bounds were lost")
require(canonicalDisplay["scaleFactor"] as? Double == 2.0, "native display scale was lost")
let canonicalNode = (canonicalWorld["nodes"] as! [[String: Any]])[0]
require(canonicalNode["parentId"] is NSNull, "canonical node omitted required null parentId")
let canonicalGesture = (canonicalWorld["gestures"] as! [[String: Any]])[0]
require(canonicalGesture["pointerSessionId"] is NSNull, "canonical gesture omitted required null pointerSessionId")
let canonicalResource = (stage["resources"] as! [[String: Any]])[0]
require(canonicalResource["errorCode"] is NSNull, "canonical resource omitted required null errorCode")
let canonicalInteraction = (stage["interactions"] as! [[String: Any]])[0]
require(canonicalInteraction["errorCode"] is NSNull, "canonical interaction omitted required null errorCode")
let canonicalPerformance = stage["performance"] as! [String: Any]
require(canonicalPerformance["avgGpuMs"] is NSNull, "canonical performance omitted a required null metric")
require(canonicalPerformance["backingWidth"] as? Double == 2_880.0, "backing width was lost")
require(canonicalPerformance["backingHeight"] as? Double == 1_800.0, "backing height was lost")
require(canonicalPerformance["damagedPixelPercentage"] as? Double == 12.5, "damage percentage was lost")
require(canonicalPerformance["avgDamagedPixelPercentage"] as? Double == 10.0, "average damage percentage was lost")
require(canonicalPerformance["effectiveDevicePixelRatio"] as? Double == 2.0, "effective DPR was lost")
require(canonicalPerformance["requestedDevicePixelRatio"] as? Double == 2.0, "requested DPR was lost")
require(canonicalPerformance["estimatedBackingBytes"] as? Double == 207_360_000.0, "backing byte estimate was lost")
require(canonicalPerformance["msaaSamples"] as? Double == 4.0, "MSAA sample count was lost")
let canonicalEvent = (stage["events"] as! [[String: Any]])[0]
require(canonicalEvent["resourceId"] is NSNull, "canonical event omitted required null resourceId")
require(canonicalEvent["code"] is NSNull, "canonical event omitted required null code")
require((canonical["contract"] as? String) == aosDesktopWorldDevToolsSnapshotContract, "session snapshot contract mismatch")
let selectedStage = registry.stageSnapshot(resourceID: "companion/main")!
let selectedResources = selectedStage["resources"] as! [[String: Any]]
require(selectedResources.count == 1 && selectedResources[0]["id"] as? String == "companion/main", "resource snapshot was not filtered")
require(registry.stageSnapshot(resourceID: "missing/resource") == nil, "missing resource snapshot did not fail closed")

require(registry.recordStageSnapshot(stageSnapshot()), "repeated stage sequence was rejected")
let repeatedSnapshot = registry.snapshot(sessionID: first.id)!
require(repeatedSnapshot["stageSnapshotRevision"] as? Int == 2, "daemon receipt revision depended on stage-local sequence")

var oversized = stageSnapshot()
var world = oversized["world"] as! [String: Any]
world["nodes"] = Array(repeating: (world["nodes"] as! [[String: Any]])[0], count: 1_025)
oversized["world"] = world
require(!registry.recordStageSnapshot(oversized), "oversized stage snapshot was accepted")

var oversizedError = stageSnapshot()
var resources = oversizedError["resources"] as! [[String: Any]]
resources[0]["errorCode"] = String(repeating: "x", count: 65)
oversizedError["resources"] = resources
require(!registry.recordStageSnapshot(oversizedError), "oversized resource error code was accepted")

var invalidMetric = stageSnapshot()
var performance = invalidMetric["performance"] as! [String: Any]
performance["avgFrameMs"] = -1.0
invalidMetric["performance"] = performance
require(!registry.recordStageSnapshot(invalidMetric), "negative performance metric was accepted")

var missingRequiredNull = stageSnapshot()
performance = missingRequiredNull["performance"] as! [String: Any]
performance.removeValue(forKey: "avgGpuMs")
missingRequiredNull["performance"] = performance
require(!registry.recordStageSnapshot(missingRequiredNull), "missing required nullable metric was accepted")

var invalidDpr = stageSnapshot()
performance = invalidDpr["performance"] as! [String: Any]
performance["requestedDevicePixelRatio"] = 5.0
invalidDpr["performance"] = performance
require(!registry.recordStageSnapshot(invalidDpr), "oversized requested DPR was accepted")

var invalidDisplayScale = stageSnapshot()
world = invalidDisplayScale["world"] as! [String: Any]
var displays = world["displays"] as! [[String: Any]]
displays[0]["scaleFactor"] = 0.0
world["displays"] = displays
invalidDisplayScale["world"] = world
require(!registry.recordStageSnapshot(invalidDisplayScale), "zero display scale was accepted")

switch registry.close(sessionID: first.id, expectedRevision: updated.revision) {
case .success(let closed):
    require(closed.host == external, "closed session lost host cleanup identity")
    require(closed.ownedPanelIDs == [panel.id], "closed session lost suspended panel cleanup identity")
default: fatalError("session close failed")
}
require(registry.snapshot(sessionID: first.id) == nil, "closed session remained visible")
_ = registry.close(sessionID: second.id)
require(!registry.instrumentationConfiguration().enabled, "closing the final session did not disable instrumentation")
print("PASS DesktopWorld DevTools daemon session")
SWIFT

CLANG_MODULE_CACHE_PATH="$TMP/cache" SWIFT_MODULECACHE_PATH="$TMP/cache" \
    swiftc \
      "$ROOT/src/daemon/desktop-world-devtools-native-stage-facts.swift" \
      "$ROOT/src/daemon/desktop-world-devtools-session.swift" \
      "$TMP/main.swift" -o "$TMP/test"
"$TMP/test"
