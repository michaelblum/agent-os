# Domain Docs

Agent-os is multi-context in practice. The root `CONTEXT.md` is the current
governed vocabulary and contract-terminology index, not Matt Pocock's pure
single-context glossary shape. It may name live CLI wire forms, schema
boundaries, migration notes, and resolved terminology when those details are
needed to keep agents and implementers aligned.

## Read Order

Before changing behavior or writing plans, read the root `CONTEXT.md` for shared
language, then read `CONTEXT-MAP.md` to choose the domain docs, local contracts,
schemas, and source roots for the subject area you are touching. Use
`ARCHITECTURE.md` for the system narrative, nearby subtree `AGENTS.md` files for
local policy, `docs/api/` and `shared/schemas/` for live contracts, `docs/adr/`
and `docs/decisions/` for durable decisions, and `docs/recipes/` for reusable
operating procedures.

Do not infer that the repo is single-context just because root `CONTEXT.md`
exists. `CONTEXT.md` is the shared vocabulary and contract-term index;
`CONTEXT-MAP.md` is the routing map for the repo's separate domains.
Use `docs/recipes/context-doc-maintenance.md` when a change may require these
context surfaces, API docs, schemas, ADRs, AGENTS files, or recipes to be
updated together.

## Decision Docs

The current consumer reality is split: most ADRs live under `docs/adr/`, and at
least one ADR-named platform decision lives under `docs/decisions/`. This slice
does not resolve that namespace split. Consumers should inspect both locations
when a task touches architecture, toolkit policy, subject/work-record contracts,
or other durable trade-offs.

## Conflicts

When docs disagree, surface the contradiction instead of silently choosing a
source that might be stale. Prefer the current work card, root and local
`AGENTS.md`, live code, schemas, tests, CLI/API behavior, then `docs/api/`,
`shared/schemas/`, `ARCHITECTURE.md`, and `CONTEXT.md`. Treat design notes and
external templates as context unless the active work card makes them
authoritative.
