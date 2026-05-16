# Work Card: Sigil Radial Menu Data-Driven 3D Config Review Corrections V0

## Tracker

- Parent card:
  `docs/design/work-cards/sigil-radial-menu-data-driven-3d-config-v0.md`
- Review target branch:
  `gdi/sigil-radial-menu-data-driven-3d-config-v0`
- Reviewed heads:
  - `9b9850ac6166cb87cddcbffc273953f03b5eff8a`
  - `bc55b76255bc2a6f3f92ac9cf40a230ef80a93dc`
- Review outcome: not accepted yet. At `bc55b76255bc2a6f3f92ac9cf40a230ef80a93dc`,
  deterministic tests and the real-input radial smoke pass, and the Sigil
  baseline geometry/source-of-truth drift is fixed. Two contract gaps remain:
  concrete wiki-brain effect implementation still lives in the renderer
  orchestrator, and toolkit model/part/effect defaults are declared but not
  cascaded into resolved items.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing. Continue from the existing review branch and preserve the Foreman
work-card commits already under it.

## Goal

Repair the data-driven radial menu implementation so it satisfies the parent
card's platform contract rather than only adding JSON metadata beside the live
renderer.

The corrected branch must make these true:

- Sigil's actual current radial menu baseline geometry is defined by JSON, not
  by stale duplicated JS objects in `state.js` and `appearance.js`.
- Item-owned modules own special radial drawing/effect routines instead of only
  advertising metadata while `radial-gesture-visuals.js` keeps the bespoke
  implementation.
- The base menu model supports nested menu-stack fundamentals in the resolver,
  not only in the schema.
- JSON schema references resolve from their file locations.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- Parent card:
  `docs/design/work-cards/sigil-radial-menu-data-driven-3d-config-v0.md`
- Current implementation files:
  - `apps/sigil/renderer/radial-menu/sigil-radial-menu.json`
  - `packages/toolkit/runtime/radial-menu/default-3d.json`
  - `apps/sigil/renderer/radial-menu-defaults.js`
  - `apps/sigil/renderer/state.js`
  - `apps/sigil/renderer/appearance.js`
  - `apps/sigil/renderer/radial-menu/item-registry.js`
  - `apps/sigil/renderer/radial-menu/items/*.js`
  - `apps/sigil/renderer/live-modules/radial-gesture-visuals.js`
  - `packages/toolkit/runtime/radial-menu-config.js`
  - `shared/schemas/radial-menu-3d.schema.json`
- Tests:
  - `tests/toolkit/runtime-radial-menu-config.test.mjs`
  - `tests/renderer/radial-gesture-menu.test.mjs`
  - `tests/renderer/radial-gesture-visuals.test.mjs`
  - `tests/renderer/radial-menu-target-surface.test.mjs`

## Rediscover State

```bash
git status --short --branch
git log --oneline -5 --decorate
./aos dev recommend --json
```

Use this probe to verify the current source-of-truth drift before fixing it:

```bash
node --input-type=module - <<'NODE'
import state from './apps/sigil/renderer/state.js';
import sigilMenu from './apps/sigil/renderer/radial-menu/sigil-radial-menu.json' with { type: 'json' };
const keys = ['deadZoneRadius','itemRadius','itemHitRadius','itemVisualRadius','menuRadius','handoffRadius','reentryRadius','spreadDegrees','startAngle','orientation'];
for (const key of keys) {
  const jsonValue = sigilMenu.geometry?.[key];
  const stateValue = state.radialGestureMenu?.[key];
  if (jsonValue !== stateValue) console.log(`${key}: json=${jsonValue} state=${stateValue}`);
}
NODE
```

At reviewed head this reports JSON/state mismatches for `itemRadius`,
`itemHitRadius`, `itemVisualRadius`, `menuRadius`, `handoffRadius`,
`reentryRadius`, and `spreadDegrees`.

## Findings To Fix

The two "Remaining Findings" entries are the current correction target for
`bc55b76255bc2a6f3f92ac9cf40a230ef80a93dc`. The numbered findings below them
are preserved as first-review context and regression guards; do not redo already
fixed work unless rediscovery shows it has drifted again.

### Remaining Findings At `bc55b76255bc2a6f3f92ac9cf40a230ef80a93dc`

#### A. Wiki-Brain Effect Implementation Is Still Renderer-Owned

`apps/sigil/renderer/radial-menu/items/wiki-brain.js` now owns the wiki item
effect config, host creation, and sync hooks, but the concrete nested neural
tree and fractal brain effect implementation is still in
`apps/sigil/renderer/live-modules/radial-gesture-visuals.js`. The renderer still
defines the nested/fractal special routines and shader/material machinery,
including `createNestedNeuralTreeEffect()`, `updateNestedNeuralTreeEffect()`,
`createFractalBrainTreeEffect()`, `updateFractalBrainTreeEffect()`, fractal
pulse path spawning, and the wiki-specific `updateRadialEffect()` state machine.

Required correction:

- Move the concrete nested neural tree and fractal brain tree creation/update
  logic out of `radial-gesture-visuals.js` and into the wiki item module or a
  wiki-owned sibling helper under `apps/sigil/renderer/radial-menu/`.
- Add an item-module `updateEffect` hook, or equivalent, so
  `radial-gesture-visuals.js` only dispatches generic renderer state into item
  module hooks. The renderer may keep generic placement, hover transform,
  glTF loading, material helpers, and activation orchestration; it should not
  contain wiki-brain-specific nested tree, fractal pulse, or shell/fiber/fractal
  update code.
- Add a focused regression check that fails if
  `radial-gesture-visuals.js` reintroduces the wiki-specific effect
  implementation names, plus a direct test that exercises the wiki item
  module's effect creation/update hook.

#### B. Toolkit Model/Part/Effect Defaults Do Not Cascade Into Resolved Items

`packages/toolkit/runtime/radial-menu/default-3d.json` declares reusable
`defaults.three.model`, `defaults.three.part`, and `defaults.three.effect`
defaults. However, `packages/toolkit/runtime/radial-menu-config.js` only applies
`defaults.item` and `defaults.three.item` in `normalizeItem()`. A resolved item
with `geometry: { "type": "gltf" }` does not receive the default
`radiusScale`/`normalizedRadius`, and an item effect does not receive
`enabled: true`.

Required correction:

- Extend the toolkit resolver so model, part, and effect defaults cascade into
  the resolved item shape without importing Three.js, DOM, Sigil modules, or
  app behavior.
- Preserve array replacement semantics unless a field is explicitly keyed.
  Existing `geometry.parts` entries may receive part defaults per entry, and
  existing `effects` entries may receive effect defaults per entry.
- Add resolver tests that prove default model radius, part visibility, and
  effect enabled values survive into resolved items while item overrides still
  win.
- If Sigil keeps a browser-local resolver facade in
  `apps/sigil/renderer/radial-menu-defaults.js`, update it or add an equivalence
  test so it cannot drift from the toolkit resolver contract for the Sigil
  menu.

### 1. JSON Is Not Yet The Source Of Truth For Sigil's Actual Geometry

At reviewed head, `apps/sigil/renderer/radial-menu/sigil-radial-menu.json`
declares:

```json
{
  "itemRadius": 1.55,
  "itemHitRadius": 0.42,
  "itemVisualRadius": 0.28,
  "menuRadius": 1.8,
  "handoffRadius": 2.25,
  "reentryRadius": 1.85,
  "spreadDegrees": 88
}
```

But the live defaults still come from `apps/sigil/renderer/state.js` and
`apps/sigil/renderer/appearance.js`:

```json
{
  "itemRadius": 4.15,
  "itemHitRadius": 0.64,
  "itemVisualRadius": 0.62,
  "menuRadius": 2.65,
  "handoffRadius": 4.75,
  "reentryRadius": 3.95,
  "spreadDegrees": 112
}
```

Because `normalizeSigilRadialGestureMenu()` spreads JSON geometry and then
spreads `source`, the JS state/default appearance values override the new JSON.
That violates the parent card's "JSON data defines everything about it" goal and
makes the JSON file describe a different menu from the one the user called the
good baseline.

Required correction:

- Put the current Sigil baseline geometry in
  `apps/sigil/renderer/radial-menu/sigil-radial-menu.json`.
- Refactor `state.js` and `DEFAULT_APPEARANCE` so their default
  `radialGestureMenu` geometry is derived from the resolved JSON baseline, not
  manually duplicated.
- Preserve user/saved appearance overrides: explicit appearance blobs should
  still override the JSON defaults when applied.
- Add a focused test that fails if the default state or default appearance
  radial geometry drifts from the resolved JSON geometry.

### 2. Item-Owned Modules Do Not Yet Own The Special Drawing/Animation Logic

The new `apps/sigil/renderer/radial-menu/items/*.js` modules currently contain
only small metadata objects. Meanwhile, `radial-gesture-visuals.js` still owns
the bespoke drawing/effect code, including:

- `createContextMenuGlyph()`
- `createAnnotationReticleGlyph()`
- `createAnnotationCameraGlyph()`
- `createWikiGraphGlyph()`
- nested neural tree geometry/material/effect creation and update
- fractal brain tree effect creation and update

That misses the user's explicit requirement that "all of the special cool
animations and drawing logic must be owned by the menu items, not wrapped up in
a monolithic file."

Required correction:

- Move item-specific glyph creation and effect creation/update into item-owned
  modules under `apps/sigil/renderer/radial-menu/items/`.
- Keep common utilities in a shared Sigil radial-menu helper module if needed,
  but avoid a single generic file owning the special item behavior.
- `radial-gesture-visuals.js` should orchestrate resolved menu data, project
  item placement, apply generic hover/activation transforms, and call item
  module hooks. It should not contain the special cog, reticle, camera, terminal
  part, wiki brain, nested tree, or fractal pulse implementation.
- Add or update tests so at least one item module creation/effect hook is
  exercised directly, and so the renderer obtains item behavior through the
  registry rather than hard-coded `item.id` branches.

Keep the correction pragmatic. If the full wiki brain effect split is too large
for one pass, move the concrete code into `items/wiki-brain.js` and leave
generic Three.js/material helpers in a sibling shared module. Do not leave it as
metadata only.

### 3. Nested Menu Stack Fundamentals Are Schema-Only

The schema accepts `children`, and the resolver includes `submenu_ref`, but
`packages/toolkit/runtime/radial-menu-config.js` does not recursively normalize
children or expose child logical items in a stack-friendly shape. The user
clarified that radial menu should be a richer expression of a basic DOM/AX menu
stack. The lower-level model needs to carry that structure through resolution.

Required correction:

- Normalize child items recursively.
- Preserve `children` or an equivalent `logical.children` structure on resolved
  logical items.
- Add a focused resolver test with a parent item containing at least one child,
  verifying labels/actions/defaults survive into the logical projection without
  importing Three.js.
- Do not add Zag to the 3D render loop. This is data/model projection work.

### 4. Toolkit Default JSON Schema Reference Is Incorrect

At reviewed head, `packages/toolkit/runtime/radial-menu/default-3d.json` uses:

```json
"$schema": "../../../shared/schemas/radial-menu-3d.schema.json"
```

From `packages/toolkit/runtime/radial-menu/`, that points under `packages/`,
not the repo root. Correct the relative path or use an absolute project schema
identifier consistently with local schema conventions.

## Scope

Likely implementation paths:

- `apps/sigil/renderer/radial-menu/sigil-radial-menu.json`
- `apps/sigil/renderer/radial-menu-defaults.js`
- `apps/sigil/renderer/state.js`
- `apps/sigil/renderer/appearance.js`
- `apps/sigil/renderer/radial-menu/item-registry.js`
- `apps/sigil/renderer/radial-menu/items/*.js`
- optional shared helpers under `apps/sigil/renderer/radial-menu/`
- `apps/sigil/renderer/live-modules/radial-gesture-visuals.js`
- `packages/toolkit/runtime/radial-menu-config.js`
- `packages/toolkit/runtime/radial-menu/default-3d.json`
- tests adjacent to the changed behavior

## Hard Boundaries

- Do not add daemon Swift changes.
- Do not add Zag to the Three.js render hot path.
- Do not rename Sigil radial actions, item ids, or labels.
- Do not remove current live radial behavior; preserve the existing baseline
  layout while moving its source of truth.
- Do not add npm dependencies.
- Do not widen into unrelated Sigil Studio, Agent Terminal, or context-menu
  work.

## Verification

Run the focused checks:

```bash
node --check apps/sigil/renderer/radial-menu-defaults.js
node --check apps/sigil/renderer/live-modules/radial-gesture-menu.js
node --check apps/sigil/renderer/live-modules/radial-gesture-visuals.js
node --check packages/toolkit/runtime/radial-menu-config.js
node --test tests/toolkit/runtime-radial-menu-config.test.mjs
node --test tests/renderer/radial-gesture-menu.test.mjs
node --test tests/renderer/radial-gesture-visuals.test.mjs
node --test tests/renderer/radial-menu-target-surface.test.mjs
node --test tests/renderer/radial-object-control.test.mjs
node --test tests/renderer/radial-item-editor.test.mjs
node --test tests/schemas/*.test.mjs
bash tests/help-contract.sh
git diff --check
```

If `./aos ready` passes, rerun the live radial smoke:

```bash
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input.sh
```

## Foreman Review Evidence At `bc55b76255bc2a6f3f92ac9cf40a230ef80a93dc`

Passed locally on 2026-05-16:

```bash
node --check apps/sigil/renderer/radial-menu-defaults.js
node --check apps/sigil/renderer/live-modules/radial-gesture-menu.js
node --check apps/sigil/renderer/live-modules/radial-gesture-visuals.js
node --check packages/toolkit/runtime/radial-menu-config.js
git diff --check ae66ccffd96c1c853454471f3a79f18b50abac9f..bc55b76255bc2a6f3f92ac9cf40a230ef80a93dc
node --test tests/toolkit/runtime-radial-menu-config.test.mjs
node --test tests/renderer/radial-gesture-menu.test.mjs
node --test tests/renderer/radial-gesture-visuals.test.mjs
node --test tests/renderer/radial-menu-target-surface.test.mjs
node --test tests/renderer/radial-object-control.test.mjs
node --test tests/renderer/radial-item-editor.test.mjs
node --test tests/schemas/*.test.mjs
bash tests/help-contract.sh
./aos ready
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input.sh
```

The live smoke passed with `openedDestinationSurface=sigil-wiki-workbench`,
`radialSurfaceId=sigil-radial-menu-avatar-main`, and semantic target ids
`agent-terminal`, `annotation-mode`, `context-menu`, and `wiki-graph`.

If readiness is blocked, report the exact blocker and do not claim live visual
acceptance.

## Completion Report

Return:

- files changed;
- how Sigil default geometry now derives from JSON;
- which special drawing/effect routines moved to item-owned modules;
- how nested menu children are represented in `logical_items`;
- exact verification commands and pass/fail results;
- live radial smoke result or readiness blocker;
- any remaining compatibility wrappers and why they are still necessary.
