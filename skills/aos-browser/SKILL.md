---
name: aos-browser
description: Use AOS managed Playwright companion sessions, current browser observations, and fixed session operations. Trigger for browser focus, capture, session-only actions, managed evidence, or browser Observation Ref limits.
---

# AOS Browser

> **Transition pointer — `aos-sovereign-capability-substrate-v1`:** ADR 0043
> and `../../docs/dev/aos-sovereign-capability-authority-v1.json` own the
> future complete managed Playwright grammar. This skill continues to teach only
> the current fixed session surface until implementation, help, schemas, API,
> registry backing, and proofs change atomically. Unsupported guidance below is
> declared burn-down baseline, not permission policy.

Use AOS browser features only through the exact installed managed companion.
Never resolve or invoke an ambient Playwright executable, `npx`, a global
install, or a caller-provided runtime path.

## AOS Path

1. Inspect `./aos help browser companion --json`, `./aos help focus --json`,
   `./aos help see --json`, and `./aos help do --json` before using browser arguments.
2. Require `aos browser companion status --json` to report `current`, then use
   `aos focus create` to establish a named managed session.
3. Capture browser state through the narrow
   `aos see capture browser:<session> [--out <png> | --xray]` form, or save it
   with `aos see capture browser:<session> --save` plus only the documented
   saved-workspace flags.
4. Treat each saved address as storage indirection to one Observation Ref or
   Locator. Browser Observation Ref actions fail closed before worker dispatch;
   use only the fixed session operations in this checkpoint.
5. Recapture after mutation. Keep raw output or apply an explicit caller-owned
   compacting, persistence, masking, or projection transform.

## Managed Session Boundary

- `browser://new` launches an AOS-owned session through already-installed
  system Chrome. The companion never installs a browser binary. `--persistent`
  uses a profile private to that session generation; custom profiles are
  unsupported. Initial/navigation URLs are limited to http, https, data, and
  about; never substitute a local file URL.
- `browser://attach --cdp <url>` attaches to one direct CDP endpoint.
- `browser://attach --extension=chrome` uses the reviewed extension handshake.
  It requires the reviewed Playwright extension in an ordinary system-Chrome
  `Default` or `Profile N` profile; missing or unsafe profile evidence fails
  before session creation. The pinned extension-id directory must contain a
  bounded ordinary version directory and matching manifest; an empty directory
  is not installation evidence.
  The handshake may launch or focus Chrome and open its bridge page, but the
  browser, profile, and tabs remain external user-owned state. Removal detaches;
  it never closes or kills that browser.
- `aos focus remove --id <session> --backend browser` closes only launched AOS-owned sessions and
  detaches attached sessions. Cleanup ambiguity remains durable and blocks
  runtime uninstall until cleanup succeeds.
- `aos do navigate|type|key|scroll browser:<session> ...` is the complete public
  session-operation set for this checkpoint. Tab creation and selection are not
  present yet. Only session-only scroll advertises `--dry-run`; it validates
  the target and delta without liveness, worker dispatch, lock creation, or writes.

The separate skills companion remains a path-free planning/check surface. It
does not select or expose a runtime executable and never installs or resolves
executable paths:

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
- Direct browser refs and saved browser handles are Observation Refs.
- Browser ref actions are outside the managed session surface and return `TARGET_ACTION_UNSUPPORTED`.
- Every ref-bearing dry-run/effect request validates only its saved record or
  exact direct grammar, then returns `TARGET_ACTION_UNSUPPORTED` before managed-
  session dispatch. Never recapture, search
  by label, or substitute another state as an action fallback.
- session-only browser `scroll`, `type`, `key`, and `navigate` remain available
  and do not accept `state_id`; navigate, type, and key reject `--dry-run`.

## Stop

Stop when companion state is not current, a session is cleanup-required, the
session generation is unresolved, extension profile evidence is unavailable or
blocked, or a requested primitive is outside the fixed allowlist. Browser
window locality, anchors, DOM hit testing, and ref actions are not admitted.

## References

- `ARCHITECTURE.md`
- `docs/api/aos-capabilities.md`
- `docs/api/aos.md`
- `docs/adr/0041-managed-playwright-companion-runtime.md`
- `docs/adr/0040-ambient-authority-raw-observation-and-target-handles.md`
- `docs/archive/superpowers/specs/2026-04-24-playwright-browser-adapter-design.md`
- `tests/browser/managed-session-lifecycle.test.mjs`
- `tests/browser/managed-session-command.test.mjs`
- `tests/browser/managed-session-consumers.test.mjs`
