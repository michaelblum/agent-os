# Employer Brand Source Artifact Data Bundle v0

Status: read-only source-artifact data bundle schema for Employer Brand target
planning.

This contract groups local source artifacts with a hand-authored source artifact
target plan before any report renderer or export work starts. It is the data
bundle boundary: source files, source metadata, target plan path, expected target
count, expected clip count, and controls that keep later report artifacts out of
scope.

The bundle may reference slide decks, rendered PDFs, and SPA prototypes. It does
not make those references capture evidence by themselves; capture evidence still
belongs in a later Browser Evidence registry or equivalent evidence contract.

## Pilot Fixture Location

```text
docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/source-artifacts/data-bundle.json
```
