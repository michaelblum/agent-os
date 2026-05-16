# Recent UI Live Regression GDI Repairs V0

## Fresh Context Contract

Start from a fresh GDI session in `/Users/Michael/Code/agent-os`. Do not work in
`.docks/`. Rediscover repo state before editing. This is a deterministic repair
slice for the Operator live sweep failure reported on May 15, 2026.

## Goal

Repair the toolkit/browser regressions exposed by
`docs/design/work-cards/operator-recent-ui-regression-live-sweep-v0.md` so a
subsequent Operator rerun can launch and inspect the recent UI surfaces instead
of failing on blank pages or readiness handshakes.

Primary Operator evidence is under:

```text
/tmp/aos-operator-ui-live-sweep-v0/
```

Do not depend on that temp directory as the only proof; add durable tests or
scripts where the failure mode is deterministic.

## Foreman Triage Summary

Operator result was fail, with `./aos ready` good during the sweep:

```text
ready=true mode=repo daemon=reachable tap=active
```

Foreman checked the report and found these likely root causes:

- Integration Hub and Markdown Workbench blanking are consistent with browser
  module-load failure from live Zag tab adoption. `packages/toolkit/adapters/zag/tabs.js`
  imports bare `@zag-js/tabs`, which Node tests resolve but AOS-hosted browser
  modules cannot resolve from `aos://toolkit/...`. Wiki KB also consumes this
  path.
- Work Record Workbench gets panel chrome only because content render throws
  before publishing `window.__workRecordWorkbenchState`. The visible code path
  appends buttons with `createButton({ dataset: { action: ... } })`, then
  queries `[data-action="..."]`; `createButton` currently ignores `dataset` and
  `attributes`, so `dom.applyJson`, `dom.revert`, and `dom.save` can be `null`.
- Surface-Zoom Inspector renders usable content, but its standalone `index.html`
  does not go through `mountPanel`, `declareManifest`, or `emitReady`; therefore
  `./aos show wait --manifest surface-zoom-inspector` can time out even when the
  UI is visible.
- Surface Inspector launches at a clipped native frame. Operator observed a
  `320x245` canvas while the panel DOM needs roughly `320x350+`; screenshot:
  `/tmp/aos-operator-ui-live-sweep-v0/surface-inspector-launched.png`.
- Decision Gate direct-open with no request is not a product regression by
  itself; its current `index.html` intentionally renders no form without a
  `request` or `requestB64` query parameter. The live sweep needs a safe launch
  helper or documented local request payload before Operator can test it.
- Wiki KB `NO_DAEMON` and Sigil radial `IPC failure` look like runtime/daemon
  instability. Do not swallow those, but keep this slice focused on deterministic
  browser/toolkit repair unless the same IPC failure blocks your verification.

Focused tests Foreman ran before routing:

```bash
node --test tests/toolkit/markdown-workbench-layout.test.mjs \
  tests/toolkit/work-record-workbench.test.mjs \
  tests/toolkit/integration-hub-semantics.test.mjs \
  tests/toolkit/decision-gate.test.mjs \
  tests/toolkit/surface-zoom-inspector.test.mjs
```

Those passed, which is the coverage gap: current tests do not catch AOS-hosted
browser import safety or full Work Record component render.

## Read First

- `AGENTS.md`
- `packages/toolkit/CLAUDE.md`
- `docs/api/toolkit/components.md`
- `docs/api/toolkit/controls.md`
- `docs/api/toolkit/panel-window.md`
- `docs/design/work-cards/operator-recent-ui-regression-live-sweep-v0.md`
- `/tmp/aos-operator-ui-live-sweep-v0/markdown-workbench-state.json`
- `/tmp/aos-operator-ui-live-sweep-v0/work-record-workbench-state.json`
- `/tmp/aos-operator-ui-live-sweep-v0/integration-hub-live-sweep-state.json`
- `/tmp/aos-operator-ui-live-sweep-v0/surface-zoom-inspector-state.json`
- `/tmp/aos-operator-ui-live-sweep-v0/surface-inspector-show-list-launched.json`

If the temp evidence is gone, continue from the summary above and reproduce
with the launch commands below.

## Rediscover State

Run:

```bash
git status --short --branch
./aos dev recommend --json
```

If you need live AOS verification, run:

```bash
./aos ready
```

If `./aos ready` reports `diagnosis=daemon_tcc_grant_stale_or_missing` or
`input_tap_not_active`, stop and report the blocker. Do not run ad-hoc
permission loops.

## Implementation Tasks

### 1. Make live Zag tabs browser-safe

Fix the live `createAosZagTabs` import path so AOS-hosted pages do not import a
bare `@zag-js/tabs` specifier.

Acceptable approaches:

- vendor the tabs runtime in `packages/toolkit/adapters/zag/vendor/` the same
  way menu runtime is vendored, then import tabs `connect`/`machine` from that
  local module; or
- provide a repo-supported browser import map/bundling path and tests that prove
  `aos://toolkit/components/integration-hub/index.html` and
  `aos://toolkit/components/wiki-kb/index.html` no longer depend on unresolved
  bare specifiers.

Do not add dynamic npm installs. Use existing `packages/toolkit` dependencies
and checked-in vendor artifacts if vendoring is needed.

Add a guard test that fails when a browser-consumed toolkit component imports a
bare `@zag-js/...` module without a local browser-safe path. At minimum, cover
the live adopters: Integration Hub, Wiki KB, and Markdown Workbench's embedded
Wiki KB path.

### 2. Fix Work Record component render

Repair `createButton` and/or Work Record button construction so DOM-created
buttons preserve the attributes Work Record depends on.

Expected behavior:

- `createButton({ dataset: { action: 'save' } })` stamps
  `data-action="save"` on the returned button.
- `createButton` supports the same basic DOM metadata callers naturally expect
  from `renderButtonHtml`: `id`, `title`, `ariaLabel`, `className`, `dataset`,
  `attributes`, and disabled state.
- `packages/toolkit/components/work-record-workbench/launch.sh` reaches
  `window.__workRecordWorkbenchState === "object"` and renders the Apply JSON,
  Revert, and Save controls.

Add or update focused tests in `tests/toolkit/controls-button.test.mjs` and add
coverage that would have caught the Work Record render crash. A full fake-DOM
component render test is preferred if it stays small; otherwise add a targeted
test for the data-action dependency and explain the remaining coverage gap in
the completion report.

### 3. Add Surface-Zoom manifest readiness

Make Surface-Zoom Inspector participate in the same readiness contract used by
other toolkit surfaces.

Expected behavior:

```bash
packages/toolkit/components/surface-zoom-inspector/launch.sh
./aos show wait --id surface-zoom-inspector --manifest surface-zoom-inspector --timeout 5s
```

passes after the UI initializes.

Use the lightest change that fits the component. It does not have to become a
full `mountPanel` surface if that would be a larger refactor; declaring a
manifest and emitting ready after the fixture mini-map initializes is acceptable
if it matches the runtime contract.

### 4. Repair Surface Inspector launch geometry

Fix the Surface Inspector launch path so the initial native canvas frame is not
shorter than the panel content.

Operator observed:

```text
surface-inspector show list: at [1192,502,320,245]
controller frame: intended [0,982,320,480]
```

Expected behavior:

- launch produces a usable frame at least tall enough for the minimap and first
  controls, not a clipped `320x245` panel;
- the launched canvas frame and panel controller state agree closely enough for
  minimize restore to return to the visible full-height panel;
- existing stage-backed minimize behavior remains intact.

Be careful with multi-display `visible_bounds` and DesktopWorld coordinates.
Do not solve this by moving window policy into the daemon.

### 5. Make Decision Gate live-smokeable

Do not treat the blank no-request direct open as the core bug. Instead, make
future live smoke testing safe and explicit.

Preferred fix:

- add a tiny `packages/toolkit/components/decision-gate/launch.sh` that creates
  a local-only request payload with no external side effects, launches the
  component with `requestB64` or `request`, and waits for visible controls; or
- update the existing hosted component to render an obvious local demo only when
  a `demo=1` query parameter is present.

Then update the Operator card or component docs with the safe command.

## Verification

Run deterministic tests first:

```bash
node --test tests/toolkit/controls-button.test.mjs
node --test tests/toolkit/zag-adapter-tabs.test.mjs tests/toolkit/integration-hub-semantics.test.mjs tests/toolkit/wiki-kb-tabs.test.mjs
node --test tests/toolkit/markdown-workbench-layout.test.mjs tests/toolkit/surface-zoom-inspector.test.mjs
node --test tests/toolkit/decision-gate.test.mjs
```

Run any new tests you add.

For live checks, first run:

```bash
./aos ready
```

If ready passes, run the smallest live launch checks that prove this slice:

```bash
./aos show remove-all || true
packages/toolkit/components/surface-inspector/launch.sh
packages/toolkit/components/markdown-workbench/launch.sh docs/design/work-cards/operator-recent-ui-regression-live-sweep-v0.md
packages/toolkit/components/work-record-workbench/launch.sh
packages/toolkit/components/surface-zoom-inspector/launch.sh
packages/toolkit/components/wiki-kb/launch.sh
./aos show create --id integration-hub-gdi-smoke --at 120,100,980,680 --interactive --focus --url aos://toolkit/components/integration-hub/index.html
./aos show wait --id integration-hub-gdi-smoke --manifest integration-hub --timeout 5s
```

Also run the new Decision Gate safe launch path.

Capture any live evidence under `/tmp/aos-recent-ui-gdi-repairs-v0/`.

## Hard Boundaries

- Do not implement broad daemon IPC fixes in this card. If `NO_DAEMON` or
  `IPC failure` blocks verification, capture the exact command, stderr, daemon
  status, and relevant log tail, then stop and report it for Foreman routing.
- Do not route or perform another Operator pass yourself.
- Do not commit unrelated refactors, demos, or worktree cleanup.
- Do not move toolkit panel/window policy into the daemon.

## Completion Report

Report:

- files changed;
- root causes confirmed or corrected;
- tests run and results;
- live launch checks run and results;
- whether any unresolved `NO_DAEMON`, `IPC failure`, or input-tap blocker
  remains;
- whether the next step is Operator rerun, a daemon IPC GDI slice, or another
  toolkit fix slice.
