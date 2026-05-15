# Work Card: zag-tabs-wiki-kb-adoption

## Goal

Adopt `createAosZagTabs` for the default Wiki KB view tabs.

This is the second tabs consumer after Integration Hub. It should prove the
adapter against a real tablist with real tab panels while keeping the slice
inside `packages/toolkit/components/wiki-kb/`.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Tracker

- Prior merged adapter horizon PR: #356
- Prior merged consumer PR: #357, `feat(toolkit): adopt Zag tabs in Integration Hub`
- New implementation branch: `gdi/zag-tabs-wiki-kb-adoption`
- Work card: `docs/dev/work-cards/zag-tabs-wiki-kb-adoption.md`

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/components/wiki-kb/index.js`
- `packages/toolkit/components/wiki-kb/semantics.js`
- `tests/toolkit/wiki-kb-semantics.test.mjs`
- `tests/toolkit/wiki-kb.test.mjs`
- `packages/toolkit/adapters/zag/tabs.js`
- `packages/toolkit/components/integration-hub/index.js` as the first consumer
  reference, not as a file to edit

## Rediscover State

```bash
git status --short --branch
git fetch origin
git switch -c gdi/zag-tabs-wiki-kb-adoption origin/main
./aos dev recommend --json
```

This slice is pure toolkit JavaScript and deterministic Node tests. Do not run
live AOS canvas verification unless the implementation unexpectedly crosses
into runtime/display behavior.

## Existing Code To Inspect

- `packages/toolkit/components/wiki-kb/index.js`
  - `buildDOM()` renders `.wiki-kb-tab-strip` for default chrome and an
    embedded select path for embedded chrome.
  - The default chrome path creates view tab buttons with `createButtonGroup()`
    and then manually stamps `role="tab"`, `aria-selected`, and
    `aria-controls`.
  - `ensureView()` creates actual view panels with ids like
    `wiki-kb-panel-graph`, `role="tabpanel"`, and `aria-labelledby`.
  - `switchView()` and `activateView()` own the active view state.
  - `onRootClick()` currently handles `.wiki-kb-view-tab` clicks directly.
- `packages/toolkit/components/wiki-kb/semantics.js` owns Wiki KB AOS semantic
  refs and visible-label preservation.
- `packages/toolkit/adapters/zag/tabs.js` binds `[data-aos-tabs-root]`,
  `[data-aos-tabs-list]`, `[data-aos-tabs-trigger]`, and
  `[data-aos-tabs-content]`.

## Required Behavior

The default Wiki KB view tabs must keep their current user-facing behavior:

- The default chrome tab strip still switches between `graph` and `mindmap`.
- `activeViewId` remains the source of truth for the active view.
- Embedded chrome keeps using the compact select path; do not adopt Zag there
  in this card.
- View panels still use stable ids and accessibility bindings:
  `wiki-kb-panel-<view>`, `role="tabpanel"`, and
  `aria-labelledby="wiki-kb-tab-<view>"`.
- Tab triggers keep Wiki KB AOS metadata from `applyWikiKBSemanticTarget`,
  including `data-aos-ref="wiki-kb:tab:<view>"` and
  `data-aos-action="set_view"`.
- The rendered tab root/list/triggers/panels gain the tabs adapter data hooks
  and Zag tab ARIA behavior.

## Scope

Primary implementation scope:

- `packages/toolkit/components/wiki-kb/index.js`
- `tests/toolkit/wiki-kb-semantics.test.mjs`, `tests/toolkit/wiki-kb.test.mjs`,
  or a new focused `tests/toolkit/wiki-kb-tabs.test.mjs` if a render-level fake
  DOM test is cleaner

Secondary scope only if needed:

- `packages/toolkit/components/wiki-kb/semantics.js`, but only to preserve or
  compose existing semantic metadata cleanly.

## Hard Boundaries

- Do not change Integration Hub in this card.
- Do not adopt other adapters or other Wiki KB controls.
- Do not change the embedded chrome select path.
- Do not change graph or mindmap rendering behavior.
- Do not touch Sigil, gateway, host, daemon Swift, bridge messages, manifests,
  package manifests, or package lockfiles.
- Do not change the tabs adapter API unless a focused defect blocks this
  adoption. If that happens, keep the adapter fix tiny and call it out in the
  completion report.

## Suggested Implementation Notes

- Import `createAosZagTabs` into `packages/toolkit/components/wiki-kb/index.js`.
- Add a `viewTabs` machine scoped to the component instance. Update it with the
  current `activeViewId` and an `onValueChange` handler that routes through
  `switchView(nextViewId)`.
- Mark the default tab strip/list/triggers with the adapter's data attributes.
  Preserve `.wiki-kb-tab-strip`, `.wiki-kb-view-tab`, `data-view`, active class,
  and the stable `wiki-kb-tab-<view>` ids.
- Mark each created view panel with `data-aos-tabs-content` and a matching
  `data-value="<view>"` when `ensureView()` creates it.
- Bind or rebind after the tab triggers and any relevant view panels exist. The
  current implementation creates panels lazily, so inspect the flow before
  deciding whether binding belongs in `buildDOM()`, `ensureView()`,
  `activateView()`, or a small helper.
- Remove the parallel `.wiki-kb-view-tab` click-only switch path if the adapter
  fully owns trigger interaction. If a tiny fallback remains for compatibility,
  explain why in the completion report.

## Verification

Run these from the repo root:

```bash
node --test tests/toolkit/wiki-kb-semantics.test.mjs
node --test tests/toolkit/wiki-kb.test.mjs
node --test tests/toolkit/zag-adapter-tabs.test.mjs
node --test tests/toolkit/*.test.mjs
git diff --check
git status --short --branch
```

The focused Wiki KB coverage must assert at least:

- default chrome view tabs include the tabs adapter hooks, for example
  `data-aos-tabs-trigger`;
- view panels include matching `data-aos-tabs-content` and `data-value`
  bindings;
- selecting a view through the rendered tab control switches `activeViewId` or
  the visible panel through the adapter-bound path;
- existing Wiki KB semantic metadata for view tabs remains present;
- embedded chrome select behavior remains unchanged.

If the full toolkit suite creates `.playwright-cli/`, remove that generated
untracked directory before reporting completion.

## Git Section

```text
profile: agentic_relay
branch: gdi/zag-tabs-wiki-kb-adoption
branch_from: origin/main
checkpoint_expectation: one scoped reversible implementation commit, or two
  commits if a tiny adapter correction is required before the consumer change
```

GDI branches from current `origin/main`, implements, verifies, commits, pushes,
and reports back. Foreman reviews before merge.

## Completion Report Format

```text
## Completion Report
- profile: agentic_relay
- card: docs/dev/work-cards/zag-tabs-wiki-kb-adoption.md
- branch: gdi/zag-tabs-wiki-kb-adoption
- head_sha: <git rev-parse HEAD>
- base_sha: <origin/main SHA at branch time>
- files_changed: <n>
- commits: <list sha + subject>
- behavior_changed: <short summary>
- tests_passed: <n>/<n, include exact commands>
- diff_check: <passed|failed>
- conflict_risk: <none|low|medium — list files if low or medium>
- local_only_state: <none|dirty files/untracked/generated artifacts/runtime blockers, and whether related>
- relay_action_required: hold_for_foreman_review
```
