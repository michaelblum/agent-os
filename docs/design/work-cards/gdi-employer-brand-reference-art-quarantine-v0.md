# Employer Brand Reference-Art Quarantine V0

## Recipient

GDI implementation round.

## Branch / Base

- branch_from: `origin/main` at `9665dd324a9663354f87caab575eab90155c8027`
- expected output branch: `gdi/employer-brand-reference-art-quarantine-v0`

This slice is independent of the agent-ui-target normalizer stack merged by
PR #400. It can land any time after current `main`.

## Source Artifact

- Foreman decision (this card is the durable record): the `employer-brand-*`
  workbench modules are intentional reference art — kept so a future coherent
  platform can mine them to rebuild a proper AOS workflow/recipe/playbook. They
  are not live product code and are not slated for migration.
- The problem: the art is wired into the live toolkit public surface, so it
  reads as canon, pollutes every audit, and risks accidental dependency.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Make the `employer-brand-*` reference art clearly non-canonical: remove it from
the live `packages/toolkit/workbench` public export surface and move it to a
location whose path alone signals "reference art, not canon" — while preserving
every file's contents verbatim so it remains mineable later.

## Read First

- `AGENTS.md` (root) — note the existing `_dev` non-canonical convention and
  the change-control posture.
- `packages/toolkit/workbench/AGENTS.md` if present, else
  `packages/toolkit/AGENTS.md`.
- `packages/toolkit/workbench/index.js` — the barrel that currently re-exports
  the art.

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD
# The 24 art files and their barrel exports:
ls packages/toolkit/workbench/employer-brand-* | wc -l
rg -n "employer-brand" packages/toolkit/workbench/index.js
# Prove nothing canonical imports them directly (only the barrel should):
rg -n "from ['\"].*employer-brand" packages apps src | rg -v "/employer-brand|workbench/index.js"
# Tests that reference the art (these move or update their import paths):
rg -ln "employer-brand" tests
```

No live AOS runtime is required for this slice.

## Required Behavior

### Remove from the public surface

- Delete the 24 `export * from './employer-brand-*.js'` lines from
  `packages/toolkit/workbench/index.js` (currently lines ~28–51).
- After this slice, importing `packages/toolkit/workbench` must not surface any
  `employer-brand-*` symbol.

### Relocate as marked reference art

- Move all `employer-brand-*` source files out of the canonical
  `packages/toolkit/workbench/` tree into a clearly non-canonical home. Prefer
  `packages/toolkit/workbench/_reference/employer-brand/` (leading `_` matches
  the repo's existing `_dev` non-canonical signal) unless `Read First` reveals a
  better-established art/quarantine location — if so, use that and say why.
- Move files verbatim. Do not refactor, rename symbols, modernize, or migrate
  identity vocabulary inside them. The point is to preserve the art exactly.
- Add a short `_reference/employer-brand/README.md` stating: this is reference
  art, not canonical toolkit code; it is intentionally off the public barrel;
  do not import it from product code; it exists to inform a future
  workflow/recipe rebuild.

### Tests and internal references

- Update any test or internal file whose import path breaks because of the move
  (path-only changes). Keep the tests passing as-is; do not rewrite their
  assertions.
- If a test exercises the art purely as a historical regression guard, keep it
  but point it at the new path. If a non-art canonical module turns out to
  import the art directly (the `Rediscover State` grep should show none), stop
  and report — that is real entanglement Foreman must decide on, not a path fix.

## Scope

Toolkit workbench barrel surface and file layout; test import paths; one new
README. No behavior change, no symbol renames, no identity-vocabulary edits.

## Hard Boundaries / Non-Goals

- Do not edit the contents of any `employer-brand-*` module beyond what a file
  move mechanically requires (none, if moved verbatim).
- Do not migrate, normalize, or "fix" the `target_id`/evidence vocabulary inside
  the art. It is frozen on purpose.
- Do not delete the art. Quarantine ≠ deletion.
- Do not touch the agent-ui-target normalizer stack, Swift perceive, or
  conformance fixtures.
- Do not add the relocated files back to any barrel or index.

## Stop Conditions

Stop with a clear report instead of continuing if:

- a canonical (non-art, non-test) module imports an `employer-brand-*` module
  directly — surface the dependency, do not silently rewire it;
- moving the files would break a published package `exports` map or SDK type
  that an external consumer depends on;
- the art is imported through a path the barrel removal does not cover.

## Suggested Implementation Areas

- `packages/toolkit/workbench/index.js` (remove 24 export lines)
- `packages/toolkit/workbench/employer-brand-*.js` → relocate (24 files)
- `packages/toolkit/workbench/_reference/employer-brand/README.md` (new)
- test files whose import paths reference the moved modules

## Verification

```bash
git diff --check
# Barrel no longer surfaces the art:
rg -n "employer-brand" packages/toolkit/workbench/index.js || echo "barrel clean"
# No canonical code imports the art from outside the quarantine:
rg -n "from ['\"].*employer-brand" packages apps src | rg -v "_reference/employer-brand"
# Toolkit + workbench tests still pass after path updates:
node --test tests/toolkit/*.test.mjs
```

Report the public-surface count before/after (barrel export lines and any
package `exports` entries).

## Completion Report

Include:

- branch and head SHA;
- changed paths (moved files listed by old → new path);
- barrel export-line count before/after and confirmation the art is off the
  public surface;
- the chosen quarantine location and why;
- any canonical importer discovered (should be none) and how it was handled;
- exact verification commands and pass/fail results;
- confirmation that no art file contents changed beyond the move.
