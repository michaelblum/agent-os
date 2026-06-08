# Recent UI Live Regression Closure Implementer V0

## Fresh Context Contract

Start from a fresh Implementer session in `/Users/Michael/Code/agent-os`. Do not work in
`.docks/`. Rediscover repo state before editing. This is a deterministic repair
slice after Operator reran
`docs/design/work-cards/operator-recent-ui-regression-live-sweep-v0.md` against
local `main` at `d5eeae17e29f98e0bea257f77b343f5a925103a8`.

## Goal

Repair the remaining live blockers from the May 16 Operator sweep so the next
live sweep can pass the primary UI surfaces.

Keep the already-passing areas out of scope unless a fix directly regresses
them:

- Surface Inspector stage-backed minimize/restore and duplicate-minimize
  cleanup passed.
- Playbook, Work Record, Surface-Zoom, Wiki KB, Integration Hub, and Decision
  Gate passed or were pass-with-caveat.
- The current failures are Surface Inspector visibility/close, Markdown
  Workbench real-click source toggle, and Sigil hit/radial real-input
  activation.

Primary evidence is under:

```text
/tmp/aos-operator-ui-live-sweep-v0/
```

Do not depend on temp artifacts as the only proof. Add deterministic tests or
scripts for each fixed path where practical.

## Read First

- `AGENTS.md`
- `packages/toolkit/CLAUDE.md`
- `apps/sigil/AGENTS.md`
- `docs/api/toolkit/components.md`
- `docs/api/toolkit/panel-window.md`
- `docs/design/work-cards/operator-recent-ui-regression-live-sweep-v0.md`
- `docs/design/work-cards/recent-ui-live-regression-implementer-repairs-v0.md`
- `docs/design/work-cards/recent-ui-tabs-keyboard-focus-correction-v0.md`
- `docs/design/work-cards/recent-ui-live-regression-polish-implementer-v0.md`
- `docs/design/work-cards/toolkit-child-hit-surface-normalization-gate-correction-v0.md`
- `docs/design/work-cards/panel-chrome-maximize-minimize-lifecycle-v0.md`
- `/tmp/aos-operator-ui-live-sweep-v0/surface-inspector-before.png`
- `/tmp/aos-operator-ui-live-sweep-v0/surface-inspector-after-maximize.png`
- `/tmp/aos-operator-ui-live-sweep-v0/surface-inspector-after-event-toggle.png`
- `/tmp/aos-operator-ui-live-sweep-v0/stage-after-panel-close.json`
- `/tmp/aos-operator-ui-live-sweep-v0/surface-inspector-elements-after-maximize.json`
- `/tmp/aos-operator-ui-live-sweep-v0/markdown-workbench-after-edit-state.json`
- `/tmp/aos-operator-ui-live-sweep-v0/markdown-workbench-after-edit-click.png`
- `/tmp/aos-operator-ui-live-sweep-v0/sigil-debug.json`
- `/tmp/aos-operator-ui-live-sweep-v0/sigil-show-list-after-native-click.json`
- `/tmp/aos-operator-ui-live-sweep-v0/sigil-radial-real-input.err`

If temp artifacts are gone, reproduce with the launch commands in the Operator
card.

## Rediscover State

Run:

```bash
git status --short --branch
./aos dev recommend --json
./aos ready
```

If live checks are needed and `./aos ready` reports
`diagnosis=daemon_tcc_grant_stale_or_missing` or `input_tap_not_active`, stop
and report the blocker. Do not run ad-hoc permission loops.

Operator's final `./aos status` was degraded even though final `./aos ready`
passed:

```text
Daemon ownership mismatch: serving pid=38861, lock pid=38861, service pid=61994.
```

Do not broaden into daemon ownership repair unless it blocks your focused
verification. If it recurs, capture `./aos status` and `./aos introspect review`
output and report it to Foreman.

## Operator Findings To Fix

### 1. Surface Inspector visible layout and close

Launch:

```bash
packages/toolkit/components/surface-inspector/launch.sh
```

Expected:

- launched frame is tall enough for the minimap and canvas/resource list to be
  usable;
- maximize makes the Surface Inspector body fill the native frame;
- list controls and rows are visible, not collapsed to `0x0`;
- close through the panel chrome removes `surface-inspector` from
  `./aos show list --json`;
- stage-backed minimize behavior remains intact.

Actual evidence:

- `/tmp/aos-operator-ui-live-sweep-v0/surface-inspector-before.png`
  shows the initial panel clipped to roughly `360x245`;
- `/tmp/aos-operator-ui-live-sweep-v0/surface-inspector-after-maximize.png`
  shows the native frame full-display while the body stays mostly
  minimap-only/transparent;
- `/tmp/aos-operator-ui-live-sweep-v0/surface-inspector-elements-after-maximize.json`
  shows `BODY`/`.aos-panel` at `1512x350` inside a `1512x949` canvas, with
  `.canvas-list-region` hidden and many list controls at `0x0`;
- `/tmp/aos-operator-ui-live-sweep-v0/stage-after-panel-close.json` still
  contains `surface-inspector` after a real close click.

Likely files:

- `packages/toolkit/components/surface-inspector/index.html`
- `packages/toolkit/components/surface-inspector/index.js`
- `packages/toolkit/components/surface-inspector/launch.sh`
- `packages/toolkit/panel/defaults.css`
- `packages/toolkit/panel/chrome.js`
- `tests/toolkit/surface-inspector.test.mjs`
- `tests/toolkit/panel-chrome.test.mjs`

Triage hint: this looks like the hosted document/panel root not filling the
native WebView after launch/maximize, not a blank-page module failure. Prefer a
shared panel-root/host sizing fix if other `mountPanel` surfaces can inherit it.
Do not hide the issue by only increasing launch height.

### 2. Markdown Workbench source toggle real-click routing

Launch:

```bash
packages/toolkit/components/markdown-workbench/launch.sh docs/design/work-cards/operator-recent-ui-regression-live-sweep-v0.md
```

Expected:

- clicking the Edit/source control switches `window.__markdownWorkbenchState`
  to source mode;
- the Markdown textarea becomes visible and focusable;
- focus stays in the document toolbar/editor path, not the embedded graph
  controls.

Actual evidence:

- `/tmp/aos-operator-ui-live-sweep-v0/markdown-workbench-after-edit-state.json`
  shows `mode:"preview"`, active element `Global scope`, and the source textarea
  at `0x0` after the real click;
- `/tmp/aos-operator-ui-live-sweep-v0/markdown-workbench-after-edit-click.png`
  shows the click/focus landed in the left graph/control layer instead of
  switching the document pane.

Likely files:

- `packages/toolkit/components/markdown-workbench/index.js`
- `packages/toolkit/components/markdown-workbench/styles.css`
- `packages/toolkit/panel/layouts/split-pane.js`
- `packages/toolkit/components/wiki-kb/styles.css`
- `tests/toolkit/markdown-workbench-layout.test.mjs`

Triage hint: the DOM snapshot reports the Edit button at a sane visual rect, but
real click behavior suggests a hit-test/overlay/split-pane layering issue. Add a
focused regression that exercises the document view toggle's click handler and,
if possible, an AOS-hosted live check that proves real pointer input changes
mode to source.

### 3. Sigil hit/radial real-input activation

Setup:

```bash
./aos set content.roots.sigil apps/sigil
./aos content wait --root sigil --auto-start --timeout 15s
./aos show create --id avatar-main --url aos://sigil/renderer/index.html --track union
./aos show wait --id avatar-main --timeout 8s
```

Expected:

- renderer boots and places the avatar/hit surface;
- real pointer activation at the avatar opens or moves the hit/radial surfaces;
- `AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input.sh`
  can verify radial semantic targets.

Actual evidence:

- `/tmp/aos-operator-ui-live-sweep-v0/sigil-debug.json` shows boot success,
  first frame in `116ms`, and avatar position ready at about `x=1467,y=818`;
- after native/desktop-world clicks, `/tmp/aos-operator-ui-live-sweep-v0/sigil-show-list-after-native-click.json`
  still shows `sigil-hit-avatar-main` at `[-10000,-10000,80,80]` and
  `sigil-radial-menu-avatar-main` at `[-10000,-10000,1,1]`;
- `/tmp/aos-operator-ui-live-sweep-v0/sigil-radial-real-input.err` shows the
  canonical scenario failed immediately on `./aos show list --json` with
  `IPC failure`.

Likely files:

- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/input-message.js`
- `apps/sigil/renderer/live-modules/radial-menu-target-surface.js`
- `apps/sigil/renderer/hit-area.html`
- `apps/sigil/renderer/radial-menu-surface.html`
- `packages/toolkit/runtime/input-events.js`
- `tests/renderer/input-message.test.mjs`
- `tests/renderer/hit-target.test.mjs`
- `tests/renderer/radial-menu-target-surface.test.mjs`
- `tests/renderer/sigil-input-regions.test.mjs`
- `tests/scenarios/sigil/radial-menu/real-input.sh`

Triage hint: first check the child hit-surface normalization gate described in
`docs/design/work-cards/toolkit-child-hit-surface-normalization-gate-correction-v0.md`.
Raw child `canvas_message` echoes must reach Sigil's parent-side
`handleHitCanvasEvent()` until parent DesktopWorld resolution is available.

## Hard Boundaries

- Do not rework passed Playbook, Work Record, Surface-Zoom, Wiki KB,
  Integration Hub, or Decision Gate behavior.
- Do not move toolkit panel policy into the daemon.
- Do not add Sigil-specific daemon hooks or revive daemon actions named for
  Sigil/avatar/radial.
- Do not reintroduce bare `@zag-js/...` imports in browser-consumed files.
- Do not run destructive cleanup or permission repair loops.
- Do not push `main`; report back to Foreman.

If the Sigil repair proves materially larger than the Surface Inspector and
Markdown fixes, stop after committing the smaller accepted fixes and report a
separate proposed Sigil work card boundary. Do not mix a broad Sigil remodel
into a toolkit panel repair.

## Verification

Run deterministic tests first. Use the smallest applicable subset for files you
touch, but include at minimum:

```bash
node --test tests/toolkit/surface-inspector.test.mjs tests/toolkit/panel-chrome.test.mjs
node --test tests/toolkit/markdown-workbench-layout.test.mjs
node --test tests/renderer/input-message.test.mjs tests/renderer/hit-target.test.mjs tests/renderer/radial-menu-target-surface.test.mjs tests/renderer/sigil-input-regions.test.mjs
git diff --check
```

If the Sigil normalization gate is touched, also rerun the reproduction command
from `docs/design/work-cards/toolkit-child-hit-surface-normalization-gate-correction-v0.md`
and report the corrected shape.

If `./aos ready` passes, run bounded live checks:

```bash
./aos ready
packages/toolkit/components/surface-inspector/launch.sh
./aos show wait --id surface-inspector --manifest surface-inspector --timeout 5s
packages/toolkit/components/markdown-workbench/launch.sh docs/design/work-cards/operator-recent-ui-regression-live-sweep-v0.md
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input.sh
```

For Surface Inspector, capture enough state to prove:

- the panel body fills the launch/maximized frame;
- canvas list controls have non-zero rects when open;
- close removes `surface-inspector`;
- stage-backed minimize still uses the shared stage chip path and leaves no
  stale `aos-chip-*` canvas.

For Markdown, prove a real click on Edit/source changes the mode and makes the
textarea visible.

For Sigil, prove the hit/radial surfaces leave the `-10000,-10000` parked
frames under real input, or report the exact remaining IPC/runtime blocker.

## Completion Report

Report:

- files changed;
- which root cause fixed each of the three primary defects;
- deterministic tests run and results;
- live checks run and results, including exact `./aos ready`;
- whether `./aos status` still shows daemon ownership mismatch after live
  checks;
- whether the branch is clean and pushed;
- whether Operator should rerun the full sweep or only a narrowed Surface
  Inspector/Markdown/Sigil pass.
