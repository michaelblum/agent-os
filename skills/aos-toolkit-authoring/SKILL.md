---
name: aos-toolkit-authoring
description: Choose and compose AOS toolkit controls, panels, workbenches, components, DesktopWorld scenes, radial menus, and trusted visual extensions. Trigger when an agent must decide which AOS toolkit layer owns a reusable UI or visual behavior before implementing it.
---

# AOS Toolkit Authoring

Use this skill as the router for reusable AOS surfaces. Product content and
semantics remain in the consumer. AOS owns reusable surface, input, lifecycle,
inspection, and authoring mechanics.

## Choose The Smallest Boundary

1. Use **controls** for buttons, fields, sliders, menus, toggles, tabs, and
   other semantic DOM controls inside an existing interactive surface.
2. Use **panel/window policy** for chrome, movement, resize, placement,
   minimize, restore, split panes, and `StageAffordance`.
3. Use a **workbench subject** when agents and humans must inspect or edit a
   durable object through descriptors, evidence, and bounded mutations.
4. Use a stock **component** when AOS already owns the complete reusable
   surface, such as Surface Inspector, Render Performance, or Spatial
   Telemetry.
5. Use a data-only **scene cartridge** for DesktopWorld objects, gestures,
   stock interaction responses, numeric signals, and animations.
6. Use `aos-radial-menu-authoring` for logical, 2D, native-semantic, or 3D
   radial menus and item behavior.
7. Use a reviewed **scene extension** only for trusted custom Three.js
   geometry, shaders, effects, or per-frame rendering.
8. Use isolated standalone WebGL when executable visual code must not share
   the AOS renderer realm.

Read the surface decision tree before creating a new WebView or input layer:

```text
docs/guides/aos-surface-interaction-decision-tree.md
```

## Use Public Entry Points

Use explicit package exports instead of toolkit internals:

```js
import { createButton } from '@agent-os/toolkit/controls'
import { createStageAffordance } from '@agent-os/toolkit/panel'
import { createDesktopWorldSceneSession } from '@agent-os/toolkit/scene/runtime'
import { compileSceneRadialMenuDefinition } from '@agent-os/toolkit/scene/radial-menu'
```

Confirm the current export in `packages/toolkit/package.json`. If the needed
behavior is reusable but has no public export, add a focused public contract,
types, docs, and deterministic tests. Do not import a private file into a
consumer as a shortcut.

## Preserve Ownership

- AOS owns generic input, layout, display reconciliation, lifecycle, budgets,
  telemetry, native semantics, and reusable editing mechanics.
- Consumers own names, product actions, prompts, visual recipes, state
  vocabulary, approvals, and branded defaults.
- Toolkit skills explain workflows; API docs, schemas, source manifests, and
  tests remain the contract authority.
- Do not make AOS stock parameters absorb one product's shaders or effects.
  Put trusted product rendering in a reviewed extension.

## Verify The Result

1. Test the smallest package boundary first.
2. Run the documented scaffold or example from an empty directory.
3. Validate semantic state independently from rendered appearance.
4. Inspect resource, interaction, and performance facts through AOS DevTools.
5. Prove cleanup, suspension, context-loss handling, and idempotent disposal.
6. Keep live daemon, native input, and TCC acceptance separate from static
   authoring validation.

## References

- `docs/api/toolkit.md`
- `docs/api/toolkit/controls.md`
- `docs/api/toolkit/panel-window.md`
- `docs/api/toolkit/workbench.md`
- `docs/api/toolkit/components.md`
- `docs/api/toolkit/scene.md`
- `docs/api/toolkit/radial-menu-authoring.md`
- `docs/guides/aos-surface-interaction-decision-tree.md`
