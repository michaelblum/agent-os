# Heads-Up Daemon Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the heads-up daemon survive crashes, recover clients automatically, and eliminate all blocking IPC hangs.

**Architecture:** Three layers — launchd supervision (daemon always restarts), avatar-sub reconnection loop (clients recover), IPC hardening (no more indefinite hangs). Plus daemon-side canvas lifecycle events so subscribers learn about canvas create/update/remove.

**Tech Stack:** Swift (Foundation, AppKit), launchd plists, Unix domain sockets, `poll()` for timeouts.

**Spec:** `docs/superpowers/specs/2026-04-04-heads-up-daemon-resilience.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `packages/heads-up/client.swift` | CLI client: install/uninstall commands, ensureDaemon installed-mode guard, connect/read timeouts |
| `packages/heads-up/main.swift` | Entry point: route new `install`/`uninstall` subcommands |
| `packages/heads-up/daemon.swift` | Daemon server: canvas lifecycle event emission |
| `packages/heads-up/canvas.swift` | Canvas manager: lifecycle callback hook |
| `apps/sigil/avatar-ipc.swift` | Avatar IPC: `readWithTimeout()`, `connectSock()` timeout |
| `apps/sigil/avatar-sub.swift` | Avatar subscriber: reconnection loop, state reset, lifecycle event handling |

---

### Task 1: IPC Hardening — `readWithTimeout()` and connect timeout in `avatar-ipc.swift`

**Files:**
- Modify: `apps/sigil/avatar-ipc.swift:14-101`

This task eliminates all blocking reads/connects in the avatar-side IPC. Every downstream task depends on these helpers being safe.

- [ ] **Step 1: Add `readWithTimeout()` helper**

Add this function after the `connectSock()` function (after line 35):

```swift
/// Read with poll-based timeout. Returns bytes read, or -1 on timeout/error.
func readWithTimeout(_ fd: Int32, _ buf: inout [UInt8], _ count: Int, timeoutMs: Int32 = 2000) -> Int {
    var pfd = pollfd(fd: fd, events: Int16(POLLIN), revents: 0)
    let ready = poll(&pfd, 1, timeoutMs)
    guard ready > 0 else { return -1 }  // timeout or poll error
    return read(fd, &buf, count)
}
```

- [ ] **Step 2: Add connect timeout to `connectSock()`**

Replace the current `connectSock()` function (lines 14-35) with:

```swift
func connectSock() -> Int32 {
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else { return -1 }

    // Set non-blocking for connect timeout
    let flags = fcntl(fd, F_GETFL)
    fcntl(fd, F_SETFL, flags | O_NONBLOCK)

    var addr = sockaddr_un()
    addr.sun_family = sa_family_t(AF_UNIX)
    let pathBytes = socketPath.utf8CString
    let maxLen = MemoryLayout.size(ofValue: addr.sun_path)
    withUnsafeMutablePointer(to: &addr.sun_path) { ptr in
        pathBytes.withUnsafeBufferPointer { src in
            UnsafeMutableRawPointer(ptr).copyMemory(
                from: src.baseAddress!, byteCount: min(pathBytes.count, maxLen))
        }
    }
    let r = withUnsafePointer(to: &addr) { p in
        p.withMemoryRebound(to: sockaddr.self, capacity: 1) {
            connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
        }
    }
    if r != 0 {
        if errno == EINPROGRESS {
            // Wait for connect to complete (1s timeout)
            var pfd = pollfd(fd: fd, events: Int16(POLLOUT), revents: 0)
            let ready = poll(&pfd, 1, 1000)
            if ready <= 0 { close(fd); return -1 }
            // Check for connect error
            var optErr: Int32 = 0
            var optLen = socklen_t(MemoryLayout<Int32>.size)
            getsockopt(fd, SOL_SOCKET, SO_ERROR, &optErr, &optLen)
            if optErr != 0 { close(fd); return -1 }
        } else {
            close(fd); return -1
        }
    }

    // Restore blocking mode for subsequent reads/writes
    fcntl(fd, F_SETFL, flags & ~O_NONBLOCK)
    return fd
}
```

- [ ] **Step 3: Apply `readWithTimeout()` to `sendJSON()`**

Replace the current `sendJSON()` function (lines 38-43) with:

```swift
func sendJSON(_ fd: Int32, _ json: String) {
    let line = json + "\n"
    line.withCString { ptr in _ = write(fd, ptr, strlen(ptr)) }
    var buf = [UInt8](repeating: 0, count: 4096)
    _ = readWithTimeout(fd, &buf, buf.count)
}
```

- [ ] **Step 4: Apply `readWithTimeout()` to `getCanvasList()`**

Replace the current `getCanvasList()` function (lines 54-64) with:

```swift
func getCanvasList() -> String {
    let fd = connectSock()
    guard fd >= 0 else { return "" }
    let req = "{\"action\":\"list\"}\n"
    req.withCString { ptr in _ = write(fd, ptr, strlen(ptr)) }
    var buf = [UInt8](repeating: 0, count: 8192)
    let n = readWithTimeout(fd, &buf, buf.count)
    close(fd)
    guard n > 0 else { return "" }
    return String(bytes: buf[0..<n], encoding: .utf8) ?? ""
}
```

- [ ] **Step 5: Apply `readWithTimeout()` to `queryDotPosition()`**

Replace the `read()` call in `queryDotPosition()` (line 89) with:

```swift
    let n = readWithTimeout(fd, &buf, buf.count)
```

(The rest of the function remains unchanged — it already handles `n <= 0` by returning fallback values.)

- [ ] **Step 6: Build and verify**

```bash
cd /Users/Michael/Documents/GitHub/agent-os/apps/sigil && bash build-avatar.sh
```

Expected: compiles cleanly, prints the size of `apps/sigil/build/avatar-sub`.

- [ ] **Step 7: Commit**

```bash
cd /Users/Michael/Documents/GitHub/agent-os
git add apps/sigil/avatar-ipc.swift
git commit -m "feat(avatar-ipc): add poll-based timeouts to all socket reads and connects

readWithTimeout() helper with 2s timeout applied to sendJSON(),
getCanvasList(), queryDotPosition(). connectSock() now uses
non-blocking connect with 1s poll timeout. No more indefinite hangs
when daemon is unresponsive."
```

---

### Task 2: IPC Hardening — Connect and read timeouts in `client.swift`

**Files:**
- Modify: `packages/heads-up/client.swift:7-75`

Same hardening for the CLI client side. Every `heads-up` command goes through `DaemonClient`.

- [ ] **Step 1: Add connect timeout to `DaemonClient.connect()`**

Replace the current `connect()` method (lines 8-18) with:

```swift
    func connect() -> Int32? {
        let sock = socket(AF_UNIX, SOCK_STREAM, 0)
        guard sock >= 0 else { return nil }

        // Non-blocking connect with 1s timeout
        let flags = fcntl(sock, F_GETFL)
        fcntl(sock, F_SETFL, flags | O_NONBLOCK)

        let result = withSockAddr(kSocketPath) { addr, len in
            Foundation.connect(sock, addr, len)
        }

        if result != 0 {
            if errno == EINPROGRESS {
                var pfd = pollfd(fd: sock, events: Int16(POLLOUT), revents: 0)
                let ready = poll(&pfd, 1, 1000)
                if ready <= 0 { close(sock); return nil }
                var optErr: Int32 = 0
                var optLen = socklen_t(MemoryLayout<Int32>.size)
                getsockopt(sock, SOL_SOCKET, SO_ERROR, &optErr, &optLen)
                if optErr != 0 { close(sock); return nil }
            } else {
                close(sock); return nil
            }
        }

        // Restore blocking mode
        fcntl(sock, F_SETFL, flags & ~O_NONBLOCK)
        return sock
    }
```

- [ ] **Step 2: Add read timeout to `DaemonClient.send()`**

Replace the blocking read loop in `send()` (lines 59-67) with:

```swift
        var buffer = Data()
        var chunk = [UInt8](repeating: 0, count: 4096)
        let deadline = Date().addingTimeInterval(10.0)
        while Date() < deadline {
            var pfd = pollfd(fd: fd, events: Int16(POLLIN), revents: 0)
            let remaining = Int32(deadline.timeIntervalSinceNow * 1000)
            let timeoutMs = max(remaining, 100)  // at least 100ms per poll
            let ready = poll(&pfd, 1, timeoutMs)
            if ready <= 0 { break }  // timeout or error
            let bytesRead = read(fd, &chunk, chunk.count)
            if bytesRead <= 0 { break }
            buffer.append(contentsOf: chunk[0..<bytesRead])
            if buffer.contains(UInt8(ascii: "\n")) { break }
        }
```

(The response parsing after this block is unchanged.)

- [ ] **Step 3: Build and verify**

```bash
cd /Users/Michael/Documents/GitHub/agent-os/packages/heads-up && bash build.sh
```

Expected: compiles cleanly.

- [ ] **Step 4: Manual smoke test**

```bash
./heads-up ping
```

Expected: `{"status": "success", "uptime": ...}` if daemon is running, or error message if not. Either way, the command should return within 2 seconds, never hang.

- [ ] **Step 5: Commit**

```bash
cd /Users/Michael/Documents/GitHub/agent-os
git add packages/heads-up/client.swift
git commit -m "feat(heads-up): add poll-based timeouts to CLI client connect and read

DaemonClient.connect() uses non-blocking connect with 1s timeout.
DaemonClient.send() uses poll() before each read with deadline-based
timeout. CLI commands can no longer hang indefinitely on stale sockets."
```

---

### Task 3: Canvas Lifecycle Events in Daemon

**Files:**
- Modify: `packages/heads-up/canvas.swift:253-610`
- Modify: `packages/heads-up/daemon.swift:588-607`

Add a `onCanvasLifecycle` callback to `CanvasManager` that fires on create/update(position)/remove/remove-all/TTL-expire/connection-cleanup. The daemon wires this to relay lifecycle events to all subscribers.

- [ ] **Step 1: Add lifecycle callback to CanvasManager**

In `canvas.swift`, add this property to `CanvasManager` after line 257 (`var onEvent: ...`):

```swift
    /// (canvasID, action, at?) — relayed to subscribers as canvas_lifecycle events
    var onCanvasLifecycle: ((String, String, [CGFloat]?) -> Void)?
```

- [ ] **Step 2: Emit lifecycle from `handleCreate`**

In `canvas.swift`, in `handleCreate()`, right before the `return .ok()` at line 507, add:

```swift
        onCanvasCountChanged?()
        let at: [CGFloat] = [cgFrame.origin.x, cgFrame.origin.y, cgFrame.size.width, cgFrame.size.height]
        onCanvasLifecycle?(id, "created", at)
```

- [ ] **Step 3: Emit lifecycle from `handleUpdate` when position changes**

In `canvas.swift`, in `handleUpdate()`, there are three code paths that change canvas position. Add lifecycle emission after each one:

**Path 1: `--at` direct position (inside `if let at = req.at, at.count == 4` block, after `canvas.offset = nil` at line 523):**

```swift
            let atArr: [CGFloat] = [at[0], at[1], at[2], at[3]]
            onCanvasLifecycle?(id, "updated", atArr)
```

**Path 2: anchor-channel position (after `canvas.updatePosition(cgRect: newFrame)` at line 549):**

```swift
                let atArr: [CGFloat] = [newFrame.origin.x, newFrame.origin.y, newFrame.size.width, newFrame.size.height]
                onCanvasLifecycle?(id, "updated", atArr)
```

**Path 3: anchor-window position (after `canvas.updatePosition(cgRect: newFrame)` at line 565):**

```swift
                    let atArr: [CGFloat] = [newFrame.origin.x, newFrame.origin.y, newFrame.size.width, newFrame.size.height]
                    onCanvasLifecycle?(id, "updated", atArr)
```

- [ ] **Step 4: Emit lifecycle from `handleRemove`**

In `canvas.swift`, in `handleRemove()`, after `canvas.close()` at line 598, add:

```swift
        onCanvasCountChanged?()
        onCanvasLifecycle?(id, "removed", nil)
```

- [ ] **Step 5: Emit lifecycle from `handleRemoveAll`**

In `canvas.swift`, in `handleRemoveAll()`, after `canvases.removeAll()` at line 607, add:

```swift
        // Emit removed for each canvas that was present
        for id in removedIds {
            onCanvasLifecycle?(id, "removed", nil)
        }
        onCanvasCountChanged?()
```

And capture the IDs before removing. Replace lines 603-609 with:

```swift
    private func handleRemoveAll() -> CanvasResponse {
        let removedIds = Array(canvases.keys)
        for (_, canvas) in canvases {
            canvas.close()
        }
        canvases.removeAll()
        stopAnchorPolling()
        for id in removedIds {
            onCanvasLifecycle?(id, "removed", nil)
        }
        onCanvasCountChanged?()
        return .ok()
    }
```

- [ ] **Step 6: Emit lifecycle from `removeByTTL`**

In `canvas.swift`, in `removeByTTL()`, after `canvas.close()` at line 276, add:

```swift
        onCanvasLifecycle?(id, "removed", nil)
```

(This method already calls `onCanvasCountChanged`.)

- [ ] **Step 7: Emit lifecycle from `cleanupConnection`**

In `canvas.swift`, in `cleanupConnection()`, inside the `for id in toRemove` loop after `canvas.close()` at line 289, add:

```swift
                onCanvasLifecycle?(id, "removed", nil)
```

- [ ] **Step 8: Wire lifecycle callback in daemon**

In `daemon.swift`, in `serveCommand()`, after the `onEvent` assignment (after line 606), add:

```swift
    canvasManager.onCanvasLifecycle = { [weak server] canvasID, action, at in
        var payload: [String: Any] = ["type": "canvas_lifecycle", "id": canvasID, "action": action]
        if let at = at {
            payload["at"] = at.map { Double($0) }
        }
        server?.relayEvent(canvasID: "__lifecycle__", payload: payload)
    }
```

Note: We use `canvasID: "__lifecycle__"` as the relay key because `relayEvent` formats as `{"type":"event", "id":"__lifecycle__", "payload":{...}}`. The subscriber parses the inner `payload.type == "canvas_lifecycle"` to distinguish from regular canvas events.

- [ ] **Step 9: Build and verify**

```bash
cd /Users/Michael/Documents/GitHub/agent-os/packages/heads-up && bash build.sh
```

Expected: compiles cleanly.

- [ ] **Step 10: Commit**

```bash
cd /Users/Michael/Documents/GitHub/agent-os
git add packages/heads-up/canvas.swift packages/heads-up/daemon.swift
git commit -m "feat(heads-up): emit canvas_lifecycle events to subscribers

CanvasManager fires onCanvasLifecycle(id, action, at) on create,
update (position change), remove, remove-all, TTL expiry, and
connection cleanup. Daemon relays these to all subscribers as
{type:'canvas_lifecycle', id, action, at} events. Enables clients
to react to canvas create/remove without polling."
```

---

### Task 4: `heads-up install` and `uninstall` Commands

**Files:**
- Modify: `packages/heads-up/client.swift` (add `installCommand()`, `uninstallCommand()`)
- Modify: `packages/heads-up/main.swift:9-71`

- [ ] **Step 1: Add `installCommand()` to `client.swift`**

Add this at the end of `client.swift`, before the closing of the file:

```swift
// MARK: - CLI Command: install

let kPlistLabel = "com.agent-os.heads-up"

func launchAgentPlistPath() -> String {
    let home = NSHomeDirectory()
    return home + "/Library/LaunchAgents/\(kPlistLabel).plist"
}

func installCommand(args: [String]) {
    // Resolve absolute binary path (follow symlinks)
    let rawPath = ProcessInfo.processInfo.arguments[0]
    let resolvedURL = URL(fileURLWithPath: rawPath).standardizedFileURL.resolvingSymlinksInPath()
    let binaryPath = resolvedURL.path

    // Ensure LaunchAgents directory exists
    let launchAgentsDir = NSHomeDirectory() + "/Library/LaunchAgents"
    try? FileManager.default.createDirectory(atPath: launchAgentsDir, withIntermediateDirectories: true)

    // Ensure log directory exists
    try? FileManager.default.createDirectory(atPath: kSocketDir, withIntermediateDirectories: true)
    let logPath = kSocketDir + "/daemon.log"

    // Generate plist
    let plist = """
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
      "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0">
    <dict>
        <key>Label</key>
        <string>\(kPlistLabel)</string>
        <key>ProgramArguments</key>
        <array>
            <string>\(binaryPath)</string>
            <string>serve</string>
            <string>--idle-timeout</string>
            <string>none</string>
        </array>
        <key>KeepAlive</key>
        <true/>
        <key>RunAtLoad</key>
        <true/>
        <key>StandardOutPath</key>
        <string>\(logPath)</string>
        <key>StandardErrorPath</key>
        <string>\(logPath)</string>
        <key>ProcessType</key>
        <string>Interactive</string>
    </dict>
    </plist>
    """

    let plistPath = launchAgentPlistPath()

    // If already installed, unload first
    if FileManager.default.fileExists(atPath: plistPath) {
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        proc.arguments = ["unload", plistPath]
        proc.standardOutput = FileHandle.nullDevice
        proc.standardError = FileHandle.nullDevice
        try? proc.run()
        proc.waitUntilExit()
    }

    // Stop any manually-spawned daemon so launchd takes over
    let client = DaemonClient()
    if let fd = client.connect() {
        close(fd)
        // Daemon is running outside launchd — kill it
        let killProc = Process()
        killProc.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
        killProc.arguments = ["-f", "heads-up serve"]
        killProc.standardOutput = FileHandle.nullDevice
        killProc.standardError = FileHandle.nullDevice
        try? killProc.run()
        killProc.waitUntilExit()
        usleep(500_000)  // let it die
    }

    // Write plist
    do {
        try plist.write(toFile: plistPath, atomically: true, encoding: .utf8)
    } catch {
        exitError("Failed to write plist: \(error)", code: "WRITE_FAILED")
    }

    // Load via launchctl
    let loadProc = Process()
    loadProc.executableURL = URL(fileURLWithPath: "/bin/launchctl")
    loadProc.arguments = ["load", plistPath]
    do { try loadProc.run() } catch {
        exitError("launchctl load failed: \(error)", code: "LAUNCHCTL_FAILED")
    }
    loadProc.waitUntilExit()

    if loadProc.terminationStatus != 0 {
        exitError("launchctl load exited with status \(loadProc.terminationStatus)", code: "LAUNCHCTL_FAILED")
    }

    // Wait for daemon to come up (up to 5s)
    var started = false
    for _ in 0..<50 {
        usleep(100_000)
        if let fd = client.connect() {
            close(fd)
            started = true
            break
        }
    }

    if started {
        let result: [String: Any] = [
            "status": "success",
            "message": "Installed. Daemon managed by launchd.",
            "plist": plistPath,
            "binary": binaryPath,
            "log": logPath
        ]
        if let data = try? JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]),
           let str = String(data: data, encoding: .utf8) {
            print(str)
        }
    } else {
        exitError("Daemon did not start within 5s. Check: launchctl list | grep heads-up", code: "DAEMON_START_TIMEOUT")
    }
}

// MARK: - CLI Command: uninstall

func uninstallCommand(args: [String]) {
    let plistPath = launchAgentPlistPath()

    guard FileManager.default.fileExists(atPath: plistPath) else {
        exitError("Not installed. No plist at \(plistPath)", code: "NOT_INSTALLED")
    }

    // Unload (this stops the daemon)
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/bin/launchctl")
    proc.arguments = ["unload", plistPath]
    do { try proc.run() } catch {
        exitError("launchctl unload failed: \(error)", code: "LAUNCHCTL_FAILED")
    }
    proc.waitUntilExit()

    // Remove plist
    try? FileManager.default.removeItem(atPath: plistPath)

    let result: [String: String] = [
        "status": "success",
        "message": "Uninstalled. Daemon stopped."
    ]
    if let data = try? JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]),
       let str = String(data: data, encoding: .utf8) {
        print(str)
    }
}
```

- [ ] **Step 2: Route new subcommands in `main.swift`**

In `main.swift`, add these cases to the switch statement (after the `listen` case, before `--help`):

```swift
        case "install":
            installCommand(args: Array(args.dropFirst()))
        case "uninstall":
            uninstallCommand(args: Array(args.dropFirst()))
```

Update `printUsage()` to include the new commands. Add after the `serve` line:

```swift
      install                 Install as launchd service (auto-restart on crash)
      uninstall               Remove launchd service
```

- [ ] **Step 3: Build and verify**

```bash
cd /Users/Michael/Documents/GitHub/agent-os/packages/heads-up && bash build.sh
```

Expected: compiles cleanly.

- [ ] **Step 4: Manual smoke test**

```bash
# Install (will kill any running daemon and let launchd manage it)
./heads-up install
# Expected: JSON with status success, plist path, binary path, log path

# Verify it's running
./heads-up ping
# Expected: {"status": "success", "uptime": ...}

# Kill it, verify launchd brings it back
pkill -f "heads-up serve"
sleep 2
./heads-up ping
# Expected: {"status": "success", "uptime": <small number>}

# Uninstall
./heads-up uninstall
# Expected: {"status": "success", "message": "Uninstalled. Daemon stopped."}
```

- [ ] **Step 5: Commit**

```bash
cd /Users/Michael/Documents/GitHub/agent-os
git add packages/heads-up/client.swift packages/heads-up/main.swift
git commit -m "feat(heads-up): add install/uninstall commands for launchd supervision

heads-up install: generates LaunchAgent plist, loads via launchctl,
KeepAlive=true for auto-restart, RunAtLoad for login persistence.
Logs to ~/.config/heads-up/daemon.log. Kills any unmanaged daemon
before loading so launchd takes over cleanly.

heads-up uninstall: unloads plist, removes it, stops daemon."
```

---

### Task 5: Installed-Mode Guard in `ensureDaemon()`

**Files:**
- Modify: `packages/heads-up/client.swift:20-39`

When launchd manages the daemon, `ensureDaemon()` must NOT fork a child process. If it did, the child could race launchd and grab the socket, silently degrading back to unsupervised mode.

- [ ] **Step 1: Replace `ensureDaemon()` with installed-mode-aware version**

Replace the current `ensureDaemon()` method (lines 20-39) with:

```swift
    func ensureDaemon() -> Bool {
        // Fast path: daemon already running
        if let fd = connect() { close(fd); return true }

        let plistPath = launchAgentPlistPath()

        if FileManager.default.fileExists(atPath: plistPath) {
            // INSTALLED MODE: launchd manages the daemon. Never self-spawn.
            // Wait for launchd to start it (up to 10s).
            // Optionally kick launchd to hurry.
            let kickProc = Process()
            kickProc.executableURL = URL(fileURLWithPath: "/bin/launchctl")
            kickProc.arguments = ["kickstart", "gui/\(getuid())/\(kPlistLabel)"]
            kickProc.standardOutput = FileHandle.nullDevice
            kickProc.standardError = FileHandle.nullDevice
            try? kickProc.run()
            kickProc.waitUntilExit()

            for _ in 0..<100 {  // up to 10s
                usleep(100_000)
                if let fd = connect() { close(fd); return true }
            }
            // launchd failed to start daemon — surface the failure
            return false
        }

        // UNMANAGED MODE: spawn child process (legacy fallback)
        let selfPath = ProcessInfo.processInfo.arguments[0]
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: selfPath)
        proc.arguments = ["serve"]
        proc.standardInput = FileHandle.nullDevice
        proc.standardOutput = FileHandle.nullDevice

        // Log to file instead of /dev/null
        let logPath = kSocketDir + "/daemon.log"
        try? FileManager.default.createDirectory(atPath: kSocketDir, withIntermediateDirectories: true)
        FileManager.default.createFile(atPath: logPath, contents: nil)
        if let logHandle = FileHandle(forWritingAtPath: logPath) {
            logHandle.seekToEndOfFile()
            proc.standardError = logHandle
        } else {
            proc.standardError = FileHandle.nullDevice
        }

        do { try proc.run() } catch { return false }

        for _ in 0..<50 {
            usleep(100_000)
            if let fd = connect() {
                close(fd)
                return true
            }
        }
        return false
    }
```

- [ ] **Step 2: Build and verify**

```bash
cd /Users/Michael/Documents/GitHub/agent-os/packages/heads-up && bash build.sh
```

Expected: compiles cleanly.

- [ ] **Step 3: Verify installed mode doesn't self-spawn**

With daemon installed via launchd:

```bash
# Kill daemon
pkill -f "heads-up serve"
# Immediately run a command — ensureDaemon should wait for launchd, NOT fork
./heads-up ping
# Expected: success (launchd restarted, ensureDaemon waited for it)
```

- [ ] **Step 4: Verify unmanaged mode still works**

```bash
# Uninstall first
./heads-up uninstall 2>/dev/null || true
# Kill any daemon
pkill -f "heads-up serve" 2>/dev/null || true
sleep 1
# This should auto-spawn daemon the old way
./heads-up ping
# Expected: success

# Verify crash log exists
ls -la ~/.config/heads-up/daemon.log
# Expected: file exists (not /dev/null)
```

- [ ] **Step 5: Commit**

```bash
cd /Users/Michael/Documents/GitHub/agent-os
git add packages/heads-up/client.swift
git commit -m "fix(heads-up): ensureDaemon respects installed mode, no launchd race

When LaunchAgent plist exists, ensureDaemon waits for launchd (up to
10s with kickstart) instead of forking a child. Prevents unmanaged
daemon from racing launchd for the socket. Unmanaged fallback now
logs stderr to daemon.log instead of /dev/null."
```

---

### Task 6: avatar-sub Reconnection Loop with Lifecycle Events

**Files:**
- Modify: `apps/sigil/avatar-sub.swift:56-57` (coalescing socket close helper)
- Modify: `apps/sigil/avatar-sub.swift:656-716` (subscriber loop)

This is the main recovery mechanism. When the daemon connection drops, avatar-sub resets state, waits, and reconnects. On reconnect it re-subscribes and watches for `canvas_lifecycle` events to learn about the avatar canvas.

- [ ] **Step 1: Add state reset helper**

Add this function in `avatar-sub.swift` before `startSubscriber()` (before line 656):

```swift
/// Reset all interaction state to clean idle. Called on daemon disconnect.
func resetInteractionState() {
    avatarState = .idle
    pressHoldTimer?.cancel()
    pressHoldTimer = nil
    mouseDownOnAvatar = false
    radialMenuActive = false
    cursorDecorationActive = false
    pendingRadialTrackPos = nil
    pendingCursorDecorPos = nil
    interactionGeneration &+= 1  // invalidate any in-flight interactions
    // Zero out avatar geometry — prevents stale hit-testing
    curX = 0; curY = 0; curSize = 0
    // Close coalescing worker socket (will be re-opened if needed)
    closeCoalescingSocket()
    fputs("avatar-sub: interaction state reset.\n", stderr)
}
```

- [ ] **Step 2: Replace `startSubscriber()` with reconnection loop**

Replace the entire `startSubscriber()` function (lines 656-716) with:

```swift
/// Connect to heads-up daemon, subscribe, and read events.
/// Reconnects automatically on disconnect with exponential backoff (1s → 2s, capped).
func startSubscriber() {
    DispatchQueue.global(qos: .userInitiated).async {
        var retryDelay: UInt32 = 1_000_000  // 1s initial, in microseconds
        let maxRetryDelay: UInt32 = 4_000_000  // 4s cap

        while true {
            let fd = connectSock()
            guard fd >= 0 else {
                fputs("avatar-sub: daemon unavailable, retrying in \(retryDelay / 1_000_000)s...\n", stderr)
                usleep(retryDelay)
                retryDelay = min(retryDelay * 2, maxRetryDelay)
                continue
            }

            // Reset retry delay on successful connect
            retryDelay = 1_000_000

            // Subscribe to receive events
            let req = "{\"action\":\"subscribe\"}\n"
            req.withCString { ptr in _ = write(fd, ptr, strlen(ptr)) }

            // Read and discard the subscribe response
            var responseBuf = [UInt8](repeating: 0, count: 4096)
            let subN = readWithTimeout(fd, &responseBuf, responseBuf.count, timeoutMs: 5000)
            guard subN > 0 else {
                fputs("avatar-sub: subscribe failed, retrying...\n", stderr)
                close(fd)
                usleep(retryDelay)
                continue
            }

            // Re-query avatar canvas position (may not exist yet — that's OK)
            queryAvatar()

            fputs("avatar-sub: connected to heads-up daemon.\n", stderr)

            // Event loop: read newline-delimited JSON
            var buffer = Data()
            var chunk = [UInt8](repeating: 0, count: 4096)

            while true {
                let n = read(fd, &chunk, chunk.count)
                guard n > 0 else {
                    fputs("avatar-sub: daemon connection lost, reconnecting...\n", stderr)
                    break
                }
                buffer.append(contentsOf: chunk[0..<n])

                while let newlineIndex = buffer.firstIndex(of: UInt8(ascii: "\n")) {
                    let lineData = Data(buffer[buffer.startIndex..<newlineIndex])
                    buffer = Data(buffer[buffer.index(after: newlineIndex)...])

                    guard !lineData.isEmpty else { continue }
                    if let rawStr = String(data: lineData, encoding: .utf8) {
                        fputs("SUB: \(rawStr.prefix(200))\n", stderr)
                    }
                    guard let json = try? JSONSerialization.jsonObject(with: lineData) as? [String: Any],
                          let type = json["type"] as? String else { continue }

                    // Channel events
                    if type == "channel",
                       let channel = json["channel"] as? String,
                       let data = json["data"] as? [String: Any] {
                        handleChannelEvent(channel: channel, data: data)
                    }

                    // Avatar canvas JS events (from postMessage relay)
                    if type == "event",
                       let id = json["id"] as? String, id == avatarID,
                       let payload = json["payload"] as? [String: Any] {
                        DispatchQueue.global(qos: .userInteractive).async {
                            handleAvatarEvent(payload: payload)
                        }
                    }

                    // Canvas lifecycle events — resync avatar position
                    if type == "event",
                       let id = json["id"] as? String, id == "__lifecycle__",
                       let payload = json["payload"] as? [String: Any],
                       let lifecycleType = payload["type"] as? String, lifecycleType == "canvas_lifecycle",
                       let canvasID = payload["id"] as? String, canvasID == avatarID {

                        let action = payload["action"] as? String ?? ""
                        if action == "created" || action == "updated",
                           let at = payload["at"] as? [Double], at.count >= 3 {
                            curX = at[0]; curY = at[1]; curSize = at[2]
                            fputs("avatar-sub: avatar \(action) at (\(Int(curX)), \(Int(curY)), \(Int(curSize)))\n", stderr)
                        } else if action == "removed" {
                            curX = 0; curY = 0; curSize = 0
                            fputs("avatar-sub: avatar removed, zeroed position.\n", stderr)
                        }
                    }
                }
            }

            close(fd)

            // Connection lost — reset everything
            resetInteractionState()

            // Brief pause before reconnect
            usleep(retryDelay)
        }
    }
}
```

- [ ] **Step 3: Build and verify**

```bash
cd /Users/Michael/Documents/GitHub/agent-os/apps/sigil && bash build-avatar.sh
```

Expected: compiles cleanly.

- [ ] **Step 4: Manual reconnect test**

```bash
# Terminal 1: start avatar-sub (daemon should already be running via launchd)
cd /Users/Michael/Documents/GitHub/agent-os/apps/sigil && ./build/avatar-sub

# Terminal 2: kill daemon, watch avatar-sub reconnect
pkill -f "heads-up serve"
# Watch Terminal 1 for:
#   "avatar-sub: daemon connection lost, reconnecting..."
#   "avatar-sub: interaction state reset."
#   "avatar-sub: daemon unavailable, retrying in 1s..."
#   (after launchd restarts daemon)
#   "avatar-sub: connected to heads-up daemon."

# Click the menu bar icon to create avatar
# Watch Terminal 1 for:
#   "avatar-sub: avatar created at (200, 200, 300)"
```

- [ ] **Step 5: Commit**

```bash
cd /Users/Michael/Documents/GitHub/agent-os
git add apps/sigil/avatar-sub.swift
git commit -m "feat(avatar-sub): reconnection loop with lifecycle-based resync

startSubscriber() now retries on disconnect with backoff (1-4s).
On disconnect: resets all interaction state (avatar state, radial
menu, cursor decoration, coalescing socket) and zeros avatar
position to prevent stale hit-testing. On reconnect: re-subscribes,
re-queries canvas list, watches canvas_lifecycle events to learn
when avatar is created/updated/removed. Full recovery without
manual restart."
```

---

### Task 7: End-to-End Verification

No new code. Verify the full recovery flow works.

- [ ] **Step 1: Full build**

```bash
cd /Users/Michael/Documents/GitHub/agent-os/packages/heads-up && bash build.sh
cd /Users/Michael/Documents/GitHub/agent-os/apps/sigil && bash build-avatar.sh
```

- [ ] **Step 2: Install and start**

```bash
cd /Users/Michael/Documents/GitHub/agent-os/packages/heads-up
./heads-up install
# Expected: success JSON with plist/binary/log paths
```

- [ ] **Step 3: Start avatar-sub**

```bash
cd /Users/Michael/Documents/GitHub/agent-os/apps/sigil && ./build/avatar-sub &
```

Click the menu bar icon to create the avatar. Verify it appears and responds to clicks.

- [ ] **Step 4: Kill daemon, verify full recovery**

```bash
pkill -f "heads-up serve"
```

Watch avatar-sub stderr for:
1. `daemon connection lost, reconnecting...`
2. `interaction state reset.`
3. `daemon unavailable, retrying in 1s...` (brief gap while launchd restarts)
4. `connected to heads-up daemon.`

Then click the menu bar icon. Watch for:
5. `avatar created at (200, 200, 300)` (lifecycle event received)

Verify avatar appears and responds to interaction (click, drag for radial menu).

- [ ] **Step 5: Verify CLI doesn't race launchd**

```bash
# Kill daemon
pkill -f "heads-up serve"
# Immediately run a CLI command
cd /Users/Michael/Documents/GitHub/agent-os/packages/heads-up
./heads-up ping
# Expected: success (waited for launchd, did NOT fork a child)

# Verify only one daemon process
ps aux | grep "heads-up serve" | grep -v grep
# Expected: exactly one process (the launchd-managed one)
```

- [ ] **Step 6: Verify unmanaged fallback still works**

```bash
cd /Users/Michael/Documents/GitHub/agent-os/packages/heads-up
./heads-up uninstall
pkill -f "heads-up serve" 2>/dev/null || true
sleep 1
./heads-up ping
# Expected: success (auto-spawned daemon)

# Verify crash log exists
cat ~/.config/heads-up/daemon.log | tail -5
# Expected: daemon startup messages
```

- [ ] **Step 7: Re-install for ongoing use**

```bash
cd /Users/Michael/Documents/GitHub/agent-os/packages/heads-up
./heads-up install
```
