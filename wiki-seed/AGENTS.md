@../AGENTS.md

# Wiki Seed

## Purpose

`wiki-seed/` contains seed wiki content loaded into AOS wiki namespaces.

## Ownership

- Seed content should reflect durable starting knowledge, not transient session
  notes.
- Wiki tooling lives in `scripts/aos-wiki-*`.
- Wiki schemas and contracts belong in `shared/schemas/` or docs.

## Local Contracts

- Keep namespaces, plugin ids, and seeded paths stable unless a migration updates
  callers and docs.
- Do not put private runtime state or machine-local paths in seed content.

## Work Guidance

## Verification

- Run the relevant `./aos wiki` seed or lint command when changing seed shape.

## Child DOX Index

- `concepts/` contains concept seeds.
- `entities/` contains entity seeds.
- `plugins/` contains plugin seeds.
