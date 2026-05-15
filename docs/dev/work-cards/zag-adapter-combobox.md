# Work Card: zag-adapter-combobox

## Goal

Add `packages/toolkit/adapters/zag/combobox.js` — a thin AOS adapter around
`@zag-js/combobox` that follows the existing Zag menu and select adapter
lifecycle.

## Context

Issue #340 tracks this adapter. The reference adapters are:

- `packages/toolkit/adapters/zag/menu.js`
- `packages/toolkit/adapters/zag/select.js`

Follow the same structure: `VanillaMachine`, `connect()`, `update()`, `bind()`,
`destroy()`, `spreadProps`, and focused Node tests with the fake DOM fixture.

The combobox adapter should add state-machine behavior only. Do not adopt it in
surfaces or replace existing control rendering in this card.

## Scope

### Add

- `packages/toolkit/adapters/zag/combobox.js`
- `tests/toolkit/zag-adapter-combobox.test.mjs`

### Modify

- `packages/toolkit/adapters/zag/index.js` — export `createAosZagCombobox`
- `packages/toolkit/package.json` and `packages/toolkit/package-lock.json` —
  add `@zag-js/combobox` at the same version family as existing Zag packages if
  it is not already present

### Do Not Touch

- `packages/toolkit/controls/*` — rendering and shared-control helpers are out
  of scope
- `packages/toolkit/adapters/zag/menu.js` and
  `packages/toolkit/adapters/zag/select.js` — reference only
- Any surface or component files — no surface adoption in this card
- `bridge.js` or manifests

## API Contract

```js
import { createAosZagCombobox } from './packages/toolkit/adapters/zag/combobox.js';

const combobox = createAosZagCombobox({
  id: 'my-combobox',        // required — machine id
  collection,               // required — Zag collection
  value,                    // optional string[] — controlled selected values
  inputValue,               // optional string — controlled input text
  placeholder,              // optional string
  disabled,                 // optional boolean
  multiple,                 // optional boolean
  allowCustomValue,         // optional boolean
  onValueChange,            // optional (details) => void
  onInputValueChange,       // optional (details) => void
  onOpenChange,             // optional (details) => void
  onStateChange,            // optional (snapshot) => void
  getRootNode,              // optional — for shadow DOM
});

// Returns:
combobox.connect()          // current API snapshot
combobox.update(next)       // update props, returns new connect()
combobox.bind(root, opts)   // wire root/input/trigger/content/items in a DOM subtree
combobox.bindInput(el)      // wire input element
combobox.bindTrigger(el)    // wire trigger element
combobox.bindContent(el)    // wire popup/listbox content element
combobox.bindItem(el, props)// wire one option element
combobox.bindItems(root)    // wire all [data-value] items in root by default
combobox.open()             // programmatic open
combobox.close()            // programmatic close
combobox.destroy()          // stop machine and clean up bindings
```

`connect()` returns at minimum:

```js
{
  api,              // raw Zag combobox API
  open,             // boolean
  value,            // string[]
  inputValue,       // string
  highlightedValue, // string | null
  getInputProps,    // () => props object
  getTriggerProps,  // () => props object
  getContentProps,  // () => props object
  getItemProps,     // (item) => props object
  getLabelProps,    // () => props object
}
```

## Implementation Notes

- Use `@zag-js/combobox`. Confirm with
  `grep '@zag-js/combobox' packages/toolkit/package.json`; add it if missing.
- Import `VanillaMachine`, `mergeProps`, `normalizeProps`, and `spreadProps`
  from `./vendor/menu-runtime.mjs`, matching `select.js`.
- Import `connect` and `machine` directly from `@zag-js/combobox` unless the
  vendor runtime already bundles combobox exports.
- Keep item binding data-driven. Use `[data-value]` as the default item selector
  unless Zag's combobox docs or local tests prove a better standard selector.
- Support `collection` updates through `update(nextContext)`, so callers can
  filter or replace collections as search input changes.
- Keep the adapter thin: no rendering logic, no style decisions, no surface
  wiring.

## Verification

```bash
# 1. Confirm or add dependency
grep '@zag-js/combobox' packages/toolkit/package.json

# 2. Run adapter tests
node --test tests/toolkit/zag-adapter-combobox.test.mjs

# 3. Run nearby Zag adapter tests
node --test tests/toolkit/zag-adapter-select.test.mjs tests/toolkit/zag-adapter-combobox.test.mjs

# 4. Run full toolkit suite
node --test tests/toolkit/*.test.mjs

# 5. Confirm export is present
node -e "const m = require('./packages/toolkit/adapters/zag/index.js'); console.log(typeof m.createAosZagCombobox)"

# 6. Lint/check
git diff --check
```

All checks must be green before pushing.

## Git Section

```text
profile: agentic_relay
branch: gdi/zag-adapter-combobox
branch_from: main
```

GDI branches `gdi/zag-adapter-combobox` from current `origin/main`, implements,
verifies, commits, and pushes. Relay authority merges.

## Completion Report Format

```text
## Completion Report
- profile: agentic_relay
- branch: gdi/zag-adapter-combobox
- head_sha: <git rev-parse HEAD>
- base_sha: <origin/main SHA at branch time>
- files_changed: <n>
- tests_passed: <n>/<n>
- conflict_risk: <none|low|medium — list files if low or medium>
- open_prs_on_same_files: <none|list>
- local_only_state: <none|dirty files/untracked/generated artifacts/runtime blockers, and whether related>
- relay_action_required: merge
```
