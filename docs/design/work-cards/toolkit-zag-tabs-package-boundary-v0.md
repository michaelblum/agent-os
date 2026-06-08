# Toolkit Zag Tabs Package Boundary V0

## Tracker

This follows the deterministic annotation/display-first cleanup stream after
`implementer/toolkit-zag-adapter-consolidation-v0` landed on `main` at `897adb9`.

Adjacent context:

- `docs/design/work-cards/toolkit-zag-adapter-consolidation-v0.md`
- `docs/design/work-cards/recent-ui-tabs-keyboard-focus-correction-v0.md`
- `docs/design/work-cards/recent-ui-live-regression-implementer-repairs-v0.md`

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Work in
`/Users/Michael/Code/agent-os`, not in `.docks/`.

## Goal

Make the toolkit package metadata and tests reflect the current tabs boundary:
`createAosZagTabs` is intentionally local, browser-safe, and Zag-shaped, but it
must not pull `@zag-js/tabs` into `aos://` hosted pages.

The likely outcome is removing the now-unused direct `@zag-js/tabs` dependency
from `packages/toolkit/package.json` and `packages/toolkit/package-lock.json`,
then adding or adjusting deterministic coverage so that package-level drift is
caught. If rediscovery proves the dependency is still intentionally required,
document that exact reason in the narrowest durable place instead of leaving the
manifest ambiguous.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `docs/design/work-cards/toolkit-zag-adapter-consolidation-v0.md`
- `packages/toolkit/adapters/zag/tabs.js`
- `tests/toolkit/zag-adapter-tabs.test.mjs`
- `packages/toolkit/package.json`
- `packages/toolkit/package-lock.json`

## Rediscover State

Start with:

```bash
git status --short --branch
./aos dev recommend --json --files packages/toolkit/package.json packages/toolkit/package-lock.json packages/toolkit/adapters/zag/tabs.js tests/toolkit/zag-adapter-tabs.test.mjs
rg -n "from ['\"]@zag-js/tabs|import\\(['\"]@zag-js/tabs|@zag-js/tabs" packages/toolkit packages tests
```

The current Foreman check found no live code import of `@zag-js/tabs`; only
package metadata and historical work-card references still mention it. Confirm
that yourself before editing.

## Existing Code To Inspect

- `packages/toolkit/adapters/zag/tabs.js` - the local browser-safe tabs adapter.
- `tests/toolkit/zag-adapter-tabs.test.mjs` - existing browser-safety,
  adopter-import, keyboard, and ARIA behavior coverage.
- `packages/toolkit/package.json` - currently declares `@zag-js/tabs`.
- `packages/toolkit/package-lock.json` - currently locks `@zag-js/tabs`.

## Required Behavior

Keep `createAosZagTabs` browser-safe:

- no static or dynamic bare `@zag-js/tabs` import in `tabs.js` or live toolkit
  adopters;
- existing tabs keyboard, focus, ARIA, and content visibility behavior remains
  unchanged;
- package metadata does not imply that the local tabs adapter is backed by the
  real Zag tabs runtime unless there is a specific, documented reason.

If removing the dependency, update both `package.json` and `package-lock.json`
with a structured npm/package-lock workflow or equivalent validated edit. Add a
focused deterministic assertion in the tabs adapter tests, or another narrow
test if more appropriate, so the package boundary does not silently drift back.

## Scope

Likely ownership:

- `packages/toolkit/package.json`
- `packages/toolkit/package-lock.json`
- `tests/toolkit/zag-adapter-tabs.test.mjs`

Only touch `packages/toolkit/adapters/zag/tabs.js` if a test reveals a direct
boundary bug. A docs-only outcome is acceptable only if rediscovery proves the
dependency must stay.

## Hard Boundaries / Non-Goals

- Do not replace `createAosZagTabs` with real `@zag-js/tabs`.
- Do not broaden into select, combobox, menu, or other Zag adapters.
- Do not change live Integration Hub, Wiki KB, or Markdown Workbench behavior.
- Do not perform a broad dependency update.
- Do not require live AOS verification for this package-boundary slice.

## Verification

Run the focused deterministic checks:

```bash
node --test tests/toolkit/zag-adapter-tabs.test.mjs
node --test $(rg --files tests/toolkit | rg 'zag-adapter-.*\.test\.mjs$')
git diff --check
```

If package metadata changes, also run a focused manifest search after the edit:

```bash
rg -n "from ['\"]@zag-js/tabs|import\\(['\"]@zag-js/tabs|@zag-js/tabs" packages/toolkit/package.json packages/toolkit/package-lock.json packages/toolkit/adapters tests/toolkit
```

The expected search result after dependency removal is no `@zag-js/tabs` hit in
the package manifest, lockfile, adapter code, or toolkit adapter tests.

Live AOS proof is not required. If you choose to run `./aos ready` and it
reports `input_tap_not_active` or another TCC/input blocker, report the blocker
without entering a repair loop unless Foreman explicitly routes a live slice.

## Completion Report

Report:

- files changed;
- whether `@zag-js/tabs` was removed or deliberately retained, with the reason;
- tests and searches run with exact pass/fail results;
- whether live AOS was skipped or blocked;
- any local-only dirty/untracked state, including whether `.docks/foreman/tmp/`
  remains unrelated;
- the next follow-up if this reveals another package or adapter boundary issue.
