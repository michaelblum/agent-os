# Review Fix Plan — hand-off v2 + side-eye daemon

**Date:** 2026-04-01
**Source:** Code review of Phase 1-3 implementation against spec
**Scope:** 2 critical fixes, 7 important fixes, spec update

---

## Critical Fixes

### Fix 1: hand-off signal handler for modifier release

**File:** `packages/hand-off/session.swift`
**Problem:** No SIGINT/SIGTERM handler. If the session is killed, held modifier keys (CMD, SHIFT, etc.) stay stuck at the OS level, making the computer unusable.
**Spec reference:** Section 9 — "On SIGINT/SIGTERM, the session releases all held modifier keys before exiting."

**Implementation:**
- Add a module-level `SessionState?` reference (signal handlers can't capture)
- Register `signal(SIGINT)` and `signal(SIGTERM)` handlers at session startup
- Each handler: iterate held modifiers, post key-up events for each, then `exit(0)`
- The `handleEnd` function already has the modifier release logic — extract it into a standalone `releaseAllModifiers()` function callable from the signal handler

**Test:** Start session, send `key_down cmd`, kill process with SIGTERM, verify CMD is not stuck (e.g., next typed character should not be CMD+char).

---

### Fix 2: side-eye thread safety on SpatialModel.channels

**File:** `packages/side-eye/spatial.swift`
**Problem:** The `channels` dictionary is accessed from the poll timer (utility queue) and connection handlers (userInitiated queue) without synchronization. Crashes under concurrent access.

**Implementation:**
- Add a `private let channelsLock = NSLock()` to `SpatialModel`
- Wrap all reads/writes to `channels` in `channelsLock.lock()` / `channelsLock.unlock()`
- This matches the `subscriberLock` pattern already used in `daemon.swift`
- Alternatively: use a serial dispatch queue for all channel operations

**Test:** Run multiple concurrent focus-create/focus-remove requests while poll timer is active. Verify no crash over 1000 iterations.

---

## Important Fixes

### Fix 3: Wire up channel element resolution in hand-off

**Files:** `packages/hand-off/channel.swift`, `packages/hand-off/actions.swift`
**Problem:** `resolveChannelElement` is implemented but never called. When bound to a channel, `press` still does live AX traversal instead of resolving against channel data.

**Implementation:**
- In `handlePress`, `handleClick`, and other actions that accept element targeting: check if `state.boundChannel != nil` AND the action has targeting fields (role/title/label/identifier) but NO x,y coordinates
- If so, call `resolveChannelElement` first to get `bounds_global` coordinates
- If resolution succeeds, use those coordinates for the CGEvent action (or the resolved AX element reference for AX actions)
- If resolution fails (element not in channel data), fall back to live AX traversal and log a note
- This gives the Phase 2 "press by title alone" workflow: `{"action": "press", "title": "Reply"}` resolves from channel, no AX traversal needed

**Test:** Create a channel file with an element `{role: "AXButton", title: "TestBtn", bounds_global: {x: 100, y: 100, w: 50, h: 30}}`. Bind to channel. Send `{"action": "press", "title": "TestBtn"}`. Verify it resolves from channel data, not live AX.

---

### Fix 4: Bind response missing channel name

**File:** `packages/hand-off/channel.swift`
**Problem:** Bind response doesn't include `channel` field. Spec Section 5.4 shows `"channel": "slack-msgs"` in the response.

**Implementation:**
- Add `var channel: String?` to `ActionResponse` (or reuse `bound_channel`)
- In `handleBind`, set `resp.bound_channel = channelID` (or `resp.channel = channelID`)

**Test:** Send bind action, verify response JSON includes the channel name.

---

### Fix 5: Error code naming alignment

**Files:** `packages/hand-off/actions.swift`, `packages/hand-off/helpers.swift`
**Problem:** Error codes don't match spec. `AX_NOT_TRUSTED` should be `PERMISSION_DENIED`, `UNKNOWN_KEY` should be `INVALID_KEY`, `MISSING_PARAM` should be `MISSING_ARG`.

**Implementation:** Find-and-replace the three code strings. Check every `exitWithError` and `errorResponse` call.

**Test:** Trigger each error condition, verify the code string matches spec Section 9.

---

### Fix 6: CLI type command missing --delay and --variance flags

**File:** `packages/hand-off/cli.swift`
**Problem:** `cliType` doesn't parse `--delay` or `--variance`. Always uses profile defaults.

**Implementation:**
- Parse `--delay <ms>` and `--variance <float>` in `cliType`
- If present, override the profile's `typing_cadence.wpm` (derive WPM from delay) and `typing_cadence.variance`
- Also add `--dwell <ms>` to `cliClick` and `--steps <n>` / `--speed <ms>` to `cliDrag` per spec Section 4.7

**Test:** `hand-off type "hello" --delay 50` should type with 50ms between characters regardless of profile.

---

### Fix 7: side-eye display ID mismatch

**File:** `packages/side-eye/spatial.swift`, `packages/side-eye/enumerate-windows.swift`
**Problem:** Channel files store `target.display` as ordinal (1, 2, 3). `graph-windows --display` filters by `CGDirectDisplayID` (e.g., `724042755`). Can't cross-reference.

**Implementation:**
- Change `DisplayInfo.id` in `enumerate-windows.swift` to use ordinal (matching the spec's shared language table)
- Add `DisplayInfo.cgID` as a separate field for callers that need the raw CGDirectDisplayID
- Update `graph-windows` display filter to match by ordinal
- Update `graph-displays` response to include both `ordinal` and `cgID` (ordinal as the primary `id`)
- Channel files already use ordinal — no change needed there

**Test:** `graph-displays` returns ordinal as `id`. `graph-windows --display 1` returns windows on the main display. Channel `target.display` value works as a filter for `graph-windows`.

---

### Fix 8: side-eye no AX refresh unless window moves

**File:** `packages/side-eye/spatial.swift`
**Problem:** Channel files only update when the window moves. UI content changes (new elements, state changes) are invisible.

**Implementation:**
- In `poll()`, add a periodic full refresh: every 3 seconds (every 3rd poll tick at 1Hz), call `refreshChannel` for all channels regardless of window movement
- This is a compromise between freshness and CPU cost
- The 3s interval is aligned with spec open question #1 (Section 11)

**Test:** Create a channel on an app. Change the app's UI (open a menu, type in a field). Verify channel file updates within 3 seconds.

---

### Fix 9: side-eye snapshot returns hardcoded windows: 0

**File:** `packages/side-eye/spatial.swift`
**Problem:** `SnapshotData(windows: 0)` is hardcoded.

**Implementation:**
- In the snapshot handler, call `CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID)` and count the results
- Or: maintain a cached window count from the poll loop

**Test:** `daemon-snapshot` returns a non-zero window count when windows are on screen.

---

## Spec Updates

### Update 1: Phase 3 navigation verb names

**File:** `docs/superpowers/specs/2026-04-01-hand-off-v2-and-focus-channels.md`
**Section:** 6.1
**Change:** Replace `focus`/`defocus` with `graph-deepen`/`graph-collapse` to match implementation. The implementation's naming is better — `focus` is overloaded (AX focus, focus channel).

### Update 2: click without coordinates

**File:** `docs/superpowers/specs/2026-04-01-hand-off-v2-and-focus-channels.md`
**Section:** 4.2, click action
**Change:** Note that `x`/`y` are optional — if omitted, clicks at current cursor position. This is a beneficial deviation the implementation supports.

---

## Implementation Order

Recommended order for an agent team:

1. **Fix 1 (signal handler)** — critical safety, blocks any real usage
2. **Fix 2 (thread safety)** — critical stability, blocks any concurrent usage
3. **Fix 5 (error codes)** — trivial, 3 string replacements
4. **Fix 4 (bind response)** — trivial, one line
5. **Fix 9 (snapshot windows)** — trivial, one CGWindowList call
6. **Fix 3 (channel element resolution)** — medium, needs careful integration with action handlers
7. **Fix 7 (display ID)** — medium, touches enumerate-windows and graph commands
8. **Fix 6 (CLI timing flags)** — medium, parsing + override logic
9. **Fix 8 (periodic AX refresh)** — small change, needs testing for CPU impact
10. **Spec updates** — can be done anytime

Fixes 1-5 can be done by one agent in a single session. Fixes 6-9 can be parallelized.
