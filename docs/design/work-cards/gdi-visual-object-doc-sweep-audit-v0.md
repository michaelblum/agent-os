# Work Card: gdi-visual-object-doc-sweep-audit-v0

## Transfer

- Recipient: GDI
- Transfer kind: GDI round
- Source artifact: Foreman evaluation of remote recommendation that a visual
  object architecture doc sweep may be the right next move after Phase 6
  closure.
- Branch/output expectation: create a branch from the required start ref and
  commit only the accepted docs/comment sweep changes for this card.
- Stop conditions: complete with evidence, fail with exact blocker, or stop
  human-needed only for a real permission/runtime blocker.

## Branch/Base

- branch_from: current Foreman branch
  `gdi/selection-mode-cursor-ancestor-ladder-v0`
- required_start_ref: `gdi/selection-mode-cursor-ancestor-ladder-v0`

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Make the current visual-object architecture documentation harder to misread
after Phase 6 closure by doing a bounded audit first, then applying only
high-confidence sanitization to current durable docs and comments.

This is not a broad archive migration. Historical work cards, archived plans,
and explicit before/after examples should not be rewritten just because they
contain old terms.

## Read First

- `AGENTS.md`
- `docs/dev/reports/aos-visual-object-architecture.md`
- `docs/design/visual-object-descriptor-contract-v0.md`
- `docs/design/aos-3d-object-graph-platform-contract.md`
- `docs/adr/0013-aos-execution-model-v0.md` for existing ADR style and path
- `apps/sigil/renderer/geometry.js`
- `apps/sigil/renderer/avatar-shape-composition.js`
- `apps/sigil/context-menu/descriptors.js`
- `packages/toolkit/workbench/visual-object-contract.js`
- `packages/toolkit/workbench/visual-object-resource-lifecycle.js`

## Rediscover State

```bash
git status --short --branch
rg -n "createStellatedGeometry|FULL geometry rebuild|geometry rebuild|rebuild geometry|Direct Three.js mutation|imperative rendering implementation|state\\.avatar\\.|descriptor contract|visual object descriptor" README.md CONTEXT.md docs/api docs/guides docs/design/*.md docs/dev/README.md docs/dev/reports --glob "*.md" --glob "!docs/archive/**" --glob "!docs/design/work-cards/**" --glob "!docs/dev/work-cards/**"
rg -n "TODO|FIXME|HACK|createStellatedGeometry|geometry rebuild|rebuild geometry|state\\.avatar\\.|imperative|descriptor|morph target|resource lifecycle" apps/sigil/renderer apps/sigil/context-menu packages/toolkit/workbench --glob "*.js"
```

This is docs/comment work. Skip live AOS checks unless the final change touches
runtime behavior, which it should not.

## Foreman Triage Notes

Initial Foreman scan found:

- `docs/dev/reports/aos-visual-object-architecture.md` is current and accepted,
  but it mixes closure status with historical architecture narrative and old
  before/after examples. Do not archive it. Consider whether it needs clearer
  labels around historical examples and the accepted/current path.
- `docs/design/visual-object-descriptor-contract-v0.md` is current and already
  describes Phase 6 resource lifecycle evidence and retained limits.
- `docs/design/aos-3d-object-graph-platform-contract.md` predates the descriptor
  contract closure and still says renderer objects rebuild through
  `updateGeometry()`, `applySkin()`, and `updateAllColors()`. This may need a
  short "superseded/updated by descriptor contract" note rather than a rewrite.
- ADRs live in `docs/adr/`, not `docs/architecture/adr/`.
- Historical work cards and archives contain many expected old-pattern
  references. Treat them as historical evidence, not stale guidance.

## Required Behavior

1. Produce a small audit section in the completion report before changing files:
   current/accurate, needs update, archive/deprecate candidates, and missing
   coverage.
2. If the audit confirms high-confidence current-doc drift, make the smallest
   useful fixes. Likely examples:
   - add `docs/adr/0014-visual-object-descriptor-contract.md` if the decision is
     durable and not already covered by the report/contract pair;
   - add a short migration note in `docs/design/visual-object-descriptor-contract-v0.md`
     or a focused `docs/guides/`/`docs/design/` note if there are real old/new
     patterns future agents need;
   - label historical before/after sections in
     `docs/dev/reports/aos-visual-object-architecture.md` so examples of
     full rebuilds cannot be mistaken for current guidance;
   - add a short status note to
     `docs/design/aos-3d-object-graph-platform-contract.md` if it now points to
     older object-graph staging rather than the accepted descriptor contract.
3. Only update code comments when they contradict current behavior. Do not
   rename live helpers like `createStellatedGeometry()` just because the helper
   still exists as implementation detail.
4. Keep retained limits explicit: factor-zero stellation still uses retained CPU
   buffer mutation; uniform-only stellation and broad pooling remain future
   tracks.

## Scope

Docs and comments only:

- current durable docs under `docs/design/*.md`, `docs/dev/reports/*.md`,
  `docs/guides/*.md`, `docs/api/**/*.md`, `README.md`, and `CONTEXT.md`;
- focused comments in `apps/sigil/renderer`, `apps/sigil/context-menu`, and
  `packages/toolkit/workbench`.

## Hard Boundaries

- Do not edit `docs/archive/**`.
- Do not rewrite historical work cards under `docs/design/work-cards/**` or
  `docs/dev/work-cards/**`.
- Do not move the accepted Phase 6 report or descriptor contract doc into an
  archive.
- Do not create `docs/architecture/adr/`; use the existing `docs/adr/` namespace
  if an ADR is justified.
- Do not make runtime behavior changes.
- Do not claim complete GPU/uniform-only stellation or broad live proof beyond
  the accepted representative evidence.

## Verification

```bash
git diff --check
rg -n "docs/architecture/adr|pre-descriptor-refactor|pre-visual-object-refactor" docs --glob "*.md"
```

Run focused docs searches from Rediscover State again and explain any remaining
old-pattern hits as either historical examples, accepted retained limits, or
updated guidance.

## Completion Report

Return a path-scoped report with:

- files changed;
- audit matrix with exact paths and line references;
- summary of any ADR/migration/status notes added;
- searches run and how remaining old-pattern hits are classified;
- confirmation that runtime files were not behaviorally changed, or exact reason
  if a comment-only runtime file was touched;
- any recommended next slice, only if one is clearly separate from this audit.
