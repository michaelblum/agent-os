# Sigil UX Tree Command Registry Own Lookup Correction V0

## Recipient

Implementer.

## Transfer Kind

Correction round.

## Single Goal

Fix the Sigil UX tree command adapter so plain-object registries only execute
own registered handler properties, never inherited object prototype functions.

## Branch / Base

- `branch_from`: `implementer/sigil-ux-tree-command-adapter-cutover-v0`
- `required_start_ref`: `c34a246231bc716fea794f181b2b4596cbf05af4`
- Expected output branch: `implementer/sigil-ux-tree-command-adapter-cutover-v0`
- This is a correction on the existing cutover branch. Commit and push the
  corrected branch. Do not open a PR.

## Finding

`apps/sigil/renderer/live-modules/ux-tree-command-registry.js` currently treats
inherited object properties as registered handlers:

```js
typeof registry[key] === 'function'
typeof registry.handlers[key] === 'function'
```

That means a valid-looking command with `handler_ref: "toString"` can execute
`Object.prototype.toString` even when the registry is `{}`. This violates the
adapter's allowlist boundary: only explicit registry handlers should execute.

Reproduction from the branch:

```bash
node --input-type=module <<'NODE'
import { createSigilUxTree } from './apps/sigil/renderer/live-modules/ux-tree.js'
import { executeSigilUxTreeCommand, SIGIL_SELECTION_MODE_ESCAPE_COMMAND_INPUT } from './apps/sigil/renderer/live-modules/ux-tree-command-registry.js'
const tree = JSON.parse(JSON.stringify(createSigilUxTree()))
tree.commands = tree.commands.map((command) => command.id === 'sigil.selection_mode.cancel'
  ? { ...command, handler_ref: 'toString' }
  : command)
tree.validation = { ok: true, errors: [] }
const result = executeSigilUxTreeCommand(tree, {
  input: SIGIL_SELECTION_MODE_ESCAPE_COMMAND_INPUT,
  registry: {},
})
console.log(JSON.stringify({
  executed: result.executed,
  reason: result.reason,
  handler_key: result.handler_key,
  handler_result: result.handler_result,
}, null, 2))
NODE
```

Current bad result:

```json
{
  "executed": true,
  "reason": "executed",
  "handler_key": "toString",
  "handler_result": "[object Undefined]"
}
```

## Required Fix

Update registry lookup so:

- `Map` registries still work as before;
- plain object registries use own-property checks before reading handlers;
- `registry.handlers` also uses own-property checks before reading handlers;
- inherited properties such as `toString`, `valueOf`, `constructor`, and
  `__defineGetter__` are not executable handlers unless they are explicitly
  registered as own properties;
- null-prototype registries are supported.

Prefer a tiny helper such as `ownFunction(object, key)` over repeating the
lookup pattern.

## Required Tests

Add focused tests in:

- `tests/renderer/sigil-ux-tree-command-registry.test.mjs`

Cover at least:

- `handler_ref: "toString"` with `registry: {}` returns `executed: false` and
  `reason: "handler_not_registered"`;
- the same case with `registry.handlers: {}` also does not execute;
- an own property with a prototype-looking name still works when explicitly
  registered, for example `Object.create(null)` or
  `Object.defineProperty(registry, 'toString', { value: fn })`.

Keep the existing Selection Mode Escape cutover behavior unchanged.

## Verification

Run at least:

```bash
node --check apps/sigil/renderer/live-modules/ux-tree-command-registry.js
node --check apps/sigil/renderer/live-modules/main.js
node --test tests/renderer/sigil-ux-tree-command-registry.test.mjs \
  tests/renderer/sigil-ux-tree.test.mjs \
  tests/renderer/sigil-selection-mode-input.test.mjs
git diff --check
```

Include any additional checks you run in the completion report.

## Completion Report

Include:

- branch name;
- head SHA and base SHA;
- changed files;
- confirmation that only own registered handlers execute;
- tests and checks run;
- `git status --short --branch`;
- `git show --stat HEAD`.
