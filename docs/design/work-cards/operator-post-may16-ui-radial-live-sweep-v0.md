# Operator Post-May-16 UI/Radial Live Sweep V0

## Tracker

- Current target: `main` at or after
  `4efa800ffdf1a0734ca143206a77f8c4b48eade5`
  (`merge: integrate sigil radial menu branch`).
- Prior broad live sweep:
  `docs/design/work-cards/operator-recent-ui-regression-live-sweep-v0.md`.
- Deterministic repair card for the prior blockers:
  `docs/design/work-cards/recent-ui-live-regression-closure-implementer-v0.md`.
- Recent repair commits to validate live:
  - `d5eeae17e29f98e0bea257f77b343f5a925103a8`
    (`fix(toolkit): polish recent ui live regressions`);
  - `ae66ccffd96c1c853454471f3a79f18b50abac9f`
    (`fix(ui): close live regression gaps`);
  - `4efa800ffdf1a0734ca143206a77f8c4b48eade5`
    (`merge: integrate sigil radial menu branch`).

## Fresh Context Contract

Operator starts from a fresh context window. Work in
`/Users/Michael/Code/agent-os`, not in `.docks/`. Do not assume daemon, canvas,
permission, display, Git, or prior verification state. Rediscover before
testing.

This is supervised live/HITL verification only. Do not implement fixes, commit,
push, mutate GitHub state, or broaden into Implementer work.

## Goal

Run a narrowed live sweep that answers whether the May 16 UI blocker repairs and
the integrated Sigil data-driven radial/3D object graph stack are actually
usable through AOS-hosted real pointer/keyboard interaction.

This is not a repeat of the full May 14-15 matrix. Treat previously passing
surfaces as out of scope unless they are needed to prove a repaired path.

## Read First

- `AGENTS.md`
- `the operator native subagent contract`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/CLAUDE.md`
- `docs/api/toolkit/components.md`
- `docs/api/toolkit/panel-window.md`
- `docs/api/toolkit/runtime.md`
- `docs/design/work-cards/operator-recent-ui-regression-live-sweep-v0.md`
- `docs/design/work-cards/recent-ui-live-regression-closure-implementer-v0.md`
- `docs/design/aos-3d-object-graph-platform-contract.md`
- `docs/design/work-cards/sigil-radial-menu-data-driven-3d-config-v0.md`
- `docs/design/work-cards/sigil-radial-menu-data-driven-3d-config-review-corrections-v0.md`

## Rediscover State

Run:

```bash
git status --short --branch
git log --oneline -8 --decorate
./aos ready
./aos status
./aos show list --json
```

If `./aos ready` reports `diagnosis=daemon_tcc_grant_stale_or_missing` or
`input_tap_not_active`, stop and report the concrete blocker. Do not improvise a
permission repair loop. If it prints the repo-standard repair path, include that
path in the report for Foreman.

## Setup

Start from a clean display state unless existing canvases are evidence for the
report.

```bash
mkdir -p /tmp/aos-operator-post-may16-ui-radial-live-sweep-v0
./aos show remove-all || true
./aos set content.roots.toolkit packages/toolkit
./aos set content.roots.sigil apps/sigil
./aos content wait --root toolkit --auto-start --timeout 15s
./aos content wait --root sigil --auto-start --timeout 15s
./aos show list --json > /tmp/aos-operator-post-may16-ui-radial-live-sweep-v0/initial-show-list.json
```

Use real pointer and keyboard input for primary pass/fail calls. Synthetic
`show eval` and JSON captures are supplemental evidence, not replacements for
real interaction.

Capture useful evidence under:

```text
/tmp/aos-operator-post-may16-ui-radial-live-sweep-v0/
```

## Test Matrix

### 1. Surface Inspector Layout, Chrome, And Close

Launch:

```bash
packages/toolkit/components/surface-inspector/launch.sh
./aos show wait --id surface-inspector --manifest surface-inspector --timeout 5s
```

Verify with real pointer input:

- initial frame is tall enough for minimap plus canvas/resource list use;
- maximize makes the Surface Inspector body fill the native frame;
- canvas list controls and rows have visible non-zero layout when open;
- close through panel chrome removes `surface-inspector` from
  `./aos show list --json`;
- stage-backed minimize/restore still uses the shared chip path and leaves no
  stale `aos-chip-*` canvas, stage layer, input region, or affordance after
  restore/close.

Supplemental captures:

```bash
./aos show eval --id surface-inspector --js 'JSON.stringify({state: window.__canvasInspectorState ?? null, panel: window.__aosPanelWindowController?.getState?.() ?? null})' \
  > /tmp/aos-operator-post-may16-ui-radial-live-sweep-v0/surface-inspector-state.json
./aos show list --json \
  > /tmp/aos-operator-post-may16-ui-radial-live-sweep-v0/surface-inspector-after-close-check.json
```

### 2. Markdown Workbench Real-Click Source Toggle

Launch:

```bash
packages/toolkit/components/markdown-workbench/launch.sh docs/design/work-cards/operator-recent-ui-regression-live-sweep-v0.md
./aos show wait --id markdown-workbench --manifest markdown-workbench --timeout 5s
```

Verify with real pointer and keyboard input:

- clicking the Edit/source control switches `window.__markdownWorkbenchState`
  from preview to source mode;
- the Markdown textarea becomes visible, non-zero sized, and focusable;
- focus stays in the document toolbar/editor path, not the embedded graph or
  global-scope layer;
- Save/Revert controls are visible enough to use, but do not save a source edit
  unless you intentionally made a harmless local-only test edit.

Supplemental capture:

```bash
./aos show eval --id markdown-workbench --js 'JSON.stringify({state: window.__markdownWorkbenchState ?? null, active: document.activeElement?.outerHTML?.slice(0, 500), sourceRect: document.querySelector("textarea, .markdown-source, [data-testid=source-editor]")?.getBoundingClientRect?.() ?? null})' \
  > /tmp/aos-operator-post-may16-ui-radial-live-sweep-v0/markdown-workbench-source-toggle-state.json
```

If the actual canvas id differs, use `./aos show list --json` to discover it and
report the id used.

### 3. Sigil Renderer, Hit Surface, And Radial Real Input

Launch:

```bash
./aos show create --id avatar-main --url aos://sigil/renderer/index.html --track union
./aos show wait --id avatar-main --timeout 8s
```

If the renderer reports a missing default Sigil agent document, run the
idempotent seed command from `apps/sigil/AGENTS.md` and relaunch:

```bash
apps/sigil/sigilctl-seed.sh --mode repo
```

Verify:

- renderer boots without a blank panel or content-server fallback page;
- avatar/hit surface leaves the `-10000,-10000` parked frame after real
  pointer activation;
- `AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input.sh`
  passes or fails with a concrete non-IPC repro;
- radial menu activation, hover/selection, and dismissal work without stale
  overlay state;
- the data-driven radial menu config is visible in behavior: special item
  glyph/effect modules still render, and the generic visual orchestrator does
  not appear to have regressed into a blank/default-only menu.

Supplemental captures:

```bash
./aos show list --json \
  > /tmp/aos-operator-post-may16-ui-radial-live-sweep-v0/sigil-show-list-after-launch.json
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input.sh \
  > /tmp/aos-operator-post-may16-ui-radial-live-sweep-v0/sigil-radial-real-input.out \
  2> /tmp/aos-operator-post-may16-ui-radial-live-sweep-v0/sigil-radial-real-input.err
./aos show list --json \
  > /tmp/aos-operator-post-may16-ui-radial-live-sweep-v0/sigil-show-list-after-real-input.json
```

### 4. Sigil Context Menu And 3D Object Graph Smoke

Use the live Sigil renderer from the previous section.

Verify:

- context menu opens through the current live interaction path;
- shape, tesseron, effect, world/window, and utility controls remain readable
  and responsive after descriptor routing;
- a safe visual control change updates the live renderer and can be reverted or
  left as local runtime state only;
- app-owned actions such as Surface Inspector, Interaction Trace, Render
  Performance, Console Log, Copy, Save, and Import are still visibly Sigil
  actions, not toolkit/daemon-owned behavior;
- if there is an exposed 3D thing/radial item editor launch path in the current
  UI, open it and verify the editor loads a radial item subject and an avatar
  subject without a blank page.

Do not import files, save durable appearance changes, or run destructive
product actions during this smoke. If a control cannot be safely exercised,
record it as not exercised with the reason.

## Pass / Fail Framing

Pass means all four sections are usable with real input, no primary canvas is
left in a parked/offscreen state after activation, close/minimize cleanup is
clean, and any remaining issues are minor, bounded, and have clear artifact
paths.

Partial pass means one section has a non-blocking regression, missing launch
path, or environment dependency, but the primary repaired paths are usable.

Fail means Surface Inspector still cannot close/resize/fill correctly, Markdown
Workbench real-click edit mode still fails, Sigil radial real input fails with
IPC/runtime breakage or parked hit surfaces, or the integrated radial/3D stack
is visually unusable.

## Hard Boundaries

- Do not implement fixes.
- Do not create commits, branches, PRs, or GitHub issues.
- Do not mutate external accounts, accept legal terms, purchase, subscribe, or
  submit side-effecting decisions.
- Do not run repeated ad-hoc permission repair loops.
- Do not broaden back into the full May 14-15 UI matrix unless a checked
  surface directly depends on it.
- Do not save/import durable Sigil appearance changes unless Foreman explicitly
  routes that as a separate task.

## Completion Report

Report back to Foreman with:

- exact `git status --short --branch`;
- exact `./aos ready` and `./aos status` results;
- surfaces launched and exact commands used;
- pass/partial/fail result for each of the four sections;
- defects with concise repro steps, expected behavior, actual behavior, and
  artifact paths under
  `/tmp/aos-operator-post-may16-ui-radial-live-sweep-v0/`;
- whether Surface Inspector cleanup left stale `aos-chip-*` canvases, stage
  layers, input regions, or affordances;
- whether Markdown Workbench real-click source mode was fixed in live use;
- whether Sigil hit/radial surfaces left parked frames under real input;
- whether the Sigil radial/3D object graph stack needs a Implementer repair slice, and
  the smallest proposed boundary if it does;
- any local-only state, runtime blocker, content-root issue, display caveat, or
  generated artifact path Foreman needs before acceptance.
