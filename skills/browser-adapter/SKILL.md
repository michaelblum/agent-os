---
name: browser-adapter
description: Retired broad browser adapter skill. Use aos-browser for AOS browser refs and upstream Playwright CLI skills for browser-only primitives.
retired: true
---

# Browser Adapter

This broad skill is retired as installable guidance. It predates the direct AOS
desktop capability map and now competes with the clearer browser boundary.

Use `skills/aos-browser/SKILL.md` for AOS browser saved refs, action envelopes,
and Work Record evidence. Use upstream Playwright CLI skills for browser-only
primitives that AOS does not wrap, including network mocking, storage/auth
state, console/eval, tracing, video, PDF, locator/test generation, test
debugging, uploads, select/check/uncheck, navigation history, reload, and tab
management.

Keep the surviving target contract intact: `ref:<snapshot-id>:<ref>` — the preferred observe-act target for normal browser work.
Direct browser refs are volatile.
Direct browser `type` and `key` are current-host routes.
Saved-ref `type` and `key` are supported for text-compatible browser refs with
dry-run validation before dispatch.

Check the external companion state through:

```bash
./aos skills companion check --name playwright-cli --target path --path /tmp/aos-skills --json
```

AOS must not vendor Playwright CLI skill content. Durable AOS browser contracts
remain in `docs/api/aos.md`, `docs/api/aos-capabilities.md`, and the current
command manifests. Historical adapter design material remains archived at
`docs/archive/superpowers/specs/2026-04-24-playwright-browser-adapter-design.md`.
