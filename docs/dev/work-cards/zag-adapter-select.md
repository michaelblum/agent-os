# Work Card: zag-adapter-select

## Goal

Add `packages/toolkit/adapters/zag/select.js` — a thin AOS adapter around
`@zag-js/select` that wires Zag's select state machine to surfaces rendered
with `createSelect` from `packages/toolkit/controls/select.js`.

## Context

The Zag menu adapter (`packages/toolkit/adapters/zag/menu.js`) is the reference
pattern for all Zag adapters. Follow the same structure: `VanillaMachine`,
`connect()`, `update()`, `bind()`, `destroy()`. The select adapter is simpler
— no positioning, no trigger/content split — but must follow the same
lifecycle contract.

`createSelect` in `packages/toolkit/controls/select.js` owns the control DOM
and consumes this adapter for keyboard navigation, typeahead, listbox ARIA, and
controlled open/value state.

## Scope

### Add
- `packages/toolkit/adapters/zag/select.js`
- `tests/toolkit/zag-adapter-select.test.mjs`

### Modify
- `packages/toolkit/adapters/zag/index.js` — export `createAosZagSelect`
- `packages/toolkit/package.json` and `packages/toolkit/package-lock.json` —
  only if `@zag-js/select` is not already present

### Do not touch
- `packages/toolkit/controls/_html.js` and
  `packages/toolkit/controls/button.js` — shared control cleanup belongs to the
  retrofit sweep, not this adapter card
- `packages/toolkit/adapters/zag/menu.js` — reference only
- Any surface or component files — no surface adoption in this card
- `bridge.js` or manifests

## API Contract

```js
import { createAosZagSelect } from './packages/toolkit/adapters/zag/select.js';

const select = createAosZagSelect({
  id: 'my-select',          // required — machine id
  collection,               // required — ListCollection from @zag-js/select
  value,                    // optional string[] — controlled selected values
  placeholder,              // optional string
  disabled,                 // optional boolean
  multiple,                 // optional boolean
  onValueChange,            // optional (details: { value: string[] }) => void
  onOpenChange,             // optional (details: { open: boolean }) => void
  onStateChange,            // optional (api) => void — fired on every state tick
  getRootNode,              // optional — for shadow DOM
});

// Returns:
select.connect()            // current API snapshot
select.update(nextContext)  // update props, returns new connect()
select.bind(root, options)  // wire trigger + content elements in a DOM subtree
select.bindTrigger(el)      // wire trigger element
select.bindContent(el)      // wire listbox content element
select.bindItem(el, props)  // wire a single option element
select.bindItems(root)      // wire all [data-aos-select-item] elements in root
select.open()               // programmatic open
select.close()              // programmatic close
select.destroy()            // stop machine, clean up all bindings
```

`connect()` returns at minimum:
```js
{
  api,              // raw Zag select API
  open,             // boolean
  value,            // string[]
  selectedItems,    // item objects for current value
  getTriggerProps,  // () => props object
  getContentProps,  // () => props object
  getItemProps,     // (item) => props object
  getLabelProps,    // () => props object
}
```

## Implementation Notes

- Use `@zag-js/select`. Confirm with
  `grep '@zag-js/select' packages/toolkit/package.json`. If it is
  missing, add it at the same version family as the existing Zag dependencies
  and update the toolkit lockfile, but do not make unrelated package changes.
- Follow the `VanillaMachine` / `zagConnect` / `normalizeProps` pattern from
  `menu.js` exactly. Import from `./vendor/menu-runtime.mjs` only if select
  exports are bundled there; otherwise import directly from `@zag-js/select`.
  Check `packages/toolkit/adapters/zag/vendor/` contents first.
- Use `spreadProps` (re-exported from Zag) to apply props to DOM elements,
  same as `menu.js`.
- `bindItems` should select by `[data-value]` attribute by default (Zag's
  standard item selector for select), overridable via options.
- Keep the adapter thin — no rendering logic, no style decisions.

## Verification

```bash
# 1. Confirm @zag-js/select is already a dependency
grep '@zag-js/select' packages/toolkit/package.json

# 2. Run adapter tests
node --test tests/toolkit/zag-adapter-select.test.mjs

# 3. Run full toolkit schema + adapter suite
node --test tests/toolkit/*.test.mjs

# 4. Confirm export is present in adapters index
node -e "const m = require('./packages/toolkit/adapters/zag/index.js'); console.log(typeof m.createAosZagSelect)"

# 5. Lint/check
git diff --check
```

All checks must be green before pushing.

## Relay Review Correction

An existing `gdi/zag-adapter-select` branch at `6cbf927` was reviewed on
2026-05-15 and is not merge-ready yet. The adapter tests pass, but the diff
includes out-of-scope edits to `packages/toolkit/controls/_html.js` and
`packages/toolkit/controls/button.js`. Rework the branch so those shared
control changes are absent from this card. Keep package manifest or lockfile
changes only if they are required for `@zag-js/select`.

PR #324 (`gdi/retrofit-shared-controls-sweep`) is still open and touches
`packages/toolkit/controls/button.js`. If it remains open when reporting
completion, list it in `open_prs_on_same_files`.

## Git Section

```
profile: agentic_relay
branch: gdi/zag-adapter-select
branch_from: main
```

GDI branches `gdi/zag-adapter-select` from current `origin/main`, implements,
verifies, commits, and pushes. Relay partner merges.

## Completion Report Format

```
## Completion Report
- profile: agentic_relay
- branch: gdi/zag-adapter-select
- head_sha: <git rev-parse HEAD>
- base_sha: <origin/main SHA at branch time>
- files_changed: <n>
- tests_passed: <n>/<n>
- conflict_risk: <none|low|medium — list files if low or medium>
- open_prs_on_same_files: <none|list>
- relay_action_required: merge
```
