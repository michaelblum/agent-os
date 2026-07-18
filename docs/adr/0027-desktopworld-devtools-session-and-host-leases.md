# ADR 0027: DesktopWorld DevTools Session And Host Leases

- Status: Accepted
- Date: 2026-07-18

## Context

ADR 0026 assigned DesktopWorld inspection and telemetry to AOS. A detachable
inspector also needs one durable owner for filters, selection, recording, and
host transfer. Letting each panel subscribe and sample independently would
duplicate state, create competing frame loops, and make a consumer such as
Sigil the accidental telemetry owner.

## Decision

The daemon owns revisioned `DesktopWorldDevToolsSession` state. A session owns
its selected resource, active tab, filters, recording request, and at most one
interactive host lease. It exposes the stage's shared bounded event history
through those filters rather than creating a per-host telemetry stream. A
canvas ID can belong to only one session, regardless of whether it is
classified as a detached panel, compatibility host, or external consumer slot.

Host transfer is two phase. The registry first reserves the destination; the
daemon suspends the old host and activates the new host; only then does the
registry commit the new owner and revision. Failure restores the old host and
releases the reservation. Host removal detaches the lease and advances the
session revision. Closing a session removes every stock panel that daemon
created for it, including panels suspended by an earlier transfer.

The stock host is a movable AOS panel using public PanelChrome and the
host-neutral scene view. External consumers may host the same public view, but
they do not own the session, telemetry, or implementation. AOS does not need a
status item to launch or retain DevTools.

The DesktopWorld stage owns the only render-loop probe. Opening a session
enables cheap bounded snapshots; recording increases sampling only inside that
existing loop. Closing the final session disables instrumentation and clears
samples and events. Disabled instrumentation creates no timer, animation frame,
stage read, or per-frame allocation.

`surface-inspector`, `render-performance`, and `spatial-telemetry` remain
focused compatibility views. They project the canonical snapshot through
shared models instead of establishing another DesktopWorld telemetry owner.

## Consequences

- Detached and consumer-hosted views show the same revisioned state.
- Host transfer cannot leave two interactive inspectors active.
- Sigil may launch, filter, dock, detach, or host the view without forking AOS
  DevTools or receiving scene content outside the bounded snapshot.
- Per-frame GPU timing, recording, screenshots, and overlays remain explicit
  opt-ins; cheap counters and last-error facts remain available while a session
  exists.
- Agent-facing commands and deterministic replay are separate public tooling
  built on this session rather than a parallel inspector runtime.
