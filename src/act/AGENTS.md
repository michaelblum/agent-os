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
- `targeting-selection.swift` owns the pure exact-one Locator decision shared
  by native AX and canvas target resolution, plus the pure native-session
  target-state admission decision.
- Native AX set-value dry-run and effectful execution share
  `setValueLocatorRequest`; it must preserve every Locator field, including
  `window_id`, while excluding only the mutation value from resolution.
- `input-delivery-state.swift` owns the single terminal receipt expectation and
  modifier uncertainty state shared by one-shot and persistent actions.
- `input-receipt-tap.swift` owns the continuously serviced receipt event tap
  and its dedicated run-loop thread.
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
- Keep receipt-tap run-loop servicing independent of action duration; long
  drag, scroll, or typing transactions must not defer tap callbacks until the
  terminal wait.
- After drag down is acknowledged, keep a best-effort mouse-up obligation
  active across every failure path and fulfill it only after terminal up is
  acknowledged.
- Native AX and canvas Locators must reject zero or multiple current matches.
  Native `index` is explicit action-compatible BFS-order disambiguation; `near`
  succeeds only for one unique closest action-compatible bounded candidate and
  reports bounded candidate facts on ambiguity. Native AX Locator traversal is
  capped at depth 128 and timeout 30,000 ms at both parsing and execution; the
  remaining execution deadline is installed on each exact AX object before
  every synchronous match, traversal, bounds, fact, and compatibility call.
- Native NDJSON session requests reject every non-null `state_id` with
  `TARGET_STATE_UNSUPPORTED` before channel refresh or action dispatch; that
  session has no browser Observation Ref backend.

## Work Guidance

- Prefer focused owner files when native behavior grows beyond adapter glue.
- Keep source-shape tests aligned with the owner file that actually holds the
  behavior they protect.

## Verification

- Run focused Node tests for changed source-shape or command contracts.
- Run `bash tests/native-action-input-delivery.sh` for terminal receipt and
  modifier uncertainty changes.
- Run `bash tests/native-target-locator-selection.sh` for Locator selection.
- Follow the ADR 0023/test-ladder checkpoint before compiling Swift changes
  into the repo-mode binary. When native/TCC work is explicitly out of scope,
  use focused Swift typechecks or harnesses instead.

## Child DOX Index
