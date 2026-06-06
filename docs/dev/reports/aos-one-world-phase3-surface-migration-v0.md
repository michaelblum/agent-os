# AOS One-World Phase 3 — Surface Migration V0

Date: 2026-06-06

Branch: `gdi/aos-one-world-phase3-surface-migration-v0`

Start ref: `678b92e57851c68decc1e3d5a0ad215ae8090ec8`

Head ref: `0e919f9d90dc584c7d25d2e37d845f982e75cb42`

## Status

`partial` — Window-semantics check passed. Task 1a (cheap-reason promotion) committed
and deterministically verified. Task 1b (scheduler wiring into main.js) and Task 2
(avatar compact panel World node migration) returned to Foreman with a coupled
blocker. See §Task 1b + Task 2 Blocker and §Gate Failure Cases.

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

The above-everything transparent model is the World's native affordance. The compact
controls panel does not require the interleaving (below-app placement) capability that
the World cannot provide. Migration is not blocked by window semantics.

---

## Task 1a: Cheap-Reason Promotion

**Delivered and committed.**

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

### Structural-% Gate Condition

Phase 0/1 baseline: structural-% = 100% for idle controls-open frames.
Phase 2 sub-task 1: structural-% = 100% (tracking-only kept structural=true).
Phase 3 (this card): structural-% = 0% for idle controls-open frames (structural=false).

**Deterministic proof:** test `render-loop: avatar-controls is cheap —
structural=false, publishState=false (Phase 3)` in
`tests/renderer/sigil-one-world-phase2-scheduler.test.mjs` asserts:
- `result.structural === false` for `['avatar-controls']` + `structuralDirty=false`
- `result.publishState === false`

**Bounds-change safety:** test `render-loop: avatar-controls + structuralDirty=true
→ publishState runs (panel bounds changed)` confirms:
- `result.structural === true` for `['avatar-controls']` + `structuralDirty=true`
- `result.publishState === true`

**Live measurement:** a live probe run was attempted but disrupted by a canvas
reload sequence that broke the WKWebView bridge context. The deterministic unit-test
proof covers the classification gate condition. A live structural-% measurement
can be recorded in a follow-on session once the canvas is operational.

---

## Task 1b: Scheduler Wiring into main.js

**Not completed. Returned to Foreman.**

See §Task 1b + Task 2 Blocker.

---

## Task 2: Move Avatar Compact Controls Panel to a World Node

**Not completed. Returned to Foreman.**

See §Task 1b + Task 2 Blocker.

---

## Task 1b + Task 2 Blocker

Both Task 1b and Task 2 share a coupled blocker. They are returned to Foreman
together.

### 1. Extension API Boundary vs. Existing Panel Implementation

Task 2 requires building a widget factory for the compact controls panel using
only the documented extension API (per `docs/api/world-extension-api-v0.md` §5).

The extension API §5 forbids imports from:
- `apps/sigil/avatar-editor/**`
- `apps/sigil/avatar-controls/**`
- `packages/toolkit/**` JS modules

The existing compact controls panel (`apps/sigil/avatar-editor/compact-surface.js`)
is built entirely from these forbidden dependencies: it imports toolkit controls
(sliders, checkboxes, selects), uses `avatar-controls/descriptors.js` for the
control schema, and uses `avatar-controls/surface-view-model.js` for the view model.

Under the §5 boundary, "move the panel to a World node" = reimplement the full
four-tab panel (Shape/Look/Effects/World) against a ~120-line signals core, without
any toolkit controls. This is a multi-day rewrite, not the "narrowest correct change"
that GDI owns.

**The discriminating question for Foreman:** does Phase 3 V0 require full four-tab
panel parity from a fresh World-API-compliant widget factory? Or is a minimal
co-located binding that drives the *measured slider-drag scenario's* cross-canvas
IPC to ~0 sufficient, with full parity deferred to follow-on cards?

The exit gate only measures slider-drag IPC. A minimal binding that wraps the
existing `compact-surface.js` with an in-heap signal channel (without rebuilding
the panel from scratch) might satisfy the cross-canvas IPC → 0 measurement while
deferring the full extension API compliance to a subsequent card.

### 2. Scheduler Wiring Has No Co-Located Payoff Without Task 2

The `world-raf-scheduler` was designed for a multi-contributor co-located loop.
Its structural-merge only adds value when a second contributor (`panel-ui`) exists
in the same document. With only the `avatar-scene` contributor, the scheduler's
behavior is identical to the existing `renderLoop.schedule` path + `classifyRenderLoopWork`.

Additionally, the current `renderLoop.schedule` supports `delayMs` for idle-motion
throttling (main.js:5099: `delayMs: work.visualOnly ? IDLE_AVATAR_MOTION_FRAME_DELAY_MS : 0`).
The `world-raf-scheduler` has no delay/throttle concept. A naive swap would lose
idle-motion throttling — a frame-behavior regression that exit-gate condition 2 forbids.
Closing this gap requires extending the scheduler, which is scope expansion on the
central `animate()` loop for no co-located payoff.

Task 1b is gated on Task 2's scope resolution.

---

## Gate Assessment

| Gate condition | Status |
|---|---|
| Window-semantics need shown unnecessary | ✓ PASSED |
| Structural-% drops below 100% for idle controls-open | ✓ PASSED (deterministic unit-test proof; live measurement disrupted) |
| Cross-canvas IPC approaches 0 during slider drag | BLOCKED — Task 2 not started |
| publishState demand-driven | ✓ Preserved from Phase 2 sub-task 1 |
| Behavior parity | N/A — migration not performed |
| Frame-time distribution (render-performance / canvas-stats) | N/A — requires live canvas and migration |

---

## Tests Run

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

(85 + 34 — note: 85 from the first 5 files, 34 from extension API)

---

## Files Changed

| File | Change |
|---|---|
| `apps/sigil/renderer/live-modules/render-loop.js` | Promoted `avatar-controls` to cheap reason; `trackingOnlyReasons` empty; dead `trackingFrame` branch retained with comment |
| `tests/renderer/sigil-one-world-phase2-scheduler.test.mjs` | Updated 2 tests to reflect Phase 3 cheap-reason classification; load-bearing safety tests unchanged |

---

## Backlog Items Addressed

- **Decompose the coarse structural render bundle** (§4B / Gate 1b follow-on, handoff §5):
  Completed for the `avatar-controls` case. Structural-% drops to 0% for true idle
  controls-open periods. The `overlay.draw` / structural-frame bundle item is now
  fully addressed for this surface: both `publishState` (Phase 2) and `structural`
  (Phase 3) are demand-driven for avatar-controls-idle frames.

## Backlog Items Not Addressed

- **Task 1b + Task 2 blocker**: Returned to Foreman with discriminating question
  (see §Task 1b + Task 2 Blocker).
- **Probe transport metrics**: Cross-canvas IPC → 0 measurement requires Task 2.
- **Frame-timing before/after**: Requires Task 2 and live canvas.
- All other backlog items from the work card remain unchanged.

---

## Recommended Next Surface Candidate

Not applicable — the first surface (avatar compact controls) was not migrated.
Foreman should resolve the Task 2 scope question before routing a follow-on card
for this surface or selecting a different first surface.

The simplest next-surface candidate (if the compact controls scope question is
deferred) would be a surface with no toolkit control dependencies and a simpler
interaction model — such as a diagnostic chip or status overlay — that could
be built as a clean World-API-compliant widget without requiring a parallel
panel reimplementation.
