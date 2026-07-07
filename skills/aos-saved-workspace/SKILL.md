---
name: aos-saved-workspace
description: Use AOS saved perception workspaces with `aos see capture --save`, `aos see snapshots`, `aos see refs`, and compact refs for observe-act-recapture loops. Trigger when a task needs saved snapshots, refs, ref-scoped dry-runs or actions, snapshot diffs, or compact UI/browser/native evidence without carrying full screenshots or AX payloads in context.
---

# AOS Saved Workspace

Use saved workspaces when a desktop, native AX, canvas, or browser task needs
repeatable perception and compact targets. Saved refs are the shared
locator-like model across AOS surfaces.

## Loop

1. Inspect current syntax with `./aos help see --json` and
   `./aos help do --json`.
2. Capture with `aos see capture ... --save` into an explicit workspace.
3. Inspect snapshots and refs before acting.
4. Prefer saved refs such as `ref:<snapshot-id>:<ref>` over coordinates or
   prose targets when the producer says the ref is actionable.
5. Dry-run when the action supports it, act once, then recapture.

A saved capture source can be a positional target or one source flag such as
`--region <rect>`, `--canvas <id>`, or `--channel <id>`. The source forms are
mutually exclusive, and capture defaults to `main` when no source is supplied.

## Boundaries

- Saved refs are snapshot scoped; stale desktop, native AX, canvas, or browser
  identity must be recaptured instead of forced.
- Workspace artifacts are local control state, not durable Work Record
  evidence; use Work Records when the task needs a receipt or recovery input.
- Do not inline screenshots, browser payloads, AX dumps, or full capture JSON
  when refs and summaries are enough.
- Coordinate fallback is diagnostic unless the command and task explicitly
  authorize it.

## Stop

Stop when the saved-ref producer verdict is fallback-only, identity is missing,
the target cannot be revalidated, or the command returns a post-action
recapture recommendation.

## References

- `docs/api/aos.md`
- `docs/api/aos-capabilities.md`
- `shared/schemas/aos-agent-workspace-v0.md`
- `tests/agent-workspace-contract-drift.sh`
- `tests/agent-workspace-saved-ref.sh`
