# Legacy Employer Brand Competitor Audit Reference

Status: non-canonical reference material

Date captured: 2026-05-07

Source: user-pasted older Claude Code material for a KILOS competitor audit skill.

This folder preserves useful prior thinking about Employer Brand Competitor Audit workflows. It is not a spec to adopt directly. Treat it as reference material to mine for patterns while the active workflow evolves in [employer-brand-comparative-audit-workflow.md](../../employer-brand-comparative-audit-workflow.md).

## Useful Signals

- The old shape separated planning, collection, analysis, and resume modes.
- The capture manifest used stable `request_id` values as lifecycle anchors.
- The executor was deliberately narrow: read manifest, visit pages, write artifacts, annotate what happened.
- Element-level crops were first-class artifacts, especially for hero/EVP blocks and review-site rating widgets.
- Selector fallbacks and replay hints were recorded after execution, not guessed as durable truth up front.
- Analysis consumed local artifact bundles only; it did not browse the web.
- Final output required every cited `localPath` to resolve to a real file in the local artifact bundle.
- KILOS color cues and brand archetype labels are useful presentation/analysis addenda, but not core workflow requirements.

## Captured Files

- [skill-shape.md](skill-shape.md): legacy mode split, manifest shape, request/artifact vocabulary, and source surface plan.
- [capture-executor-shape.md](capture-executor-shape.md): legacy Playwright/Puppeteer executor behavior and artifact naming.
- [kilos-addenda.md](kilos-addenda.md): KILOS colors, expanded sub-themes, and optional brand archetypes.
- [output-schema-shape.md](output-schema-shape.md): legacy report-data shape and local-path provenance rules.
