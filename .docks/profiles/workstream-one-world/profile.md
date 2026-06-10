# Workstream: One World

This pack keeps current AOS surface work on one coherent platform track.

## Important Pointers

- `ARCHITECTURE.md`
- `CONTEXT.md`
- `CONTEXT-MAP.md`
- `docs/adr/0015-aos-tcc-capability-broker-boundary.md`
- `docs/api/`
- `packages/toolkit/`
- `src/`
- `shared/schemas/`

## Authority

Architecture docs, ADRs, schemas, and current code beat old work cards and
reports. GitHub issues are ledgers, not task packets. Work cards are temporary
assignments unless explicitly refreshed.

## Stale-Source Quarantine

Quarantine old entry-path, transfer-contract, goal-command, clipboard-dispatch,
GDI persona, standalone Operator dock, native custom-agent, and stale work-card
instructions. GDI is superseded by Implementer, and Implementer is not centered
on Codex `/goal`. Do not let stale terminology override the active profile,
AOS-owned runner contracts, current schemas, or direct user instruction.

## Execution Topology

Default:

```text
Foreman
  -> ./aos dev agents
      -> Historian
      -> Explorer
      -> Steward
      -> optional Reviewer
```

Foreman orchestrates the squad and passes outputs around. The execution
substrate is the AOS-owned runner through the provider SDK/proxy path. Native
Codex custom agents, nested Historian-spawns-Explorer, and other squad-lead
topology are retired unless a new durable architecture decision restores them.

## Historian Contract

Historian reconstructs chronology and meaning. It is read-only by default,
does not mutate git/GitHub, and does not decide architecture.

Report shape:

```text
# Historian Report

## Question Answered
## Authority Order
## Timeline
## Current State
## Decisions / Pivots
## Open Lanes
## Stale / Dangerous Sources
## Confidence
## Recommended Next Verification
```
