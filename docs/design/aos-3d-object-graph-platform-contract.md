# AOS 3D Object Graph Platform Contract

**Status:** Accepted

## Purpose

AOS provides renderer-neutral contracts for inspecting and editing object graphs
owned by consumer canvases. The platform does not own product geometry, scene
semantics, materials, animation, or renderer lifecycle.

## Ownership

- The daemon owns canvas lifecycle, transport, input routing, and object-message
  delivery.
- Toolkit owns reusable object descriptors, controls, workbench projections,
  and request/response correlation.
- Each external consumer owns its object graph, renderer synchronization,
  persistence, and product actions.

## Contract

An addressable object uses `canvas_id + object_id`. A consumer may publish a
full `canvas_object.registry` snapshot and accept bounded transform, visibility,
and effect patches through the schemas documented under `shared/schemas/` and
`docs/api/toolkit/`.

Object identities must remain stable across projections. Workbench facets and
controls describe existing objects; they do not create product canvases or
infer product policy. Unknown objects, fields, or operations fail closed at the
owning consumer.

## Limits

- AOS does not generalize one consumer's scene graph into a platform model.
- Toolkit helpers do not import consumer source or private renderer modules.
- Native code does not gain product-named object branches.
- Live product acceptance belongs in the consumer repository. AOS proves only
  generic schemas, routing, and toolkit behavior with neutral fixtures.
