# Employer Brand Audit Prototype

`index.html` is wired to `scripts/report-data.fixture.js`, a checked-in payload
generated from the local fixture under
`docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/`.

Open the populated fixture report by opening `Employer_Brand_Audit/index.html`
from the repo checkout. The payload is provenance-only fixture data: it preserves
local Browser Evidence screenshot paths, source URLs, request IDs, and caveats,
but it does not browse, collect live evidence, run a workflow, or execute
exports.

Regenerate the checked-in fixture payload from the repo root with:

```sh
node scripts/employer-brand-report-data.mjs
```

`scripts/report-data.template.js` remains the placeholder shape for new report
instances.
