# Implementer Work Card: AOS One-World Phase 3 — Surface Migration V0

## Routing Status

Accepted on `main` at `e2cde31d6fcc01ae911d00687ac38dc625037d59`.
Historical Phase 3 work card for the AOS One-World/toolkit substrate migration.
Do not redispatch this card as written; use it as context/evidence for follow-on
cards.

Framing: Sigil is the current validation experience and provides the concrete
first proving surface (`apps/sigil/...`). Ownership remains AOS One-World/toolkit
platform work, not standalone Sigil product feature work.

## Tracker

- Workstream goal contract: `docs/design/aos-surface-world-prompt-contract-v0.md`
- Handoff and code anchors: `docs/design/aos-surface-world-workstream-handoff-v0.md`
- Phase 2 sub-task 1 evidence: `docs/dev/reports/aos-one-world-phase2-sub-task1-scheduler-v0.md`
- Phase 2 work card (closed): `docs/design/work-cards/implementer-aos-one-world-phase2-world-substrate-v0.md`
- World extension API contract: `docs/api/world-extension-api-v0.md`
- Phase 0 measurement baseline: `docs/dev/reports/aos-surface-transport-stack-measurement-v0.md`
- Related parked card (not ready to route from this slice):
  `docs/design/work-cards/implementer-sigil-avatar-panel-resource-contract-migration-v0.md`

## Branch / Base

- `branch_from`: `implementer/aos-one-world-phase2-world-substrate-v0` (set at dispatch)
- `required_start_ref`: set at dispatch — base is the commit closing
  `implementer/aos-one-world-phase2-world-substrate-v0`
- `expected_output_branch`: `implementer/aos-one-world-phase3-surface-migration-v0`

Do not create linked worktrees. Use the single checkout at
`/Users/Michael/Code/agent-os`.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, checkout,
daemon, canvas, issue, or prior implementation state. Read and rediscover
before editing.

## What / Why (scope)

Phase 2 delivered the substrate Phase 3 needs:

- `apps/sigil/renderer/live-modules/world-raf-scheduler.js` — multi-contributor
  shared RAF scheduler. Tested and ready. Not yet wired to `main.js`; Phase 3
  wires it.
- `apps/sigil/renderer/live-modules/render-loop.js` — `trackingFrame`
  classification; `avatar-controls` skips `publishState` when no geometry
  changed. Gate 1b follow-on (`structuralFrameDirty = true` in the
  `canvas_lifecycle` handler) was applied separately at `b8f2dc65` and is
  already on main — Phase 3 can promote `avatar-controls` to a cheap reason.
- `apps/sigil/world/world-extension-api.js` — World extension API + theming
  contract (signal primitives, `mountWidget`, theming hooks).
- `apps/sigil/world/sample-widget/status-tile.js` — sample widget confirmed
  against the API by reviewer (no reach-through to renderer internals).
- `docs/api/world-extension-api-v0.md` — documented contract with internal
  boundary defined.

**Phase 3 is incremental: one surface per card.** This card scopes the
**first surface only**: the avatar compact controls panel
(`sigil-avatar-controls-avatar-main`). Subsequent surfaces get their own work
cards once this first migration is proven — behavior parity and the perf budget
measured, not assumed.

The avatar compact controls panel is the natural first migration target:
- Already co-location-probed in Phase 1 (cross-canvas IPC → 0 confirmed).
- Phase 2 built the exact substrate it needs (RAF scheduler + extension API).
- Highest measured traffic of any surface pair from Phase 0 (82.8 cross-canvas
  IPC messages/s during slider drag; 31 `publishState`/s).

## Window-Semantics Prerequisite Check

Per the goal contract §5:

> Move surfaces onto the World node-by-node … each only when its
> window-semantics need is shown unnecessary.

**This check is not skippable.** Before any migration work, confirm whether
the avatar compact controls panel requires OS-native window semantics that the
World cannot provide:

- Z-order interleaving with native app windows (above/below real app content)?
- Native title bar, native menu bar, macOS sheet attachment?
- OS-managed focus arbitration for this surface that cannot be provided by
  in-heap focus management?
- Any other macOS platform capability tied to an independent `NSWindow`?

The World sits above everything (except screensaver) by design — it is
above-everything transparent + passthrough-by-default. This means a World
node cannot be interleaved *below* a real app window. If the compact controls
panel ever needs to be sandwiched between native windows (e.g., to appear
below the currently focused app and above a background app), the World cannot
provide that.

Phase 1's co-location probe already validated that focus and fault behavior
for this pair are acceptable in a co-located document. That result informs
but does not substitute for this check — Phase 1 tested in-heap behavior;
this step confirms no OS-native window contract for this surface.

**If a window-semantics need is found:** stop, characterize the specific
requirement, and return the blocker to Foreman. Do not migrate the surface.
Choose the next surface candidate and characterize that one instead.

## What "Migration" Means for This Surface

Three tasks, sequenced:

### Task 1: Wire the Phase 2 RAF Scheduler into `main.js`

The Phase 2 scheduler (`world-raf-scheduler.js`) is tested and ready but not
connected to `main.js`'s render loop. Phase 3's first task is the integration.

Replace `main.js`'s current `renderLoop.schedule(…)` path with the
multi-contributor loop from `createWorldRafScheduler`. Code anchors:

- `apps/sigil/renderer/live-modules/main.js:543` — `scheduleRenderFrame`
  defaults `structural=true`; this is the call site to replace.
- `apps/sigil/renderer/live-modules/world-raf-scheduler.js` →
  `createWorldRafScheduler()`, `.register(name, { needsFrame, onFrame })`.
  Each contributor's `onFrame` receives `{ structural, contributors }` —
  `structural=true` if any contributor called `requestStructural()` since the
  last tick.

The Gate 1b bounds-dirty signal (`structuralFrameDirty = true` in the
`canvas_lifecycle` handler) is already applied at `b8f2dc65` (on main). With
that signal in place, `avatar-controls` can now be promoted from
`trackingOnlyReasons` to `cheapFrameReasons` in `render-loop.js`:
- Idle frames (no bounds change, no geometry event) become cheap
  (`structural=false`); structural ops run only when bounds actually changed.
- Confirm structural-% drops below 100% for true idle periods after this
  promotion.

### Task 2: Move the Avatar Compact Controls Panel to a World Node

Mount the avatar compact controls panel as a World node using the Phase 2
extension API. Code anchors:

- `apps/sigil/world/world-extension-api.js` → `mountWidget(host, factory,
  options)`, `createSignal`, `createComputed`, `createEffect`, `applyTheme`
- `apps/sigil/world/sample-widget/status-tile.js` — reference widget factory
  (no reach-through to renderer internals; follow this pattern)
- `apps/sigil/avatar-controls/compact-surface-session.js:80` —
  `routeChangedControls` → `syncState()` + `publishSnapshot()` — the
  cross-canvas traffic source being eliminated for this pair

The widget factory for the compact controls panel MUST use only the documented
extension API (per `docs/api/world-extension-api-v0.md` §5). It MUST NOT
import from `apps/sigil/renderer/live-modules/**`, `apps/sigil/avatar-editor/**`,
or toolkit JS internals.

State binding uses the in-heap signal store (`createSignal`, `createComputed`,
`createEffect`). Cross-canvas IPC between avatar owner and compact panel is
eliminated — no daemon serialization boundary between them in the co-located
document.

### Task 3: Measure and Confirm the Exit Gate

Re-run the Phase 0 probe instruments (`surfaceTransportProbe`) against the
migrated surface. Target: cross-canvas IPC between the migrated pair
approaches 0 under the stacked scenario. Compare against Phase 0 baselines.

## Per-Surface Exit Gate (checkable — from goal contract §5 and §2.3)

All three must hold before this card is closed:

1. **Behavior parity.** The migrated avatar compact controls panel behaves
   identically to the pre-migration panel for all user-facing interactions:
   slider drag updates avatar geometry, controls open/close correctly, focus
   and keyboard input reach the panel, and no interaction regression is
   introduced. Confirm by running existing avatar-controls acceptance tests
   and the Phase 0 probe scenario.

2. **Perf budget held.** The stacked scenario (Surface Inspector + avatar
   compact panel + slider drag) holds a measured per-frame budget. Confirm
   with two complementary instruments — do not declare parity without numbers
   from both:

   Transport metrics (via `surfaceTransportProbe`):
   - Cross-canvas IPC between the migrated pair approaches 0 (target:
     `control_change` + `snapshot` between owner and panel ≈ 0 vs Phase 0
     baseline of 82.8/s).
   - `publishState` is demand-driven: fires only when avatar geometry changes,
     not at the 31/s idle baseline.
   - Structural-frame-% drops below 100% for true idle periods (scheduler
     wired + `avatar-controls` promoted to cheap reason).

   Frame-timing (via `render-performance` / `spatial-telemetry` / `canvas-stats`
   telemetry per goal contract §6): record per-frame cost during the stacked
   scenario before and after migration. The migration must not inflate frame
   time. A flat or improved frame-time distribution is the budget-held
   confirmation.

3. **Window-semantics need shown unnecessary.** The prerequisite check (above)
   found no OS-native window semantics required for this surface, and the
   migrated panel runs correctly as a World node. If a window-semantics need
   was found, this exit gate condition is replaced by a blocker characterization
   returned to Foreman.

## Gate Failure Cases

**Window-semantics blocker:** If the prerequisite check finds a genuine
OS-native window semantics requirement, stop immediately. Characterize the
specific requirement, identify what the World cannot provide, and return to
Foreman. Select the next surface candidate.

**Behavior regression:** If any user-facing interaction breaks after migration
and cannot be resolved within this card's scope, stop. Document the regression,
return the constraint to Foreman, and do not close the gate.

**Perf regression:** If the stacked scenario does not hold the measured budget
after migration, stop. Return the probe data and the implied constraint to
Foreman. Do not adjust the budget to make the numbers fit.

Do not paper over gate failures with scope expansion.

## Backlog Items (from handoff §5 and Phase 2 report)

These items from the handoff and Phase 2 sub-task 1 report are tracked here
to prevent memory-hole loss. Phase 3 may partially address some; the rest
remain backlog for later cards.

**In scope for this card (Phase 3 may address or partially address):**

- **Shared interaction scheduler / priority tiers** (Direction D): interaction
  > app render > diagnostics. With the RAF scheduler wired to `main.js`, this
  tier model becomes local in-heap. Evaluate whether to wire priority tiers
  as part of the scheduler integration (Task 1). This is a Phase 3 candidate;
  do not build it if it expands scope materially.

- **Decompose the coarse structural render bundle** (§4B / Gate 1b follow-on):
  the bounds-dirty signal (`b8f2dc65`) is already on main. Completing this item
  requires promoting `avatar-controls` from `trackingOnlyReasons` to
  `cheapFrameReasons` in `render-loop.js` (Task 1). Required for the exit gate
  (structural-% below 100%).

- **Drain-paced daemon input coalescing** (Direction A): per-canvas
  backpressure, last-write-wins, opt-in raw. Now that Phase 0/1 measurements
  are complete (the gate condition), this is a Phase 3 candidate. Evaluate
  whether to include in this card or a follow-on. Do not build without
  confirming the measurement says this cost is real.

**Remain backlog (not in scope for this card):**

- **Preview/commit protocol class** (Direction C): tag messages as coalescible
  signal vs reliable commit. Phase 3+ candidate; separate card.
- **Retire `sigil.avatar_panel.*`; promote visual-object descriptor contract**
  (Direction E): Phase 3+ track.
- **Reactive signals core swap** (Direction F): swap Phase 2's hand-rolled
  signals for a vetted ESM library when one is added to the approved dependency
  list. API surface unchanged; implementation-only swap.
- **Panel-bounds-dirty signal** (from Phase 2 §Gate 1b Gap): already resolved
  on main at `b8f2dc65`. No action needed in this card.
- **Browser-overlay CDP geometry stream** (★): owner-flagged must-not-lose.
  Separate track; not Phase 3 scope.
- **Focus-group manager, Tab-loop trap, per-panel focus memory**: backlog.
- **CONTEXT.md term collisions**: Phase 4 governance pass.

## Code Anchors

Use these instead of re-searching.

Phase 2 substrate (new in Phase 2, wired here):
- World RAF scheduler: `apps/sigil/renderer/live-modules/world-raf-scheduler.js`
  → `createWorldRafScheduler()`, `.register(name, { needsFrame, onFrame })`
- Render-loop classification (tracking-only tier):
  `apps/sigil/renderer/live-modules/render-loop.js` → `classifyRenderLoopWork`,
  `trackingOnlyReasons`
- World extension API entry: `apps/sigil/world/world-extension-api.js`
  → `createSignal`, `createComputed`, `createEffect`, `mountWidget`,
  `applyTheme`, `readToken`
- Sample widget (reference for extension API usage):
  `apps/sigil/world/sample-widget/status-tile.js`

Phase 3 integration points (the wiring sites):
- `scheduleRenderFrame` defaults `structural=true`:
  `apps/sigil/renderer/live-modules/main.js:543`
- Structural block (`overlay.draw`, `publishState`, `polyGroup.scale`):
  `apps/sigil/renderer/live-modules/main.js` ~5001–5057
- `canvas_lifecycle` handler / `updatePanelFrame` call:
  `apps/sigil/renderer/live-modules/main.js` ~4490
  (`structuralFrameDirty = true` already added at `b8f2dc65`)
- Owner subscribes `input_event`:
  `apps/sigil/renderer/live-modules/main.js:4729`
- Compact surface session (cross-canvas traffic source being eliminated):
  `apps/sigil/avatar-controls/compact-surface-session.js:80`

Probe instruments:
- `apps/sigil/renderer/live-modules/surface-transport-probe.js`
  (`surfaceTransportProbe`, `in_heap` counters added in Phase 1)
- Phase 0 baselines: `docs/dev/reports/aos-surface-transport-stack-measurement-v0.md`

Transport boundary (for reference, not for direct modification):
- WKWebView bridge: `apps/sigil/renderer/live-modules/host-runtime.js`
- Daemon input fan-out: `src/daemon/unified.swift` →
  `forwardInputEventToCanvases` (799–811), `broadcastInputEvent` (3494)
- Canvas eval delivery: `src/display/canvas.swift` →
  `postMessageAsync`/`evalAsync` (2299–2308)

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `docs/design/aos-surface-world-prompt-contract-v0.md` (§2.3 Done conditions,
  §3 invariants, §5 phase gates)
- `docs/design/aos-surface-world-workstream-handoff-v0.md` (§4 sequencing,
  §5 backlog, §6 code anchors, §7 guardrails)
- `docs/dev/reports/aos-one-world-phase2-sub-task1-scheduler-v0.md` (scheduler
  design, Gate 1b gap, wiring state)
- `docs/api/world-extension-api-v0.md` (extension API contract and internal
  boundary — Phase 3 surfaces must build against this)
- `docs/adr/0015-aos-tcc-capability-broker-boundary.md`
- `docs/adr/0012-toolkit-platform-strategy.md`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD
./aos ready --json
./aos status --json
./aos show list --json
./aos dev recommend --json --paths apps/sigil/renderer/live-modules/main.js,apps/sigil/renderer/live-modules/world-raf-scheduler.js,apps/sigil/renderer/live-modules/render-loop.js,apps/sigil/world/world-extension-api.js,apps/sigil/avatar-controls/compact-surface-session.js,apps/sigil/renderer/live-modules/surface-transport-probe.js
```

## Scope

Allowed:
- Window-semantics prerequisite check for the avatar compact controls panel
- Wiring `world-raf-scheduler.js` into `main.js` to replace the current
  `renderLoop.schedule` path
- Promoting `avatar-controls` from `trackingOnlyReasons` to `cheapFrameReasons`
  in `render-loop.js` (bounds-dirty signal already on main; promotion completes
  the structural-bundle decomposition)
- Moving the avatar compact controls panel to a World node using the Phase 2
  extension API (`mountWidget`, signal primitives, theming)
- Adjustments to the probe instruments as needed to instrument the co-located
  path (minimal; do not rearchitect the probe surface)
- Focused tests for the scheduler wiring, cheap-reason promotion, and migrated
  surface binding
- Evidence report recording per-surface exit gate measurements

Native boundary:
- Do not add new Swift logic to support the migration
- If Swift changes are required, stop with `foreman_rebuild_needed`
- The daemon remains the sole privileged broker; do not route co-located
  surface communication through the daemon

## Hard Boundaries / Non-Goals

This work card does NOT cover:

- Migrating surfaces beyond the avatar compact controls panel — subsequent
  surfaces get their own cards once this first migration is proven
- ADR / CONTEXT / ARCHITECTURE governing-doc edits (Phase 4, owner-approved)
- Sigil-as-content migration: avatar renderer as World entities
  (Phase 5 / `implementer-sigil-avatar-panel-resource-contract-migration-v0`)
- GPU resource pool / visual-object descriptor migration (Phase 5)
- The CDP browser-overlay geometry-stream upgrade (backlog ★, not lost)
- Focus-group manager, Tab-loop trap, per-panel focus memory (backlog)
- Retiring `sigil.avatar_panel.*` (backlog Direction E)
- Opening a PR or pushing

## Guardrails

- **Window-semantics check is not skippable.** Per the goal contract, a surface
  migrates only when its window-semantics need is shown unnecessary. Confirm
  this for the avatar compact controls panel before writing any migration code.
- **Measure before declaring parity.** Run `surfaceTransportProbe` and record
  numbers. Do not declare the exit gate met without probe data.
- **The One-World proposal is a PROPOSAL.** Do not start ripping out ADRs or
  editing CONTEXT/ARCHITECTURE. Governing-doc edits wait for the
  owner-approved governance pass (Phase 4).
- **The daemon stays the sole privileged broker** (ADR-0015). The migration
  removes the in-heap serialization overhead between co-located surfaces; it
  does not bypass the daemon for input arbitration or native capability.
- **Don't over-build.** Wire the scheduler and move the surface. Interaction
  priority tiers (Direction D) and daemon coalescing (Direction A) are
  Phase 3 candidates only if scope permits; they are not required for the
  exit gate.
- **Durable artifacts live in the repo**, not in chat or model-local memory,
  so any stack can continue.

## Verification

Run focused deterministic checks for any touched JS:

```bash
node --test tests/renderer/sigil-render-loop.test.mjs \
             tests/renderer/avatar-controls-hit-test.test.mjs \
             tests/renderer/sigil-surface-transport-probe.test.mjs \
             tests/renderer/sigil-one-world-co-location-probe.test.mjs \
             tests/renderer/sigil-one-world-phase2-scheduler.test.mjs
git diff --check
```

If Phase 3 adds new modules or touches additional modules with existing tests,
run those focused tests too.

If `./aos ready --json` is ready after the scheduler wiring and surface
migration, run the stacked probe scenario (Surface Inspector + avatar compact
panel + slider drag) and record:
- Transport metrics via `surfaceTransportProbe`: `publishState`/s,
  structural-frame-%, `control_change`/s vs Phase 0/1 baselines
  (31/s publishState, 82.8/s cross-canvas IPC).
- Frame-timing via `render-performance` / `spatial-telemetry` / `canvas-stats`
  telemetry: per-frame cost before and after migration. Record both; the exit
  gate requires both.

If live readiness reports a TCC or input-tap blocker, stop with:

```bash
the manual TCC blocker report path
```

## Completion Report

Return a path-scoped summary with:

- branch/head used
- files changed (including test files)
- window-semantics check result for the avatar compact controls panel
- Task 1 outcome: scheduler wiring approach, `avatar-controls` cheap-reason
  promotion, structural-% measurement under idle controls-open frames
- Task 2 outcome: migration approach, extension API symbols used, how the
  widget factory is structured
- Probe measurements under the stacked scenario vs Phase 0 baselines:
  `control_change`/s, `snapshot`/s, `publishState`/s, structural-frame-%;
  frame-timing distribution (render-performance / spatial-telemetry / canvas-stats)
  before and after migration
- Exit gate assessment: did all three conditions hold?
- Any gate failure and characterization of the blocker
- Exact tests run and results
- Live AOS result or readiness blocker
- Backlog items addressed or promoted during this slice
- Recommended next surface candidate for Phase 3 (if this gate passed)
