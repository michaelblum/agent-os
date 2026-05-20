# Work Card: adr-namespace-consolidation-v0

**Status:** Ready for implementation
**Owner:** GDI

## Tracker

Implementation follow-up for:

- `docs/design/work-cards/adr-namespace-audit-v0.md`
- `docs/design/notes/adr-namespace-audit-2026-05-20.md`
- `CONTEXT-MAP.md`
- `docs/agents/domain.md`
- `docs/recipes/context-doc-maintenance.md`

The ADR namespace audit recommends consolidating the single ADR-named file in
`docs/decisions/` into the canonical `docs/adr/` series. This slice implements
that docs-only migration and updates live consumer guidance.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Make `docs/adr/` the canonical home for ADRs and durable architecture-decision
records by migrating `docs/decisions/ADR-001-toolkit-platform-strategy.md` into
the numbered ADR series.

This is a namespace consolidation slice, not a substantive rewrite of the
toolkit platform decision.

## Read First

- `AGENTS.md`
- `CONTEXT-MAP.md`
- `docs/agents/domain.md`
- `docs/recipes/context-doc-maintenance.md`
- `docs/design/notes/matt-pocock-context-integration-audit-2026-05-20.md`
- `docs/design/notes/adr-namespace-audit-2026-05-20.md`
- `docs/recipes/gdi-work-card-authoring.md`
- every file under `docs/adr/`
- `docs/decisions/ADR-001-toolkit-platform-strategy.md`

## Rediscover State

Run from the agent-os repo root:

```bash
git status --short --branch
./aos dev recommend --json --files docs/decisions/ADR-001-toolkit-platform-strategy.md CONTEXT-MAP.md docs/agents/domain.md docs/recipes/context-doc-maintenance.md docs/design/notes/matt-pocock-context-integration-audit-2026-05-20.md docs/design/notes/adr-namespace-audit-2026-05-20.md
rg --files docs/adr docs/decisions
rg -n "docs/decisions|ADR-001-toolkit-platform-strategy|0012-toolkit-platform-strategy|ADR namespace|durable decision|durable-decision" AGENTS.md CONTEXT-MAP.md docs/agents/domain.md docs/recipes/context-doc-maintenance.md docs/design docs/adr docs/decisions
```

This is docs-only. Do not run `./aos ready` unless you discover a need for
live runtime evidence, which is not expected.

## Branch/Base

branch_from: `origin/gdi/toolkit-panel-theme-consistency-audit-v0`
required_start_ref: `origin/gdi/toolkit-panel-theme-consistency-audit-v0`

This work card and the ADR namespace audit live on the branch above, not on
`origin/main`. Do not reset to `origin/main` for this slice. Use
`gdi/adr-namespace-consolidation-v0` as the output branch if creating a
separate GDI branch.

## Required Behavior

Move the toolkit platform strategy decision with `git mv`:

```bash
git mv docs/decisions/ADR-001-toolkit-platform-strategy.md docs/adr/0012-toolkit-platform-strategy.md
```

Preserve the accepted decision content. Keep `Status: Accepted`,
`Date: 2026-05-15`, related issue links, context, decision, and consequences.
Avoid editing the substance of the decision unless a tiny path/provenance note
is needed to prevent future confusion.

Add a short provenance note near the top only if it reads naturally, for
example:

```md
Originally recorded as `docs/decisions/ADR-001-toolkit-platform-strategy.md`;
migrated into the canonical ADR namespace on 2026-05-20.
```

Update live consumer guidance so it no longer treats `docs/decisions/` as an
active ADR namespace:

- `CONTEXT-MAP.md` should name `docs/adr/` as the canonical ADR and durable
  architecture-decision namespace, and remove the interim "inspect both" rule.
- `docs/agents/domain.md` should say consumers read `docs/adr/` for ADRs and
  durable architecture decisions. Remove wording that says this slice does not
  resolve the split.
- `docs/recipes/context-doc-maintenance.md` should direct hard-to-reverse,
  surprising architectural choices to `docs/adr/` and remove the active
  `docs/decisions/` placement path.
- `docs/design/notes/matt-pocock-context-integration-audit-2026-05-20.md`
  should keep original audit-time findings historical, but update the
  post-audit implementation status or residual-risk wording so readers know
  the ADR namespace split was later resolved on this branch.
- `docs/design/notes/adr-namespace-audit-2026-05-20.md` may receive a short
  implementation-status note if that is the cleanest way to prevent readers
  from treating the recommendation as still pending after the migration.

After the move, git should not track any file under `docs/decisions/`. Do not
add a README stub unless you find a live in-repo reference that genuinely needs
a retired-namespace landing page; prefer removing the namespace from tracked
files.

## Scope

Likely edit/move only:

- `docs/decisions/ADR-001-toolkit-platform-strategy.md` to
  `docs/adr/0012-toolkit-platform-strategy.md`
- `CONTEXT-MAP.md`
- `docs/agents/domain.md`
- `docs/recipes/context-doc-maintenance.md`
- `docs/design/notes/matt-pocock-context-integration-audit-2026-05-20.md`
- `docs/design/notes/adr-namespace-audit-2026-05-20.md`

Only edit another file if the reference search shows a live, current reference
to the old namespace that would mislead future agents after consolidation.

## Hard Boundaries

- Do not rewrite the substance of existing ADRs.
- Do not renumber ADRs `0001` through `0011`.
- Do not define `docs/decisions/` as a new durable-decision class in this
  slice.
- Do not change `CONTEXT.md`, `ARCHITECTURE.md`, `docs/api/`,
  `shared/schemas/`, Swift, JavaScript, tests, fixtures, or runtime behavior.
- Do not edit archived specs or old work cards just to normalize historical
  wording.
- Do not open or update GitHub issues or PRs.
- Do not edit `/Users/Michael/Code/mattpocock-skills`.

## Verification

Run:

```bash
git diff --check
rg --files docs/adr
test ! -d docs/decisions || find docs/decisions -type f
rg -n "docs/decisions|ADR-001-toolkit-platform-strategy|0012-toolkit-platform-strategy|ADR namespace|durable decision|durable-decision" AGENTS.md CONTEXT-MAP.md docs/agents/domain.md docs/recipes/context-doc-maintenance.md docs/design docs/adr
```

Expected verification shape:

- `rg --files docs/adr` shows `docs/adr/0012-toolkit-platform-strategy.md`.
- There is no remaining tracked ADR-named file under `docs/decisions/`.
- References to `docs/decisions/` are either absent from live guidance or
  clearly historical in dated notes/work cards.
- References to `ADR-001-toolkit-platform-strategy.md` are either absent or
  clearly historical/provenance notes.
- No Swift rebuild and no live AOS smoke are required for this docs-only slice.

## Completion Report

Report:

- files moved and changed;
- whether the toolkit platform strategy content was preserved;
- how live consumer guidance now describes the ADR namespace;
- remaining historical/provenance references to the old path, with rationale;
- exact verification commands and pass/fail results;
- whether `CONTEXT.md`, `ARCHITECTURE.md`, docs/api, schemas, source behavior,
  tests, fixtures, GitHub issues, and PRs were untouched;
- local-only state or unrelated dirty files.
