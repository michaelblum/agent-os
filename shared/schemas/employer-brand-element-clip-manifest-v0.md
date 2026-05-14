# Employer Brand Element Clip Manifest v0

Manifest shape for Employer Brand element clips.

The manifest maps each clip slot to a target ID, work-unit ID, company ref when
applicable, source artifact, capture type, nullable clip path, nullable text
extract path/content slot, citation refs, KILOS relevance, acceptance result,
and provenance/non-goal flags.

V0 supports both the planned-only skeleton and the first controlled local SPv5
capture slice. The populated slice may contain actual local element clips for
`source:spv5-html` work units whose readiness state is `locator_ready`, while
PDF, PPTX, and unresolved-selector work units remain as blocked planned slots.
Remote web collection, PDF/PPTX capture execution, report rendering, exports,
workflow execution, and full-page grabs remain out of scope.

Fixtures:

`docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/source-artifacts/element-clip-manifest.planned.json`

`docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/source-artifacts/element-clip-manifest.json`

Generators:

`node scripts/employer-brand-element-capture-planning-bundle.mjs`

`node scripts/employer-brand-local-spv5-element-capture.mjs`
