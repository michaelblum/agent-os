---
name: aos-browser
description: Use AOS current browser observation handles and action envelopes. Trigger when a task involves browser capture, DOM/SOM refs, browser-backed do actions, optional browser evidence, or deciding between AOS browser wrappers and upstream Playwright CLI escape hatches.
---

# AOS Browser

Use AOS for browser work that benefits from current saved-workspace handles and
action envelopes. Add Work Record evidence only when durable history is useful.
Use upstream Playwright CLI skills for browser primitives AOS does not wrap.

## AOS Path

1. Inspect `./aos help see --json`, `./aos help do --json`, and command-specific
   help before using browser arguments.
2. Use `aos focus` when a named browser session/channel is needed.
3. Capture browser state through `aos see capture browser:<session> --save`.
4. Treat each saved address as storage indirection to one Observation Ref or
   Locator. Browser Observation Ref actions currently validate, then fail closed
   before backend dispatch; use only session actions or another explicit route.
5. Recapture after mutation. Keep raw output or apply an explicit caller-owned
   compacting, persistence, masking, or projection transform.

## Playwright CLI Boundary

Use raw Playwright CLI plus upstream Playwright skills for escape hatches AOS
does not own: network mocking, storage/auth state, console/eval, tracing,
video, PDF, locator generation, test generation, test debugging, upload,
select/check/uncheck, back/forward/reload, tab management, or other unwrapped
Playwright primitives.

Check the companion boundary with:

```bash
./aos skills companion check --name playwright-cli --target path --path /tmp/aos-skills --json
```

AOS must not vendor, copy, or silently rewrite Playwright skill content. Do not
run a Playwright skill install unless the user explicitly asks for companion
installation, and use a temp target for tests.

## Target Contract

- Observation Ref `(state_id, ref)` — ephemeral and stale-rejecting.
- Locator — canvas/native only; re-resolves current state and rejects zero or multiple action-compatible matches. V1 has no browser Locator grammar.
- `ref:<snapshot-id>:<ref>` — current saved-workspace handle, not a Locator.
- Direct browser refs and saved browser handles are Observation Refs. A
  ref-bearing request requires its original `state_id` and validates that pair.
- The current backend cannot atomically bind ref resolution to the AOS capture
  generation, so every ref-bearing dry-run/effect request returns
  `TARGET_ACTION_UNSUPPORTED` before backend dispatch. Never recapture, search
  by label, or substitute a new state.
- Direct session-only browser `scroll`, `type`, `key`, and `navigate` remain
  current-host routes and do not accept `state_id`.

## Stop

Stop when the browser session is not local, the content rect or tab identity is
unresolved, a saved ref is stale, or the needed primitive is only available
through upstream Playwright CLI.

## References

- `ARCHITECTURE.md`
- `docs/api/aos-capabilities.md`
- `docs/api/aos.md`
- `docs/adr/0040-ambient-authority-raw-observation-and-target-handles.md`
- `docs/archive/superpowers/specs/2026-04-24-playwright-browser-adapter-design.md`
- `tests/browser/runtime-resolver.test.mjs`
- `tests/browser/version-check.test.sh`
