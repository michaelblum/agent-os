# Union Canvas Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close #50 by landing `--track union` (#54), topology-change retarget (#49), and the Sigil renderer strangler-fig migration off the inline bundle (#48).

**Architecture:** One new CLI flag (`--track <target>`) with one supported value in v1 (`union`). The daemon stores the target per-canvas, resolves bounds from it on create and on `display_geometry` change, and applies updates via the existing `updatePosition` code path. The Sigil renderer migration ports one rendering subsystem per commit from the inline bundle into the existing ES module tree, shrinking the `APPEARANCE_FIELDS` bridge until it can be removed.

**Tech Stack:** Swift 5.9+ (daemon, CLI), vanilla JS ES modules + Three.js r128 (Sigil renderer), `aos` unified binary.

**Spec:** `docs/superpowers/specs/2026-04-14-union-canvas-foundation-design.md`

---

## Phase 1 — `--track union` flag (#54)

### Task 1: Add `track` field to IPC schema

**Files:**
- Modify: `src/display/protocol.swift:57-97`

- [ ] **Step 1: Add `track` field to `CanvasRequest`**

Edit `src/display/protocol.swift` — in the `CanvasRequest` struct, add after `autoProject` (line 71):

```swift
    var track: String?          // tracking target (e.g. "union") — bounds auto-resolve + auto-update
```

- [ ] **Step 2: Add `track` field to `CanvasInfo`**

Edit `src/display/protocol.swift` — in the `CanvasInfo` struct, add after `autoProject` (line 96):

```swift
    var track: String?          // tracking target if any
```

- [ ] **Step 3: Build to verify compilation**

Run: `bash build.sh`
Expected: builds cleanly with no new warnings (existing warnings OK).

- [ ] **Step 4: Commit**

```bash
git add src/display/protocol.swift
git commit -m "feat(display): add track field to CanvasRequest/CanvasInfo"
```

---

### Task 2: Parse `--track` in `aos show create`, reject combination with `--at`

**Files:**
- Modify: `src/display/client.swift:113-215`

- [ ] **Step 1: Add `--track` parsing to `createCommand`**

Edit `src/display/client.swift` — in `createCommand`, add a new local variable after `autoProject` (line 126):

```swift
    var track: String? = nil
```

Add a new case to the argument switch, after the `--auto-project` case (around line 170):

```swift
        case "--track":
            i += 1; guard i < args.count else { exitError("--track requires a target (e.g. 'union')", code: "MISSING_ARG") }
            track = args[i]
            // v1: only 'union' is supported
            guard track == "union" else {
                exitError("Unknown --track target: \(track ?? ""). Supported: union", code: "INVALID_ARG")
            }
```

- [ ] **Step 2: Reject `--at` + `--track union` combination**

After the existing `--at` parsing block (lines 189-193), add:

```swift
    if track != nil && at != nil {
        exitError("cannot combine --at with --track (pick one)", code: "INVALID_ARG")
    }
```

- [ ] **Step 3: Relax the "must have a position" requirement when `track` is set**

Look for where `--at` / `--anchor-window` / `--anchor-channel` is required. That validation lives in the daemon (`canvas.swift` — the `MISSING_POSITION` fail case at line 399). The client-side parser doesn't enforce it. Nothing to change here.

- [ ] **Step 4: Pass `track` to the request**

After `request.at = parts` on line 192 (or the else branch), add (after all positioning args are set, near `request.autoProject = ap`):

```swift
    if let t = track { request.track = t }
```

Place this after line 201 (`if let ap = autoProject { request.autoProject = ap }`).

- [ ] **Step 5: Build + verify unknown-target error**

Run:
```bash
bash build.sh
./aos show create --id x --track bogus 2>&1
```
Expected: `{"code" : "INVALID_ARG", "error" : "Unknown --track target: bogus. Supported: union"}`

- [ ] **Step 6: Verify `--at` + `--track` combo error**

Run:
```bash
./aos show create --id x --track union --at 0,0,100,100 2>&1
```
Expected: `{"code" : "INVALID_ARG", "error" : "cannot combine --at with --track (pick one)"}`

- [ ] **Step 7: Commit**

```bash
git add src/display/client.swift
git commit -m "feat(show create): accept --track <target>, reject combination with --at (#54)"
```

---

### Task 3: Parse `--track` in `aos show update`

**Files:**
- Modify: `src/display/client.swift:219-330`

- [ ] **Step 1: Add `--track` parsing to `updateCommand`**

Mirror Task 2 in `updateCommand`. Add local variable after `ttlValue` (line 230):

```swift
    var track: String? = nil
```

Add case to the switch (after `--ttl` case, around line 269):

```swift
        case "--track":
            i += 1; guard i < args.count else { exitError("--track requires a target (e.g. 'union')", code: "MISSING_ARG") }
            track = args[i]
            guard track == "union" else {
                exitError("Unknown --track target: \(track ?? ""). Supported: union", code: "INVALID_ARG")
            }
```

- [ ] **Step 2: Reject `--at` + `--track` in update too**

After the existing `--at` handling block, add:

```swift
    if track != nil && at != nil {
        exitError("cannot combine --at with --track (pick one)", code: "INVALID_ARG")
    }
```

- [ ] **Step 3: Pass `track` to the request**

After `request.offset = parts` near the end of argument handling, add:

```swift
    if let t = track { request.track = t }
```

- [ ] **Step 4: Build**

Run: `bash build.sh`
Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add src/display/client.swift
git commit -m "feat(show update): accept --track <target> for retargeting existing canvases (#54)"
```

---

### Task 4: Add `trackTarget` to `Canvas` class

**Files:**
- Modify: `src/display/canvas.swift:101-267`

- [ ] **Step 1: Define a `TrackTarget` enum at the top of the file**

After the `CanvasWebView` class (line 97) and before the `Canvas` class, add:

```swift
// MARK: - Track Target

/// A canvas's tracking target. When set, the daemon resolves bounds from the
/// target on create and re-resolves on relevant change events. v1 supports
/// only `.union` (bounds = union of all displays). Future target types
/// (window:<wid>, channel:<cid>, display:<n>, static:<rect>) land via #60.
enum TrackTarget: String {
    case union
}
```

- [ ] **Step 2: Add `trackTarget` property to `Canvas`**

In the `Canvas` class, add the property after `autoProjectMode` (line 124):

```swift
    var trackTarget: TrackTarget?
```

- [ ] **Step 3: Include `track` in `toInfo()`**

Update the `toInfo()` method (lines 253-266) to pass the track string:

```swift
    func toInfo() -> CanvasInfo {
        let f = cgFrame
        return CanvasInfo(
            id: id,
            at: [f.origin.x, f.origin.y, f.size.width, f.size.height],
            anchorWindow: anchorWindowID.map { Int($0) },
            anchorChannel: anchorChannelID,
            offset: offset.map { [$0.origin.x, $0.origin.y, $0.size.width, $0.size.height] },
            interactive: isInteractive,
            ttl: remainingTTL,
            scope: scope,
            autoProject: autoProjectMode,
            track: trackTarget?.rawValue
        )
    }
```

- [ ] **Step 4: Build**

Run: `bash build.sh`
Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add src/display/canvas.swift
git commit -m "feat(canvas): add TrackTarget enum and trackTarget property (#54)"
```

---

### Task 5: Resolve union bounds in `handleCreate`

**Files:**
- Modify: `src/display/canvas.swift:329-607`

- [ ] **Step 1: Parse and validate `req.track` at top of `handleCreate`**

In `handleCreate` (line 329), just after the early `id` / duplicate guard (line 336), add:

```swift
        let trackTarget: TrackTarget?
        if let trackStr = req.track {
            guard let t = TrackTarget(rawValue: trackStr) else {
                return .fail("Unknown track target: \(trackStr)", code: "INVALID_TRACK")
            }
            trackTarget = t
        } else {
            trackTarget = nil
        }
```

- [ ] **Step 2: Resolve bounds from `trackTarget` when present**

In `handleCreate`, the `cgFrame` resolution cascade starts at line 371 (`if autoMode == "cursor_trail"`). Insert a new branch *before* the `if autoMode == "cursor_trail"` line:

```swift
        let cgFrame: CGRect
        if trackTarget == .union {
            // Resolve union bounds from the current display topology.
            // Pulls from the same snapshot used by runtimeDisplayUnion() and
            // the display_geometry broadcast, so values always agree.
            let snap = snapshotDisplayGeometry()
            guard let global = snap["global_bounds"] as? [String: Double],
                  let w = global["w"], let h = global["h"], w > 0, h > 0 else {
                return .fail("--track union requires at least one connected display", code: "NO_DISPLAYS")
            }
            cgFrame = CGRect(x: global["x"] ?? 0, y: global["y"] ?? 0, width: w, height: h)
        } else if autoMode == "cursor_trail" {
```

(Delete the original `let cgFrame: CGRect` and `if autoMode == "cursor_trail" {` lines — the new branch subsumes them.)

- [ ] **Step 3: Set `canvas.trackTarget` after creation**

After `let canvas = Canvas(id: id, cgFrame: cgFrame, interactive: interactive)` (line 403), add:

```swift
        canvas.trackTarget = trackTarget
```

- [ ] **Step 4: Build**

Run: `bash build.sh`
Expected: clean build.

- [ ] **Step 5: Smoke test `--track union` creation**

Run:
```bash
./aos service restart --mode repo
./aos show create --id ut-smoke --track union --html '<body style="background:rgba(255,100,100,0.4)"></body>'
./aos show list | grep ut-smoke
./aos show remove --id ut-smoke
```
Expected: `list` output includes `"track":"union"` and `at` matches `./aos runtime display-union` output (parsed as x,y,w,h).

- [ ] **Step 6: Commit**

```bash
git add src/display/canvas.swift
git commit -m "feat(daemon): resolve --track union bounds from display topology snapshot (#54)"
```

---

### Task 6: Handle `track` in `handleUpdate` (retargeting)

**Files:**
- Modify: `src/display/canvas.swift:609-721`

- [ ] **Step 1: Add track handling to `handleUpdate`**

In `handleUpdate` (line 609), insert a new block after the `--at` handling (after line 625's closing brace, before the `anchorChannel` block):

```swift
        if let trackStr = req.track {
            guard let t = TrackTarget(rawValue: trackStr) else {
                return .fail("Unknown track target: \(trackStr)", code: "INVALID_TRACK")
            }
            canvas.trackTarget = t

            // Resolve new bounds from the target immediately so the retarget
            // is visible without waiting for the next topology-change event.
            if t == .union {
                let snap = snapshotDisplayGeometry()
                if let global = snap["global_bounds"] as? [String: Double],
                   let w = global["w"], let h = global["h"], w > 0, h > 0 {
                    let newFrame = CGRect(x: global["x"] ?? 0, y: global["y"] ?? 0, width: w, height: h)
                    canvas.updatePosition(cgRect: newFrame)
                    let atArr: [CGFloat] = [newFrame.origin.x, newFrame.origin.y, newFrame.size.width, newFrame.size.height]
                    onCanvasLifecycle?(id, "updated", atArr)
                }
            }

            // Clear conflicting anchor state — track supersedes anchors.
            canvas.anchorWindowID = nil
            canvas.anchorChannelID = nil
            canvas.offset = nil
        }
```

- [ ] **Step 2: Build**

Run: `bash build.sh`
Expected: clean build.

- [ ] **Step 3: Smoke test retargeting**

Run:
```bash
./aos service restart --mode repo
./aos show create --id ut-retarget --at 100,100,400,300 --html '<body style="background:rgba(100,255,100,0.4)"></body>'
./aos show list | grep ut-retarget
# Retarget to union
./aos show update --id ut-retarget --track union
./aos show list | grep ut-retarget
./aos show remove --id ut-retarget
```
Expected: first `list` shows the 400×300 bounds; second shows union bounds matching `aos runtime display-union`.

- [ ] **Step 4: Commit**

```bash
git add src/display/canvas.swift
git commit -m "feat(daemon): support --track on show update to retarget existing canvases (#54)"
```

---

### Task 7: Close #54

**Files:**
- Modify: `apps/sigil/CLAUDE.md` (the Run section — update the launch command example)

- [ ] **Step 1: Update apps/sigil/CLAUDE.md launch example**

In `apps/sigil/CLAUDE.md`, find the section showing:

```bash
./aos show create --id avatar-main \
    --url 'aos://sigil/renderer/index.html' \
    --at 0,0,1512,982
```

Replace with:

```bash
./aos show create --id avatar-main \
    --url 'aos://sigil/renderer/index.html' \
    --track union
```

- [ ] **Step 2: Commit and close #54**

```bash
git add apps/sigil/CLAUDE.md
git commit -m "docs(sigil): use --track union in avatar-main launch example (#54)"
gh issue close 54 --reason completed --comment "Landed via the Union Canvas Foundation plan. --track union flag accepted by create and update; rejects --at combination; aos show list reports track. See docs/superpowers/plans/2026-04-14-union-canvas-foundation.md."
```

---

## Phase 2 — Topology-change retarget (#49)

### Task 8: Add `retargetTrackedCanvases()` to `CanvasManager`

**Files:**
- Modify: `src/display/canvas.swift` (inside `CanvasManager`, near the other internal helpers around line 286)

- [ ] **Step 1: Add the method**

Inside `CanvasManager`, after `hasAutoProjectCanvases` (line 287), add:

```swift
    var hasTrackedCanvases: Bool { canvases.values.contains { $0.trackTarget != nil } }

    /// Re-resolve bounds for every canvas with a tracking target and apply
    /// the new bounds. Called from the daemon's coalesced display_geometry
    /// handler on topology change. Failures on individual canvases are logged
    /// but never block the rest of the iteration — a broken canvas must not
    /// stall the topology-change broadcast.
    func retargetTrackedCanvases() {
        let snap = snapshotDisplayGeometry()
        guard let global = snap["global_bounds"] as? [String: Double],
              let w = global["w"], let h = global["h"], w > 0, h > 0 else {
            fputs("[canvas] retargetTrackedCanvases: no displays, skipping\n", stderr)
            return
        }
        let unionFrame = CGRect(
            x: global["x"] ?? 0,
            y: global["y"] ?? 0,
            width: w,
            height: h
        )

        for canvas in canvases.values {
            guard let target = canvas.trackTarget else { continue }
            switch target {
            case .union:
                canvas.updatePosition(cgRect: unionFrame)
                let atArr: [CGFloat] = [unionFrame.origin.x, unionFrame.origin.y, unionFrame.size.width, unionFrame.size.height]
                onCanvasLifecycle?(canvas.id, "updated", atArr)
            }
        }
    }
```

- [ ] **Step 2: Build**

Run: `bash build.sh`
Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add src/display/canvas.swift
git commit -m "feat(canvas): add retargetTrackedCanvases() for topology-change retargeting (#49)"
```

---

### Task 9: Hook retarget into `scheduleDisplayGeometryBroadcast`

**Files:**
- Modify: `src/daemon/unified.swift:418-426`

- [ ] **Step 1: Update the coalesced handler**

In `src/daemon/unified.swift`, replace the existing `scheduleDisplayGeometryBroadcast` (lines 418-426):

```swift
    /// Coalesced entry point for didChangeScreenParameters. Collapses a burst
    /// of notifications into a single broadcast after a short quiet window.
    ///
    /// Order matters: retarget tracked canvases FIRST, then broadcast. Renderers
    /// subscribed to display_geometry should see their canvas already sitting
    /// in the new bounds by the time they receive the event, not a transient
    /// "stale rect + new topology" state.
    private func scheduleDisplayGeometryBroadcast() {
        if displayGeometryBroadcastScheduled { return }
        displayGeometryBroadcastScheduled = true
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(displayGeometryCoalesceMs)) { [weak self] in
            guard let self = self else { return }
            self.displayGeometryBroadcastScheduled = false
            self.canvasManager.retargetTrackedCanvases()
            self.broadcastDisplayGeometry()
        }
    }
```

- [ ] **Step 2: Build**

Run: `bash build.sh`
Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add src/daemon/unified.swift
git commit -m "feat(daemon): retarget tracked canvases before broadcasting display_geometry (#49)"
```

---

### Task 10: Manual verification (#49)

- [ ] **Step 1: Restart daemon**

Run:
```bash
./aos service restart --mode repo
```

- [ ] **Step 2: Create a union-tracked canvas**

Run:
```bash
./aos show create --id topo-test --track union \
    --html '<body style="margin:0;background:rgba(255,100,200,0.3);font:24px system-ui;color:white;display:flex;align-items:center;justify-content:center;">union-tracked</body>'
./aos show list | grep topo-test
```

Record the starting `at` value. Should match `aos runtime display-union`.

- [ ] **Step 3: Change topology**

Unplug or replug the external monitor (or use System Settings → Displays → Arrangement to toggle mirroring, or swap displays via `/tmp/swap-displays` from the test that ran earlier).

- [ ] **Step 4: Verify bounds updated**

Run:
```bash
./aos show list | grep topo-test
./aos runtime display-union
```

The canvas `at` should now match the new `display-union` output. The pink body should visibly span the new display arrangement.

- [ ] **Step 5: Restore topology and clean up**

Restore your display arrangement. Then:

```bash
./aos show remove --id topo-test
```

- [ ] **Step 6: Commit a docstring update if the manual verification revealed anything worth noting**

If verification surfaced an edge case (e.g., retarget needs more than one retry on certain display transitions), capture it in the comment above `retargetTrackedCanvases`. Otherwise no commit needed.

- [ ] **Step 7: Close #49**

```bash
gh issue close 49 --reason completed --comment "Landed via the Union Canvas Foundation plan. Daemon retargets --track union canvases on display topology change before broadcasting display_geometry. See docs/superpowers/plans/2026-04-14-union-canvas-foundation.md."
```

---

## Phase 3 — Sigil renderer strangler-fig migration (#48)

**Migration order** (chosen for dependency: each later subsystem may build on state established by earlier ones):

1. colors
2. skins
3. geometry (dot radius/shape/polygon sides)
4. particles
5. lightning
6. magnetic
7. aura
8. phenomena
9. omega
10. scaffolding removal (final)

Each subsystem follows the same 5-step recipe. Rather than duplicating 10 identical task skeletons, Tasks 11–19 use the recipe below with the subsystem name substituted. Each task produces one commit.

**The recipe (per subsystem `<S>`):**

- [ ] **Step 1: Identify the module and inline counterparts**

Read:
- Module: `apps/sigil/renderer/<S>.js` (e.g., `colors.js`) — this is where rendering should live.
- Inline callsites: `apps/sigil/renderer/index.html` — search for functions/sections relating to `<S>` in the inline `<script>`. Look in particular at `window.update<S>*` functions and anything referenced from `rebuildInlineVisualsAfterAppearance` (line ~3371) that touches `<S>`.
- Appearance fields: `APPEARANCE_FIELDS` array in `syncModuleStateToWindow` (line ~3323) — find which entries belong to `<S>`.

- [ ] **Step 2: Port rendering logic from inline to module**

Move the rendering-side functions (the ones that actually touch Three.js meshes for `<S>`) from the inline `<script>` into `<S>.js`. If `<S>.js` already has a function with the same shape, extend it so it's authoritative; if not, create a new exported function. The module must be driven by the module-scope `state` singleton, not `window.state` — the whole point is to stop needing the bridge.

- [ ] **Step 3: Wire the module to drive the scene directly**

In `apps/sigil/renderer/appearance.js` (or wherever `applyAppearance` orchestrates rebuilds), add a call to the newly-authoritative `<S>` rendering function. Remove the corresponding call from `rebuildInlineVisualsAfterAppearance` in `index.html`.

- [ ] **Step 4: Remove migrated fields from `APPEARANCE_FIELDS`**

Delete the entries for `<S>` from `APPEARANCE_FIELDS` in `index.html`. If the entry list is now noticeably shorter, this is the signal that migration is progressing.

- [ ] **Step 5: Delete the now-dead inline code for `<S>`**

Remove the inline `<script>`'s `<S>` functions and any `window.update<S>*` exports they made. Any Three.js objects they owned should now be owned by the module.

- [ ] **Step 6: Visual smoke verification**

```bash
bash build.sh
./aos service restart --mode repo
./aos show create --id avatar-main --track union --url 'aos://sigil/renderer/index.html'
# Open studio in another invocation
./aos show create --id studio --url 'aos://sigil/studio/index.html' --interactive --focus --at 200,200,460,720
```

Exercise every Studio control that touches `<S>`. Confirm the live avatar responds identically to pre-migration behavior. Known good reference: Studio's randomize button produces a wide variety of `<S>` values — if all look right, coverage is decent.

Teardown:
```bash
./aos show remove --id studio
./aos show remove --id avatar-main
```

- [ ] **Step 7: Commit**

```bash
git add apps/sigil/renderer/
git commit -m "refactor(sigil): migrate <S> rendering from inline bundle to module (#48)"
```

---

### Task 11: Migrate `colors`

Apply the recipe above with `<S> = colors`. Module file: `apps/sigil/renderer/colors.js`. Inline functions to investigate: `updateAllColors`, `applyColorToMesh`, and anything in the inline bundle's ~line 1500-2000 range that touches `material.color`. Appearance fields to pull from `APPEARANCE_FIELDS`: everything starting with `color` or ending in `Color` (e.g., `dotColor`, `auraColor`, etc. — the exact set is in the array).

### Task 12: Migrate `skins`

Apply the recipe with `<S> = skins`. Module: `apps/sigil/renderer/skins.js`. Inline: `applySkin`, `currentSkin`. Appearance fields: `skin`, `skinVariant` (check `APPEARANCE_FIELDS` for exact names).

### Task 13: Migrate `geometry`

Apply the recipe with `<S> = geometry`. Module: `apps/sigil/renderer/geometry.js`. Inline: `updateGeometry`, the dot-mesh rebuild path (the largest single piece of inline code). Appearance fields: `dotRadius`, `polyBuff`, `polySides`, etc.

### Task 14: Migrate `particles`

Apply the recipe with `<S> = particles`. Module: `apps/sigil/renderer/particles.js`.

### Task 15: Migrate `lightning`

Apply the recipe with `<S> = lightning`. Module: `apps/sigil/renderer/lightning.js`.

### Task 16: Migrate `magnetic`

Apply the recipe with `<S> = magnetic`. Module: `apps/sigil/renderer/magnetic.js`.

### Task 17: Migrate `aura`

Apply the recipe with `<S> = aura`. Module: `apps/sigil/renderer/aura.js`.

### Task 18: Migrate `phenomena`

Apply the recipe with `<S> = phenomena`. Module: `apps/sigil/renderer/phenomena.js`.

### Task 19: Migrate `omega`

Apply the recipe with `<S> = omega`. Module: `apps/sigil/renderer/omega.js`.

---

### Task 20: Remove bridge scaffolding

**Files:**
- Modify: `apps/sigil/renderer/index.html`

- [ ] **Step 1: Confirm `APPEARANCE_FIELDS` is empty or irrelevant**

Open `apps/sigil/renderer/index.html`. Find `APPEARANCE_FIELDS` (around line 3323). If Tasks 11–19 were done completely, the array should be empty or contain only dead fields. If anything remains, investigate — it means a field was missed. Fix by going back and finishing the corresponding subsystem.

- [ ] **Step 2: Delete the three bridge functions**

Remove:
- `syncModuleStateToWindow` (~lines 3319–3369)
- `rebuildInlineVisualsAfterAppearance` (~lines 3371–3441)
- The `APPEARANCE_FIELDS` array

- [ ] **Step 3: Remove calls to the deleted functions**

Search `index.html` for `syncModuleStateToWindow(` and `rebuildInlineVisualsAfterAppearance(`. Remove all call sites (look around lines 3441, 3532).

- [ ] **Step 4: Delete any remaining dead inline `<script>` code**

If Tasks 11-19 were thorough, there should be little or nothing left in the classic `<script>` block that drives rendering. What remains should be boot scaffolding (the headsup bridge, state machine, input handlers) — not rendering. If it's not obviously kept-on-purpose, delete it.

- [ ] **Step 5: Visual smoke — the big one**

```bash
bash build.sh
./aos service restart --mode repo
./aos show create --id avatar-main --track union --url 'aos://sigil/renderer/index.html'
./aos show create --id studio --url 'aos://sigil/studio/index.html' --interactive --focus --at 200,200,460,720
```

Exercise the full Studio surface: randomize (multiple times), manipulate every slider, change skin, change shape, toggle phenomena, save a preset, load a preset. Confirm the live avatar renders every state change. Drag the avatar across displays — confirm fast-travel and return-to-idle still work. Change the wiki doc externally (`./aos wiki show sigil/agents/default.md` → edit → save) — confirm live-reload still fires.

Teardown:
```bash
./aos show remove --id studio
./aos show remove --id avatar-main
```

- [ ] **Step 6: Commit**

```bash
git add apps/sigil/renderer/index.html
git commit -m "refactor(sigil): remove inline bundle scaffolding — module tree is authoritative (#48)"
```

- [ ] **Step 7: Close #48**

```bash
gh issue close 48 --reason completed --comment "Renderer inline/module reconciliation complete. ES module tree is authoritative; inline bundle retired via strangler-fig migration. See docs/superpowers/plans/2026-04-14-union-canvas-foundation.md."
```

---

## Phase 4 — Close #50

### Task 21: Update ARCHITECTURE.md §5

**Files:**
- Modify: `ARCHITECTURE.md:187-196`

- [ ] **Step 1: Rewrite the Lifecycle section**

Replace lines 187-196 with:

```markdown
### Lifecycle

- **Creation.** `aos show create --id <name> --track union --url ...` — the canvas's tracking target is stored by the daemon. Bounds resolve from the current display topology snapshot. Callers who want a snapshot-only canvas can still pass `--at $(aos runtime display-union)` (legacy shorthand) but it produces a static canvas that won't follow topology changes.
- **Topology change.** Daemon observes `NSApplication.didChangeScreenParametersNotification`, coalesces 100ms, re-resolves bounds for every canvas whose `track == union`, then rebroadcasts `display_geometry`. Renderers see their canvas already sitting in the new bounds by the time they receive the event.
- **Destruction.** `aos show remove --id <name>` cascades to child canvases registered under the parent. No change for union canvases specifically.
```

- [ ] **Step 2: Update invariant 4**

Invariant 4 (line 177) currently says "A union canvas created with `--at $(aos runtime display-union)` snapshots the union at spawn time. Whether its bounds automatically follow topology changes is a lifecycle decision..."

Replace with:

```markdown
4. **Opt-in topology tracking.** A union canvas created with `--track union` resolves its bounds from the current display topology and auto-updates on topology changes. Canvases created with literal `--at` values stay at their spawn-time bounds regardless of topology changes.
```

- [ ] **Step 3: Commit**

```bash
git add ARCHITECTURE.md
git commit -m "docs(arch): §5 describes daemon-side retargeting, not 'target vs current'"
```

---

### Task 22: Close #50

- [ ] **Step 1: Verify preconditions**

All of:
- `gh issue view 48 --json state` → `CLOSED`
- `gh issue view 49 --json state` → `CLOSED`
- `gh issue view 54 --json state` → `CLOSED`

If any are open, do not proceed. #47 should already be CLOSED from the Three.js vendoring work.

- [ ] **Step 2: Close**

```bash
gh issue close 50 --reason completed --comment "All sub-issues merged. ARCHITECTURE.md §5 updated to reflect daemon-side retargeting. See docs/superpowers/plans/2026-04-14-union-canvas-foundation.md."
```

---

## Verification checklist (full)

After all tasks:
- [ ] `./aos show create --id t --track bogus` → `INVALID_ARG`
- [ ] `./aos show create --id t --track union --at 0,0,100,100` → `INVALID_ARG`
- [ ] `./aos show create --id t --track union --html '...'` → `success`, `list` reports `track:"union"` and bounds = `runtime display-union`
- [ ] `./aos show update --id t --track union` retargets a non-tracked canvas
- [ ] Unplug monitor with a `--track union` canvas alive → canvas `at` updates within ~100ms
- [ ] Sigil avatar renders identically to pre-migration (visual smoke with Studio randomize + slider manipulation)
- [ ] `APPEARANCE_FIELDS` array does not exist in `index.html`
- [ ] `syncModuleStateToWindow` and `rebuildInlineVisualsAfterAppearance` do not exist
- [ ] Issues #48, #49, #54, #50 all CLOSED
- [ ] ARCHITECTURE.md §5 does not mention "target" vs "current" behavior
