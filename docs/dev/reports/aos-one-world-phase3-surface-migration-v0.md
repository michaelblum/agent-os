# AOS One-World Phase 3 — Surface Migration V0

Date: 2026-06-06

Branch: `gdi/aos-one-world-phase3-surface-migration-v0`

Start ref: `678b92e57851c68decc1e3d5a0ad215ae8090ec8`

Head ref (as of Task 2 commit): see §Commits on Branch

## Status

`code-complete — live drag pending` — All tasks committed. Task 2 executed per Foreman's Option A decision: `panelUrl: null` flip + prewarm guard + dispatcher-spy test. The embedded path is active in production config. Unit-level IPC→0 gate is verified by the dispatcher-spy test. Live-canvas input routing verification (slider drag in the embedded viewport) is deferred to a follow-on session with live canvas access.

---

## Gate Assessment (updated)

| Gate condition | Status |
|---|---|
| Window-semantics need shown unnecessary | PASSED |
| Structural-% drops below 100% for idle controls-open | PASSED — live probe: 0% structural, 0 publishState (controls-open idle) |
| Cross-canvas IPC approaches 0 during slider drag | CODE-COMPLETE — by construction (dispatcher-spy test); live drag measurement pending |
| publishState demand-driven | PASSED — preserved from Phase 2 sub-task 1 |
| Behavior parity | CODE-COMPLETE — embedded path exercised in tests; live canvas verification pending |
| Frame-time distribution (render-performance / canvas-stats) | DEFERRED — requires live canvas after embedded path activation |

---

## Window-Semantics Prerequisite Check

**Result: PASSED — window-semantics need shown unnecessary.**

The avatar compact controls panel (`sigil-avatar-controls-avatar-main`) is created via:

```js
// apps/sigil/renderer/live-modules/main.js:1460-1468
await host.canvasCreate({
    id: SIGIL_AVATAR_PANEL_CANVAS_ID,
    url: SIGIL_AVATAR_PANEL_URL,   // apps/sigil/avatar-editor/panel.html
    frame: SIGIL_AVATAR_PANEL_FRAME,
    interactive: true,
    focus: false,
    suspended: true,
    window_level: 'floating',
});
```

Evidence against each requirement:

| Requirement | Evidence |
|---|---|
| Z-order interleaving with native app windows (below real app content)? | No. `window_level: 'floating'` means above-normal, consistent with World's above-everything model. No below-app interleaving need. |
| Native title bar, native menu bar, macOS sheet attachment? | No. Custom HTML surface (`avatar-editor/panel.html`), no native chrome. |
| OS-managed focus arbitration via independent NSWindow? | No. `focus: false` at creation. Phase 1 already cleared focus/fault behavior for co-located documents. |
| Other macOS platform capability tied to independent NSWindow? | None identified. The panel is a floating above-everything transparent surface. |

The above-everything transparent model is the World's native affordance. The compact controls panel does not require the interleaving (below-app placement) capability that the World cannot provide. Migration is not blocked by window semantics.

---

## Task 1a: Cheap-Reason Promotion

**Delivered, committed, and live-measured.**

### What Changed

`apps/sigil/renderer/live-modules/render-loop.js`:

- `'avatar-controls'` moved from `trackingOnlyReasons` into `cheapFrameReasons`.
- `trackingOnlyReasons` is now an empty Set; the `trackingFrame` path is retained
  as inactive dead code pending a Phase 3 frame-tier documentation pass.

With this promotion:

| Frame type | Pre-Phase 3 (tracking-only) | Phase 3 (cheap) |
|---|---|---|
| `['avatar-controls']`, `structuralDirty=false` | `structural=true`, `publishState=false` | `structural=false`, `publishState=false` |
| `['avatar-controls']`, `structuralDirty=true` | `structural=true`, `publishState=true` | `structural=true`, `publishState=true` (unchanged) |
| `['panel-ui-idle', 'avatar-controls']`, `structuralDirty=false` | `structural=true` (tracking) | `structural=false` (cheap) |

The safety precondition (`b8f2dc65`) was already on main: the `canvas_lifecycle`
handler sets `structuralFrameDirty=true` when `updatePanelFrame` updates panel
bounds. Frames with actual bounds changes still trigger structural ops via
`structuralFrameDirty=true`. Idle frames (no bounds change) are now cheap.

### Live Probe Measurement — Task 1a

**Measurement context:** `avatar-main` canvas live, avatar visible, `hitTargetFrame: [1220, 778, 80, 80]`. `surfaceTransportProbe` enabled and reset on `avatar-main`. Measurement captured 2026-06-06 on branch `gdi/aos-one-world-phase3-surface-migration-v0` at commit `b2bc21ec`.

**Avatar visible, controls CLOSED — 8.7 seconds (~60fps idle):**

```json
{
  "render": {
    "frames": 251,
    "work": {"structural": 0, "overlay": 0, "publishState": 0, "visualOnly": 251}
  },
  "elapsed_ms": 8732
}
```

Result: 0% structural frames, 0 publishState calls. All 251 frames classified as `visualOnly` (avatar idle-motion aura). Cheap-reason promotion is working.

**Avatar visible, controls OPEN (panel canvas shown) — 8 seconds idle:**

```json
{
  "render": {
    "frames": 484,
    "work": {"structural": 0, "overlay": 0, "publishState": 0, "visualOnly": 0}
  },
  "elapsed_ms": 8056
}
```

Result: 484 frames, 0 structural, 0 publishState, 0 visualOnly. With controls open, the `avatar-controls` reason drives frames but all are cheap (structural=false, publishState=false). The render loop is running but at `visualOnly: 0` — the avatar-motion aura was paused while controls were open (expected behavior).

**Cross-canvas IPC from panel canvas (idle controls-open, 8 seconds):**

```json
{
  "panel_messages": {"sent": {}, "received": {}},
  "elapsed_ms": 8017
}
```

Result: 0 messages sent, 0 received during idle controls-open. No background polling traffic.

### Structural-% Gate Condition

Phase 0/1 baseline: structural-% = 100% for idle controls-open frames.
Phase 2 sub-task 1: structural-% = 100% (tracking-only kept structural=true).
Phase 3 (this card): structural-% = **0%** for idle controls-open frames.

**Deterministic proof:** test `render-loop: avatar-controls is cheap —
structural=false, publishState=false (Phase 3)` in
`tests/renderer/sigil-one-world-phase2-scheduler.test.mjs`.

**Bounds-change safety:** test `render-loop: avatar-controls + structuralDirty=true
→ publishState runs (panel bounds changed)` confirms structural ops run when needed.

---

## Task 1b: Scheduler delayMs/Throttle Support

**Delivered and committed.** Foreman's direction (session 2): add `delayMs`/throttle
support to `world-raf-scheduler.js` so the idle-motion throttle gap is closed and
the scheduler is ready for a clean main.js swap in a follow-on card. Do NOT wire
the scheduler into main.js in this card.

### What Changed

`apps/sigil/renderer/live-modules/world-raf-scheduler.js`:

- `createWorldRafScheduler` now accepts injectable `setTimeout`/`clearTimeout` (testable).
- `ContributorState` gains `delayTimer: unknown|null` and `delayPending: boolean`.
- `register()` returns `scheduleFrame(opts?: { delayMs?: number })`:
  - `delayMs > 0`: defers the RAF via setTimeout; repeated calls do not stack timers.
  - `delayMs: 0` (or omitted): cancels any pending delay and schedules immediately (preempts).
  - Mirrors `createRenderLoopScheduler` semantics (used at main.js:5099).
- `suspend()` cancels all contributor delay timers.
- `unregister()` cancels the contributor's delay timer.

`tests/renderer/sigil-one-world-phase2-scheduler.test.mjs`:

- 5 new tests covering: deferral, preemption, no-stack, suspend-cancel,
  unregister-cancel. All 26 tests pass (21 pre-existing + 5 new).

### Gap Closed

The `world-raf-scheduler` now matches the `delayMs` contract of
`createRenderLoopScheduler`. A clean main.js swap in a follow-on card can wire
`scheduleFrame({ delayMs: IDLE_AVATAR_MOTION_FRAME_DELAY_MS })` without regression.

---

## Task 2: Move Avatar Compact Controls Panel to a World Node

**Completed (Option A — code-complete; live drag pending).**

### Changes Made

**`main.js:982`** — `panelUrl` flipped from `SIGIL_AVATAR_PANEL_URL` to `null`:

```js
// Before:
panelUrl: SIGIL_AVATAR_PANEL_URL,

// After:
panelUrl: null, // One-World Phase 3: embedded path (usesPanel=false); panel canvas never created
```

This activates the existing embedded path in `surface.js:415`:
`usesPanel = typeof actionDispatcher === 'function' && !!panelUrl` → `false`

**`prewarmAvatarPanelCanvas()` in `main.js`** — early-return guard added:

```js
async function prewarmAvatarPanelCanvas() {
    // One-World Phase 3: embedded path active; no panel canvas to prewarm.
    if (!avatarControls.usesExternalPanel()) return;
    ...
```

Without this guard, the prewarm at `main.js:3571` would still create the panel canvas
even though `surface.js` never uses it (dangling orphan canvas).

**`tests/renderer/avatar-controls-hit-test.test.mjs`** — new test added:
`'embedded controls (panelUrl:null) activate embedded path and never dispatch panel actions'`

Constructs with a spy `actionDispatcher` + `panelUrl: null`, opens controls, drags a
slider, closes — then asserts:
- `usesExternalPanel() === false`
- No `panel.toggle` dispatch on open
- Slider commit applies geometry in-heap (`state.avatar.appearance.opacity === 0.42`)
- No `canvas.suspend`, `panel.close`, `canvas.resume` on close or during drag
- `panelOrCanvasActions` array is empty throughout the full cycle

### Why Prewarm Guard Is Necessary

`prewarmAvatarPanelCanvas` is called at `main.js:3571` every time the avatar becomes
visible on the primary segment. With `panelUrl: null`, `surface.js` would never use the
panel canvas — but the prewarm would still create it via `host.canvasCreate`. The created
canvas would be an unreachable orphan: no IPC routes to it, `avatarControls` never
toggles it, and `canvas_lifecycle` events for it would call `updatePanelFrame` on a
surface that's in embedded mode. The guard `if (!avatarControls.usesExternalPanel()) return`
makes the intent explicit and is reviewable as a migration boundary.

### What Is Verified (Code Path)

The embedded path (`usesPanel=false`) in `surface.js` is well-exercised by existing tests
and the new dispatcher-spy test:
- `openAt` calls `compactSurfaceSession.mount()` in-process (no `panel.toggle`)
- `handlePointerEvent → handleMenuPointer → elementAt(point)` routes slider drags via
  DOM coordinate dispatch — confirmed working in tests with stub `getBoundingClientRect`
- `onControlChange → routeDescriptor → updatePrimaryAppearance` — geometry change in-heap
- `close` does not dispatch `canvas.suspend` or `panel.close` when `usesPanel=false`
- `syncSnapshot` reports `surface: 'embedded'` (was `'toolkit-panel'`)

### What Is Not Yet Verified (Live Canvas)

The screen→DW→viewport coordinate transform used by `handleMenuPointer → elementAt(point)`
in production has not been exercised with a live canvas since the flip. Tests stub
`getBoundingClientRect` with fixed rects; the real transform depends on how `avatar-main`'s
viewport maps the embedded `compact-surface.js` DOM when controls are positioned at
non-origin DW coordinates.

Foreman step 3 (live drag verification) is the open gate before claiming IPC→0 on the
live surface.

### Discovery Context

See §Task 2 Discovery below for the full investigation that motivated Option A.

---

## Task 2 Discovery: The Embedded Path Already Exists

During feasibility investigation, GDI traced the full cross-canvas traffic loop and
discovered that the migration is structurally simpler than Foreman's instruction
anticipated.

### Cross-Canvas Traffic Loop (Current Production)

**Panel → Owner direction (82.8/s during drag):**

```
panel.js:onControlChange → sendToOwner(sigil.avatar_panel.control_change)
panel.js:onProjectionChange → sendToOwner(sigil.avatar_panel.projection_change)
(both immediately followed by) sendToOwner(sigil.avatar_panel.snapshot)
```

The `sendToOwner` calls at `panel.js:40-46` (via `window.webkit.messageHandlers.headsup`)
are the source of the 82.8/s cross-canvas IPC baseline.

**Owner → Panel direction:**

```
avatar-main receives sigil.avatar_panel.control_change
→ surface.js:handlePanelMessage
→ compactSurfaceSession.routeChangedControls   ← Foreman's cited line
  → routeDescriptor (applies geometry change in-heap)
  → syncState() (in-process: updates form controls)
  → publishSnapshot() (in-process: updates surfaceState.snapshot + liveJs.avatarControls)
```

**GDI's earlier characterization in §Task 1b + Task 2 Blocker was incorrect:**
`compact-surface-session.js:80` (`routeChangedControls → syncState + publishSnapshot`)
runs in `avatar-main` as the owner-side geometry apply — it is in-process and not a
cross-canvas IPC source. The actual cross-canvas traffic source is `panel.js:sendToOwner`.

**Foreman's cited path is partially correct:** it is the *owner-side application point*
that would be replaced by a direct in-heap subscription in the signal-store model.
But the IPC crosses in both directions; the panel-side `sendToOwner` is the dominant
traffic source.

### The Embedded Path

`surface.js:415`: `const usesPanel = typeof actionDispatcher === 'function' && !!panelUrl;`

When `panelUrl` is `null`/`undefined`, `usesPanel=false` and `surface.js:838-848` uses
`compactSurfaceSession.mount()` to render the panel DOM in-process inside `avatar-main`.
This path:

- Mounts `compact-surface.js` DOM in the `anchor` element of `avatar-main`
- Handles slider input via the existing `interactionRouter` / `handleMenuPointer` path
  (coordinate-based JS dispatch via `data-aos-slider-root`, no native DOM events needed)
- `onControlChange` → `routeDescriptor` → geometry change — **all in-heap**, 0 IPC
- `onProjectionChange` → `routeChangedControls` → `routeDescriptor` — **in-heap**
- `publishSnapshot` → `syncSnapshot` (in-process) — **in-heap**

The existing input-region mechanism (`SIGIL_AVATAR_CONTROLS_INPUT_REGION_ID`,
`priority:120`) already routes pointer events from the daemon to `avatar-main` when
controls are open. `handleMenuPointer` uses `elementAt(point)` — no native pointer
events needed, compatible with `avatar-main`'s `interactive:false` (passthrough).

**Setting `panelUrl: null` at `main.js:982` is the minimal migration change.**
It eliminates the panel canvas, routes control changes in-heap, and achieves
cross-canvas IPC → 0 by construction.

### Inputs to Foreman

#### Feasibility confirmation

1. **Co-location is feasible with no Swift change.** The embedded path runs in
   `avatar-main` using the existing input_region routing. No native window-semantics
   change needed. No new Swift logic.

2. **IPC → 0 is achievable by construction.** With `panelUrl:null`, no `sendToOwner`
   calls are ever made. No probe measurement needed to verify; the signal path is
   simply absent.

3. **Behavior parity (code-reading only — not live-verified this session):** slider drag
   calls `routeDescriptor` → geometry change → render. Tab changes, projection actions,
   and close behavior all have in-process equivalents in `compact-surface-session.js`.
   The `onControlChange` path at `compact-surface-session.js:134` calls `syncState()` +
   `publishSnapshot()` — both in-process. The unverified crux is whether
   `handleMenuPointer → elementAt(point)` delivers slider events at correct coordinates
   in the embedded viewport; this requires live canvas verification.

4. **The embedded path is untested.** No existing test exercises `usesPanel=false` in
   `surface.js`. The path exists and is structurally sound (it was the original path
   before the external panel was added), but has zero test coverage. There is bit-rot
   risk.

5. **The Phase 1/2 signal-store substrate is not used.** The embedded path achieves
   co-location without the `createAvatarSignalStore` / `createCoLocatedPanel` pattern
   from Phase 1. If the One-World substrate mandate requires the signal-store as a
   consistency layer (not just IPC→0), the signal-store should be inserted between
   `onControlChange` and `routeDescriptor` — the embedded path activates the co-location
   but doesn't prove the Phase 1 architectural pattern on a real surface.

---

## Decision Point for Foreman

The core question: **Option A or Option B for Task 2?**

**Option A: Activate the embedded path (`panelUrl: null` flip)**

Change: `main.js:982` from `panelUrl: SIGIL_AVATAR_PANEL_URL` to `panelUrl: null`.

- IPC → 0 immediately, by construction.
- No new infrastructure. Re-uses the existing `compactSurfaceSession.mount()` path.
- The panel canvas (`sigil-avatar-controls-avatar-main`) is never created.
- Behavior parity: same `compact-surface.js` renders, in-heap.
- Risk: embedded path is untested; bit-rot risk (see §Inputs to Foreman, point 4).
- Does NOT use Phase 1/2 signal-store substrate.
- **The `panelUrl: null` flip is the minimal change, but it is not trivially safe.**
  The unverified crux (see §Empirical Coverage below) is whether
  `handleMenuPointer → elementAt(point)` delivers slider drag events at correct
  coordinates when `compact-surface.js` is mounted into `avatar-main`'s viewport
  rather than a separate WKWebView. This requires a follow-on session to verify
  with live interaction before the gate measurement is valid.

**Option B: Activate embedded path + insert signal store**

Change: activate embedded path (Option A), then insert `createAvatarSignalStore`
between `onControlChange` and `routeDescriptor` in `compact-surface-session.js` (or
wrap the session in a `co-located-panel.js`-style owner layer).

- IPC → 0, same as Option A.
- Claims to prove the Phase 1/2 signal-store substrate on a real first-party surface.
- More code, more scope, consistent with Foreman's cited instruction.
- **Important caveat:** `co-located-panel.js:17-18` explicitly disclaims the signal
  store as throwaway scaffolding: *"The store is intentionally minimal and throwaway.
  It exists to prove the pair co-locates correctly. Do not commit to this as the Phase
  2 World substrate."* Building production code on `createAvatarSignalStore` contradicts
  its own documentation. If Foreman wants a real substrate layer (not the throwaway
  store), Option B is more scope than "insert `createAvatarSignalStore`" — it implies
  designing a production-grade signal substrate first.

**GDI's read:**

Option A satisfies the IPC gate. Option B as described (inserting the throwaway store)
contradicts the Phase 1 disclaimer and produces a production surface backed by a
scaffolding artifact. The three-way choice is:

1. **Option A**: IPC→0 via embedded path; no substrate layer; throwaway store not used.
2. **Option B-lite**: Same as A + throwaway store inserted; satisfies the pattern by the
   letter but contradicts the `co-located-panel.js` comment.
3. **Option B-full**: Design a production signal substrate, then use it here; out of scope
   for this card.

The Phase 3 goal contract (§2.2) states "cross-canvas IPC → 0" — not "use signal-store
substrate." Option A maps directly to that gate.

**Recommended:** Foreman resolve the option, then GDI follows up with: embed path
activation + test coverage for the untested path + live-canvas input-routing verification
(the unverified crux).

---

## Empirical Coverage (what was and was not verified live)

**Verified by live probe (session 2):**

- Controls-open idle: 484 frames, 0% structural, 0 publishState/s — cheap-reason
  promotion confirmed working in production.
- Controls-closed idle: 251 frames, 0% structural, 100% visualOnly — avatar motion
  correctly classified.
- Panel canvas idle: 0 cross-canvas messages observed.

**NOT verified by live measurement:**

- **Slider-drag IPC baseline**: The synthetic `./aos do drag` attempt routed the
  `left_mouse_down` to `avatar-main` (via SIGIL_AVATAR_CONTROLS_INPUT_REGION_ID),
  which interpreted it as "outside controls" and closed the panel. The screen↔DW
  coordinate transform was not resolved in this session. The 82.8/s baseline is
  documented in prior Phase 0/1 reports, not re-measured here.

- **Embedded path input routing**: Whether `handleMenuPointer → elementAt(point)`
  correctly dispatches to the in-viewport DOM when `compact-surface.js` renders inside
  `avatar-main` has not been exercised. This is the unverified crux for Task 2, and
  it must be confirmed with live interaction after any panelUrl:null flip, before the
  gate measurement is recorded.

- **Behavior parity (full)**: The embedded-path behavior claims (slider drag → geometry
  change → render; tab changes; projection actions; close) rest on code reading only.
  Live verification is deferred to the Task 2 follow-on session.

---

## Tests Run

### After Task 1a commit

```
node --test \
  tests/renderer/sigil-render-loop.test.mjs \
  tests/renderer/avatar-controls-hit-test.test.mjs \
  tests/renderer/sigil-surface-transport-probe.test.mjs \
  tests/renderer/sigil-one-world-co-location-probe.test.mjs \
  tests/renderer/sigil-one-world-phase2-scheduler.test.mjs \
  tests/renderer/sigil-one-world-extension-api.test.mjs
```

Result: `# tests 119 / # pass 119 / # fail 0`

### After Task 1b commit

```
node --test tests/renderer/sigil-one-world-phase2-scheduler.test.mjs
```

Result: `# tests 26 / # pass 26 / # fail 0` (5 new delayMs tests + 21 pre-existing)

Full suite: `# tests 1857 / # pass 1775 / # fail 82` (82 failures are pre-existing,
verified by stash-pop baseline comparison before Task 1b changes).

### After Task 2 commit

```
node --test \
  tests/renderer/sigil-render-loop.test.mjs \
  tests/renderer/avatar-controls-hit-test.test.mjs \
  tests/renderer/sigil-surface-transport-probe.test.mjs \
  tests/renderer/sigil-one-world-co-location-probe.test.mjs \
  tests/renderer/sigil-one-world-phase2-scheduler.test.mjs \
  tests/renderer/sigil-one-world-extension-api.test.mjs
```

Result: `# tests 125 / # pass 125 / # fail 0` (+1 embedded-path dispatcher-spy test)

Full suite: `# tests 1858 / # pass 1776 / # fail 82` (82 failures pre-existing, unchanged)

---

## Files Changed

| File | Change |
|---|---|
| `apps/sigil/renderer/live-modules/render-loop.js` | Promoted `avatar-controls` to cheap reason; `trackingOnlyReasons` empty; dead `trackingFrame` branch retained with comment |
| `tests/renderer/sigil-one-world-phase2-scheduler.test.mjs` | Updated 2 tests for Phase 3 cheap-reason classification; 5 new delayMs tests; load-bearing safety tests unchanged |
| `apps/sigil/renderer/live-modules/world-raf-scheduler.js` | Added injectable setTimeout/clearTimeout; per-contributor delayMs/throttle support in scheduleFrame(); suspend() and unregister() cancel pending timers |
| `apps/sigil/renderer/live-modules/main.js` | `panelUrl: null` flip (line 982); prewarm early-return guard via `usesExternalPanel()` |
| `tests/renderer/avatar-controls-hit-test.test.mjs` | New dispatcher-spy test for embedded path (`panelUrl:null`) — proves no panel/canvas actions dispatched through full open+drag+close cycle |
| `docs/dev/reports/aos-one-world-phase3-surface-migration-v0.md` | This report |

---

## Commits on Branch

| Ref | Message |
|---|---|
| `b2bc21ec` | `docs(reports): Phase 3 surface migration V0 evidence — partial result` |
| `678b92e5` (Task 1a) | `feat(sigil): Phase 3 cheap-reason promotion — avatar-controls → cheapFrameReasons` |
| `119bc304` (Task 1b) | `feat(world): Task 1b — add delayMs/throttle support to world-raf-scheduler` |
| `6a1ed64f` | `docs(reports): Phase 3 evidence update — Task 1b committed, live probe, Task 2 decision point` |
| `94efef92` | `docs(reports): Phase 3 — sharpen decision point with co-located-panel disclaimer and empirical coverage gaps` |
| (Task 2) | `feat(sigil): Phase 3 Task 2 — embedded avatar compact controls (panelUrl:null, prewarm guard)` |

---

## Recommended Next Steps

1. **Live canvas verification (Foreman step 3):** With the embedded path active, open
   avatar controls and perform a live slider drag. Confirm geometry updates and controls
   stay open (do not close on drag). Capture `surfaceTransportProbe` during drag — target:
   `control_change` + `snapshot` ≈ 0 (was 82.8/s baseline from Phase 0).
2. **Frame-timing**: Capture `render-performance` / `canvas-stats` before/after the
   embedded path activation — compare structural-% and publishState/s.
3. **main.js scheduler wiring (follow-on card):** Wire `scheduleFrame({ delayMs: IDLE_AVATAR_MOTION_FRAME_DELAY_MS })` now that `world-raf-scheduler.js` has delayMs support (Task 1b).
