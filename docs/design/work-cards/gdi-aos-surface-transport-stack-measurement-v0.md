# GDI Work Card: AOS Surface Transport Stack Measurement V0

## Routing Status

Ready to dispatch.

## Tracker

- GitHub issue: #223
- Source reports:
  - `docs/dev/reports/aos-surface-transport-architecture-review-v0.md`
  - `docs/dev/reports/aos-surface-transport-performance-observations-v0.md`
- Related parked card, not ready to route from this slice:
  - `docs/design/work-cards/gdi-sigil-avatar-panel-resource-contract-migration-v0.md`

## Recipient

GDI implementation and measurement round.

## Branch / Base

- `branch_from`: local `gdi/avatar-compact-surface-ux-v0`
- `required_start_ref`: `8f9fafc8c2b304000ad05135313c802eb68bd569`
- `expected_output_branch`: `gdi/aos-surface-transport-stack-measurement-v0`

Use the single checkout at `/Users/Michael/Code/agent-os`. Do not create linked
worktrees. Preserve unrelated local work, including the untracked source reports
above.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, checkout, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Produce a measurement-only evidence pass for the Surface Inspector + Sigil
Avatar compact controls stacked scenario, enough to confirm or falsify the
outsider report's main cost claims before any platform direction is chosen.

The deliverable is flag-gated counters/probes plus a written evidence report.
This is not a coalescing, scheduler, protocol, reactivity, or Sigil migration
slice.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `docs/dev/reports/aos-surface-transport-architecture-review-v0.md`
- `docs/dev/reports/aos-surface-transport-performance-observations-v0.md`
- `docs/adr/0012-toolkit-platform-strategy.md`
- `docs/adr/0014-visual-object-descriptor-contract.md`
- `docs/adr/0015-aos-tcc-capability-broker-boundary.md`
- `docs/design/work-cards/gdi-sigil-avatar-panel-resource-contract-migration-v0.md`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD
./aos ready --json
./aos status --json
./aos show list --json
./aos dev recommend --json --paths src/daemon/unified.swift,src/display/canvas.swift,apps/sigil/renderer/live-modules/main.js,apps/sigil/avatar-editor/panel.js,apps/sigil/avatar-controls/compact-surface-session.js,packages/toolkit/controls/slider.js,packages/toolkit/components/surface-inspector/index.js
```

If live readiness reports a repo-mode TCC, Accessibility, Input Monitoring, or
inactive input-tap blocker, use:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed` and return the blocker to Foreman.

## Existing Code To Inspect

- `src/daemon/unified.swift` - `input_event` subscription fan-out and
  `canvas.send` relay path.
- `src/display/canvas.swift` - `postMessageAsync`, base64 receive eval, and
  potential per-canvas dispatch counting.
- `apps/sigil/renderer/live-modules/main.js` - Sigil subscriptions,
  `scheduleRenderFrame`, `liveJs.renderLoop.work`, overlay draw, state publish,
  and hit-region sync.
- `apps/sigil/renderer/live-modules/render-loop.js` - current render work
  classification.
- `apps/sigil/avatar-editor/panel.js` - detached panel
  `sigil.avatar_panel.control_change` and snapshot emission.
- `apps/sigil/avatar-controls/compact-surface-session.js` - owner-side value
  cache, route, sync, and snapshot publish.
- `apps/sigil/avatar-controls/descriptors.js` - mother-scale descriptor and
  renderer sync hooks.
- `packages/toolkit/controls/slider.js` - `change` vs `commit` behavior and
  suppressed programmatic updates.
- `packages/toolkit/components/surface-inspector/index.js` - minimap mouse
  display, input normalization, debug/minimap updates, and RAF coalescing.
- `packages/toolkit/runtime/desktop-world-surface-three.js` - `publishState`
  BroadcastChannel fanout and latency tracking.
- `packages/toolkit/runtime/desktop-world-hit-region.js` and
  `packages/toolkit/runtime/interaction-surface.js` - diff-guarded
  hit-region/canvas placement updates.

## Required Behavior

### 1. Add Measurement Probes Only

Add the smallest debug-only probe surface needed to count the three candidate
loops. Prefer existing telemetry/debug surfaces and pure JS counters where they
are sufficient. Any new counters must be gated so normal runtime behavior and
user-visible UI are unchanged when the probe is disabled.

Acceptable gate shapes include:

- a clearly named environment variable such as `AOS_SURFACE_TRANSPORT_PROBE=1`;
- a clearly named URL/debug flag on the relevant canvas;
- a clearly named `window.__...` debug object used only by tests/probes.

Do not add always-on console noise or user-facing controls for this slice.

### 2. Measure Input Fan-Out Inputs

Capture enough data to answer:

- how many canvases are subscribed to `input_event` during the stacked scenario;
- how many `input_event` payloads are delivered per canvas per second;
- which canvases are receiving them;
- whether the subscriber set contains obvious duplicate, stale, suspended, or
  unexpected targets.

Native-boundary rule: if this requires Swift changes, keep them as generic
delivery-mechanics observability only. Do not inspect product semantics such as
slider/avatar meaning in Swift. Do not implement coalescing, backpressure, or
policy. If Swift changes are required for live evidence, make source changes and
deterministic checks, then stop with `foreman_rebuild_needed`; Foreman owns the
native rebuild and any TCC regrant path.

### 3. Measure Cross-Canvas Panel Message Rate

During active detached-panel scale slider movement, count `canvas.send` /
`canvas_message` traffic split by at least:

- `sigil.avatar_panel.control_change`;
- `sigil.avatar_panel.snapshot`;
- `sigil.avatar_panel.update`, if present;
- other `sigil.avatar_panel.*` messages, grouped by type.

The evidence report must say whether snapshot traffic tracks preview-rate
control changes, and whether the detached panel was active or suspended.

### 4. Measure Render Work Classification And Emits

During active mother-scale slider movement, capture per-frame counts for:

- `liveJs.renderLoop.work.structural`;
- `liveJs.renderLoop.work.overlay`;
- `liveJs.renderLoop.work.publishState`;
- `overlay.draw` invocation count;
- `desktopWorldSurface.publishState` invocation count;
- `input_region.update` or equivalent hit-region/canvas placement updates.

The report must distinguish "structural flag is set" from "daemon bridge traffic
actually occurred." The expected falsifiable claim is that region updates are
mostly diff-guarded while overlay/publish work may still run per frame.

### 5. Capture Scenario Variants Or State Why Not

Try to separate at least these variants:

- detached avatar compact controls panel visible;
- embedded compact surface, if readily reachable;
- Surface Inspector minimap mouse event display on vs off.

If a variant is not reachable without product work or human steering, do not
fake it. Record the blocker and provide a short Operator-ready live run prompt
in the completion report.

### 6. Write The Evidence Artifact

Create or update:

`docs/dev/reports/aos-surface-transport-stack-measurement-v0.md`

The report should include:

- current branch/head and AOS readiness snapshot;
- exact probe gates used;
- scenario setup;
- measured counts/rates, with time windows;
- which claims from the architecture review were confirmed, falsified, or still
  unmeasured;
- whether the next best direction appears to be input fan-out, panel snapshot
  chattiness, structural bundle decomposition, diagnostic priority, or more
  instrumentation;
- any remaining live/HITL or Foreman-owned rebuild blocker.

Keep conclusions adversarial and measurement-bound. Do not turn the artifact
into a platform implementation plan.

## Scope

Allowed scope:

- temporary or reusable debug-only counters/probes;
- narrowly scoped tests for probe behavior;
- a measurement evidence report;
- small harness helpers if they are the cheapest way to collect repeatable
  counts.

Native boundary:

- Swift is allowed only for generic delivery-mechanics observability:
  subscriber counts, event fan-out counts, per-canvas dispatch counts, and
  grouped `canvas.send` message counts.
- Swift must not learn product semantics, priority policy, preview/commit
  meaning, scheduler behavior, avatar controls, Surface Inspector policy, or
  toolkit binding behavior.

## Hard Boundaries / Non-Goals

- Do not implement input coalescing, rate limiting, backpressure, or scheduler
  policy.
- Do not introduce preview/commit transport contracts.
- Do not add or select a signals/reactive library.
- Do not migrate or retire `sigil.avatar_panel.*`.
- Do not route or execute the parked resource-contract migration card.
- Do not fix visual jank unless a one-line probe bug blocks measurement.
- Do not move policy into the daemon.
- Do not rebuild/restart the native AOS binary if Swift changes are needed;
  return `foreman_rebuild_needed`.
- Do not open a PR or push.

## Suggested Implementation Areas

Prefer the narrowest measurable path after inspection. Likely options:

- JS-side probe object in `apps/sigil/renderer/live-modules/main.js` for
  render work, overlay, publish, and panel-message counts.
- JS-side probe in `apps/sigil/avatar-editor/panel.js` or owner handling to
  count detached-panel message families.
- Existing `render-performance`, `spatial-telemetry`, `canvas-stats`, or
  `window.__sigilDebug` surfaces if they can expose the evidence without
  broad UI changes.
- Swift-side debug counters in `src/daemon/unified.swift` and/or
  `src/display/canvas.swift` only if there is no existing way to count live
  input subscribers and per-canvas dispatches.

## Verification

Run focused deterministic checks for touched JS:

```bash
node --test tests/renderer/sigil-render-loop.test.mjs tests/renderer/avatar-controls-hit-test.test.mjs tests/toolkit/render-performance-model.test.mjs
git diff --check
```

If you add or touch specific probe modules with existing tests, run those
focused tests too. If tests need a small new deterministic fixture, add it.

If no Swift files were touched and `./aos ready --json` is ready, run a bounded
live probe using the enabled measurement gate and record the result in the
evidence artifact. If the full slider-drag scenario cannot be automated
deterministically, capture the baseline counts that can be gathered and return
an Operator-ready prompt for the supervised live drag.

If Swift files were touched, do not perform native live verification. Stop after
source/tests/report with `foreman_rebuild_needed`.

## Completion Report

Return a path-scoped completion summary with:

- branch/head used;
- files changed;
- probe gates added;
- exact tests run and results;
- whether Swift was touched and whether Foreman rebuild is needed;
- live measurements captured, with artifact path;
- live/HITL blocker or Operator-ready prompt if the full drag scenario was not
  captured;
- claims confirmed/falsified/still unmeasured;
- recommended next Foreman action.
