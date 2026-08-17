---
name: aos-runtime-readiness
description: Use direct ./aos mechanical readiness and diagnostics. Trigger when an agent needs current readiness, status, macOS permission state, daemon health, or passive diagnostics for canvases, browser targets, input, voice, or runtime state.
---

# AOS Runtime Readiness

Use this skill before live AOS work or when a command reports runtime blockers.

## Start

1. Run `./aos help ready --json`, `./aos help status --json`, or
   `./aos help doctor --json` before relying on argument shape.
2. Use `./aos ready --json` as the front-door mechanical readiness check for live runtime work.
3. Use `./aos status --json` and `./aos doctor --json` for passive diagnostics.
4. Use `./aos operation barrier-status --json` and
   `./aos operation list --json` when the question is registered privileged
   work, resource contention, cleanup, or the host admission barrier.
5. Prefer structured blockers and `recommended_next` fields over guessing.

## Boundaries

- Do not bypass `./aos` with daemon HTTP, launchd, tmux, or raw runtime files
  unless the direct command is missing or broken.
- Keep permission setup, service restart, and live input/browser actions inside
  the caller's requested scope; AOS does not add a second authorization layer.
- Keep repo mode and installed mode state isolated.
- Operation task/agent/client/project/capability labels only narrow the
  mechanically authenticated owner set. Never treat them as authority.
- `./aos operation stop-all --barrier-generation <n> --json` is the public
  same-UID host break-glass control. Run it when the user asks to stop all
  registered work; do not add an approval or caller-intent ceremony.
- A closed host barrier stays closed until exact cleanup/recovery facts permit
  `./aos operation reopen --barrier-generation <n> --json`.

## Stop

Report the exact blocker when readiness names missing permissions, runtime
ownership mismatch, stale daemon state, or an inactive input tap. Stop only
when recovery is outside the caller's requested scope or the target state is
ambiguous.

## References

- `docs/api/aos.md`
- `docs/adr/0040-ambient-authority-raw-observation-and-target-handles.md`
- `docs/adr/0044-operation-owner-roots-host-control-and-resource-claims.md`
- `docs/guides/agent-entry-paths-and-verification.md`
- `docs/dev/workflow-profiles/README.md`
