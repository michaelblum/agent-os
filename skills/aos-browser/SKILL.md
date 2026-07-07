---
name: aos-browser
description: Use AOS browser saved refs and action envelopes for durable browser work. Trigger when a task involves browser capture, DOM/SOM refs, browser-backed do actions, browser evidence, or deciding between AOS browser wrappers and upstream Playwright CLI escape hatches.
---

# AOS Browser

Use AOS for browser work that benefits from saved refs, action envelopes, and
Work Record evidence. Use upstream Playwright CLI skills for browser primitives
AOS does not wrap.

## AOS Path

1. Inspect `./aos help see --json`, `./aos help do --json`, and command-specific
   help before using browser arguments.
2. Use `aos focus` when a named browser session/channel is needed.
3. Capture browser state through `aos see capture browser:<session> --save`.
4. Act through direct browser targets or saved refs only after the current
   target validates.
5. Recapture after mutation and preserve compact evidence instead of raw dumps.

## Playwright CLI Boundary

Use raw Playwright CLI plus upstream Playwright skills for escape hatches AOS
does not own: tracing, video, tab management, reload/back/forward, upload,
select/check/uncheck, codegen, arbitrary page eval, or other unwrapped
Playwright primitives.

AOS must not vendor, copy, or silently rewrite Playwright skill content. Do not
run a Playwright skill install unless the user explicitly asks for companion
installation, and use a temp target for tests.

## Stop

Stop when the browser session is not local, the content rect or tab identity is
unresolved, a saved ref is stale, or the needed primitive is only available
through upstream Playwright CLI.

## References

- `ARCHITECTURE.md`
- `docs/api/aos.md`
- `docs/archive/superpowers/specs/2026-04-24-playwright-browser-adapter-design.md`
- `tests/browser/runtime-resolver.test.mjs`
- `tests/browser/version-check.test.sh`
