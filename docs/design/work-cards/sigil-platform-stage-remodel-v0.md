# Sigil Platform Stage Remodel V0

## Status

Superseded by bounded #305 slices and the second-client inventory in
`docs/design/aos-surface-stack-v0-integration-ledger.md`.

Completed V0 slices include Sigil's generic input-region adapter, toolkit
DesktopWorld hit-region controller adoption for avatar/radial child surfaces,
child canvas-origin input identity cleanup, radial item workbench/editor
panel-window controller adoption, and the final second-client surface
inventory. Do not treat this card as an untouched broad remodel prompt.

The current recommendation is to close #305 as a V0 second-client checkpoint
once the inventory slice lands. Future work should be split into exact cards for
revived parked surfaces, Agent Terminal compatibility-path retirement, or a
shared 3D stage only if a concrete cross-app need appears.

## Tracker

- Epic: #223 AOS Surface System
- Issue: #305 Remodel Sigil as first-class consumer of AOS surface platform
- Plan: `docs/design/aos-canon-surface-boundary-alignment-plan.md`
- Related docs: `apps/sigil/AGENTS.md`, `docs/api/toolkit.md`,
  `docs/design/aos-surface-system.md`

## Goal

Remodel Sigil so it reads as the first app built on the AOS platform rather than
as a private platform fork.

This does not mean deleting Sigil's 3D personality renderer. It means separating
what is truly Sigil product expression from reusable platform concerns:
DesktopWorld stages, visual/interaction bindings, hit regions, panel chrome,
workbench shell behavior, and surface lifecycle.

## Required Audit

Map current Sigil surfaces into one of these buckets:

- product expression that should stay in Sigil;
- toolkit surface/windowing behavior that should be adopted or extracted;
- daemon primitive needs that should not be faked in Sigil;
- legacy surfaces that should be parked rather than evolved.

At minimum inspect:

- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/hit-area.html`
- `apps/sigil/renderer/radial-menu-surface.html`
- `apps/sigil/context-menu/`
- `apps/sigil/codex-terminal/index.html`
- `apps/sigil/radial-item-editor/`
- `apps/sigil/radial-item-workbench/`

## Required Direction

- Keep Sigil's avatar/effects/radial personality in app code.
- Prefer toolkit panel/windowing for Sigil panels and workbenches.
- Prefer shared DesktopWorld stage layers for simple desktop-wide visuals.
- Keep a private `avatar-main` or successor 3D DesktopWorld renderer only where
  Sigil needs a distinct Three.js lifecycle or renderer boundary.
- Bind visual layers to explicit input regions or interaction surfaces.
- Stop adding new daemon product branches for Sigil behavior.

## Deliverable

Produce a concrete migration plan and implement the first safe slice. The first
slice should be small enough to verify, such as migrating one non-core Sigil
panel off private chrome or registering one Sigil hit target through the generic
input-region contract once available.

## Verification

Run the relevant focused tests for changed Sigil modules. If pointer behavior is
touched and readiness allows, run:

```bash
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input.sh
```

Always run:

```bash
git diff --check
```

## Non-Goals

- no wholesale Sigil rewrite;
- no removal of the 3D renderer unless a shared 3D stage already satisfies the
  same needs;
- no extension of legacy chat/workbench surfaces as new product paths;
- no broad visual redesign.

## Completion Report

Include:

- surface inventory and bucket decisions;
- first implementation slice completed, if any;
- tests run;
- remaining platform gaps blocking a fuller remodel.
