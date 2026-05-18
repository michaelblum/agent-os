# Patch Result Validation Diagnostics Contract V0

## Tracker

This follows the domain-model grill report cleanup that landed on `main` at
`b294597` (`docs: clarify patch result vocabulary`).

That cleanup made `CONTEXT.md` explicit about:

- `Subject Owner`
- `Patch Channel`
- `Patch Result`
- `stale` as a qualified freshness failure
- `validation-result` as diagnostic detail, not a terminal Patch Result status

The remaining contract question is at the concrete schema boundary:
`shared/schemas/canvas-object-control.schema.json` has `applied | rejected |
stale` result statuses and optional `message`, but no first-class validation
diagnostic field.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Work in
`/Users/Michael/Code/agent-os`, not in `.docks/`.

## Goal

Make the canvas object patch result contract match the vocabulary now documented
in `CONTEXT.md` and `docs/design/aos-workbench-pattern.md`.

Resolve this exact ambiguity:

- Rejected patch results may need validation diagnostics.
- The current schema permits `reason` and `message` only.
- The docs now say validation diagnostics can be attached to a rejection or
  returned by a separate preflight/validate operation.

Choose the narrowest correct V0 contract and prove it with schema fixtures:

1. If canvas object patch results should carry structured validation details,
   add the smallest explicit schema field for rejected results and document its
   shape.
2. If `message` is intentionally the only V0 diagnostic channel, update docs and
   fixtures to say that precisely, and do not add a new field.

Do not leave prose implying a structured diagnostic that the schema rejects.

## Read First

- `AGENTS.md`
- `shared/schemas/CONTRACT-GOVERNANCE.md`
- `CONTEXT.md`
- `docs/design/aos-workbench-pattern.md`
- `shared/schemas/canvas-object-control.schema.json`
- `shared/schemas/canvas-object-control.md`
- `tests/schemas/canvas-object-control.test.mjs`

## Rediscover State

Start with:

```bash
git status --short --branch
./aos dev recommend --json --files shared/schemas/canvas-object-control.schema.json shared/schemas/canvas-object-control.md shared/schemas/fixtures/canvas-object-control/valid/transform-rejected.json tests/schemas/canvas-object-control.test.mjs CONTEXT.md docs/design/aos-workbench-pattern.md
rg -n "validation-result|validation detail|invalid_patch|canvas_object\\.(transform|effects)\\.result|Patch Result" CONTEXT.md docs/design/aos-workbench-pattern.md shared/schemas/canvas-object-control.md shared/schemas/canvas-object-control.schema.json shared/schemas/fixtures/canvas-object-control tests/schemas/canvas-object-control.test.mjs apps packages src
```

Foreman’s current check found:

- `canvas_object.transform.result` and `canvas_object.effects.result` share the
  same status enum and rejection reasons.
- rejected/stale results require `reason`;
- both result types allow optional `message`;
- schema fixtures cover `transform-rejected.json`, but not structured
  validation diagnostics;
- runtime adopters currently appear to emit `reason: "invalid_patch"` plus
  message-style diagnostics rather than a structured validation object.

Confirm that yourself before editing.

## Existing Code To Inspect

- `shared/schemas/canvas-object-control.schema.json` - canonical message schema.
- `shared/schemas/canvas-object-control.md` - human-readable schema companion.
- `shared/schemas/fixtures/canvas-object-control/valid/transform-rejected.json`
  - current rejected transform result fixture.
- `shared/schemas/fixtures/canvas-object-control/valid/effects-result.json` -
  current effects result fixture; add a rejected effects fixture if useful.
- `tests/schemas/canvas-object-control.test.mjs` - validates every valid/invalid
  fixture with the canonical schema.
- `packages/toolkit/components/object-transform-panel/index.js` and
  `apps/sigil/radial-item-*/` - runtime callers to inspect only if the schema
  choice needs adopter evidence.

## Required Behavior

### Patch Result Statuses Stay Terminal

Do not add `validation-result` as a `status` enum value.

The result statuses stay:

- `applied`
- `rejected`
- `stale`

Revised input must be represented as a new patch request, not as mutation of an
owner-held pending result.

### Validation Diagnostics Are Explicitly Scoped

If adding a structured field, keep it result-scoped and owner-neutral. It should
work for both transform and effects result messages. Prefer a small shape such
as an object with an `errors` array of non-empty strings, unless rediscovery
finds an existing repo convention that is clearly better.

Only require the field when the contract can justify it. A rejected result with
`reason: "invalid_patch"` may still be allowed to carry only `message` if that
is the V0 decision.

If keeping `message` only, the docs must say validation diagnostics are carried
as owner-readable message text in this V0 schema, while richer validation
preflight remains future work.

### Schema Docs Must Match The Schema

Update `shared/schemas/canvas-object-control.md` with an example of a rejected
result for the chosen path. Make the language match `CONTEXT.md`: schema status
is `applied`, not `accepted`.

Only touch `CONTEXT.md` or `docs/design/aos-workbench-pattern.md` if the schema
decision requires tightening the wording from `b294597`.

## Scope

Likely ownership:

- `shared/schemas/canvas-object-control.schema.json`
- `shared/schemas/canvas-object-control.md`
- `shared/schemas/fixtures/canvas-object-control/valid/*.json`
- `shared/schemas/fixtures/canvas-object-control/invalid/*.json`, only if needed
- `tests/schemas/canvas-object-control.test.mjs`, only if fixture validation
  needs a targeted assertion beyond the existing valid/invalid sweep

## Hard Boundaries / Non-Goals

- Do not add `validation-result` as a patch result status.
- Do not build a generic patch bus or preflight service.
- Do not change schema version unless the repo’s schema governance docs require
  it for the chosen change.
- Do not change Sigil runtime behavior unless an existing caller already emits
  payloads that violate the decided contract.
- Do not broaden into Work Record verifier health, annotation projection
  staleness, or State ID enforcement.
- Do not run live AOS verification; this is a deterministic schema/docs slice.

## Verification

Run:

```bash
node --test tests/schemas/canvas-object-control.test.mjs
node --test tests/schemas/*.test.mjs
git diff --check
```

Also run a focused drift search:

```bash
rg -n "validation-result|accepted, rejected, stale|accepted subject state|accepted state fragment" CONTEXT.md docs/design/aos-workbench-pattern.md shared/schemas/canvas-object-control.md shared/schemas/canvas-object-control.schema.json
```

Expected result: no wording that treats `validation-result` as a terminal patch
status, and no schema companion prose that uses `accepted` where the schema term
is `applied`.

## Completion Report

Report:

- files changed;
- whether the contract now uses structured validation diagnostics or `message`
  only, with the reason;
- schema fixtures added or changed;
- tests and searches run with exact pass/fail results;
- whether live AOS was skipped;
- any local-only dirty/untracked state, including unrelated `.docks/foreman/tmp/`;
- any remaining follow-up, especially if a separate preflight/validate contract
  is now warranted.
