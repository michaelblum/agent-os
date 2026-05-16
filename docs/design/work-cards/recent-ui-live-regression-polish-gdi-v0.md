# Recent UI Live Regression Polish GDI V0

## Fresh Context Contract

Start from a fresh GDI session in `/Users/Michael/Code/agent-os`. Do not work in
`.docks/`. Rediscover repo state before editing. This is a deterministic follow-up
slice after Operator reran
`docs/design/work-cards/operator-recent-ui-regression-live-sweep-v0.md` against
local `main` at `41cab62de223138751dccfcd96204867c807d202`.

## Goal

Repair the bounded UI/readiness regressions from the second live sweep without
reopening the already-passed blank-surface, Surface Inspector, Decision Gate, or
Sigil radial paths.

Operator result was partial pass. `./aos ready` was good:

```text
ready=true mode=repo daemon=reachable tap=active
```

Evidence is under:

```text
/tmp/aos-operator-ui-live-sweep-v0/
```

Do not depend on that temp directory as the only proof. Add or update focused
tests for deterministic behavior.

## Read First

- `AGENTS.md`
- `packages/toolkit/CLAUDE.md`
- `docs/api/toolkit/components.md`
- `docs/api/toolkit/controls.md`
- `docs/api/toolkit/panel-window.md`
- `docs/design/work-cards/operator-recent-ui-regression-live-sweep-v0.md`
- `docs/design/work-cards/recent-ui-live-regression-gdi-repairs-v0.md`
- `docs/design/work-cards/recent-ui-tabs-keyboard-focus-correction-v0.md`
- `/tmp/aos-operator-ui-live-sweep-v0/markdown-workbench-focused.png`
- `/tmp/aos-operator-ui-live-sweep-v0/playbook-workbench-initial.png`
- `/tmp/aos-operator-ui-live-sweep-v0/integration-hub-initial.png`
- `/tmp/aos-operator-ui-live-sweep-v0/wiki-kb-initial.png`

If the temp evidence is gone, continue from the summaries below and reproduce
with the launch commands from the Operator sweep card.

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

## Operator Findings To Fix

### 1. Markdown Workbench toolbar label collision

Evidence:

```text
/tmp/aos-operator-ui-live-sweep-v0/markdown-workbench-focused.png
```

At default launch size, the content toolbar visually collides around the
`Index` and hidden/annotation controls. Expected behavior is that compact
toolbar controls fit without text overlap, overflow, or inaccessible labels.

Likely files:

- `packages/toolkit/components/markdown-workbench/index.js`
- `packages/toolkit/components/markdown-workbench/styles.css`
- `tests/toolkit/markdown-workbench-layout.test.mjs`

Prefer icon-sized controls with `aria-label`/`title` for compact actions rather
than widening the toolbar until it only works on large canvases. Keep the
existing macOS-style panel close control and existing semantic refs intact.

### 2. Playbook Workbench readiness contract mismatch

Evidence:

```text
/tmp/aos-operator-ui-live-sweep-v0/playbook-workbench-initial.png
```

Operator saw a populated, usable DOM, but this check timed out:

```bash
./aos show wait --id playbook-workbench-v0 --manifest playbook-workbench --timeout 5s
```

The launch script currently waits for `--manifest playbook-workbench-v0`, while
the human-facing surface is commonly referenced as Playbook Workbench. Fix the
contract so the live readiness command a tester reasonably uses is stable.

Acceptable outcomes:

- normalize the manifest name/constant/docs to one canonical value and update
  tests plus launch commands accordingly; or
- support the non-versioned readiness alias in the component/runtime if that is
  the established toolkit pattern.

Do not paper over the mismatch by only changing the Operator work card unless
you can show the component contract is already correct and the card was the only
bug. In that case, update the card and add a focused test/doc assertion that
prevents the mismatch from returning.

Likely files:

- `packages/toolkit/components/playbook-workbench/semantics.js`
- `packages/toolkit/components/playbook-workbench/index.js`
- `packages/toolkit/components/playbook-workbench/launch.sh`
- `tests/toolkit/playbook-workbench-v0.test.mjs`

### 3. Integration Hub naming and opaque panel layout

Evidence:

```text
/tmp/aos-operator-ui-live-sweep-v0/integration-hub-initial.png
```

Expected from the sweep card: Providers, Workflows, and Jobs tabs with a fully
opaque usable panel. Actual: tabs are Jobs, Workflows, Integrations, Activity;
the hero stat says Integrations; and lower panel space shows underlying Wiki KB
through the WebView.

Fix the user-facing naming so provider surfaces say `Providers`, not
`Integrations`, unless live broker data explicitly supplies a different label
with a documented reason. Also make the hosted panel fill its canvas with an
opaque background so other canvases do not show through empty lower space.

Likely files:

- `packages/toolkit/components/integration-hub/index.js`
- `packages/toolkit/components/integration-hub/index.html`
- `packages/toolkit/components/integration-hub/styles.css`
- `tests/toolkit/integration-hub-semantics.test.mjs`

### 4. Wiki KB Detail-tab expectation

Evidence:

```text
/tmp/aos-operator-ui-live-sweep-v0/wiki-kb-initial.png
```

The active Operator card asks for Wiki KB `graph/detail/mind-map` tabs. The
current component exposes `Graph` and `Mind Map`, with selected-node details in
the sidebar instead of a `Detail` tab.

Classify and resolve this mismatch narrowly:

- if a first-class `Detail` tab is intended, add it with focused tests and make
  sure it remains synchronized with graph selection; or
- if details belong only in the sidebar, update the Operator card and relevant
  docs/tests to stop expecting a Detail tab.

Do not build a duplicate detail UI just to satisfy the sweep wording if the
existing sidebar is the deliberate product contract.

Likely files:

- `packages/toolkit/components/wiki-kb/index.js`
- `packages/toolkit/components/wiki-kb/styles.css`
- `tests/toolkit/wiki-kb-tabs.test.mjs`
- `docs/design/work-cards/operator-recent-ui-regression-live-sweep-v0.md`

## Hard Boundaries

- Do not touch Surface Inspector stage/minimize behavior unless a focused test
  proves these changes regressed it.
- Do not touch Sigil radial/context/status behavior for this slice.
- Do not reintroduce bare `@zag-js/...` imports in browser-consumed files.
- Do not move toolkit windowing policy into the daemon.
- Do not run destructive cleanup or permission repair loops.
- Do not push `main`; report back to Foreman.

## Verification

Run focused deterministic tests first:

```bash
node --test tests/toolkit/markdown-workbench-layout.test.mjs
node --test tests/toolkit/playbook-workbench-v0.test.mjs
node --test tests/toolkit/integration-hub-semantics.test.mjs tests/toolkit/wiki-kb-tabs.test.mjs
git diff --check
```

If live AOS is ready, run the smallest live checks for changed surfaces:

```bash
./aos ready
packages/toolkit/components/markdown-workbench/launch.sh docs/design/work-cards/operator-recent-ui-regression-live-sweep-v0.md
packages/toolkit/components/playbook-workbench/launch.sh
./aos show wait --id playbook-workbench-v0 --manifest playbook-workbench --timeout 5s
packages/toolkit/components/wiki-kb/launch.sh
./aos show create --id integration-hub-live-sweep --at 120,100,980,680 --interactive --focus --url aos://toolkit/components/integration-hub/index.html
./aos show wait --id integration-hub-live-sweep --manifest integration-hub --timeout 5s
```

For Integration Hub, also capture or inspect a screenshot that proves the panel
is opaque over other canvases when broker load fails.

## Completion Report

Report:

- files changed;
- which of the four findings were code defects vs expectation/doc mismatches;
- tests run and results;
- live checks run and results, or the exact blocker if live AOS was not ready;
- whether the branch is clean and pushed;
- any follow-up that still needs Operator verification.
