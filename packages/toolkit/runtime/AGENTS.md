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
- schema-owned raw-v2 and routed-v1 parsing through the checked Ajv standalone
  `input-event-validator.generated.js` artifact; never interpret JSON Schema on
  the input hot path,
  canvas-origin input normalization, and the
  canonical `inputIdentity` source, ownership, scope, and envelope projection
  consumed by app policy; unversioned names and `input_event` wrappers are not
  compatibility inputs;
- generic mounted-surface menu projection consumption from
  `packages/toolkit/contracts/`, operator annotation menu filtering/routing,
  and selection evidence helpers that stay app-neutral and consume manifest
  data supplied by activation.
- dependency-injected Three renderer lifecycle mechanics: bounded sizing,
  visibility and context-loss suspension, frame scheduling, and disposal of
  explicitly owned resources.

Keep windowing and product policy out of runtime. A helper here may expose a
generic capability, but default panel state, chip placement, workbench layout,
surface-manager UI, and product-specific behavior belong in `panel/`,
`workbench/`, `components/`, or the owning external product.
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
