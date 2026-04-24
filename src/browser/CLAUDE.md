# src/browser/ — Playwright adapter

This subtree wraps `@playwright/cli` as a subprocess so browsers become
first-class targets for aos's `see`/`do`/`show` verbs.

## Files
- `browser-adapter.swift` — top-level orchestrator (Task 7)
- `playwright-process.swift` — subprocess spawner (Task 4)
- `target-parser.swift` — `browser:<s>[/<ref>]` grammar
- `snapshot-parser.swift` — markdown-tree → AXElementJSON[] (Task 5)
- `session-registry.swift` — CLI-local JSON state (Task 6)
- `anchor-resolver.swift` — static `(CGWindowID, offset)` for `show` (Task 13)
- `playwright-version-check.swift` — version probe + pinned minimum (Task 3)
- `browser-internal.swift` — hidden `aos browser _<op>` debug subcommands

## Escape hatch
Direct `playwright-cli` calls remain supported. aos wraps the common
verbs; use `playwright-cli -s=<session> <verb>` for primitives we do not
expose (tracing, codegen, route mocking, `check`/`uncheck`/`select`,
`upload`, low-level key/mouse pairs, dialog affordances).

## Testing
Tests under `tests/browser/` use a fake `playwright-cli` on `$PATH` for
unit-style coverage; `tests/browser/smoke.test.sh` is opt-in and requires
a real install.
