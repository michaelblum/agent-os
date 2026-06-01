# Visual Object Descriptor Contract

**Status:** Accepted
**Date:** 2026-05-31

## Decision

AOS uses `aos.visual_object.descriptor.v0` as the reusable descriptor contract
for editable and projection-only visual object controls across Three.js, canvas
style, and DOM/toolkit surfaces. Descriptor updates use caller-owned route and
renderer sync handlers through toolkit workbench helpers rather than moving app
rendering behavior into the daemon or toolkit.

The reusable implementation surface is:

- `packages/toolkit/workbench/visual-object-contract.js` for descriptor
  creation, validation, coercion, and state-path mutation.
- `packages/toolkit/workbench/visual-object-controller.js` for routed
  descriptor update events and ordered renderer sync handling.
- `packages/toolkit/workbench/visual-object-form-binding.js` for form-field to
  descriptor binding.
- `packages/toolkit/workbench/visual-object-resource-lifecycle.js` for
  renderer-agnostic update/resource evidence under
  `aos.visual_object.resource_lifecycle.v0`.

Sigil remains the reference implementation and app owner for avatar and radial
product behavior. Toolkit owns the reusable descriptor/controller/form/evidence
contracts. The daemon owns native canvas and routing primitives, not Three.js
objects, Sigil avatar state, or app-specific rendering policy.

## Retained Limits

The accepted Phase 6 closure is representative, not universal:

- Primary positive-factor non-tesseron stellation uses a renderer-local
  Three.js morph-target path after topology-stable setup.
- Factor-zero stellation remains on retained CPU buffer mutation because the
  current generated geometry does not share vertex, face, or edge topology
  between zero and positive factors.
- Primary tesseron proportion has in-place child/link geometry update proof;
  omega tesseron optimization remains future work unless profiling makes it
  hot.
- Material and geometry pooling remain renderer-local. The toolkit lifecycle
  contract records retained, replacement, temporary, disposed, identity,
  serialization, proof-window, and cleanup evidence without owning GPU pools.
- Observe-mode snapshots remain on the annotation/context-session contract.
  Visual-object lifecycle evidence must not absorb `snapshot_count`, session
  roots, anchors, comments, keyframe assets, or bundle ownership.
- Broad live proof for every visual surface, profiler-backed leak proof, and
  topology-stable zero-to-positive stellation are separate future tracks.

## Consequences

- Current docs and work cards should cite
  `docs/design/visual-object-descriptor-contract-v0.md` for descriptor fields,
  projection-only rules, form binding, resource lifecycle terms, retained
  limits, and observe/snapshot boundaries.
- `docs/dev/reports/aos-visual-object-architecture.md` remains the accepted
  architecture/status report, but historical problem and migration sections
  must be read as context rather than open implementation instructions.
- Older object-graph notes can continue to guide subject boundary thinking, but
  they must not override the accepted descriptor/controller/resource-lifecycle
  contract or imply that every avatar edit still routes through a full geometry
  rebuild.
- Future slices should extend the existing descriptor and lifecycle contracts
  only when a real surface needs the added field or evidence term.
