@../../../AGENTS.md
@../AGENTS.md

# Scene Toolkit

## Purpose

`scene/` is the narrow package facade for product-neutral scene authoring. It
owns the public contracts for the DesktopWorld stage 3D outlet and currently
exposes declarative scene contracts, implementation registration, atomic scene
transactions, numeric signal and elapsed-clock animation bindings,
dependency-injected local/DesktopWorld hosts, the standalone Three adapter,
the bounded generic Three implementation registry/projector,
bounded renderer lifecycle, canvas lifecycle projections, and visual-object
editing contracts. The public `scene-follow` transport leases owner-scoped
resources onto the daemon-backed singleton DesktopWorld stage without exposing
stage internals.

## Ownership

- Runtime implementations remain owned by `runtime/`.
- Visual-object implementations remain owned by `workbench/`.
- This folder owns only the reviewed external package surface and its types.
- Generic scene transactions, leases, rendering, animation, interaction, and
  resource lifecycle belong here or behind this facade. Product representation,
  persisted definitions, semantic state mappings, visual recipes, and editor UX
  remain in the consuming product.
- The daemon-backed stage projects object transforms in global DesktopWorld
  coordinates through one orthographic camera per physical display segment.
  Every segment applies the same declarative operation, while only the primary
  segment reports its result to avoid duplicate transport acknowledgements.

## Local Contracts

- Export named, dependency-injected primitives only. Do not bundle Three.js or
  expose private toolkit indexes through this facade.
- Keep `index.js`, `index.d.ts`, `package.json` exports, tests, and
  `docs/api/toolkit/scene.md` synchronized.
- Renderer disposal applies only to resources the consumer explicitly gives
  the lifecycle; shared resource ownership remains with the consumer.
- Scene documents never carry implementation code. Only trusted registry
  entries and projection factories may execute, and failed preparation must
  leave the active document and projection unchanged.
- Signal and animation bindings carry finite numeric values only. Text, audio,
  prompts, product state vocabularies, and arbitrary timelines stay outside
  this contract.
- Generic implementation parameter validators fail before projection. The
  stock browser outlet uses the pinned local Three module and performs no
  runtime network fetch; the package facade remains dependency-injected.

## Verification

- `node --test tests/toolkit/desktop-world-surface-three.test.mjs tests/toolkit/scene-document.test.mjs tests/toolkit/scene-host.test.mjs tests/toolkit/scene-public-contract.test.mjs tests/toolkit/three-render-lifecycle.test.mjs tests/toolkit/toolkit-api-docs-contract.test.mjs`

## Child DOX Index
