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
standalone GDI/Operator dock, and stale work-card instructions. Do not let them
override the active profile, native agent TOML, current schemas, or direct user
instruction.

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

Foreman orchestrates the squad and passes outputs around. The default execution
substrate is the AOS-owned runner. Native Codex subagents, nested
Historian-spawns-Explorer, and other squad-lead topology are experimental until
real Foreman smoke proves grandchildren, hooks, sandboxing, skill inheritance,
debuggable runtime state, and role-specific model/effort binding.

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
