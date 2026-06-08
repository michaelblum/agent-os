# Work Card: implementer-visual-object-stale-doc-sanitization-v0

## Transfer

- Recipient: Implementer
- Transfer kind: Implementer round
- Source artifact: Foreman accepted the narrow doc sweep at
  `1282d8cde0f849eeaba224475f134c9d773b1a7c`, then the human explicitly raised
  the bar: stale docs of any kind will cause future drift, and the recent
  visual-object/descriptor/resource-lifecycle changes have wide codebase impact.
- Branch/output expectation: create a branch from the required start ref and
  commit a reviewable docs/comment sanitization pass.
- Stop conditions: complete with evidence, fail with exact blocker, or stop
  manual-intervention only for a real permission/runtime blocker.

## Branch/Base

- branch_from: `implementer/selection-mode-cursor-ancestor-ladder-v0`
- required_start_ref: `origin/implementer/selection-mode-cursor-ancestor-ladder-v0`

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Sanitize stale visual-object, Sigil avatar, descriptor, geometry rebuild, and
resource-lifecycle documentation so future sessions cannot mistake deprecated or
pre-closure material for current guidance.

Every high-risk stale hit should end in one of three states:

- updated to current guidance;
- marked clearly as historical, superseded, or closed-work context with a
  pointer to the current contract/status docs;
- left unchanged only with a completion-report explanation showing it is current
  evidence, a retained limit, or an implementation detail.

## Current Canonical Docs

Treat these as current unless inspection proves an internal contradiction:

- `docs/adr/0014-visual-object-descriptor-contract.md`
- `docs/design/visual-object-descriptor-contract-v0.md`
- `docs/dev/reports/aos-visual-object-architecture.md`

The current contracts are:

- `aos.visual_object.descriptor.v0`
- `aos.visual_object.resource_lifecycle.v0`
- descriptor/controller/form-binding helpers in `packages/toolkit/workbench/`
- Sigil-owned renderer sync hooks for app behavior
- retained limits around factor-zero stellation, uniform-only stellation, broad
  pooling, profiler-backed leak proof, omega tesseron, and observe/snapshot
  product integration

## Read First

- `AGENTS.md`
- `docs/design/work-cards/implementer-visual-object-doc-sweep-audit-v0.md`
- `docs/adr/0014-visual-object-descriptor-contract.md`
- `docs/design/visual-object-descriptor-contract-v0.md`
- `docs/dev/reports/aos-visual-object-architecture.md`
- `docs/design/aos-3d-object-graph-platform-contract.md`
- `docs/design/work-cards/implementer-visual-object-phase6-closure-and-next-tracks-v0.md`
- `apps/sigil/renderer/geometry.js`
- `apps/sigil/renderer/avatar-shape-composition.js`
- `packages/toolkit/workbench/visual-object-resource-lifecycle.js`

## Rediscover State

```bash
git status --short --branch
rg -n "createStellatedGeometry|FULL geometry rebuild|geometry rebuild|rebuild geometry|state\\.avatar\\.|visual object descriptor|descriptor-driven|resource lifecycle|stellation|morph target|imperative rendering" docs README.md CONTEXT.md --glob "*.md" --glob "!node_modules/**"
rg -n "TODO|FIXME|HACK|createStellatedGeometry|geometry rebuild|rebuild geometry|state\\.avatar\\.|imperative|descriptor|morph target|resource lifecycle" apps/sigil/renderer apps/sigil/context-menu packages/toolkit/workbench --glob "*.js"
```

This is docs/comment work. Skip live AOS checks unless the final change touches
runtime behavior, which it should not.

## Required Behavior

1. Build a hit list from the rediscovery searches, then classify by path family:
   - current contract/status docs;
   - current design/API/guide docs;
   - active or recently relevant work cards;
   - closed historical work cards;
   - archive/superpowers material;
   - code comments.
2. Sanitize high-risk stale docs rather than merely documenting that they are
   historical. High risk includes any file likely to be found by future search
   and read as implementation guidance, especially work cards or design docs
   that say old Phase 6 work remains open, imply geometry rebuilds are required
   for descriptor edits, or omit the accepted descriptor/resource-lifecycle
   closure.
3. Prefer small banner/status notes at the top of historical work cards or
   archived docs over rewriting their original task content. The note should
   state what superseded the file and point to the current contract/status docs.
4. Update current docs in place when a paragraph is stale but the document still
   owns current guidance.
5. Add or update a lightweight index only if it reduces future search drift,
   for example a `docs/design/visual-object-doc-index.md` that names the
   canonical docs and explains how to treat old work cards/archive material.
6. Code comments may be edited only when they contradict current behavior.
   Helper names like `createStellatedGeometry()` may remain if they are live
   implementation names.

## Scope

Allowed:

- docs under `docs/`;
- `README.md` and `CONTEXT.md` if they contain stale visual-object guidance;
- comment-only edits in `apps/sigil/renderer`, `apps/sigil/context-menu`, and
  `packages/toolkit/workbench`.

Expected likely targets:

- `docs/design/work-cards/implementer-visual-object-phase6-*.md`
- `docs/design/work-cards/implementer-sigil-avatar-stellation-*.md`
- `docs/design/work-cards/implementer-sigil-avatar-phase*.md`
- `docs/design/work-cards/implementer-visual-object-phase5-*.md`
- `docs/archive/superpowers/**/2026-04-*-sigil-*.md`
- any current `docs/design/*.md`, `docs/guides/*.md`, or `docs/api/**/*.md`
  that implies pre-descriptor architecture is still current.

## Hard Boundaries

- Do not make runtime behavior changes.
- Do not delete historical work cards or archives.
- Do not mass-edit every search hit mechanically. Edit only where a future
  session could plausibly mistake stale material for current guidance.
- Do not weaken historical evidence in completed work cards; add status notes
  instead.
- Do not claim complete GPU/uniform-only stellation, broad live proof,
  profiler-backed leak proof, broad material/geometry pooling, or complete
  observe/snapshot product integration.
- Do not move ADRs out of `docs/adr/`.

## Verification

```bash
git diff --check
rg -n "docs/architecture/adr|pre-descriptor-refactor|pre-visual-object-refactor" docs --glob "*.md"
rg -n "FULL geometry rebuild|geometry rebuild|rebuild geometry|uniform-only stellation|Phase 6.*remaining|descriptor-driven" docs README.md CONTEXT.md --glob "*.md" --glob "!node_modules/**"
```

For remaining hits, classify them in the completion report as:

- current canonical guidance;
- historical/superseded and visibly marked;
- retained limit/future track;
- closed-work evidence;
- live implementation detail.

## Completion Report

Return a path-scoped report with:

- files changed;
- classification matrix with exact paths and line references;
- which stale docs were updated versus marked historical/superseded;
- searches run and how remaining stale-looking hits are classified;
- confirmation that runtime files were untouched or comment-only;
- any intentionally deferred doc families and why they are lower risk;
- recommended next slice only if the sanitization reveals a separate, concrete
  follow-up.
