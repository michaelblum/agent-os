# GDI Work Card: One-World Anchored Panel Placement V0

## Recipient

GDI implementation / validation round.

## Tracker

- Primary epic: #223 AOS Surface System / One-World.
- Related lane: #427 shared pointer/gesture interaction spine.
- Related design notes:
  - `docs/design/aos-surface-world-goal-contract-v0.md`
  - `docs/design/aos-panel-window-placement-contract.md`
  - `docs/design/aos-surface-system.md`
- Current live user report:
  - Right-clicking the Sigil avatar can open the embedded Avatar controls panel
    straddling the main and extended display.
  - Initial open should keep the panel on the avatar's display and place it
    adjacent to the avatar, left or right, without covering the avatar or
    clipping outside that display's visible viewport.
  - After a straddling open, scrolling over the upper fragment can stop while
    the lower fragment keeps scrolling, suggesting segmented DesktopWorld
    renderer state/layout drift.

## Branch / Base

- `branch_from`: local `main`
- `required_start_ref`: local `main` containing this work card
- Current local prerequisite head before this card: `89a9fe7759a25e890b4b3c47f411e02ca00b801c`
- Published prerequisite base: `origin/main` at `36c9b37080c420f47ea8e1fa8c5396201c41f2a5`
- Expected output branch: `gdi/one-world-anchored-panel-placement-v0`

Local `main` is intentionally ahead of `origin/main`. Do not restart from
`origin/main`; this card depends on the current One-World/Sigil local stack.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, checkout, daemon,
canvas, issue, prior live state, display topology, or prior implementation
state. Read and rediscover before editing.

Use the single checkout at `/Users/Michael/Code/agent-os`. Do not create linked
git worktrees.

## Goal

Make toolkit panel/window placement expose a first-class anchored-placement API
and use it for the Sigil One-World embedded Avatar controls initial open, so
right-clicking the avatar initially places controls beside the avatar on the
avatar's display without covering the avatar or straddling display segments.

Also preserve the cross-segment scroll report as deterministic evidence: either
fix a small obvious toolkit/One-World logical-scroll state bug, or add a focused
diagnostic/ledger note that records the remaining segmented scroll follow-up
after initial placement prevents the normal bad state.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/panel/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `docs/design/aos-surface-world-goal-contract-v0.md`
- `docs/design/aos-panel-window-placement-contract.md`
- `docs/design/aos-surface-system.md`
- `docs/design/work-cards/gdi-aos-one-world-phase3-surface-migration-v0.md`
- `packages/toolkit/panel/placement.js`
- `packages/toolkit/panel/chrome.js`
- `packages/toolkit/runtime/spatial.js`
- `apps/sigil/avatar-controls/surface.js`
- `apps/sigil/avatar-controls/compact-surface-session.js`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/display-utils.js`
- `tests/toolkit/panel-chrome.test.mjs`
- `tests/renderer/avatar-controls-hit-test.test.mjs`
- `tests/renderer/sigil-panel-window-migration.test.mjs`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD
git branch --show-current
./aos dev gh issue view 223 --json
./aos dev gh issue view 427 --json
./aos dev recommend --json --paths packages/toolkit/panel/placement.js,packages/toolkit/panel/chrome.js,packages/toolkit/runtime/spatial.js,apps/sigil/avatar-controls/surface.js,apps/sigil/avatar-controls/compact-surface-session.js,apps/sigil/renderer/live-modules/main.js,tests/toolkit/panel-chrome.test.mjs,tests/renderer/avatar-controls-hit-test.test.mjs
rg -n "createPlacementPlan|viewportOverflowPolicy|anchorFrame|resolveAvatarControlsOrigin|panelUrl: null|One-World|scrollSurfaceAt|nativeFrameFromDesktopRect|computeBaseScale|unionDragWorkArea" packages/toolkit apps/sigil tests docs/design
```

Live AOS is useful but not required for first implementation. If live checks are
used, use `./aos` as the control plane. Do not use Operator. Do not run
`./aos service start`, `./aos service restart`, `./aos clean`, or
`./aos launch ... --allow-start` in this GDI round unless Foreman explicitly
approves it later. If repo-mode readiness or input permissions block live
checks, stop with `human_needed` using:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then return the blocker to Foreman.

## Existing Facts To Preserve

- Production Sigil Avatar controls are currently One-World embedded controls:
  `apps/sigil/renderer/live-modules/main.js` sets `panelUrl: null`. The panel
  canvas path must not be resurrected.
- `apps/sigil/avatar-controls/surface.js` currently sets embedded
  `surfaceState.bounds` from the right-click/open point. That is the local
  symptom, not the right layer for display-placement policy.
- `packages/toolkit/panel/placement.js` already owns `createPlacementPlan()`,
  display/work-area helpers, and overflow policies.
- `createPanelWindowController().settleInitialPlacement()` already reports
  requested, policy-adjusted, final-settled frame, and overflow policy for
  panel windows.
- A prior Sigil fallback moves the avatar away after a final panel frame exists.
  Keep that fallback only as defensive overlap handling; initial placement
  should be correct before the fallback runs.
- User explicitly does not want a regression away from the One-World path.

## Required Behavior

### Toolkit Anchored Placement API

Add a pure toolkit placement helper in `packages/toolkit/panel/placement.js`.
Suggested shape:

```js
createAnchoredPanelPlacementPlan({
  anchorRect,
  panelSize,
  displays,
  preferredPlacements: ['right', 'left'],
  gap: 12,
  offset: { x: 0, y: 0 },
  constrainTo: 'anchor-display',
  viewportOverflowPolicy: 'flip-shift',
  cause: 'placement.anchor',
})
```

GDI may adjust names after reading existing conventions, but preserve this
contract:

- Input anchor and result frames are in the same logical desktop coordinate
  space used by the caller.
- The helper chooses the display/work area from the anchor rect center unless a
  caller provides an explicit display/work area.
- For initial panel placement, normal panels rest entirely on one display's
  visible work area.
- Preferred side order is caller-configurable. For Avatar controls use
  right-then-left, with vertical fallbacks only if neither side fits.
- The chosen placement keeps a gap from the anchor and must not cover the
  anchor when a non-overlapping candidate exists.
- The return payload preserves the existing placement-reporting vocabulary and
  adds anchor metadata:

```js
{
  requested_frame,
  policy_adjusted_frame,
  final_settled_frame,
  viewport_overflow_policy,
  anchor_frame,
  anchor_display_id,
  chosen_placement,
  cause,
}
```

### Sigil One-World Embedded Controls

Update the Sigil embedded controls open path to consume the toolkit helper
instead of doing private top-left-from-click placement.

Requirements:

- Keep `panelUrl: null`; no detached `sigil-avatar-controls-avatar-main` panel
  canvas creation or prewarm path.
- Sigil supplies the avatar anchor rect, desired embedded panel size, display
  topology, preferred placements, and cause string.
- Initial `surfaceState.bounds` uses the toolkit plan's final settled frame.
- Store or trace enough placement metadata to debug the decision.
- Initial open should not straddle the main/extended display seam when the
  avatar is on one display and the panel fits on that display.
- Manual dragging may still allow straddling displays through the existing
  One-World/union drag path.

### Segmented Scroll Follow-Up

Investigate the reported split-scroll symptom without expanding the slice into
a full segmented renderer rewrite.

At minimum, add durable evidence in tests or a design note that classifies the
remaining risk:

- embedded panel scroll currently mutates DOM `scrollTop` directly;
- straddled panels may produce per-segment DOM/layout divergence;
- `computeBaseScale()` currently derives from `window.innerHeight`, which can
  differ by segment;
- initial anchored placement should avoid the normal straddled-open path;
- any later drag-induced straddled scroll consistency belongs to the
  One-World/toolkit segmented logical-state layer.

If a narrow fix is obvious and testable, implement it. Otherwise, do not fake a
complete segmented scroll solution.

## Scope

In scope:

- `packages/toolkit/panel/placement.js`
- `packages/toolkit/panel/chrome.js` only if the public controller needs a small
  pass-through for anchored initial placement
- `apps/sigil/avatar-controls/surface.js`
- `apps/sigil/avatar-controls/compact-surface-session.js` only if needed for
  embedded placement metadata or scroll diagnostics
- focused tests under `tests/toolkit/` and `tests/renderer/`
- a concise design/ledger note if segmented scroll is classified as follow-up

## Hard Boundaries / Non-Goals

- Do not route or use Operator.
- Do not create linked worktrees.
- Do not push, open a PR, close issues, or mutate GitHub state.
- Do not revive the detached Avatar controls panel canvas; preserve the
  One-World embedded controls path.
- Do not edit Swift/native daemon code.
- Do not rebuild `./aos`; Foreman owns native rebuild/TCC handoff.
- Do not redesign Avatar controls UI.
- Do not move app-owned avatar personality/visual behavior into toolkit.
- Do not make toolkit know about Sigil or avatars.
- Do not solve cross-segment scrolling by adding local DPI hacks in Sigil.
- Do not broaden into #431 input-event cutover or target-identity work.

## Suggested Tests

Add or update deterministic tests to cover:

- pure toolkit anchored placement:
  - anchor on main display near right edge chooses left side;
  - anchor on main display near left edge chooses right side;
  - anchor near a stacked-display seam keeps the panel on the anchor display;
  - panel clamps/shifts inside the anchor display visible work area;
  - return payload includes `anchor_frame`, `anchor_display_id`,
    `chosen_placement`, and existing placement-reporting fields.
- Sigil embedded controls:
  - `openAt()` uses anchored placement instead of click-point top-left;
  - `panelUrl: null` path does not dispatch `panel.toggle`;
  - initial embedded bounds do not overlap the avatar when a side placement is
    available;
  - initial embedded bounds remain within the avatar display's DesktopWorld
    visible bounds.
- segmented scroll diagnostic:
  - if no full fix is implemented, a focused test/note prevents future agents
    from treating drag-induced straddled scroll drift as solved by detached
    panel migration or Sigil-only DPI math.

Likely commands:

```bash
git diff --check
node --test tests/toolkit/panel-chrome.test.mjs
node --test tests/renderer/avatar-controls-hit-test.test.mjs
node --test tests/renderer/sigil-panel-window-migration.test.mjs
node --test tests/renderer/sigil-one-world-co-location-probe.test.mjs tests/renderer/sigil-one-world-phase2-scheduler.test.mjs tests/renderer/sigil-one-world-extension-api.test.mjs
```

If live AOS remains ready without service repair, optional bounded smoke:

```bash
./aos status --json
./aos show list --json
./aos show eval --id avatar-main --js 'JSON.stringify(window.__sigilDebug?.snapshot?.().avatarControls ?? null)'
```

Do not perform live service restart/repair in this GDI round.

## Completion Report

Report:

- changed paths;
- exact toolkit API added and payload shape;
- how Sigil uses the API while preserving `panelUrl: null`;
- placement test cases and results;
- segmented scroll finding: fixed narrowly or classified as follow-up;
- exact commands run and pass/fail results;
- whether live AOS smoke was run or skipped, and why;
- local branch/head and any dirty/untracked state;
- remaining follow-up recommendation for Foreman.
