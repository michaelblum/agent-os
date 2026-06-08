# Operator Recent UI Regression Live Sweep V0

## Fresh Context Contract

Operator starts from a fresh context window. Work in
`/Users/Michael/Code/agent-os`, not in `.docks/`. Do not assume daemon, canvas,
permission, display, or prior verification state. Rediscover before testing.

This is supervised live/HITL verification only. Do not implement fixes, commit,
push, mutate GitHub state, or broaden into Implementer work.

## Goal

Live-test the major UI-facing changes that landed from May 14 through May 15,
2026. The sweep should answer whether the recent toolkit controls, shared
tokens, panel/workbench layouts, Zag-backed controls, Surface Inspector rename,
stage-chip behavior, and Sigil interaction updates hold up under real AOS-hosted
use.

Foreman preflight for this routing initially found an inactive input tap, then
`./aos ready --repair` recovered to:

```text
ready=true mode=repo daemon=reachable tap=active
```

Operator must still run its own readiness check. If readiness fails, stop and
report the concrete blocker.

## Recent Change Areas To Cover

- Shared toolkit controls and HTML render helpers:
  `packages/toolkit/controls/`, `packages/toolkit/panel/form.js`, and
  `docs/api/toolkit/controls.md`.
- Shared design tokens and panel chrome defaults:
  `packages/design-tokens/tokens.css`,
  `packages/toolkit/components/_base/theme.css`, and
  `packages/toolkit/panel/defaults.css`.
- Workbench shell and split-pane layout adoption:
  Markdown Workbench, Playbook Workbench, Work Record Workbench, and
  Surface-Zoom Inspector.
- Zag-backed UI adapters and live adopters:
  tabs in Integration Hub and Wiki KB, plus the Sigil context-menu/menu path.
- Surface Inspector hard rename and live resource visibility:
  `surface-inspector` should be the live name; `canvas-inspector` should not
  appear in user-facing runtime labels.
- Stage-backed panel chips and panel controls:
  minimize, restore, close, duplicate minimize, maximize/restore, and cleanup.
- Sigil renderer/UI changes:
  radial reticle drift repair, idle render-loop repair, context-menu theme
  tokens, and status-item state/lifecycle behavior.
- Decision Gate and user signal surface:
  visible gate form behavior and no stale schema/receptor mismatch in the
  hosted panel.

## Read First

- `AGENTS.md`
- `the operator native subagent contract`
- `packages/toolkit/CLAUDE.md`
- `docs/api/toolkit/components.md`
- `docs/api/toolkit/controls.md`
- `docs/api/toolkit/panel-window.md`
- `docs/design/work-cards/operator-stage-chip-latency-live-smoke-v0.md`
- `docs/dev/reports/toolkit-surface-audit.md`
- `docs/dev/reports/canvas-inspector-naming.md`

## Rediscover State

Run:

```bash
git status --short --branch
./aos ready
./aos status
./aos show list --json
```

If `./aos ready` reports `diagnosis=daemon_tcc_grant_stale_or_missing` or
`input_tap_not_active`, stop and report the blocker. Do not improvise a
permission repair loop. If it prints the repo-standard repair path, include that
path in the report for Foreman.

## Setup

Start from a clean display state unless existing canvases are evidence for the
report.

```bash
mkdir -p /tmp/aos-operator-ui-live-sweep-v0
./aos show remove-all || true
./aos set content.roots.toolkit packages/toolkit
./aos content wait --root toolkit --auto-start --timeout 15s
./aos show list --json > /tmp/aos-operator-ui-live-sweep-v0/initial-show-list.json
```

For each launched surface, use real pointer and keyboard input for the primary
interaction check. Synthetic `show eval` checks are acceptable as supplemental
state capture, but they do not replace the live interaction pass.

Capture useful evidence as you go: `./aos see`, `./aos show list --json`, small
state snapshots, screenshots if available, and concise timing notes. Keep
artifacts under `/tmp/aos-operator-ui-live-sweep-v0/`.

## Test Matrix

### Surface Inspector And Panel Chrome

Launch:

```bash
packages/toolkit/components/surface-inspector/launch.sh
./aos show wait --id surface-inspector --manifest surface-inspector --timeout 5s
```

Verify:

- Title, canvas id, manifest, and visible labels say Surface Inspector /
  `surface-inspector`, not Surface Inspector / `canvas-inspector`.
- Canvas list, display placement, cursor toggle, annotation controls, minimap,
  and tree rows are legible and not visually overlapped.
- Shared controls look consistent: focus ring, hover, pressed, disabled/loading
  if visible, compact icon buttons, and text labels all fit.
- Panel chrome drag, resize, maximize/restore, minimize/restore, and close work
  with real pointer input.
- Minimize uses the stage-backed chip path: no default-path `aos-chip-*`
  WebView remains, duplicate minimize does not create duplicate chips, and
  restore/close clean up stage layer and input regions.
- Surface resource rows for stage layers, input regions, and affordances appear
  when relevant and do not show stale cleanup-suspect rows after restore/close.

Useful supplemental capture:

```bash
./aos show list --json > /tmp/aos-operator-ui-live-sweep-v0/surface-inspector-show-list.json
./aos show eval --id surface-inspector --js 'JSON.stringify(window.__canvasInspectorState?.surfaceResources ?? null)' > /tmp/aos-operator-ui-live-sweep-v0/surface-inspector-resources.json
./aos show eval --id surface-inspector --js 'JSON.stringify(window.__aosPanelWindowController?.getState?.() ?? null)' > /tmp/aos-operator-ui-live-sweep-v0/surface-inspector-panel-state.json
```

### Workbench Split-Pane Surfaces

Launch:

```bash
packages/toolkit/components/markdown-workbench/launch.sh docs/design/work-cards/operator-recent-ui-regression-live-sweep-v0.md
packages/toolkit/components/playbook-workbench/launch.sh
packages/toolkit/components/work-record-workbench/launch.sh
packages/toolkit/components/surface-zoom-inspector/launch.sh
```

Verify on each surface:

- Split panes render at usable initial sizes and stay stable while resizing the
  window or pane splitter.
- Keyboard focus moves through toolbar controls, split-pane controls, source
  editors/textareas, selects, and buttons in a coherent order.
- Buttons, segmented controls, toggles, text fields, selects, and textareas use
  the same visual language and do not lose labels or overflow.
- Markdown Workbench preview/source switching, outline toggle, edit textarea,
  Save/Revert controls, and close-content control still work.
- Playbook Workbench gate inputs, Apply Gate, Simulate, and Open Work Record
  controls are usable; opening the Work Record surface does not visually stack
  on top of the source panel in an unusable way.
- Work Record Workbench JSON textarea, intent textarea, Apply JSON, Revert, and
  Save controls remain usable and readable.
- Surface-Zoom Inspector selection, mini-map hit testing, annotation draft
  details, zoom controls, and label-density/display controls remain coherent.

### Wiki KB And Integration Hub Zag Tabs

Launch Wiki KB:

```bash
packages/toolkit/components/wiki-kb/launch.sh
```

Launch Integration Hub:

```bash
./aos show create --id integration-hub-live-sweep --at 120,100,980,680 --interactive --focus --url aos://toolkit/components/integration-hub/index.html
./aos show wait --id integration-hub-live-sweep --manifest integration-hub --timeout 5s
```

Verify:

- Wiki KB Graph and Radial Graph layout modes switch with real pointer and
  keyboard through the segmented layout control.
- Wiki KB selected-node details remain in the synchronized sidebar, not a
  separate Detail tab. Graph controls, sidebar/details toggles, refresh,
  markdown/raw toggles, and breadcrumbs remain visible and usable after layout
  switches.
- Integration Hub tabs switch between Providers, Workflows, and Jobs with
  correct active/selected state, visible content, and no stale selected panel.
- Integration Hub Refresh and Send controls behave sensibly. If the local
  broker is unavailable, the empty/error state should be legible and should not
  break tabs or layout.
- Tab focus, arrow-key behavior, ARIA state, and visual selected state stay in
  sync enough for a human user to understand where they are.

### Decision Gate

Launch a bounded local gate prompt with the toolkit helper. It creates a
local-only request payload and does not submit an external decision:

```bash
packages/toolkit/components/decision-gate/launch.sh
./aos show wait --id decision-gate-live-sweep --manifest decision-gate --timeout 5s
```

Verify:

- Prompt content, option controls, confirm/cancel/block style actions, timer bar
  if present, keyboard focus, and visible error/empty states are coherent.
- No user-signal schema or receptor mismatch is visible in the panel.
- Do not submit any external side-effecting decision. Keep the test local.

### Sigil Renderer, Context Menu, Radial UI, And Status Item

Read `apps/sigil/AGENTS.md` before launching. Use the repo-mode AOS host. A
minimal renderer launch is:

```bash
./aos set content.roots.sigil apps/sigil
./aos content wait --root sigil --auto-start --timeout 15s
./aos show create --id avatar-main --url aos://sigil/renderer/index.html --track union
./aos show wait --id avatar-main --timeout 8s
```

If the renderer reports a missing default Sigil agent document, run the
idempotent seed command from `apps/sigil/AGENTS.md` and relaunch:

```bash
apps/sigil/sigilctl-seed.sh --mode repo
```

Verify:

- Renderer boots without a blank panel or content-server fallback page.
- Radial reticle tracks the interaction target without visible drift.
- Radial menu activation, hover/selection, and dismissal feel stable and do not
  leave stale overlay state.
- Context menu styling uses the current Sigil/theme tokens and remains readable
  in hover/active/focus states.
- Idle render behavior does not visibly spin, flicker, or continue animating
  when no interaction is active.
- Status-item toggle state is consistent with canvas lifecycle if you can safely
  exercise it. Do not perform destructive macOS or privacy-setting actions.

Optional supplemental capture:

```bash
apps/sigil/diagnostics/interaction-trace/launch.sh || true
apps/sigil/diagnostics/interaction-trace/dump.sh > /tmp/aos-operator-ui-live-sweep-v0/sigil-interaction-trace.json 2>/tmp/aos-operator-ui-live-sweep-v0/sigil-interaction-trace.err || true
```

## Pass / Fail Framing

Pass means the sweep finds no blocking live regressions across the listed
surfaces, and any minor issues are cosmetic, bounded, and have clear repro
steps.

Partial pass means most surfaces are usable but one area has a non-blocking
regression, ambiguity, missing launch path, or broker/runtime dependency that
Foreman should route separately.

Fail means any primary surface cannot launch, real pointer/keyboard interaction
is broken, panel chrome cannot recover from minimize/restore/close, Sigil's
radial/context interaction is materially broken, or the UI becomes visually
unusable.

## Hard Boundaries

- Do not implement fixes.
- Do not create commits, branches, PRs, or GitHub issues.
- Do not mutate external accounts, accept legal terms, purchase, subscribe, or
  submit side-effecting decisions.
- Do not run repeated ad-hoc permission repair loops. Stop on readiness or TCC
  blockers and report the repo-standard recovery path.
- Do not broaden into exhaustive adapter unit testing; this is live user-facing
  regression coverage.

## Completion Report

Report back to Foreman with:

- exact `git status --short --branch`;
- exact `./aos ready` result;
- surfaces launched and launch commands used;
- pass/partial/fail result per matrix section;
- defects with concise repro steps, expected behavior, actual behavior, and
  artifact paths under `/tmp/aos-operator-ui-live-sweep-v0/`;
- any readiness, content-root, broker, display, status-item, or permission
  blocker;
- whether stage-backed minimize cleanup left stale `aos-chip-*` canvases, stage
  layers, input regions, or affordances;
- whether Sigil radial/context/status-item behavior needs a Implementer repair slice;
- next recommended dock: Foreman for routing, Implementer for deterministic fix, or
  Operator rerun only if the result was blocked by live environment state.
