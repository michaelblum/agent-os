# API Docs

Consumer-facing reference for the public surfaces in this repo.

These docs are for both:

- humans integrating with `aos` or `packages/toolkit`
- agents making or reviewing consumer-facing changes

## Scope

This directory documents the interfaces consumers are expected to build against:

- [`aos.md`](./aos.md) — the unified `aos` CLI contract
- [`aos-taxonomy.md`](./aos-taxonomy.md) — classification rules for AOS artifact types and their source-of-truth
  homes
- [`integration-broker.md`](./integration-broker.md) — provider-neutral chat integration broker and snapshot API
- [`steerable-collection.md`](./steerable-collection.md) — browser-only V0 steerable collection schemas and source-pack contract
- [`target-probe.md`](./target-probe.md) — structured target-acquisition packet used by `aos see target`, inspect, and intent projections
- [`toolkit.md`](./toolkit.md) — the toolkit runtime and panel APIs for WKWebView surfaces
- [`../reference/aos-dev-workflow-rules.json`](../reference/aos-dev-workflow-rules.json) — schema-backed seed manifest for AOS developer workflow classification and recommendation

It does **not** try to replace:

- [ARCHITECTURE.md](../../ARCHITECTURE.md) for system design and ecosystem context
- `docs/design/` for provider-neutral plans, specs, notes, and internal design work
- `docs/superpowers/` for legacy Superpowers-origin design history
- source comments for implementation details

## Maintenance Contract

If a change affects a consumer-facing interface, update these docs in the same change.

That includes:

- adding, removing, or renaming top-level `aos` commands or notable subcommands
- changing the JSON success/error contract
- changing toolkit import paths or exported functions
- changing the `Content` / `Manifest` / `ContentHost` contract
- changing the styling boundary between toolkit primitives and consumers
- changing discoverable config surfaces or notable config subtrees such as
  `see.canvas_inspector_bundle.*`

If a surface is experimental, label it explicitly here instead of leaving consumers to infer stability from source.
