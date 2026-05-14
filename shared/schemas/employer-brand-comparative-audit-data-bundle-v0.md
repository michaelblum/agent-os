# Employer Brand Comparative Audit Data Bundle V0

`employer-brand-comparative-audit-data-bundle-v0.schema.json` describes the
normalized, read-only data bundle that sits between Employer Brand fixture
inputs and any report artifact.

The bundle consumes project intake, live evidence target-plan metadata, live
evidence target review-pack metadata, source-artifact target-plan metadata,
Element Capture planning and local clip-manifest metadata, Browser Evidence
registry rows, Company Brand Audit fixtures, Comparative Brand Audit fixtures,
KILOS dimensions, citations, coverage summaries, optional human-alignment pack
provenance, and non-goal controls. It is
explicitly arbitrary-n-company: the schema requires at least two companies and
stores the company count as data rather than baking in the current Symphony
Talent, Phenom, and Radancy fixture.

## Non-Goals

This schema does not authorize report rendering, HTML/CSS polish, PDF or DOCX
export, live collection, remote web collection, locator/codegen execution,
PDF/PPTX capture execution, workflow execution, or full-page grabs. Those
controls must remain false in V0 bundles.
