---
name: aos-saved-workspace
description: Use current AOS saved perception handles for observe-act-recapture loops while distinguishing them from public Observation Refs and Locators. Trigger when a task needs saved snapshots, current handles, optional previews or actions, snapshot diffs, or compact UI/browser/native evidence.
---

# AOS Saved Workspace

Use saved workspaces when a desktop, native AX, canvas, or browser task needs
repeatable perception and compact targets. Saved refs are the shared
workspace-storage handle in the current implementation; they are not Locators
or durable target identity under ADR 0040.

## Loop

1. Inspect current syntax with `./aos help see --json` and
   `./aos help do --json`.
2. Capture with `aos see capture ... --save` into an explicit workspace.
3. Inspect snapshots and refs before acting.
4. Prefer saved refs such as `ref:<snapshot-id>:<ref>` over coordinates or
   prose targets when the producer says the ref is actionable.
5. Resolve current identity, optionally dry-run for preview, act once, then recapture.

A saved capture source can be a positional target or one source flag such as
`--region <rect>`, `--canvas <id>`, or `--channel <id>`. The source forms are
mutually exclusive, and capture defaults to `main` when no source is supplied.

## Boundaries

- The public Observation Ref is `(state_id, ref)` and rejects when stale; a
  Locator re-resolves and rejects zero or multiple matches. Current saved-handle
  reacquisition is an explicit implementation gap.
- Workspace artifacts are local control state, not durable Work Record
  evidence; optionally use Work Records when a receipt or recovery input is useful.
- Observation stays raw. The caller chooses whether to keep full captures or
  apply an explicit compacting, masking, persistence, or projection transform.
- Coordinates selected from perception carry the originating `state_id` and
  require current-state mechanical validation.

## Stop

Stop when the saved-ref producer verdict is fallback-only, identity is missing,
the target cannot be revalidated, or the command returns a post-action
recapture recommendation.

## References

- `docs/api/aos.md`
- `docs/api/aos-capabilities.md`
- `docs/adr/0040-ambient-authority-raw-observation-and-target-handles.md`
- `shared/schemas/aos-agent-workspace-v0.md`
- `tests/agent-workspace-contract-drift.sh`
- `tests/agent-workspace-saved-ref.sh`
