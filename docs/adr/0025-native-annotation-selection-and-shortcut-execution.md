# ADR 0025: Native Annotation Selection And Shortcut Execution

**Status:** Accepted; amended by ADR 0040
**Date:** 2026-07-16

## Decision

AOS exposes two product-neutral native primitives for first-party consumers:

- `aos see annotation select --mode <point|rectangle|freehand|text> --follow`
  starts one connection-scoped desktop selection lease and persists the result
  through the existing pending-annotation queue.
- `aos see annotation select --mode target --follow` starts the same
  connection-scoped lease in semantic accessibility-target mode and persists a
  bounded ancestor-to-leaf element description as native AX evidence.
- `aos shortcut run <name> --json` invokes one exact Apple Shortcut name through
  `/usr/bin/shortcuts` without a shell.

AOS owns native presentation, operating-system invocation, bounded transport,
and cleanup. Consumers own project routing, command phrases, skills, optional
caller policy, and any model turn that uses the resulting evidence.

## Annotation Boundary

The daemon permits one annotation-selection lease at a time. It displays one
transparent panel per screen, supports point, rectangle, freehand, and bounded
text input or semantic target inspection, restores the previously active
application, and releases the lease on completion, cancellation, owner
disconnect, or daemon shutdown.

Geometry uses desktop top-left logical points. Freehand paths are capped at 256
points and text at 4 KiB. The daemon emits bounded application and window facts,
but owns no project, conversation, saved-ref, or product-session policy. The
public adapter currently validates the native event, persists a pending
annotation, and emits a bounded completion with annotation id, geometry,
application/window facts, and `has_text`. Its replacement of admitted target
`title` and `label` values with `null` is an ADR
0040 fidelity gap. Entered text stays in the durable pending record, and local
paths remain outside the bounded completion receipt.

Native selection evidence starts as `fallback_only`. Consumers may separately
capture and resolve a saved ref through existing public perception contracts;
the selector does not claim semantic actionability from coordinates alone.
Target mode records `target.kind=native_ax`, but it remains `fallback_only`
because a transient accessibility hit is not action-compatible target identity.
Under ADR 0040, any current `saved_ref` is transition storage rather than a
durable public target: an Observation Ref is the exact `(state_id, ref)` pair,
and only an explicit Locator may re-resolve against current machine facts.
Element geometry is closed to `kind`, coordinate space, positive bounds,
bounded role, nullable bounded title and label, and at most 11 ordered ancestor
roles.
The pending record retains those semantic facts and derives its bounded summary
from label, then title, then role. The public completion preserves geometry and
role topology but replaces target title and label with `null`; target mode never
accepts or emits annotation text.

## Shortcut Boundary

Shortcut execution accepts one exact name of at most 256 UTF-8 bytes, passes it
as one argv item, and has a configurable 1 to 120 second timeout. Combined
stdout and stderr are capped at 64 KiB. The bounded typed receipt exposes
status, duration, and byte counts; captured process streams remain outside it.

The primitive does not discover Shortcuts, interpret voice phrases, or infer
parameters. Callers may apply optional policy around invocation, but AOS does
not require an approval, product allowlist, or assistant-specific authorization
layer.

## Consequences

- Renderers do not receive the daemon socket or raw native authority.
- Operator-created annotations may remain pending without triggering an agent.
- Annotation selection and Shortcut execution can be accepted against fake
  transports; live desktop and TCC evidence remains a separate manual lane.
- Product-specific companion commands, wake phrases, and Help/Demo recipes stay
  outside AOS.
