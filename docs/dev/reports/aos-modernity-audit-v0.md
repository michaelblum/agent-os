# AOS Modernity Audit V0

Date: 2026-07-09
Branch at audit: `voice-io-final-consolidation`
Baseline commit: `600724a0` (`Align AOS waits with Playwright-style proof`)

## Summary

The codebase is too large to treat all tracked text as active product truth.
The current footprint is about 530k tracked text-ish lines across 2,209 tracked
files. That number is inflated by archive docs, generated manifests, design
fixtures, vendor bundles, package locks, and tests, but the active source also
has real hotspots.

Do not start with a massive rewrite. The safer path is an audit-purge program:
classify active truth, delete or externalize historical/generated bulk, then
split active hotspots only after deletion and contract reduction have removed
the obvious weight.

## Current Footprint

Top-level tracked text-ish line counts:

| Area | Lines | Files | Read |
| --- | ---: | ---: | --- |
| `docs` | 133,078 | 359 | Biggest bucket; much of it is archive/report/fixture material. |
| `tests` | 110,518 | 564 | Second-biggest bucket; contains many broad contract suites and live harnesses. |
| `packages` | 109,039 | 416 | Toolkit/components plus vendor adapter content. |
| `apps` | 45,866 | 172 | Sigil remains the largest app surface. |
| `scripts` | 34,114 | 141 | CLI wrappers and runtime orchestration. |
| `manifests` | 33,703 | 106 | Generated command manifests dominate. |
| `src` | 29,491 | 81 | Native runtime, daemon, display, perception. |
| `shared` | 28,081 | 195 | Schemas and fixtures. |

High-volume non-product-code buckets:

| Bucket | Lines | Decision |
| --- | ---: | --- |
| `docs/archive` | 82,466 | First externalization/de-index candidate. |
| `docs/design/fixtures` | 14,487 | Keep only if fixtures are actively consumed by tests/docs. |
| `docs/dev/reports` | 6,104 | Historical evidence; should not become active truth. |
| `manifests` | 33,703 | Generated or source-backed; do not hand-maintain generated bulk. |
| `packages/toolkit/adapters` | 8,846 | Vendor/adapter code; exclude from active complexity budgets. |
| `apps/sigil/renderer/vendor` | 3,635 | Vendor code; exclude from active complexity budgets. |
| `packages/gateway/package-lock.json` | 2,850 | Lockfile; exclude from active complexity budgets. |

Largest active source/test hotspots:

| Lines | File | Action |
| ---: | --- | --- |
| 4,499 | `apps/sigil/renderer/live-modules/main.js` | Continue extraction until below 3k, then below 2k. |
| 3,909 | `src/daemon/unified.swift` | Split daemon routing/lifecycle/IPC ownership. |
| 3,435 | `packages/toolkit/components/surface-inspector/index.js` | Split model, subscriptions, minimap, rendering, actions. |
| 2,571 | `src/display/canvas.swift` | Split placement/lifecycle/input/display concerns. |
| 2,505 | `src/perceive/capture-pipeline.swift` | Split capture orchestration from encoders and target resolution. |
| 2,176 | `tests/toolkit/panel-chrome.test.mjs` | Break into owner-scoped suites or delete duplicate assertions. |
| 1,863 | `tests/renderer/sigil-selection-mode-runtime.test.mjs` | Split by contract or replace with smaller state-machine tests. |
| 1,562 | `tests/toolkit/surface-inspector.test.mjs` | Split by model/render/semantics; keep live proof separate. |

## Modernity Rules

- AOS should dogfood the Playwright-like loop: `ready`, capture/save, refs,
  dry-run, act, recapture, diff/verify. Tests outside that loop need a named
  exception.
- Default runtime content roots are canonical. Branch-scoped roots are only for
  explicit isolated `AOS_STATE_ROOT` proofs.
- Reports, archive docs, generated manifests, fixtures, vendor bundles, and
  package locks do not count as active implementation complexity, but they do
  count as repository weight and must be discoverability-bounded.
- New cleanup PRs should be net-negative lines unless they extract active
  runtime behavior into a smaller owner module.
- Do not add a new test unless it replaces broader proof, guards a named
  regression, or is routed by the retained-local maintainer routing skill backed
  by `node scripts/aos-dev-workflow.mjs recommend`.
- Active source files over 1,500 lines require a split plan. Files over 3,000
  lines require active decomposition work before feature growth.
- Test files over 800 lines require an owner/contract split or a deletion
  rationale.
- Historical docs must be archived, indexed as historical, or moved out of
  active repo truth. They must not look like executable current guidance.

## Purge Lanes

1. **Archive and report diet**
   - Move `docs/archive` and stale `docs/dev/reports` material out of the
     active repo, or keep only an index plus links to external archive storage.
   - Preserve current ADRs, API docs, guides, source manifests, schemas, and
     reports that are explicitly referenced by active tests or help.
   - Expected impact: largest immediate line-count reduction with low runtime
     risk.

2. **Test routing audit**
   - Build a manifest of all tests, whether the retained-local routing script can
     route them, whether they are deterministic/isolated/live/manual, and what
     active contract owns them.
   - Delete tests that prove retired paths, duplicate a smaller deterministic
     contract, or are not referenced by any current manifest/doc/owner.
   - Quarantine real-input/manual proofs behind explicit env guards.

3. **Generated and fixture boundary**
   - Mark generated command manifests and generated reports as derived outputs.
   - Keep source manifests and schema fixtures; delete or regenerate stale
     derived artifacts.
   - Add a report/index check only if it prevents active/generated confusion.

4. **Command surface simplification**
   - Use `docs/api/aos-capabilities.md` as the public model and retire
     transitional/internal command paths that no longer fit the Playwright-like
     loop.
   - Tombstone retired commands so they fail closed; do not leave copy-pasteable
     historical instructions active.

5. **Active source hotspot decomposition**
   - Continue Sigil extraction, but stop moving product-specific behavior into
     toolkit.
   - Split daemon/native hotspots by owner boundaries, not by arbitrary file
     slicing.
   - Split Surface Inspector into model/subscription/render/action modules after
     the audit decides which inspector features still belong in the active tool.

## First Three Commits To Make

1. **Modernity audit report**
   - Add this report only.
   - Validate with docs checks and `git diff --check`.

2. **Archive index pass**
   - Add a generated or hand-maintained index of active docs versus historical
     docs.
   - Move or delete the highest-confidence stale archive/report material.
   - Gate with doc-link checks and `node scripts/aos-dev-workflow.mjs recommend`.

3. **Test manifest pass**
   - Add a script or report that classifies tests by owner, harness level, and
     routed gate status.
   - Delete one small, high-confidence duplicate/retired test set in the same
     commit to prove the process is net-negative.

## Non-Goals

- Do not rewrite AOS from scratch.
- Do not delete real-input proof just because it is awkward; quarantine it
  behind explicit guards and replace fixed waits with AOS-observed predicates
  where possible.
- Do not treat historical reports as current requirements.
- Do not split a large file if the split just moves complexity around without
  reducing active concepts.

## Acceptance Criteria For Cleanup Stacks

- Net-negative active lines unless the stack extracts runtime behavior from a
  monolith.
- No new public command unless it is source-manifested, help-backed, tested, and
  fits the Playwright-like loop.
- Every deleted test names replacement proof or a retired contract.
- Every retired surface fails closed or is unreachable from current help/docs.
- Final gates include `node scripts/aos-dev-workflow.mjs recommend --json --paths <changed-paths>`,
  routed commands, `git diff --check`, and `./aos ready --json` when live
  runtime surfaces were touched.
