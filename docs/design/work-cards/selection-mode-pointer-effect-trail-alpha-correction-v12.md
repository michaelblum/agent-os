# Selection Mode Pointer Effect Trail Alpha Correction V12

## Recipient

GDI.

## Transfer Kind

Correction round after Foreman review of V11.

## Source Artifact

- Branch: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- Required reviewed head: `2fba53cba334550a556f6008f546caffb790cdf7`
- PR: https://github.com/michaelblum/agent-os/pull/392
- Prior correction card:
  `docs/design/work-cards/selection-mode-avatar-derived-pointer-effects-v11.md`

Foreman review status:

- Deterministic syntax/tests rerun by Foreman passed.
- Acceptance is blocked by a focused renderer finding below. Do not broaden the
  scope back to projection, acquisition, hotspot alignment, or cleanup.

## Single Goal

Make avatar-derived pointer effect trails obey the same fade/softening policy
as the pointer mesh/edge trails, and clean up effect materials when the renderer
is destroyed.

The V11 intent was to fix the live black-shard/dense-ghost-stack failure.
However, V11 only applies the per-trail `alpha` to the mesh and edge materials.
The newly added aura/effect sprites keep constant trail opacity per instance,
so eight trail echoes can still accumulate a dense glow stack in live rendering.

## Branch / Base

- `branch_from`: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- `required_start_ref`: `2fba53cba334550a556f6008f546caffb790cdf7`
- Work surface/output branch: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- Commit the correction locally on that branch.
- Do not push, open or update PRs, close issues, or mutate GitHub state unless
  Foreman explicitly reassigns that responsibility.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume Foreman chat context
beyond this card. Read and rediscover before editing.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/design/work-cards/selection-mode-avatar-derived-pointer-effects-v11.md`
- `apps/sigil/renderer/live-modules/selection-mode-cursor-model-renderer.js`
- `tests/renderer/sigil-selection-mode-cursor-model-renderer.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD
git merge-base --is-ancestor 2fba53cba334550a556f6008f546caffb790cdf7 HEAD
```

Stop if HEAD is not the required reviewed commit or a descendant of it on the
selection branch.

## Review Finding: Effect Sprites Ignore Trail Alpha

V11 added pointer-scale aura/effect sprites:

- `apps/sigil/renderer/live-modules/selection-mode-cursor-model-renderer.js:301-337`
  creates glow/core effect sprites for every primary and trail instance.
- `apps/sigil/renderer/live-modules/selection-mode-cursor-model-renderer.js:340-366`
  sets glow/core opacity from aura intensity and a fixed `trailMultiplier`.

But ordinary trail fading happens later:

- `apps/sigil/renderer/live-modules/selection-mode-cursor-model-renderer.js:730-738`
  computes per-trail `alpha` and passes it to `updateInstance`.
- `apps/sigil/renderer/live-modules/selection-mode-cursor-model-renderer.js:453-457`
  applies that `alpha` only to `core.material.opacity` and
  `edges.material.opacity`.

The effect sprites are not adjusted by `updateInstance`, so every visible trail
keeps roughly the same glow/core opacity regardless of distance/progress. This
is still compatible with the deterministic tests because
`tests/renderer/sigil-selection-mode-cursor-model-renderer.test.mjs:445-462`
only checks the trail count cap and that effects exist; it does not assert
opacity ordering or fading.

Required correction:

- Make effect sprite opacity participate in per-instance alpha/fill/trail
  fading.
- Preserve primary pointer effects as visible and avatar-derived.
- Keep trail effect echoes subtle enough that the live visual cannot recreate a
  dense ghost stack.
- Add deterministic coverage that fails on V11 by asserting trail effect
  opacity decreases across trail instances and remains below the primary
  pointer effect opacity.

## Review Finding: Effect Materials Are Not Disposed

`disposeInstance` currently disposes only geometry, edge geometry, core
material, and edge material:

- `apps/sigil/renderer/live-modules/selection-mode-cursor-model-renderer.js:522-528`

V11 adds effect sprite materials but does not dispose them on renderer
`destroy()`. Fix that adjacent cleanup gap while you are in this file.

Required correction:

- Dispose effect sprite materials for primary and trail instances when the
  renderer is destroyed.
- Add or extend deterministic coverage so effect materials are marked disposed
  in the fake renderer after `destroy()`.

## Preserve

- Current-avatar material/color/effect descriptor derivation.
- Apex-at-cursor geometry and hotspot alignment.
- Visual-only pointer movement.
- Bounded resource counts after warmup.
- Hidden cleanup behavior.
- Projection/acquisition behavior.

## Verification

Run:

```bash
git diff --check
node --check apps/sigil/renderer/live-modules/selection-mode-cursor-model-renderer.js
node --check apps/sigil/renderer/live-modules/selection-mode-visual-model.js
node --test tests/renderer/sigil-selection-mode-cursor-model-renderer.test.mjs tests/renderer/sigil-selection-mode-runtime.test.mjs tests/renderer/sigil-selection-mode-performance.test.mjs
```

If you touch broader renderer or lifecycle behavior, rerun the adjacent suites
from V11 before reporting completion.

## Completion Report

Return:

- commit SHA;
- files changed;
- exact effect-opacity/fading behavior changed;
- exact disposal behavior changed;
- tests added/changed and what they prove;
- verification commands and pass/fail result;
- current branch/head;
- confirmation that no push/GitHub mutation occurred.
