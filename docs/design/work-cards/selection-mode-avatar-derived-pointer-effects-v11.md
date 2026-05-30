# Selection Mode Avatar-Derived Pointer Effects V11

## Recipient

GDI.

## Transfer Kind

Correction round after Foreman review of V10.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, screenshot, performance state, or prior implementation state. Read and
rediscover before editing.

## Source Artifact

- Branch: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- Required reviewed head: `ad2c0c57927dd8a3b6264a8164ea132cb8c2e51b`
- PR: https://github.com/michaelblum/agent-os/pull/392
- Prior correction card:
  `docs/design/work-cards/selection-mode-avatar-derived-pointer-v10.md`
- Foreman review note: V10 passes syntax/tests/build and materially improves
  pointer material derivation, geometry, and visual-only scheduling, but it does
  not complete the user-visible avatar-derived pointer contract.

## Single Goal

Complete current-avatar visual inheritance for the Selection Mode pointer.

V10 derives primary and edge materials from the live avatar, but aura/effects
are only metadata strings and are not rendered by the pointer. The pointer must
inherit the current live avatar's visual character, including colors/materials
and avatar effects that are meaningful at pointer scale, while still overriding
only geometry, orientation, hotspot, scale, visibility, and single-axis
rotation.

## Branch / Base

- `branch_from`: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- `required_start_ref`: `ad2c0c57927dd8a3b6264a8164ea132cb8c2e51b`
- Work surface/output branch: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- Start on `gdi/selection-mode-cursor-ancestor-ladder-v0`, not detached HEAD.
  Confirm `required_start_ref` is an ancestor before editing. The local branch
  may contain later Foreman routing/provenance notes; do not rewind or discard
  them.
- Commit the correction locally on that branch.
- Do not push, open or update PRs, close issues, or mutate GitHub state unless
  Foreman explicitly reassigns that responsibility.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/design/work-cards/selection-mode-avatar-derived-pointer-v10.md`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/selection-mode-cursor-model-renderer.js`
- `apps/sigil/renderer/live-modules/selection-mode-visual-model.js`
- `apps/sigil/renderer/aura.js`
- `apps/sigil/renderer/phenomena.js`
- `apps/sigil/renderer/skins.js`
- `apps/sigil/renderer/appearance.js`
- `tests/renderer/sigil-selection-mode-cursor-model-renderer.test.mjs`
- `tests/renderer/sigil-selection-mode-runtime.test.mjs`
- `tests/renderer/sigil-selection-mode-performance.test.mjs`
- `tests/renderer/avatar-object-control.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD origin/main origin/gdi/selection-mode-cursor-ancestor-ladder-v0
git merge-base --is-ancestor ad2c0c57927dd8a3b6264a8164ea132cb8c2e51b HEAD
./aos ready --json
```

If `./aos ready` reports repo-mode Accessibility, Input Monitoring, or inactive
input-tap blockers, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`.

## Review Finding: V10 Is Material-Derived, Not Fully Avatar-Derived

V10 wires a live avatar material source:

- `apps/sigil/renderer/live-modules/main.js:2627`
  `currentAvatarRenderSourceForSelectionPointer()`
- `apps/sigil/renderer/live-modules/selection-mode-cursor-model-renderer.js:221`
  `applyAvatarSourceToInstance(...)`

That is useful, but it only copies primary and edge materials. The same source
object carries `effectRoot`, but the renderer never consumes it:

- `apps/sigil/renderer/live-modules/main.js:2642`
  returns `effectRoot: state.polyGroup`.
- `apps/sigil/renderer/live-modules/selection-mode-cursor-model-renderer.js`
  has no use of `effectRoot`, `effects_source`, or avatar effect objects.

The visual model also removed actual cursor aura data:

- `apps/sigil/renderer/live-modules/selection-mode-visual-model.js:70`
  `resolveAvatarPointerSource(...)` returns only string `effects_source`.
- `apps/sigil/renderer/live-modules/selection-mode-visual-model.js:244`
  `buildSelectionModeCursorGlyph(...)` no longer carries `aura`.

The test currently locks in the opposite of the product contract:

- `tests/renderer/sigil-selection-mode-runtime.test.mjs:436`
  is still named as if the cursor inherits avatar color/aura/trail/rotation,
  but the assertions require `overlay.cursorGlyph.aura === undefined`.

The user's product expectation is that a user-designed avatar can change to
anything allowed by the context menu, and the Selection Mode pointer should
automatically acquire those current visuals. The default tesseron/tesseract-like
appearance is just the default, not a special source.

## Live Evidence From Operator Triage

Operator ran
`docs/design/work-cards/operator-selection-mode-pointer-current-live-triage-v0.md`
against required ref `ad2c0c57927dd8a3b6264a8164ea132cb8c2e51b`.

Evidence directory:

- `/tmp/aos-pr392-selection-pointer-current-triage-v0`

Key artifacts:

- active screenshot:
  `/tmp/aos-pr392-selection-pointer-current-triage-v0/03-active-acquired.png`
- active snapshot:
  `/tmp/aos-pr392-selection-pointer-current-triage-v0/03-snapshot-active-acquired.json`
- snapshot read check:
  `/tmp/aos-pr392-selection-pointer-current-triage-v0/03-snapshot-read-update-count.json`
- cleanup screenshot:
  `/tmp/aos-pr392-selection-pointer-current-triage-v0/05-after-cleanup.png`
- cleanup snapshot:
  `/tmp/aos-pr392-selection-pointer-current-triage-v0/05-snapshot-after-hide.json`

Accepted evidence:

- `./aos ready --json` passed with Accessibility, Screen Recording,
  listen/post access, and active input tap.
- Primary HITL evidence was used; no debug fallback was used.
- Projection/targeting passed. The acquired path was
  `canvas -> selection-mode-pointer-triage-target -> semantic -> selection-mode-pointer-triage-save-button`.
- Hotspot/alignment did not fail. The active snapshot reported
  `selectionModeCursorModel.hotspot_aligned: true` with hotspot
  `{ x: 436, y: 198 }`, and the visual apex appeared near the cursor
  highlight.
- Snapshot reads did not mutate the cursor model update counter:
  `before: 2587`, `after: 2587`.
- Cleanup passed. Escape exited Selection Mode, the target canvas was removed,
  status hide ran, `selectionModeCursorModel.visible` became false, and
  `05-after-cleanup.png` showed no stale Selection Mode pointer/dot beyond the
  captured system cursor highlight.

Failing evidence:

- Visual inheritance still fails. `03-active-acquired.png` shows a large black
  triangular shard/wedge pointer with a dense ghosted trail/badge artifact
  stack. It does not visually read like the current purple Sigil avatar/status
  icon even though the snapshot reports
  `selectionModeCursorModel.appearance_source: "current_live_sigil_avatar"` and
  `material_source: "current_avatar_render_model"`.
- The active snapshot resource counts were bounded, so do not treat this as an
  allocation leak by default:
  `root_groups_created: 1`, `model_instances_created: 11`,
  `trail_instances_created: 10`, `geometries_created: 22`,
  `materials_created: 22`, `scene_adds: 1`.

Runtime hygiene note:

- `00-aos-status.txt` reported status-item target drift to a previously served
  branch slug. Before any live smoke after the correction, refresh the Sigil
  experience or recreate `avatar-main` so the live canvas proves it is loading
  the corrected checkout. Include the final content-root/module URL proof in
  the completion report.

## Required Correction

Keep V10's improvements:

- live material derivation;
- elongated apex-at-origin pointer geometry;
- down/right base and north-west display direction;
- locked root orientation and single screen-plane rotation axis;
- visual-only pointer movement;
- stale hidden-frame cleanup;
- bounded resource counts.

Finish the missing inheritance:

- Derive pointer-visible aura/effects from the current live avatar appearance or
  avatar render/effect source.
- Render the inherited effect family in the pointer harness where meaningful at
  pointer scale. At minimum, the visible pointer should carry the current
  avatar aura/glow/effect identity, not only primary/edge mesh materials.
- Fix the live failure where the pointer becomes an oversized black
  shard/wedge with dense ghosted trail artifacts despite reporting
  `current_live_sigil_avatar`. Preserve the apex-at-cursor geometry, but make
  the rendered pointer legible as the current Sigil visual identity.
- Audit the trail instances and badge/ghost visual stack for the `sigil_model`
  pointer path. The live issue may be an overlarge/overopaque trail or stale
  instance composition rather than only material color.
- Do not solve this by restoring the old hand-mapped `cursorGlyph.color` /
  `cursorGlyph.aura` as the rendering source. A small effect adapter is fine if
  it is fed by the same current avatar appearance/effect state as the normal
  avatar.
- Rename or repair misleading tests so their names match what they prove.
- Do not add per-pointer-move cloning/allocation.

If some avatar effects are intentionally not meaningful at pointer scale, make
that boundary explicit in code/test metadata and the completion report. The
default should still be to inherit everything practical from the current live
avatar appearance.

## Required Tests

Add deterministic coverage that fails on V10:

- A current avatar aura/effect appearance change is visible in the pointer's
  render state without a separate cursor-only color/aura mapping.
- The pointer effect source is current live avatar appearance/effect state, not
  a hardcoded `effects_source` string.
- The existing misleading runtime test no longer asserts that inherited aura is
  absent.
- Resource counts remain bounded after warmup when effects are enabled.
- Live-evidence regression: given the current default purple Sigil appearance,
  the pointer render state must not resolve to an all-black oversized shard or
  an overdrawn dense ghost trail.
- Visual-only pointer movement and hidden cleanup still pass.

Prefer a behavior seam that inspects pointer render objects/effect adapters
over string-source tests.

## Live Smoke Requirement

Run a bounded live smoke only after deterministic gates pass:

- set or use an avatar appearance with visible aura/effect settings;
- refresh the Sigil experience or recreate `avatar-main` first if
  `./aos status` reports status-item target drift;
- reload/recreate `avatar-main`;
- enter Selection Mode and move the pointer;
- capture a screenshot showing the pointer inherits current avatar visuals,
  not just material colors;
- exit Selection Mode;
- hide Sigil or restore pre-run visibility;
- verify no stale purple dot remains.

Use `./aos` commands only. If live AOS/TCC blocks, use the GDI human-needed TCC
reset path above and stop.

## Verification

Run at minimum:

```bash
git diff --check
node --check apps/sigil/renderer/live-modules/main.js
node --check apps/sigil/renderer/live-modules/selection-mode-cursor-model-renderer.js
node --check apps/sigil/renderer/live-modules/selection-mode-visual-model.js
node --check apps/sigil/renderer/live-modules/render-loop.js
node --test tests/renderer/sigil-selection-mode-cursor-model-renderer.test.mjs tests/renderer/sigil-selection-mode-runtime.test.mjs tests/renderer/sigil-selection-mode-performance.test.mjs
node --test tests/renderer/avatar-object-control.test.mjs tests/renderer/sigil-render-loop.test.mjs
./build.sh --no-restart
./aos ready --json
```

If you touch broader avatar appearance/effects code, rerun the adjacent affected
renderer suites before reporting completion.

## Completion Report

Return:

- commit SHA;
- files changed;
- concise summary of how pointer aura/effects inherit from current live avatar
  appearance/render state;
- any explicit boundary for effects not inherited at pointer scale;
- exact cursor-only overrides that remain;
- tests added/changed and what they prove;
- verification commands and pass/fail result;
- live smoke screenshot path, cleanup snapshot, and module URL/content-root
  proof if run;
- confirmation that no push/GitHub mutation occurred.
