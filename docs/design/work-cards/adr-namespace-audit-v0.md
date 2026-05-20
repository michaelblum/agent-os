# Work Card: adr-namespace-audit-v0

**Status:** Accepted 2026-05-20
**Owner:** Foreman

## Tracker

Governance follow-up for:

- `docs/design/notes/matt-pocock-context-integration-audit-2026-05-20.md`
- `CONTEXT-MAP.md`
- `docs/agents/domain.md`
- `docs/recipes/context-doc-maintenance.md`

The context setup, context map, stale-doc sweep, and maintenance SOP now teach
agents to inspect both `docs/adr/` and `docs/decisions/`. That is an interim
consumer rule, not a resolved namespace decision. This slice should produce an
audit and recommendation before any ADR or decision files are moved.

Accepted evidence:

- Checked after PR #368 merged to `main`.
- `docs/design/notes/adr-namespace-audit-2026-05-20.md` exists and includes the
  requested inventory, consumer guidance summary, risk analysis, options,
  recommendation, and follow-up plan.
- The note also records the later implementation status: the toolkit platform
  strategy was migrated to `docs/adr/0012-toolkit-platform-strategy.md`.
- Verification passed:
  `rg -n "docs/adr|docs/decisions|ADR namespace|durable-decision|durable decision" docs/design/notes/adr-namespace-audit-2026-05-20.md`.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Decide what Foreman should do next about the split durable-decision namespace:
`docs/adr/` contains numbered ADRs, while `docs/decisions/` contains an
ADR-named toolkit platform strategy decision.

Produce a recommendation and exact follow-up plan. Do not implement the
namespace change in this slice.

## Read First

- `AGENTS.md`
- `CONTEXT-MAP.md`
- `docs/agents/domain.md`
- `docs/recipes/context-doc-maintenance.md`
- `docs/design/notes/matt-pocock-context-integration-audit-2026-05-20.md`
- `docs/recipes/gdi-work-card-authoring.md`
- every file under `docs/adr/`
- every file under `docs/decisions/`

## Rediscover State

Run from the agent-os repo root:

```bash
git status --short --branch
./aos dev recommend --json
rg --files docs/adr docs/decisions
rg -n "docs/adr|docs/decisions|ADR|durable decisions|decision docs" AGENTS.md CONTEXT-MAP.md docs/agents/domain.md docs/recipes/context-doc-maintenance.md docs/design/notes/matt-pocock-context-integration-audit-2026-05-20.md docs/adr docs/decisions
```

This is a docs-only audit. Do not run `./aos ready` unless you discover a need
for live runtime evidence, which is not expected.

## Branch/Base

branch_from: `origin/main`
required_start_ref: `origin/main`

This work card is present on `origin/main` after PR #368 merged. Start from
`origin/main` for this slice. Use `gdi/adr-namespace-audit-v0` as the output
branch if creating a separate GDI branch.

## Required Output

Create a new audit note:

- `docs/design/notes/adr-namespace-audit-2026-05-20.md`

The note must include:

- inventory of current ADR and decision files, including numbering/title
  patterns;
- summary of current consumer guidance in `CONTEXT-MAP.md`,
  `docs/agents/domain.md`, and `docs/recipes/context-doc-maintenance.md`;
- any in-repo evidence for why `docs/decisions/` exists separately from
  `docs/adr/`;
- risk analysis for agents, skills, and docs consumers if they inspect only one
  namespace;
- comparison of at least these options:
  - migrate `docs/decisions/ADR-001-toolkit-platform-strategy.md` into
    `docs/adr/`;
  - keep `docs/decisions/` as a distinct durable-decision class and define that
    class explicitly;
  - leave the split as-is with only the current interim "inspect both" rule;
- one recommended path with rationale;
- an exact follow-up plan for Foreman, including which files a later
  implementation card should edit and what verification should prove.

If the correct recommendation depends on human/product judgment, state the
decision point precisely and give the smallest reversible docs-only follow-up
that can proceed without that judgment.

## Scope

Primary scope is audit and recommendation. Edit only:

- `docs/design/notes/adr-namespace-audit-2026-05-20.md`

Only edit another file if you find a direct typo in this work card that blocks
completion.

## Hard Boundaries

- Do not move, rename, renumber, or rewrite files under `docs/adr/` or
  `docs/decisions/`.
- Do not update `CONTEXT-MAP.md`, `docs/agents/domain.md`,
  `docs/recipes/context-doc-maintenance.md`, `AGENTS.md`, `ARCHITECTURE.md`, or
  `CONTEXT.md` in this audit slice.
- Do not change Swift, JavaScript, schemas, tests, fixtures, or runtime
  behavior.
- Do not edit archived specs or old design notes just to normalize terminology.
- Do not open or update GitHub issues or PRs.
- Do not edit `/Users/Michael/Code/mattpocock-skills`.

## Verification

Run:

```bash
git diff --check
rg -n "docs/adr|docs/decisions|ADR namespace|durable-decision|durable decision" docs/design/notes/adr-namespace-audit-2026-05-20.md
```

No Swift rebuild and no live AOS smoke are required for this docs-only audit.

## Completion Report

Report:

- files changed;
- recommended ADR namespace path and rationale;
- options rejected or deferred;
- exact follow-up plan and likely work-card scope;
- exact verification commands and pass/fail results;
- whether ADR/decision files, context pointers, source behavior, schemas, tests,
  fixtures, GitHub issues, and PRs were untouched;
- local-only state or unrelated dirty files.
