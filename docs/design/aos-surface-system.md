# AOS Surface System

## Intent

AOS surfaces should share a small set of platform concepts instead of each app
inventing its own window chrome, controls, drag behavior, and overlay model.
The goal is a cohesive agent-first surface system that remains modular enough
for apps such as Sigil to theme and extend.

## Concepts

### Canvas Primitive

The daemon owns canvas lifecycle: create, update, focus, suspend, resume,
remove, parentage, cascade, and display placement. Canvas primitives should stay
plain and policy-light.

### Toolkit Panel Shell

The toolkit owns reusable panel chrome for normal interactive surfaces:

- title bar as drag handle
- title truncation
- close action
- minimize action and restore chip
- optional maximize and restore within the current display work area
- focus and dirty-state affordances
- window-action slots for app-specific lifecycle controls
- theme tokens with app override support

The shell is for panels and workbenches, not for ambient desktop visuals.

### Toolkit Workbench Toolbar

Workbench controls are not window chrome. Editor actions such as selected item,
axes, preview zoom, reset view, save, or lock-in belong in a reusable toolbar
that can either span a full workbench or attach to one pane.

Toolbars should support:

- leading, middle, and trailing sections
- whole-workbench placement under panel chrome
- pane-local placement inside preview, editor, or controls panes
- compact and regular densities
- the toolkit control pack without app-specific restyling

### Toolkit Surface Division

Workbenches need a general composition vocabulary for dividing a surface before
they need app-specific editors. The vocabulary should describe layout behavior
without knowing what the panes contain:

- split orientation: left-right or top-bottom
- divider mode: free drag, fixed, or absent
- pane constraints: min/max width or height
- pane state: open, closed, collapsed to a minimized bar, or restored
- docking state: attached to the parent surface or broken out into its own
  surface with a reversible break-in path

The 3D radial item workbench is the first concrete target: a preview pane on the
left, a right controls pane, and inside that controls pane an object/layer list
beside transform triplets. The same primitive should later support Markdown
preview/source, workflow graph/source, and report/slides workbenches.

The first promoted slice is `createSplitPane` / `SplitPane` in
`packages/toolkit/panel/`: a reusable draggable separator with min/max pane
constraints, keyboard semantics, optional ratio restore, and open/closed pane
state. Collapsing to minimized bars and breakout behavior build on top of this
primitive instead of being separate editor-specific layout code.

The object/layer list should treat grouped scene objects as a tree, not a flat
bag. A whole-composition group can own child meshes, and later it can own
bespoke effects, reveal thresholds, cursor-coupled animation, particles, and
other runtime behaviors as separately addressable edit subjects. For now those
effect descriptors are natural-language annotations only; effect editing belongs
to the future human-agent workbench loop rather than the transform panel.

### Toolkit Control Pack

The toolkit should provide a basic, themeable control set:

- buttons and icon buttons
- checkboxes and toggles
- selects/dropdowns
- sliders and range controls
- number fields with macOS-like step/scroll behavior
- segmented controls and tabs
- list rows with selection and visibility affordances

The Sigil radial item workbench is the current visual reference for the default
AOS theme: compact title bars, clear typography, restrained glow, and richer
control affordances.

### Desktop-World Stage

A daemon-managed desktop-world stage is a transparent, click-through,
display-spanning visual layer host. It is for visuals that belong to the whole
desktop, such as avatars, radial menu graphics, drag ghosts, transfer outlines,
spotlights, and transient agent telemetry.

Normal inputs, text editors, forms, and workbenches do not live on this stage.
They remain real interactive canvases.

### Interaction Surface

Interactive targets remain explicit surfaces: small hit areas, semantic target
canvases, context menus, panels, or focused editor windows. They may be bound to
desktop-world visual layers but should not be hidden inside the visual stage.

### Visual/Interaction Binding

A binding records which interactive surface controls or represents which visual
layer. Sigil already has this pattern informally:

- avatar visual layer plus avatar hit target
- radial menu visuals plus radial item semantic target surface
- context menu as a separate interactive panel

The platform should eventually make these bindings visible to tools such as
Canvas Inspector and future surface managers.

## Cross-Display Panel Policy

Panels and workbenches should be single-display surfaces at rest. They should
not become desktop-world canvases by default.

During drag, AOS should preserve macOS-like transfer behavior:

1. Dragging within the origin display moves the live canvas normally.
2. When the cursor crosses a display seam before the panel can fit on the
   destination display, keep the origin canvas visible and dim it.
3. Show a temporary outline on the destination display, fully clamped inside
   the destination visible bounds.
4. If released while the outline is active, move the live canvas to the outline
   rect.
5. If the drag continues far enough that the live canvas can fit directly on the
   destination display, remove the outline and move the live canvas.
6. Clamp final placement so the title bar and window controls remain visible.

The temporary outline can initially be a short-lived canvas. Later it can become
a layer on the desktop-world stage.

## Surface Capabilities

AOS should not recreate macOS window management. It should expose the small set
of capabilities needed by agent-created canvases and workbenches:

- surface states: normal, minimized, maximized within the current display work
  area, and restored
- surface geometry: drag, clamp, min/max size, and edge/corner resize
- workbench layout: split panes, draggable divider, min/max pane sizes, and
  pane open/closed docking
- surface lifecycle: owner-aware close, suspend, resume, restore, and cleanup

These capabilities are toolkit and daemon surface semantics. They should remain
scoped to AOS canvases instead of becoming a general desktop replacement.

## Sequencing

1. Ship toolkit panel chrome improvements: close, titlebar drag, slots, and
   default theme.
2. Add minimize and restore chips for toolkit panels.
3. Extract the basic control pack from current reusable patterns.
4. Extract workbench shell and toolbar styling from the Sigil radial item
   workbench so editor actions no longer live in titlebar chrome.
5. Add maximize and restore as surface state primitives for toolkit panels.
6. Add split-pane layout with draggable divider, min/max pane sizing, and
   persisted ratios.
7. Add pane open/closed docking for sidebars and inspectors.
8. Add edge and corner resize with min/max geometry.
9. Add single-display panel drag clamping so title bars cannot be stranded.
10. Add cross-display transfer outline behavior.
11. Promote the Sigil avatar/radial pattern into a desktop-world stage primitive.
12. Add a visual/interaction binding registry.
13. Build a normal-user surface manager, keeping Canvas Inspector as the
   developer/admin view.

Each step should be useful on its own and reversible.
