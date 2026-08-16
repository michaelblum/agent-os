---
name: aos-saved-workspace
description: Use AOS Target Handle V1 saved perception records for observe-act-recapture loops with browser Observation Refs and canvas/native AX Locators. Trigger when a task needs saved snapshots, scoped handles, optional dry-run/actions, snapshot diffs, or compact UI/browser/native evidence.
---

# AOS Saved Workspace

> **Transition pointer — `aos-sovereign-capability-substrate-v1`:** ADR 0043
> and `../../docs/dev/aos-sovereign-capability-authority-v1.json` own future
> complete managed-tool grammar. This skill still teaches current Target Handle
> V1 behavior; browser action rejection below is burn-down baseline, not
> implemented remodel capability.

Use saved workspaces when a desktop, native AX, canvas, or browser task needs
repeatable perception and compact targets. Each saved ref is storage indirection
to exactly one V1 Observation Ref or Locator.

## Loop

1. Inspect current syntax with `./aos help see --json` and
   `./aos help do --json`.
2. Capture with `aos see capture ... --save` into an explicit workspace.
3. Inspect snapshots and refs before acting.
4. Prefer saved refs such as `ref:<snapshot-id>:<ref>` over coordinates or
   prose targets when the producer says the ref is actionable.
5. Optionally dry-run Locator actions using the identical resolution path, act
   once, then recapture. Browser Observation Ref dry-run/effect requests are
   currently fail-closed at the atomic identity boundary.

A saved capture source can be a positional target or one source flag such as
`--region <rect>`, `--canvas <id>`, or `--channel <id>`. The source forms are
mutually exclusive, and capture defaults to `main` when no source is supplied.

## Boundaries

- Browser Observation Refs store their session, original `state_id`, and
  Playwright ref. A newer AOS capture supersedes the generation; no action path
  recaptures or reacquires them. Until the backend can atomically bind that
  generation to ref resolution, requests return `TARGET_ACTION_UNSUPPORTED`
  before backend dispatch.
- Canvas and native AX Locators re-resolve at action time and reject zero or
  multiple matches. Native `index` is explicit disambiguation and `near`
  requires one unique closest candidate.
- Workspace artifacts are local control state, not durable Work Record
  evidence; optionally use Work Records when a receipt or recovery input is useful.
- Observation stays raw. The caller chooses whether to keep full captures or
  apply an explicit compacting, masking, persistence, or projection transform.
- Coordinates are not handles and reject `state_id`.

## Stop

Stop on any typed stale, missing, ambiguous, disabled, timeout, invalid, or
unsupported result. Do not substitute another state or target.

## References

- `docs/api/aos.md`
- `docs/api/aos-capabilities.md`
- `docs/adr/0040-ambient-authority-raw-observation-and-target-handles.md`
- `shared/schemas/aos-agent-workspace-v1.md`
- `shared/schemas/aos-target-handle-v1.md`
- `tests/agent-workspace-contract-drift.sh`
- `tests/agent-workspace-v1.test.mjs`
