# Employer Brand Live Evidence Element Clip Manifest V0

This manifest records the first supervised live element capture slice for the
Employer Brand comparative audit fixtures.

V0 is intentionally narrow:

- It is gated by `execute-reviewed-live-element-capture-v0`.
- It executes only the reviewed locator-ready units from
  `live-evidence-reviewed-locator-capture-plan.json`.
- It opens only approved original/final URLs already present in the plan.
- It uses only reviewed CSS selector, XPath, or reviewed Playwright locator
  values from the plan.
- It stores element-only clips and required text extracts under
  `source-artifacts/live-evidence-*`.
- It preserves non-executable plan context as blocked/not-run entries.

The manifest also carries verifier metadata for count reconciliation,
`full_page_grab=false`, target/work-unit linkage, locator provenance, KILOS and
citation metadata, and text extract presence for text-bearing capture types. It
does not authorize report rendering, exports, workflow automation, locator
codegen, autonomous crawling, full-page screenshots, or bypasses.

## Objective Verification

Use `node scripts/employer-brand-live-evidence-element-clip-verify.mjs --json`
to check the current manifest against the supervised live capture objective. The
verifier is read-only: it reads the manifest and referenced local assets only,
and does not browse, capture, resolve locators, render reports, export files, or
run workflow automation.

A completed V0 slice must have 4 executable units, 5 planned output slots, 5
captured slots, 0 failed slots, 14 blocked/not-run non-executable contexts,
`full_page_grab=false` for every entry, required text extracts present, count
reconciliation passed, and `status` other than `not_accepted`.

The checked-in live run may remain schema-valid while still being objective
incomplete. In that case the verifier exits nonzero and reports diagnostics such
as `captured_slot_count_incomplete`, `failed_slots_present`,
`required_text_extracts_missing`, `count_reconciliation_failed`, and
`manifest_not_accepted`.
