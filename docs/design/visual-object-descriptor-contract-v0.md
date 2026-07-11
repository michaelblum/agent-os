# Visual Object Descriptor Contract V0

**Status:** Accepted

## Purpose

`aos.visual_object.descriptor.v0` describes editable and projection-only visual
controls across renderer, canvas-style, and DOM/toolkit surfaces without moving
consumer rendering policy into AOS.

## Owners

- `packages/toolkit/workbench/visual-object-contract.js` owns descriptor
  creation, validation, coercion, and state-path mutation.
- `packages/toolkit/workbench/visual-object-controller.js` owns routed update
  events and ordered renderer-sync callbacks.
- `packages/toolkit/workbench/visual-object-form-binding.js` owns form binding.
- `packages/toolkit/workbench/visual-object-resource-lifecycle.js` owns
  renderer-neutral lifecycle evidence.
- External consumers own renderer state, persistence, geometry, materials,
  effects, and product actions.

## Descriptor Rules

A descriptor has a stable id, value type, state path, bounds or choices where
applicable, and explicit update semantics. Projection-only controls do not claim
canonical model ownership. Updates validate and coerce before invoking the
consumer-provided route and renderer-sync callbacks.

Resource lifecycle evidence may report retained, replaced, temporary, disposed,
identity, serialization, proof-window, and cleanup outcomes. It does not absorb
annotation sessions, context recordings, snapshots, or Work Record ownership.

## Boundaries

- Toolkit does not import consumer renderer modules.
- The daemon does not own visual-object values or renderer synchronization.
- Consumer adapters live with their product, not in AOS toolkit.
- AOS tests use neutral descriptors and fake renderer callbacks. Product visual
  acceptance belongs in the consumer repository.
