# Agent UI Target Conformance Primitive Reuse V0

## Recipient

Implementer implementation round.

## Branch / Base

- branch_from: `origin/implementer/perceive-semantic-target-canonical-cutover-v0` at
  `eafc02bb0e9505a37370b7820d148da04fc10f8c`
- expected output branch:
  `implementer/agent-ui-target-conformance-primitive-reuse-v0`
- PR #402 is open and changes the conformance fixture/test files this slice
  touches. Stack from the PR #402 head to avoid recreating a known conflict.
  Rebase the output branch to `main` after #402 merges.

This is the small residual-cleanup slice from the PR #400 review. PR #400 is
accepted on its own; these are non-blocking follow-ups that tighten the seam.
None of them change behavior.

## Source Artifact

- PR #400 thermo-nuclear review (Foreman). Two findings are carried here:
  - the conformance test copies production primitives instead of importing them;
  - two minor legibility nits in the new producers.
- Canonical producer: `packages/toolkit/runtime/semantic-targets.js`.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Make the conformance spec reuse the real production primitives so it cannot
silently drift from the producer, and remove two small legibility smells in the
new code — without changing any observable behavior or producer output.

## Read First

- `AGENTS.md` (root)
- `packages/toolkit/runtime/semantic-targets.js`
- `tests/toolkit/agent-ui-target-conformance.test.mjs`
- `apps/sigil/avatar-editor/compact-surface.js`
- `docs/design/fixtures/agent-ui-target-conformance-v0/mapping-table.md`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse origin/implementer/perceive-semantic-target-canonical-cutover-v0
# Copied primitives in the test vs the production definitions:
rg -n "function compactObject|function actionList|function extensionSource" tests/toolkit/agent-ui-target-conformance.test.mjs packages/toolkit/runtime/semantic-targets.js
# Redundant spread of a freshly-built object:
rg -n "\.\.\.normalizeAgentUiTarget" apps/sigil/avatar-editor/compact-surface.js
```

No live AOS runtime is required for this slice.

## Required Behavior

### Reuse production primitives in the conformance test

- `compactObject`, `actionList`, and `extensionSource` are currently defined in
  both `semantic-targets.js` and copied verbatim into
  `agent-ui-target-conformance.test.mjs`. Export them (or a single shared
  helper module) from the runtime and import them into the test so there is one
  definition.
- The conformance test must still pass unchanged. The point is that the spec's
  mapping reuses the real primitives, so a future change to `compactObject`
  etc. is reflected in the spec instead of silently diverging.
- Keep the test's role as a migration/drift spec. Do not delete its per-shape
  mapping. (Driving every producer end-to-end through `normalizeAgentUiTarget`
  is out of scope here and partly impossible until the perceive cutover lands —
  see `implementer-perceive-semantic-target-canonical-cutover-v0.md`.)

### Drop the redundant spread

- In `apps/sigil/avatar-editor/compact-surface.js`, the tab record path does
  `records.push({ ...normalizeAgentUiTarget({...}, {...}) })`.
  `normalizeAgentUiTarget` already returns a fresh object; the surrounding
  `{ ... }` is an identity copy. Push the result directly.

### Document the clone assumption

- `compactObject` in `semantic-targets.js` is `JSON.parse(JSON.stringify(...))`.
  Add a one-line comment noting it assumes JSON-safe input (drops
  `undefined`/functions, throws on cycles), so a future caller passing a cyclic
  or function-bearing payload knows the contract. Do not change behavior.

## Scope

Test-helper reuse, one Sigil legibility fix, one comment. No producer output
change, no schema change, no behavior change.

## Hard Boundaries / Non-Goals

- Do not change any producer's emitted record shape.
- Do not rewrite the conformance test's assertions or remove its per-shape
  mapping.
- Do not touch the transitional fallbacks or #399; PR #402 owns that cutover and
  this branch starts from it only to avoid file conflicts.
- Do not touch the `employer-brand-*` reference art.
- Do not introduce a new abstraction layer; this is reuse + cleanup only.

## Stop Conditions

Stop with a clear report instead of continuing if:

- exporting the primitives would force a circular import or a runtime/test
  module boundary that needs a new shared module Foreman should bless;
- removing the spread changes record identity or downstream mutation behavior
  (it should not — confirm and proceed, else report).

## Suggested Implementation Areas

- `packages/toolkit/runtime/semantic-targets.js` (export primitives; comment)
- `packages/toolkit/runtime/index.js` (re-export if that is the public surface)
- `tests/toolkit/agent-ui-target-conformance.test.mjs` (import, drop copies)
- `apps/sigil/avatar-editor/compact-surface.js` (drop spread)

## Verification

```bash
git diff --check
node --test tests/toolkit/agent-ui-target-conformance.test.mjs
node --test tests/toolkit/runtime-semantic-targets.test.mjs tests/toolkit/panel-form.test.mjs
node --test tests/renderer/sigil-avatar-editor-compact-surface.test.mjs
# Confirm the primitives now have a single definition:
rg -n "function compactObject|function actionList|function extensionSource" tests/toolkit/agent-ui-target-conformance.test.mjs
```

## Completion Report

Include:

- branch and head SHA;
- changed paths;
- how the primitives are now shared (export site + import site);
- confirmation the conformance test still passes with identical assertions;
- confirmation the Sigil spread removal changed no behavior;
- exact verification commands and pass/fail results.
