# AOS 3D Object Graph Platform Contract

Status: V0 design note for follow-on implementation slices. The accepted
descriptor/update contract and Phase 6 resource-lifecycle closure now live in
`docs/design/visual-object-descriptor-contract-v0.md` and
`docs/dev/reports/aos-visual-object-architecture.md`. This note remains useful
for object-graph subject boundaries and follow-on adapter direction, but its
avatar inventory predates the accepted descriptor loop and should not override
the current descriptor, controller, form-binding, and lifecycle contracts.

2026-06-02 routing update: the repo now has an avatar object-control adapter and
the accepted `21dc331d` detached Sigil avatar controls panel. New live evidence
showed duplicate Avatar/Sigil surfaces visible across displays, so the next
route is not drag correction by itself. First add AOS-first visible-surface /
orphan-window observability, then make toolkit panel placement/final-frame
policy explicit, then add Sigil-owned avatar avoidance only if the evidence
requires it. After those gates, return to live panel drag correction and migrate
the detached panel from private `sigil.avatar_panel.*` messages to the existing
`visual_object_descriptors` / `canvas_object.*` resource contract. Treat the
older follow-on cards named at the end of this note as historical until
refreshed. Owned Sigil/toolkit callers should be migrated in-slice and stale
private aliases should be deleted unless a named external boundary requires
compatibility.

This note turns the current Sigil "3D thing" direction into a platform
contract. It does not replace the existing `canvas_object.*` work. It names the
next layer above it so radial menu items, the Sigil avatar, and future app-owned
3D subjects can share an editing loop without moving Sigil product behavior into
the daemon or making Sigil generic.

## Layer Ownership

The AOS daemon/kernel owns native capability and generic contracts: canvas
lifecycle, content serving, input streams, display topology, generic message
fan-out, semantic capture, and routing primitives. It must not know Three.js,
Sigil avatar state, radial menu item definitions, tesserons, phenomena, or
context menu product behavior. If object graph editing needs native help, the
daemon primitive should still be generic, such as retained message delivery,
canvas lifecycle, input regions, or semantic target capture.

The toolkit owns the reusable object graph and editing contract. That includes
subject descriptors, object registries, transform/effects/control descriptors,
isolated preview stages, stock controller panels, action routing envelopes, and
the owner-publishes / controller-patches / owner-acknowledges lifecycle. The
toolkit may provide default panels and workbench shells, but the owner canvas or
app module remains responsible for validating patches and updating concrete
renderer state.

Sigil owns product expression. For this contract, that means avatar identity,
radial item modules, tesseron choices, phenomena choices, default appearance,
context menu composition, diagnostic buttons, import/save/copy commands, and
app-specific action semantics. Sigil can publish object graphs and consume
toolkit panels, but it should not fork a private parallel object editor when the
same capability belongs in the toolkit.

## Contract Shape

The V0 "3D object graph" grows out of `canvas_object` rather than replacing it.
`canvas_object.registry`, `canvas_object.transform.patch`,
`canvas_object.transform.result`, `canvas_object.effects.patch`, and
`canvas_object.effects.result` remain the generic wire contract for canvas-owned
objects. They already provide stable object ids, parent ids, renderer-neutral
kind strings, visible state, transform descriptors, capability flags,
owner-validated patch commands, result status, and correlation ids.

The next layer should be a toolkit subject descriptor on top of that wire
contract. A V0 3D subject needs:

- `subject_id`, `subject_type`, label, owner canvas id, source reference,
  display mode, preview profile, and persistence kind.
- Graph nodes with stable `object_id`, optional `parent_object_id`, kind,
  label, semantic role, source module/config reference, visibility, locked and
  read-only flags, and capability flags.
- Local transform descriptors using existing `position`, `scale`, and
  `rotation_degrees` shapes, plus optional world transform snapshots when a
  preview or inspector can compute them.
- Renderer-neutral geometry, model, material, and effect descriptors. These are
  names, refs, parameter schemas, and human-readable descriptions, not Three.js
  objects.
- Editable transform controls and effect controls with control ids, labels,
  control type, value, min/max/step/options, value schema, and patch target.
- Action bindings for app-owned behavior. Actions describe ids, labels, target
  owner, payload schema, and whether the action is preview-safe; the app owns
  execution.
- Result semantics: `applied`, `rejected`, `stale`, and `error`, with
  `request_id`, target, accepted values, and an error object containing code,
  message, and field path when available.

The split should stay simple. The generic wire fields stay in
`canvas_object.*`: registry snapshots, target addresses, transform patches,
effect patches, visibility patches, result statuses, and validation error
shape. A higher-level toolkit subject can add subject identity, source refs,
preview profiles, grouped facets, action descriptors, persistence metadata, and
graph-level affordances. A new schema is only warranted once the avatar adapter
and radial item editor both need the same fields that do not belong in the
plain `canvas_object` registry.

## Avatar Adapter Inventory

The current avatar/context-menu path is grounded in these files:
`apps/sigil/context-menu/menu.js`, `apps/sigil/renderer/state.js`,
`apps/sigil/renderer/appearance.js`, `apps/sigil/renderer/live-modules/main.js`,
`apps/sigil/renderer/geometry.js`, `apps/sigil/renderer/phenomena.js`,
`apps/sigil/renderer/tesseron.js`, `apps/sigil/renderer/lightning.js`,
`apps/sigil/renderer/magnetic.js`, `apps/sigil/renderer/omega.js`, and
`apps/sigil/renderer/particles.js`.

Base avatar geometry and material state is object graph state. The primary
avatar node should expose shape/geometry type, stellation, base size/scale,
opacity, edge opacity, mask/interior-edge/specular flags, skin, idle spin,
z-depth, shape parameter packs for tetartoid/torus/cylinder/box, face and edge
colors, and transform-like size controls. Today these live in `state.js` and
`DEFAULT_APPEARANCE`, are applied through `applyAppearance()`, and rebuild
renderer objects through `updateGeometry()`, `applySkin()`, and
`updateAllColors()`.

Current descriptor-driven avatar edits are narrower than this inventory and
should be read through the accepted descriptor contract. Primary stellation now
routes through `updatePrimaryStellation()` for the positive-factor morph-target
subset, primary tesseron proportion routes through
`updatePrimaryTesseronProportion()`, and appearance edits can use
`updatePrimaryAppearance()` where covered. Shape changes, omega geometry, and
other structural changes may still use full geometry sync hooks.

Tesseron controls are object graph geometry/material patches. Primary and omega
tesserons include enabled, proportion, match-mother, edit target, and child
opacity/edgeOpacity/mask/interior/specular fields. `tesseron.js` owns
normalization and supported-shape rules, while `geometry.js` creates child
depth, core, wireframe, and link geometries.

Aura, pulsar, gamma, accretion, neutrino, lightning, magnetic, omega, wormhole,
and trail-style controls are mostly effect patches. Aura includes reach,
intensity, pulse, spike, depth, base scale, core fade, wobble count/scale/orbit,
speed, chaos, and mode. Phenomena include pulsar, gamma, accretion, and neutrino
enabled/count/height/width/turbulence fields and renderer update hooks in
`phenomena.js`. Lightning includes origin, solid block, bolt length, frequency,
duration, branching, and brightness. Magnetic includes enabled, tentacle count,
speed, and wander. Omega is a secondary object node with its own geometry,
tesseron, material, scale, counterspin, lock position, inter-dimensional state,
ghost count, ghost mode, duration, and lag. Wormhole and line travel settings
are transition/effect controls: capture radius, durations, distortion, twist,
zoom, shading, travel object, particles, flash/white/starburst/lens, line
duration, delay, repeated objects, object lifetime, lag, scale, and trail mode.
Motion trails include enabled/count/opacity/fade/style.

World and window-level controls are product context, not object graph state,
unless a later shared stage needs them. Grid mode/rendering settings can be a
world-context facet. Avatar hit radius, drag threshold, drag cancel radius, goto
ring, menu ring, radial gesture config, and avatar window level are Sigil
interaction/windowing context. Context menu utility actions such as Surface
Inspector, Interaction Trace, Render Performance, Console Log, Copy, Save, and
Import are app actions, not object patches.

Persistence currently runs through `appearance.js`: `DEFAULT_APPEARANCE` is the
canonical appearance blob, `applyAppearance()` writes into `state.js` and calls
renderer update hooks, and `snapshotAppearance()` returns the persisted shape.
`main.js` loads agent appearance, marks appearance changes from the context
menu, snapshots current appearance, and applies inbound appearance payloads.
The adapter should use those homes first instead of inventing a second store.

Renderer ownership stays in Sigil. `main.js` owns avatar boot, state machine,
context menu creation, appearance loading, and sync hooks. `geometry.js` owns
primary and omega mesh rebuilds. `phenomena.js` owns pulsar/gamma/accretion/
neutrino groups. `tesseron.js` owns tesseron math and normalization. The object
graph adapter should call these existing update seams after accepted patches.

## Context Menu Migration Path

The context menu should move toward data/action-driven controls in stages while
preserving the current UI and product feel.

1. Extract a descriptor map beside `menu.js` that describes existing controls:
   id, label, panel/card, control type, current state path, patch target,
   renderer sync hook, persistence behavior, and action id when applicable.
   The rendered DOM and event handlers can remain unchanged at this stage.

2. Route event handlers through a single update function. That function
   resolves the descriptor, validates/coerces the value, applies either a
   `canvas_object`/object-graph patch or a Sigil action, calls the existing
   renderer sync hook, and invokes `onAppearanceChange` when the field is
   persisted.

3. Publish an avatar object graph registry from `avatar-main` without changing
   menu behavior. The menu can still mutate state directly through the adapter,
   but external toolkit panels can inspect the same object graph.

4. Convert controls that are pure object properties to descriptor-generated
   update routing. Shape, tesseron, material, aura, phenomena, lightning,
   magnetic, omega, wormhole, and trail controls should become patch-backed.
   Utility buttons and diagnostics remain Sigil actions.

5. Let the context menu consume the same descriptors as toolkit object panels
   where appropriate, while keeping Sigil's tabs, cards, copy/save/import
   commands, and visual composition app-owned.

For each control, the final route is explicit: toolkit control descriptor,
`canvas_object` or object-graph patch when editing object/effect state,
Sigil-owned action handler when invoking product behavior, persisted appearance
update through `snapshotAppearance()`/agent appearance when durable, and
renderer sync through the current `updateGeometry`, `updateOmegaGeometry`,
`updateAllColors`, `updatePulsars`, `updateGammaRays`, `updateAccretion`,
`updateNeutrinos`, or magnetic/lightning/omega hooks.

## Shared 3D Editor Path

The radial item editor is already the first "3D thing editor" proof. Its model
publishes a workbench subject, builds a `canvas_object.registry`, applies
transform and effects patches, produces a preview snapshot, and exports a
lock-in payload. It should become one consumer of a more general toolkit
subject/stage loop, not a genericized Sigil replacement.

The shared editor path should load a subject descriptor and choose compatible
facets: object registry, object controls, preview stage, source/export, and
app-owned actions. A radial menu item subject loads current radial item config
and keeps radial item Three.js creation/update logic in Sigil modules. An avatar
subject loads the avatar object graph adapter and keeps avatar mesh/effect
creation/update logic in `apps/sigil/renderer/`. A future app-owned 3D subject
publishes the same contract but owns its renderer and persistence.

The editor shell should not learn Sigil-specific geometry. It should know how
to subscribe to registries, render object trees, send transform/effects patches,
display owner results, host an isolated preview canvas, and surface export or
lock-in actions supplied by the subject. App modules keep concrete Three.js
construction, validation, and persistence logic.

## Follow-On Slices

Historical follow-on cards from the original design note:

- `docs/design/work-cards/sigil-avatar-object-graph-adapter-v0.md`
- `docs/design/work-cards/sigil-context-menu-data-driven-controls-v0.md`
- `docs/design/work-cards/sigil-3d-thing-editor-subjects-v0.md`

These cards are not current route targets without refresh. Current sequence:

1. Accept `docs/design/work-cards/gdi-aos-visible-surface-orphan-audit-v0.md`.
2. Refresh toolkit panel placement/final-frame reporting, then add Sigil-owned
   avatar avoidance only if the evidence requires it.
3. Refresh and accept
   `docs/design/work-cards/gdi-toolkit-panel-live-drag-correction-v0.md`.
4. Route
   `docs/design/work-cards/gdi-sigil-avatar-panel-resource-contract-migration-v0.md`.
5. Refresh Wiki graph browser, 3D editor subject, and semantic target cleanup
   work against the accepted resource migration head.
