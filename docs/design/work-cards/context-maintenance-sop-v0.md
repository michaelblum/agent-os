# Work Card: context-maintenance-sop-v0

**Status:** Ready for implementation
**Owner:** GDI

## Tracker

Implementation follow-up for:

- `docs/design/notes/matt-pocock-context-integration-audit-2026-05-20.md`
- `docs/agents/domain.md`
- `CONTEXT-MAP.md`
- `docs/design/work-cards/context-live-doc-stale-sweep-v0.md`

The context setup, context map, and live-doc stale sweep fixed the immediate
drift. The remaining governance gap is durable maintenance: agents still need a
single SOP for when context docs, API docs, schemas, ADRs, AGENTS files, and
recipes must be updated together.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Create a reusable context-maintenance recipe that keeps `CONTEXT.md`,
`CONTEXT-MAP.md`, `docs/agents/domain.md`, `ARCHITECTURE.md`, `docs/api/`,
`shared/schemas/`, ADR/decision docs, `AGENTS.md`, and subtree local docs from
drifting independently.

This is a governance/SOP slice, not a stale-doc implementation sweep.

## Read First

- `AGENTS.md`
- `CONTEXT.md`
- `CONTEXT-MAP.md`
- `ARCHITECTURE.md`
- `docs/agents/domain.md`
- `docs/design/notes/matt-pocock-context-integration-audit-2026-05-20.md`
- `docs/recipes/agent-entry-paths-and-verification.md`
- `docs/recipes/gdi-work-card-authoring.md`
- `docs/design/work-cards/context-live-doc-stale-sweep-v0.md`
- `/Users/Michael/Code/mattpocock-skills/skills/engineering/grill-with-docs/SKILL.md`
- `/Users/Michael/Code/mattpocock-skills/skills/engineering/grill-with-docs/CONTEXT-FORMAT.md`

## Rediscover State

Run from the agent-os repo root:

```bash
git status --short --branch
./aos dev recommend --json
```

Inspect the local Matt skills checkout without editing it:

```bash
git -C /Users/Michael/Code/mattpocock-skills status --short --branch
git -C /Users/Michael/Code/mattpocock-skills log -1 --oneline
```

The Matt checkout may have unrelated untracked `.DS_Store` files. Do not delete
or stage them.

## Branch/Base

branch_from: `origin/main`
required_start_ref: `origin/main`

This work card is present on `origin/main` after PR #368 merged. Start from
`origin/main` for this slice. Use `gdi/context-maintenance-sop-v0` as the
output branch if creating a separate GDI branch.

## Required Behavior

Create a new recipe under `docs/recipes/`, likely
`docs/recipes/context-doc-maintenance.md`.

The recipe should cover:

- agent-os's local adaptation: `CONTEXT.md` is currently a governed domain
  language plus contract-term index, not Matt's pure glossary shape;
- `CONTEXT-MAP.md` as the routing map for multi-context discovery;
- when a term change belongs in `CONTEXT.md`;
- when a domain or source-root change belongs in `CONTEXT-MAP.md`;
- when `docs/agents/domain.md` should change;
- when `ARCHITECTURE.md` should change;
- when `docs/api/` or `shared/schemas/` must change;
- when an ADR or `docs/decisions/` entry is needed;
- when root or subtree `AGENTS.md` files should change;
- when a reusable process belongs in `docs/recipes/`;
- when old design notes should be left historical rather than rewritten;
- how to classify Matt/external skill patterns as adopt, adapt, reject, or
  defer;
- a lightweight stale-phrase/search checklist after context changes;
- the authority-conflict behavior: surface conflicts instead of silently
  choosing a stale source.

Update pointer surfaces so the recipe is discoverable:

- `AGENTS.md` durable-lessons / placement guidance.
- `docs/agents/domain.md`.
- `CONTEXT-MAP.md` durable decisions/SOPs section or conflict notes.

Keep those pointer updates short. The recipe should own the details.

## Scope

Edit only:

- `docs/recipes/context-doc-maintenance.md`
- `AGENTS.md`
- `docs/agents/domain.md`
- `CONTEXT-MAP.md`

Only edit another file if you find a direct typo in this work card that blocks
completion.

## Hard Boundaries

- Do not rewrite `CONTEXT.md`.
- Do not change `ARCHITECTURE.md`, `docs/api/`, schemas, ADRs, or decisions in
  this slice.
- Do not perform another stale-doc sweep in this slice.
- Do not move or consolidate ADRs or decisions.
- Do not change Swift, JavaScript, tests, fixtures, or runtime behavior.
- Do not open or update GitHub issues or PRs.
- Do not edit `/Users/Michael/Code/mattpocock-skills`.

## Verification

Run:

```bash
git diff --check
rg -n "context-doc-maintenance|CONTEXT.md|CONTEXT-MAP.md|docs/agents/domain.md" AGENTS.md docs/agents/domain.md CONTEXT-MAP.md docs/recipes/context-doc-maintenance.md
```

No Swift rebuild and no live AOS smoke are required for this docs-only SOP
slice.

## Completion Report

Report:

- files changed;
- summary of the SOP sections created;
- pointer surfaces updated;
- exact verification commands and pass/fail results;
- any defer, stale-local-doc, or authority-conflict items found while writing
  the SOP;
- whether `CONTEXT.md`, `ARCHITECTURE.md`, docs/api, schemas, ADR cleanup,
  source behavior, tests, fixtures, GitHub issues, and PRs were untouched;
- local-only state or unrelated dirty files.
