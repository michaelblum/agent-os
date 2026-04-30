# Recipe: AOS App Accessibility Surfaces

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
can discover it, and `aos do` can operate it through the daemon route when the
runtime is ready.

## Labels And Names

Keep visible labels and semantic names separate.

A visible label is part of the visual design. A semantic AX name is the stable
human-readable name exposed to accessibility clients and AOS perception. When a
control already has meaningful visible text, the semantic name can usually
match it. When the control is icon-only, gesture-driven, or rendered inside a
canvas, provide the semantic name through the accessibility layer instead of
painting duplicate text into the UI.

Do not use visible text as an agent marker. Do not stuff identifiers, action
ids, routing hints, or debug state into accessible names. Names should read like
Mac controls, for example `Open radial menu`, `Brush size`, or `Submit`, not
`sigil.radial.action.open.primary`.

Use descriptions or help text only for user-facing clarification. Use AOS
metadata for identity and routing.

## AOS Identity Metadata

AOS-specific identity belongs in stable metadata, not in labels.

Use metadata channels to answer "which app object is this?" while keeping the
AX name human-readable:

- DOM `id` for stable document identity
- `data-aos-ref` for the canonical AOS object reference
- `data-aos-action` for the daemon or app action id
- canvas id for the owning AOS canvas or child surface
- context groups for local scope such as menu, toolbar, panel, scene, or mode
- marks for non-DOM canvas objects that need spatial identity

Context groups should usually be represented both structurally and
semantically. For example, a radial menu can be an `AXMenu` or `AXGroup` with
`AXMenuItem` children, while `data-aos-ref`, `data-aos-action`, canvas id, and
marks carry the exact AOS routing identity.

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

- `./aos see --xray` exposes the expected role, semantic name, frame, state, and
  action.
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
3. Keep visible text, semantic names, and AOS identity metadata distinct.
4. Put AOS routing identity in `data-aos-ref`, `data-aos-action`, canvas ids,
   context groups, and marks.
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
