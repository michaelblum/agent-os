---
name: aos-runtime-readiness
description: Use direct ./aos runtime gates before live AOS work. Trigger when an agent needs to check readiness, status, permissions, daemon health, or safe passive diagnostics before using canvases, browser targets, input, voice, or runtime state.
---

# AOS Runtime Readiness

Use this skill before live AOS work or when a command reports runtime blockers.

## Start

1. Run `./aos help ready --json`, `./aos help status --json`, or
   `./aos help doctor --json` before relying on argument shape.
2. Use `./aos ready --json` as the front-door gate for live runtime work.
3. Use `./aos status --json` and `./aos doctor --json` for passive diagnostics.
4. Prefer structured blockers and `recommended_next` fields over guessing.

## Boundaries

- Do not bypass `./aos` with daemon HTTP, launchd, tmux, or raw runtime files
  unless the direct command is missing or broken.
- Do not run permission setup, service restart, or live input/browser actions
  unless the task authorizes that side effect.
- Keep repo mode and installed mode state isolated.

## Stop

Stop and report the exact blocker when readiness names missing permissions,
runtime ownership mismatch, stale daemon state, inactive input tap, or a
command-specific recovery step that would mutate user state.

## References

- `docs/api/aos.md`
- `docs/guides/agent-entry-paths-and-verification.md`
- `docs/dev/workflow-profiles/README.md`
