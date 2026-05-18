# Toolkit Object Transform Validation Details V0

## Tracker

This follows `0a07b11` (`docs(schemas): add patch validation diagnostics
contract`), which made `canvas_object.transform.result` and
`canvas_object.effects.result` allow rejected results to carry
`validation_details.errors`.

Foreman's refresh on current `main` found the schema/docs contract landed, but
the reusable `object-transform-panel` result adapter still normalizes owner
results down to `status`, `reason`, `message`, and applied values. That drops
structured owner validation diagnostics before they can be inspected through
`window.__objectTransformPanelState` or rendered in the panel status.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Work in
`/Users/Michael/Code/agent-os`, not in `.docks/`.

## Goal

Make the toolkit object transform panel preserve and surface
`validation_details.errors` from rejected `canvas_object.transform.result` and
`canvas_object.effects.result` messages.

The narrow outcome is:

- structured validation errors survive normalization into `state.lastResult`;
- the panel's human-readable status includes a concise validation summary when
  the owner supplied one;
- existing `message`-only rejected results remain valid and unchanged.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `docs/api/toolkit/components.md`
- `shared/schemas/canvas-object-control.md`
- `shared/schemas/canvas-object-control.schema.json`
- `packages/toolkit/components/object-transform-panel/model.js`
- `packages/toolkit/components/object-transform-panel/index.js`
- `tests/toolkit/object-transform-panel-model.test.mjs`

## Rediscover State

Start with:

```bash
git status --short --branch
./aos ready
./aos dev recommend --json --files packages/toolkit/components/object-transform-panel/model.js packages/toolkit/components/object-transform-panel/index.js tests/toolkit/object-transform-panel-model.test.mjs docs/api/toolkit/components.md shared/schemas/canvas-object-control.md
rg -n "validation_details|canvas_object\\.(transform|effects)\\.result|lastResult|shortStatus" packages/toolkit/components/object-transform-panel tests/toolkit/object-transform-panel-model.test.mjs docs/api/toolkit/components.md shared/schemas/canvas-object-control.md
```

Foreman's refresh found:

- `shared/schemas/canvas-object-control.md` documents
  `validation_details.errors` on rejected transform and effects results.
- `packages/toolkit/components/object-transform-panel/model.js` currently drops
  `payload.validation_details` in both `normalizeTransformResultMessage` and
  `normalizeEffectsResultMessage`.
- `packages/toolkit/components/object-transform-panel/index.js` builds status
  text from `message || reason || objectAddressLabel(...)`.
- `tests/toolkit/object-transform-panel-model.test.mjs` covers applied owner
  transform/effects results, but not rejected structured validation diagnostics.

Confirm those points before editing.

## Existing Code To Inspect

- `packages/toolkit/components/object-transform-panel/model.js` - owns result
  normalization, `state.lastResult`, and applied-result state updates.
- `packages/toolkit/components/object-transform-panel/index.js` - owns the
  status string rendered in the panel and the agent-readable
  `window.__objectTransformPanelState` export.
- `tests/toolkit/object-transform-panel-model.test.mjs` - focused deterministic
  model coverage for registry, patch construction, and owner result handling.
- `docs/api/toolkit/components.md` - consumer-facing component contract; update
  only if implementation reveals a useful status/debug-state note.

## Required Behavior

### Preserve Structured Diagnostics

For rejected transform and effects results, normalize owner-supplied
`validation_details.errors` into `result.validation_details.errors` as an array
of non-empty strings. Preserve the exact useful strings; do not collapse them
into `message` only.

Malformed or empty `validation_details` should not break existing result
handling. Keep the component resilient: a rejected result with only `message`
or `reason` should behave as it does today.

### Surface A Concise Status

When validation errors are present, the visible status should include a concise
summary that is more useful than `invalid_patch` alone. A simple V0 shape is
enough, for example:

```text
rejected: transform patch failed validation; scale.x must be greater than 0
```

If there are multiple errors, include the first error and indicate the count, or
otherwise keep the status compact while retaining the full array in state.

### Do Not Enforce The Whole Schema Here

The panel is a resilient consumer, not the canonical schema validator. Do not
add full JSON Schema validation to the component. Keep result status checks and
target/request validation focused on the existing behavior.

## Scope

Likely ownership:

- `packages/toolkit/components/object-transform-panel/model.js`
- `packages/toolkit/components/object-transform-panel/index.js`
- `tests/toolkit/object-transform-panel-model.test.mjs`
- `docs/api/toolkit/components.md`, only if a short component-contract note is
  helpful

## Hard Boundaries / Non-Goals

- Do not change `shared/schemas/canvas-object-control.schema.json`; the schema
  contract already landed.
- Do not add a `validation-result` patch status.
- Do not create a preflight/validate channel.
- Do not change Sigil owner/adopter behavior in this slice.
- Do not broaden into Surface Inspector, annotation projection, Work Record
  verifier health, or State ID freshness.
- Do not require live AOS verification for acceptance; this can be proven with
  deterministic toolkit tests.

## Verification

Run:

```bash
node --test tests/toolkit/object-transform-panel-model.test.mjs
git diff --check
```

If the edit touches shared schema docs or consumer-facing API docs, also run the
router-recommended docs/schema checks that still apply after the final diff.

Optional live smoke, only if `./aos ready` passes and you choose to verify the
surface manually:

```bash
bash packages/toolkit/components/object-transform-panel/launch.sh
./aos show eval --id object-transform-panel --js 'JSON.stringify(window.__objectTransformPanelState)'
```

Report live AOS as skipped if you only run deterministic tests.

## Completion Report

Report:

- files changed;
- exact behavior for transform and effects rejected results with
  `validation_details.errors`;
- tests run with exact pass/fail results;
- whether docs/API were changed or deliberately left alone;
- whether live AOS was skipped, passed, or blocked;
- any local-only dirty/untracked state, including unrelated
  `.docks/foreman/tmp/`;
- any remaining follow-up, especially if a Sigil owner should later emit
  richer structured validation diagnostics.
