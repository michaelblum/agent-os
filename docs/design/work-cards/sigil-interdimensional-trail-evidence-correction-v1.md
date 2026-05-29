# Sigil Interdimensional Trail Evidence Correction V1

## Recipient

GDI.

## Transfer Kind

Correction round after failed Foreman/user acceptance of the V0 preflight
completion report.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, daemon, canvas
freshness, avatar appearance, telemetry panel state, screenshots, or display
topology. Rediscover from the repo and live AOS state before editing.

## Source Artifact

- Branch: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- Harness prerequisite accepted:
  `156b2fdbdaf641006364d6d65ab9115a8554945a`
- Failed preflight card:
  `docs/design/work-cards/sigil-interdimensional-trail-multidisplay-preflight-v0.md`
- Failed completion commit:
  `0318c5e6ad7967b6eec7d72c4969098c88bd92b8`
- Prior design note:
  `docs/design/sigil-scene-visual-facet-selection-mode-spike-v0.md`
- Deferred pointer card:
  `docs/design/work-cards/sigil-selection-scene-facet-pointer-v0.md`

## Harness Prerequisite

The shared harness primitive card has landed:

- `docs/design/work-cards/aos-canonical-url-harness-primitives-v0.md`

Use the shared canonical URL / fresh-runtime helpers from `tests/lib/` instead
of hand-rolling the checks below.

## Single Goal

Make the interdimensional trail preflight evidence trustworthy, then either
repair the still-reproducing multi-display trail bug or report a fresh-runtime
pass with enough deterministic and live evidence for Foreman to accept.

This round is about the trail/preflight and test harness quality. Do not
implement the Selection Mode scene visual facet or pointer migration here.

## Branch / Base

- `branch_from`: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- `required_start_ref`: `156b2fdbdaf641006364d6d65ab9115a8554945a`
- Work surface/output branch: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- Use the single repo worktree at `/Users/Michael/Code/agent-os`. Do not create
  or switch to an additional Git worktree for this workflow. Branch-scoped AOS
  content roots such as `sigil_gdi_selection_mode_cursor_ancestor_ladder_v0`
  are served URL namespaces, not separate Git worktrees.
- Use canonical `aos://...` URLs for launch/update/config commands. AOS may
  report the loaded canvas as a resolved `http://127.0.0.1:<port>/...` URL;
  that resolved URL is runtime evidence, not the command surface to copy back
  into handoffs or reload recipes.
- Commit any code, test, or work-card correction locally on that branch.
- Do not push, open or update PRs, close issues, or mutate GitHub state unless
  Foreman explicitly reassigns that responsibility.

## Foreman Review Findings

The V0 completion report is not accepted.

Foreman found the live `avatar-main` canvas had not been reloaded onto the
current branch code when the user tested and when the smoke was reported:

- `avatar-main` reported `loadedAt: 2026-05-29T16:13:44.008Z`.
- The avatar render-model adapter commit was at `2026-05-29T17:22:43Z`.
- The V0 trail fix commit was at `2026-05-29T17:52:37Z`.

That means the reported smoke did not prove `0318c5e6` was running in the live
canvas.

Foreman also found the live avatar state was stale before reload:

- persisted seed/wiki default still describes shape `6` with
  `tesseron.enabled: true`;
- stale live state had `state.tesseron.enabled: false` and no tesseron child
  meshes;
- after Foreman reloaded the existing canvas, the live canvas reported
  `loadedAt: 2026-05-29T18:06:17.799Z`, `tesseron.enabled: true`, and all
  tesseron child meshes present.

Foreman found the render-performance telemetry surface was not visible:

- `./aos show list --json` did not include `sigil-render-performance`;
- live `window.liveJs.renderPerformanceTelemetry` reported
  `{ attempted: 3, sent: 0, skipped: "panel-hidden" }`;
- `postRenderPerformanceSample(...)` only posts when Sigil believes the
  `sigil-render-performance` utility canvas is visible.

The user then manually reported the cross-display fast-travel trail issue still
looked wrong after GDI finished. Treat that as blocking until reproduced or
cleared on a freshly reloaded runtime.

## Required Preflight Before Claims

Before any live acceptance claim, reload or recreate `avatar-main` through AOS
on the current branch and prove the loaded page is fresh.

Use `aos://` at the command/config boundary:

```bash
./aos show update --id avatar-main --url 'aos://<active-sigil-root>/renderer/index.html?toolkit-root=<active-toolkit-root>'
```

Use the shared helpers added in `tests/lib/visual-harness.sh`, including the
canonical URL builders, URL-equivalence assertion, worktree-owner assertion, and
Sigil renderer freshness assertion. If a needed assertion is missing, add it to
the helper layer with a focused deterministic test before using a local
one-off.

For this single-worktree dev workflow, prefer the canonical roots
`aos://sigil/...` and `toolkit-root=toolkit` unless the active Sigil experience
has explicitly configured branch-scoped content roots. If branch-scoped roots
are active, they must still be expressed as `aos://<root>/...`, not as raw
localhost URLs.

Required fresh-runtime assertions:

- `git worktree list --porcelain` shows only
  `/Users/Michael/Code/agent-os` for this dev workflow.
- `git rev-parse HEAD` equals the commit being validated.
- `git show -s --format=%cI HEAD` is earlier than or equal to the live
  `window.__sigilDebug.snapshot().runtime.loadedAt`.
- The canonical URL used for launch/update is recorded as `aos://...`.
- If `./aos show list --json` reports a resolved `http://127.0.0.1:<port>/...`
  URL, compare by content-root/path/query equivalence against the canonical
  `aos://...` URL instead of raw string equality.
- Active AOS canvas owners report
  `owner.worktree_root: /Users/Michael/Code/agent-os`.
- The default avatar is still the tesseron default unless the test explicitly
  changes appearance:
  - `state.currentGeometryType === 6`;
  - `state.tesseron.enabled === true`;
  - tesseron child meshes are present.
- `window.__sigilBootError == null`.

If any assertion fails, stop and fix the harness/runtime setup before debugging
trail rendering.

## Deterministic Battery Requirement

Add or strengthen a focused deterministic battery for this failure class. Do
not rely only on screenshots or long live shell runs.

The battery should be fast, model-level, and specific. Prefer a new clearly
named Node test or a tightly scoped extension of
`tests/renderer/sigil-surface-render-state.test.mjs`.

It must cover the relevant subset of:

- non-zero main-display and extended-display DesktopWorld segment origins;
- follower/secondary segment snapshots preserving full Omega/line trail render
  state;
- DesktopWorld-to-segment-local projection for both main and extended display
  segments;
- line/Omega trail origin reset inputs for non-zero segment origins;
- no allocation/resource growth in unchanged follower trail updates after
  warmup, if the touched code owns objects/materials.

This is the deterministic battery the prior round was missing. Keep it much
smaller than the broad `tests/sigil-hit-target-drag-fast-travel.sh` live flow.

## Render-Performance Surface Requirement

Make performance telemetry visible and assert it is actually receiving samples
for live Sigil validation.

Use the Sigil utility path, not a standalone manually created canvas that Sigil
does not know about. Acceptable approaches:

- open the Render Performance utility through the context menu path; or
- add a small debug/test-only helper that opens the existing
  `render-performance` utility via the same `ensureUtilityCanvasVisible(...)`
  path; or
- add an equivalent narrow AOS-accessible launch helper that updates
  `liveJs.utilityCanvases` consistently.

The live report must include:

- whether `sigil-render-performance` exists in `./aos show list --json`;
- `window.liveJs.renderPerformanceTelemetry.attempted`;
- `sent`;
- `skipped`;
- `lastError`.

Do not claim performance telemetry coverage while `skipped` is
`"panel-hidden"`.

## Live Smoke Requirement

After deterministic checks pass and the fresh-runtime assertions pass, run the
bounded live smoke on a two-display topology.

Required live evidence:

- current commit SHA and live `loadedAt`;
- display topology from `./aos show list --json` or debug snapshot, including
  segment `dw_bounds` and `native_bounds`;
- default avatar/tesseron state before the smoke;
- render-performance utility visible and receiving samples;
- interdimensional line/Omega trail triggered on the main display;
- interdimensional line/Omega trail triggered on the extended display;
- clear pass/fail statement for whether the visual issue reproduces on the
  freshly loaded runtime;
- screenshot paths as supplemental evidence only, not the sole proof;
- cleanup/restoration of avatar position, effect settings, and utility panels
  where practical.

If the issue reproduces, fix it in this round with focused code/tests. If the
issue does not reproduce on the fresh runtime, report that honestly and do not
invent a code change.

## Hard Boundaries

- Do not alter the persisted default avatar away from the tesseron default.
- Do not hide or disable expected avatar motion/effects to pass the smoke.
- Do not implement `selectionVisualRoot.pointer` or selection rect scene-facet
  rendering in this round.
- Do not move Selection Mode input, acquisition, target scoring, hit testing,
  semantic targets, or DesktopWorld ownership into Three render objects.
- Do not make performance telemetry a constantly visible product panel unless
  Foreman assigns that product change separately.
- Do not push or mutate GitHub state.

## Verification

Run at minimum:

```bash
git diff --check
node --check apps/sigil/renderer/live-modules/main.js
node --check apps/sigil/renderer/live-modules/fast-travel.js
node --check apps/sigil/renderer/omega.js
node --check apps/sigil/renderer/live-modules/surface-render-state.js
node --test tests/renderer/fast-travel-preview.test.mjs tests/renderer/omega-trail.test.mjs tests/renderer/sigil-surface-render-state.test.mjs
node --test tests/renderer/sigil-selection-mode-cursor-model-renderer.test.mjs tests/renderer/sigil-selection-mode-runtime.test.mjs tests/renderer/sigil-selection-mode-performance.test.mjs
```

Also run any new focused deterministic battery you add.

If you add a debug/test helper for the render-performance utility path, run the
smallest focused test that proves it opens the panel through Sigil-owned utility
state and `postRenderPerformanceSample(...)` no longer skips as
`panel-hidden`.

## Completion Report

Return:

- commit SHA if committed;
- files changed;
- whether the V0 code fix was kept, amended, or superseded;
- fresh-runtime assertion results, including HEAD commit time and live
  `loadedAt`;
- avatar/tesseron state before and after live smoke;
- deterministic battery added/updated and what old failure it catches;
- render-performance panel evidence: exists, attempted, sent, skipped,
  lastError;
- live two-display trail result on main and extended displays;
- exact verification commands and pass/fail result;
- local-only state still present;
- confirmation that no Selection Mode scene facet implementation happened;
- confirmation that no push/GitHub mutation occurred.
