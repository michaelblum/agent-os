---
name: sigil-composition-model
description: Avatars are compositions of multiple shapes — primary + N children with relative transforms. Omega is just child #1.
type: project
status: validated-deferred
---

# Compositional Avatar Model

An avatar is not one shape + one "omega." It's a scene graph of N shapes composed together.

## Pattern (2026-04-07)

- Primary shape (the main polyhedron)
- N child shapes, each with:
  - Own geometry (shape type, stellation, params)
  - Own appearance (colors, opacity, skin)
  - Transform relative to the primary (position, rotation, scale)
  - Motion behavior (counter-spin, orbit, lock position, etc.)
  - Ghost trail settings (count, fade, mode)
- Needs sensible limits (can't have 12 animated shapes swirling around)
- Children are "attached" to the primary in some spatial relationship

## Maps to Celestial v2 architecture

The v2 ECS pattern (EntityTree + parent-child + per-entity components) is exactly this.
The v2 PropertiesPanel already shows component panels contextually per selected entity.

## What this means for the studio

- Shape panel becomes "controls for the currently selected shape in the composition"
- Need a shape tree/list to select which shape you're editing
- Add/remove shapes from the composition
- Transform controls for child shapes (position/rotation/scale relative to parent)
- Effects panel stays composition-wide (aura, phenomena apply to the whole avatar)

## Current state

"Omega" in the v1 codebase is the first instance of this pattern — one hard-coded secondary shape.
The omega controls exist in JS (ui.js event listeners, renderer/omega.js) but have NO sidebar HTML.
They're only accessible via right-click context menu.

## Implication for current cleanup

Don't surface omega as a special case in the sidebar. Either:
- Leave omega as context-menu-only for now
- Or introduce it as "Secondary Shape" with a UI pattern that generalizes to N shapes later

The full composition system (entity tree, add/remove, per-shape editing) is future work.

## When to revisit

When the roster and per-agent config layer is being designed — composition is part of the avatar config model.
