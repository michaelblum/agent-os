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
                "nativeBounds": [0.0, 0.0, 1440.0, 900.0],
            ]],
            "nodes": [["id": "body", "resourceId": "companion/main", "parentId": NSNull(), "kind": "mesh", "implementation": "aos.scene.geometry.primitive", "position": [100.0, 200.0, 0.0], "visible": true]],
            "hitRegions": [], "affordances": [], "gestures": [], "routes": [],
        ],
        "resources": [[
            "id": "companion/main", "owner": "example.consumer", "sceneId": "scene", "revision": 1,
            "suspended": false, "objectCount": 1, "descriptorCount": 2, "animationCount": 1,
            "signalCount": 1, "interactionCount": 0, "implementations": ["aos.scene.geometry.primitive"],
            "allocations": ["geometries": 1, "materials": 1, "textures": 0, "programs": 1],
            "lifecycle": "active", "errorCode": NSNull(),
        ]],
        "interactions": [],
        "performance": [
            "enabled": true, "recording": false, "sampleCount": 1,
            "currentFps": 60.0, "p95FrameMs": 16.0, "avgFrameMs": 16.0,
            "avgRenderMs": 4.0, "avgUpdateMs": 2.0, "avgGpuMs": NSNull(),
            "drawCalls": 4.0, "triangles": 120.0, "geometries": 1.0, "textures": 0.0,
            "programs": 1.0, "backingPixels": 1_296_000.0, "state": "stable",
        ],
        "counters": [
            "displays": 1, "resources": 1, "nodes": 1, "hitRegions": 0,
            "affordances": 0, "activeGestures": 0, "activeRoutes": 0, "errors": 0,
        ],
        "events": [["sequence": 1, "kind": "scene.mount", "resourceId": "companion/main", "code": NSNull(), "at": 100.0]],
        "lastError": NSNull(),
    ]
}

let registry = AOSDesktopWorldDevToolsSessionRegistry()
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
require(registry.recordStageSnapshot(leaked), "valid stage snapshot with unknown renderer field was rejected")
let canonical = registry.snapshot(sessionID: first.id)!
let stage = canonical["stage"] as! [String: Any]
require(stage["transcript"] == nil, "unknown renderer content crossed the daemon boundary")
let canonicalWorld = stage["world"] as! [String: Any]
let canonicalDisplay = (canonicalWorld["displays"] as! [[String: Any]])[0]
require(canonicalDisplay["bounds"] as? [Double] == [200.0, 0.0, 1440.0, 900.0], "DesktopWorld display bounds drifted")
require(canonicalDisplay["nativeBounds"] as? [Double] == [0.0, 0.0, 1440.0, 900.0], "native display bounds were lost")
require((canonical["contract"] as? String) == aosDesktopWorldDevToolsSnapshotContract, "session snapshot contract mismatch")
let selectedStage = registry.stageSnapshot(resourceID: "companion/main")!
let selectedResources = selectedStage["resources"] as! [[String: Any]]
require(selectedResources.count == 1 && selectedResources[0]["id"] as? String == "companion/main", "resource snapshot was not filtered")
require(registry.stageSnapshot(resourceID: "missing/resource") == nil, "missing resource snapshot did not fail closed")

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
    swiftc "$ROOT/src/daemon/desktop-world-devtools-session.swift" "$TMP/main.swift" -o "$TMP/test"
"$TMP/test"
