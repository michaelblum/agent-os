# Work Card: zag-tabs-integration-hub-adoption

## Goal

Adopt the newly merged `createAosZagTabs` adapter in one real toolkit surface:
the Integration Hub surface selector tabs.

This is the first post-horizon consumer slice after PR #356 merged the Zag
adapter chain. Keep it narrow and reversible. The outcome should be no visual
regression, no product behavior change, and one stock toolkit component using
the shared tabs adapter instead of hand-only tab wiring.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Tracker

- Prior merged PR: #356, `feat(zag): add adapter horizon`
- Prior horizon branch: `implementer/zag-adapter-horizon`
- New implementation branch: `implementer/zag-tabs-integration-hub-adoption`
- Work card: `docs/dev/work-cards/zag-tabs-integration-hub-adoption.md`

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/components/integration-hub/index.js`
- `packages/toolkit/components/integration-hub/semantics.js`
- `tests/toolkit/integration-hub-semantics.test.mjs`
- `packages/toolkit/adapters/zag/tabs.js`
- `tests/toolkit/zag-adapter-tabs.test.mjs`

## Rediscover State

```bash
git status --short --branch
git fetch origin
git switch -c implementer/zag-tabs-integration-hub-adoption origin/main
./aos dev recommend --json
```

This slice is pure toolkit JavaScript and deterministic Node tests. Do not run
live AOS canvas verification unless the implementation unexpectedly crosses
into runtime/display behavior.

## Existing Code To Inspect

- `packages/toolkit/components/integration-hub/index.js` renders
  `.integration-hub-surface-tabs` and listens for
  `.integration-hub-surface-tab` clicks to update `state.activeSurface`.
- `packages/toolkit/components/integration-hub/semantics.js` currently stamps
  the surface tab buttons with `role="tab"`, `aria-selected`, AOS refs, and
  `aria-controls="integration-hub-surface-panel"`.
- `tests/toolkit/integration-hub-semantics.test.mjs` has a fake DOM fixture and
  focused assertions for Integration Hub controls and tab semantics.
- `packages/toolkit/adapters/zag/tabs.js` is the adapter to adopt. It binds
  `[data-aos-tabs-root]`, `[data-aos-tabs-list]`,
  `[data-aos-tabs-trigger]`, and `[data-aos-tabs-content]`.

## Required Behavior

The Integration Hub surface selector remains the same user-facing control:

- The visible surface labels and active styling remain unchanged.
- `state.activeSurface` remains the source of truth for the rendered surface.
- Selecting a surface tab updates `state.activeSurface` through the tabs adapter
  value-change path.
- The existing Integration Hub AOS semantic metadata remains intact:
  `data-aos-ref`, `data-aos-action="select_surface"`,
  `data-aos-surface="integration-hub"`, and stable readable labels.
- The rendered controls gain the tabs adapter binding attributes and Zag tab
  ARIA behavior without losing the existing test-visible semantics.

## Scope

Primary implementation scope:

- `packages/toolkit/components/integration-hub/index.js`
- `packages/toolkit/components/integration-hub/semantics.js`, only if needed to
  compose cleanly with the adapter without duplicating or clobbering attributes
- `tests/toolkit/integration-hub-semantics.test.mjs`

The expected adapter is `createAosZagTabs` from
`packages/toolkit/adapters/zag/tabs.js`.

## Hard Boundaries

- Do not adopt Zag adapters in any other surface in this card.
- Do not change the tabs adapter API unless a focused defect blocks this
  adoption. If that happens, keep the adapter fix tiny and call it out in the
  completion report.
- Do not touch Sigil, gateway, host, daemon Swift, bridge messages, manifests,
  package manifests, or package lockfiles.
- Do not restyle Integration Hub beyond attributes or tiny class preservation
  needed for the adapter.
- Do not remove existing AOS semantic refs or action metadata.

## Suggested Implementation Notes

- Import `createAosZagTabs` into the Integration Hub component.
- Mark the tab root/list/triggers/content with the adapter's AOS data
  attributes. Preserve the current `integration-hub-surface-tabs`,
  `integration-hub-surface-tab`, `data-surface`, and active class hooks.
- Prefer a controlled adapter value tied to `state.activeSurface`, with
  `onValueChange` routing back through `setState({ activeSurface })`.
- Bind after `applyIntegrationHubSemantics(rootEl, state)` or deliberately
  preserve whichever attributes the semantic layer must own. The final DOM
  should satisfy both the AOS semantic tests and Zag tab roles/ARIA.
- If representing the single existing `.integration-hub-grid` as tab content is
  awkward, keep the DOM conservative and document the choice in code only if it
  is not obvious. Do not add multiple visible panels or change the rendered
  surface layout.

## Verification

Run these from the repo root:

```bash
node --test tests/toolkit/integration-hub-semantics.test.mjs
node --test tests/toolkit/zag-adapter-tabs.test.mjs
node --test tests/toolkit/*.test.mjs
git diff --check
git status --short --branch
```

The focused Integration Hub test must assert at least:

- rendered surface tabs retain `role="tab"` and correct selected state;
- rendered surface tabs include the tabs adapter data hooks, for example
  `data-aos-tabs-trigger`;
- choosing a surface through the rendered tab control updates the active surface
  path, using the adapter-bound interaction rather than a separate parallel
  click-only implementation;
- existing AOS metadata such as `data-aos-action="select_surface"` and
  `data-aos-ref="integration-hub:surface-tab-..."` remains present.

## Git Section

```text
profile: agentic_relay
branch: implementer/zag-tabs-integration-hub-adoption
branch_from: origin/main
checkpoint_expectation: one scoped reversible implementation commit, or two
  commits if a tiny adapter correction is required before the consumer change
```

Implementer branches from current `origin/main`, implements, verifies, commits, pushes,
and reports back. Foreman reviews before merge.

## Completion Report Format

```text
## Completion Report
- profile: agentic_relay
- card: docs/dev/work-cards/zag-tabs-integration-hub-adoption.md
- branch: implementer/zag-tabs-integration-hub-adoption
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
