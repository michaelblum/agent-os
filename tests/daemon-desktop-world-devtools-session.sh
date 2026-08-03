#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/aos-desktop-world-devtools.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

cat >"$TMP/main.swift" <<'SWIFT'
import Foundation

struct DesktopWorldSurfaceSegment {
    let displayID: UInt32
    let index: Int
}

struct DesktopWorldSceneBarrierTopology {
    let canvasGeneration: UInt64
    let generation: UInt64
    let segments: [DesktopWorldSurfaceSegment]
}

struct CanvasOwnerInfo {
    let consumerID: String
    let harness: String
    let pid: Int
    let cwd: String
    let worktreeRoot: String?
    let runtimeMode: String
}

struct CanvasRequest {
    let action: String
    var id: String?
    var at: [CGFloat]?
    var url: String?
    var interactive: Bool?
    var windowLevel: String?
    var focus: Bool?
    var scope: String?
    var cascade: Bool?
    var owner: CanvasOwnerInfo?

    init(
        action: String,
        id: String? = nil,
        at: [CGFloat]? = nil,
        url: String? = nil,
        interactive: Bool? = nil,
        focus: Bool? = nil,
        scope: String? = nil,
        owner: CanvasOwnerInfo? = nil
    ) {
        self.action = action
        self.id = id
        self.at = at
        self.url = url
        self.interactive = interactive
        self.focus = focus
        self.scope = scope
        self.owner = owner
    }
}

struct CanvasResponse {
    let status: String?
}

enum FakeRuntimeMode: String {
    case repo
}

func aosRepoRootFromBases(_ bases: [String]) -> String? { bases.first }
func aosCurrentRuntimeMode() -> FakeRuntimeMode { .repo }

final class CanvasManager {
    var canvasIDs: Set<String> = []
    var posts: [[String: Any]] = []
    var topology = DesktopWorldSceneBarrierTopology(
        canvasGeneration: 3,
        generation: 4,
        segments: [
            DesktopWorldSurfaceSegment(displayID: 100, index: 0),
            DesktopWorldSurfaceSegment(displayID: 101, index: 1),
        ]
    )

    func desktopWorldSceneBarrierTopology(canvasID: String) -> DesktopWorldSceneBarrierTopology? {
        canvasIDs.contains(canvasID) ? topology : nil
    }

    func postMessageToCurrentCanvasAsync(canvasID: String, payload: [String: Any]) {
        posts.append(["canvasID": canvasID, "message": payload])
    }

    func hasCanvas(_ id: String) -> Bool { canvasIDs.contains(id) }

    func handle(_ request: CanvasRequest) -> CanvasResponse {
        if let id = request.id {
            if request.action == "remove" { canvasIDs.remove(id) }
            if request.action == "create" { canvasIDs.insert(id) }
        }
        return CanvasResponse(status: "success")
    }
}

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

func performance(_ segmentIndex: Int) -> [String: Any] {
    let primary = segmentIndex == 0
    let backingWidth = primary ? 3_024.0 : 1_920.0
    let backingHeight = primary ? 1_964.0 : 1_080.0
    let backingPixels = backingWidth * backingHeight
    let scale = primary ? 2.0 : 1.0
    let resolvedBytes = backingPixels * 8
    return [
        "enabled": true, "recording": false, "sampleCount": 1,
        "targetFps": 60.0, "budgetMs": 16.6667,
        "currentFps": 60.0, "p95FrameMs": 16.0, "avgFrameMs": 16.0,
        "maxFrameMs": 17.0,
        "avgRenderMs": 4.0, "avgUpdateMs": 2.0, "avgGpuMs": NSNull(),
        "drawCalls": primary ? 0.0 : 4.0, "triangles": primary ? 0.0 : 120.0,
        "geometries": 1.0, "textures": 0.0,
        "programs": 1.0, "backingPixels": backingPixels,
        "backingWidth": backingWidth, "backingHeight": backingHeight,
        "damagedPixelPercentage": 12.5, "avgDamagedPixelPercentage": 10.0,
        "effectiveDevicePixelRatio": scale, "estimatedBackingBytes": resolvedBytes * 5,
        "msaaSamples": 4.0, "requestedDevicePixelRatio": scale, "state": "stable",
    ]
}

func displayPerformance(_ segmentIndex: Int) -> [String: Any] {
    [
        "displayId": String(segmentIndex + 100),
        "displayIndex": segmentIndex,
        "scope": "stage-segment",
        "performance": performance(segmentIndex),
    ]
}

let requiredStageCounterKeys = [
    "displays", "resources", "nodes", "hitRegions", "affordances",
    "activeGestures", "activeRoutes", "errors",
]

func stageCounters() -> [String: Int] {
    [
        "displays": 2, "resources": 1, "nodes": 1, "hitRegions": 0,
        "affordances": 0, "activeGestures": 0, "activeRoutes": 0, "errors": 0,
    ]
}

func stageSnapshot(
    segmentIndex: Int = 0,
    canvasGeneration: Int = 3,
    topologyGeneration: Int = 4
) -> [String: Any] {
    [
        "contract": aosDesktopWorldDevToolsStageContract,
        "canvasGeneration": canvasGeneration,
        "topologyGeneration": topologyGeneration,
        "sequence": 1,
        "status": "available",
        "world": [
            "displays": [[
                "id": "100", "index": 0,
                "bounds": [207.0, 0.0, 1512.0, 982.0],
                "scaleFactor": 2.0,
                "nativeBounds": [0.0, 0.0, 1512.0, 982.0],
            ], [
                "id": "101", "index": 1,
                "bounds": [0.0, 982.0, 1920.0, 1080.0],
                "scaleFactor": 1.0,
                "nativeBounds": [-207.0, 982.0, 1920.0, 1080.0],
            ]],
            "nodes": [["id": "body", "resourceId": "companion/main", "parentId": NSNull(), "kind": "mesh", "implementation": "aos.scene.geometry.primitive", "position": [1498.0, 1166.0, 0.0], "visible": true]],
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
        "displayPerformance": [displayPerformance(segmentIndex)],
        "counters": stageCounters(),
        "events": [["sequence": 1, "kind": "scene.mount", "resourceId": NSNull(), "code": NSNull(), "at": 100.0]],
        "lastError": NSNull(),
    ]
}

func aggregateStageSnapshot() -> [String: Any] {
    var snapshot = stageSnapshot()
    snapshot["displayPerformance"] = [displayPerformance(0), displayPerformance(1)]
    return snapshot
}

func segmentIdentity(
    _ index: Int,
    canvasGeneration: UInt64 = 3,
    topologyGeneration: UInt64 = 4
) -> AOSDesktopWorldDevToolsStageSegmentIdentity {
    AOSDesktopWorldDevToolsStageSegmentIdentity(
        canvasGeneration: canvasGeneration,
        topologyGeneration: topologyGeneration,
        displayID: UInt32(index + 100),
        index: index,
        expectedIndexes: [0, 1]
    )
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
require(freshnessRegistry.recordStageSnapshot(
    stageSnapshot(),
    requestID: "unrelated-request",
    segment: segmentIdentity(0)
) == .rejected, "unknown request was accepted")
let unrelatedFreshness = freshnessRegistry.snapshot(sessionID: freshnessSession.id)!
let unrelatedFreshnessSession = unrelatedFreshness["session"] as! [String: Any]
require(unrelatedFreshnessSession["stageSnapshotReady"] as? Bool == false, "unrelated receipt satisfied headless freshness")
require(freshnessRegistry.recordStageSnapshot(
    stageSnapshot(),
    requestID: freshnessRequest,
    segment: segmentIdentity(0)
) == .pending, "primary correlated stage receipt did not remain pending")
let missingSegmentFreshness = freshnessRegistry.snapshot(sessionID: freshnessSession.id)!
let missingSegmentSession = missingSegmentFreshness["session"] as! [String: Any]
require(missingSegmentSession["stageSnapshotReady"] as? Bool == false, "partial display receipt satisfied freshness")
require(freshnessRegistry.recordStageSnapshot(
    stageSnapshot(),
    requestID: freshnessRequest,
    segment: segmentIdentity(0)
) == .rejected, "duplicate display receipt was accepted")
var aliasedDisplaySnapshot = stageSnapshot()
var aliasedPerformance = aliasedDisplaySnapshot["displayPerformance"] as! [[String: Any]]
aliasedPerformance[0]["displayId"] = "display-0"
aliasedDisplaySnapshot["displayPerformance"] = aliasedPerformance
require(freshnessRegistry.recordStageSnapshot(
    aliasedDisplaySnapshot,
    requestID: freshnessRequest,
    segment: segmentIdentity(0)
) == .rejected, "index-derived display alias was accepted as physical identity")
require(freshnessRegistry.recordStageSnapshot(
    stageSnapshot(),
    requestID: freshnessRequest,
    segment: segmentIdentity(0)
) == .pending, "replacement primary stage receipt did not remain pending")
require(freshnessRegistry.recordStageSnapshot(
    stageSnapshot(segmentIndex: 1),
    requestID: freshnessRequest,
    segment: segmentIdentity(1)
) == .committed, "secondary correlated stage receipt did not commit")
let completedFreshness = freshnessRegistry.snapshot(sessionID: freshnessSession.id)!
let completedFreshnessSession = completedFreshness["session"] as! [String: Any]
require(completedFreshnessSession["stageSnapshotReady"] as? Bool == true, "correlated receipt did not satisfy freshness")
_ = freshnessRegistry.close(sessionID: freshnessSession.id)

let topologyRequest = "topology-change-request"
let topologySession = created(freshnessRegistry.create(stageRequestID: topologyRequest))
require(freshnessRegistry.recordStageSnapshot(
    stageSnapshot(),
    requestID: topologyRequest,
    segment: segmentIdentity(0)
) == .pending, "pre-topology-change receipt did not remain pending")
require(freshnessRegistry.recordStageSnapshot(
    stageSnapshot(segmentIndex: 1, topologyGeneration: 5),
    requestID: topologyRequest,
    segment: segmentIdentity(1, topologyGeneration: 5)
) == .rejected, "topology change did not invalidate the partial receipt")
let topologyPending = freshnessRegistry.snapshot(sessionID: topologySession.id)!
let topologyPendingSession = topologyPending["session"] as! [String: Any]
require(topologyPendingSession["stageSnapshotReady"] as? Bool == false, "stale topology receipt satisfied freshness")
_ = freshnessRegistry.close(sessionID: topologySession.id)

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

var leaked = aggregateStageSnapshot()
leaked["transcript"] = "secret"
leaked["native"] = ["desktopFrameWarm": ["pixels": "secret"]]
require(registry.recordStageSnapshot(leaked) == .committed, "valid stage snapshot with unknown renderer field was rejected")
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
require(canonicalDisplay["bounds"] as? [Double] == [207.0, 0.0, 1512.0, 982.0], "DesktopWorld display bounds drifted")
require(canonicalDisplay["nativeBounds"] as? [Double] == [0.0, 0.0, 1512.0, 982.0], "native display bounds were lost")
require(canonicalDisplay["scaleFactor"] as? Double == 2.0, "native display scale was lost")
let canonicalNode = (canonicalWorld["nodes"] as! [[String: Any]])[0]
require(canonicalNode["parentId"] is NSNull, "canonical node omitted required null parentId")
let canonicalGesture = (canonicalWorld["gestures"] as! [[String: Any]])[0]
require(canonicalGesture["pointerSessionId"] is NSNull, "canonical gesture omitted required null pointerSessionId")
let canonicalResource = (stage["resources"] as! [[String: Any]])[0]
require(canonicalResource["errorCode"] is NSNull, "canonical resource omitted required null errorCode")
let canonicalInteraction = (stage["interactions"] as! [[String: Any]])[0]
require(canonicalInteraction["errorCode"] is NSNull, "canonical interaction omitted required null errorCode")
let canonicalDisplayPerformance = stage["displayPerformance"] as! [[String: Any]]
require(canonicalDisplayPerformance.count == 2, "per-display performance set was incomplete")
require(canonicalDisplayPerformance[0]["scope"] as? String == "stage-segment", "performance scope was lost")
let canonicalPerformance = canonicalDisplayPerformance[0]["performance"] as! [String: Any]
require(canonicalPerformance["avgGpuMs"] is NSNull, "canonical performance omitted a required null metric")
require(canonicalPerformance["backingWidth"] as? Double == 3_024.0, "backing width was lost")
require(canonicalPerformance["backingHeight"] as? Double == 1_964.0, "backing height was lost")
require(canonicalPerformance["damagedPixelPercentage"] as? Double == 12.5, "damage percentage was lost")
require(canonicalPerformance["avgDamagedPixelPercentage"] as? Double == 10.0, "average damage percentage was lost")
require(canonicalPerformance["effectiveDevicePixelRatio"] as? Double == 2.0, "effective DPR was lost")
require(canonicalPerformance["requestedDevicePixelRatio"] as? Double == 2.0, "requested DPR was lost")
require(canonicalPerformance["estimatedBackingBytes"] as? Double == 237_565_440.0, "backing byte estimate was lost")
require(canonicalPerformance["msaaSamples"] as? Double == 4.0, "MSAA sample count was lost")
let externalPerformance = canonicalDisplayPerformance[1]["performance"] as! [String: Any]
require(externalPerformance["drawCalls"] as? Double == 4.0, "external display draw calls were lost")
require(externalPerformance["triangles"] as? Double == 120.0, "external display triangles were lost")
let canonicalEvent = (stage["events"] as! [[String: Any]])[0]
require(canonicalEvent["resourceId"] is NSNull, "canonical event omitted required null resourceId")
require(canonicalEvent["code"] is NSNull, "canonical event omitted required null code")
let canonicalCounters = stage["counters"] as! [String: Any]
require(Set(canonicalCounters.keys) == Set(requiredStageCounterKeys), "canonical counters lost the full required key set")
for (key, value) in stageCounters() {
    require(canonicalCounters[key] as? Int == value, "canonical counter \(key) changed producer value")
}
require((canonical["contract"] as? String) == aosDesktopWorldDevToolsSnapshotContract, "session snapshot contract mismatch")
let selectedStage = registry.stageSnapshot(resourceID: "companion/main")!
let selectedResources = selectedStage["resources"] as! [[String: Any]]
require(selectedResources.count == 1 && selectedResources[0]["id"] as? String == "companion/main", "resource snapshot was not filtered")
require(registry.stageSnapshot(resourceID: "missing/resource") == nil, "missing resource snapshot did not fail closed")

require(registry.recordStageSnapshot(aggregateStageSnapshot()) == .committed, "repeated stage sequence was rejected")
let repeatedSnapshot = registry.snapshot(sessionID: first.id)!
require(repeatedSnapshot["stageSnapshotRevision"] as? Int == 2, "daemon receipt revision depended on stage-local sequence")

var oversized = aggregateStageSnapshot()
var world = oversized["world"] as! [String: Any]
world["nodes"] = Array(repeating: (world["nodes"] as! [[String: Any]])[0], count: 1_025)
oversized["world"] = world
require(registry.recordStageSnapshot(oversized) == .rejected, "oversized stage snapshot was accepted")

var oversizedError = aggregateStageSnapshot()
var resources = oversizedError["resources"] as! [[String: Any]]
resources[0]["errorCode"] = String(repeating: "x", count: 65)
oversizedError["resources"] = resources
require(registry.recordStageSnapshot(oversizedError) == .rejected, "oversized resource error code was accepted")

var emptyCounters = aggregateStageSnapshot()
emptyCounters["counters"] = [String: Int]()
require(registry.recordStageSnapshot(emptyCounters) == .rejected, "empty stage counters were accepted")

for missingKey in requiredStageCounterKeys {
    var missingCounter = aggregateStageSnapshot()
    var counters = stageCounters()
    counters.removeValue(forKey: missingKey)
    missingCounter["counters"] = counters
    require(
        registry.recordStageSnapshot(missingCounter) == .rejected,
        "stage counters missing \(missingKey) were accepted"
    )
}

var extraCounter = aggregateStageSnapshot()
var counters = stageCounters()
counters["unexpected"] = 0
extraCounter["counters"] = counters
require(registry.recordStageSnapshot(extraCounter) == .rejected, "extra stage counter was accepted")

var wrongTypeCounter = aggregateStageSnapshot()
var mixedCounters = stageCounters().reduce(into: [String: Any]()) { result, entry in
    result[entry.key] = entry.value
}
mixedCounters["displays"] = "2"
wrongTypeCounter["counters"] = mixedCounters
require(registry.recordStageSnapshot(wrongTypeCounter) == .rejected, "wrong-type stage counter was accepted")

var negativeCounter = aggregateStageSnapshot()
counters = stageCounters()
counters["errors"] = -1
negativeCounter["counters"] = counters
require(registry.recordStageSnapshot(negativeCounter) == .rejected, "negative stage counter was accepted")

var oversizedCounter = aggregateStageSnapshot()
counters = stageCounters()
counters["errors"] = 100_001
oversizedCounter["counters"] = counters
require(registry.recordStageSnapshot(oversizedCounter) == .rejected, "oversized stage counter was accepted")

var invalidMetric = aggregateStageSnapshot()
var displayPerformance = invalidMetric["displayPerformance"] as! [[String: Any]]
var performance = displayPerformance[0]["performance"] as! [String: Any]
performance["avgFrameMs"] = -1.0
displayPerformance[0]["performance"] = performance
invalidMetric["displayPerformance"] = displayPerformance
require(registry.recordStageSnapshot(invalidMetric) == .rejected, "negative performance metric was accepted")

var missingRequiredNull = aggregateStageSnapshot()
displayPerformance = missingRequiredNull["displayPerformance"] as! [[String: Any]]
performance = displayPerformance[0]["performance"] as! [String: Any]
performance.removeValue(forKey: "avgGpuMs")
displayPerformance[0]["performance"] = performance
missingRequiredNull["displayPerformance"] = displayPerformance
require(registry.recordStageSnapshot(missingRequiredNull) == .rejected, "missing required nullable metric was accepted")

var invalidDpr = aggregateStageSnapshot()
displayPerformance = invalidDpr["displayPerformance"] as! [[String: Any]]
performance = displayPerformance[0]["performance"] as! [String: Any]
performance["requestedDevicePixelRatio"] = 5.0
displayPerformance[0]["performance"] = performance
invalidDpr["displayPerformance"] = displayPerformance
require(registry.recordStageSnapshot(invalidDpr) == .rejected, "oversized requested DPR was accepted")

var invalidDisplayScale = aggregateStageSnapshot()
world = invalidDisplayScale["world"] as! [String: Any]
var displays = world["displays"] as! [[String: Any]]
displays[0]["scaleFactor"] = 0.0
world["displays"] = displays
invalidDisplayScale["world"] = world
require(registry.recordStageSnapshot(invalidDisplayScale) == .rejected, "zero display scale was accepted")

switch registry.close(sessionID: first.id, expectedRevision: updated.revision) {
case .success(let closed):
    require(closed.host == external, "closed session lost host cleanup identity")
    require(closed.ownedPanelIDs == [panel.id], "closed session lost suspended panel cleanup identity")
default: fatalError("session close failed")
}
require(registry.snapshot(sessionID: first.id) == nil, "closed session remained visible")
_ = registry.close(sessionID: second.id)
require(!registry.instrumentationConfiguration().enabled, "closing the final session did not disable instrumentation")

let fakeCanvas = CanvasManager()
fakeCanvas.canvasIDs = ["aos-desktop-world-stage", "fake-devtools-host"]
let ensureStageLock = NSLock()
var ensureStageCalls = 0
let controller = AOSDesktopWorldDevToolsController(
    canvasManager: fakeCanvas,
    sceneStageCanvasID: "aos-desktop-world-stage",
    ensureSceneStage: {
        ensureStageLock.lock()
        ensureStageCalls += 1
        ensureStageLock.unlock()
        return true
    },
    hasSceneMonitor: { true },
    resolveContentURL: { $0 }
)
let opened = controller.handleCommand(action: "scene-devtools-open", payload: [
    "host": ["kind": "external", "id": "fake-devtools-host"],
])
require(opened["status"] as? String == "ok", "controller fake host did not open")
let existingStageConfigurationLock = NSLock()
var existingStageConfigurationSettled = false
DispatchQueue.global(qos: .userInitiated).async {
    require(controller.configureStage(), "existing stage configuration failed")
    existingStageConfigurationLock.lock()
    existingStageConfigurationSettled = true
    existingStageConfigurationLock.unlock()
}
let existingStageConfigurationDeadline = Date().addingTimeInterval(2)
while Date() < existingStageConfigurationDeadline {
    existingStageConfigurationLock.lock()
    let settled = existingStageConfigurationSettled
    existingStageConfigurationLock.unlock()
    if settled { break }
    RunLoop.current.run(until: Date().addingTimeInterval(0.01))
}
existingStageConfigurationLock.lock()
let didSettleExistingStageConfiguration = existingStageConfigurationSettled
existingStageConfigurationLock.unlock()
require(
    didSettleExistingStageConfiguration,
    "existing stage configuration did not settle"
)
ensureStageLock.lock()
let observedEnsureStageCalls = ensureStageCalls
ensureStageLock.unlock()
require(
    observedEnsureStageCalls >= 2,
    "existing canvas bypassed the generation-bound readiness wait"
)

var monitorPublications: [[String: Any]] = []
func deliverControllerSnapshot(_ segmentIndex: Int, topologyGeneration: Int) -> AOSDesktopWorldDevToolsStageCommitResult {
    let result = controller.handleStageSnapshot([
        "canvas_generation": NSNumber(value: UInt64(3)),
        "topology_generation": NSNumber(value: UInt64(topologyGeneration)),
        "segment_display_id": NSNumber(value: UInt32(segmentIndex + 100)),
        "segment_index": NSNumber(value: segmentIndex),
        "snapshot": stageSnapshot(segmentIndex: segmentIndex, topologyGeneration: topologyGeneration),
    ])
    if result == .committed {
        monitorPublications.append(controller.stageSnapshot(resourceID: "companion/main")!)
    }
    return result
}

func deliverMalformedControllerIdentity(_ key: String, value: Any) -> AOSDesktopWorldDevToolsStageCommitResult {
    var payload: [String: Any] = [
        "canvas_generation": NSNumber(value: UInt64(3)),
        "topology_generation": NSNumber(value: UInt64(4)),
        "segment_display_id": NSNumber(value: UInt32(100)),
        "segment_index": NSNumber(value: 0),
        "snapshot": stageSnapshot(),
    ]
    payload[key] = value
    return controller.handleStageSnapshot(payload)
}

for key in ["canvas_generation", "topology_generation", "segment_display_id", "segment_index"] {
    require(
        deliverMalformedControllerIdentity(key, value: NSNumber(value: true)) == .rejected,
        "controller admitted Boolean \(key)"
    )
    require(
        deliverMalformedControllerIdentity(key, value: NSNumber(value: 1.5)) == .rejected,
        "controller admitted fractional \(key)"
    )
    require(
        deliverMalformedControllerIdentity(key, value: NSNumber(value: -1)) == .rejected,
        "controller admitted negative \(key)"
    )
}
require(
    deliverMalformedControllerIdentity(
        "canvas_generation",
        value: NSNumber(value: Double.greatestFiniteMagnitude)
    ) == .rejected,
    "controller admitted out-of-range canvas_generation"
)
require(
    deliverMalformedControllerIdentity(
        "topology_generation",
        value: NSNumber(value: Double.greatestFiniteMagnitude)
    ) == .rejected,
    "controller admitted out-of-range topology_generation"
)
require(
    deliverMalformedControllerIdentity(
        "segment_display_id",
        value: NSNumber(value: UInt64(UInt32.max) + 1)
    ) == .rejected,
    "controller admitted out-of-range segment_display_id"
)
require(
    deliverMalformedControllerIdentity("segment_index", value: NSNumber(value: 32)) == .rejected,
    "controller admitted out-of-range segment_index"
)

fakeCanvas.posts.removeAll()
require(deliverControllerSnapshot(0, topologyGeneration: 4) == .pending, "seed receipt did not remain pending")
require(deliverControllerSnapshot(1, topologyGeneration: 4) == .committed, "seed receipt did not commit")
fakeCanvas.posts.removeAll()
monitorPublications.removeAll()

fakeCanvas.topology = DesktopWorldSceneBarrierTopology(
    canvasGeneration: 3,
    generation: 5,
    segments: [
        DesktopWorldSurfaceSegment(displayID: 100, index: 0),
        DesktopWorldSurfaceSegment(displayID: 101, index: 1),
    ]
)
require(deliverControllerSnapshot(0, topologyGeneration: 5) == .pending, "N+1 first receipt did not remain pending")
let partialHostPublications = fakeCanvas.posts.filter { entry in
    let message = entry["message"] as? [String: Any]
    return message?["type"] as? String == "desktop_world_devtools.snapshot"
}
require(partialHostPublications.isEmpty, "N+1 partial receipt published to the host")
require(monitorPublications.isEmpty, "N+1 partial receipt published to the monitor")

require(deliverControllerSnapshot(1, topologyGeneration: 5) == .committed, "N+1 final receipt did not commit")
let completeHostPublications = fakeCanvas.posts.filter { entry in
    let message = entry["message"] as? [String: Any]
    return message?["type"] as? String == "desktop_world_devtools.snapshot"
}
require(completeHostPublications.count == 1, "N+1 complete receipt did not publish exactly once to the host")
require(monitorPublications.count == 1, "N+1 complete receipt did not publish exactly once to the monitor")
let monitorPerformance = monitorPublications[0]["displayPerformance"] as! [[String: Any]]
require(monitorPerformance.count == 2, "N+1 monitor publication was topology-incomplete")
require(Set(monitorPerformance.compactMap { $0["displayIndex"] as? Int }) == [0, 1], "N+1 monitor publication lost display identity")
print("PASS DesktopWorld DevTools daemon session")
SWIFT

CLANG_MODULE_CACHE_PATH="$TMP/cache" SWIFT_MODULECACHE_PATH="$TMP/cache" \
    swiftc \
      "$ROOT/src/daemon/desktop-world-devtools-native-stage-facts.swift" \
      "$ROOT/src/daemon/desktop-world-devtools-stage.swift" \
      "$ROOT/src/daemon/desktop-world-devtools-session.swift" \
      "$ROOT/src/daemon/desktop-world-devtools-controller.swift" \
      "$TMP/main.swift" -o "$TMP/test"
"$TMP/test"
