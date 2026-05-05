# Heads-Up Daemon Resilience

**Date:** 2026-04-04
**Session:** daemon-resilience
**Status:** Design approved, pending implementation

## Problem

The heads-up daemon (`heads-up serve`) dies silently and nothing recovers:

- No process supervision — daemon exits and stays dead
- `ensureDaemon()` pipes all daemon output to `/dev/null` — crashes are invisible
- avatar-sub's subscriber thread exits on disconnect and never retries
- `sendOneShot()` / `sendJSON()` block forever if daemon is hung (no read timeout)
- The menu bar icon lives inside the daemon process — when it crashes, the icon vanishes, so there's nothing to click

Users have no indication that anything is wrong and no way to recover without manually restarting processes.

## Solution

Three complementary layers: supervision (daemon always comes back), reconnection (clients recover automatically), and hardening (reduce crashes, eliminate hangs).

## Layer 1: launchd Supervision

### New CLI Subcommands

**`heads-up install`:**

1. Resolve the absolute path to the current `heads-up` binary (`ProcessInfo.processInfo.arguments[0]`, resolved through symlinks)
2. Generate a plist at `~/Library/LaunchAgents/com.agent-os.heads-up.plist`:
   - `Label`: `com.agent-os.heads-up`
   - `ProgramArguments`: `[/absolute/path/to/heads-up, serve, --idle-timeout, none]`
   - `KeepAlive`: `true` — always restart (crash or clean exit)
   - `RunAtLoad`: `true` — starts on login
   - `StandardOutPath`: fully expanded path (tilde not supported in plists) e.g. `/Users/Michael/.config/heads-up/daemon.log`
   - `StandardErrorPath`: same expanded path
   - `ProcessType`: `Interactive`
3. If a daemon is already running (connect check succeeds), stop it so launchd takes over:
   - Send SIGTERM to the existing process (daemon has a SIGTERM handler that calls `shutdown()`)
   - Alternatively, find the PID via `lsof` on the socket file or trial `pkill -f "heads-up serve"`
4. Run `launchctl load ~/Library/LaunchAgents/com.agent-os.heads-up.plist`
5. Wait for daemon to come up (same connect-check loop as `ensureDaemon`, up to 5s)
6. Print success message with log file path

**`heads-up uninstall`:**

1. Run `launchctl unload ~/Library/LaunchAgents/com.agent-os.heads-up.plist`
2. Remove the plist file
3. Print confirmation

### Behavior

- When installed, daemon runs with `--idle-timeout none` — never self-exits
- `KeepAlive: true` means launchd restarts it within ~1 second of any exit
- Rebuilding the binary at the same path requires no plist changes. If the path changes, user runs `heads-up install` again to update

### `ensureDaemon()` Must Respect Installed State

**Problem:** The current `ensureDaemon()` unconditionally forks `heads-up serve` when the socket connect fails. If launchd is managing the daemon but is slow to restart (login, transient gap), the forked child grabs the socket first. launchd's copy then fails with `ALREADY_RUNNING` and gives up. The system silently degrades back to the unsupervised path this spec eliminates.

**Fix:** `ensureDaemon()` checks for the LaunchAgent plist before deciding how to start the daemon:

```
func ensureDaemon() -> Bool {
    // Fast path: daemon already running
    if let fd = connect() { close(fd); return true }

    let plistPath = "~/Library/LaunchAgents/com.agent-os.heads-up.plist" (expanded)

    if FileManager.default.fileExists(atPath: plistPath) {
        // INSTALLED MODE: never self-spawn. Wait for launchd.
        // Optionally kick launchd to hurry: launchctl kickstart gui/$(id -u)/com.agent-os.heads-up
        for _ in 0..<100 {    // up to 10s
            usleep(100_000)
            if let fd = connect() { close(fd); return true }
        }
        return false  // launchd failed to start daemon — don't mask it
    }

    // UNMANAGED MODE: spawn child process (current behavior)
    // ... existing fork logic, with stderr → daemon.log ...
}
```

This ensures:
- **Installed:** `ensureDaemon()` never races launchd. If launchd can't start the daemon in 10s, the failure surfaces (returns false) rather than masking it with an unmanaged fork.
- **Uninstalled:** Falls back to current behavior (spawn child process). No regression.

### Plist Template

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.agent-os.heads-up</string>
    <key>ProgramArguments</key>
    <array>
        <string>{{BINARY_PATH}}</string>
        <string>serve</string>
        <string>--idle-timeout</string>
        <string>none</string>
    </array>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>{{LOG_PATH}}</string>
    <key>StandardErrorPath</key>
    <string>{{LOG_PATH}}</string>
    <key>ProcessType</key>
    <string>Interactive</string>
</dict>
</plist>
```

## Layer 2: avatar-sub Reconnection Loop

### Current Behavior

`startSubscriber()` connects once, reads until disconnect, then the thread exits. avatar-sub keeps running (event tap still works) but loses all daemon communication — no canvas updates, no event relay, no coalescing worker.

### New Behavior

Wrap the subscriber in a retry loop:

```
while true:
    1. Try to connect to daemon socket
       - If fails: log "daemon unavailable, retrying in 2s", sleep 2s, loop
    2. Send subscribe request, read ack
    3. Re-query avatar canvas position (getCanvasList → parseCanvasPosition)
       - Update curX, curY, curSize so hit-testing works
       - If avatar canvas doesn't exist yet, that's fine — click-follow only
    4. Log "reconnected to heads-up daemon"
    5. Enter blocking read loop (same as current)
       - Handle canvas_lifecycle events (see Resync below)
    6. On disconnect:
       a. Log "daemon connection lost, reconnecting..."
       b. Close old coalescing worker socket (if active)
       c. Reset interaction state (see below)
       d. Wait 1s before retry
    7. Loop back to (1)
```

### Canvas Lifecycle Events (Daemon-Side Addition)

**Problem:** The reconnect loop queries canvas list once on reconnect. If the avatar canvas doesn't exist yet (user hasn't clicked the icon), `curX/curY/curSize` stay stale. When the user later clicks and the canvas appears, avatar-sub never learns about it. The current `queryAvatar()` only runs at startup — there's no trigger to re-query.

**Fix:** The daemon emits canvas lifecycle events to all subscribers whenever a canvas is created, updated (position change), or removed:

```json
{"type": "canvas_lifecycle", "id": "avatar", "action": "created", "at": [200, 200, 300, 300]}
{"type": "canvas_lifecycle", "id": "avatar", "action": "updated", "at": [300, 300, 300, 300]}
{"type": "canvas_lifecycle", "id": "avatar", "action": "removed"}
```

Implementation in daemon.swift:
- `CanvasManager` already has `onCanvasCountChanged` callback — extend it (or add a new `onCanvasLifecycle` callback) to emit the event with canvas ID, action, and current position.
- Emit on: `handle()` for `create` action, `handle()` for `update` action (when `at` changes), `handle()` for `remove`/`remove-all`, and `cleanupConnection()`.
- Relay via existing `relayEvent()` infrastructure (same as postMessage events).

Implementation in avatar-sub.swift:
- The subscriber read loop already parses JSON events. Add a case for `type == "canvas_lifecycle"`:
  - If `id == avatarID` and `action == "created"` or `action == "updated"`: extract `at` array, update `curX`, `curY`, `curSize`.
  - If `id == avatarID` and `action == "removed"`: zero out position (disable hit-testing until canvas reappears).

This is a general-purpose mechanism — any subscriber can watch canvas lifecycle, not just avatar-sub.

### State Reset on Disconnect

When the daemon connection drops, avatar-sub resets to a clean idle state:

- `avatarState` → `.idle`
- Cancel `pressHoldTimer` if active
- `radialMenuActive` → `false`
- `mouseDownOnAvatar` → `false`
- `cursorDecorationActive` → `false`
- Close coalescing socket (`coalescingWorkerFD`)
- Clear pending positions (`pendingRadialTrackPos = nil`, `pendingCursorDecorPos = nil`)
- Zero out `curX`, `curY`, `curSize` (prevents stale hit-testing against pre-crash coordinates)

### Recovery Flow

1. Daemon crashes during user interaction
2. avatar-sub detects disconnect, resets to idle (including zeroed position), starts retrying
3. launchd restarts daemon within ~1s
4. Daemon reads config, creates status item (menu bar icon appears)
5. avatar-sub reconnects, re-subscribes, queries canvas list (avatar may or may not exist yet)
6. User clicks icon → avatar canvas created → daemon emits `canvas_lifecycle` event
7. avatar-sub receives lifecycle event → updates `curX/curY/curSize` → hit-testing works → full functionality restored

### What We Don't Do

- Don't re-create the avatar canvas from avatar-sub — the status item click handles that
- Don't try to restore mid-interaction state — if daemon died during a radial menu drag, the interaction is already broken; clean reset is the right answer
- Don't poll for canvas existence — lifecycle events eliminate the need

## Layer 3: Hardening

### 3a. Universal Read Timeout via `readWithTimeout()` Helper

**Problem:** Multiple code paths do blocking `read()` with no timeout. If the daemon accepts the socket but stops replying, the calling thread blocks forever. This affects:

| Call site | File | Impact |
|-----------|------|--------|
| `sendJSON()` | `apps/sigil/avatar-ipc.swift` | Freezes event tap thread (avatar-sub) |
| `getCanvasList()` | `apps/sigil/avatar-ipc.swift` | Freezes reconnect resync (Layer 2 depends on this) |
| `queryDotPosition()` | `apps/sigil/avatar-ipc.swift` | Freezes dot-position query |
| `DaemonClient.send()` | `packages/heads-up/client.swift` | Freezes all CLI commands (`heads-up create`, `heads-up eval`, etc.) |

**Fix:** Create a shared `readWithTimeout()` helper and apply it to every request-response read:

```swift
/// Read with poll-based timeout. Returns bytes read, or -1 on timeout/error.
func readWithTimeout(_ fd: Int32, _ buf: inout [UInt8], _ count: Int, timeoutMs: Int32 = 2000) -> Int {
    var pfd = pollfd(fd: fd, events: Int16(POLLIN), revents: 0)
    let ready = poll(&pfd, 1, timeoutMs)
    guard ready > 0 else { return -1 }  // timeout or poll error
    return read(fd, &buf, count)
}
```

Applied to each call site:

- **`sendJSON()`** — replace `read(fd, &buf, buf.count)` with `readWithTimeout(fd, &buf, buf.count)`. On timeout, return silently (fire-and-forget callers don't check responses).
- **`getCanvasList()`** — replace `read(fd, &buf, buf.count)` with `readWithTimeout(fd, &buf, buf.count)`. On timeout, return `""` (empty list — callers handle this as "no canvases").
- **`queryDotPosition()`** — replace `read(fd, &buf, buf.count)` with `readWithTimeout(fd, &buf, buf.count)`. On timeout, return fallback position `(25.0, 21.5)` (already the default).
- **`DaemonClient.send()`** — replace the blocking read loop with `readWithTimeout()`. On timeout, return `.fail("Read timeout", code: "TIMEOUT")`. CLI prints the error and exits 1. User sees a clear message instead of a hung terminal.

### 3b. Connect Timeout on `connectSock()`

**Problem:** `connect()` on a Unix socket can hang if the socket file exists but the daemon is in a bad state.

**Fix:** Set socket non-blocking before `connect()`, then `poll()` for writeability with a 1-second timeout. Restore blocking mode after connect succeeds:

```swift
func connectSock() -> Int32 {
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else { return -1 }

    // Set non-blocking
    let flags = fcntl(fd, F_GETFL)
    fcntl(fd, F_SETFL, flags | O_NONBLOCK)

    // ... sockaddr_un setup (unchanged) ...

    let r = connect(fd, ...)
    if r != 0 && errno != EINPROGRESS {
        close(fd); return -1
    }

    if r != 0 {
        // Wait for connect to complete (1s timeout)
        var pfd = pollfd(fd: fd, events: Int16(POLLOUT), revents: 0)
        let ready = poll(&pfd, 1, 1000)
        guard ready > 0 else { close(fd); return -1 }
    }

    // Restore blocking mode
    fcntl(fd, F_SETFL, flags)
    return fd
}
```

The same non-blocking connect pattern applies to `DaemonClient.connect()` in `packages/heads-up/client.swift`, which has the same blocking `connect()` call.

### 3c. Daemon Crash Logging

**Problem:** `ensureDaemon()` (the manual-spawn fallback) pipes all daemon output to `/dev/null`. Crashes are invisible.

**Fix:** When spawning the daemon manually (non-launchd path), redirect stderr to `~/.config/heads-up/daemon.log`:

```swift
// In the unmanaged-mode branch of ensureDaemon():
let logPath = kSocketDir + "/daemon.log"
FileManager.default.createFile(atPath: logPath, contents: nil, attributes: nil)
if let logHandle = FileHandle(forWritingAtPath: logPath) {
    logHandle.seekToEndOfFile()
    proc.standardError = logHandle
} else {
    proc.standardError = FileHandle.nullDevice  // last resort
}
proc.standardOutput = FileHandle.nullDevice
```

No changes to daemon code — it already writes errors to stderr. We just stop swallowing them.

## Files Modified

| File | Changes |
|------|---------|
| `packages/heads-up/daemon.swift` | Emit `canvas_lifecycle` events to subscribers on create/update/remove |
| `packages/heads-up/client.swift` | Add `installCommand()`, `uninstallCommand()`. Update `ensureDaemon()` with installed-mode guard + stderr logging. Add `readWithTimeout()` to `DaemonClient.send()`. Add connect timeout to `DaemonClient.connect()`. |
| `packages/heads-up/main.swift` | Route `install` and `uninstall` subcommands |
| `apps/sigil/avatar-sub.swift` | Wrap `startSubscriber()` in retry loop with state reset on disconnect. Handle `canvas_lifecycle` events to resync avatar position. |
| `apps/sigil/avatar-ipc.swift` | Add `readWithTimeout()` helper. Apply to `sendJSON()`, `getCanvasList()`, `queryDotPosition()`. Add connect timeout to `connectSock()`. |

## Verification

```bash
# Install
cd packages/heads-up && ./heads-up install
# Should print: "Installed. Daemon managed by launchd. Logs at ~/.config/heads-up/daemon.log"

# Verify daemon is running
./heads-up ping
# {"status": "success", "uptime": 1.2}

# Kill daemon, verify it comes back
pkill -f "heads-up serve"
sleep 2
./heads-up ping
# {"status": "success", "uptime": 0.8}  ← launchd restarted it

# Verify avatar-sub reconnects
# (start avatar-sub, kill daemon, wait, check avatar-sub stderr for reconnect messages)

# Uninstall
./heads-up uninstall
# Should print: "Uninstalled. Daemon stopped."

# Verify manual spawn still works (fallback path)
./heads-up create --id test --at 100,100,200,200 --html "<div>test</div>"
# Should auto-spawn daemon, create canvas
cat ~/.config/heads-up/daemon.log
# Should contain daemon startup messages (not /dev/null)
```
