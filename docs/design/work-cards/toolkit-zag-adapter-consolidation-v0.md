# Toolkit Zag Adapter Lifecycle Consolidation V0

## Tracker

- Current route snapshot: `main` at `b879402` after annotation projection
  evidence normalization was integrated.
- Foreman audit source: `.docks/foreman/tmp/opportunities.md` ranks Zag
  lifecycle helper consolidation as the next separate toolkit cleanup.
- Prior adjacent work already complete: toolkit menu defaults are neutral, Sigil
  passes product-owned selectors from `apps/sigil/context-menu/menu.js`, and
  `tests/toolkit/zag-adapter-menu.test.mjs` covers that boundary.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, PR, issue, or prior implementation state. Read and rediscover before
editing. Work in `/Users/Michael/Code/agent-os`, not in `.docks/`.

This is a toolkit cleanup/test slice. Keep the implementation focused on
shared Zag adapter lifecycle and binding glue. Do not redo the completed Sigil
selector cleanup, do not remodel Sigil context menu behavior, and do not
replace the hand-rolled tabs adapter in this slice.

## Goal

Reduce duplicated service/update/bind/cleanup lifecycle code in the Zag select
and combobox adapters by reusing `createZagAdapter` or a narrowly improved
shared helper, while preserving their public API and observable behavior.

After the slice, select and/or combobox should share the reusable lifecycle
path where it makes the code simpler. If one adapter cannot be consolidated
without making its behavior less clear, leave it local and explain why in the
completion report.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `.docks/foreman/tmp/opportunities.md`
- `packages/toolkit/adapters/zag/shared.js`
- `packages/toolkit/adapters/zag/menu.js`
- `packages/toolkit/adapters/zag/select.js`
- `packages/toolkit/adapters/zag/combobox.js`
- `packages/toolkit/adapters/zag/tabs.js`
- `tests/toolkit/zag-adapter-test-utils.mjs`
- `tests/toolkit/zag-adapter-menu.test.mjs`
- `tests/toolkit/zag-adapter-select.test.mjs`
- `tests/toolkit/zag-adapter-combobox.test.mjs`
- `tests/toolkit/zag-adapter-tabs.test.mjs`

## Rediscover State

Run from the repo root:

```bash
git status --short --branch
./aos ready
./aos dev recommend --json --files packages/toolkit/adapters/zag/shared.js packages/toolkit/adapters/zag/select.js packages/toolkit/adapters/zag/combobox.js tests/toolkit/zag-adapter-select.test.mjs tests/toolkit/zag-adapter-combobox.test.mjs tests/toolkit/zag-adapter-menu.test.mjs
rg -n "createZagAdapter|createAosZag(Select|Combobox|Menu|Tabs)|VanillaMachine|cleanupBindings|bindItems|data-aos-(select|combobox|menu)" packages/toolkit/adapters/zag tests/toolkit
```

If `./aos ready` reports a repo-mode TCC/input-tap blocker, report the exact
blocker and continue deterministic tests only. This slice should not require
live input verification.

Before editing, verify that the old menu selector cleanup is complete:

```bash
rg -n "data-sigil|ctx-trigger|ctx-open" packages/toolkit/adapters/zag/menu.js tests/toolkit/zag-adapter-menu.test.mjs
```

If that search only shows consumer-supplied selector tests, do not change Sigil
or menu defaults except to keep tests passing after shared-helper edits.

## Existing Code To Inspect

- `packages/toolkit/adapters/zag/shared.js` owns `createZagAdapter`,
  `compactProps`, `setDatasetFlag`, `valueForElement`, `applyProps`, shared Zag
  exports, and generic binding lifecycle.
- `packages/toolkit/adapters/zag/menu.js` already delegates to
  `createZagAdapter`. Treat it as a working example of the intended shared
  helper boundary.
- `packages/toolkit/adapters/zag/select.js` still hand-rolls Zag service
  creation, update, connect snapshots, binding cleanup, part binding, item
  binding, and open/close actions.
- `packages/toolkit/adapters/zag/combobox.js` still hand-rolls a very similar
  lifecycle with a slightly richer part set.
- `packages/toolkit/adapters/zag/tabs.js` is intentionally browser-safe and
  hand-rolled. `tests/toolkit/zag-adapter-tabs.test.mjs` asserts that boundary.

## Required Behavior

### Shared Adapter Lifecycle

Use `createZagAdapter` as-is where possible. If select/combobox need a small
extension to `shared.js`, keep it generic and prove it with menu/select/combobox
tests.

Preserve observable adapter API behavior for existing consumers:

- `connect()` snapshot shape for select and combobox;
- `update()` behavior, including controlled value/input updates, collection
  replacement, positioning merge, and state-change callback updates;
- cleanup behavior for bound parts and item dataset markers;
- `bind`, part-specific bind helpers, `bindItems`, `open`, `close`, `send`,
  `service`, and `spreadProps` methods where they already exist;
- item value/text derivation from collection items and bound DOM elements.

Do not force select and combobox into one abstraction if their part sets or API
shape become harder to read. The target is less duplicated lifecycle code, not
a framework rewrite.

### Menu Boundary Stays Complete

Keep `packages/toolkit/adapters/zag/menu.js` free of Sigil-specific selectors
and value handling. Menu may change only as needed to keep the shared helper
coherent.

Preserve coverage that:

- neutral menu defaults bind `[data-value]` and `[data-aos-menu-item]`;
- product-owned selectors are supplied by the consumer;
- destroy/rebind cleanup clears item markers.

### Tabs Boundary Stays Separate

Do not replace `createAosZagTabs` with real `@zag-js/tabs` in this slice. Do
not change tabs behavior. If the work reveals a tabs naming or dependency
decision, document it in the completion report as a follow-up only.

## Scope

Likely ownership:

- `packages/toolkit/adapters/zag/shared.js`;
- `packages/toolkit/adapters/zag/select.js`;
- `packages/toolkit/adapters/zag/combobox.js`;
- `packages/toolkit/adapters/zag/menu.js` only if shared-helper changes require
  a small adaptation;
- focused tests under `tests/toolkit/`.

Avoid daemon, Swift, Surface Inspector, annotation, Sigil product behavior,
radial/3D behavior, and broad UI changes.

## Hard Boundaries / Non-Goals

- Do not move Sigil context-menu product behavior into toolkit.
- Do not reintroduce Sigil-specific defaults in toolkit menu.
- Do not leave compatibility shims for owned repo callers.
- Do not replace or behaviorally rewrite tabs.
- Do not add broad framework abstractions beyond the existing shared Zag helper
  pattern.
- Do not run live input or visual smokes unless deterministic tests expose an
  interaction gap that cannot be checked otherwise.

## Suggested Implementation Areas

Start with one adapter, preferably `select.js`, because it is smaller than
combobox and duplicates the same lifecycle shape. Make it use `createZagAdapter`
or a small shared helper while preserving tests.

Then evaluate `combobox.js`. If the select refactor makes combobox simpler too,
apply the same pattern. If combobox needs too much special casing, leave it
local and report the boundary.

One acceptable end state is:

- `select.js` delegates service/update/bind lifecycle to `createZagAdapter`;
- `combobox.js` either delegates similarly or has a documented reason to remain
  local for now;
- `shared.js` remains generic and menu still passes its existing tests;
- test helper duplication is reduced only where it naturally follows from the
  adapter changes;
- tabs are left behaviorally unchanged.

## Verification

Run focused deterministic checks:

```bash
./aos dev recommend --json --files packages/toolkit/adapters/zag/shared.js packages/toolkit/adapters/zag/select.js packages/toolkit/adapters/zag/combobox.js tests/toolkit/zag-adapter-select.test.mjs tests/toolkit/zag-adapter-combobox.test.mjs tests/toolkit/zag-adapter-menu.test.mjs
node --check packages/toolkit/adapters/zag/shared.js
node --check packages/toolkit/adapters/zag/menu.js
node --check packages/toolkit/adapters/zag/select.js
node --check packages/toolkit/adapters/zag/combobox.js
node --test tests/toolkit/zag-adapter-select.test.mjs
node --test tests/toolkit/zag-adapter-combobox.test.mjs
node --test tests/toolkit/zag-adapter-menu.test.mjs
node --test tests/toolkit/zag-adapter-tabs.test.mjs
git diff --check
```

If Implementer touches only select, still run combobox/menu tests to prove shared-helper
compatibility. If Implementer touches combobox, run select/menu tests for the same
reason. No live smoke is required for this pure toolkit adapter cleanup.

## Completion Report

Report back to Foreman with:

- files changed;
- which adapter(s) now use the shared lifecycle helper;
- what lifecycle duplication was removed;
- what select/combobox behavior was intentionally left local, if any;
- confirmation that menu defaults remain free of Sigil-specific selectors/value
  handling;
- confirmation that tabs were left behaviorally unchanged;
- exact tests run with pass/fail results;
- `./aos ready` result or blocker if checked;
- any remaining follow-up recommendation.
