# Employer Brand Source Artifact Target Plan v0

Status: hand-authored source-artifact target planning schema for Employer Brand
data bundles.

This contract makes natural-language capture targets first-class before
automation exists. A target plan names exact page elements in a source artifact,
the expected number of element clips, acceptance criteria, KILOS relevance, and
the intended capture type.

V0 is deliberately pre-automation. `selector`, `xpath`, `playwright_locator`,
and `codegen_hint` are required to be `null` placeholders so later locator work
has a stable place to land without pretending selectors already exist.

## Non-Goals

The plan is not a Browser Evidence registry and is not a report artifact. It
does not authorize full-page grabs, remote web collection, autonomous browsing,
report rendering, export execution, replay, repair, macro playback, or workflow
execution.

Every capture target must be an element-level target. If a source artifact is a
deck or PDF, the target may reference a slide or page region, but the acceptance
criteria must describe the element or region to clip rather than the whole page.

## Pilot Fixture Location

The first concrete target plan lives inside the Employer Brand source artifact
fixture bundle:

```text
docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/source-artifacts/target-plan.json
```

The corresponding data bundle is:

```text
docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/source-artifacts/data-bundle.json
```
