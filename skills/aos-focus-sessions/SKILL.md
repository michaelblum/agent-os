---
name: aos-focus-sessions
description: Use AOS focus channels as the desktop session model. Trigger when a task needs named window or browser sessions, parallel-agent isolation, channel cleanup, or browser/app target lifecycle decisions.
---

# AOS Focus Sessions

Focus channels are the AOS session model for tracked windows and browser
targets. Use them when an agent needs a stable name for a target across capture,
action, and recapture.

## Start

1. Inspect `./aos help focus --json`.
2. Use `./aos focus list` before creating a new channel.
3. Create a window channel with `./aos focus create --id <name> --window <wid>`.
4. Create or attach a browser channel with
   `./aos focus create --id <name> --target browser://attach` or
   `browser://new`.
5. Capture through the channel when that preserves the intended scope.

## Parallel-Agent Rules

- Use explicit channel ids and workspace ids; do not rely on hidden current
  state.
- Remove stale channels with `./aos focus remove --id <name>` when the target
  no longer exists.
- Do not reuse another agent's channel unless the task explicitly coordinates
  ownership.

## Browser Boundary

Use AOS focus channels for local browser targeting and saved refs. Use upstream
Playwright CLI skills for browser-only lanes such as storage/auth state,
network mocking, tracing, video, PDF, locator/test generation, test debugging,
and tab management.

## Stop

Stop when the channel points at a missing window, unresolved browser target,
ambiguous app/window identity, or a parallel-agent ownership conflict.

## References

- `docs/api/aos-capabilities.md`
- `docs/api/aos.md`
- `manifests/commands/source/aos/15-focus.json`
