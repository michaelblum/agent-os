# AOS Design Docs

Provider-neutral home for active AOS design artifacts.

Use this tree for design work that needs to outlive a session but is not yet a
consumer-facing contract, executable recipe, schema, or runtime wiki page.

## Structure

Create subdirectories as needed:

- `plans/` for implementation sequencing and workstream plans.
- `specs/` for proposed or accepted design specs before they are promoted into
  API docs, schemas, architecture, recipes, or source.
- `notes/` for focused design notes and decision sketches.
- `artifacts/` for supporting design fixtures or demonstrations.

## Relationship To Durable Contracts

Design docs can explain intent, tradeoffs, rejected alternatives, and sequencing.
They are not the final source of truth for shipped behavior.

Promote stable decisions into the appropriate durable home:

- `ARCHITECTURE.md` for current system architecture.
- `docs/api/` or `shared/schemas/` for cross-tool contracts.
- `docs/recipes/` for repeatable operating procedures.
- `wiki-seed/` for source-controlled agent-operable knowledge.
- GitHub issues and PRs for unresolved work, chronology, and execution evidence.

## Legacy Superpowers Archive

`docs/superpowers/` contains historical design material created under the
Superpowers workflow. Keep it in place for links, rationale, and chronology, but
do not treat it as a required orchestration layer for new AOS work.

New provider-neutral AOS plans, specs, notes, and design artifacts should start
under `docs/design/` unless there is a specific reason to continue an existing
legacy thread in `docs/superpowers/`.
