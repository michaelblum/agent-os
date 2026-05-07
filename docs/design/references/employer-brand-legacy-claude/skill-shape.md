# Legacy Skill Shape

Status: non-canonical reference excerpt

The older Claude Code skill described an `Employer Brand Competitor Audit — KILOS Framework` with three modes:

| Mode | Purpose |
| --- | --- |
| Manifest | User provides client and competitor list; skill produces a complete master manifest. It does not browse or collect. |
| Analysis | User provides refined manifest plus artifact bundle; skill produces report-ready company profiles. It does not browse. |
| Resume | User provides partially complete output; skill identifies complete and missing sections and continues. |

## Manifest Planning Pattern

The manifest was treated as the stable identity document for the audit. Request IDs assigned in the manifest persisted through collection, analysis, and reruns.

Recommended top-level shape:

```yaml
audit_manifest:
  audit_id: "[client_slug]_[YYYY_MM_DD]"
  client: "[Client Name]"
  competitors: [CompanyA, CompanyB]
  regions: [Global]
  generated_at: "[YYYY-MM-DD]"
  status: draft
  executor:
    kind: playwright
    default_viewport: { width: 1440, height: 900 }
    default_user_agent: null
    default_wait_strategy: "networkidle"
  requests: []
```

## Capture Request Shape

Each request described one source surface for one company:

```yaml
- request_id: acme_careers_home
  entity: "Acme"
  entity_slug: "acme"
  url: "https://example.com/careers"
  area: "careers_website"
  why: "Why this capture matters to the KILOS audit."
  requested_artifacts: []
  executor_plan:
    command: "navigate"
    pre_navigation:
      set_cookies: []
      block_resource_types: []
    post_navigation:
      wait_for_selector: null
      wait_for_network_idle_ms: 500
      scroll_full_page: true
      dismiss_selectors:
        - "#onetrust-accept-btn-handler"
        - "[aria-label='Close']"
    instruction: null
    replay_hints: null
  capture_result:
    status: pending
    notes: null
    selector_resolution: null
  priority: high
  execution_batch: 1
  depends_on: null
```

Legacy status vocabulary: `pending | in_progress | collected | partial | blocked`.

## Artifact Types

The old skill recognized five capture artifact types:

- `page_text`: full scraped body text.
- `page_source`: raw HTML.
- `full_page_screenshot`: scroll-stitched page image.
- `element_screenshot`: crop of a specific DOM element.
- `viewport_clip`: visible viewport or clipped region after a scroll instruction.

Element screenshots used:

```yaml
- type: element_screenshot
  label: "glassdoor_overall_ratings"
  description: "Glassdoor overall rating block with category ratings"
  selector_primary: "[data-test='employerOverallRating']"
  selector_fallbacks:
    - "[data-test='employer-overall-rating']"
    - ".employerRatings"
    - "section:has(h2:has-text('Ratings'))"
  bbox_fallback: null
  padding_px: 16
  scroll_into_view: true
  wait_for_visible: true
  format: png
  required: false
```

The selector guidance preferred stable attributes first: `data-test`, `data-testid`, `data-qa`, `id`, then ARIA attributes. Deep class chains were discouraged. `bbox_fallback` was treated as a last resort.

## Source Surface Plan

The legacy source plan covered each company symmetrically when possible:

- careers homepage,
- why-join / EVP section,
- SSC or hub-specific page when relevant,
- LinkedIn company page and recent posts,
- X/Twitter profile when relevant,
- Glassdoor employer profile,
- Indeed employer profile,
- awards and employer recognition search,
- additional careers blogs, diversity microsites, or campaign hubs when relevant.

For review sites, rating widgets were treated as high-value crops:

- overall rating block,
- category ratings,
- recommend / CEO approval where available,
- pros module,
- cons module,
- review highlights.

## Planning Rules Worth Keeping

- Generate the full manifest across all companies before collection.
- Preserve symmetric coverage unless there is a clear reason not to.
- Treat `request_id` as stable identity.
- Record inferred URLs as assumptions.
- Always plan selector fallbacks for element crops.
- Batch requests by source type so collection can run in waves.
