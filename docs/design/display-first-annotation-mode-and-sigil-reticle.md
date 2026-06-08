# Display-First Annotation Mode And Sigil Reticle

Status: design direction for follow-on work cards.
Ancestry report:
`docs/archive/draw-extension-annotation-ancestry-report.md`

This note records the current product direction for Annotation Mode after the
Surface Inspector annotation experiments, native AX candidate work, AOS semantic
target work, and DRAW extension archaeology.

The important correction is that Annotation Mode should be a display-first
interaction model. Surface Inspector can help enter, inspect, debug, and
snapshot the mode, but it should not be the primary authoring surface for
annotations. The visible "pin" concept should be demoted or removed from the
main display UX. The primitive concept is an annotation anchor attached to a
stable subject address; a comment is optional.

## Direction Correction

Current partial implementations and work cards leaned too hard toward Surface
Inspector-owned controls, list-first annotation creation, and visible pin
actions. That made the inspector feel like the product instead of a diagnostic
surface for the product.

Future work should correct that direction:

- Annotation creation happens on the display surface through hover, click, drag,
  and text input near the target.
- A frame is a commentless annotation anchor.
- A comment is optional text attached to an anchor.
- The pin icon is not a core user-facing concept. Internal names may still use
  `pin` if renaming creates unnecessary churn, but product docs and new UI
  should prefer `frame`, `anchor`, `annotation`, or `scope`.
- Surface Inspector remains useful as an tooling context, snapshot shutter, current
  path display, debug tree, adapter evidence viewer, and implementation
  diagnostic. It should not require the user to manage annotations from an
  inspector list.
- The Sigil radial menu plus drag reticle should be developed in tandem with the
  primitive Annotation Mode because it gives fast visual feedback for the
  display interaction model.

## Core Model

Annotation Mode maintains an in-memory session over live subjects. Disk
persistence happens only through an explicit snapshot. A snapshot is a
point-in-time artifact, not a promise that the same element still exists or can
be reproduced later.

If a window, process, DOM node, AX element, or AOS semantic subject disappears,
its live annotation dies with it. If the user needs durable evidence, they take
a snapshot.

The source of truth for an annotation is the subject address, not its last
screen rectangle. The renderer derives the current physical position from the
address and current projection state.

Example session shape:

```js
annotation_session = {
  active: true,
  entry_source: "hotkey|status_menu|surface_inspector|sigil_radial",
  root: subject,
  committed_scope_stack: [root, window],
  preview_scope_stack: [root, window, child],
  hover_candidate: subject,
  anchors: [annotation_anchor],
  snapshot_count: 0
}

annotation_anchor = {
  id: "anchor:...",
  address: subject_address,
  scope_path: [subject_address],
  comment_text: "",
  projection: current_projection,
  created_at: timestamp,
  updated_at: timestamp,
  status: "live|stale|absent|blocked"
}
```

## Subject Addresses

Every adapter should provide the strongest stable address it can, plus enough
fallback evidence to explain or reacquire the subject.

Native AX subjects should use an AX path and context path rooted in display,
app, window, and element evidence. Include role, title/label/value, enabled
state, action names, bounds, and ancestry where available.

AOS-owned HTML and toolkit subjects should use canvas identity, semantic target
path, stable refs, data attributes, source metadata, and owner canvas context.

Browser DOM or CDP subjects should eventually use a browser-aware address:
frame chain, shadow chain, Playwright locator candidates, CSS selector, XPath or
DevTools path, stable attributes, nearby text, and viewport projection evidence.
The browser boundary remains a separate adapter boundary; it should not block
the display-first interaction model for native AX and AOS-owned surfaces.

## Tooling Contexts

Multiple tooling contexts should open the same underlying annotation session:

- status menu icon;
- global hotkey;
- Surface Inspector, optionally scoped directly to a known subject;
- Sigil radial reticle drag.

The display the avatar is on when Annotation Mode starts is the de facto root.
If the avatar is over a window at entry, that window becomes the initial nested
frame under the display root.

## Display Interaction

Annotation Mode behaves like progressive scope selection.

The current scope renders as a frame. Moving inside that scope highlights direct
children or adapter-defined immediate candidates. Clicking a child makes that
child the new current scope. The user can leave a comment at any current scope,
or leave it commentless as a frame anchor.

During a drag operation, the cursor can:

- move up to an ancestor frame;
- move laterally to a sibling frame at the same level;
- move down into a child frame of the current frame.

Use two stacks:

- `committed_scope_stack`: the current accepted scope chain.
- `preview_scope_stack`: the chain implied by the current hover or drag state.

On release, commit the preview stack and create or update the live anchors for
the selected chain. Normal fast-travel exits Annotation Mode and removes live
annotations.

The lightweight display editor should be a live input near the active anchor
with placeholder text like `Leave comment (optional)`. A separate `Done` or
`Cancel` button is not required for the first display-first direction if click,
drag, Escape, focus loss, and snapshot behavior are clear. Escape should move
scope up one level when possible, and exit Annotation Mode from the root.

## Sigil Reticle Drag

Sigil should expose Annotation Mode as a radial menu item represented by a
reticle-like 3D model.

Dragging through the reticle item:

- enters Annotation Mode;
- changes the fast-travel arrow head to a circle with a cross;
- changes the dashed vector overlay from the normal greenish treatment to gold;
- makes the drag cursor act as the hover selector for the current scope.

Returning the drag back into the radial menu interior exits Annotation Mode and
restores the normal fast-travel vector appearance.

Continuing the drag and releasing over a display, window, app, AOS surface, AX
element, or DOM element commits the selected scope and fast-travels the avatar
to a deterministic approach point for that target. It should not travel to the
exact cursor coordinate.

When at least one anchor overlay exists, Sigil should expose a camera radial
item. Activating the camera takes a snapshot and leaves live annotations in
place so the user can continue setting up or refining context.

## Travel Placement Cascade

Travel placement should be deterministic and adapter-neutral.

Inputs:

- target visible rect clipped to display or viewport;
- avatar hit box;
- release point;
- target coordinate space and display bounds.

Cascade:

1. Compute outside corner candidates at the target's visible corners, offset by
   avatar hit box plus margin.
2. Sort outside candidates by distance to the release point.
3. Choose the first outside candidate whose full avatar hit box fits inside the
   visible display bounds.
4. If none fit, try the remaining outside corners in distance order.
5. If no outside corner is valid, compute inside corner candidates, inset by
   hit box plus margin.
6. Sort inside candidates by distance to the release point.
7. Choose the first inside candidate that fits inside the visible target rect.
8. If no corner works, try visible edge midpoints.
9. If all else fails, use the clipped target center and report
   `placement_status: "constrained"`.

This handles fullscreen apps, display roots, and elements whose visible corners
are flush with a screen edge. For root displays and fullscreen windows, inside
corner placement is expected.

## Frame Opacity

Opacity should identify the current scope as the strongest visual frame while
still showing ancestry.

Rule:

- deepest/current frame: `1`;
- outermost/root frame: `0.75`;
- intermediate frames: evenly interpolated between `0.75` and `1`.

Formula, where `index = 0` is root and `index = count - 1` is current:

```js
function opacityForDepth(index, count, floor = 0.75) {
  if (count <= 1) return 1
  const t = index / (count - 1)
  return floor + t * (1 - floor)
}
```

Examples:

```text
[root]                         => [1]
[root, child]                  => [0.75, 1]
[root, child, grandchild]      => [0.75, 0.875, 1]
[root, a, b, current]          => [0.75, 0.833, 0.917, 1]
```

Opacity changes should occur when the preview stack changes, not on every raw
pointer movement.

## Rendering Budget

This design is feasible if the pointer hot path is kept small.

Avoid:

- fresh AX, DOM, or CDP discovery on every mousemove;
- creating or destroying AOS canvases per hover;
- full descendant tree projection per pointer event;
- interleaved layout reads and writes;
- re-rendering the Surface Inspector list on pointer movement.

Prefer:

- one persistent overlay layer per display or active root;
- cached direct-child candidates for the current scope;
- point-in-rect testing against cached projectable rects;
- requestAnimationFrame coalescing;
- overlay updates only when the resolved candidate or preview stack changes;
- CSS transforms, CSS variables, and retained DOM/canvas nodes;
- stale-during-motion handling for scroll, resize, window move, and mutation,
  followed by debounced reprojection after settle;
- direct children plus ancestor/sibling escape candidates rather than the full
  tree.

The DRAW extension pattern is useful here: keep live subject references or
addresses, derive overlay rectangles at render time, hide or simplify overlays
during scrolling, then refresh positions after scroll/resize/mutation settles.

## Surface Inspector Role

Surface Inspector should support this mode without owning it.

Allowed Surface Inspector responsibilities:

- enter or exit Annotation Mode;
- enter with a direct known scope;
- show current root, current scope path, and adapter evidence;
- expose snapshot/shutter action;
- show live anchor count and stale/blocked diagnostics;
- debug projection, hit-test, and address resolution;
- show passive minimap evidence.

Responsibilities to avoid:

- primary annotation creation through list rows;
- making pin controls the main UX;
- requiring users to manage scope through inspector tree state;
- rendering transient hover candidates as durable annotation rows;
- using the minimap as an action surface.

## Implementation Sequence

1. Define the shared annotation session model and display overlay renderer.
   Keep the model adapter-neutral and in-memory by default.
2. Correct the current Surface Inspector-oriented partial implementation:
   demote list-first creation, remove or hide primary pin icon flows, and keep
   Surface Inspector as entry/snapshot/debug support.
3. Build the Sigil radial reticle prototype in tandem so the visual drag model
   can be refined by direct use.
4. Add settled reprojection for window move, scroll, resize, DOM mutation, AX
   stale/absent state, and AOS semantic target refresh.
5. Add snapshot/shutter output that captures current anchors, projections,
   adapter evidence, and screenshot or bundle artifacts.
6. Later, parlay the same model into Show Me mode: a recording is an ordered
   series of focused snapshots and annotation anchors, optionally paired with
   user actions.

## Acceptance Checks For Future Cards

- All tooling contexts create the same annotation session type.
- Surface Inspector is not required to create the first annotation.
- The display root defaults to the display under the avatar at mode entry.
- If the avatar starts over a window, that window is the initial nested frame.
- Drag preview supports move-up, lateral move, and drill-down behavior.
- Releasing a Sigil reticle drag commits the preview scope and uses the travel
  placement cascade.
- Frame opacity matches the examples above.
- Mousemove does not perform fresh AX/DOM/CDP discovery or create/destroy
  canvases.
- Comments survive viewport changes while their subject remains live and
  projectable.
- Live annotations disappear when their subject disappears.
- Snapshot captures point-in-time evidence without claiming future
  reproducibility.
