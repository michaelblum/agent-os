# Selection Mode Render-Only Pointer Correction V9

## Recipient

GDI.

## Transfer Kind

Correction round after Foreman review of V8.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, screenshot, performance state, or prior implementation state. Read and
rediscover before editing.

## Source Artifact

- Branch: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- Required reviewed head: `ed3dfd04bbb5cc50aa5bb365f4f4c53b0a61fd6f`
- PR: https://github.com/michaelblum/agent-os/pull/392
- Prior correction card:
  `docs/design/work-cards/selection-mode-performance-model-cursor-correction-v8.md`
- Foreman review note: V8 passes deterministic gates, but still leaves normal
  Selection Mode pointer movement on a structural render path.
- Foreman live cleanup note: after V8 smoke, `status_item.hide` made Sigil
  logically hidden while a faint purple dot remained at the last avatar
  position until Foreman manually cleared all renderer canvases through
  `./aos show eval`.

## Single Goal

Close the remaining performance and cleanup regression shapes:

- Selection Mode pointer-move / drag `render_only` input must refresh the cursor
  visually without marking the next render frame structural, publishing
  DesktopWorld state, or syncing input regions/hit surfaces.
- Hiding or cleaning up Sigil must not leave stale WebGL/Canvas pixels at the
  last avatar/cursor position.

## Branch / Base

- `branch_from`: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- `required_start_ref`: `ed3dfd04bbb5cc50aa5bb365f4f4c53b0a61fd6f`
- Work surface/output branch: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- Commit the correction locally on that branch.
- Do not push, open or update PRs, close issues, or mutate GitHub state unless
  Foreman explicitly reassigns that responsibility.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/design/work-cards/selection-mode-performance-model-cursor-correction-v8.md`
- `apps/sigil/renderer/live-modules/selection-mode-runtime.js`
- `apps/sigil/renderer/live-modules/selection-mode-input.js`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/render-loop.js`
- `apps/sigil/renderer/live-modules/visibility-transition.js`
- `tests/renderer/sigil-selection-mode-runtime.test.mjs`
- `tests/renderer/sigil-selection-mode-input.test.mjs`
- `tests/renderer/sigil-selection-mode-performance.test.mjs`
- `tests/renderer/sigil-render-loop.test.mjs`

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

## Review Finding: Render-Only Pointer Input Still Marks Structural Dirty

V8 correctly changed unchanged continuous Selection Mode frames so
`classifyRenderLoopWork()` can treat `selection-mode` as visual-only:

- `apps/sigil/renderer/live-modules/render-loop.js:38`
- `apps/sigil/renderer/live-modules/render-loop.js:50`

But the normal interactive cursor path still dirties structural work before the
classifier can help:

- `apps/sigil/renderer/live-modules/selection-mode-runtime.js:522`
  calls `scheduleRenderFrame()` for `route.direct === 'render_only'`.
- `apps/sigil/renderer/live-modules/main.js:398` defaults
  `scheduleRenderFrame()` to `structuralFrameDirty = true` unless
  `{ structural: false }` is passed.

That means every `mouse_moved` / `left_mouse_dragged` event in active Selection
Mode can still force structural sync, input-region sync, hit-surface sync,
overlay redraw, and DesktopWorld state publication. This is exactly the
real-usage hot path behind the choppy cursor/performance report. The V8 tests
cover unchanged frames, not render-only pointer events.

Required correction:

- Keep entry, acquire, retarget, commit, cancel, and cleanup structural where
  needed.
- Make render-only pointer movement schedule a visual-only frame. The likely
  minimal fix is to pass `{ structural: false }` for the `render_only` route,
  but choose the local shape that best matches the runtime abstractions.
- Ensure the Three cursor model still receives updated cursor positions on
  visual-only pointer frames through the existing `liveJs.selectionModeOverlay`
  cache and render-loop refresh.
- Do not reintroduce Canvas2D cursor drawing for `model_kind: "sigil_model"`.
- Keep the V7/V8 semantic projection, strict DesktopWorld, bounded object
  allocation, and cursor geometry fixes intact.

## Review Finding: Hidden Sigil Can Leave A Stale Purple Pixel/Object

Foreman reproduced the user's report that a faint purple dot remained on screen
after GDI's live smoke. `__sigilDebug.snapshot()` reported:

- `avatarVisible: false`
- `selectionMode.active: false`
- `selectionModeOverlay.visible: false`
- `selectionModeCursorModel.visible: false`
- Selection Mode input region unregistered

The dot still lined up with Sigil's last avatar/cursor position. A manual AOS
eval cleared it only after clearing both WebGL canvases and the three 2D
canvases in `avatar-main`.

The likely failure seam is the hidden-frame path:

- `apps/sigil/renderer/live-modules/main.js:3858`
  `clearHiddenFrame(...)`
- `apps/sigil/renderer/live-modules/main.js:3874`
  `state.renderer.clear(true, true, true)`

Logical hidden state is not enough; cleanup must present a transparent cleared
frame, clear every overlay/cursor/effect canvas that can have drawn Sigil
pixels, or otherwise make stale pixels impossible. Do not solve this by
removing `avatar-main` as routine cleanup; the renderer should be able to stay
alive and hidden without leaving artifacts.

## Required Tests

Add deterministic coverage that fails on V8:

- A `mouse_moved` or `left_mouse_dragged` Selection Mode input updates the
  cursor/overlay and schedules a render with `structural: false`.
- That render-only pointer path does not request structural sync or
  `publishState` when passed through the render-loop classifier.
- A true dirty action such as acquire/exit still schedules or produces the
  lifecycle/cleanup work already covered by existing tests.
- Hiding Sigil after it has rendered an avatar/cursor produces an actually
  cleared frame/canvas state, not only `avatarVisible: false`.
- Cursor model or overlay cleanup cannot leave visible stale objects when
  `selectionMode.active`, `selectionModeOverlay.visible`, and
  `selectionModeCursorModel.visible` are all false.

Prefer direct runtime tests over string-source tests for the scheduling
contract. Keep source tests only where no cleaner seam exists.

## Live Cleanup Requirement

If you run any live AOS/Sigil smoke:

- remove temporary canvases you create;
- exit Selection Mode;
- hide the Sigil avatar or restore its pre-run visibility state before
  reporting completion;
- include a final `__sigilDebug.snapshot()` summary with:
  `avatarVisible`, `selectionMode.active`, `selectionModeOverlay.visible`,
  `selectionModeCursorModel.visible`, and Selection Mode input-region
  registration.

This requirement exists because V8 left the normal Sigil avatar visible as a
purple dot after the smoke, even though the Selection Mode cursor itself was
hidden.

## Verification

Run at minimum:

```bash
git diff --check
node --check apps/sigil/renderer/live-modules/selection-mode-runtime.js
node --check apps/sigil/renderer/live-modules/main.js
node --check apps/sigil/renderer/live-modules/render-loop.js
node --test tests/renderer/sigil-selection-mode-runtime.test.mjs tests/renderer/sigil-selection-mode-input.test.mjs tests/renderer/sigil-selection-mode-performance.test.mjs tests/renderer/sigil-render-loop.test.mjs
node --test tests/renderer/sigil-selection-mode-cursor-model-renderer.test.mjs tests/renderer/sigil-input-regions.test.mjs
./build.sh --no-restart
```

If you touch broader Selection Mode projection/cursor behavior, rerun the
adjacent affected suites before reporting completion.

## Completion Report

Return:

- commit SHA;
- files changed;
- concise summary of the render-only pointer scheduling fix;
- exact tests added or changed and what they prove;
- exact verification commands and pass/fail result;
- whether `./aos ready --json` passed or the TCC recovery path was used;
- if live smoke was run, the final cleanup snapshot fields listed above;
- confirmation that no push/GitHub mutation occurred.
