# Employer Brand Human Alignment Pack With Mermaid Preview V0

## Context

The Employer Brand pilot has strong evidence control-plane artifacts, but the
requirements and audit intent still need a more direct human-facing alignment
pass. The system has been grinding through capture mechanics as if the target
requirements are fully known. They are not.

The visibility repair promotion path has now completed:

- `live-evidence-visibility-adjusted-capture-plan.json` exists.
- Exactly 4 Operator-approved visibility repairs were promoted into executable
  slots.
- LinkedIn is preserved as source-unavailable context, plus the 14 other
  non-executable context entries.
- Accepted captures and actual clip/text assets remain 0.
- Planned paths remain null.
- `full_page_grab=false` remains invariant.
- The repaired capture CLI default now points at the visibility-adjusted plan.

Treat that as current capture-path state. Do not continue into the next capture
retry in this slice.

This slice should do two things together:

1. Add practical Mermaid rendering support to the shared Markdown preview path.
2. Produce an Employer Brand Audit Human Alignment Pack V0 as a readable
   Markdown/HTML-facing brief for the human to approve or correct.

Do this as one GDI slice. Keep it deterministic and do not resume live capture.

## Inputs

Inspect or consume, at minimum:

- `packages/toolkit/markdown/render.js`
- `packages/toolkit/markdown/preview.css`
- `packages/toolkit/components/markdown-workbench/model.js`
- `packages/toolkit/components/markdown-workbench/index.js`
- `packages/toolkit/components/artifact-bundle-workbench/index.js`
- `docs/api/toolkit.md`
- `tests/toolkit/markdown-render.test.mjs`
- `tests/toolkit/markdown-workbench-model.test.mjs`
- `/Users/Michael/Code/tmp/md_plus_charts.html` as a reference demo for the
  Markdown + Mermaid user experience. Treat it as reference material, not a
  source file to copy wholesale.
- current Employer Brand fixtures under
  `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/`
- current evidence workflow/block trackers:
  - `docs/design/evidence-workflow-block-abstraction-tracker.md`
  - `docs/design/surface-annotation-intent-convergence-tracker.md`

## Deliverables

### Mermaid Preview Support

- Update the shared Markdown renderer so fenced Mermaid blocks render as
  diagram containers instead of plain paragraphs or invisible text.
- Keep Markdown rendering safe. Do not allow unsafe HTML/script injection from
  Markdown source.
- Borrow the useful implementation ideas from
  `/Users/Michael/Code/tmp/md_plus_charts.html` where they fit the repo:
  - intercept Mermaid fenced code blocks before generic Markdown rendering,
  - store Mermaid source out-of-band on a safe diagram container,
  - render diagrams asynchronously after sanitized Markdown HTML is inserted,
  - show a durable syntax/runtime error block when Mermaid rendering fails,
  - keep diagram SVG constrained to the preview width.
- Do not borrow the demo's CDN/runtime assumptions directly. The repo should
  not depend on Tailwind CDN, FontAwesome CDN, global `marked`, global
  DOMPurify, or global Mermaid unless that dependency path is made explicit and
  deterministic for AOS surfaces.
- Prefer a deterministic repo-local implementation path. If a real Mermaid
  runtime dependency is not already available, implement a narrow, safe
  preview strategy that preserves Mermaid source in a styled diagram container
  and clearly marks it as renderable/diagram content, without adding a brittle
  external dependency.
- Update Markdown Workbench diagnostics/status so Mermaid blocks are still
  detected and now described as previewable/rendered according to the chosen
  implementation.
- Ensure Artifact Bundle Markdown preview benefits from the shared renderer.
- Update `docs/api/toolkit.md` to replace the stale statement that Mermaid
  fences are detected but not rendered.
- Add focused tests for:
  - Mermaid fenced blocks render through `renderMarkdown`.
  - Unsafe content inside Mermaid fences is escaped or otherwise made safe.
  - Existing Markdown rendering/link safety still passes.
  - Markdown diagnostics still detects Mermaid fences.

### Human Alignment Pack

- Add a readable Employer Brand Audit Human Alignment Pack V0 under the
  Employer Brand fixture tree, preferably:
  - `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/human-alignment-pack.md`
- If useful, add a narrow static HTML preview artifact that uses the shared
  Markdown renderer output, but do not build a report renderer.
- Include a Mermaid flowchart plus a plain Markdown fallback table showing:
  - companies,
  - evidence sources,
  - KILOS dimensions,
  - comparisons,
  - findings,
  - report direction.
- Include sections for:
  - current assumptions,
  - evidence requirements brief,
  - companies and competitor set,
  - source categories and page types,
  - desired evidence elements and expected clip counts,
  - what not to collect,
  - KILOS interpretation,
  - source trust and inaccessible-source policy,
  - visual evidence quality criteria,
  - report tone/direction,
  - explicit decision points for the human to approve, edit, or reject.
- Keep it as an alignment artifact, not final analysis and not report output.
- Wire the alignment pack as read-only planning/alignment provenance into
  `data-bundle.json`, `sources.json`, and `subject.json` if those artifacts
  already expose similar provenance surfaces.

## Required Behavior

- The Mermaid support must be shared by Markdown Workbench and Artifact Bundle
  preview because both use `renderMarkdown`.
- The alignment pack must be useful even if Mermaid rendering is unavailable,
  via a Markdown table/fallback immediately near the diagram.
- The alignment pack should expose open questions rather than fabricate user
  intent.
- The brief should make explicit where Foreman/GDI/Operator need human
  judgment before more capture work.
- Preserve the current Employer Brand capture state. Do not modify capture
  manifests, repair patches, locator plans, or live evidence results except for
  read-only provenance links if needed.

## Hard Boundaries

- Do not run live capture.
- Do not open live target URLs.
- Do not run locator resolution/codegen.
- Do not continue the visibility repair promotion/capture path in this slice.
- Do not build a report renderer, PDF/DOCX export, HTML/CSS polish pass,
  workflow engine, or final audit report.
- Do not infer final audit findings beyond clearly labeled current assumptions
  and open questions.
- Do not implement the Surface Annotation Intent Convergence foundation; only
  reference it as future direction if useful.

## Verification

Verification should include:

- Focused Markdown renderer tests pass.
- Markdown Workbench model tests pass.
- Artifact Bundle preview tests pass if affected.
- Employer Brand comparative data bundle/artifact bundle tests pass if
  provenance is wired.
- `git diff --check` passes for touched files.
- The human alignment pack exists and contains:
  - one Mermaid flow,
  - one fallback table,
  - KILOS interpretation prompts,
  - explicit human decision points,
  - clear non-goals/no-capture boundary.
