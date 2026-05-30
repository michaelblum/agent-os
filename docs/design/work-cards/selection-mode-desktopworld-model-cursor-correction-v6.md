# Selection Mode DesktopWorld And Model Cursor Correction V6

## Recipient

GDI.

## Transfer Kind

Correction round after Foreman thermo-nuclear code-quality review.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, screenshot, or prior implementation state. Read and rediscover before
editing.

## Source Artifact

- Branch: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- Reviewed head: `d62bfab445b795b74613bfba6edbbe030219fcc4`
- Prior correction card: `docs/design/work-cards/selection-mode-desktopworld-model-cursor-correction-v5.md`
- PR: https://github.com/michaelblum/agent-os/pull/392
- Foreman review mode:
  `/Users/Michael/Code/agent-os/.docks/foreman/skills/thermo-nuclear-code-quality-review/SKILL.md`

## Single Goal

Make the V5 correction acceptable as a maintainable base layer by closing the
strict review findings without changing intended Selection Mode behavior.

## Branch / Base

- `branch_from`: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- `required_start_ref`: `d62bfab445b795b74613bfba6edbbe030219fcc4`
- Work surface/output branch: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- Commit the correction locally on that branch.
- Do not push, open or update PRs, close issues, or mutate GitHub state unless
  Foreman explicitly reassigns that responsibility.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/design/work-cards/selection-mode-desktopworld-model-cursor-correction-v5.md`
- `packages/toolkit/runtime/spatial.js`
- `packages/toolkit/components/spatial-telemetry/model.js`
- `packages/toolkit/workbench/spatial-subject-tree.js`
- `packages/toolkit/components/surface-inspector/index.js`
- `packages/toolkit/components/surface-inspector/tree.js`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/interaction-overlay.js`
- `apps/sigil/renderer/live-modules/selection-mode-cursor-model-renderer.js`
- `tests/toolkit/runtime-spatial.test.mjs`
- `tests/toolkit/spatial-telemetry-model.test.mjs`
- `tests/toolkit/spatial-subject-tree.test.mjs`
- `tests/toolkit/surface-inspector.test.mjs`
- `tests/renderer/sigil-selection-mode-cursor-model-renderer.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD origin/main origin/gdi/selection-mode-cursor-ancestor-ladder-v0
./aos ready --json
```

If `./aos ready` reports repo-mode Accessibility, Input Monitoring, or inactive
input-tap blockers, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`.

## Review Finding 1: Canvas-Frame Ambiguity Still Certifies A Projectable Frame

`normalizeCanvasFrameToDesktopWorld()` added the right canonical owner, but the
unknown `atResolved` branch still guesses. When `atResolved` is present with no
coordinate-space metadata and does not match the projected `at`, the helper
returns the projected `at` as a valid DesktopWorld frame and only nests an
`ambiguity` object:

- `packages/toolkit/runtime/spatial.js:535`
- `packages/toolkit/runtime/spatial.js:598`
- `packages/toolkit/runtime/spatial.js:605`

Downstream callers then mark that frame as projectable/visible:

- `apps/sigil/renderer/live-modules/main.js:2016`
- `apps/sigil/renderer/live-modules/main.js:2029`
- `apps/sigil/renderer/live-modules/main.js:2045`

That violates the V5 contract: if `atResolved` can be either native or
DesktopWorld, the ambiguity must be loud enough that incomplete or conflicting
state is not silently certified.

Required correction:

- Keep `packages/toolkit/runtime/spatial.js` as the canonical owner.
- Make conflicting or unknown `atResolved` state explicit at the boundary. Do
  not return a normal projectable frame for a conflicting `atResolved` unless a
  clear rule proves which frame is authoritative.
- Pick the smallest clear contract after reading callers. Acceptable shapes:
  - return a blocked/ambiguous result that callers propagate as non-projectable;
  - require coordinate-space metadata before trusting `atResolved`;
  - normalize at the lifecycle/component boundary so the helper no longer has
    to guess for owned in-repo callers.
- Add deterministic tests that fail against the reviewed head for a mismatched
  unknown `atResolved` value. The test must prove the result is loud, not just
  that an `ambiguity` field exists while the candidate remains projectable.

## Review Finding 2: The New Canonical Helper Is Not Yet The Single Contract

The branch exports `normalizeCanvasFrameToDesktopWorld()` and routes the main
Selection Mode path through it, but active in-repo consumers still read
`atResolved ?? at` directly or reproject it themselves:

- `packages/toolkit/components/spatial-telemetry/model.js:74`
- `packages/toolkit/workbench/spatial-subject-tree.js:200`
- `packages/toolkit/components/surface-inspector/tree.js:21`
- `packages/toolkit/components/surface-inspector/tree.js:195`
- `packages/toolkit/components/surface-inspector/index.js:587`

This leaves future agents with two coordinate contracts and keeps the original
double-conversion bug shape alive in adjacent debug/inspection surfaces.

Required correction:

- Snap owned in-repo callers that resolve canvas frames to the canonical helper,
  or document in code why a specific caller only receives already-normalized
  DesktopWorld frames and cannot use display topology.
- Prefer changing pure helper signatures over preserving ambiguous direct reads
  when the display topology is available to the caller.
- Update/add targeted tests for any adjusted caller, especially spatial
  telemetry and spatial subject tree if their behavior changes.
- Do not leave broad `atResolved ?? at` frame resolution in active toolkit or
  Sigil paths unless it is demonstrably outside this coordinate contract.

## Review Finding 3: The Model Cursor Leaves Stale Scene Objects On Projection Failure

The Three.js renderer hides objects when Selection Mode is not visible, but not
when a visible overlay has an invalid or unprojectable cursor:

- `apps/sigil/renderer/live-modules/selection-mode-cursor-model-renderer.js:180`
- `apps/sigil/renderer/live-modules/selection-mode-cursor-model-renderer.js:338`
- `apps/sigil/renderer/live-modules/selection-mode-cursor-model-renderer.js:352`
- `apps/sigil/renderer/live-modules/selection-mode-cursor-model-renderer.js:366`
- `apps/sigil/renderer/live-modules/selection-mode-cursor-model-renderer.js:375`
- `apps/sigil/renderer/live-modules/selection-mode-cursor-model-renderer.js:383`

`updateInstance()` returns `false` for a null scene point but does not hide the
previous instance. `update()` sets `root.visible = true` before proving
`primaryPoint` is projectable, and the snapshot can still report visible while
`hotspot_aligned` is false. Trails have the same stale-instance shape.

Required correction:

- If the primary cursor cannot be projected, hide the primary and trail model
  objects and report a non-visible or blocked snapshot.
- If an individual trail sample cannot be projected, hide that trail instance
  for the frame.
- Consider clearing trail history on non-visible updates or session transitions
  if stale trails can bridge sessions.
- Add a deterministic test in
  `tests/renderer/sigil-selection-mode-cursor-model-renderer.test.mjs` that
  first renders a valid model cursor, then sends a visible overlay with
  `cursor.valid === false` or a projector returning `null`, and proves stale
  model objects are hidden.

## Scope And Hard Boundaries

- Preserve the behavior already validated in V5:
  - Selection Mode enters from avatar double-click.
  - Native cursor suppression remains active while Selection Mode is active.
  - Acquisition creates a Display -> stage -> panel -> target path.
  - Badges render leaf-to-root.
  - Badge retargeting preserves acquisition pointer and clicked leaf evidence.
  - Escape exits and unregisters the Selection Mode input region.
- Do not redesign Selection Mode or the whole Sigil renderer.
- Do not add Sigil-local coordinate offsets or negative-display special cases.
- Do not downgrade the cursor product claim to a 2D glyph.
- Do not push or mutate GitHub state.
- Live Selection Mode smoke remains a Foreman/Operator follow-up after these
  code-quality findings are closed.

## Verification

Run at minimum:

```bash
git diff --check
node --check packages/toolkit/runtime/spatial.js
node --check apps/sigil/renderer/live-modules/selection-mode-cursor-model-renderer.js
node --test tests/toolkit/runtime-spatial.test.mjs tests/toolkit/spatial-telemetry-model.test.mjs tests/toolkit/spatial-subject-tree.test.mjs tests/toolkit/surface-inspector.test.mjs
node --test tests/renderer/sigil-selection-mode-runtime.test.mjs tests/renderer/sigil-selection-mode-cursor-model-renderer.test.mjs
```

If you touch broader Sigil render-loop integration, also run:

```bash
node --test tests/renderer/sigil-selection-mode-input.test.mjs tests/renderer/sigil-input-regions.test.mjs tests/renderer/sigil-render-loop.test.mjs tests/renderer/sigil-ux-tree.test.mjs
./build.sh --no-restart
```

## Completion Report

Return:

- commit SHA;
- files changed;
- concise summary of the canvas-frame contract fix;
- concise summary of which stale frame-resolution callers were updated or why
  any were intentionally left alone;
- concise summary of the cursor stale-object cleanup fix;
- exact tests run and pass/fail result;
- whether `./aos ready --json` passed or whether the TCC recovery path was
  used;
- residual risks or follow-up slices.
