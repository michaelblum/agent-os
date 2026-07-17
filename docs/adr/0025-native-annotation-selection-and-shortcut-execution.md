# ADR 0025: Native Annotation Selection And Shortcut Execution

**Status:** Accepted
**Date:** 2026-07-16

## Decision

AOS exposes two product-neutral native primitives for first-party consumers:

- `aos see annotation select --mode <point|rectangle|freehand|text> --follow`
  starts one connection-scoped desktop selection lease and persists the result
  through the existing pending-annotation queue.
- `aos shortcut run <name> --json` invokes one exact Apple Shortcut name through
  `/usr/bin/shortcuts` without a shell.

AOS owns native presentation, operating-system invocation, bounded transport,
and cleanup. Consumers own project routing, agent policy, command phrases,
skills, approval, and any model turn that uses the resulting evidence.

## Annotation Boundary

The daemon permits one annotation-selection lease at a time. It displays one
transparent panel per screen, supports point, rectangle, freehand, and bounded
text input, restores the previously active application, and releases the lease
on completion, cancellation, owner disconnect, or daemon shutdown.

Geometry uses desktop top-left logical points. Freehand paths are capped at 256
points and text at 4 KiB. The daemon emits bounded application and window facts,
but owns no project, conversation, saved-ref, or product-session policy. The
public adapter validates the native event, persists a pending annotation, then
emits only the annotation id, geometry, application/window facts, and
`has_text`. Annotation text remains in the pending record and is never repeated
through the public follow stream.

Native selection evidence starts as `fallback_only`. Consumers may separately
capture and resolve a saved ref through existing public perception contracts;
the selector does not claim semantic actionability from coordinates alone.

## Shortcut Boundary

Shortcut execution accepts one exact name of at most 256 UTF-8 bytes, passes it
as one argv item, and has a configurable 1 to 120 second timeout. Combined
stdout and stderr are capped at 64 KiB and are never returned as content. The
result exposes only status, duration, and byte counts.

The primitive does not discover Shortcuts, interpret voice phrases, infer
parameters, or bypass consumer approvals. A product must authorize an explicit
Shortcut name before invoking this form.

## Consequences

- Renderers do not receive the daemon socket or raw native authority.
- Operator-created annotations may remain pending without triggering an agent.
- Annotation selection and Shortcut execution can be accepted against fake
  transports; live desktop and TCC evidence remains a separate manual lane.
- Product-specific companion commands, wake phrases, and Help/Demo recipes stay
  outside AOS.
