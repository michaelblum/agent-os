# AOS Target Handle V1

Every semantic action target is exactly one discriminated handle from
`aos-target-handle-v1.schema.json`:

- A browser `observation_ref` contains the original `state_id`, Playwright
  `ref`, and browser session scope. The pair is validated against the one
  current AOS capture generation for that session. A newer AOS capture makes
  the prior pair stale. V1 browser actions currently stop with
  `TARGET_ACTION_UNSUPPORTED` after this validation because the reviewed
  backend cannot atomically bind that AOS generation to ref resolution.
- An `aos_canvas` or `native_ax` `locator` contains a query. It is re-resolved
  at action time and succeeds only with exactly one current match, except that
  native `index` explicitly selects one deterministic action-compatible match
  and `near` selects only a unique closest action-compatible candidate. `index`
  is bounded to `0...1023`; `index` and `near` are mutually exclusive. Native
  V1 queries require `pid` and `role`, matching the fixed public native action
  surface. Traversal depth is bounded to `0...128` and resolution timeout to
  `1...30000` milliseconds.

Coordinates are not handles. State is unsupported for coordinate and Locator
actions. There is no browser Locator grammar or native Observation Ref in V1.

## Browser identity proof

Observation Ref generation validation, including dry-run requests, is
restricted to the source-reviewed `@playwright/cli` 0.1.15 backend. In that
release, Playwright attaches a monotonic aria ref to one DOM `Element` within a
document, but every CLI response captures a new current ref map and a new
document can restart ref allocation. A separate probe followed by an action
therefore cannot prove that the original AOS capture still owns the backend ref.
AOS rejects invalid or duplicate refs in a captured generation and rejects a
repeated capture `state_id` without replacing the current generation.
The generation control record binds the minting backend's canonical executable
path and hashes to the package-backed `0.1.15` implementation and dependency
closure; repo wrappers and self-reported versions cannot mint or act on refs;
request-time provenance must match exactly. Self-reported override or PATH
versions are not sufficient. Because package identity alone does not bind the
backend's current ref map to the AOS `state_id`, direct and saved browser
Observation Ref dry-run/effect requests fail before backend dispatch with
`TARGET_ACTION_UNSUPPORTED` and
`reason:browser_observation_identity_unproven`. This is the required
fail-closed identity blocker, not reacquisition or a browser Locator fallback.
