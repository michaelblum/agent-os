# Work Card — `panel/form.js`

## Goal

Build `packages/toolkit/panel/form.js` — the form harness that sits between raw controls and the decision-gate component.

## Design Reference

Read `docs/design/user-signal-surface.md` before implementing. The form harness must conform to the gate request schema defined there.

## Deliverables

- `packages/toolkit/panel/form.js` — form harness with:
  - Accepts a `fields[]` array from a gate request schema
  - Renders the appropriate control from `packages/toolkit/controls/` for each field type
  - Exposes `getValues()` — returns current form state as a plain object
  - Exposes `isValid()` — returns boolean; true when all required fields are satisfied
  - Exposes `onChange(callback)` — fires callback with current values on any field change
- `tests/toolkit/panel-form.test.mjs` — tests covering `getValues()`, `isValid()`, and `onChange()`

## Reference Implementations

- Controls: `packages/toolkit/controls/`
- Test pattern: `tests/toolkit/decision-gate.test.mjs`
- DOM fixture: `tests/toolkit/dom-fixture.mjs`

## Verification

Run `tests/toolkit/panel-form.test.mjs` and confirm all tests pass before committing.

## Git

1. Follow all preconditions in the implementer native subagent instructions (fetch, reset, branch)
2. Branch: `implementer/panel-form`
3. Stage only: `packages/toolkit/panel/form.js` and `tests/toolkit/panel-form.test.mjs`
4. Commit, push, run `git show --stat HEAD`
5. Report: branch name + HEAD SHA + `git show --stat HEAD` output + test results
6. Do NOT merge to main — relay partner handles merge
