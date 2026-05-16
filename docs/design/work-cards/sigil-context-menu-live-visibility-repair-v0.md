# Sigil Context Menu Live Visibility Repair V0

## Tracker

- Triggering Operator sweep:
  `docs/design/work-cards/operator-post-may16-ui-radial-live-sweep-v0.md`.
- Operator result on 2026-05-16: partial pass. Surface Inspector,
  Markdown Workbench, Sigil radial real input, data-driven radial visuals, and
  direct radial item editor smoke passed. The remaining blocker is Sigil context
  menu visibility after real right-click.
- Current target: `main` at or after
  `d5ca253` (`docs(work-cards): route post radial live sweep`) and
  `4efa800ffdf1a0734ca143206a77f8c4b48eade5`
  (`merge: integrate sigil radial menu branch`).
- Related prior cards:
  - `docs/design/work-cards/recent-ui-live-regression-closure-gdi-v0.md`;
  - `docs/design/work-cards/sigil-context-menu-data-driven-controls-v0.md`;
  - `docs/design/work-cards/sigil-radial-menu-data-driven-3d-config-v0.md`.

## Fresh Context Contract

GDI starts from a fresh context window. Work in
`/Users/Michael/Code/agent-os`, not in `.docks/`. Do not assume branch,
worktree, daemon, canvas, display, evidence artifact, or prior implementation
state. Read and rediscover before editing.

## Goal

Repair the live Sigil context menu so a real right-click on the avatar makes the
menu visibly render at its computed frame with readable controls.

This is a focused visibility/layout repair. Operator already proved the main
right-click path reaches Sigil, `contextMenu.open === true`, the menu bounds are
computed, and the Sigil hit surface/input region moves to the context-menu
frame. Do not broaden into radial menu, 3D object graph, or input-region
architecture unless new evidence disproves that boundary.

## Operator Evidence

Primary artifact directory:

```text
/tmp/aos-operator-post-may16-ui-radial-live-sweep-v0/
```

Relevant artifacts:

- `sigil-context-menu-open-state.json`
- `sigil-context-menu-html-snippet.txt`
- `sigil-context-menu-main-region.png`
- `sigil-context-menu-open.png`
- `sigil-context-menu-open-show-list.json`
- `sigil-context-hit-canvas-state.json`

Observed state:

- `window.__sigilDebug.snapshot().contextMenu.open === true`.
- Context menu bounds are `x=1117,y=534,w=292,h=448` in the debug snapshot.
- `sigil-hit-avatar-main` moves to a menu-sized frame:
  `[910,534,292,448]`.
- The context-menu input region is registered with the same menu-sized frame.
- Screen capture shows no rendered context menu.
- Controls in the captured debug payload have `0x0` DOM rects.
- The HTML snippet shows the menu content has `data-state="open"`, but the
  anchor remains `aria-hidden="true"` and its class list lacks the expected
  `visible` class:

```html
<div id="sigil-context-menu" class="ctx-anchor sigil-context-menu"
  aria-hidden="true" data-state="open" ...>
```

Initial Foreman hypothesis, to verify rather than assume: Zag menu binding or
state synchronization may be overwriting the anchor's visibility class and
ARIA state after `openAt()` adds `.visible`, leaving `.ctx-anchor` at
`display: none`.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `docs/design/work-cards/operator-post-may16-ui-radial-live-sweep-v0.md`
- `docs/design/work-cards/sigil-context-menu-data-driven-controls-v0.md`
- `docs/design/aos-3d-object-graph-platform-contract.md`
- `apps/sigil/context-menu/menu.js`
- `apps/sigil/context-menu/styles.css`
- `apps/sigil/context-menu/descriptors.js`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/hit-target.js`
- `apps/sigil/renderer/live-modules/input-regions.js`
- `packages/toolkit/adapters/zag/menu.js`
- `packages/toolkit/runtime/interaction-region.js`
- `tests/renderer/context-menu-hit-test.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
git log --oneline -8 --decorate
./aos dev recommend --json
./aos ready
```

If `/tmp/aos-operator-post-may16-ui-radial-live-sweep-v0/` still exists, inspect
the artifacts listed above before editing. If it is gone, reproduce from the
live steps below after deterministic inspection.

If `./aos ready` reports `diagnosis=daemon_tcc_grant_stale_or_missing` or
`input_tap_not_active`, continue with deterministic tests where possible and
report the live blocker exactly. Do not run ad-hoc permission repair loops.

## Existing Code To Inspect

- `apps/sigil/context-menu/menu.js` owns markup, Zag binding, open/close state,
  class/ARIA synchronization, stack-menu state, interactive bounds, and pointer
  routing for context-menu controls.
- `apps/sigil/context-menu/styles.css` owns `.ctx-anchor`,
  `.ctx-anchor.visible`, `.ctx-menu-card.active`, and menu visual treatment.
- `apps/sigil/context-menu/descriptors.js` owns descriptor-driven control
  routing. It should not need broad behavior changes for this visibility bug.
- `apps/sigil/renderer/live-modules/main.js` owns `openContextMenuAt()`,
  hit-surface synchronization, input-region synchronization, and render-frame
  scheduling.
- `packages/toolkit/adapters/zag/menu.js` owns the shared Zag menu adapter. If
  the adapter overwrites caller-owned classes or ARIA state, fix that generally
  without hard-coding Sigil.
- `tests/renderer/context-menu-hit-test.test.mjs` is the current deterministic
  context-menu regression suite. Add focused coverage for the visibility/ARIA
  regression.

## Required Behavior

After real right-click on the avatar:

- Sigil context menu is visible on screen at the computed menu frame.
- The root menu card and active panel controls have non-zero DOM rects.
- The menu anchor preserves the open visibility state:
  `.ctx-anchor.visible`, `data-state="open"`, and `aria-hidden="false"` or an
  equivalent accessible open state.
- `contextMenu.interactiveBounds()` and the Sigil hit surface stay aligned to
  the visible menu card.
- Tabs, descriptor-routed controls, stacked submenus, select popovers, range
  dragging, and utility actions still work.
- Closing the menu removes the visible state, clears menu bounds, and returns
  the hit target to the avatar path.

## Scope

Own the smallest correct layer:

- Prefer a Sigil context-menu state/binding fix if the bug is local to how
  Sigil applies Zag props after opening.
- Prefer a shared Zag adapter preservation fix only if the adapter is generally
  overwriting caller-owned state such as `class`, `aria-hidden`, or
  `data-state`.
- Update deterministic renderer tests to prove open state yields non-zero
  layout and preserved visibility state.

## Hard Boundaries

- Do not redesign the Sigil context menu.
- Do not move context-menu behavior into the daemon.
- Do not add Sigil-specific daemon hooks.
- Do not change data-driven radial menu config, radial item GLTF/effect
  modules, or radial real-input semantics unless directly required by the
  repair.
- Do not rewrite descriptor routing or avatar object graph behavior.
- Do not reintroduce bare `@zag-js/...` imports in browser-consumed files.
- Do not save/import durable Sigil appearance changes during live smoke.

## Suggested Implementation Areas

Inspect `bindZagMenu()` and the sequence in `openAt()`:

1. `syncPosition()`;
2. `anchor.classList.add('visible')`;
3. `applyStackState()`;
4. `zagMenu.open(...)`;
5. `syncSnapshot()` / `bindZagMenu()`.

The Operator HTML snapshot suggests that a later binding step may remove the
`visible` class or restore `aria-hidden="true"` after the menu opens. If that is
confirmed, make the visibility state single-source and regression-tested.

Also check whether the WebView segment/local coordinate projection causes the
anchor to render outside the local viewport even while the hit canvas moves to
the correct desktop-world frame. Do not assume CSS is the only possibility until
you compare anchor rects, card rects, and hit canvas frame.

## Verification

Run deterministic checks first:

```bash
git diff --check
node --test tests/renderer/context-menu-hit-test.test.mjs
node --test tests/renderer/input-message.test.mjs tests/renderer/hit-target.test.mjs tests/renderer/sigil-input-regions.test.mjs
node --test tests/renderer/radial-menu-target-surface.test.mjs tests/renderer/radial-gesture-menu.test.mjs
```

If you touch shared Zag adapter behavior, also run the relevant toolkit adapter
tests:

```bash
node --test tests/toolkit/zag-menu.test.mjs tests/toolkit/*.test.mjs
```

If `tests/toolkit/zag-menu.test.mjs` does not exist, do not invent a broad
suite just to satisfy this line. Add the smallest focused test in the existing
Zag/toolkit test shape and report the exact file used.

If `./aos ready` passes, run bounded live smoke:

```bash
./aos show remove-all || true
./aos set content.roots.sigil apps/sigil
./aos content wait --root sigil --auto-start --timeout 15s
./aos show create --id avatar-main --url aos://sigil/renderer/index.html --track union
./aos show wait --id avatar-main --timeout 8s || true
```

Then use real pointer input to right-click the avatar hit target. Capture:

```bash
mkdir -p /tmp/aos-gdi-sigil-context-menu-visibility-repair-v0
./aos show list --json \
  > /tmp/aos-gdi-sigil-context-menu-visibility-repair-v0/show-list-after-context-open.json
./aos show eval --id avatar-main --js 'JSON.stringify({debug: window.__sigilDebug?.snapshot?.() ?? null, menu: (() => { const el = document.querySelector("#sigil-context-menu"); const card = document.querySelector("#sigil-menu-root"); return { anchorClass: el?.className ?? null, ariaHidden: el?.getAttribute("aria-hidden"), state: el?.getAttribute("data-state"), anchorRect: el?.getBoundingClientRect?.() ?? null, cardRect: card?.getBoundingClientRect?.() ?? null }; })()})' \
  > /tmp/aos-gdi-sigil-context-menu-visibility-repair-v0/context-menu-visible-state.json
```

For live acceptance, prove:

- screen capture shows the menu;
- `anchorClass` includes `visible`;
- `ariaHidden` is not `"true"` while open;
- anchor/card rects are non-zero;
- `sigil-hit-avatar-main` is aligned to the visible menu;
- closing the menu clears the visible state and cleanup leaves no active
  canvases after `./aos show remove-all`.

Also rerun the canonical radial proof to guard the previously passed path:

```bash
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input.sh
```

## Completion Report

Report:

- files changed;
- confirmed root cause;
- whether the fix was Sigil-local or shared Zag-adapter behavior;
- deterministic tests run with exact pass/fail results;
- exact `./aos ready` result;
- live smoke result and artifact paths under
  `/tmp/aos-gdi-sigil-context-menu-visibility-repair-v0/`;
- whether context menu controls have non-zero rects and are visibly readable;
- whether radial real-input still passes;
- whether `./aos show list --json` is clean after cleanup;
- local-only state or generated artifacts Foreman must know before acceptance.
