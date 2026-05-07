# Legacy Capture Executor Shape

Status: non-canonical reference excerpt

The old capture executor recipe targeted Playwright or Puppeteer. Its job was narrow: read the manifest, run each request, write artifact files, and annotate the manifest with what actually happened. It did no analysis.

## Output Layout

```text
acme-audit-2026-04-17/
├── acme-audit-manifest-2026-04-17.yaml
└── artifacts/
    ├── acme_careers_home_cap_001_full.png
    ├── acme_careers_home_cap_001_elem_hero_block.png
    ├── acme_careers_home_cap_001_elem_primary_cta.png
    ├── acme_careers_home_cap_001_vp_abovefold.png
    ├── acme_careers_home_cap_001_text.txt
    ├── acme_careers_home_cap_001.html
    └── ...
```

File naming convention:

| Artifact type | Filename template |
| --- | --- |
| `full_page_screenshot` | `{request_id}_{capture_job_id}_full.{format}` |
| `element_screenshot` | `{request_id}_{capture_job_id}_elem_{label}.{format}` |
| `viewport_clip` | `{request_id}_{capture_job_id}_vp_{label}.{format}` |
| `page_text` | `{request_id}_{capture_job_id}_text.txt` |
| `page_source` | `{request_id}_{capture_job_id}.html` |

## Per-Request Flow

1. Launch or reuse browser context with default viewport and user agent.
2. Apply pre-navigation setup such as cookies and resource blocking.
3. Navigate to URL with the manifest wait strategy.
4. Dismiss known banners when possible.
5. Wait for target selectors or network idle.
6. Scroll full page when lazy loading is likely.
7. Dispatch artifact handlers.
8. Write capture status, selector resolution, notes, and replay hints.

## Selector Resolution Pattern

The executor tried `selector_primary` first, then ordered fallbacks. For each selector it recorded whether the target was visible. When no selector matched, it used `bbox_fallback` if present. Required artifacts could block the request when no target resolved.

Important output metadata:

```yaml
capture_result:
  status: collected
  notes: "Cookie banner dismissed. Hero captured."
  selector_resolution:
    hero_block:
      used_selector: ".hero-section"
      tried:
        - { selector: ".hero-section", visible: true }
executor_plan:
  replay_hints:
    scroll_pause_ms: 1200
    wait_for_selector: ".hero-section"
    dismissed_selectors:
      - "#onetrust-accept-btn-handler"
```

## Login-Gated Pages

Glassdoor and Indeed could require cookie jars. The old reference treated cookie jars as external secrets, never committed. If the page redirected to login, the request was marked `blocked` and the note recorded that login was required or the cookie jar expired.

## Retry Pattern

A single request could produce multiple `capture_job_id` values. Successful jobs were preserved rather than overwritten. Later jobs could supersede earlier ones in notes.
