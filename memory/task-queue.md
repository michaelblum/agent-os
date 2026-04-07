# Task Queue

## Active
(none)

## Queued
(none)

## Done

### shared-ipc-runtime-testing (2026-04-05)
Runtime verification of shared IPC library migration (15 commits, `3310f0c` → `9028c3b`).

**Results:**
- `aos serve` — PASS: daemon starts, socket at `~/.config/aos/repo/sock`
- `aos log` (stream) — PASS: reads stdin, connection-scoped canvas, cleanup on EOF
- `aos log push` / `aos log clear` — PASS: one-shot commands return ok
- `aos inspect` — PASS: connection-scoped canvas, event loop, cleanup on kill
- `avatar-sub` (Sigil) — PASS after fix: envelope schema mismatch in `onMessage` handler

**Bug fixed:** avatar-sub `onMessage` still parsed old `heads-up serve` relay format (`{"type":"channel",...}`). Updated to parse `aos serve` envelope format (`decodeEnvelope()` → match on `envelope.event`). File: `apps/sigil/avatar-sub.swift`.

**Not verified:** 60fps animation latency regression (requires sustained visual testing). The `sendAndReceive` drain pattern in animation loops compiled and connected; no stalls observed during possess-cursor behavior test.
