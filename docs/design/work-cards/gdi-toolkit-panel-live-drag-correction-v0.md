# GDI Work Card: Toolkit Panel Live Drag Correction V0

## Routing Status

Paused / do not dispatch as-is.

New human-visible evidence changed the problem shape after this card was
written: two Avatar/Sigil control surfaces were visible simultaneously across
displays, one new panel-backed Avatar controls surface and one older compact
Avatar/Sigil controls surface without panel chrome. That means the live drag
failure is not proven to be only coordinate drift. Surface identity, registry,
content-root, branch/worktree, and orphan visible-window drift must be audited
first.

The replacement first slice is:

```text
docs/design/work-cards/gdi-aos-visible-surface-orphan-audit-v0.md
```

Only refresh this live-drag card after the visible-surface audit and toolkit
panel placement contract are accepted, and after Sigil-owned avatar avoidance
has either been implemented or explicitly ruled out from the audit/final-frame
evidence.

## Recipient

GDI correction round.

## Branch / Base

- `branch_from`: `gdi/radial-compact-snapshot-extraction-integration-v0`
- `minimum_code_start_ref`: `21dc331d7bb4ec77493e77ad32541d0d70ba70a1`
- `required_start_ref`: the latest Foreman docs-alignment checkpoint that is a
  descendant of `21dc331d7bb4ec77493e77ad32541d0d70ba70a1` and contains this
  work card.
- `expected_output_branch`: `gdi/toolkit-panel-live-drag-correction-v0`

Do not restart from `origin/main`. The minimum code start ref is the local
accepted checkpoint that adds the AOS action bus, browser link demo, and Sigil
avatar controls panel. If Foreman has committed later docs-only alignment notes,
start from that later checkpoint so this card and its routing guards are
available.

## Source Artifact

- Accepted checkpoint: `21dc331d7bb4ec77493e77ad32541d0d70ba70a1`
- Completion report: action bus, browser link demo, and Sigil avatar panel were
  implemented and verified, but live `./aos do drag` did not move the panel
  frame reliably.
- Related design cards:
  - `docs/design/work-cards/panel-drag-coordinate-abstraction-v0.md`
  - `docs/design/work-cards/aos-drag-action-control-surface-v0.md`
  - `docs/design/work-cards/canvas-geometry-lifecycle-render-contract-v0.md`

## Downstream Routing Guard

Keep this card paused until its preconditions are explicit. Do not route it as
the next GDI task simply because panel drag remains a known issue.

Current sequence:

1. Route and accept
   `docs/design/work-cards/gdi-aos-visible-surface-orphan-audit-v0.md`.
2. Define or refresh the toolkit panel placement contract so panels report
   requested and final settled native frames, with opt-in viewport overflow
   behavior such as `allow`, `clamp`, `flip`, or `shift`.
3. Add Sigil-owned avatar avoidance only if final settled panel frames show the
   avatar can overlap or win input over its controls panel.
4. Refresh this live-drag correction card against that accepted observability
   and placement head.
5. Only after drag is corrected, route
   `docs/design/work-cards/gdi-sigil-avatar-panel-resource-contract-migration-v0.md`.

Older avatar object-graph, context-menu data-driven-controls, and 3D thing
editor cards are historical until refreshed against the accepted audit,
placement, drag, and resource-migration heads.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
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
- child panel canvas input is routed as inside the Sigil menu.

The remaining failure is live: dragging the panel header with `./aos do drag`
did not reliably change the panel's frame in `./aos show list`, even after the
panel was focused.

Do not treat that as a pure drag primitive failure without first proving visible
surface exclusivity. The new evidence shows registered AOS state can look
expected while stale or duplicate visible windows still participate in human
input. `./aos ready` proves tap/runtime readiness only; it does not prove that
all visible windows are from the active branch/content root or that the canvas
registry matches the window server.

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
- `apps/sigil/context-menu/menu.js`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/avatar-editor/panel.js`
- `tests/toolkit/panel-chrome.test.mjs`
- `tests/aos-action-bus.sh`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD
git merge-base --is-ancestor 21dc331d7bb4ec77493e77ad32541d0d70ba70a1 HEAD; echo "accepted_checkpoint_ancestor=$?"
./aos ready --post-permission
./aos dev recommend --json --paths packages/toolkit/panel/chrome.js,packages/toolkit/runtime/canvas.js,src/act/actions.swift,src/display/canvas.swift,apps/sigil/context-menu/menu.js
./aos show list --json
rg -n "wireDrag|createDragController|moveAbsolute|mutateSelf|input_event|left_mouse_dragged|drag_start|drag_end|geometry_change|aos do drag|handleDrag|SIGIL_AVATAR_PANEL_CANVAS_ID|sigil.avatar_panel" packages/toolkit src apps/sigil tests
```

If `./aos ready --post-permission` reports a repo-mode TCC, Accessibility,
Input Monitoring, or inactive input-tap blocker, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`. After the human returns with `finished`, continue
in the same GDI session and run:

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
- If the panel moves but Sigil's owner-side `contextMenu` snapshot or bounds
  remain stale, fix the smallest owner bookkeeping path needed to track the
  panel's current frame.
- Child panel canvas events must still be treated as inside the menu after the
  drag.

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
node --test tests/renderer/context-menu-hit-test.test.mjs
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
# generic toolkit panel live drag smoke
# Sigil avatar controls panel live drag smoke
./aos show list --json
```

The final `./aos show list --json` should be empty after cleanup.

## Completion Report

Include:

- branch name and head SHA;
- confirmation that work started from
  `21dc331d7bb4ec77493e77ad32541d0d70ba70a1`;
- changed paths;
- root cause and owning layer;
- whether generic panel drag, Sigil panel drag, or both were fixed;
- before/after daemon frames for each live panel drag proof;
- exact `./aos do drag` command(s) used;
- screenshot artifact paths, if captured;
- deterministic verification commands and pass/fail results;
- live readiness result or exact human-needed blocker;
- final cleanup result from `./aos show list --json`;
- any remaining follow-up if the broader `aos do drag` action surface still
  needs work.
