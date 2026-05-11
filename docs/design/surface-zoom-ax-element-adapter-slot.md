# Surface-Zoom `ax_element` Adapter Slot

Status: design note for a future adapter slot. No runtime dependency on
`pi-computer-use`.

The Surface-Zoom Inspector proof is fixture-only, but Spatial Subject Tree V0
already reserves `ax_element` as the generic Mac app fallback node kind. The
future adapter should be informed by `pi-computer-use` patterns while remaining
native to AOS primitives and schemas.

## Adapter Shape

Window refs are useful as session-scoped handles for a live operator loop, but
they should not become canonical persistent AOS ids. Persist app/window source
metadata such as bundle id, pid, window id when available, title, and frame, and
store any action ref under adapter-owned `source` metadata with stale-state
checks.

AX targets should map to Spatial Subject Tree `ax_element` nodes. Each node
should carry role, subrole, title, description, value, available actions, frame,
center point, capabilities such as press/focus/set-value/scroll/adjust,
adapter confidence or score, and source app/window metadata. Bounds should be
named explicitly, usually window-local or DesktopWorld-derived, so the
surface-zoom mini-map can project them without treating AX as DOM.

Actionable refs should be state-scoped. A command that uses a prior AX ref must
verify that the referenced state still matches the current app/window and that
the element can be reacquired or rejected as stale. Strict or no-fallback
policies should be represented as adapter state and capabilities instead of
hidden execution behavior.

The adapter should preserve parent paths and depth whenever macOS AX can expose
that structure. Ranked flat target lists are useful for quick action selection,
but the Spatial Subject Tree needs stable ancestry so an inspector can explain
where a target sits inside the selected surface.

Browser windows still need a DOM adapter for selectors, XPath, ARIA ownership,
and page/document coordinate spaces. AX can provide a generic fallback for
browser chrome or weak browser states, but it should not replace a browser DOM
adapter for page elements.

## Non-Goals For The Current Proof

- Do not harvest live AX trees.
- Do not call or import `pi-computer-use`.
- Do not add a second desktop-control plane.
- Do not implement browser DOM, Mermaid/SVG, 3D, PDF/image, or OCR adapters.
