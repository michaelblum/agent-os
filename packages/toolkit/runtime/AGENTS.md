@../../../AGENTS.md
@../AGENTS.md

# Toolkit Runtime

`runtime/` is Layer 1a: the generic in-canvas bridge to daemon primitives. It
should make canvases easy to build without deciding what a product or panel
should mean.

Good runtime responsibilities:

- bridge wiring, escaping, manifests, and lifecycle handshakes;
- subscribe/unsubscribe helpers for daemon event streams;
- canvas mutation helpers that wrap daemon create/update/remove/eval/suspend;
- DesktopWorld coordinate adapters and generic interaction routing helpers.
- generic mounted-surface menu projection consumption from
  `packages/toolkit/contracts/`, operator annotation menu filtering/routing,
  and selection evidence helpers that stay app-neutral and consume manifest
  data supplied by activation.

Keep windowing and product policy out of runtime. A helper here may expose a
generic capability, but default panel state, chip placement, workbench layout,
surface-manager UI, and Sigil-specific behavior belong in `panel/`,
`workbench/`, `components/`, or `apps/`.
Pending annotation record construction belongs outside runtime; runtime may
emit generic operator-selection evidence to an injected adapter, but it must not
manufacture pending annotation DTOs.

If a runtime helper becomes a workaround for missing daemon functionality, name
the missing primitive in a work card instead of letting the workaround become
the platform contract.

Use `docs/guides/aos-surface-interaction-decision-tree.md` before introducing
new runtime interaction helpers. Runtime should expose generic bridge or daemon
capability; panel policy, product behavior, and private renderers belong in the
layers named by that tree.

Use `docs/api/toolkit/runtime.md` for the consumer-facing runtime contract.
When a runtime helper supports panel/window policy or content authoring, link to
the scoped API file instead of expanding this local guidance.
