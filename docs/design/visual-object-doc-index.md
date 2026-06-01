# Visual Object Documentation Index

Use this index when search results mix current visual-object guidance with old
work cards or archived Sigil plans.

## Current Authority

- `docs/adr/0014-visual-object-descriptor-contract.md` records the accepted
  descriptor/resource-lifecycle decision and retained limits.
- `docs/design/visual-object-descriptor-contract-v0.md` defines
  `aos.visual_object.descriptor.v0`,
  `aos.visual_object.resource_lifecycle.v0`, descriptor fields, controller and
  form-binding loops, resource-lifecycle evidence, and observe/snapshot
  boundaries.
- `docs/dev/reports/aos-visual-object-architecture.md` is the accepted
  architecture and status report for the Phase 5/6 visual-object workstream.
- `docs/design/aos-3d-object-graph-platform-contract.md` remains useful for
  3D subject boundaries, but its avatar inventory predates the accepted
  descriptor loop. Read it through the current contract docs above.

## How To Read Older Search Hits

- Old Phase 2 and Phase 3 Sigil avatar work cards are closed delivery slices.
  They can explain why `state.avatar.*`, no-full-rebuild stellation, and
  descriptor coverage exist, but they are not current implementation prompts.
- Old Phase 5 work cards are closed validation and adoption slices. Current
  guidance is the accepted descriptor/controller/form-binding contract.
- Old Phase 6 work cards are closed or superseded by the Phase 6 closure. Do
  not treat "remaining Phase 6" language as active scope. The retained limits
  are future tracks: profiler-backed leak proof, topology-stable zero-factor
  stellation, broad pooling or live proof, omega tesseron optimization, and
  observe/snapshot product integration.
- `docs/archive/superpowers/**` is pre-closure planning history. It may still
  mention legacy Sigil state, full geometry rebuilds, or standalone avatar
  plans. Use it as historical context only.
- Live helper names such as `createStellatedGeometry()` are implementation
  details. Their presence does not imply current guidance requires full
  geometry rebuilds for descriptor edits.

## Current Retained Limits

- Primary positive-factor non-tesseron stellation uses renderer-local Three.js
  morph targets after topology-stable setup.
- Factor-zero stellation remains on retained CPU buffer mutation because zero
  and positive stellation do not currently share topology.
- Material and geometry pooling remain renderer-local unless a future
  profiler-backed track proves shared pooling is needed.
- Visual-object lifecycle evidence does not own observe-mode sessions,
  snapshot counts, annotation anchors, keyframe assets, or context-session
  storage.
