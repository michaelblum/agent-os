@../../../AGENTS.md
@../AGENTS.md

# Scene Toolkit

## Purpose

`scene/` is the narrow package facade for product-neutral scene authoring. It
exposes the DesktopWorld Three adapter, bounded Three renderer lifecycle,
canvas lifecycle projections, and visual-object editing contracts needed by
external consumers.

## Ownership

- Runtime implementations remain owned by `runtime/`.
- Visual-object implementations remain owned by `workbench/`.
- This folder owns only the reviewed external package surface and its types.
- Product representation, scene state, materials, animation policy, and editor
  UX remain in the consuming product.

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
