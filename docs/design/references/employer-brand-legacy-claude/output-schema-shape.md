# Legacy Output Schema Shape

Status: non-canonical reference excerpt

The old reference assumed a report template that consumed two top-level bindings:

```js
const client = {};
const competitors = [];
```

For the current AOS workflow, this shape is useful as a reference for company-profile fields and local-path provenance, but it should not be treated as the final schema.

## Company Profile Shape

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "companyName": "Sanofi",
  "auditDate": "2025-08-04",
  "companyLogo": {
    "localPath": "artifacts/sanofi_careers_home_cap_001_elem_company_logo.png",
    "description": "Screenshot of Sanofi's logo on a careers page.",
    "sourceURL": "https://www.sanofi.us/en/careers"
  },
  "companyEvidence": {
    "glassdoor.com": {
      "sourceDomain": "glassdoor.com",
      "images": [],
      "textualEvidence": []
    }
  },
  "analysis": {
    "scientificTalentValueProposition": {},
    "kilosFrameworkAnalysis": {},
    "brandVoiceAnalysis": {},
    "employeeSentimentAnalysis": {}
  }
}
```

## Evidence Pool

The reference grouped raw evidence by source domain. Each domain contained:

- `images[]`: screenshot assets.
- `textualEvidence[]`: quotes, metrics, headlines, and excerpts.

Evidence item types:

- `data_metric`
- `testimonial_quote`
- `messaging_excerpt`
- `headline`

## Analysis Blocks

The old output shape used:

- persona-scoped talent value proposition, such as `scientificTalentValueProposition` or `employerValueProposition`,
- `kilosFrameworkAnalysis` with exactly `Kinship`, `Impact`, `Lifestyle`, `Opportunity`, `Status`,
- `brandVoiceAnalysis`,
- `employeeSentimentAnalysis`.

## Tone Anchors

The legacy brand voice analysis used four fixed tone anchors:

- `Funny ↔ Serious`
- `Casual ↔ Formal`
- `Irreverent ↔ Respectful`
- `Emotional ↔ Matter-of-fact`

Ratings were 1 to 5, where 1 was strongly the left pole, 5 was strongly the right pole, and 3 was balanced.

## Provenance Rules Worth Keeping

- Every `localPath` and `supportingLocalPath` must resolve to a real file in the artifact bundle.
- Analysis may only cite evidence already raised into the same company's evidence pool.
- Quotes remain verbatim.
- Review metrics preserve the source's label and formatting.
- Missing or blocked evidence leaves arrays empty rather than being synthesized.
- KILOS keys stay in the order `Kinship`, `Impact`, `Lifestyle`, `Opportunity`, `Status`.
- Dates use ISO 8601.
