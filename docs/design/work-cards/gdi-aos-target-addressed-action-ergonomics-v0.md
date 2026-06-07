# GDI Work Card: AOS Target-Addressed Action Ergonomics V0

## Historical Status

This card is historical for target identity guidance. It predates the accepted
#429 target descriptor contract and #432 drift cleanup. Current target-addressed
action docs should use `shared/schemas/aos-semantic-targets.md`: state-scoped
refs for immediate actions, durable `target.target_id` scoped by
`target.owner_namespace`, primitive `actions`, current `state`, `provenance`,
and machine-first `reacquisition` hints. Labels and accessible names are not
identity.

## Routing Status

Ready to dispatch after Foreman checkpoints this card.

## Recipient

GDI round.

## Transfer Kind

Deterministic implementation and contract round.

## Branch / Base

- `branch_from`: `foreman/aos-target-addressed-action-ergonomics-v0`
- `minimum_code_start_ref`: `bc5a6a9c`
- `required_start_ref`: `foreman/aos-target-addressed-action-ergonomics-v0`
- `expected_output_branch`: `gdi/aos-target-addressed-action-ergonomics-v0`

Do not restart from `origin/main`. This slice depends on the current accepted
surface, placement, semantic-target, and Sigil panel stack.

The current main checkout may still contain an interrupted diagnostic diff from
`gdi/toolkit-panel-live-drag-correction-v1` in:

- `packages/toolkit/panel/chrome.js`
- `tests/toolkit/panel-chrome.test.mjs`

Treat that diff as diagnostic only. Do not commit it, continue it, or build on
top of it unless this card's semantic/action work re-derives the same change
from deterministic evidence. If your checkout contains those dirty edits,
preserve them with a named stash or checkpoint, then use a clean local branch
from `required_start_ref` before editing this slice. Do not create a linked
git worktree.

There was also a stale historical linked worktree at:

```text
/Users/Michael/Code/agent-os-worktrees/toolkit-panel-live-drag-correction-v0
```

It is not this round's base. Do not recreate or route new work into linked
worktrees for this workflow.

## Source Artifact

- Foreman accepted stack through `bc5a6a9c docs: isolate live drag correction branch`.
- Interrupted prior work card:
  `docs/design/work-cards/gdi-toolkit-panel-live-drag-correction-v0.md`.
- Current correction: stop pixel-coordinate live debugging and make AOS actions
  target-addressed.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, checkout, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Make AOS-owned panel drag handles and toolkit sliders addressable through
stable semantic targets, then extend `aos do` so agents can invoke drag and
set-value operations by target ref instead of inventing pixel coordinates.

## Product Intent

AOS should act like an accessibility-first computer control system:

- perceive and address AX/semantic targets first;
- use screenshots and coordinates only as fallback or human-visible playback;
- resolve stale refs at action time and fail with machine-readable errors when
  a target disappears, becomes disabled, or becomes ambiguous;
- return the action strategy, backend, playback mode, resolved target details,
  and post-action semantic state when available.

The existing mismatch is concrete:

- `aos do click canvas:<canvas-id>/<ref>` already resolves current
  `semantic_targets[].do_target`.
- `aos do drag` still requires `x1,y1 x2,y2`.
- `aos do set-value` still requires AX flags such as `--pid`, `--role`, and
  `--value`.

This card fixes that API boundary for AOS-owned canvas targets before anyone
continues live panel-header coordinate debugging.

## Read First

- `AGENTS.md`
- `src/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `packages/toolkit/panel/AGENTS.md`
- `packages/toolkit/controls/AGENTS.md`
- `docs/api/aos.md`
- `docs/api/toolkit/controls.md`
- `docs/api/toolkit/panel-window.md`
- `docs/guides/aos-app-accessibility-surfaces.md`
- `shared/schemas/aos-semantic-targets.md`
- `src/act/act-cli.swift`
- `src/act/actions.swift`
- `src/act/canvas-ref-targeting.swift`
- `src/main.swift`
- `src/perceive/models.swift`
- `src/perceive/semantic-targets.swift`
- `src/perceive/capture-pipeline.swift`
- `packages/toolkit/runtime/semantic-targets.js`
- `packages/toolkit/runtime/range-drag.js`
- `packages/toolkit/panel/chrome.js`
- `packages/toolkit/panel/form.js`
- `packages/toolkit/controls/slider.js`
- `packages/toolkit/adapters/zag/slider.js`
- `tests/aos-canvas-ref-click.sh`
- `tests/aos-semantic-targets-xray.sh`
- `tests/toolkit/runtime-semantic-targets.test.mjs`
- `tests/toolkit/panel-chrome.test.mjs`
- `tests/toolkit/panel-form.test.mjs`
- `tests/toolkit/zag-adapter-slider.test.mjs`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD
git branch --show-current
git diff -- packages/toolkit/panel/chrome.js tests/toolkit/panel-chrome.test.mjs
./aos dev recommend --json --paths src/act/act-cli.swift,src/act/actions.swift,src/act/canvas-ref-targeting.swift,src/main.swift,src/perceive/semantic-targets.swift,src/perceive/models.swift,packages/toolkit/runtime/semantic-targets.js,packages/toolkit/panel/chrome.js,packages/toolkit/panel/form.js,packages/toolkit/controls/slider.js,packages/toolkit/adapters/zag/slider.js
rg -n "canvas:<|do_target|semantic_targets|set-value|cliSetValue|cliDrag|resolveCanvasRefClickTarget|data-aos-ref|data-aos-action|range-drag|slider|wireDrag|aos-header" docs/api shared/schemas src packages/toolkit tests
```

If live AOS verification can run, start with:

```bash
./aos ready --post-permission
./aos status --json
./aos clean --dry-run --json
```

If `./aos ready --post-permission` reports repo-mode Accessibility, Input
Monitoring, TCC, or inactive input-tap blockers, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`. Do not retry live coordinate checks or run raw
permission setup commands.

## Required Behavior

### Semantic Target Shape

- `aos see capture --canvas <id> --xray` continues to emit
  `semantic_targets[].do_target` for target refs.
- Semantic targets gain a canonical primitive action list such as `actions`.
  `action` may remain the app command id; do not overload it as the primitive
  capability list.
- Targets may expose actionable geometry metadata needed for current-point
  resolution, human playback, and control-specific semantics. Keep the shape
  additive and documented in `shared/schemas/aos-semantic-targets.md`.
- Action resolution re-collects the current target at action time. A stale,
  missing, disabled, suspended, noninteractive, unsupported, or ambiguous ref
  fails with a machine-readable error.

### Panel Drag Handle Target

- Stock toolkit panel headers expose a stable `data-aos-ref`,
  `data-semantic-target-id`, accessible name, semantic role/name, and primitive
  action metadata for `drag`.
- The target ref is derived from stable surface/canvas identity, not native
  window numbers, generated DOM ids, or coordinates.
- `aos see capture --canvas <panel-id> --xray` reports the header or drag handle
  as an actionable semantic target.
- The target can be resolved to a current native/global point for human playback
  without requiring agents to choose pixels.

### Slider Target Metadata

- Toolkit sliders expose stable semantic refs on the actionable slider part.
- Single-thumb sliders expose value, min, max, step, orientation, enabled state,
  and current control/track/thumb geometry through semantic target output.
- Semantic targets list primitive actions including `set-value` and `drag`.
- Multi-thumb sliders are represented deliberately. V1 may support only
  single-thumb `set-value`, but multi-thumb targets must not be misrepresented
  as a safe single-value operation.

### Action Grammar

Add target-addressed forms while preserving coordinate fallback:

```bash
./aos do set-value canvas:<canvas-id>/<slider-ref> <value>
./aos do set-value canvas:<canvas-id>/<slider-ref> --value <value>
./aos do drag canvas:<canvas-id>/<drag-handle-ref> --by <dx>,<dy>
./aos do drag canvas:<canvas-id>/<slider-ref> --to-value <value> --playback human
```

Playback modes:

```bash
--playback immediate
--playback human
--playback auto
```

Default playback should prefer immediate semantic execution for AOS-owned
canvas controls when available. Human playback may resolve the current target
to coordinates and use CGEvent as an implementation detail. Coordinate forms
remain accepted as explicit fallback.

Do not keep the old input-tap preflight as a blanket requirement for immediate
canvas semantic actions. Input-tap preflight is still required for coordinate
actions and human playback.

### Execution Strategy Order

For target-addressed actions, choose the first available strategy that preserves
the requested intent:

1. AX action or AX set-value when the target is native AX and settable.
2. AOS canvas semantic target action route.
3. Toolkit DOM/control adapter route for AOS-owned WebView controls.
4. CGEvent coordinates only as fallback or as human-playback implementation
   detail.

### Action Responses

Target-addressed responses include:

- `action`
- `backend`
- `execution.strategy`
- `execution.backend`
- `execution.fallback_used`
- `execution.state_id` when supplied
- playback mode
- resolved target details, including canvas id, ref, role, name, primitive
  actions, local bounds/center, global point when applicable, coordinate space,
  and semantic target source
- post-action semantic state or target snapshot when available

## Scope

This is a cross-layer CLI/API contract slice:

- native action parsing/resolution in `src/act/` and `src/main.swift`;
- semantic target projection in `src/perceive/`;
- toolkit metadata in `packages/toolkit/runtime/`, `packages/toolkit/panel/`,
  and `packages/toolkit/controls/`;
- consumer-facing docs and tests.

Small fixed internal `show eval` probes are acceptable when they are part of
the AOS-owned implementation path. Do not expose caller-supplied JavaScript as
the public action contract.

## Hard Boundaries / Non-Goals

- Do not continue the old live panel drag coordinate debugging as this round's
  primary objective.
- Do not commit the interrupted `gdi/toolkit-panel-live-drag-correction-v1`
  diagnostic diff unless this card's deterministic work independently proves
  and requires the same change.
- Do not add Sigil-specific action branches to the native layer.
- Do not remove coordinate `drag` or coordinate `click`; they remain fallback
  forms.
- Do not claim broad DesktopWorld segmented-surface support unless it is
  implemented and tested.
- Do not make agents pass raw target coordinates for panel headers or sliders
  in the new happy path.

## Suggested Implementation Areas

- Generalize `src/act/canvas-ref-targeting.swift` from click-only resolution
  into current semantic target resolution plus action-specific helpers.
- Update `src/act/act-cli.swift` parsing for target-addressed `set-value` and
  `drag`, including `--by`, `--to-value`, and `--playback`.
- Adjust `src/main.swift` preflight routing so immediate semantic canvas actions
  do not fail before parsing due to input-tap requirements.
- Extend `src/perceive/models.swift` and `src/perceive/semantic-targets.swift`
  for primitive action lists and slider geometry/state.
- Extend `packages/toolkit/runtime/semantic-targets.js` so toolkit authors can
  stamp primitive actions and metadata consistently.
- Stamp panel header/drag-handle metadata in `packages/toolkit/panel/chrome.js`.
- Stamp slider/action metadata in `packages/toolkit/controls/slider.js`,
  `packages/toolkit/adapters/zag/slider.js`, and/or
  `packages/toolkit/panel/form.js`.

## Verification

Run focused deterministic tests first. Add or update tests as needed, then run
the relevant focused commands:

```bash
node --test tests/toolkit/runtime-semantic-targets.test.mjs tests/toolkit/panel-chrome.test.mjs tests/toolkit/panel-form.test.mjs tests/toolkit/zag-adapter-slider.test.mjs
bash tests/external-parser-flags.sh
git diff --check
```

If Swift/native CLI behavior changed, rebuild through the repo control surface:

```bash
./aos dev build
```

Add or update live canvas smoke coverage for semantic targets and target-addressed
actions. When readiness passes, run the focused live checks:

```bash
bash tests/aos-semantic-targets-xray.sh
bash tests/aos-canvas-ref-click.sh
```

Add the new target-addressed action smoke test you create, for example:

```bash
bash tests/aos-canvas-ref-actions.sh
```

The live smoke should prove at least:

- xray exposes panel drag-handle and slider targets with expected action
  metadata;
- `aos do set-value canvas:<id>/<slider-ref> <value>` changes slider state
  without requiring coordinate selection by the agent;
- `aos do drag canvas:<id>/<panel-drag-ref> --by 80,40 --dry-run` resolves the
  current target and reports strategy/playback/target details;
- if human playback is available and `./aos ready --post-permission` passes,
  the same semantic drag target can produce a bounded visible proof.

If readiness is blocked, report the exact blocker and deterministic evidence
instead of substituting raw coordinate debugging.

## Completion Report

Report:

- branch name and HEAD SHA;
- changed paths;
- exact action grammar implemented;
- target schema fields added and docs updated;
- which strategy each target-addressed action uses;
- tests run with exact pass/fail results;
- live smoke result or readiness blocker;
- whether the interrupted panel drag diagnostic diff was ignored, superseded,
  or re-derived;
- any remaining follow-up slice, especially if human playback still needs a
  second round after immediate semantic actions pass.

After completion, clear any reused GDI goal state with `/goal clear` before
retiring the session or starting unrelated work.
