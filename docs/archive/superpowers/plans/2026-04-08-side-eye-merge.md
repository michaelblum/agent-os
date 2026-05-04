# Merge side-eye into aos unified binary — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Absorb the side-eye screenshot/perception CLI into the aos unified binary, eliminating ~350 lines of duplication, removing the fragile binary resolution path, and making packaging trivial (one binary = done).

**Architecture:** side-eye's 6 source files become 3 new files under `src/perceive/` (capture pipeline, spatial model, focus commands). Duplicate AX helpers, window filtering, IPC, and protocol types are deleted in favor of what aos already has. side-eye's standalone daemon becomes a module within the unified daemon. The `capture` subcommand runs in-process instead of shelling out to a sub-binary.

**Tech Stack:** Swift, ScreenCaptureKit, CoreText, UniformTypeIdentifiers (new imports for aos), AppKit/CoreGraphics (existing)

---

## File Structure

### New files (from side-eye → aos)

| New file | Source | Responsibility |
|----------|--------|----------------|
| `src/perceive/capture-pipeline.swift` | `main.swift` lines 1–693, 810–2182 | Capture pipeline: option parsing, ScreenCaptureKit capture, crop, overlays, grid, encode, output. Stripped of duplicate AX helpers and entry point. |
| `src/perceive/spatial.swift` | `spatial.swift` all, minus duplicate AX/window code | SpatialModel: channel registry, polling loop, channel file writer. Uses aos `axString`/`axBounds`/`axChildren` instead of `ch`-prefixed copies. |
| `src/perceive/focus-commands.swift` | `client.swift` all | CLI commands for `aos focus create/update/list/remove`, `aos graph displays/windows/deepen/collapse`, `aos daemon-snapshot`. Talks to unified daemon in-process (no socket client needed). |

### Modified files

| File | Changes |
|------|---------|
| `src/main.swift` | Add subcommand routing for `focus`, `graph`, `daemon-snapshot`, `selection`. Change `capture` to call in-process pipeline instead of shelling out. |
| `src/perceive/capture.swift` | Delete entirely (was the thin subprocess wrapper for side-eye). |
| `src/perceive/ax.swift` | Add `axFrame()` alias (same as `axBounds` but naming consistency with side-eye callers). Add `traverseAXElements()` from side-eye main.swift. Add `xrayWhitelistRoles` constant. |
| `src/perceive/models.swift` | Add side-eye's output models (`STBounds`, `STDisplay`, `STWindow`, `STApp`, `STCursor`, `SpatialTopology`, `CursorWindowJSON`, etc.) and `enumerateWindows()` from `enumerate-windows.swift`. |
| `src/display/channel.swift` | Keep as canonical channel types. No changes needed — side-eye's `protocol.swift` types match. |
| `src/daemon/unified.swift` | Wire SpatialModel as a new module (like perception, canvasManager). Route focus/graph daemon actions. |
| `build.sh` | Remove `side-eye` binary resolution. Add ScreenCaptureKit, CoreText, UniformTypeIdentifiers framework flags if needed (swiftc usually auto-links). |

### Deleted files

| File | Reason |
|------|--------|
| `src/perceive/capture.swift` | Replaced by in-process `capture-pipeline.swift` |
| `packages/side-eye/` (all 6 files) | Absorbed. Keep directory with a `MOVED.md` pointer for a few releases. |

---

## Shared utilities to extract (DRY)

Before the main merge tasks, extract these shared helpers that both side-eye and aos duplicate:

```swift
// In src/perceive/ax.swift (already exists, add to it):
func axFrame(_ element: AXUIElement) -> CGRect?  // alias for axBounds, name used by side-eye callers

// In src/perceive/models.swift (already exists, add to it):
func isVisibleWindow(_ info: [String: Any]) -> Bool  // layer==0, alpha>0, not Window Server
func buildAppLookup() -> [pid_t: (name: String, bundleID: String?, isHidden: Bool)]
func parseSubtreeArgs(_ args: [String]) -> ChannelSubtree?
```

---

### Task 1: Extract shared window utilities into perceive/models.swift

**Files:**
- Modify: `src/perceive/models.swift`
- Test: manual — `bash build.sh` must compile, `./aos doctor --json` must still work

- [ ] **Step 1: Add isVisibleWindow filter**

```swift
// Add to src/perceive/models.swift

/// Filter predicate for visible, user-facing windows from CGWindowList.
/// Excludes Window Server, hidden windows, and non-layer-0 windows.
func isVisibleWindow(_ info: [String: Any]) -> Bool {
    let layer = info[kCGWindowLayer as String] as? Int ?? -1
    guard layer == 0 else { return false }
    let alpha = info[kCGWindowAlpha as String] as? Double ?? 1.0
    guard alpha > 0 else { return false }
    let owner = info[kCGWindowOwnerName as String] as? String ?? ""
    guard owner != "Window Server" else { return false }
    return true
}
```

- [ ] **Step 2: Add buildAppLookup utility**

```swift
// Add to src/perceive/models.swift

/// Build a PID-indexed lookup of running GUI applications.
func buildAppLookup() -> [pid_t: (name: String, bundleID: String?, isHidden: Bool)] {
    var lookup: [pid_t: (name: String, bundleID: String?, isHidden: Bool)] = [:]
    for app in NSWorkspace.shared.runningApplications where app.activationPolicy == .regular {
        lookup[app.processIdentifier] = (
            name: app.localizedName ?? "Unknown",
            bundleID: app.bundleIdentifier,
            isHidden: app.isHidden
        )
    }
    return lookup
}
```

- [ ] **Step 3: Add axFrame alias and traversal to ax.swift**

```swift
// Add to src/perceive/ax.swift

/// Alias for axBounds — used by capture pipeline code that calls it axFrame.
func axFrame(_ element: AXUIElement) -> CGRect? { axBounds(element) }

/// Roles considered actionable for agent consumption (--xray, channel traversal).
let xrayWhitelistRoles: Set<String> = [
    "AXButton", "AXTextField", "AXTextArea", "AXCheckBox",
    "AXRadioButton", "AXPopUpButton", "AXComboBox", "AXMenuItem",
    "AXMenuBarItem", "AXLink", "AXSlider", "AXIncrementor",
    "AXColorWell", "AXDisclosureTriangle", "AXTab", "AXStaticText",
    "AXSwitch", "AXToggle", "AXSearchField", "AXSecureTextField"
]
```

- [ ] **Step 4: Build and verify**

Run: `bash build.sh`
Expected: compiles with no new errors, daemon restarts

- [ ] **Step 5: Commit**

```
git add src/perceive/models.swift src/perceive/ax.swift
git commit -m "refactor: extract shared window/AX utilities for side-eye merge"
```

---

### Task 2: Port capture pipeline (main.swift → capture-pipeline.swift)

This is the biggest task — ~2,000 lines. The key changes: remove duplicate AX helpers (use `axString`/`axBounds`/`axFrame` from ax.swift), remove the `@main` entry point, and expose `captureCommand()` and `listCommand()` as public functions callable from aos's main.swift.

**Files:**
- Create: `src/perceive/capture-pipeline.swift`
- Modify: `src/main.swift` (add routing)
- Delete: `src/perceive/capture.swift` (old subprocess wrapper)
- Test: `./aos see capture main --out /tmp/test.png` must produce a screenshot

- [ ] **Step 1: Copy main.swift to capture-pipeline.swift, strip duplicates**

Copy `packages/side-eye/main.swift` to `src/perceive/capture-pipeline.swift`. Then:

1. Remove the `@main struct SideEye` entry point (lines 2190–2283) — aos has its own
2. Remove the duplicate `axString`, `axBool`, `axFrame` private functions (lines 706–733) — use ax.swift's public versions
3. Remove `import ScreenCaptureKit`, `import UniformTypeIdentifiers`, `import CoreText` — move to file top (they stay, just verify no collision)
4. Remove the `exitError` function if side-eye defines its own — use aos's shared version
5. Keep all public functions: `captureCommand()`, `listCommand()`, `cursorCommand()`, `selectionCommand()`, `zoneCommand()`, `traverseAXElements()`, `xrayApp()`
6. Keep all models (STBounds, STDisplay, etc.) — move these to models.swift in Task 3

- [ ] **Step 2: Move output models to perceive/models.swift**

Move these structs from capture-pipeline.swift to `src/perceive/models.swift`:
- `STBounds`, `STFocusedApp`, `STWindow`, `STDisplay`, `STApp`, `STCursor`, `SpatialTopology`
- `CursorJSON`, `CursorPointJSON`, `CursorWindowJSON`, `CursorElementJSON`, `CursorResponse`
- `AXElementJSON`, `BoundsJSON`
- `SelectionResponse`
- `CaptureWindowJSON`, `SuccessResponse`
- `CoordinateMapper`

This keeps capture-pipeline.swift focused on the pipeline logic, not type definitions.

- [ ] **Step 3: Move traverseAXElements to ax.swift**

Move `traverseAXElements()` and `xrayApp()` from capture-pipeline.swift to `src/perceive/ax.swift`. They're general-purpose AX utilities, not capture-specific.

- [ ] **Step 4: Update main.swift routing**

In `src/main.swift`, find where `see capture` is routed and replace the subprocess delegation with a direct call:

```swift
// Replace:
//   seeCaptureCommand(args: captureArgs)
// With:
//   captureCommand(args: captureArgs)  // now in-process

// Also add new top-level commands:
case "list":
    listCommand()
case "cursor":
    // side-eye's cursor command (richer than aos see cursor)
    // Decide: merge with existing cursorCommand or keep side-eye's version
case "selection":
    selectionCommand()
```

- [ ] **Step 5: Delete old capture.swift**

```
git rm src/perceive/capture.swift
```

- [ ] **Step 6: Build and test capture**

Run: `bash build.sh`
Then: `./aos see capture main --out /tmp/test-merge.png`
Expected: screenshot produced, JSON output to stdout

Also test: `./aos see capture main --base64 --format jpg | head -c 100`
Expected: starts with `{"status":"success","base64":["`

- [ ] **Step 7: Commit**

```
git add src/perceive/capture-pipeline.swift src/perceive/models.swift src/perceive/ax.swift src/main.swift
git rm src/perceive/capture.swift
git commit -m "feat: port side-eye capture pipeline into aos unified binary"
```

---

### Task 3: Port spatial model (spatial.swift → perceive/spatial.swift)

**Files:**
- Create: `src/perceive/spatial.swift`
- Test: `bash build.sh` must compile

- [ ] **Step 1: Copy spatial.swift, remove duplicates**

Copy `packages/side-eye/spatial.swift` to `src/perceive/spatial.swift`. Then:

1. Remove `chAxString`, `chAxBool`, `chAxFrame` (lines 638–672) — use `axString`, `axBool`, `axFrame` from ax.swift
2. Remove `kChannelInteractiveRoles` (lines 628–635) — use `xrayWhitelistRoles` from ax.swift
3. Remove duplicate `windowBoundsForID` (lines 527–536) — inline callers to use `windowInfoForID` instead
4. Replace inline window filtering (lines 223–240) with `isVisibleWindow()` from models.swift
5. Replace inline app lookup (if any) with `buildAppLookup()` from models.swift
6. Remove side-eye's `ChannelSubtree`, `ChannelBounds`, `ChannelElement`, `ChannelTarget`, `ChannelFile` — use aos's types from `display/channel.swift`. Adapt field names if they differ slightly.
7. Change channel file output to use aos's `ChannelData` type instead of side-eye's `ChannelFile`

- [ ] **Step 2: Build and verify**

Run: `bash build.sh`
Expected: compiles, no errors

- [ ] **Step 3: Commit**

```
git add src/perceive/spatial.swift
git commit -m "feat: port side-eye spatial model into aos perceive module"
```

---

### Task 4: Port focus/graph commands (client.swift → focus-commands.swift)

**Files:**
- Create: `src/perceive/focus-commands.swift`
- Modify: `src/main.swift` (add routing)
- Modify: `src/daemon/unified.swift` (add spatial model + routing)
- Test: `./aos focus list`, `./aos graph displays`, `./aos graph windows`

- [ ] **Step 1: Write focus-commands.swift**

These commands previously talked to side-eye's daemon via a socket client. Now they talk to the unified daemon. Two modes:

**If daemon is running (connected via socket):** Send requests through the existing aos daemon connection (DaemonSession from shared/swift/ipc/).

**If no daemon (one-shot):** For `graph displays` and `graph windows`, can run in-process without a daemon. For `focus` commands, require the daemon.

Rewrite `client.swift` commands to use `daemonOneShot()` from `shared/swift/ipc/request-client.swift` instead of side-eye's `SideEyeClient`. Extract `parseSubtreeArgs()` to eliminate the 3x copy-paste.

```swift
// src/perceive/focus-commands.swift

import Foundation

/// Parse --subtree-role, --subtree-title, --subtree-identifier from args.
func parseSubtreeArgs(_ args: [String]) -> ChannelSubtree? {
    func getArg(_ flag: String) -> String? {
        guard let idx = args.firstIndex(of: flag), idx + 1 < args.count else { return nil }
        return args[idx + 1]
    }
    let role = getArg("--subtree-role")
    let title = getArg("--subtree-title")
    let ident = getArg("--subtree-identifier")
    guard role != nil || title != nil || ident != nil else { return nil }
    return ChannelSubtree(role: role, title: title, identifier: ident)
}

// Then: focusCreateCommand, focusUpdateCommand, focusListCommand, focusRemoveCommand,
// graphDisplaysCommand, graphWindowsCommand, graphDeepenCommand, graphCollapseCommand,
// snapshotCommand — all using daemonOneShot() instead of SideEyeClient.
```

- [ ] **Step 2: Wire SpatialModel into unified daemon**

In `src/daemon/unified.swift`:

```swift
// Add property:
let spatial = SpatialModel()

// In start(), after perception.start():
spatial.startPolling()

// In routeAction(), add cases:
case "focus-create", "focus-update", "focus-remove", "focus-list",
     "graph-displays", "graph-windows", "graph-deepen", "graph-collapse",
     "snapshot":
    let response = spatial.dispatch(action, json: json)
    sendResponseJSON(to: clientFD, response.toDictionary())
```

Add a `dispatch()` method to SpatialModel that maps action strings to method calls (same switch as side-eye's `daemon.swift:dispatchRequest`).

- [ ] **Step 3: Add subcommand routing in main.swift**

```swift
// In main.swift command routing:
case "focus":
    guard args.count >= 2 else { printUsage(); exit(1) }
    switch args[1] {
    case "create":  focusCreateCommand(args: Array(args.dropFirst(2)))
    case "update":  focusUpdateCommand(args: Array(args.dropFirst(2)))
    case "list":    focusListCommand()
    case "remove":  focusRemoveCommand(args: Array(args.dropFirst(2)))
    default: exitError("Unknown focus subcommand: \(args[1])", code: "UNKNOWN_COMMAND")
    }

case "graph":
    guard args.count >= 2 else { printUsage(); exit(1) }
    switch args[1] {
    case "displays":  graphDisplaysCommand()
    case "windows":   graphWindowsCommand(args: Array(args.dropFirst(2)))
    case "deepen":    graphDeepenCommand(args: Array(args.dropFirst(2)))
    case "collapse":  graphCollapseCommand(args: Array(args.dropFirst(2)))
    default: exitError("Unknown graph subcommand: \(args[1])", code: "UNKNOWN_COMMAND")
    }

case "daemon-snapshot":
    snapshotCommand()
```

- [ ] **Step 4: Build and test**

Run: `bash build.sh`
Then:
```bash
./aos graph displays        # Should list connected displays
./aos graph windows         # Should list on-screen windows
./aos focus list            # Should show empty list (requires daemon)
```

- [ ] **Step 5: Commit**

```
git add src/perceive/focus-commands.swift src/main.swift src/daemon/unified.swift
git commit -m "feat: port side-eye focus/graph commands into aos daemon"
```

---

### Task 5: Delete side-eye package and update references

**Files:**
- Delete: `packages/side-eye/` (all files)
- Create: `packages/side-eye/MOVED.md`
- Modify: `CLAUDE.md`, `ARCHITECTURE.md`, `src/CLAUDE.md`, `packages/side-eye/CLAUDE.md`
- Modify: `build.sh` (remove side-eye build reference if any)

- [ ] **Step 1: Remove side-eye source files, leave MOVED.md**

```bash
git rm packages/side-eye/main.swift packages/side-eye/spatial.swift \
      packages/side-eye/daemon.swift packages/side-eye/client.swift \
      packages/side-eye/enumerate-windows.swift packages/side-eye/protocol.swift \
      packages/side-eye/build.sh packages/side-eye/CLAUDE.md
```

Create `packages/side-eye/MOVED.md`:
```markdown
# side-eye has been merged into the aos unified binary

All side-eye functionality is now available directly via `aos`:

- `aos see capture` — screenshot pipeline (was `side-eye capture`)
- `aos see list` — display/window topology (was `side-eye list`)
- `aos see cursor` — cursor position + AX element (was `side-eye cursor`)
- `aos see selection` — selected text (was `side-eye selection`)
- `aos focus create/update/list/remove` — focus channels (was `side-eye focus`)
- `aos graph displays/windows/deepen/collapse` — graph navigation (was `side-eye graph`)

Build: `bash build.sh` (from repo root)
```

- [ ] **Step 2: Update CLAUDE.md files**

Root `CLAUDE.md`: remove `packages/side-eye/` from structure, note it's absorbed.
`src/CLAUDE.md`: update capture docs — no longer delegates to side-eye, runs in-process. Remove "Requires side-eye binary" note.
`ARCHITECTURE.md`: update component roster, remove side-eye as separate package.

- [ ] **Step 3: Update gateway proxy (aos-proxy.ts)**

The gateway proxy spawns `aos see capture` which previously delegated to side-eye. Since capture now runs in-process, no proxy changes needed — it already calls `aos see capture`.

Verify: `packages/gateway/src/aos-proxy.ts` calls `runAos(['see', 'capture', ...])` — this still works.

- [ ] **Step 4: Build final binary and run full test**

```bash
bash build.sh
./aos doctor --json                          # daemon healthy
./aos see capture main --out /tmp/final.png  # capture works
./aos see cursor                             # cursor works
./aos graph displays                         # graph works
./aos focus list                             # focus works (via daemon)
```

- [ ] **Step 5: Commit**

```
git add -A
git commit -m "feat: complete side-eye merge — single binary, no sub-dependencies"
```

---

## Post-merge cleanup (optional, not blocking)

These are nice-to-haves that can be done in a follow-up session:

1. **Remove `kSideEyeSocketPath` references** — side-eye's daemon socket at `~/.config/side-eye/sock` is no longer used. Clean up any references.
2. **Consolidate cursor commands** — aos had its own `see cursor` (in perceive/cursor.swift) and side-eye had its own `cursorCommand()`. Decide which output format to keep. Side-eye's is richer (includes window bounds, AX element). Recommend keeping side-eye's.
3. **Remove `findSideEye()` binary resolution** — no longer needed since capture runs in-process.
4. **Update gateway SDK tests** — if any test referenced side-eye directly.
5. **Delete `~/.config/side-eye/`** — add to `aos reset` cleanup.
