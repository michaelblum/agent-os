# Implementer Work Card: AOS One-World Phase 2 — World Substrate V0

## Routing Status

Planned — Phase 2 of the AOS One-World workstream. Unblocked by Phase 1.
Not yet dispatched.

## Tracker

- Workstream goal contract: `docs/design/aos-surface-world-prompt-contract-v0.md`
- Handoff and code anchors: `docs/design/aos-surface-world-workstream-handoff-v0.md`
- Phase 1 evidence report: `docs/dev/reports/aos-one-world-phase1-co-location-probe-v0.md`
- Phase 1 work card (closed): `docs/design/work-cards/implementer-aos-one-world-phase1-co-location-probe-v0.md`
- Phase 0 measurement: `docs/dev/reports/aos-surface-transport-stack-measurement-v0.md`
- Related parked card (not ready to route from this slice):
  `docs/design/work-cards/implementer-sigil-avatar-panel-resource-contract-migration-v0.md`

## Branch / Base

- `branch_from`: `implementer/aos-one-world-phase1-co-location-probe-v0` (set at dispatch)
- `required_start_ref`: set at dispatch — base is the commit closing
  `implementer/aos-one-world-phase1-co-location-probe-v0`
- `expected_output_branch`: `implementer/aos-one-world-phase2-world-substrate-v0`

Do not create linked worktrees. Use the single checkout at
`/Users/Michael/Code/agent-os`.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, checkout,
daemon, canvas, issue, or prior implementation state. Read and rediscover
before editing.

## What / Why (scope)

Phase 1 confirmed the co-location premise on one pair:

- Cross-canvas IPC between avatar owner and compact panel → 0 when the two
  layers share one WKWebView document with an in-heap signal store
- In-heap delivery: N writes → N applied, synchronous, 0 drops (Node + live
  WKWebView confirmed)
- Fault isolation acceptable; focus behavior correct by design (single document)
- The 31/s `publishState` (owner→daemon display-compositor path) is **not**
  affected by pair co-location — it persists because `scheduleRenderFrame`
  defaults `structural=true` (main.js:536), so every avatar frame marks
  structural and runs `overlay.draw` + `publishState` unconditionally. This
  is a render-loop concern, not a panel↔owner IPC concern.

Phase 1's signal store (`avatar-signal-store.js`) is **throwaway** — it proved
the premise, not the substrate.

Phase 2 builds the minimal World substrate: one heap/scene/scheduler/resource
pool for first-party surfaces, plus the extension API + theming contract that
the owner's "make your own panels/widgets/dashboards, custom-themed" goal
entirely depends on. This is the workstream's identified long pole — the
extension API does not exist yet.

Two sub-tasks, sequenced:

1. **Shared RAF scheduler** — addresses the remaining overhead from Phase 1;
   narrower and buildable before the full substrate.
2. **Extension API + theming contract** — the long pole; also folds in a
   minimal scene model and resource pool scoped to light surfaces.

## Sub-task 1: Shared RAF Scheduler

### What

A minimal shared `requestAnimationFrame` scheduler for the co-located document
so the avatar scene and panel UI can both register with one loop. The avatar
owner and co-located panel currently share a document (Phase 1) but do not
share a render loop — each drives its own RAF timing, and the structural
over-mark (`scheduleRenderFrame` defaulting `structural=true`) causes every
frame to run `overlay.draw` + `publishState` regardless of whether avatar
geometry changed.

With a shared loop, panel-only frames that touch no avatar geometry can skip
`publishState` — moving the structural flag from a hard default to a
demand-driven annotation.

This is the Phase 1 report's recommended Phase 2 first step (§Recommended
Phase 2 First Step). It is also the path to delivering the "decompose the
coarse structural render bundle" backlog item (handoff §5).

### Exit Gate (checkable)

All three must hold:

1. **publishState/s drops under a panel-only interaction.** During a
   panel-only interaction (no avatar geometry change), `publishState`/s
   measurably drops below the Phase 0/1 baseline of 31/s. Structural-frame-% 
   also drops below 100%. Confirm with the existing probe instruments.

2. **Avatar-scale-drag parity.** During an avatar scale drag, structural
   frame rate and `publishState`/s are at parity with the Phase 0/1 baseline
   — the shared loop does not regress avatar render behavior.

3. **Focused tests pass.** Deterministic tests cover the scheduler's
   frame-registration contract and the structural-flag demand-driven path.

### Gate Failure Case

If a shared RAF loop cannot be wired to the existing `scheduleRenderFrame` /
structural-flag path without breaking avatar render behavior, or if the
structural over-mark cannot be made demand-driven without a larger refactor of
the render path, stop and characterize the blocker. Do not paper over it with
scope expansion. Return the failure evidence and the implied constraint to
Foreman before routing sub-task 2.

## Sub-task 2: Extension API + Theming Contract

### What

A documented World extension API + theming contract such that a
third-party-shaped widget/panel/dashboard can be built against it, custom-
themed, without reaching into renderer/runtime internals.

This sub-task also establishes the minimal scene model (surface-mounting
contract, not GPU object graph) and a minimal resource pool scoped to light
surfaces, because the API must expose a scene to mount a widget into and a
pooled resource model. Scope these as minimal-for-light-surfaces only — the
visual-object/GPU resource migration is a separate, larger track (Phase 5 /
`implementer-sigil-avatar-panel-resource-contract-migration-v0`).

Signal store choice is resolved here. Phase 1's `avatar-signal-store.js` is
throwaway. ADR-0012 warns against a bespoke reactive framework; prefer a tiny
standalone signals library over hand-rolling reactivity. Evaluate a tiny
standalone library (Solid signals, Vue `@vue/reactivity`, TC39 signals-adjacent,
or similar) against a minimal hand-rolled option. Decide and document in the
artifact — do not defer this decision past sub-task 2.

The architecture proposal (`docs/design/aos-one-world-architecture-proposal-v0.md`)
contains the extension-API discussion; read it as input to the contract design,
not as a committed specification.

### Exit Gate (checkable — from §5 of the goal contract)

All three must hold:

1. **Contract documented.** A written World extension API + theming contract
   exists in the repo at a stable path. It specifies what the extension API
   exposes, what theming hooks exist, and what "reaching into internals" means
   (the boundary a third-party author must not cross).

2. **Sample widget built against the API.** A sample widget or panel —
   third-party-shaped, meaning it does not import renderer or runtime internals
   directly — is built and runs in a co-located World document, custom-themed.

3. **Reviewer confirms no reach-through.** A reviewer (not the implementing
   session) confirms the sample widget uses only the documented API surface
   and does not reach into renderer or runtime internals.

### Gate Failure Case

If the extension API cannot be exposed without leaking renderer or runtime
internals — i.e., a third-party-shaped widget cannot be built without internal
imports — that is honest failure that reshapes the substrate design. Stop,
characterize which internal boundary is unavoidably crossed and why, and return
the constraint to Foreman. Do not widen the API boundary to make the sample
pass; call the blocker for what it is.

## Phase 2 Exit Gate (checkable — from goal contract §5)

Satisfied when both sub-task exit gates hold:

> A sample widget is built against the API and themed, by someone not reaching
> into internals.

This is the end-to-end confirmation that the substrate is real.

## The Long Pole Acknowledged

The extension API + theming contract (sub-task 2) is what the owner's "make
your own panels/forms/dashboards/widgets, custom-themed" goal entirely depends
on. It does not exist. Until it does, "extend by programming against the World"
is not a real claim. Sub-task 1 is narrower and can complete first; sub-task 2
is what Phase 2 actually delivers.

Phase 2 exit unlocks Phase 3 (incremental first-party migration, surface by
surface). Phase 3 is not in scope here.

## Backlog Items — Must Not Fall Into a Memory Hole

From handoff §5. Preserve and convert to issues or work cards as they get
routed. Sub-task 1 may deliver the structural-bundle decomposition item
directly; note that when routing.

- **Drain-paced daemon input coalescing** (review Direction A): per-canvas
  backpressure, last-write-wins, opt-in raw. Phase 2/3 candidate; gated on
  Phase 0/1 measurements already complete.
- **Decompose the coarse structural render bundle** (review §2.3/§4B): overlay
  redraw + `publishState` unconditional on structural frame; transform edit
  over-marks. Sub-task 1 may address this directly.
- **Preview/commit protocol class** (review Direction C): tag messages as
  coalescible signal vs reliable commit. Phase 2/3 candidate.
- **Shared interaction scheduler / priority tiers** (review Direction D):
  interaction > app render > diagnostics. In the World this is local. Adjacent
  to sub-task 1.
- **Retire `sigil.avatar_panel.*`; promote visual-object descriptor contract**
  (review Direction E): owner→view accepted-state echo + origin identity.
- **Reactive signals core** (review Direction F): Phase 1's throwaway store is
  the placeholder; resolved in sub-task 2.
- **★ Browser-overlay CDP geometry stream** (scroll-locked overlays): owner
  explicitly does not want this lost. Separate track; not in Phase 2 scope.
- **Focus model**: focus-group manager, Tab-loop trap, per-panel focus memory,
  passthrough-drives-key-window seam. Not Phase 2.
- **CONTEXT.md term collisions**: "Layer", "Control", "surface". Resolve at
  Phase 4 governance pass.

## Code Anchors

Use these instead of re-searching.

Render path (sub-task 1 starting points):
- `scheduleRenderFrame` defaults `structural=true`: `apps/sigil/renderer/live-modules/main.js:536`
- Structural block (`overlay.draw`, `desktopWorldSurface.publishState`,
  `polyGroup.scale.setScalar` — scale outside the gate):
  `apps/sigil/renderer/live-modules/main.js` ~5001+
- Frame classification: `apps/sigil/renderer/live-modules/render-loop.js` →
  `classifyRenderLoopWork`
- Owner subscribes `input_event`: `apps/sigil/renderer/live-modules/main.js:4729`

Phase 1 prototype artifacts (build on or supersede):
- `apps/sigil/avatar-editor/avatar-signal-store.js` — throwaway signal store
- `apps/sigil/avatar-editor/co-located-panel.js` — co-location prototype
  (`createPanelLayer`, `createOwnerLayer`, `createCoLocatedPanel`)
- `apps/sigil/avatar-editor/co-located-panel.html` — WKWebView entrypoint
- `apps/sigil/renderer/live-modules/surface-transport-probe.js` — probe with
  `in_heap` counters added in Phase 1

Controls and panel:
- Slider change vs commit + silent setValue:
  `packages/toolkit/controls/slider.js:163–190, 300–309`
- Panel drag (uncoalesced daemon global input):
  `packages/toolkit/panel/chrome.js` → `wireDrag` (1608+)
- Owner-side routing + dedupe + publishSnapshot:
  `apps/sigil/avatar-controls/compact-surface-session.js:80`
- Scale descriptor:
  `apps/sigil/avatar-controls/descriptors.js:207`, hook 365–367

Transport boundary:
- WKWebView bridge: `apps/sigil/renderer/live-modules/host-runtime.js`
- Daemon input fan-out: `src/daemon/unified.swift` →
  `forwardInputEventToCanvases` (799–811), `broadcastInputEvent` (3494)
- Canvas eval delivery: `src/display/canvas.swift` →
  `postMessageAsync`/`evalAsync` (2299–2308)

Governing docs:
- `ARCHITECTURE.md` (surface ownership boundary §, Union/DesktopWorld §5)
- `docs/adr/0012-toolkit-platform-strategy.md`
- `docs/adr/0015-aos-tcc-capability-broker-boundary.md`

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `docs/design/aos-surface-world-prompt-contract-v0.md` (§2 Done conditions,
  §3 invariants, §5 phase gates)
- `docs/design/aos-surface-world-workstream-handoff-v0.md` (§3 decided vs
  proposed, §4 sequencing, §5 backlog, §7 guardrails)
- `docs/dev/reports/aos-one-world-phase1-co-location-probe-v0.md` (Phase 1
  outcomes, baselines, recommended Phase 2 first step)
- `docs/design/aos-one-world-architecture-proposal-v0.md` (extension-API
  discussion — input for sub-task 2, NOT accepted specification)
- `docs/adr/0012-toolkit-platform-strategy.md`
- `docs/adr/0015-aos-tcc-capability-broker-boundary.md`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD
./aos ready --json
./aos status --json
./aos show list --json
./aos dev recommend --json --paths apps/sigil/renderer/live-modules/main.js,apps/sigil/renderer/live-modules/render-loop.js,apps/sigil/avatar-editor/co-located-panel.js,apps/sigil/avatar-editor/avatar-signal-store.js,apps/sigil/renderer/live-modules/surface-transport-probe.js,apps/sigil/avatar-controls/compact-surface-session.js
```

## Scope

Allowed:
- A shared RAF scheduler for the co-located document (sub-task 1)
- Adjustments to `scheduleRenderFrame` to move structural from default to
  demand-driven, scoped to the co-located document
- Probe/test additions for the scheduler and structural-flag path
- A documented World extension API + theming contract (sub-task 2)
- A minimal scene model (mounting contract for light surfaces, not GPU object
  graph)
- A minimal resource pool scoped to light surfaces
- Signal store resolution: evaluate a tiny standalone signals library vs
  hand-rolled; decide and document
- A sample widget/panel built only against the documented API, custom-themed,
  with no direct imports from renderer or runtime internals
- Focused tests for the above

Native boundary:
- Do not add new Swift logic to support the co-located document or the
  extension API
- If Swift changes are required, stop with `foreman_rebuild_needed`
- The daemon remains the sole privileged broker; do not route co-located
  surface communication through the daemon

## Hard Boundaries / Non-Goals

This work card does NOT cover:

- ADR / CONTEXT / ARCHITECTURE governing-doc edits (Phase 4, owner-approved)
- Sigil-as-content migration: avatar renderer as World entities
  (Phase 5 / `implementer-sigil-avatar-panel-resource-contract-migration-v0`)
- Incremental first-party surface migration (Phase 3)
- GPU resource pool / visual-object descriptor migration (Phase 5)
- Retiring `sigil.avatar_panel.*` (backlog Direction E; Phase 3+)
- The CDP browser-overlay geometry-stream upgrade (backlog ★, not lost)
- Focus-group manager, Tab-loop trap, per-panel focus memory (backlog)
- Committing to a signals library before evaluating options in sub-task 2
- Opening a PR or pushing

## Guardrails

- **The One-World proposal is a PROPOSAL.** Do not start ripping out ADRs
  or editing CONTEXT/ARCHITECTURE. Governing-doc edits wait for the
  owner-approved governance pass (Phase 4).
- **Phase 1's signal store is throwaway.** Do not build on
  `avatar-signal-store.js` as the Phase 2 substrate. Evaluate options and
  decide in sub-task 2.
- **Don't over-build reactivity.** ADR-0012 warns against a bespoke
  reactive framework. Prefer a tiny standalone signals lib over hand-rolling.
  Evaluate first; do not commit to a library until sub-task 2.
- **The daemon stays the sole privileged broker** (ADR-0015). The substrate
  removes in-document serialization overhead; it does not bypass the daemon
  for input arbitration or native capability.
- **The long pole is the API, not the scheduler.** Sub-task 1 is addressable
  first; but Phase 2 is not complete until sub-task 2's exit gate holds. Do
  not declare Phase 2 done on sub-task 1 alone.
- **Durable artifacts live in the repo**, not in chat or model-local memory,
  so any stack can continue.

## Verification

Run focused deterministic checks for any touched JS:

```bash
node --test tests/renderer/sigil-render-loop.test.mjs \
             tests/renderer/avatar-controls-hit-test.test.mjs \
             tests/renderer/sigil-surface-transport-probe.test.mjs \
             tests/renderer/sigil-one-world-co-location-probe.test.mjs
git diff --check
```

If sub-task 1 or 2 adds new modules or touches additional modules with
existing tests, run those focused tests too.

If `./aos ready --json` is ready after sub-task 1 work, run the probe scenario
(panel-only interaction + avatar scale drag) and record `publishState`/s and
structural-frame-% against the Phase 0/1 baselines (31/s, 100%).

If live readiness reports a TCC or input-tap blocker, stop with:

```bash
the manual TCC blocker report path
```

## Completion Report

Return a path-scoped summary with:

- branch/head used
- files changed
- sub-task 1 outcome: scheduler design, structural-flag approach, probe results
  (`publishState`/s and structural-frame-% under panel-only interaction and
  avatar scale drag, vs Phase 0/1 baselines)
- sub-task 2 outcome: API contract path, signal store decision and rationale,
  sample widget description, reviewer confirmation result
- exact tests run and results
- any gate failure and characterization of the blocker
- live AOS result or readiness blocker
- backlog items promoted to issues or work cards during this slice
- recommended Phase 3 entry condition (first surface to migrate) if both gates
  hold
