# Capability Preflight And Readiness Lease

Status: design note, not implementation.

Tracking: GitHub issue #177.

## Problem

Agent guidance currently says to check readiness before live perception,
action, projection, or input routing. That is correct as a safety boundary, but
if interpreted literally it drags agents into repeated `./aos ready` calls and
turns deterministic runtime checks into agent ritual.

Speed and determinism require the opposite split:

```text
agent chooses semantic capability
AOS performs deterministic preflight only when needed
AOS either runs the capability or returns a concrete blocker
```

Agents should be the semantic glue that binds process and deterministic work.
They should not spend tokens deciding whether every live command needs another
readiness check.

## Direction

Introduce a lazy readiness gate, also describable as a capability preflight.

The gate is satisfied by a freshness token or lease for the relevant capability
set. A live command should not force a full readiness check when a valid lease
already proves the required runtime state. When no valid lease exists, the
command surface performs the smallest deterministic preflight needed for the
requested capability.

This is not `./aos ready --repair`, and it should not run repair loops. Repair
and macOS permission handoffs remain explicit user-facing flows.

## Capability Classes

The lease should be scoped by capability, not by a single global boolean.

Candidate classes:

- `runtime.daemon`: managed daemon reachable and matching runtime mode.
- `perception.ax`: Accessibility-backed structured perception available.
- `perception.screen`: Screen capture available when pixels are required.
- `action.input`: input tap active for real mouse/keyboard action.
- `projection.canvas`: daemon canvas/show path available.
- `content.root`: required `aos://...` content roots exist and point at the
  active checkout when canonical roots are used.
- `browser.adapter`: browser target adapter/version/session available.

The command or toolkit surface declares which capability classes it needs.
AOS evaluates only those classes.

## Invalidation

Invalidate the relevant lease after deterministic events:

- repo `./aos` rebuild or code-signing identity change
- daemon start, stop, restart, crash, or socket identity change
- runtime mode change
- macOS permission handoff or stale TCC diagnosis
- content-root mutation for a command that needs `aos://...`
- browser session attach/detach or adapter version failure
- a failed live command that proves the lease is stale
- time-to-live expiry, if a TTL is used

Do not invalidate everything just because a new agent turn starts.

## Existing Partial Precedent

AOS already has command-level preflight in some live paths. For example,
`do` subcommands call `ensureInteractivePreflight(...)` for input-tap-sensitive
actions, and browser targets skip macOS preflight because the browser adapter
owns its own availability gate.

That precedent should evolve from ad hoc per-command checks into a consistent
capability preflight contract.

## Agent Contract

Agent-facing docs should say:

```text
Use a readiness-gated live path. A prior explicit readiness check or a
deterministic capability preflight may satisfy the gate. Recheck only when the
required capability lease is missing or invalidated. Do not poll readiness on
every turn.
```

The agent remains responsible for choosing the semantic path, such as
structured perception versus visual capture or clarification. AOS is
responsible for determining whether that path is currently available and for
returning precise blockers when it is not.

## Non-Goals

- Do not hide `--repair` behind ordinary commands.
- Do not open System Settings or permission dialogs automatically.
- Do not make agents run `./aos ready` as a heartbeat.
- Do not collapse all capabilities into one opaque readiness bit.
- Do not let CLI fallbacks fabricate daemon-owned readiness; follow
  `shared/schemas/CONTRACT-GOVERNANCE.md`.

## Open Design Questions

- Where should leases live: daemon runtime state, mode-scoped config, a small
  cache file, or command-process memory only?
- Should lease TTLs be fixed, per capability, or avoided until evidence shows
  they are needed?
- How should command registry metadata declare required capability classes?
- Should `aos dev recommend` consume capability requirements to remove
  redundant ready-check recommendations?
- Which JSON error shape should represent "preflight failed but no repair was
  attempted"?

## Exit Criteria For Implementation

- Live command surfaces declare required capability classes.
- Repeated live commands skip full readiness checks while the relevant lease is
  valid.
- Known invalidation events clear only the relevant leases.
- Failed preflights return concrete blocker codes and next steps.
- Tests cover valid lease reuse, invalidation, degraded daemon-reported state,
  and no hidden repair behavior.
