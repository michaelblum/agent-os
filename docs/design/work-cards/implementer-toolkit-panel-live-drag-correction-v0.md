# Implementer Work Card: Toolkit Panel Live Drag Correction V0

## Routing Status

Ready to dispatch.

The earlier pause guard has been satisfied. Surface visibility audit,
cross-process native-window audit, runtime/input-tap provenance, passive TCC
health semantics, toolkit placement/final-frame reporting, initial panel
placement reporting, Sigil avatar-panel avoidance, and duplicate avatar-controls
surface suppression are now accepted on the current stack.

Dispatch this card as the next Implementer correction slice from:

```text
721accc38e2c58bb984a37c968aade808d11c269
```

That head includes:

```text
6cd1f386 fix(runtime): keep passive tcc observability non-degrading
599ff0cb fix(toolkit): report initial panel placement
a62d4bd2 fix(sigil): avoid avatar panel overlap
7811e557 fix(sigil): rename avatar controls and preserve panel hits
721accc3 fix(sigil): prevent duplicate avatar controls surfaces
```

Foreman live checks on that head showed `./aos ready --json`,
`./aos status --json`, and `./aos service status --mode repo --json` all OK;
`./aos clean --dry-run --json` clean; and `./aos show audit --json` with no
duplicate logical surfaces, external AOS native windows, or orphan native
windows.

## Recipient

Implementer correction round.

## Branch / Base

- `branch_from`: `implementer/sigil-avatar-panel-final-frame-avoidance-assessment-v0`
- `minimum_code_start_ref`: `721accc38e2c58bb984a37c968aade808d11c269`
- `required_start_ref`: the current Foreman routing checkpoint containing this
  refreshed work card, descendant of
  `721accc38e2c58bb984a37c968aade808d11c269`.
- `expected_output_branch`: `implementer/toolkit-panel-live-drag-correction-v1`

Do not restart from `origin/main`. This slice depends on the accepted
observability, placement, avatar avoidance, and avatar-controls identity stack.

There is a stale linked worktree at:

```text
/Users/Michael/Code/agent-os-worktrees/toolkit-panel-live-drag-correction-v0
```

That worktree is on the old `implementer/toolkit-panel-live-drag-correction-v0` branch
at `7d8e593a` and has dirty edits against pre-rename `apps/sigil/context-menu/*`
paths. Treat it as historical local state. Do not reset it, delete it, rebase
it, or transplant its dirty diff unless Foreman explicitly asks for forensic
comparison. Create the new output branch from the required start ref instead.

## Source Artifact

- Accepted checkpoint: `721accc38e2c58bb984a37c968aade808d11c269`
- Completion evidence on that checkpoint: runtime health is OK, audit has no
  duplicate/external/orphan AOS windows, toolkit placement metadata is exposed,
  avatar-panel avoidance is implemented, duplicate avatar-controls opens are
  suppressed, and focused deterministic checks pass.
- Remaining original failure: live `./aos do drag` did not reliably move the
  toolkit/Sigil panel frame. That was intentionally deferred until the
  observability and overlap preconditions were closed.
- Related design cards:
  - `docs/design/work-cards/implementer-aos-visible-surface-orphan-audit-v0.md`
  - `docs/design/work-cards/implementer-aos-visible-surface-cross-process-audit-v0.md`
  - `docs/design/work-cards/implementer-aos-runtime-service-input-tap-observability-v0.md`
  - `docs/design/work-cards/implementer-toolkit-panel-placement-final-frame-contract-v0.md`
  - `docs/design/work-cards/implementer-sigil-avatar-panel-final-frame-avoidance-assessment-v0.md`
  - `docs/design/work-cards/panel-drag-coordinate-abstraction-v0.md`
  - `docs/design/work-cards/aos-drag-action-control-surface-v0.md`
  - `docs/design/work-cards/canvas-geometry-lifecycle-render-contract-v0.md`

## Downstream Routing Guard

This card is now the next Implementer task. Do not route resource/object migration until
the live drag correction has either passed or returned a precise blocker.

Current sequence:

1. Accepted:
   `docs/design/work-cards/implementer-aos-visible-surface-orphan-audit-v0.md`.
2. Accepted:
   `docs/design/work-cards/implementer-aos-visible-surface-cross-process-audit-v0.md`.
3. Accepted:
   `docs/design/work-cards/implementer-aos-runtime-service-input-tap-observability-v0.md`.
4. Accepted: toolkit panel placement contract reports requested,
   policy-adjusted, final settled, and actual native frames, with opt-in
   viewport overflow behavior such as `allow`, `clamp`, `flip`, or `shift`.
5. Accepted: Sigil avatar-panel avoidance and duplicate avatar-controls surface
   suppression are in the current start ref.
6. Next: fix or precisely classify live panel drag.
7. Only after drag is corrected or a smaller blocking primitive is identified,
   route
   `docs/design/work-cards/implementer-sigil-avatar-panel-resource-contract-migration-v0.md`.

Older avatar object-graph and 3D thing editor cards are historical until
refreshed against the accepted audit, placement, drag, and resource-migration
heads.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Make draggable toolkit panels move reliably under live `./aos do drag`, with
bounded evidence for both a generic toolkit panel and the Sigil avatar controls
panel when live readiness is available.

## Observed Failure

Foreman accepted the new focused Sigil panel behavior, including:

- panel opens via `panel.toggle` with `focus: true`;
- panel chrome is present;
- `header draggable="true"` is present;
- close button is present and minimize/maximize are absent;
- child panel canvas input is routed as inside the avatar-controls surface.

The remaining failure is live: dragging the panel header with `./aos do drag`
did not reliably change the panel's frame in `./aos show list`, even after the
panel was focused.

Before editing, re-prove visible-surface exclusivity with AOS audit. If audit is
dirty, fix or return that blocker first; otherwise diagnose the live drag path.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `apps/sigil/AGENTS.md`
- `src/AGENTS.md`
- `packages/toolkit/panel/chrome.js`
- `packages/toolkit/panel/mount.js`
- `packages/toolkit/panel/placement.js`
- `packages/toolkit/panel/drag-transfer.js`
- `packages/toolkit/runtime/canvas.js`
- `packages/toolkit/runtime/input-events.js`
- `src/act/act-cli.swift`
- `src/act/actions.swift`
- `src/display/canvas.swift`
- `apps/sigil/avatar-controls/surface.js`
- `apps/sigil/renderer/live-modules/avatar-controls-input.js`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/avatar-editor/panel.js`
- `tests/renderer/avatar-controls-hit-test.test.mjs`
- `tests/renderer/sigil-avatar-controls-input.test.mjs`
- `tests/toolkit/panel-chrome.test.mjs`
- `tests/toolkit/runtime-action.test.mjs`
- `tests/toolkit/aos-action-demo.test.mjs`
- `tests/sigil-avatar-controls-real-input.sh`
- `tests/aos-action-bus.sh`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD
git merge-base --is-ancestor 721accc38e2c58bb984a37c968aade808d11c269 HEAD; echo "avatar_avoidance_head_ancestor=$?"
./aos ready --post-permission
./aos status --json
./aos service status --mode repo --json
./aos clean --dry-run --json
./aos show audit --json
./aos dev recommend --json --paths packages/toolkit/panel/chrome.js,packages/toolkit/runtime/canvas.js,src/act/actions.swift,src/display/canvas.swift,apps/sigil/avatar-controls/surface.js,apps/sigil/renderer/live-modules/avatar-controls-input.js,apps/sigil/renderer/live-modules/main.js
./aos show list --json
rg -n "wireDrag|createDragController|moveAbsolute|mutateSelf|input_event|left_mouse_dragged|drag_start|drag_end|geometry_change|aos do drag|handleDrag|SIGIL_AVATAR_PANEL_CANVAS_ID|sigil-avatar-controls-avatar-main|avatar-controls" packages/toolkit src apps/sigil tests
```

If `./aos ready --post-permission` reports a repo-mode TCC, Accessibility,
Input Monitoring, or inactive input-tap blocker, run:

```bash
the manual TCC blocker report path
```

Then stop with `manual_intervention`. After the human returns with `finished`, continue
in the same Implementer session and run:

```bash
./aos ready --post-permission
```

## Required Behavior

### Generic Toolkit Panel

- A panel created from `aos://toolkit/components/aos-action-demo/index.html`
  with `draggable: true`, `interactive: true`, and focus can be moved by live
  `./aos do drag` on the header.
- The final `./aos show list --json` frame origin changes by the intended drag
  delta within a small tolerance.
- Width and height remain stable.
- The panel must not snap to a display visible-work-area top edge unless the
  drag target genuinely requires clamping.

### Sigil Avatar Controls Panel

- Right-clicking the live Sigil avatar opens
  `sigil-avatar-controls-avatar-main`.
- The Sigil panel header can be dragged with `./aos do drag`.
- The final daemon frame for `sigil-avatar-controls-avatar-main` changes by the
  intended drag delta within a small tolerance.
- If the panel moves but Sigil's owner-side avatar-controls snapshot or bounds
  remain stale, fix the smallest owner bookkeeping path needed to track the
  panel's current frame.
- Child panel canvas events must still be treated as inside avatar controls
  after the drag.

### Boundary Diagnosis

Identify the layer before editing:

- If the panel never receives `pointerdown` or subscribed `input_event` drag
  messages, inspect the live input/action boundary.
- If messages arrive but placement uses stale, DOM-local, or mixed coordinate
  values, fix toolkit panel drag normalization.
- If a generic toolkit panel moves but the Sigil panel does not, fix the Sigil
  panel setup, focus, lifecycle, or owner bookkeeping path.
- If `./aos do drag` itself is too imprecise for short panel-header drags, make
  the smallest compatible primitive fix needed for this regression and leave the
  broader drag grammar work to `aos-drag-action-control-surface-v0`.

## Scope

Likely ownership is toolkit panel/windowing first. Native action or display
code is in scope only if rediscovery proves the failure is below toolkit chrome.
Sigil app changes are in scope only for the avatar-controls panel lifecycle or
owner-side bounds bookkeeping.

## Hard Boundaries / Non-Goals

- Do not redesign panel chrome, panel visual style, or Sigil avatar controls.
- Do not replace native drag authority with raw DOM pointermove placement.
- Do not weaken cross-display transfer or visible-work-area clamp protections.
- Do not implement the full `aos do drag` grammar from
  `aos-drag-action-control-surface-v0` unless this slice cannot pass without a
  small compatible primitive addition.
- Do not use raw daemon HTTP, direct tmux, state-file probing, or ad-hoc Quartz
  scripts as the primary proof. Use `./aos ready`, `./aos show`, `./aos see`,
  and `./aos do`.
- Do not port dirty edits from the stale linked worktree unless the same defect
  is independently reproduced on the current `avatar-controls` stack.
- Do not reintroduce `apps/sigil/context-menu/*` as the avatar-controls
  implementation path.
- Do not remove or rewrite unrelated untracked work cards or reports.

## Suggested Live Smoke Shape

Use this shape after reading current command help and adapting coordinates to
the active display. Exact coordinates may vary; derive them from `./aos show
list --json`, `./aos see`, or display geometry.

```bash
./aos show remove-all
./aos show create \
  --id toolkit-panel-drag-smoke \
  --at 240,240,360,220 \
  --interactive \
  --focus \
  --url aos://toolkit/components/aos-action-demo/index.html
./aos show wait --id toolkit-panel-drag-smoke --manifest aos-action-demo --timeout 5s
./aos show list --json
./aos see capture main --canvas toolkit-panel-drag-smoke --perception --xray --out /tmp/aos-toolkit-panel-drag-before.png
./aos do drag <header-start-x,header-start-y> <header-end-x,header-end-y>
./aos show list --json
./aos see capture main --canvas toolkit-panel-drag-smoke --perception --xray --out /tmp/aos-toolkit-panel-drag-after.png
```

Assert the frame delta programmatically instead of relying only on screenshots.
Clean up temporary canvases when done:

```bash
./aos show remove-all
./aos show list --json
```

For the Sigil panel, use the repo's existing AOS-first Sigil launch/open
helpers where available. Do not substitute direct private DOM dispatch for the
required live drag proof.

## Verification

Run deterministic checks first:

```bash
git diff --check
node --test tests/toolkit/panel-chrome.test.mjs tests/toolkit/runtime-action.test.mjs tests/toolkit/aos-action-demo.test.mjs
node --test tests/renderer/avatar-controls-hit-test.test.mjs tests/renderer/sigil-avatar-controls-input.test.mjs
bash tests/aos-action-bus.sh
```

If native, daemon, or CLI code changes, also run the build command recommended
by:

```bash
./aos dev recommend --json --paths src/act/actions.swift,src/act/act-cli.swift,src/display/canvas.swift,src/daemon/unified.swift
```

At minimum, `bash build.sh --no-restart` must pass when Swift or daemon code
changes.

Run live checks when `./aos ready --post-permission` passes:

```bash
./aos ready --post-permission
./aos status --json
./aos show audit --json
# generic toolkit panel live drag smoke
# Sigil avatar controls panel live drag smoke
./aos show list --json
```

The final `./aos show list --json` should be empty after cleanup.

## Completion Report

Include:

- branch name and head SHA;
- confirmation that work started from
  `721accc38e2c58bb984a37c968aade808d11c269`;
- changed paths;
- root cause and owning layer;
- whether generic panel drag, Sigil panel drag, or both were fixed;
- before/after daemon frames for each live panel drag proof;
- exact `./aos do drag` command(s) used;
- screenshot artifact paths, if captured;
- deterministic verification commands and pass/fail results;
- live readiness result or exact manual-intervention blocker;
- final cleanup result from `./aos show list --json`;
- any remaining follow-up if the broader `aos do drag` action surface still
  needs work.
