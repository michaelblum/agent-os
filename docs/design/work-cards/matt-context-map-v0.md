# Work Card: matt-context-map-v0

**Status:** Ready for implementation
**Owner:** GDI

## Tracker

Implementation follow-up for:

- `docs/design/notes/matt-pocock-context-integration-audit-2026-05-20.md`
- `docs/design/work-cards/matt-context-setup-scaffold-v0.md`
- `docs/agents/domain.md`

The setup scaffold now teaches agents that agent-os is multi-context in
practice, but still says `CONTEXT-MAP.md` is deferred. This slice creates the
first root context map and updates only the small pointers that currently depend
on its absence.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Create root `CONTEXT-MAP.md` so agents have a compact map from agent-os domain
areas to the local docs, contracts, and source roots they should read.

This is a map/scaffold slice, not a rewrite of the mapped docs.

## Read First

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/agents/domain.md`
- `docs/design/notes/matt-pocock-context-integration-audit-2026-05-20.md`
- `.docks/AGENTS.md`
- `.docks/foreman/AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `.docks/operator/AGENTS.md`
- `src/AGENTS.md`
- `src/daemon/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/controls/AGENTS.md`
- `packages/toolkit/panel/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `apps/sigil/AGENTS.md`

## Rediscover State

Run from the agent-os repo root:

```bash
git status --short --branch
./aos dev recommend --json
```

This is docs-only. Do not run `./aos ready` unless you discover a need for live
runtime evidence, which is not expected.

## Branch/Base

branch_from: `origin/main`
required_start_ref: `origin/main`

This work card is present on `origin/main` after PR #368 merged. Start from
`origin/main` for this slice. Use `gdi/matt-context-map-v0` as the output
branch if creating a separate GDI branch.

## Required Behavior

Create `CONTEXT-MAP.md` at the repo root. It should be short enough to read at
session start and useful enough to prevent the old single-context inference.

The map should include, at minimum:

- Root/shared vocabulary: `CONTEXT.md`, `ARCHITECTURE.md`, `AGENTS.md`,
  `docs/agents/domain.md`.
- Runtime primitives and CLI/API behavior: `src/`, `shared/`, `src/AGENTS.md`,
  `src/daemon/AGENTS.md`, `docs/api/`, `shared/schemas/`.
- Toolkit/default surface system: `packages/toolkit/` and its local
  `AGENTS.md` files, plus `docs/api/toolkit/`.
- Docks/session operations: `.docks/AGENTS.md`, role-specific dock
  `AGENTS.md` files, and relevant dock skills/scripts.
- Workbench subjects/work records: `packages/toolkit/workbench/`,
  `shared/schemas/aos-workbench-subject.schema.json`,
  `shared/schemas/aos-work-record-v0.schema.json`, and relevant recipes/design
  notes.
- Sigil app behavior: `apps/sigil/AGENTS.md`, `apps/sigil/`, and any live app
  docs discovered during inspection.
- Gateway/host external adapter surfaces: `packages/gateway/`,
  `packages/host/`, relevant `CLAUDE.md` compatibility pointers, and API docs
  if present.
- Durable decisions and SOPs: `docs/adr/`, `docs/decisions/`, and
  `docs/recipes/`.

Update the two pointer surfaces that currently describe `CONTEXT-MAP.md` as
missing:

- `AGENTS.md`
- `docs/agents/domain.md`

After this slice, those pointers should tell agents to read `CONTEXT-MAP.md`
when choosing domain docs, while still preserving the root `CONTEXT.md` as the
shared vocabulary/contract-term index.

## Conflict Handling

Use agent-os local authority over Matt's external templates:

- adopt Matt's map concept where it fits;
- adapt wording and routing to agent-os local contracts;
- reject any pattern that turns Matt's templates into repo authority;
- defer stale-doc repair, ADR namespace cleanup, and SOP design unless a tiny
  pointer update is required by this card.

Do not map generated, cache, or temporary trees such as `.runtime/` and
`.aos-test-tmp/` as durable context domains.

If a live doc conflict prevents a clear map entry, do not solve the conflict in
this slice. Mark it as a follow-up candidate in the completion report.

## Scope

Edit only:

- `CONTEXT-MAP.md`
- `AGENTS.md`
- `docs/agents/domain.md`

Only edit another file if you find a direct typo in this work card that blocks
completion.

## Hard Boundaries

- Do not rewrite `CONTEXT.md`.
- Do not repair stale `say` / target-grammar sibling docs in this slice.
- Do not move or consolidate ADRs or decisions.
- Do not create the context maintenance SOP in this slice.
- Do not change Swift, JavaScript, schemas, tests, fixtures, or runtime
  behavior.
- Do not open or update GitHub issues or PRs.

## Verification

Run:

```bash
git diff --check
rg -n "CONTEXT-MAP.md|CONTEXT.md|docs/agents/domain.md" AGENTS.md docs/agents/domain.md CONTEXT-MAP.md
```

No Swift rebuild and no live AOS smoke are required for this docs-only map
slice.

## Completion Report

Report:

- files changed;
- summary of mapped domains;
- exact verification commands and pass/fail results;
- any defer, stale-local-doc, or authority-conflict items found while mapping;
- whether `CONTEXT.md`, stale sibling-doc repairs, ADR cleanup, SOP work,
  source behavior, schemas, tests, fixtures, GitHub issues, and PRs were
  untouched;
- local-only state or unrelated dirty files.
