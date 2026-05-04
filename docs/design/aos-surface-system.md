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
- focus and dirty-state affordances
- action slots for app-specific controls
- theme tokens with app override support

The shell is for panels and workbenches, not for ambient desktop visuals.

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

## Sequencing

1. Ship toolkit panel chrome improvements: close, titlebar drag, slots, and
   default theme.
2. Add minimize and restore chips for toolkit panels.
3. Extract the basic control pack from current reusable patterns.
4. Add single-display panel drag clamping so title bars cannot be stranded.
5. Add cross-display transfer outline behavior.
6. Promote the Sigil avatar/radial pattern into a desktop-world stage primitive.
7. Add a visual/interaction binding registry.
8. Build a normal-user surface manager, keeping Canvas Inspector as the
   developer/admin view.

Each step should be useful on its own and reversible.
