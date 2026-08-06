# Guide: AOS App Accessibility Surfaces

Use this recipe when building or reviewing controls for AOS apps, toolkit
components, canvases, WebGL scenes, or Three.js surfaces.

The goal is for agents and humans using assistive technology to perceive and
operate the same app controls through standard macOS accessibility semantics,
without adding agent-only visual hints to the UI.

## Default Model

Treat macOS Accessibility as the default control model. Every actionable or
meaningful control should expose:

- a standard role
- a semantic name
- a screen frame
- enabled, disabled, selected, checked, expanded, or value state when relevant
- the normal accessibility action for the control

Prefer ordinary roles when they fit: `AXButton`, `AXMenu`, `AXMenuItem`,
`AXCheckBox`, `AXSlider`, `AXTextField`, `AXGroup`, `AXStaticText`, and
`AXImage`. If a custom visual does not map perfectly, choose the closest
standard role first and document the gap before inventing an AOS-only
semantic.

The visible implementation can be HTML, canvas, WebGL, Swift, or toolkit code.
The accessibility surface should still behave like a Mac app: `aos see --xray`
can expose its raw bounded AX elements, and toolkit/app policy can classify
them for selection, annotation, or action. `aos do` can operate it through the
daemon route when the runtime is ready.

For AOS-owned canvases, `aos see capture --canvas <id> --xray` also exposes a
`semantic_targets` array. Treat that as a projection of the same standard facts,
not a separate agent language: role and name come from AX/ARIA, bounds come from
the DOM frame, state comes from ARIA/native disabled/value state, and AOS
metadata supplies state-scoped refs, descriptor identity, provenance, and
primitive action metadata.

## Labels And Names

Keep visible labels and semantic names separate.

A visible label is part of the visual design. A semantic AX name is the
human-readable presentation name exposed to accessibility clients and AOS
perception. When a control already has meaningful visible text, the semantic
name can usually match it. When the control is icon-only, gesture-driven, or
rendered inside a canvas, provide the semantic name through the accessibility
layer instead of painting duplicate text into the UI.

Do not use visible text as an agent marker. Do not stuff identifiers, action
ids, routing hints, or debug state into accessible names. Names should read like
Mac controls, for example `Open radial menu`, `Brush size`, or `Submit`, not
`example.radial.action.open.primary`.

Use descriptions or help text only for user-facing clarification. Use AOS
metadata for state-scoped refs, current routing, and future Locator hints.

## AOS Target Metadata

AOS-specific routing, provenance, and future Locator facts belong in metadata,
not in labels.

Use metadata channels to relate an observed control to app state while keeping
the AX name human-readable. The current descriptor split is:

- `data-aos-ref` contributes the `ref` component of a state-scoped Observation
  Ref. The capture response's top-level `state_id` completes the pair; a stale
  pair must reject.
- `data-semantic-target-id` contributes current source-payload metadata. It is
  not a currently emitted `target.target_id` or durable identity.
- canvas and surface metadata contribute current provenance and may later help
  form a Locator owner namespace after the runtime/schema migration.
- `data-aos-actions` and `data-aos-primitive-actions` name public primitive
  capabilities. Singular `data-aos-action` is a current app-local action id; it
  does not populate the public `actions` list.
- DOM `id`, selectors, bounds, source paths, and parent canvas ids are
  provenance/current-address evidence or future Locator hints, not identity by
  themselves.
- context groups and marks can later help build structural Locator facts for
  non-DOM canvas objects.

Context groups should usually be represented both structurally and
semantically. For example, a radial menu can be an `AXMenu` or `AXGroup` with
`AXMenuItem` children, while `data-aos-ref`, `data-semantic-target-id`,
`data-aos-action`, canvas id, and marks carry current AOS routing/provenance and
future Locator hints.

This lets `aos see --xray`, traces, tests, and future structured perception
join semantic controls back to app state without label pollution.

## Canvas Companion Layers

Canvas, WebGL, and Three.js controls need a semantic companion layer whenever a
drawn object is actionable, focusable, stateful, or important for task context.

Common companion patterns:

- transparent HTML controls aligned over rendered geometry
- child interaction surfaces that expose standard AX roles for drawn controls
- toolkit-owned semantic overlays generated from scene or component state
- a structured menu/list companion for non-spatial command sets
- canvas object marks tied to semantic companions for spatial targets

The companion layer must route to the same behavior as the visual interaction.
It must not become a second DOM-only shortcut, a debug backdoor, or a parallel
interaction model. Pointer input, keyboard input, AX actions, and `aos do`
should converge on the same command path whenever possible.

Keep companion state synchronized with the visual scene: bounds, focus order,
enabled state, selection, pressed state, checked state, slider value, text
value, and menu expansion should update together. A visually hidden companion
must remain AX-visible when it represents a real control; do not hide it from
the accessibility tree.

## Verification

Start with the runtime gate:

```bash
./aos ready
```

If readiness is blocked, report the blocker or follow the repo repair handoff
before claiming runtime verification. In installed mode, use the installed
`aos` binary instead of repo `./aos`.

For representative controls, verify:

- `./aos see --xray` exposes raw role/name/value/frame/action evidence. For
  AOS-owned canvases, check the response's top-level `state_id` plus each
  `semantic_targets` entry's required canvas Locator `handle`, primitive
  `actions`, provenance, and current state. Canvas Locators do not carry or
  accept `state_id`.
- `./aos do` can operate the control through the daemon/AOS route, not only
  through app-local JavaScript or a synthetic unit test.
- Screenshots show the intended visual design, with no duplicate agent labels
  or debug identifiers painted into the UI.
- Canvas/WebGL companion bounds line up with the visible control and any marks
  or context groups used for spatial identity.
- Real mouse, keyboard, focus, or drag input is checked when the bug or feature
  depends on real event routing.

Synthetic tests are useful for deterministic state and routing logic. They are
not enough for defects that were observed through real input, visual placement,
AX discovery, or daemon-routed actions.

## Checklist

1. Pick the standard AX role before designing custom metadata.
2. Give every meaningful control a concise semantic name.
3. Keep visible text, semantic names, state-scoped refs, and future Locator
   facts distinct.
4. Put current AOS routing/provenance facts in `data-aos-ref`,
   `data-semantic-target-id`, `data-aos-action`, `data-aos-actions`, context
   groups, and marks; do not claim they already emit a Locator.
5. Add a semantic companion layer for canvas/WebGL/Three.js controls.
6. Route companion actions through the same command path as visible input.
7. Verify with `./aos ready`, `./aos see --xray`, `./aos do`, screenshots, and
   real-input checks when relevant.

## Related Work

- #165 tracks the AOS app accessibility surface contract epic.
- #137 tracks macOS Accessibility resources as first-class AOS capability
  references.
- #136 tracks structured DOM perception for AOS canvases.
- #93 tracks AX/xray and multi-bundle semantics for interaction exports.
