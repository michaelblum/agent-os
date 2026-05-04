# Post-Merge Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all side-eye remnants from the aos codebase after the side-eye → aos merge.

**Architecture:** Three independent changes: migrate zones file path to mode-scoped state dir, add legacy side-eye dir to reset cleanup, update stale comments. No new files, no API changes.

**Tech Stack:** Swift (aos unified binary)

---

### Task 1: Migrate zones file path

**Files:**
- Modify: `src/perceive/capture-pipeline.swift:875-891`

- [ ] **Step 1: Replace the zones path and add migration logic**

Replace the `zonesFilePath` constant and update `loadZones()` to auto-migrate from the old location:

```swift
// Old (line 875):
let zonesFilePath = NSString("~/.config/side-eye/zones.json").expandingTildeInPath

// New:
let zonesFilePath = (aosStateDir() as NSString).appendingPathComponent("zones.json")
private let legacyZonesFilePath = NSString("~/.config/side-eye/zones.json").expandingTildeInPath
```

Replace `loadZones()` (lines 877-882):

```swift
func loadZones() -> [String: ZoneEntry] {
    // Migrate from legacy side-eye path if needed
    if !FileManager.default.fileExists(atPath: zonesFilePath),
       FileManager.default.fileExists(atPath: legacyZonesFilePath) {
        try? FileManager.default.copyItem(atPath: legacyZonesFilePath, toPath: zonesFilePath)
    }
    guard let data = FileManager.default.contents(atPath: zonesFilePath),
          let zones = try? JSONDecoder().decode([String: ZoneEntry].self, from: data)
    else { return [:] }
    return zones
}
```

`saveZones()` needs no changes — it already creates parent directories and writes to `zonesFilePath`.

- [ ] **Step 2: Build and verify**

Run: `bash build.sh 2>&1 | tail -3`

Expected: Compiles without errors (warnings are OK).

- [ ] **Step 3: Verify zones still work**

Run: `./aos see zone list 2>&1`

Expected: Either shows existing zones or shows an empty list — no crash, no "side-eye" path in any error.

- [ ] **Step 4: Commit**

```bash
git add src/perceive/capture-pipeline.swift
git commit -m "fix: migrate zones.json from ~/.config/side-eye/ to mode-scoped state dir"
```

### Task 2: Add side-eye dir to reset cleanup

**Files:**
- Modify: `src/commands/reset.swift:112-123`

- [ ] **Step 1: Add side-eye cleanup after the legacy state dir cleanup**

Insert after line 123 (after the `legacyItems` loop closing brace), before the repo artifact cleanup block:

```swift
    // Remove legacy side-eye config directory
    let sideEyeDir = NSString("~/.config/side-eye").expandingTildeInPath
    if FileManager.default.fileExists(atPath: sideEyeDir) {
        try? FileManager.default.removeItem(atPath: sideEyeDir)
        removedPaths.append(sideEyeDir)
    }
```

- [ ] **Step 2: Build and verify**

Run: `bash build.sh 2>&1 | tail -3`

Expected: Compiles without errors.

- [ ] **Step 3: Verify reset reports the path**

Run: `mkdir -p ~/.config/side-eye && echo '{}' > ~/.config/side-eye/test.json && ./aos reset --mode all --json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print([p for p in d['removed_paths'] if 'side-eye' in p])"`

Expected: Output includes the `~/.config/side-eye` path (expanded).

- [ ] **Step 4: Commit**

```bash
git add src/commands/reset.swift
git commit -m "fix: add ~/.config/side-eye/ to aos reset cleanup"
```

### Task 3: Update stale side-eye comments

**Files:**
- Modify: `src/main.swift:109,120`
- Modify: `src/perceive/capture-pipeline.swift:1-5,1152-1154`
- Modify: `src/perceive/spatial.swift:7-8`
- Modify: `src/perceive/focus-commands.swift:3-4`
- Modify: `src/act/act-models.swift:356`
- Modify: `src/display/channel.swift:2,8`
- Modify: `src/act/act-channel.swift:2`

- [ ] **Step 1: Update main.swift help text**

Line 109 — change:
```
      capture <target>     Screenshot capture (delegates to side-eye)
```
to:
```
      capture <target>     Screenshot capture
```

Line 120 — change:
```
      <zone-name>          Named zone (configured via side-eye zone)
```
to:
```
      <zone-name>          Named zone (configured via aos see zone)
```

- [ ] **Step 2: Update capture-pipeline.swift comments**

Lines 1-5 — replace:
```swift
// capture-pipeline.swift — Full capture pipeline (ported from side-eye)
//
// This is the core screenshot pipeline: parse args → resolve target → capture →
// crop → overlay → encode → output. Formerly lived in packages/side-eye/main.swift,
// now compiled directly into the aos unified binary.
```
with:
```swift
// capture-pipeline.swift — Full capture pipeline
//
// Core screenshot pipeline: parse args → resolve target → capture →
// crop → overlay → encode → output.
```

Lines 1152-1154 — replace:
```swift
    // Build the CaptureDisplayEntry → side-eye DisplayEntry bridge for enumerateWindows
    // enumerateWindows expects the side-eye DisplayEntry type. For now we need to
    // create a compatible call. The enumerateWindows function lives in packages/side-eye.
    // Since it hasn't been ported yet (Task 3), we implement a simpler version here
    // that uses CGWindowList directly.
```
with:
```swift
    // Build window list using CGWindowList directly.
```

- [ ] **Step 3: Update spatial.swift comment**

Lines 7-8 — replace:
```swift
// Ported from packages/side-eye/spatial.swift. Uses shared AX helpers
// from ax.swift and channel types from display/channel.swift.
```
with:
```swift
// Uses shared AX helpers from ax.swift and channel types from
// display/channel.swift.
```

- [ ] **Step 4: Update focus-commands.swift comment**

Lines 3-4 — replace:
```swift
// Ported from packages/side-eye/client.swift. These commands talk to the
// aos unified daemon via daemonOneShot() instead of side-eye's standalone daemon.
```
with:
```swift
// These commands talk to the aos unified daemon via daemonOneShot().
```

- [ ] **Step 5: Update act-models.swift comment**

Line 356 — replace:
```swift
// MARK: - Focus Channel File Types (read from side-eye channel files)
```
with:
```swift
// MARK: - Focus Channel File Types
```

- [ ] **Step 6: Update channel.swift comments**

Line 2 — replace:
```swift
// Reads side-eye channel files from ~/.config/agent-os/channels/<id>.json
```
with:
```swift
// Reads channel files from ~/.config/agent-os/channels/<id>.json
```

Line 8 — replace:
```swift
// MARK: - Channel File Types (mirrors side-eye ChannelFile schema)
```
with:
```swift
// MARK: - Channel File Types
```

- [ ] **Step 7: Update act-channel.swift comment**

Lines 1-3 — replace:
```swift
// act-channel.swift — Focus channel binding for action sessions.
// Reads side-eye channel files, configures session context from channel targets,
// and resolves AX elements from channel element data.
```
with:
```swift
// act-channel.swift — Focus channel binding for action sessions.
// Reads channel files, configures session context from channel targets,
// and resolves AX elements from channel element data.
```

- [ ] **Step 8: Build to verify no typos**

Run: `bash build.sh 2>&1 | tail -3`

Expected: Compiles without errors.

- [ ] **Step 9: Verify no remaining side-eye references in source**

Run: `grep -r "side.eye" src/ --include="*.swift" | grep -v "// .*side-eye" | head -20`

Expected: No output (all side-eye references removed). Note: this grep excludes any remaining comments that mention side-eye — there should be none.

Actually, simpler:

Run: `grep -ri "side.eye" src/ --include="*.swift" | head -20`

Expected: No output at all.

- [ ] **Step 10: Commit**

```bash
git add src/main.swift src/perceive/capture-pipeline.swift src/perceive/spatial.swift src/perceive/focus-commands.swift src/act/act-models.swift src/display/channel.swift src/act/act-channel.swift
git commit -m "chore: remove stale side-eye references from comments and help text"
```
