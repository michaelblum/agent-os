@../../../AGENTS.md
@../AGENTS.md

# Scene Toolkit

## Purpose

`scene/` is the narrow package facade for product-neutral scene authoring. It
owns the public contracts for the DesktopWorld stage 3D outlet and currently
exposes declarative scene contracts, the standalone Three adapter, bounded
renderer lifecycle, canvas lifecycle projections, and visual-object editing
contracts needed by external consumers. Do not describe the shared 3D host as
operational until its daemon and toolkit runtime slices exist.

## Ownership

- Runtime implementations remain owned by `runtime/`.
- Visual-object implementations remain owned by `workbench/`.
- This folder owns only the reviewed external package surface and its types.
- Generic scene transactions, leases, rendering, animation, interaction, and
  resource lifecycle belong here or behind this facade. Product representation,
  persisted definitions, semantic state mappings, visual recipes, and editor UX
  remain in the consuming product.

## Local Contracts

- Export named, dependency-injected primitives only. Do not bundle Three.js or
  expose private toolkit indexes through this facade.
- Keep `index.js`, `index.d.ts`, `package.json` exports, tests, and
  `docs/api/toolkit/scene.md` synchronized.
- Renderer disposal applies only to resources the consumer explicitly gives
  the lifecycle; shared resource ownership remains with the consumer.

## Verification

- `node --test tests/toolkit/desktop-world-surface-three.test.mjs tests/toolkit/scene-public-contract.test.mjs tests/toolkit/three-render-lifecycle.test.mjs tests/toolkit/toolkit-api-docs-contract.test.mjs`

## Child DOX Index
