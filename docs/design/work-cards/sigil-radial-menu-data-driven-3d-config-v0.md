# Work Card: Sigil Radial Menu Data-Driven 3D Config V0

## Tracker

- User request: 2026-05-16, Sigil radial menu should become a JSON-defined,
  cascading, data-driven 3D radial menu with item-owned geometry and animation
  logic.
- Current reference implementation:
  `apps/sigil/renderer/live-modules/radial-gesture-visuals.js`
- Existing data facade:
  `apps/sigil/renderer/radial-menu-defaults.js`
- Existing generic radial gesture primitive:
  `packages/toolkit/runtime/radial-gesture.js`
- Existing activation transition contract:
  `packages/toolkit/runtime/radial-item-transition.js`

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Make Sigil's current radial menu prove the first V0 of a data-driven 3D radial
menu contract:

- the menu definition is represented as JSON data;
- the current Sigil visual language remains the default baseline for a 3D radial
  menu, except for item-specific labels/actions;
- geometry data, item modules, and animation/effect routines are separated into
  logical files and referenced by the main menu JSON;
- defaults cascade from menu to 3D item to model/part/effect level;
- Sigil overrides the default hover behavior so every hovered item scales to 2x,
  and the reticle plus settings/cog item spin like a wheel rather than like a
  coin;
- special drawing and animation logic moves out of the monolithic radial visuals
  file and into item-owned modules.

This is an implementation slice, not just a note. Keep it narrow enough to
finish and verify deterministically, but do not leave the new JSON contract as a
dead parallel fixture.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `docs/api/toolkit/runtime.md`
- `docs/design/aos-surface-stack-v0-integration-ledger.md`
- `docs/design/aos-surface-system.md`
- `apps/sigil/renderer/radial-menu-defaults.js`
- `apps/sigil/renderer/live-modules/radial-gesture-menu.js`
- `apps/sigil/renderer/live-modules/radial-gesture-visuals.js`
- `apps/sigil/renderer/live-modules/radial-object-control.js`
- `packages/toolkit/runtime/radial-gesture.js`
- `packages/toolkit/runtime/radial-item-transition.js`
- `packages/toolkit/runtime/stack-menu.js`
- `packages/toolkit/adapters/zag/menu.js`
- `tests/renderer/radial-gesture-menu.test.mjs`
- `tests/renderer/radial-gesture-visuals.test.mjs`
- `tests/renderer/radial-object-control.test.mjs`
- `tests/renderer/radial-item-editor.test.mjs`

## Rediscover State

```bash
git status --short --branch
./aos ready
./aos dev recommend --json
rg -n "radialGestureMenu|DEFAULT_SIGIL_RADIAL_ITEMS|hoverSpin|hoverProgress|createGlyph|nested-neural-tree|createAosZagMenu|createStackMenu" apps/sigil packages/toolkit tests docs
```

If `./aos ready` is blocked by macOS TCC/input-tap state, continue with the
deterministic implementation and report the blocker for live visual verification.
Do not run repeated ad-hoc repair loops.

## Current Observations

The current system already has several useful foundations:

- `packages/toolkit/runtime/radial-gesture.js` is a pure pointer geometry and
  phase model. Keep it generic and free of rendering, item labels, Sigil actions,
  Zag, and Three.js.
- `packages/toolkit/runtime/radial-item-transition.js` already provides a
  cascading activation transition contract for 3D radial item activation.
  Reuse this style for hover/default transforms rather than inventing a second
  unrelated transition shape.
- `apps/sigil/renderer/radial-menu-defaults.js` has clone/merge normalization by
  item id, but the source data is JavaScript, not JSON, and the default/Sigil
  split is not explicit.
- `apps/sigil/renderer/live-modules/radial-gesture-visuals.js` owns too much:
  fallback glyph creation, glTF loading, nested neural tree drawing, fractal
  pulse generation, material highlighting, hover scale, hover spin, and renderer
  orchestration all live in one file.
- Current hover behavior is hard-coded around `hoverProgress += ... * 0.22`,
  `1 + hoverProgress * 0.08`, and Y-axis hover spin. Treat those as the
  default baseline unless the JSON override says otherwise.
- Sigil's "settings" radial item appears to be the current `context-menu`
  cog/settings item. Use that mapping unless a better live item id is discovered.

## Required Data Contract

Create a real JSON source of truth for 3D radial menus. The exact filenames may
change after inspection, but the V0 should look approximately like this:

```text
packages/toolkit/runtime/radial-menu/default-3d.json
apps/sigil/renderer/radial-menu/sigil-radial-menu.json
shared/schemas/radial-menu-3d.schema.json
```

Add a small toolkit normalizer/resolver module, likely:

```text
packages/toolkit/runtime/radial-menu-config.js
```

The toolkit module must stay data-only and renderer-neutral. It may:

- load/merge plain JSON objects;
- resolve `extends`;
- validate required fields at runtime in a lightweight way;
- normalize cascading defaults;
- resolve hover/activation transform blocks into concrete values.

It must not import Three.js, Sigil modules, app actions, DOM, or Zag.

Update `docs/api/toolkit/runtime.md` with the consumer-facing contract when the
shape is settled. Because this is a cross-tool data contract, add or update the
schema under `shared/schemas/`.

## Menu Fundamentals And Render Expressions

Treat a 3D radial menu as a richer expression of a lower-level menu
representation, not as a separate product-only data type. The base menu data
should carry ordinary menu fundamentals that can be rendered as a DOM/AX menu
stack, a 2D command palette, or a 3D radial menu:

- stable menu id and optional parent/root id;
- ordered items with stable ids, labels, actions, disabled/hidden state, and
  optional checked/current state;
- nested children or submenu references, with enough structure to represent a
  stack path;
- keyboard/focus metadata where relevant, such as preferred initial item,
  typeahead text, shortcut labels, and close-on-select behavior;
- semantic role hints for ARIA/AX projection, without making ARIA the only
  runtime representation;
- action payload and target-surface descriptors for activation routing.

The 3D radial contract should be an expression layer on top of that base menu
model. It may add radial geometry, orbital placement, handoff/reentry behavior,
Three.js geometry refs, hover transforms, activation transitions, materials,
and item-owned effect modules. It should not duplicate label/action/disabled
state in a second incompatible shape.

This means the resolved menu should support two concurrent projections:

1. a visual Three.js radial renderer for the human-facing Sigil menu;
2. a DOM/AX menu-stack projection for agents, accessibility, keyboard, tests,
   and future non-3D surfaces.

For V0, the DOM/AX projection can be minimal: the existing radial child target
surface or a future semantic adapter should receive the same resolved logical
items and stack metadata that the Three.js renderer receives. Do not build a
full visual DOM duplicate of the radial menu unless that is the narrowest way to
make the semantics inspectable.

## Cascading Override Shape

Support granular cascading at these levels:

1. Toolkit default 3D radial menu.
2. App/menu override, here Sigil's main radial menu.
3. Menu-level 3D defaults.
4. Item-level 3D defaults.
5. Item model-level defaults.
6. Model part/effect/sub-model defaults.

Use JSON merge semantics for objects. Arrays should replace by default unless a
specific array field declares keyed merge behavior. Items should merge by stable
`id`, preserving the current `normalizeSigilRadialItems()` behavior.

The final resolved data should make these examples possible:

```json
{
  "kind": "aos.radial_menu_3d",
  "schema_version": "2026-05-16",
  "extends": "aos://toolkit/runtime/radial-menu/default-3d.json",
  "defaults": {
    "three": {
      "item": {
        "hover": {
          "progress": {
            "approach": "exponential",
            "factor": 0.22
          },
          "transform": {
            "scale": {
              "from": 1,
              "to": 1.08
            },
            "rotate": {
              "spin": {
                "axis": "y",
                "rate": 1.45
              },
              "degrees": {
                "x": 0.12,
                "z": 0.055
              }
            }
          }
        }
      }
    }
  }
}
```

Sigil's override should be data, not renderer code:

```json
{
  "extends": "aos://toolkit/runtime/radial-menu/default-3d.json",
  "defaults": {
    "three": {
      "item": {
        "hover": {
          "transform": {
            "scale": {
              "from": 1,
              "to": 2
            }
          }
        }
      }
    }
  },
  "items": [
    {
      "id": "context-menu",
      "three": {
        "item": {
          "hover": {
            "transform": {
              "rotate": {
                "spin": {
                  "axis": "z",
                  "rate": 1.45
                }
              }
            }
          }
        }
      }
    },
    {
      "id": "annotation-mode",
      "three": {
        "item": {
          "hover": {
            "transform": {
              "rotate": {
                "spin": {
                  "axis": "z",
                  "rate": 0.35
                }
              }
            }
          }
        }
      }
    }
  ]
}
```

Interpretation for V0:

- "all items scale up double their size on item hover" means each radial item
  reaches 2x while that specific item is hovered or selected. Do not globally
  scale unhovered siblings unless later product feedback explicitly asks for
  menu-wide hover expansion.
- "wheel instead of coin" should use the local/screen-facing spin axis after the
  model is normalized. For the current glyphs this is likely Z-axis spin, but
  verify visually when live AOS is available.
- Hover timing/easing defaults should preserve the current apparent behavior.
  The current behavior is frame-smoothed rather than duration-based, so it is
  acceptable for V0 to encode `approach: "exponential", factor: 0.22`.

## Geometry And Animation References

The main menu JSON should reference geometry and animation/effect routines by
stable ids, with optional file references where practical. Do not execute
arbitrary code paths from JSON. Use an allowlisted registry that maps known refs
to modules.

Support both separated and bundled item modules:

```json
{
  "id": "wiki-graph",
  "label": "Wiki Graph",
  "action": "wikiGraph",
  "geometry": {
    "type": "gltf",
    "src": "../assets/models/human-brain/scene.gltf",
    "module_ref": "sigil.radial.geometry.human-brain"
  },
  "effects": [
    {
      "ref": "sigil.radial.effect.nested-neural-tree",
      "config": {
        "holdExitDirection": "outward"
      }
    }
  ],
  "animation": {
    "hover": {
      "ref": "aos.radial.animation.hover-transform"
    }
  }
}
```

Separated mode is useful for generic glTF items that share hover transforms.
Bundled mode is useful for special items like the wiki brain, where geometry,
nested neural drawing, and per-frame pulse logic are tightly related.

Likely Sigil-owned modules:

```text
apps/sigil/renderer/radial-menu/items/context-menu.js
apps/sigil/renderer/radial-menu/items/agent-terminal.js
apps/sigil/renderer/radial-menu/items/annotation-reticle.js
apps/sigil/renderer/radial-menu/items/annotation-camera.js
apps/sigil/renderer/radial-menu/items/wiki-brain.js
apps/sigil/renderer/radial-menu/item-registry.js
```

After this slice, `radial-gesture-visuals.js` should orchestrate a resolved
menu and call item modules. It should no longer contain bespoke creation/update
logic for the cog, reticle, camera, terminal screen, wiki brain nested tree, or
fractal pulse except for thin compatibility wrappers if one is needed during the
migration.

## Sigil Behavioral Requirements

Keep the current menu item semantics and labels unless the user explicitly asks
for copy changes:

- `context-menu` still commits `contextMenu`.
- `agent-terminal` still commits `agentTerminal`.
- `annotation-mode` still commits `annotationMode`.
- `annotation-camera` still commits `annotationSnapshot` and remains hidden
  unless live annotation anchors exist.
- `wiki-graph` still commits `wikiGraph` and keeps its
  `wiki-brain-zoom-dissolve` activation transition.

Add Sigil hover overrides through JSON:

- every item uses hover scale `from: 1` to `to: 2`;
- `context-menu` spins like a wheel on hover;
- `annotation-mode` spins like a wheel on hover;
- preserve existing per-item slower hover spin rates for reticle/camera unless
  the new config explicitly overrides them;
- keep activation transition behavior separate from hover transforms.

## Toolkit Menu Stack And Zag Feasibility

Do not stack the 3D radial renderer directly on Zag in this V0, but do preserve
the design direction that radial menu is a rich projection of a basic menu
stack.

Zag is useful for DOM and accessibility semantics: keyboard navigation,
typeahead, roving focus, nested popover menus, and ARIA state. It is not a good
owner for radial pointer geometry, drag-to-handoff state, 3D orbit placement,
or per-frame Three.js animation. The current `radial-gesture.js` primitive is a
better home for radial pointer math.

Practical V0 decision:

- define or preserve the base menu representation underneath the 3D radial
  expression;
- keep `radial-gesture.js` as the radial pointer/phase model;
- keep Three.js rendering in Sigil item modules;
- use the JSON contract and toolkit resolver as the reusable menu-data layer;
- keep `createAosZagMenu()` available for DOM menu stacks such as Sigil context
  menu and future toolkit stack menus;
- expose the resolved radial menu's logical items to the child semantic surface
  or future AX adapter, so the 3D menu can be inspected and operated as a menu
  even though its visible expression is Three.js;
- do not put Zag in the visual render hot path.

Potential future benefit:

- a toolkit "menu stack" can use Zag for ordinary nested DOM menus and share
  the same base item/action/default vocabulary as 3D radial menus;
- a future radial menu accessibility adapter can map the same resolved logical
  menu into Zag-backed DOM/AX semantics without coupling visual animation to
  Zag;
- a future 2D menu, command palette, context menu, and 3D radial menu can all be
  different render expressions of the same lower-level menu data.

## Scope

Expected implementation areas:

- `shared/schemas/radial-menu-3d.schema.json`
- `docs/api/toolkit/runtime.md`
- `packages/toolkit/runtime/radial-menu-config.js`
- `packages/toolkit/runtime/radial-menu/default-3d.json`
- `packages/toolkit/runtime/index.js`, if exporting the resolver is appropriate
- `apps/sigil/renderer/radial-menu-defaults.js`
- `apps/sigil/renderer/radial-menu/sigil-radial-menu.json`
- `apps/sigil/renderer/radial-menu/item-registry.js`
- `apps/sigil/renderer/radial-menu/items/*.js`
- `apps/sigil/renderer/live-modules/radial-gesture-menu.js`
- `apps/sigil/renderer/live-modules/radial-gesture-visuals.js`
- `apps/sigil/renderer/live-modules/radial-object-control.js`, only if object
  registry metadata needs to reference the new JSON/module ids
- focused renderer/toolkit tests

Adjust exact filenames after reading the code. Preserve stable public imports
where existing modules and tests expect them. For example,
`radial-menu-defaults.js` may become a compatibility facade over the JSON source
if that minimizes churn.

## Hard Boundaries

- Do not add daemon Swift branches or Sigil-named daemon behavior.
- Do not move Sigil product expression into `packages/toolkit/`.
- Do not make toolkit runtime import Three.js, DOM, app actions, or Zag.
- Do not introduce arbitrary dynamic import/eval from untrusted JSON.
- Do not add npm dependencies.
- Do not rename actions, semantic ids, or item labels unless required by a
  failing test and called out in the completion report.
- Do not remodel the Sigil radial target child surface except to keep semantic
  item data in sync with the resolved menu.
- Do not update parked legacy Sigil `workbench/` or `chat/` paths unless a
  direct import breaks and the fix is mechanical.

## Verification

Run focused deterministic checks first:

```bash
node --check apps/sigil/renderer/radial-menu-defaults.js
node --check apps/sigil/renderer/live-modules/radial-gesture-menu.js
node --check apps/sigil/renderer/live-modules/radial-gesture-visuals.js
node --check packages/toolkit/runtime/radial-menu-config.js
node --test tests/renderer/radial-gesture-menu.test.mjs
node --test tests/renderer/radial-gesture-visuals.test.mjs
node --test tests/renderer/radial-object-control.test.mjs
node --test tests/renderer/radial-item-editor.test.mjs
node --test tests/toolkit/runtime-radial-gesture.test.mjs
git diff --check
```

Add focused tests for:

- JSON config loading and cascading merge order;
- base menu fields surviving resolution into the 3D radial expression;
- item-id keyed overrides;
- hover scale resolving to 2x for Sigil items;
- `context-menu` and `annotation-mode` resolving hover spin to the wheel axis;
- resolved logical items being available for DOM/AX or radial child-surface
  projection without importing Three.js;
- current stale saved config normalization still merging with current defaults;
- renderer snapshots still include item geometry/effects metadata expected by
  existing tests and diagnostics.

If `./aos ready` passes, run a bounded live smoke:

```bash
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input.sh
```

Then visually inspect or capture the Sigil radial menu hover behavior:

- hover any item and confirm it scales to 2x at full hover;
- hover the cog/settings item and confirm it spins like a wheel;
- hover the reticle item and confirm it spins like a wheel;
- confirm wiki graph activation still opens the expected surface.

If `./aos ready` is blocked, report the exact readiness blocker and do not claim
live visual acceptance.

## Completion Report

Return a concise report with:

- files changed;
- the final JSON file paths and schema path;
- how the default toolkit 3D radial config and Sigil override are connected;
- which item-owned modules now own special geometry/effects;
- exact tests run and pass/fail results;
- live AOS radial smoke result, or the exact readiness blocker;
- any compatibility wrapper that remains and why;
- any follow-up slice needed for broader toolkit menu stack or Zag adoption.
