# DRAW Extension Annotation Ancestry Report

Status: archived side-conversation synthesis. Use as historical reset context,
not as a live implementation spec.

This report preserves the side-session archaeology around the DRAW Chrome
extension and its relevance to AOS Display-first Annotation Mode. It exists as
an insurance artifact: if future sessions lose the product direction, start
from `docs/design/display-first-annotation-mode-and-sigil-reticle.md`, then use
this report to recover the ancestral ideas behind element addresses, ancestor
chains, live overlays, and settled reprojection.

## 1) Short Version

The useful DRAW idea is not the old Chrome extension UI. The useful idea is the
separation between:

- a live subject reference or address;
- a visible ancestor chain around that subject;
- overlay geometry derived at render time;
- refresh after scroll, resize, mutation, or navigation settle;
- selector/path evidence kept as fallback context, not as the only truth.

For AOS, that maps cleanly to display-first Annotation Mode:

- a frame is a commentless annotation anchor;
- a comment is optional text attached to an anchor;
- the anchor source of truth is the subject address;
- the rendered location is projected live;
- snapshots are explicit point-in-time artifacts;
- Surface Inspector is a support/debug surface, not the main authoring UI.

## 2) What DRAW Was Doing

DRAW's extension evolved toward a browser-based HITL DOM engineering workflow.
The user could inspect a live page, have an agent propose targets/selectors, see
colored overlays on candidate elements, manually select alternatives, test
execution, and persist tasks.

The old implementation is not something to port wholesale. It contains a lot of
browser-extension-specific control plane, sidebar behavior, capture machinery,
and automation-task concepts that do not belong in AOS primitives.

The reusable part is the interaction pattern:

1. The user points at or context-clicks a real element.
2. The extension records the selected element.
3. It builds a visible ancestor chain from the selected element up toward the
   page body, crossing shadow DOM host boundaries where needed.
4. It presents the chain as selectable choices.
5. It overlays highlights and controls on the live page.
6. It derives overlay positions from current DOM geometry.
7. It hides or simplifies overlays while the page is moving.
8. It refreshes overlay positions after scroll, resize, and mutation settle.

That is close to what AOS needs, except AOS must generalize from DOM elements to
native AX subjects, AOS canvases, semantic targets, browser content, and Sigil
travel targets.

## 3) Ancestor Chain

The content script has an explicit `getAncestorChain(el)` helper. It starts at a
target element, keeps visible ancestors, walks through `parentElement`, pierces
shadow DOM by moving to the root host, includes `document.body`, and caps depth
to avoid runaway traversal.

The extension then groups the chain into visually distinct ancestor groups and
renders a badge cascade. The badges let the user choose whether the intended
target is the exact clicked element or a broader ancestor.

AOS translation:

- Use the same conceptual chain, but call it a scope stack.
- The root is the display under the avatar at Annotation Mode entry.
- If a window is under the avatar, it becomes the initial nested frame.
- During drag, the preview stack can move up to an ancestor, laterally to a
  sibling, or down into a child.
- Release commits the preview stack as live anchors.

This gives the user a direct way to answer "which thing did you mean?" without
requiring an inspector list to become the main UI.

## 4) Address And Selector Evidence

DRAW contains selector/path utilities adapted from Chrome DevTools. They can
produce CSS paths, JS paths, and XPaths for DOM elements. The content script also
builds context bundles with ancestor metadata, target metadata, frame URL, and
shadow-host selector chains.

The later DRAW notes recognized selector fragility and proposed session-stable
refs such as `ref=e1`, `ref=e2` for interactable elements. That direction is
more important than any specific selector string: the agent should not have to
hallucinate a CSS selector when a runtime can provide an addressable reference.

AOS translation:

- Native AX subjects should use AX path/context evidence rooted in display,
  app, window, and element ancestry.
- AOS-owned HTML/toolkit subjects should use canvas identity, semantic target
  paths, stable refs, source metadata, and owner context.
- Browser DOM/CDP subjects should eventually use frame chain, shadow chain,
  Playwright locator candidates, CSS selector, XPath or DevTools path, stable
  attributes, nearby text, and viewport projection evidence.
- Selectors are fallback evidence, not the only anchor.

## 5) Overlay Projection

DRAW overlays are connected to live DOM elements. Each overlay object keeps the
associated page element, then `positionOverlayForElement()` computes current
geometry from `getBoundingClientRect()`. If the element is disconnected,
hidden, or zero-sized, the overlay is hidden or removed instead of pretending it
is still valid.

The content script also computes an effective z-index by walking ancestors, so
the overlay can sit above modal or stacked content.

AOS translation:

- Store live anchors by subject address and adapter evidence.
- Derive screen rectangles during render, not at creation time.
- Hide stale, absent, clipped, or unsupported anchors rather than drawing stale
  boxes.
- Keep z-order and hit-priority evidence as adapter output where possible.
- Treat projection as per-adapter capability, not a universal guarantee.

## 6) Scroll, Resize, Mutation, And Settle

DRAW explicitly handles page motion. During scroll, overlay containers receive a
`user-is-scrolling` class and become transparent/non-interactive. After a
debounce, the script removes that state and updates overlay positions.

The content script also installs a `MutationObserver` over relevant attributes
and child-list changes. It filters out its own UI changes, debounces refresh,
removes overlays for disconnected elements, repositions overlays for still-live
elements, and discovers newly matching elements when needed.

AOS translation:

- Mousemove should not do fresh AX/DOM/CDP discovery.
- Keep the pointer hot path to cached candidate lookup and overlay transform
  updates.
- Mark projections stale or simplified during window moves, scrolls, resizes,
  DOM mutations, and AX uncertainty.
- Reproject after settle.
- If a subject disappears, live annotations tied to it disappear unless already
  captured in a snapshot.

## 7) Overlay Control Routing

DRAW had to prevent overlay capability drift by naming one routing truth for
operator-facing browser overlays. Its overlay routing notes separate the
primary collaborative overlay, challenge inline overlays, and support/fallback
overlays.

AOS translation:

- Avoid creating separate annotation control systems per entry path.
- Status menu, hotkey, Surface Inspector, and Sigil radial reticle should all
  enter the same annotation session model.
- Surface Inspector can inspect and debug the session, but should not own a
  separate authoring model.
- Sigil reticle should be a visual manifestation of the same primitive, not an
  unrelated higher-order mode.

## 8) Useful Ideas To Carry Forward

Carry forward:

- subject address as truth;
- projection derived live from adapter state;
- ancestor chain as scope stack;
- commentless frame anchor as a first-class annotation;
- optional comment text attached to anchors;
- transient hover candidates kept out of durable annotation rows;
- one canonical annotation session shared by all entry paths;
- hide/simplify during motion, then reproject after settle;
- explicit snapshot/shutter for durable evidence;
- adapter capability/blocker evidence when projection is unsupported.

Do not carry forward:

- Chrome extension sidebar as the product shape;
- Surface Inspector-first authoring;
- selector-only anchors;
- stale overlays when elements disappear;
- ad hoc overlay systems per workflow;
- capture/export/report domain semantics in the annotation primitive.

The most important product lesson is that the user should interact with the
actual display. Inspector and archive surfaces should explain, preserve, and
debug that interaction, not replace it.

## 9) Sources

- `/Users/Michael/Documents/GitHub/DRAW/draw-extension/server/helpers/autoscraper-chrome-extension/content/content.js`
- `/Users/Michael/Documents/GitHub/DRAW/draw-extension/server/helpers/autoscraper-chrome-extension/content/utils/devtoolsPathUtils.js`
- `/Users/Michael/Documents/GitHub/DRAW/draw-extension/.agent/knowledge/arcs/task_architect.md`
- `/Users/Michael/Documents/GitHub/DRAW/draw-extension/.agent/knowledge/arcs/agentic-navigation-framework.md`
- `/Users/Michael/Documents/GitHub/DRAW/draw-extension/.agent/knowledge/arcs/capture_pipeline.md`
- `/Users/Michael/Documents/GitHub/DRAW/draw-extension/architecture/OVERLAY_CONTROL_ROUTING.md`
- `/Users/Michael/Code/agent-os/AGENTS.md`

