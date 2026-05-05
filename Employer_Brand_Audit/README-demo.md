# Employer Brand Audit Demo Runner

This is a narrow boss-demo harness for an automated Employer Brand Audit pass.
It proves the loop without claiming final strategic analysis quality.

Run:

```sh
node Employer_Brand_Audit/scripts/employer-brand-demo.mjs
open Employer_Brand_Audit/demo.html
```

The runner:

1. opens the configured public source URLs with Playwright,
2. captures visible text, HTML, and screenshots,
3. writes artifacts under `Employer_Brand_Audit/artifacts/demo/latest/`,
4. generates `Employer_Brand_Audit/scripts/report-data.generated.js`, and
5. renders the report through `Employer_Brand_Audit/demo.html`.

The current default run compares Symphony Talent, Phenom, and Radancy using
public homepage sources. It intentionally uses lightweight keyword-based KILOS
classification so the demo is explainable and fast. A production workflow should
add richer source manifests, retry/repair, human review gates, and stronger
analysis before a client-facing deliverable.
