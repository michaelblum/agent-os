# Implementer Work Card: AOS Shared Gesture Spine Proof V0

## Routing Status

Ready to dispatch.

## Tracker

- Primary GitHub issue: #427
- Parent epic: #223
- Coupled design dependency: #428
- Related drag/drop cleanup lane: #425

## Recipient

Implementer implementation and validation round.

## Branch / Base

- `branch_from`: local `main`
- `required_start_ref`: local `main` with this work card present
- `expected_output_branch`: `implementer/aos-shared-gesture-spine-proof-v0`

Use the single checkout at `/Users/Michael/Code/agent-os`. Do not create linked
worktrees. Preserve unrelated local work, including the untracked
`.playwright-cli/` directory if it is still present.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, checkout, daemon,
canvas, issue, prior implementation state, or parent-thread plans. Read and
rediscover before editing.

## Goal

Start #427 by creating the first shared pointer/gesture interaction spine proof:
one normalized gesture frame contract, one shared runtime gesture lifecycle
primitive, one migrated active drag-like behavior, and one Surface Inspector
minimap overlay path that observes the same gesture frames as a passive
subscriber.

This is agent-ergonomics platform work. The target is one primitive, one
vocabulary, one test family, and one observability path for drag-like behavior.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `packages/toolkit/controls/AGENTS.md`
- `packages/toolkit/panel/AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/api/toolkit/runtime.md`
- `docs/api/toolkit/panel-window.md`
- #427 via `./aos dev gh issue view 427 --json`
- #428 via `./aos dev gh issue view 428 --json`
- #223 via `./aos dev gh issue view 223 --json`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD
./aos dev gh issue view 427 --json
./aos dev gh issue view 428 --json
./aos dev recommend --json --paths packages/toolkit/runtime/range-drag.js,packages/toolkit/adapters/zag/slider.js,packages/toolkit/controls/slider.js,packages/toolkit/components/surface-inspector/index.js,packages/toolkit/components/surface-inspector/mouse-effects.js,apps/sigil/avatar-controls/surface.js,tests/toolkit/zag-adapter-slider.test.mjs,tests/toolkit/runtime-range-drag.test.mjs,tests/toolkit/surface-inspector-mouse-effects.test.mjs,tests/renderer/avatar-controls-hit-test.test.mjs
```

Run `./aos ready --json` only when live proof is ready and deterministic tests
already pass. If live readiness reports a repo-mode TCC, Accessibility, Input
Monitoring, inactive input-tap, or unmanaged-daemon blocker, use:

```bash
the manual TCC blocker report path
```

Then stop with `manual_intervention` and return the blocker to Foreman. Do not repair
permissions, reset TCC, or keep retrying live AOS.

## Existing Code To Inspect

- `packages/toolkit/runtime/input-events.js` - current raw and routed input
  normalization, including gesture/capture metadata from v2 events.
- `packages/toolkit/runtime/interaction-region.js` - existing DesktopWorld
  capture/hover router; reuse or wrap where it reduces duplication.
- `packages/toolkit/runtime/range-drag.js` - small range-value mapping helper
  and likely adapter reference.
- `packages/toolkit/runtime/index.js` - runtime export surface.
- `packages/toolkit/adapters/zag/slider.js` - private DOM pointer lifecycle,
  `setPointerCapture`, move/up/cancel listeners, and value commit behavior.
- `packages/toolkit/controls/slider.js` - semantic slider root/control/thumb
  metadata and toolkit slider DOM shape.
- `packages/toolkit/components/surface-inspector/index.js` - current
  `input_event` subscription and minimap dynamic layer feed.
- `packages/toolkit/components/surface-inspector/mouse-effects.js` - current
  minimap down/drag/up/cancel visual state.
- `apps/sigil/avatar-controls/surface.js` - current avatar controls slider
  drag path and the best live proof candidate if it can consume the shared
  toolkit gesture/range adapter without product-specific leakage.
- `tests/toolkit/runtime-input-events.test.mjs`
- `tests/toolkit/runtime-interaction-region.test.mjs`
- `tests/toolkit/runtime-range-drag.test.mjs`
- `tests/toolkit/zag-adapter-slider.test.mjs`
- `tests/toolkit/surface-inspector-mouse-effects.test.mjs`
- `tests/renderer/avatar-controls-hit-test.test.mjs`

Also survey the #427 candidates enough to classify them:

- `packages/toolkit/panel/drag-drop.js`
- `packages/toolkit/panel/chrome.js`
- `packages/toolkit/panel/layouts/split-pane.js`
- `packages/toolkit/adapters/zag/splitter.js`
- `packages/toolkit/panel/minimized-chip.html`
- Sigil fast-travel, radial gesture, and selection-mode pointer paths
- toolkit graph/radial-graph canvas drag paths
- remaining raw `pointerdown`, `pointermove`, and `setPointerCapture` surface
  logic

## Required Behavior

### 1. Write The First Gesture Spine Contract

Create a concise design note:

`docs/design/aos-shared-gesture-spine-v0.md`

It must define the normalized gesture frame vocabulary used by this proof.
Include at least:

- schema/version;
- gesture id and transaction id, if separate;
- source identity: origin, canvas/source canvas/owner canvas when available,
  DOM element/ref when applicable, and raw event source;
- pointer identity: pointer id, button, buttons, capture id;
- lifecycle phase: start, move, end, cancel;
- normalized type names such as `gesture.drag.start`,
  `gesture.drag.move`, `gesture.drag.end`, and `gesture.drag.cancel`;
- coordinate spaces: DOM/client, native, and DesktopWorld where available;
- origin/current/previous/delta points;
- constraints/bounds/axis metadata when known;
- semantic target/action identity;
- timing/frame metadata;
- passive subscriber contract;
- cleanup/cancel semantics.

Include the governing rule exactly:

> Do not add private pointer drag logic. New drag-like behavior must either use
> the shared gesture spine or document why it cannot.

Also include:

> Shared drag does not mean shared behavior. Shared spine owns mechanics;
> adapters own meaning.

For #428, include a short "Work Recording dependency" section that says Work
Recording should stay in schema/design mode until this gesture vocabulary
stabilizes. Include the intended first recording proof shape:
baseline snapshot, `gesture.drag.*` frames, state patch, Surface Inspector
overlay observation, and periodic keyframe later.

### 2. Add The Shared Runtime Gesture Primitive

Add the smallest generic toolkit runtime module needed for the proof. Suggested
path:

`packages/toolkit/runtime/gesture-stream.js`

The primitive may be named differently after inspection, but it must remain
generic toolkit runtime policy, not Sigil product behavior and not daemon/native
policy.

The primitive should provide:

- a way to normalize DOM pointer events and existing normalized canvas input
  messages into gesture frames;
- lifecycle ownership for start/move/end/cancel;
- pointer identity and capture id tracking;
- optional DOM `setPointerCapture` / `releasePointerCapture` handling for DOM
  controls;
- source/owner identity fields when available from `input-events.js`;
- a passive subscription hook so observers can receive the same frames as
  active adapters;
- cleanup on end/cancel/destroy;
- deterministic tests.

Prefer reusing existing `input-events.js` and `interaction-region.js` concepts
instead of creating a competing router vocabulary. If those modules are not the
right place, state why in the design note and keep the new module narrowly
named around gesture lifecycle.

Export the primitive from `packages/toolkit/runtime/index.js` only if it is
ready to be a public toolkit runtime contract. If it remains experimental for
this proof, keep the import local and state the promotion gate in the design
note.

### 3. Migrate One Active Behavior

Choose the smallest active behavior that can prove the spine without dragging
in product policy. Preferred order after inspection:

1. `packages/toolkit/adapters/zag/slider.js` DOM pointer drag.
2. `apps/sigil/avatar-controls/surface.js` compact/avatar panel slider drag,
   only if it can consume a generic toolkit gesture/range adapter and directly
   prove the avatar slider + Inspector overlay scenario without expanding
   Sigil-specific behavior.
3. `packages/toolkit/runtime/range-drag.js` if the above two are too broad for
   this round.

For the migrated behavior:

- remove or wrap the private start/move/end/cancel pointer lifecycle through
  the shared primitive;
- preserve existing value preview vs commit behavior;
- preserve keyboard/accessibility behavior;
- preserve multi-thumb behavior if the Zag slider path is chosen;
- preserve existing public API names unless the design note explicitly justifies
  a hard cutover;
- emit semantic target/action metadata when it is already available, such as
  slider/set-value/range-value;
- do not add app-specific names like `fastTravel` to the shared primitive.

### 4. Make Surface Inspector A Passive Gesture Subscriber

Adapt the Surface Inspector minimap mouse-event overlay so drag visualization
can consume gesture frames. Keep the visual behavior from
`mouse-effects.js`: active hold, drag line, release/cancel tail, click pulse,
cursor rendering, and dynamic-layer animation.

The key acceptance point is ownership, not UI polish:

- the overlay should observe normalized gesture frames through a passive
  subscriber/API path;
- it must not add a duplicate raw pointer listener for the migrated behavior;
- existing raw `input_event` support may remain only as a compatibility
  adapter that normalizes into the same gesture frame shape;
- the same deterministic test should be able to feed one drag sequence and
  assert both active behavior effects and minimap overlay state from the same
  frame stream.

### 5. Survey And Park Follow-Ups

In `docs/design/aos-shared-gesture-spine-v0.md`, classify each #427 survey
candidate as one of:

- migrate onto the spine now;
- keep domain-private but consume normalized gesture frames;
- keep separate with a clear reason;
- defer with a named follow-up.

Do not start fast travel, radial gesture, selection-mode, graph canvas, panel
resize, split-pane, or transfer-outline migration in this card unless the
small proof requires a tiny compatibility adapter. Fast travel is a design
reference for a future generic vector/directional gesture consumer, not a
shared primitive name.

## Scope

Allowed:

- toolkit runtime gesture frame/lifecycle primitive;
- focused control/range adapter changes for one active behavior;
- Surface Inspector minimap overlay adapter changes;
- docs/design gesture-frame contract and survey;
- deterministic tests;
- bounded live smoke if readiness is healthy.

Out of scope:

- native Swift changes;
- daemon input delivery policy, coalescing, or backpressure;
- full Work Recording implementation;
- fast-travel migration;
- radial/selection/graph migration;
- panel transfer-outline cleanup beyond survey classification;
- broad UI redesign of Surface Inspector or avatar controls;
- new private pointer drag logic.

If Swift/native work appears necessary, stop with `foreman_rebuild_needed` and
explain the privileged fact/action/stream that justifies crossing the TCC
capability broker boundary. Foreman owns rebuild and any TCC regrant path.

## Verification

Run focused deterministic tests first:

```bash
git diff --check
node --test tests/toolkit/runtime-input-events.test.mjs tests/toolkit/runtime-interaction-region.test.mjs
node --test tests/toolkit/surface-inspector-mouse-effects.test.mjs
```

Also run the test set for the migrated active behavior:

```bash
node --test tests/toolkit/zag-adapter-slider.test.mjs
node --test tests/toolkit/runtime-range-drag.test.mjs
node --test tests/renderer/avatar-controls-hit-test.test.mjs
```

Only run the commands relevant to the chosen active behavior if the full set is
unnecessarily broad, but explain any skipped command in the completion report.
If runtime/toolkit exports change, run:

```bash
node --test tests/toolkit/*.test.mjs
```

After deterministic tests pass, if `./aos ready --json` reports ready, run one
bounded live smoke:

1. Open or reuse Surface Inspector with mouse-event overlay enabled.
2. Perform the migrated slider/range drag path.
3. Confirm the active behavior updates value/render/label as appropriate.
4. Confirm the Inspector minimap overlay observes the same gesture in the
   correct DesktopWorld/minimap position.
5. Capture the exact commands/probes and final `./aos status --json`.

If live readiness is blocked, use the Implementer TCC manual-intervention helper and stop with
`manual_intervention`. Do not continue into live-dependent proof.

## Completion Report

Return a path-scoped report for Foreman with:

- changed files;
- which active behavior was migrated and why that candidate was selected;
- gesture frame schema summary;
- survey classifications and follow-up recommendations;
- #428 dependency note and whether any Work Recording schema draft changed;
- tests run with exact pass/fail results;
- live smoke result or readiness blocker;
- current `git status --short --branch`;
- any unrelated dirty/untracked state preserved;
- remaining blockers or next slice.
