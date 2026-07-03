# PerceptionEngine Shared-State Race Plan V0

Status: plan only. Do not implement this slice without explicit approval.

## Scope

The July 3 code review still applies to `src/perceive/daemon.swift`: `PerceptionEngine`
mutates and reads shared perception state from multiple queues.

Current race surface:

- The CGEvent tap is installed on `CFRunLoopGetMain()` and calls
  `handleTapEvent`, which reaches `refreshCursorTargetForInputEvent`,
  `checkWindowAndAppChange`, and `queryAXElementAtCursor`.
- `startSettleTimer` creates a timer on `DispatchQueue.global(qos:
  .userInitiated)`; its handler calls `onCursorSettled`, which reads
  `lastCursorPoint`, `lastMoveTime`, `attention`, and mutates
  `lastWindowID`, `lastAppPID`, `lastAppName`, and `lastElementSignature`.
- `startAppLookupRefresh` creates a timer on `DispatchQueue.global(qos:
  .utility)` and replaces `appLookup` while the tap and settle paths read it.
- `cursorIdleTimer?.cancel()` prevents future timer events but does not prove an
  already executing handler has stopped touching shared fields.

This is correctness debt, not product vocabulary work. It crosses event-tap,
settle-timer, app-lookup, and AX telemetry ownership, so implementation needs a
small approved synchronization slice.

## Review-Lane Classification

Review-lane evidence was refreshed after PR #544 at
`3415d37d7d6a9fb0c45ef6c7a5dfacaad678ac4e`.

Critical/high findings from `/Users/Michael/Code/tmp/agent-os-code-review-2026-07-03.md`:

- Host tool-result message shape: fixed. Current code stores tool results with
  role `tool`, includes `tool_name`, and maps to AI SDK `tool-result` parts
  with `toolName`; covered by `packages/host/test/provider/anthropic.test.ts`.
- `aos wiki` traversal: fixed. Current wiki read/mutate paths use
  `containedPath`; covered by `tests/wiki-read-external.sh`,
  `tests/wiki-mutate-external.sh`, and `tests/wiki-seed.sh`.
- Sigil selection overlay `time` ReferenceError: fixed. The frame loop binds
  `time = Number(snapshot.time) || 0`.
- Sigil glTF fallback ReferenceError: fixed. `installFallbackGlyph` calls
  `createFallbackGlyph()`.
- Canvas removal callback leak: fixed. `Canvas.close()` clears `onMessage` and
  `onTTLExpired` before removing the WebKit handler; covered by
  `tests/canvas-close-callback-contract.test.mjs`.
- Invalid click count session trap: fixed. `handleClick` rejects non-positive
  `req.count` before the `1...clickCount` range; covered by
  `tests/click-count-contract.test.mjs`.
- Dead-session terminal keystroke crash: fixed. Terminal sockets guard
  `record.exited` and child stdin has an error handler; covered by
  `tests/sigil-agent-terminal-server.test.mjs`.
- Surface Inspector annotation self-loop hang: fixed. Pinning clears a
  self-parent and ancestor walks have visited guards; covered by
  `tests/toolkit/surface-inspector-annotations.test.mjs`.
- Decision-gate Tab handling: fixed. The focusable NodeList is wrapped with
  `Array.from`; covered by `tests/toolkit/decision-gate.test.mjs`.
- HTML workbench expression sanitizer: fixed. Executable containers including
  `iframe`, `object`, and `embed`, `srcdoc`, event handlers, and script-like URL
  attributes are stripped; covered by
  `tests/toolkit/html-workbench-expression.test.mjs`.

Material medium findings verified as already covered in current HEAD include:

- workspace stale `.write-lock` recovery (`tests/agent-workspace-storage.sh`,
  `tests/agent-workspace-cleanup.sh`);
- gateway wildcard CORS rejection
  (`packages/gateway/test/integration-broker.test.ts`);
- gateway script path containment
  (`tests/gateway-script-registry-paths.test.mjs`);
- shared `runProcess` pipe draining
  (`tests/run-process-drain-contract.test.mjs`);
- event-stream fd ownership
  (`tests/event-stream-fd-ownership-contract.test.mjs`);
- `AosSchemeHandler` main-thread wait removal
  (`tests/daemon/aos-scheme-handler-nonblocking.test.mjs`);
- `refreshChannel` stale-write contract
  (`tests/daemon/spatial-refresh-stale-write.test.mjs`);
- gateway SDK close/timeout handling
  (`tests/gateway-sdk-socket-lifecycle.test.mjs`);
- host `read_file` size and timeout bounds
  (`packages/host/test/tools/read-file.test.ts`).
- host SDK socket close/disconnect, disconnected call, and write-failure
  handling (`packages/host/test/sdk-client.test.ts`).

Remaining review-lane item before returning fully to product-contract phases:
the `PerceptionEngine` shared-state race in `src/perceive/daemon.swift`.

## Implementation Strategy

Preferred approach: make one `PerceptionEngine` serial queue own mutable
perception state.

1. Add a private queue, for example:

   ```swift
   private let stateQueue = DispatchQueue(label: "aos.perception.engine.state")
   ```

2. Route mutation and reads of these fields through that queue:

   - `attention`
   - `lastCursorPoint`
   - `lastMoveTime`
   - `lastWindowID`
   - `lastAppPID`
   - `lastAppName`
   - `lastElementSignature`
   - `appLookup`
   - `cursorIdleTimer`

3. Keep event-tap callback work short:

   - capture the raw event facts needed by the state queue, mainly event type
     and point;
   - enqueue state update work;
   - return the event promptly unless the existing input-safety path needs to
     consume it.

4. Move settle timer ownership onto the same serial queue or schedule the timer
   on that queue. A cancelled timer must not race with an already-running
   handler that reads stale shared fields.

5. Move `appLookup` replacement onto the same state queue. Refresh can compute
   `NSWorkspace.shared.runningApplications` outside the queue if needed, but the
   assignment must happen on the queue and reads must snapshot from the queue.

6. Avoid dispatching `onEvent` while holding mutable state work open if the
   callback can reenter AOS. Build event payloads from a local snapshot, then
   emit outside any synchronous queue section or through a clearly non-reentrant
   path.

7. Keep AX queries bounded and deliberate. If AX calls are too slow for the
   serial queue, split into:

   - state queue snapshots PID, point, and previous signature;
   - worker queue performs AX lookup;
   - state queue compares the returned signature against current state before
     publishing.

   Do not let worker results overwrite newer state.

## Invariants

- No mutable Swift `Dictionary`, `String`, or shared scalar in
  `PerceptionEngine` is read on one queue while written on another.
- `eventTap`, `eventTapSource`, and `eventTapRetryTimer` remain main-runloop
  lifecycle concerns unless an implementation proves a cleaner owner.
- Event-tap callbacks must remain fast and must not block on slow AX traversal.
- `window_entered`, `app_entered`, `element_focused`, and `cursor_settled`
  payload shapes stay byte-compatible.
- Browser context enrichment remains best-effort and cannot publish stale
  context for a newer app/window state.
- Stopping perception cancels timers and prevents later queued callbacks from
  publishing events after stop.

## Proof Strategy

Static-first proof before any live/native run:

- Add a source contract test that fails if `startSettleTimer` or
  `startAppLookupRefresh` creates timers on global queues while directly
  touching the shared fields.
- Extend `tests/daemon/perception-ax-telemetry.test.mjs` or add a sibling test
  that asserts:
  - a named serial state queue exists;
  - shared fields are accessed through state-queue helpers or snapshots;
  - worker AX results revalidate against current state before publishing;
  - payload construction remains compatible.
- Run:
  - `node --test tests/daemon/perception-ax-telemetry.test.mjs`
  - the new perception race contract test;
  - `bash tests/input-safety-hotkeys.sh` if the event-tap lifecycle code moves;
  - `git diff --check`.

Runtime proof only if the implementation changes event-tap lifecycle or AX live
behavior beyond queue confinement:

- stop before Level 4 live proof;
- name the exact proof bundle;
- ask Michael for explicit approval only then.

## Rollback Boundary

This should be one PR touching only:

- `src/perceive/daemon.swift`;
- focused daemon/perception tests.

Do not combine with product-contract docs, saved-ref behavior, native proof
claims, or unrelated Swift concurrency cleanup.

Rollback should restore the previous `PerceptionEngine` implementation and
remove only the focused tests from the same PR.

## Stop Conditions

Stop before coding if:

- the implementation needs a native rebuild plus TCC-gated live proof for the
  correctness claim;
- queue confinement would change public event payloads or event ordering
  semantics;
- AX lookup must move to a worker queue without a clear stale-result rejection
  rule;
- another shared-state race outside `src/perceive/daemon.swift` becomes
  entangled with this fix.
