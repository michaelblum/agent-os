# Toolkit Zag Adapter Consolidation V0

## Tracker

- Foreman audit source: `.docks/foreman/tmp/opportunities.md` ranked Zag
  adapter consolidation as the next streamlining slice after annotation helper
  cleanup.
- Adjacent app consumer:
  `apps/sigil/context-menu/menu.js`
- Adjacent toolkit modules:
  `packages/toolkit/adapters/zag/`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, PR, issue, or prior implementation state. Read and rediscover before
editing. Work in `/Users/Michael/Code/agent-os`, not in `.docks/`.

This is a toolkit cleanup/test slice. Keep the implementation focused on shared
Zag adapter glue and the Sigil selector leak. Do not remodel Sigil context menu
behavior or replace the hand-rolled tabs adapter in this slice.

## Goal

Reduce duplicated Zag adapter lifecycle/binding code and remove app-specific
Sigil selectors from the generic toolkit menu adapter.

After the slice, menu/select/combobox should share the reusable adapter glue
where practical, menu should have focused unit coverage, and Sigil should pass
its own item selector/value mapping from the Sigil consumer instead of relying
on toolkit defaults that mention `data-sigil-*`.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/adapters/zag/shared.js`
- `packages/toolkit/adapters/zag/menu.js`
- `packages/toolkit/adapters/zag/select.js`
- `packages/toolkit/adapters/zag/combobox.js`
- `packages/toolkit/adapters/zag/tabs.js`
- `tests/toolkit/zag-adapter-test-utils.mjs`
- Existing Zag adapter tests under `tests/toolkit/`
- `apps/sigil/context-menu/menu.js`
- Relevant Sigil context-menu tests under `tests/renderer/` and
  `tests/toolkit/`

## Rediscover State

Run from the repo root:

```bash
git status --short --branch
./aos ready
./aos dev recommend --json --files packages/toolkit/adapters/zag/shared.js packages/toolkit/adapters/zag/menu.js packages/toolkit/adapters/zag/select.js packages/toolkit/adapters/zag/combobox.js packages/toolkit/adapters/zag/tabs.js apps/sigil/context-menu/menu.js
rg -n "createAosZag|data-sigil|ctx-trigger|ctx-open|zag-adapter|Zag" packages/toolkit/adapters apps/sigil/context-menu tests/toolkit tests/renderer
```

If `./aos ready` reports a repo-mode TCC/input-tap blocker, report the exact
blocker and continue deterministic tests only. This slice should not need live
input verification unless GDI changes runtime context-menu behavior beyond
selector plumbing.

## Existing Code To Inspect

- `packages/toolkit/adapters/zag/shared.js` already has generic helper pieces:
  `createZagAdapter`, `compactProps`, `setDatasetFlag`, `valueForElement`,
  `applyProps`, and shared Zag exports.
- `packages/toolkit/adapters/zag/menu.js` currently duplicates service,
  connect, update, bind, cleanup, open, close, and props-spread logic. It also
  bakes Sigil selectors into `DEFAULT_ITEM_SELECTOR`.
- `packages/toolkit/adapters/zag/select.js` and
  `packages/toolkit/adapters/zag/combobox.js` duplicate similar lifecycle,
  item binding, and props plumbing.
- `packages/toolkit/adapters/zag/tabs.js` is named `createAosZagTabs` but is
  hand-rolled and does not use `@zag-js/tabs`. Treat that as a separate
  product decision unless a tiny documentation/test clarification is needed.
- `apps/sigil/context-menu/menu.js` is the current Sigil consumer of
  `createAosZagMenu`.

## Required Behavior

### Shared Adapter Glue

Use `createZagAdapter` or extract narrowly into `shared.js` so repeated
menu/select/combobox lifecycle and binding behavior is not maintained in three
separate places.

Preserve observable adapter API behavior for existing consumers:

- `connect()` shape where tests and callers depend on it;
- `update()` behavior, including position merging and state-change callback
  updates;
- cleanup behavior for bound parts;
- `bind`, `bindContent`, `bindItem`, `bindItems`, and equivalent select/combobox
  part helpers;
- public `open`, `close`, `send`, `service`, and `spreadProps` methods where
  they already exist.

Do not add compatibility aliases for old helper names if the repo owns all
callers. Use the evergreen strict contract posture: update owned callers and
tests to the canonical helper names.

### Generic Toolkit Menu Defaults

The toolkit menu adapter must not encode Sigil product vocabulary.

Replace the default item selector with generic toolkit/menu attributes, such as
`[data-value]`, `[data-aos-menu-item]`, or another neutral selector chosen after
inspecting existing tests. Sigil must pass its context-menu selector explicitly
from `apps/sigil/context-menu/menu.js`.

Likewise, generic value derivation in toolkit should not know about
`data-sigil-*`. If Sigil needs value mapping for `data-ctx-open`,
`data-sigil-action`, `data-sigil-avatar-action`, `data-sigil-fast-travel-effect`,
or `data-sigil-line-trail-mode`, pass that mapping from the Sigil consumer via
an explicit option or callback.

### Menu Unit Coverage

Add focused tests for the toolkit menu adapter. Cover at minimum:

- generic selector/value behavior without Sigil attributes;
- explicit custom selector/value mapping from a consumer;
- binding/cleanup marks menu items and clears marks on destroy or rebind;
- `open`/`close` or equivalent state transitions still report through
  `connect()` and `onStateChange`.

Use or extend `tests/toolkit/zag-adapter-test-utils.mjs` rather than creating a
parallel ad hoc test harness when possible.

### Select/Combobox Consolidation

Consolidate only the shared lifecycle/binding helpers that are clearly
equivalent. Do not force select and combobox into an abstraction that makes
their different parts or API shape harder to read.

If a helper cannot be shared without semantic ambiguity, leave it local and
call that out in the completion report.

### Tabs Boundary

Do not replace `createAosZagTabs` with a real `@zag-js/tabs` implementation in
this slice. The current tabs adapter is hand-rolled and behavior-bearing.

Allowed in this slice:

- add a test or comment that makes the current hand-rolled tabs boundary
  explicit;
- note in the completion report whether a later decision should rename it as
  AOS tabs or replace it with real Zag tabs.

Not allowed in this slice:

- changing tabs behavior;
- migrating tabs to `@zag-js/tabs`;
- broad package dependency changes.

## Scope

Likely ownership:

- `packages/toolkit/adapters/zag/shared.js`;
- `packages/toolkit/adapters/zag/menu.js`;
- focused select/combobox cleanup if the shared helper is clearly reusable;
- `apps/sigil/context-menu/menu.js` only for passing app-owned selectors/value
  mapping;
- focused tests under `tests/toolkit/` and existing Sigil context-menu tests if
  consumer behavior changes.

Avoid daemon, Swift, Surface Inspector, annotation, radial/3D behavior, or broad
Sigil UI changes.

## Hard Boundaries / Non-Goals

- Do not move Sigil context-menu product behavior into toolkit.
- Do not keep Sigil-specific defaults in toolkit menu.
- Do not leave compatibility shims for owned repo callers.
- Do not replace or behaviorally rewrite tabs.
- Do not add broad framework abstractions beyond the existing shared Zag helper
  pattern.
- Do not run live input or visual smokes unless deterministic tests expose an
  interaction gap that cannot be checked otherwise.

## Suggested Implementation Areas

Start with menu because it has the clearest app-specific leak and lacks focused
unit coverage. Then consolidate select/combobox lifecycle helpers only where
the resulting code is simpler than the local versions.

One acceptable end state is:

- `menu.js` delegates most service/binding lifecycle to `createZagAdapter`;
- menu-specific code owns only menu props, item value/text derivation, and
  open/close actions;
- generic toolkit defaults mention only toolkit-neutral attributes;
- Sigil passes its selector/value mapping explicitly from
  `apps/sigil/context-menu/menu.js`;
- select/combobox share any newly generalized helper that remains obvious;
- tabs are left behaviorally unchanged.

## Verification

Run focused deterministic checks:

```bash
./aos dev recommend --json --files packages/toolkit/adapters/zag/shared.js packages/toolkit/adapters/zag/menu.js packages/toolkit/adapters/zag/select.js packages/toolkit/adapters/zag/combobox.js apps/sigil/context-menu/menu.js
node --check packages/toolkit/adapters/zag/shared.js
node --check packages/toolkit/adapters/zag/menu.js
node --check packages/toolkit/adapters/zag/select.js
node --check packages/toolkit/adapters/zag/combobox.js
node --check apps/sigil/context-menu/menu.js
node --test tests/toolkit/<focused-zag-tests>.mjs
node --test tests/renderer/<focused-sigil-context-menu-tests>.mjs
git diff --check
```

Use exact existing test filenames after rediscovery. If no menu test exists,
create one and run it directly. If select/combobox tests already exist, run
them too. If GDI does not touch select/combobox behavior, do not run broad
unrelated renderer suites just for ceremony.

No live smoke is required unless runtime behavior changes beyond selector/value
plumbing. If `./aos ready` is blocked and live smoke would otherwise be useful,
report the blocker and the deterministic evidence instead of running repair
loops.

## Completion Report

Report back to Foreman with:

- files changed;
- whether toolkit menu defaults are free of Sigil-specific selectors/value
  handling;
- what shared helper/lifecycle duplication was removed;
- what select/combobox cleanup was done or intentionally left local;
- whether tabs were left unchanged and any later recommendation for tabs;
- exact tests run with pass/fail results;
- `./aos ready` result or blocker if checked;
- whether any compatibility surface remains, and if so the exact consumer and
  removal gate.
