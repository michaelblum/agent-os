@../AGENTS.md

# `src/act/` Native Action Layer

## Purpose

`src/act/` owns native execution for `aos do`: one-shot CLI primitives,
session-mode action handlers, AX targeting, canvas semantic action targeting,
and focused native owners for exact app, menu, and window lifecycle controls.

## Ownership

- `act-cli.swift` stays the one-shot CLI adapter for shared parsing, dry-run
  response shaping, and primitive dispatch glue.
- `window-lifecycle.swift` owns exact AX window close/minimize/maximize/restore
  behavior, display work-area targeting, Stage Manager thumbnail handling, and
  AX/CG readback confirmation.
- `window-frame-store.swift` owns persisted window frame state used by maximize
  and restore.
- `app-lifecycle.swift` owns AppKit process lifecycle actions.
- `native-menu.swift` owns AX menu path parsing, traversal, prerequisite checks,
  and invocation.
- `actions.swift`, `session.swift`, `targeting.swift`, and adjacent helpers own
  session-mode action execution and reusable act-module mechanics.
- `input-delivery-state.swift` owns the single terminal receipt expectation and
  modifier uncertainty state shared by one-shot and persistent actions.
- `SessionState` owns the CoreGraphics posting source and terminal-event receipt
  boundary used by one-shot and persistent action sessions.

## Local Contracts

- Preserve public CLI entrypoint function names used by `src/main.swift` unless
  the public command dispatch contract intentionally changes.
- Keep app-specific product policy out of this layer; expose reusable native
  primitives and leave product behavior to higher layers.
- Keep exact window lifecycle behavior fail-closed: prerequisites must be
  checked before live mutation, and live mutations must have bounded readback.
- Prepare an action-local receipt tap before posting a discrete CGEvent action
  and do not report success until its exact terminal event has been observed.
  Continuous pointer motion may be coalesced and must not claim such a receipt.
- Keep an unconfirmed modifier transition in session cleanup ownership; a
  receipt timeout means delivery is unknown and must not discard release state.

## Work Guidance

- Prefer focused owner files when native behavior grows beyond adapter glue.
- Keep source-shape tests aligned with the owner file that actually holds the
  behavior they protect.

## Verification

- Run focused Node tests for changed source-shape or command contracts.
- Run `bash tests/native-action-input-delivery.sh` for terminal receipt and
  modifier uncertainty changes.
- Run `bash build.sh --no-restart` after Swift edits that should compile into
  the repo-mode `./aos` binary.

## Child DOX Index
