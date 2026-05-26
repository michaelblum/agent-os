# Toolkit Stage-Backed Minimized Chips V0

## Tracker

- Epic: #223 AOS Surface System
- Issue: #304 Toolkit minimized chips should use DesktopWorld stage layers and
  hit regions
- Related issue: #261 panel window placement contract
- Plan: `docs/design/aos-canon-surface-boundary-alignment-plan.md`
- Prior slice: #303 daemon generic input regions, work card
  `docs/design/work-cards/daemon-generic-input-region-contract-v0.md`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Make toolkit panel minimize fast by rendering minimized chips as lightweight
DesktopWorld stage layers with explicit input regions instead of creating a new
interactive WebView chip for every minimized panel.

The policy stays in toolkit. The daemon supplies only native lifecycle, display,
visibility, and input-region primitives.

## Current Evidence

`packages/toolkit/panel/chrome.js` currently minimizes by:

1. computing a chip frame;
2. spawning `packages/toolkit/panel/minimized-chip.html` as an interactive
   canvas;
3. suspending the source canvas;
4. resuming the chip canvas.

Cold interactive WebView creation can dominate the interaction, which is why
Surface Inspector collapse can feel seconds slower than the intended state
change.

Foreman review of the prior daemon input-region slice found the new API present
in `packages/toolkit/runtime/input-region.js` and exported from
`packages/toolkit/runtime/index.js`. Deterministic checks passed:

```bash
bash tests/daemon-input-surface-ownership.sh
node --test tests/toolkit/runtime-input-region.test.mjs
node --test tests/toolkit/*.test.mjs
bash tests/help-contract.sh
node --test tests/schemas/*.test.mjs
git diff --check
./aos dev build
```

Live pointer smoke is currently blocked. `./aos ready` returns
`phase=human_required` with
`diagnosis=daemon_tcc_grant_stale_or_missing` for the repo-mode
`/Users/Michael/Code/agent-os/aos` binary. Do not treat missing live smoke as a
chip failure until the safe macOS TCC reset has happened.

## Foreman Review Status

Foreman accepts the current GDI implementation as a V0 proof for #304. The diff
has been reviewed deterministically: the default path creates a DesktopWorld
stage chip plus restore, close, and body input regions, while retaining the old
WebView chip as an explicit fallback.

Checks run:

```bash
node --test tests/toolkit/panel-chrome.test.mjs
node --test tests/toolkit/runtime-input-region.test.mjs
git diff --check
```

All passed. Live pointer smoke is still blocked by the repo-mode TCC issue
above. The next implementation slice should not start Sigil migration; it
should extract the reusable StageAffordance / visual-hit binding from this V0
implementation:

`docs/design/work-cards/toolkit-stage-affordance-extraction-v0.md`

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/panel/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `docs/design/aos-canon-surface-boundary-alignment-plan.md`
- `docs/design/aos-surface-system.md`
- `docs/design/aos-panel-window-placement-contract.md`
- `docs/design/work-cards/daemon-generic-input-region-contract-v0.md`
- `docs/api/toolkit.md`
- `shared/schemas/daemon-event.md`

## Rediscover State

Run:

```bash
git status --short --branch
./aos ready
./aos dev recommend --json
gh issue view 304 --json number,title,state,url,body,labels
gh issue view 303 --json number,title,state,url,body,labels
```

If `./aos ready` reports the known
`daemon_tcc_grant_stale_or_missing` blocker, do not run live pointer smoke.
Report the blocker and use deterministic tests. If the human has completed the
safe permission reset and says `ready`, run `./aos ready --post-permission`.

## Existing Code To Inspect

- `packages/toolkit/panel/chrome.js` - owns the current minimize sequence and
  maximize/minimize state.
- `packages/toolkit/panel/minimized-chip.html` - current WebView-backed chip to
  replace or retain only as explicit fallback.
- `packages/toolkit/panel/placement.js` - chip frame, restore frame, and
  work-area placement helpers.
- `packages/toolkit/panel/drag-transfer.js` - existing DesktopWorld visual
  affordance pattern for cross-display outlines.
- `packages/toolkit/components/desktop-world-stage/` - shared click-through
  DesktopWorld visual layer stage.
- `packages/toolkit/runtime/input-region.js` - `registerInputRegion`,
  `updateInputRegion`, `removeInputRegion`, and helper exports.
- `packages/toolkit/runtime/subscribe.js` and `runtime/bridge.js` - bridge and
  subscription mechanics for input-region events.
- `shared/schemas/daemon-event.md` - documents `input_region.*` bridge messages
  and `input_region.event` payloads.
- `tests/toolkit/panel-chrome.test.mjs` - deterministic panel lifecycle tests.
- `tests/toolkit/runtime-input-region.test.mjs` - focused input-region runtime
  helper tests.

## Required Behavior

### Minimize Path

- Minimize should promptly hide or suspend the source panel.
- The visible chip should be a layer on the shared DesktopWorld stage, not a new
  interactive WebView, when the stage and input-region API are available.
- Duplicate minimize clicks must not create duplicate chip layers or duplicate
  input regions.
- Maximize state must still restore to the documented pre-minimize frame policy.

### Chip Interactions

- Register explicit input regions for restore, close, and drag/body as needed.
- Region ids must be stable enough to clean up deterministically and unique
  enough to avoid collisions across multiple minimized panels.
- `input_region.event` delivery should restore/resume or close/remove through
  toolkit policy, not through daemon-owned minimize semantics.
- Drag/body behavior may be minimal in V0 if restore and close are solid; if drag
  is deferred, say so in the completion report.

### Stage And Region Cleanup

- Restore should resume the source panel and remove the chip stage layer and all
  related regions.
- Close should remove the source panel and chip layer/regions.
- Source panel removal, suspend failure, chip setup failure, or fallback use must
  not leave stale stage layers or stale input regions.
- If the shared stage or input-region primitive is unavailable, the fallback path
  must be explicit, observable, and tested enough that Foreman can tell it was
  intentional.

## Scope

This is toolkit panel/windowing work with daemon primitives already provided by
the prior slice. Keep default surface/windowing policy in toolkit. Use the
daemon input-region API for hit routing, but do not move minimize policy into
the daemon.

## Hard Boundaries / Non-Goals

- no daemon-owned minimize policy;
- no global macOS window manager;
- no Sigil remodel;
- no broad panel redesign beyond what chip rendering requires;
- no unrelated Surface Inspector annotation, Employer Brand, browser capture, or
  workbench artifact work;
- no hidden reliance on live pointer smoke while repo-mode TCC is blocked.

## Suggested Implementation Areas

- Add a toolkit chip/windowing controller under `packages/toolkit/panel/` unless
  inspection shows a narrower place.
- Reuse or extend `packages/toolkit/components/desktop-world-stage/model.js` for
  chip visual layers if the current `outline`/label model is insufficient.
- Keep placement helpers in `packages/toolkit/panel/placement.js`.
- Use `registerInputRegion`, `updateInputRegion`, and `removeInputRegion` from
  `packages/toolkit/runtime/input-region.js`.
- Keep `packages/toolkit/panel/minimized-chip.html` only as a documented
  fallback or retire it if deterministic coverage proves the stage path.

## Verification

Run deterministic tests:

```bash
node --test tests/toolkit/panel-chrome.test.mjs
node --test tests/toolkit/runtime-input-region.test.mjs
node --test tests/toolkit/surface-inspector.test.mjs
git diff --check
```

If you touch shared stage or broader toolkit helpers, also run:

```bash
node --test tests/toolkit/*.test.mjs
```

If `./aos ready` passes, run a bounded live smoke:

1. launch Surface Inspector or another toolkit panel;
2. minimize it;
3. verify collapse is visually prompt and does not create an interactive
   `aos-chip-*` WebView canvas unless fallback was intentionally used;
4. restore it through the chip region;
5. close/minimize again and verify no stale stage layers or input regions remain.

If `./aos ready` reports `daemon_tcc_grant_stale_or_missing`, do not improvise a
permission repair loop. Report the safe reset blocker:

1. `./aos service stop --mode repo`
2. wait for `running=false`;
3. human removes/re-adds `/Users/Michael/Code/agent-os/aos` in Accessibility and
   Input Monitoring;
4. after human returns with `finished`, run `./aos ready --post-permission`.

## Completion Report

Include:

- files changed;
- whether chip visuals are stage layers or fallback WebViews;
- exact input-region ids/policies used for restore, close, and drag/body;
- cleanup behavior for restore, close, source removal, and failure;
- measured or observed minimize timing before/after if live smoke was possible;
- deterministic tests run with exact result;
- live smoke result, or the exact readiness blocker;
- any remaining follow-up slice, especially if chip drag was deferred.
