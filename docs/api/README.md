# API Docs

Consumer-facing reference for the public surfaces in this repo.

> **Milestone 0 authority pointer — `aos-sovereign-capability-substrate-v1`:**
> entries below remain current executable API scope. ADR 0043 and
> `../dev/aos-sovereign-capability-authority-v1.json` own the future complete
> managed-tool grammar and classify fixed session operations as burn-down
> baseline; this pointer adds no command.

These docs are for both:

- humans integrating with `aos` or `packages/toolkit`
- agents making or reviewing consumer-facing changes

## Scope

This directory documents the interfaces consumers are expected to build against:

- [`aos.md`](./aos.md) — the unified `aos` CLI contract
- [`aos browser companion`](./aos.md#managed-playwright-companion-lifecycle) —
  source-pinned Playwright CLI runtime status, install, update, and uninstall
- [managed browser sessions](./aos.md#managed-browser-sessions) — generation-
  bound focus lifecycle, fixed session operations, ownership, and cleanup
- [`aos-capabilities.md`](./aos-capabilities.md) — the desktop-agent
  capability map for AOS as "Playwright CLI, but for the desktop"
  (`docs/api/aos-capabilities.md`)
- [`toolkit.md`](./toolkit.md) — the toolkit API map for WKWebView surfaces, with scoped runtime, panel/window, workbench, component, and content-host references under [`toolkit/`](./toolkit/)

It does **not** try to replace:

- [ARCHITECTURE.md](../../ARCHITECTURE.md) for system design and ecosystem context
- `docs/design/` for provider-neutral plans, specs, and design notes
- `docs/guides/` for reusable operating procedures
- `docs/archive/superpowers/` for historical Superpowers plans and specs
- source comments for implementation details

## Maintenance Contract

If a change affects a consumer-facing interface, update these docs in the same change.

That includes:

- adding, removing, or renaming top-level `aos` commands or notable subcommands
- changing command forms, usage strings, flags, examples, side-effect metadata,
  or consumer discovery; edit `manifests/commands/source/`, regenerate with
  `scripts/generate-command-manifests.mjs`, and run
  `tests/command-manifest-generation.sh`, `tests/help-contract.sh`, and the
  relevant dispatch/parser drift test
- changing the JSON success/error contract
- changing toolkit import paths or exported functions
- changing the `Content` / `Manifest` / `ContentHost` contract
- changing the styling boundary between toolkit primitives and consumers
- changing discoverable config surfaces or notable config subtrees such as
  `see.canvas_inspector_bundle.*`
- changing public artifact schemas such as
  `surface_inspector_annotation_snapshot`

If a surface is experimental, label it explicitly here instead of leaving consumers to infer stability from source.
