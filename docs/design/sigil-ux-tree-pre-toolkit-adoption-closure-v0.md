# Sigil UX Tree Pre Toolkit Adoption Closure V0

Status: Sigil-side closure checkpoint before toolkit-wide adoption.

Sigil now acts as the reference implementation for the operating model:

```text
UX tree nodes
  -> bindings
  -> generic relations
  -> allowlisted command adapter
  -> existing runtime functions
```

The Sigil UX tree names user-visible avatar, context-menu, Selection Mode,
radial-menu, radial item, annotation reticle/camera, wiki graph, and Agent
Terminal interactions. Runtime handlers stay in the Sigil command registry; the
tree still carries command names and metadata only.

## What Sigil Proves

- Avatar left press, GOTO entry, avatar double-click Selection Mode entry,
  radial drag-threshold entry, Selection Mode keyboard/pointer commands,
  context-menu right-click commands, and radial item release actions can route
  through the same allowlisted UX command adapter.
- Radial gesture release and radial target-surface item clicks converge on the
  same item command dispatch path.
- Radial item actions map to command handlers for context menu, Agent Terminal,
  annotation reticle, annotation camera bundle capture, and wiki graph.
- `window.__sigilDebug.snapshot().uxTreeReadiness` and
  `window.__sigilDebug.uxTreeReadiness()` report command handler coverage,
  routed bindings, direct runtime mechanics, and trigger/anchor/target topology.
- The readiness audit fails closed when a UX tree binding is neither routed,
  explicitly deferred, nor classified as a runtime mechanic.

## Not Toolkit Adoption Yet

This checkpoint does not ask toolkit controls, components, panels, or workbench
surfaces to emit UX tree fragments. Toolkit remains a consumer of the shared UX
tree schema and runtime helpers, while Sigil owns this local readiness audit and
runtime registry wiring.

The direct paths that remain in Sigil are intentionally runtime mechanics:
gesture recognition, hover and fast-travel state machines, duplicate-event
guards, Selection Mode entry-release suppression, context-menu fallback, and
annotation reticle preview/commit mechanics.

## Next Adoption Start

Toolkit adoption should start by selecting one toolkit-owned control or panel
family and having it emit its own UX tree fragment with nodes, bindings,
commands, and relations. That work should reuse the existing schema/runtime
helpers and only add generic relation vocabulary if the need is broader than
Sigil.

The first adoption slice should not copy Sigil's readiness helper wholesale.
Instead, it should define a toolkit-level equivalent once more than one toolkit
surface emits fragments and needs shared coverage reporting.

## Verification Surfaces

- `tests/renderer/sigil-ux-tree.test.mjs`
- `tests/renderer/sigil-ux-tree-command-registry.test.mjs`
- `tests/renderer/sigil-ux-tree-readiness.test.mjs`
- `tests/renderer/sigil-selection-mode-input.test.mjs`
- `tests/renderer/sigil-context-menu-input.test.mjs`
- `tests/renderer/radial-gesture-menu.test.mjs`
- `tests/renderer/radial-menu-activation.test.mjs`
- `tests/renderer/radial-menu-target-surface.test.mjs`
- `tests/renderer/annotation-reticle.test.mjs`

The debug readiness payload is the durable runtime evidence for what is already
data-routed and what remains direct by design.
