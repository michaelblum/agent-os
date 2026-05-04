# Wire side-eye `list` to Spatial Topology Schema — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `side-eye list` debug dump with structured output conforming to `spatial-topology.schema.json` v0.1.0 — making it the canonical spatial model producer for the agent-os ecosystem.

**Architecture:** In-place rewrite of `listCommand()` and its JSON structs in `main.swift`. New `ST*` Encodable structs match the schema exactly. Window enumeration via `CGWindowListCopyWindowInfo`, display enrichment (UUID, label, visible_bounds), focused window via `_AXUIElementGetWindow`, and app index from running applications. Single-file architecture preserved.

**Tech Stack:** Swift, CoreGraphics, AppKit, Accessibility APIs, ScreenCaptureKit (existing import, not used by list)

**Spec:** `docs/superpowers/specs/2026-03-26-wire-side-eye-topology-design.md`
**Schema:** `shared/schemas/spatial-topology.schema.json`

---

## File Map

All changes in one file:

- **Modify:** `packages/side-eye/main.swift`
  - Lines 7–21: Replace `DisplayJSON` and `TopologyJSON` with new `ST*` structs
  - Lines 1276–1290: Rewrite `listCommand()`
  - Lines 1203: Update help text for `list` command
  - Add `_AXUIElementGetWindow` declaration near other AX code

- **Modify:** `shared/schemas/spatial-topology.md`
  - Add layer filtering guidance and z-order note

---

### Task 1: Add ST* Encodable Structs

**Files:**
- Modify: `packages/side-eye/main.swift:7-21`

These structs are the data model for the new `list` output. They map 1:1 to the JSON Schema definitions. Add them **after** the existing `TopologyJSON` struct (line 21), before `CursorJSON` (line 23). We'll delete the old structs in a later task.

- [ ] **Step 1: Add the six new structs after line 21**

Insert after line 21 (`}` closing `TopologyJSON`) and before line 23 (`struct CursorJSON`):

```swift
// MARK: - Spatial Topology Output Models (spatial-topology.schema.json v0.1.0)

struct STBounds: Encodable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct STFocusedApp: Encodable {
    let pid: Int
    let name: String
    let bundle_id: String?
}

struct STWindow: Encodable {
    let window_id: Int
    let title: String?
    let app_pid: Int
    let app_name: String
    let bundle_id: String?
    let bounds: STBounds
    let is_focused: Bool
    let is_on_screen: Bool
    let layer: Int
    let alpha: Double
}

struct STDisplay: Encodable {
    let display_id: Int
    let display_uuid: String?
    let ordinal: Int
    let label: String
    let is_main: Bool
    let bounds: STBounds
    let visible_bounds: STBounds
    let scale_factor: Double
    let rotation: Double
    let windows: [STWindow]
}

struct STApp: Encodable {
    let pid: Int
    let name: String
    let bundle_id: String?
    let is_active: Bool
    let is_hidden: Bool
    let window_ids: [Int]
}

struct SpatialTopology: Encodable {
    let schema: String
    let version: String
    let timestamp: String
    let screens_have_separate_spaces: Bool
    let focused_window_id: Int?
    let focused_app: STFocusedApp?
    let displays: [STDisplay]
    let apps: [STApp]
}
```

- [ ] **Step 2: Build to verify compilation**

```bash
cd packages/side-eye && bash build.sh
```

Expected: `Compiling side-eye... Done: ./side-eye (...)` — no errors. The new structs are defined but not yet used.

- [ ] **Step 3: Commit**

```bash
git add packages/side-eye/main.swift
git commit -m "feat(side-eye): add ST* structs for spatial-topology schema v0.1.0"
```

---

### Task 2: Add Focused Window Helper

**Files:**
- Modify: `packages/side-eye/main.swift` (near line 185, after `checkAccessibilityPermission()`)

The `_AXUIElementGetWindow` private API bridges an AXUIElement to a CGWindowID. We wrap the full focused-window lookup sequence in a helper that returns nil on any failure.

- [ ] **Step 1: Add the private API declaration and helper function**

Insert after the `checkAccessibilityPermission()` function (after line 184):

```swift
// MARK: - Focused Window (Private AX Bridge)

@_silgen_name("_AXUIElementGetWindow")
func _AXUIElementGetWindow(_ element: AXUIElement, _ windowID: UnsafeMutablePointer<CGWindowID>) -> AXError

/// Returns the CGWindowID of the currently focused window, or nil if unavailable.
/// Requires Accessibility permission. Does NOT exit on failure — returns nil instead.
func getFocusedWindowID() -> CGWindowID? {
    guard AXIsProcessTrusted() else { return nil }
    guard let frontApp = NSWorkspace.shared.frontmostApplication else { return nil }

    let appElement = AXUIElementCreateApplication(frontApp.processIdentifier)
    var value: AnyObject?
    let result = AXUIElementCopyAttributeValue(appElement, kAXFocusedWindowAttribute as CFString, &value)
    guard result == .success, let windowElement = value else { return nil }

    var windowID: CGWindowID = 0
    let axResult = _AXUIElementGetWindow(windowElement as! AXUIElement, &windowID)
    guard axResult == .success, windowID != 0 else { return nil }

    return windowID
}
```

- [ ] **Step 2: Build to verify compilation**

```bash
cd packages/side-eye && bash build.sh
```

Expected: Compiles clean. The `@_silgen_name` declaration links at runtime, not compile time, so no linker errors.

- [ ] **Step 3: Commit**

```bash
git add packages/side-eye/main.swift
git commit -m "feat(side-eye): add getFocusedWindowID() via _AXUIElementGetWindow bridge"
```

---

### Task 3: Rewrite listCommand()

**Files:**
- Modify: `packages/side-eye/main.swift:1276-1290`

This is the core change. The new `listCommand()` does the full pipeline: display enrichment, window enumeration + filtering, display assignment, app index, focused window, and assembly into `SpatialTopology`.

- [ ] **Step 1: Replace the listCommand() function body**

Replace lines 1276–1290 (the entire `listCommand()` function, from `// MARK: - Command: list` through the closing `}`) with:

```swift
// MARK: - Command: list

@available(macOS 14.0, *)
func listCommand() {
    let displays = getDisplays()

    // -- NSScreen map for display enrichment (UUID, label, visible_bounds) --
    var screenMap: [CGDirectDisplayID: NSScreen] = [:]
    for screen in NSScreen.screens {
        if let n = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID {
            screenMap[n] = screen
        }
    }

    // -- Running apps lookup: pid → (name, bundleId, isHidden) --
    var appLookup: [pid_t: (name: String, bundleId: String?, isHidden: Bool)] = [:]
    for app in NSWorkspace.shared.runningApplications where app.activationPolicy == .regular {
        appLookup[app.processIdentifier] = (
            name: app.localizedName ?? "Unknown",
            bundleId: app.bundleIdentifier,
            isHidden: app.isHidden
        )
    }

    // -- Focused app + window --
    let frontApp = NSWorkspace.shared.frontmostApplication
    let focusedWindowID = getFocusedWindowID()

    let focusedApp: STFocusedApp? = frontApp.map {
        STFocusedApp(pid: Int($0.processIdentifier), name: $0.localizedName ?? "Unknown", bundle_id: $0.bundleIdentifier)
    }

    // -- Window enumeration + filtering --
    let windowInfoList = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] ?? []

    struct RawWindow {
        let windowID: Int
        let title: String?
        let pid: pid_t
        let appName: String
        let bundleID: String?
        let bounds: CGRect
        let layer: Int
        let alpha: Double
        let isOnScreen: Bool
    }

    var rawWindows: [RawWindow] = []
    for info in windowInfoList {
        // Filter: must be on screen
        guard let isOnScreen = info[kCGWindowIsOnscreen as String] as? Bool, isOnScreen else { continue }
        // Filter: must have bounds
        guard let boundsDict = info[kCGWindowBounds as String] as? [String: Any],
              let rect = CGRect(dictionaryRepresentation: boundsDict as CFDictionary) else { continue }
        // Filter: skip zero-size
        guard rect.width > 0 && rect.height > 0 else { continue }
        // Filter: skip Window Server
        let ownerName = info[kCGWindowOwnerName as String] as? String ?? ""
        guard ownerName != "Window Server" else { continue }

        let windowID = info[kCGWindowNumber as String] as? Int ?? 0
        let pid = info[kCGWindowOwnerPID as String] as? pid_t ?? 0
        let title = info[kCGWindowName as String] as? String
        let layer = info[kCGWindowLayer as String] as? Int ?? 0
        let alpha = info[kCGWindowAlpha as String] as? Double ?? 1.0
        let bundleID = appLookup[pid]?.bundleId

        rawWindows.append(RawWindow(
            windowID: windowID, title: title, pid: pid, appName: ownerName,
            bundleID: bundleID, bounds: rect, layer: layer, alpha: alpha, isOnScreen: isOnScreen
        ))
    }

    // -- Assign windows to displays by center hit-test --
    // Key: display cgID → [STWindow] (preserving CGWindowList front-to-back order)
    var windowsByDisplay: [CGDirectDisplayID: [STWindow]] = [:]
    for d in displays { windowsByDisplay[d.cgID] = [] }

    for raw in rawWindows {
        let center = CGPoint(x: raw.bounds.midX, y: raw.bounds.midY)
        let targetDisplay = displays.first(where: { $0.bounds.contains(center) }) ?? displays.first(where: { $0.isMain })!

        let stWindow = STWindow(
            window_id: raw.windowID,
            title: raw.title,
            app_pid: Int(raw.pid),
            app_name: raw.appName,
            bundle_id: raw.bundleID,
            bounds: STBounds(x: raw.bounds.origin.x, y: raw.bounds.origin.y,
                             width: raw.bounds.width, height: raw.bounds.height),
            is_focused: focusedWindowID != nil && raw.windowID == Int(focusedWindowID!),
            is_on_screen: raw.isOnScreen,
            layer: raw.layer,
            alpha: raw.alpha
        )
        windowsByDisplay[targetDisplay.cgID, default: []].append(stWindow)
    }

    // -- Build STDisplay array --
    let stDisplays: [STDisplay] = displays.map { d in
        // Display UUID (CGDisplayCreateUUIDFromDisplayID is a Create function → returns managed CFUUID?)
        let uuid: String? = {
            guard let cfUUID = CGDisplayCreateUUIDFromDisplayID(d.cgID) else { return nil }
            return CFUUIDCreateString(nil, cfUUID) as String
        }()

        // Label from NSScreen
        let label: String = screenMap[d.cgID]?.localizedName ?? "Display \(d.ordinal)"

        // Visible bounds (flip AppKit bottom-left → CG top-left)
        let visibleBounds: STBounds = {
            guard let screen = screenMap[d.cgID] else {
                return STBounds(x: d.bounds.origin.x, y: d.bounds.origin.y,
                                width: d.bounds.width, height: d.bounds.height)
            }
            let sf = screen.frame
            let vf = screen.visibleFrame
            let localX = vf.origin.x - sf.origin.x
            let localY = sf.height - (vf.origin.y - sf.origin.y) - vf.height
            return STBounds(
                x: d.bounds.origin.x + localX,
                y: d.bounds.origin.y + localY,
                width: vf.width,
                height: vf.height
            )
        }()

        return STDisplay(
            display_id: Int(d.cgID),
            display_uuid: uuid,
            ordinal: d.ordinal,
            label: label,
            is_main: d.isMain,
            bounds: STBounds(x: d.bounds.origin.x, y: d.bounds.origin.y,
                             width: d.bounds.width, height: d.bounds.height),
            visible_bounds: visibleBounds,
            scale_factor: d.scaleFactor,
            rotation: d.rotation,
            windows: windowsByDisplay[d.cgID] ?? []
        )
    }

    // -- Build apps[] index --
    var appWindows: [pid_t: [Int]] = [:]  // pid → [windowIDs]
    var appNames: [pid_t: (name: String, bundleId: String?)] = [:]
    for raw in rawWindows {
        appWindows[raw.pid, default: []].append(raw.windowID)
        if appNames[raw.pid] == nil {
            appNames[raw.pid] = (name: raw.appName, bundleId: raw.bundleID)
        }
    }

    let activePID = frontApp?.processIdentifier ?? -1
    let stApps: [STApp] = appWindows.keys.sorted(by: {
        (appNames[$0]?.name ?? "") < (appNames[$1]?.name ?? "")
    }).map { pid in
        STApp(
            pid: Int(pid),
            name: appNames[pid]?.name ?? "Unknown",
            bundle_id: appNames[pid]?.bundleId,
            is_active: pid == activePID,
            is_hidden: appLookup[pid]?.isHidden ?? false,
            window_ids: appWindows[pid] ?? []
        )
    }

    // -- Assemble and print --
    let iso8601 = ISO8601DateFormatter()
    iso8601.formatOptions = [.withInternetDateTime]

    let topology = SpatialTopology(
        schema: "spatial-topology",
        version: "0.1.0",
        timestamp: iso8601.string(from: Date()),
        screens_have_separate_spaces: NSScreen.screensHaveSeparateSpaces,
        focused_window_id: focusedWindowID.map { Int($0) },
        focused_app: focusedApp,
        displays: stDisplays,
        apps: stApps
    )
    print(jsonString(topology))
}
```

- [ ] **Step 2: Build to verify compilation**

```bash
cd packages/side-eye && bash build.sh
```

Expected: Compiles clean. Both old and new structs exist; old ones are now unused but that's not a compile error.

- [ ] **Step 3: Commit**

```bash
git add packages/side-eye/main.swift
git commit -m "feat(side-eye): rewrite listCommand() to emit spatial-topology schema"
```

---

### Task 4: Delete Old Structs and Update Help Text

**Files:**
- Modify: `packages/side-eye/main.swift:9-21` (delete old structs)
- Modify: `packages/side-eye/main.swift:~1203` (update help text)

- [ ] **Step 1: Delete `DisplayJSON` and `TopologyJSON` structs**

Remove lines 9–21 (the `DisplayJSON` and `TopologyJSON` struct definitions). Keep the `// MARK: - JSON Output Models` comment — the `ST*` structs section follows it.

The deleted code:

```swift
struct DisplayJSON: Encodable {
    let id: Int
    let type: String
    let resolution: String
    let scale_factor: Double
    let rotation: Double
    let arrangement: String
}

struct TopologyJSON: Encodable {
    let active_app: String
    let displays: [DisplayJSON]
}
```

- [ ] **Step 2: Update the help text for the list command**

In the `printUsage()` function, find this line:

```
      side-eye list                              Display topology as JSON
```

Replace with:

```
      side-eye list                              Spatial topology (displays + windows + apps)
```

- [ ] **Step 3: Build to verify compilation**

```bash
cd packages/side-eye && bash build.sh
```

Expected: Compiles clean. No references to the deleted structs remain (the old `listCommand()` was already replaced in Task 3).

- [ ] **Step 4: Commit**

```bash
git add packages/side-eye/main.swift
git commit -m "refactor(side-eye): remove old TopologyJSON/DisplayJSON, update help text"
```

---

### Task 5: Build, Run, and Validate Output

**Files:** None modified — this is a validation task.

- [ ] **Step 1: Build side-eye**

```bash
cd packages/side-eye && bash build.sh
```

- [ ] **Step 2: Run `side-eye list` and capture output**

```bash
cd packages/side-eye && ./side-eye list > /tmp/topology-output.json 2>&1
```

- [ ] **Step 3: Verify the output has the correct top-level shape**

Check that the JSON has all required root fields:

```bash
cat /tmp/topology-output.json | python3 -c "
import json, sys
d = json.load(sys.stdin)
assert d['schema'] == 'spatial-topology', f'bad schema: {d.get(\"schema\")}'
assert d['version'] == '0.1.0', f'bad version: {d.get(\"version\")}'
assert 'timestamp' in d, 'missing timestamp'
assert isinstance(d['screens_have_separate_spaces'], bool), 'bad screens_have_separate_spaces'
assert isinstance(d['displays'], list) and len(d['displays']) > 0, 'no displays'
assert isinstance(d['apps'], list), 'missing apps'
print(f'OK: {len(d[\"displays\"])} displays, {len(d[\"apps\"])} apps')
print(f'focused_window_id: {d.get(\"focused_window_id\")}')
print(f'focused_app: {d.get(\"focused_app\", {}).get(\"name\", \"null\")}')
for disp in d['displays']:
    print(f'  Display {disp[\"ordinal\"]}: {disp[\"label\"]} ({disp[\"is_main\"]}) — {len(disp[\"windows\"])} windows')
"
```

Expected: Prints display count, app count, focused window info, and per-display window counts. No assertion errors.

- [ ] **Step 4: Validate against the JSON Schema**

```bash
pip3 install jsonschema 2>/dev/null; python3 -c "
import json
from jsonschema import validate
with open('/tmp/topology-output.json') as f: instance = json.load(f)
with open('shared/schemas/spatial-topology.schema.json') as f: schema = json.load(f)
validate(instance=instance, schema=schema)
print('Schema validation PASSED')
"
```

Expected: `Schema validation PASSED`. If it fails, the error message will identify exactly which field is wrong — fix the corresponding struct or encoding in `main.swift`.

- [ ] **Step 5: Spot-check key fields**

```bash
cat /tmp/topology-output.json | python3 -c "
import json, sys
d = json.load(sys.stdin)
disp = d['displays'][0]
# display_id should be a positive integer (CGDirectDisplayID)
assert isinstance(disp['display_id'], int) and disp['display_id'] > 0, f'bad display_id: {disp[\"display_id\"]}'
# bounds should have x, y, width, height as numbers
b = disp['bounds']
assert all(isinstance(b[k], (int, float)) for k in ['x','y','width','height']), f'bad bounds: {b}'
# visible_bounds should differ from bounds (menu bar + dock)
vb = disp['visible_bounds']
assert vb['y'] >= b['y'], f'visible_bounds.y ({vb[\"y\"]}) < bounds.y ({b[\"y\"]})'
assert vb['height'] <= b['height'], f'visible_bounds.height ({vb[\"height\"]}) > bounds.height ({b[\"height\"]})'
# windows should have required fields
if disp['windows']:
    w = disp['windows'][0]
    assert 'window_id' in w and 'app_pid' in w and 'bounds' in w and 'layer' in w
    print(f'First window: {w.get(\"app_name\", \"?\")} — \"{w.get(\"title\", \"\")}\" (layer {w[\"layer\"]})')
# apps should have required fields
if d['apps']:
    a = d['apps'][0]
    assert 'pid' in a and 'name' in a and 'window_ids' in a
    print(f'First app: {a[\"name\"]} (pid {a[\"pid\"]}, {len(a[\"window_ids\"])} windows)')
print('Spot checks PASSED')
"
```

Expected: `Spot checks PASSED` with sample window and app info printed.

---

### Task 6: Update Schema Docs

**Files:**
- Modify: `shared/schemas/spatial-topology.md`

- [ ] **Step 1: Add layer filtering guidance**

In `shared/schemas/spatial-topology.md`, find the section `## Key Design Decisions` and add the following after the paragraph about "Array order = z-order":

```markdown
**Layer filtering is the consumer's job.** All windows visible on screen are included regardless of layer. Layer 0 = normal application windows. Layer > 0 = system overlays, floating panels, PiP windows. Most agents should start by filtering to layer 0 and expand as needed. The full set is provided so agents can reason about floating UI when necessary.
```

- [ ] **Step 2: Add explicit z-order documentation**

In the same section, find the existing paragraph about array order and replace:

```markdown
**Array order = z-order.** Windows in each display's `windows[]` are ordered front-to-back. Index 0 is the frontmost window. This is derived from `CGWindowListCopyWindowInfo` ordering.
```

With:

```markdown
**Array order = z-order.** Windows in each display's `windows[]` are ordered front-to-back. Index 0 is the frontmost window on that display. This is derived from `CGWindowListCopyWindowInfo` ordering. There is no explicit `z_index` field — array position is the single source of truth for stacking order.
```

- [ ] **Step 3: Commit**

```bash
git add shared/schemas/spatial-topology.md
git commit -m "docs: add layer filtering guidance and z-order note to spatial-topology docs"
```

---

### Task 7: Final Commit and Cleanup

- [ ] **Step 1: Check for any unstaged changes**

```bash
git status
```

If there are unstaged changes in `main.swift` from validation fixes, stage and commit them:

```bash
git add packages/side-eye/main.swift
git commit -m "fix(side-eye): address validation issues in spatial topology output"
```

- [ ] **Step 2: Verify clean state**

```bash
cd packages/side-eye && bash build.sh && ./side-eye list | python3 -c "
import json, sys
from jsonschema import validate
instance = json.load(sys.stdin)
with open('../../shared/schemas/spatial-topology.schema.json') as f: schema = json.load(f)
validate(instance=instance, schema=schema)
print('Final validation PASSED')
print(json.dumps(instance, indent=2)[:500] + '...')
"
```

Expected: `Final validation PASSED` followed by a preview of the output.
