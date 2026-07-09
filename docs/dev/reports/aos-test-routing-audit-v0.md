# AOS Test Routing Audit V0

Date: 2026-07-09

## Inventory

- Test-like tracked files under `tests/`: 530.
- Specifically routed by `docs/dev/workflow-rules.json`: 25.
- Covered only by the generic `tests/**` catch-all: 505.
- Heuristic class split: 335 Node/model/schema, 154 shell CLI/daemon, 13
  manual/live/supervised, 28 helpers/fixtures.
- Files over the 800-line split threshold: 14.

The broad toolkit gate is currently healthy: `node --test tests/toolkit/*.test.mjs`
passed with 1,265 pass, 3 expected skips, and 0 failures.

The problem is not uncovered tests. The router can choose a precise gate for
only a small minority of test edits; most depend on agent judgment and stale
broad-suite habit.

## Cleanup Done

Removed `tests/wiki-acceptance.sh`, an unreferenced aggregate wrapper with no
unique assertions. Replacement proof is direct execution of the called wiki
tests or the newer isolated `tests/wiki-integration.sh` path in
`tests/README.md`.

Trimmed the unowned examples list from `tests/README.md` so test selection flows
through the harness ladder, specific family inventories, and
`./aos dev recommend`.

## Next Cuts

- Split or retire the largest generic-only test files before adding new broad
  coverage: `tests/toolkit/panel-chrome.test.mjs`,
  `tests/renderer/sigil-selection-mode-runtime.test.mjs`,
  `tests/toolkit/surface-inspector.test.mjs`, and
  `tests/renderer/avatar-controls-hit-test.test.mjs`.
- Add specific workflow-rule ownership for stable families instead of relying
  on the `tests/**` catch-all.
- Keep manual/live/real-input scenarios guarded and out of broad default loops.
