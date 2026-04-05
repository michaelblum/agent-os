# AOS Phase 5: Toolkit Components — Inspector & Log Console

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the inspector panel (the original "Chrome DevTools for macOS" idea) and log console as toolkit components, with high-level `aos inspect` and `aos log` commands that combine perception + display into single orchestrated experiences.

**Architecture:** HTML/CSS/JS components in `packages/toolkit/components/` rendered as `aos show` canvases. New Swift commands in `src/` that orchestrate the full workflow: ensure daemon, create canvas, subscribe to events, pipe data to canvas via eval. The `aos inspect` command creates a floating overlay showing AX element details under the cursor — the perception daemon feeds it data in real-time. The `aos log` command creates a scrolling log panel that agents can write to.

**Tech Stack:** HTML/CSS/JS for components, Swift for orchestrator commands. No external dependencies. Components use vanilla JS (no frameworks).

**Spec:** `docs/superpowers/specs/2026-04-05-aos-unified-architecture-and-perception-daemon.md` (Section 5, Section 8 Phase 5)

---

## File Structure

```
packages/toolkit/
  components/
    inspector-panel.html      # NEW: AX element metadata overlay
    log-console.html           # NEW: Scrolling log output panel
src/
  commands/
    inspect.swift              # NEW: aos inspect — orchestrates perception + display
    log.swift                  # NEW: aos log — creates and manages log panel
  main.swift                   # MODIFY: add inspect, log routing
```

---

## Task 1: Inspector Panel HTML Component

**Files:**
- Create: `packages/toolkit/components/inspector-panel.html`

### Purpose
A self-contained HTML file that displays AX element metadata: role, title, label, value, bounds, and context path. Designed to be loaded into an `aos show` canvas and updated via `evaluateJavaScript`. Dark theme, compact, readable at small sizes.

- [ ] **Step 1: Write `packages/toolkit/components/inspector-panel.html`**

```html
<!DOCTYPE html>
<html style="background:transparent">
<head>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body {
  background: transparent !important;
  font-family: -apple-system, "SF Mono", "Menlo", monospace;
  font-size: 11px;
  color: #e0e0e0;
  overflow: hidden;
  width: 100%; height: 100%;
}

#panel {
  background: rgba(20, 20, 30, 0.92);
  border: 1px solid rgba(100, 100, 140, 0.4);
  border-radius: 8px;
  padding: 10px 12px;
  width: 100%; height: 100%;
  overflow-y: auto;
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}

.row { display: flex; margin-bottom: 4px; line-height: 1.4; }
.label {
  color: #888;
  min-width: 52px;
  flex-shrink: 0;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.value {
  color: #e8e8f0;
  word-break: break-word;
  flex: 1;
}
.role-badge {
  display: inline-block;
  background: rgba(80, 120, 255, 0.25);
  color: #8ab4ff;
  padding: 1px 6px;
  border-radius: 3px;
  font-weight: 600;
  font-size: 11px;
}
.path {
  color: #999;
  font-size: 10px;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid rgba(100, 100, 140, 0.2);
}
.path span { color: #bbb; }
.path .sep { color: #555; margin: 0 3px; }
.bounds {
  color: #7a9; font-size: 10px; font-family: "SF Mono", monospace;
}
#empty {
  color: #666;
  text-align: center;
  padding: 20px;
  font-style: italic;
}
.header {
  font-size: 9px;
  color: #556;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 8px;
}
</style>
</head>
<body>
<div id="panel">
  <div class="header">AOS Inspector</div>
  <div id="content">
    <div id="empty">Move cursor to inspect elements</div>
  </div>
</div>

<script>
// Bridge: receives data from aos daemon via evaluateJavaScript
// Called as: updateElement({role, title, label, value, bounds, context_path})
function updateElement(data) {
  var c = document.getElementById('content');
  if (!data || !data.role) {
    c.innerHTML = '<div id="empty">No element under cursor</div>';
    return;
  }

  var html = '';

  // Role
  html += '<div class="row"><span class="label">Role</span><span class="value"><span class="role-badge">' +
    esc(data.role) + '</span></span></div>';

  // Title
  if (data.title) {
    html += '<div class="row"><span class="label">Title</span><span class="value">' + esc(data.title) + '</span></div>';
  }

  // Label
  if (data.label) {
    html += '<div class="row"><span class="label">Label</span><span class="value">' + esc(data.label) + '</span></div>';
  }

  // Value
  if (data.value) {
    html += '<div class="row"><span class="label">Value</span><span class="value">' + esc(data.value) + '</span></div>';
  }

  // Bounds
  if (data.bounds) {
    var b = data.bounds;
    html += '<div class="row"><span class="label">Bounds</span><span class="value bounds">' +
      Math.round(b.x) + ', ' + Math.round(b.y) + '  ' +
      Math.round(b.width) + ' × ' + Math.round(b.height) + '</span></div>';
  }

  // Context path
  if (data.context_path && data.context_path.length > 0) {
    html += '<div class="path">';
    for (var i = 0; i < data.context_path.length; i++) {
      if (i > 0) html += '<span class="sep">›</span>';
      html += '<span>' + esc(data.context_path[i]) + '</span>';
    }
    html += '</div>';
  }

  c.innerHTML = html;
}

// Called with cursor position for the header
function updateCursor(x, y, display) {
  var h = document.querySelector('.header');
  h.textContent = 'AOS Inspector — ' + Math.round(x) + ', ' + Math.round(y) + '  Display ' + display;
}

function esc(s) {
  if (!s) return '';
  var d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// headsup bridge
if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.headsup) {
  window.headsup = {
    receive: function(b64) {
      try {
        var msg = JSON.parse(atob(b64));
        if (msg.type === 'element') updateElement(msg.data);
        if (msg.type === 'cursor') updateCursor(msg.x, msg.y, msg.display);
      } catch(e) {}
    }
  };
}
</script>
</body>
</html>
```

- [ ] **Step 2: Verify the HTML renders**

Quick test with aos show render:
```bash
./aos show render --width 320 --height 250 --file packages/toolkit/components/inspector-panel.html --out /tmp/inspector-test.png
ls -la /tmp/inspector-test.png
```
Expected: PNG file created showing the dark panel with "Move cursor to inspect elements" placeholder.

- [ ] **Step 3: Commit**

```bash
git add packages/toolkit/components/inspector-panel.html
git commit -m "feat(toolkit): inspector panel HTML component

Dark-themed AX element metadata display. Shows role, title, label,
value, bounds, context path. Updated via updateElement() JS function.
The original 'Chrome DevTools for macOS' shower thought, realized.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `aos inspect` Command

**Files:**
- Create: `src/commands/inspect.swift`
- Modify: `src/main.swift`

### Purpose
`aos inspect` is the high-level command that brings the shower thought to life. It:
1. Ensures the daemon is running
2. Creates a connection-scoped inspector canvas (positioned in bottom-right corner)
3. Subscribes to perception events at depth 2
4. For each `element_focused` event, pushes the data to the inspector canvas via eval
5. For each `cursor_moved`/`cursor_settled` event, updates the cursor position display
6. Cleans up on Ctrl-C (connection-scoped canvas auto-removes)

- [ ] **Step 1: Write `src/commands/inspect.swift`**

```swift
// inspect.swift — aos inspect: live AX element inspector overlay
//
// Combines perception (depth 2) + display (inspector canvas) into one command.
// Creates a floating overlay showing element details under the cursor.
// Ctrl-C to stop. Canvas is connection-scoped and auto-removes.

import Foundation

func inspectCommand(args: [String]) {
    // Parse position (default: bottom-right corner of main display)
    var panelWidth: Double = 320
    var panelHeight: Double = 250
    var panelX: Double? = nil  // nil = auto-position
    var panelY: Double? = nil

    var i = 0
    while i < args.count {
        switch args[i] {
        case "--at":
            i += 1
            if i < args.count {
                let parts = args[i].split(separator: ",").compactMap { Double($0) }
                if parts.count >= 4 {
                    panelX = parts[0]; panelY = parts[1]
                    panelWidth = parts[2]; panelHeight = parts[3]
                } else if parts.count >= 2 {
                    panelX = parts[0]; panelY = parts[1]
                }
            }
        case "--size":
            i += 1
            if i < args.count {
                let parts = args[i].split(separator: ",").compactMap { Double($0) }
                if parts.count >= 2 { panelWidth = parts[0]; panelHeight = parts[1] }
            }
        default:
            break
        }
        i += 1
    }

    // Auto-position: bottom-right of main display with 20px margin
    if panelX == nil || panelY == nil {
        let mainBounds = CGDisplayBounds(CGMainDisplayID())
        panelX = mainBounds.width - panelWidth - 20
        panelY = mainBounds.height - panelHeight - 20
    }

    // Read the inspector HTML from the toolkit
    let htmlPath = findInspectorHTML()
    guard let htmlData = FileManager.default.contents(atPath: htmlPath),
          let html = String(data: htmlData, encoding: .utf8) else {
        exitError("Cannot read inspector-panel.html at \(htmlPath)", code: "FILE_NOT_FOUND")
    }

    // Connect to daemon
    let fd = connectToDaemon()

    // Set up signal handler for clean exit
    signal(SIGINT) { _ in exit(0) }
    signal(SIGTERM) { _ in exit(0) }

    // Create connection-scoped inspector canvas
    let createReq: [String: Any] = [
        "action": "create",
        "id": "__inspector__",
        "at": [panelX!, panelY!, panelWidth, panelHeight],
        "html": html,
        "scope": "connection"
    ]
    sendJSONAndReadResponse(fd: fd, json: createReq)

    // Subscribe to perception at depth 2
    let subReq: [String: Any] = [
        "action": "perceive",
        "depth": 2,
        "scope": "cursor",
        "rate": "on-settle"
    ]
    sendJSONAndReadResponse(fd: fd, json: subReq)

    fputs("Inspector active. Move cursor to inspect elements. Ctrl-C to stop.\n", stderr)

    // Read event loop
    var buffer = Data()
    var chunk = [UInt8](repeating: 0, count: 4096)

    while true {
        let bytesRead = read(fd, &chunk, chunk.count)
        guard bytesRead > 0 else {
            fputs("Daemon connection lost.\n", stderr)
            break
        }
        buffer.append(contentsOf: chunk[0..<bytesRead])

        while let newlineIndex = buffer.firstIndex(of: UInt8(ascii: "\n")) {
            let lineData = Data(buffer[buffer.startIndex..<newlineIndex])
            buffer = Data(buffer[(buffer.index(after: newlineIndex))...])

            guard let json = try? JSONSerialization.jsonObject(with: lineData) as? [String: Any] else { continue }

            // Only process envelope events (have "v" field)
            guard json["v"] != nil,
                  let event = json["event"] as? String,
                  let data = json["data"] as? [String: Any] else { continue }

            switch event {
            case "element_focused":
                // Push element data to inspector canvas
                let jsData = jsonStringForJS(data)
                let evalReq: [String: Any] = [
                    "action": "eval",
                    "id": "__inspector__",
                    "js": "updateElement(\(jsData))"
                ]
                sendJSONNoResponse(fd: fd, json: evalReq)

            case "cursor_moved", "cursor_settled":
                if let x = data["x"] as? Double,
                   let y = data["y"] as? Double,
                   let display = data["display"] as? Int {
                    let evalReq: [String: Any] = [
                        "action": "eval",
                        "id": "__inspector__",
                        "js": "updateCursor(\(x),\(y),\(display))"
                    ]
                    sendJSONNoResponse(fd: fd, json: evalReq)
                }

            default:
                break
            }
        }
    }

    close(fd)
}

// MARK: - Helpers

/// Find the inspector HTML file. Checks relative to binary, then fallback paths.
private func findInspectorHTML() -> String {
    let candidates = [
        // Relative to binary location
        (CommandLine.arguments[0] as NSString).deletingLastPathComponent + "/../packages/toolkit/components/inspector-panel.html",
        // Relative to working directory
        "packages/toolkit/components/inspector-panel.html",
        // Absolute fallback
        NSString(string: "~/Documents/GitHub/agent-os/packages/toolkit/components/inspector-panel.html").expandingTildeInPath
    ]
    for path in candidates {
        let resolved = (path as NSString).standardizingPath
        if FileManager.default.fileExists(atPath: resolved) { return resolved }
    }
    return candidates.last!  // Will fail with a clear error
}

/// Connect to daemon socket with retry.
private func connectToDaemon() -> Int32 {
    // Try connecting; if daemon not running, try starting it
    var fd = tryConnect()
    if fd < 0 {
        // Try to auto-start daemon
        fputs("Starting daemon...\n", stderr)
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: CommandLine.arguments[0])
        proc.arguments = ["serve", "--idle-timeout", "5m"]
        proc.standardOutput = FileHandle.nullDevice
        proc.standardError = FileHandle.nullDevice
        try? proc.run()

        // Wait up to 3 seconds for daemon to start
        for _ in 0..<30 {
            usleep(100_000)
            fd = tryConnect()
            if fd >= 0 { break }
        }
    }
    guard fd >= 0 else {
        exitError("Cannot connect to daemon. Run 'aos serve' first.", code: "CONNECT_ERROR")
    }
    return fd
}

private func tryConnect() -> Int32 {
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else { return -1 }
    let result = withSockAddr(kAosSocketPath) { addr, len in connect(fd, addr, len) }
    if result != 0 { close(fd); return -1 }
    return fd
}

/// Send JSON and read one response line.
private func sendJSONAndReadResponse(fd: Int32, json: [String: Any]) {
    guard var data = try? JSONSerialization.data(withJSONObject: json, options: [.sortedKeys]) else { return }
    data.append(contentsOf: "\n".utf8)
    data.withUnsafeBytes { ptr in _ = write(fd, ptr.baseAddress!, ptr.count) }

    // Read response (single line)
    var buf = [UInt8](repeating: 0, count: 4096)
    let n = read(fd, &buf, buf.count)
    // Response consumed — don't need to parse it for the orchestrator
    _ = n
}

/// Send JSON without reading response (fire-and-forget for eval).
private func sendJSONNoResponse(fd: Int32, json: [String: Any]) {
    guard var data = try? JSONSerialization.data(withJSONObject: json, options: [.sortedKeys]) else { return }
    data.append(contentsOf: "\n".utf8)
    data.withUnsafeBytes { ptr in _ = write(fd, ptr.baseAddress!, ptr.count) }
}

/// Convert a dictionary to a JSON string safe for embedding in JS.
private func jsonStringForJS(_ dict: [String: Any]) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: dict, options: [.sortedKeys]),
          let str = String(data: data, encoding: .utf8) else { return "{}" }
    return str
}
```

- [ ] **Step 2: Add `inspect` routing to main.swift**

Add to the switch in `AOS.main()`:
```swift
case "inspect":
    inspectCommand(args: Array(args.dropFirst()))
```

Add to `printUsage()` in the Commands section:
```
      inspect              Live AX element inspector overlay
      log                  Display log console panel
```

Add a new section:
```
    Tools:
      inspect [--at x,y,w,h]  Live AX inspector — shows element under cursor
      log [--at x,y,w,h]      Log console — scrolling output panel
```

- [ ] **Step 3: Build and test**

```bash
bash build.sh
```

Test (requires daemon — inspect will auto-start it):
```bash
# Run inspect for a few seconds
timeout 5 ./aos inspect 2>/dev/null &
sleep 3
# Move cursor around during this time
kill %1 2>/dev/null
```
Expected: An inspector overlay appears in the bottom-right corner. Moving the cursor updates it with AX element details.

- [ ] **Step 4: Commit**

```bash
git add src/commands/inspect.swift src/main.swift
git commit -m "feat(aos): aos inspect — live AX element inspector

The shower thought realized: Chrome DevTools inspect mode for macOS.
Creates a floating overlay, subscribes to perception depth 2, pipes
element_focused events to the inspector panel in real-time. Ctrl-C to stop.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Log Console HTML Component

**Files:**
- Create: `packages/toolkit/components/log-console.html`

### Purpose
A scrolling log panel that displays timestamped entries with severity levels (info, warn, error, debug). Agents write to it via eval. Designed for `aos log` or any orchestrator that needs a visible output stream.

- [ ] **Step 1: Write `packages/toolkit/components/log-console.html`**

```html
<!DOCTYPE html>
<html style="background:transparent">
<head>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body {
  background: transparent !important;
  font-family: "SF Mono", "Menlo", "Courier New", monospace;
  font-size: 11px;
  color: #ccc;
  overflow: hidden;
  width: 100%; height: 100%;
}

#console {
  background: rgba(15, 15, 20, 0.94);
  border: 1px solid rgba(80, 80, 120, 0.3);
  border-radius: 8px;
  width: 100%; height: 100%;
  display: flex; flex-direction: column;
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}

#header {
  padding: 6px 10px;
  font-size: 9px;
  color: #556;
  text-transform: uppercase;
  letter-spacing: 1px;
  border-bottom: 1px solid rgba(80, 80, 120, 0.2);
  flex-shrink: 0;
  display: flex;
  justify-content: space-between;
}

#count { color: #667; }

#entries {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.entry {
  padding: 2px 10px;
  line-height: 1.5;
  border-bottom: 1px solid rgba(50, 50, 70, 0.15);
  display: flex;
  gap: 8px;
}
.entry:hover { background: rgba(60, 60, 90, 0.15); }

.ts { color: #556; flex-shrink: 0; font-size: 10px; }
.level { flex-shrink: 0; font-size: 10px; font-weight: 600; min-width: 36px; }
.level.info { color: #6a9; }
.level.warn { color: #da6; }
.level.error { color: #e66; }
.level.debug { color: #88a; }
.msg { flex: 1; word-break: break-word; }

#entries::-webkit-scrollbar { width: 4px; }
#entries::-webkit-scrollbar-track { background: transparent; }
#entries::-webkit-scrollbar-thumb { background: rgba(100,100,140,0.3); border-radius: 2px; }
</style>
</head>
<body>
<div id="console">
  <div id="header">
    <span>AOS Log</span>
    <span id="count">0 entries</span>
  </div>
  <div id="entries"></div>
</div>

<script>
var entryCount = 0;
var maxEntries = 500;

// Push a log entry: pushLog("message", "info|warn|error|debug")
function pushLog(message, level) {
  level = level || 'info';
  var entries = document.getElementById('entries');

  var entry = document.createElement('div');
  entry.className = 'entry';

  var now = new Date();
  var ts = ('0'+now.getHours()).slice(-2) + ':' +
           ('0'+now.getMinutes()).slice(-2) + ':' +
           ('0'+now.getSeconds()).slice(-2);

  entry.innerHTML =
    '<span class="ts">' + ts + '</span>' +
    '<span class="level ' + esc(level) + '">' + esc(level) + '</span>' +
    '<span class="msg">' + esc(message) + '</span>';

  entries.appendChild(entry);
  entryCount++;

  // Prune old entries
  while (entries.children.length > maxEntries) {
    entries.removeChild(entries.firstChild);
  }

  // Auto-scroll to bottom
  entries.scrollTop = entries.scrollHeight;

  // Update count
  document.getElementById('count').textContent = entryCount + ' entries';
}

// Push structured event: pushEvent({message, level, source})
function pushEvent(data) {
  pushLog(data.message || JSON.stringify(data), data.level || 'info');
}

// Clear all entries
function clearLog() {
  document.getElementById('entries').innerHTML = '';
  entryCount = 0;
  document.getElementById('count').textContent = '0 entries';
}

function esc(s) {
  if (!s) return '';
  var d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// headsup bridge
if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.headsup) {
  window.headsup = {
    receive: function(b64) {
      try {
        var msg = JSON.parse(atob(b64));
        if (msg.type === 'log') pushLog(msg.message, msg.level);
        if (msg.type === 'clear') clearLog();
      } catch(e) {}
    }
  };
}
</script>
</body>
</html>
```

- [ ] **Step 2: Verify render**

```bash
./aos show render --width 450 --height 300 --file packages/toolkit/components/log-console.html --out /tmp/log-test.png
ls -la /tmp/log-test.png
```

- [ ] **Step 3: Commit**

```bash
git add packages/toolkit/components/log-console.html
git commit -m "feat(toolkit): log console HTML component

Scrolling log panel with timestamps and severity levels (info, warn,
error, debug). Max 500 entries with auto-prune. Push via pushLog() JS.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `aos log` Command

**Files:**
- Create: `src/commands/log.swift`
- Modify: `src/main.swift`

### Purpose
`aos log` creates a log console canvas and reads from stdin, pushing each line to the console. Useful for piping agent output to a visible panel: `some_agent | aos log`. Also supports `aos log push "message"` for one-shot entries.

- [ ] **Step 1: Write `src/commands/log.swift`**

```swift
// log.swift — aos log: visible log console panel
//
// Creates a scrolling log overlay. Two modes:
//   aos log                — stream: reads stdin, pushes each line to console
//   aos log push "msg"     — one-shot: pushes a single message and exits
//   aos log clear           — clears the log console

import Foundation

func logCommand(args: [String]) {
    let sub = args.first

    // Parse position
    var panelWidth: Double = 450
    var panelHeight: Double = 300
    var panelX: Double? = nil
    var panelY: Double? = nil
    var level = "info"

    var i = 0
    while i < args.count {
        switch args[i] {
        case "--at":
            i += 1
            if i < args.count {
                let parts = args[i].split(separator: ",").compactMap { Double($0) }
                if parts.count >= 4 {
                    panelX = parts[0]; panelY = parts[1]
                    panelWidth = parts[2]; panelHeight = parts[3]
                }
            }
        case "--level":
            i += 1
            if i < args.count { level = args[i] }
        default:
            break
        }
        i += 1
    }

    // Auto-position: bottom-left with margin
    if panelX == nil || panelY == nil {
        let mainBounds = CGDisplayBounds(CGMainDisplayID())
        panelX = 20
        panelY = mainBounds.height - panelHeight - 20
    }

    switch sub {
    case "push":
        // One-shot: push a single message to existing log console
        let message = args.dropFirst().filter { !$0.hasPrefix("--") && $0 != "push" }.joined(separator: " ")
        guard !message.isEmpty else {
            exitError("Usage: aos log push <message>", code: "MISSING_TEXT")
        }
        logPushMessage(message, level: level)
        return

    case "clear":
        logClearConsole()
        return

    default:
        break
    }

    // Stream mode: create console and read stdin
    let htmlPath = findLogHTML()
    guard let htmlData = FileManager.default.contents(atPath: htmlPath),
          let html = String(data: htmlData, encoding: .utf8) else {
        exitError("Cannot read log-console.html at \(htmlPath)", code: "FILE_NOT_FOUND")
    }

    let fd = connectToLogDaemon()

    signal(SIGINT) { _ in exit(0) }
    signal(SIGTERM) { _ in exit(0) }

    // Create connection-scoped log canvas
    let createReq: [String: Any] = [
        "action": "create",
        "id": "__log__",
        "at": [panelX!, panelY!, panelWidth, panelHeight],
        "html": html,
        "scope": "connection"
    ]
    sendLogJSON(fd: fd, json: createReq)
    // Read response
    var respBuf = [UInt8](repeating: 0, count: 4096)
    _ = read(fd, &respBuf, respBuf.count)

    fputs("Log console active. Reading stdin. Ctrl-C to stop.\n", stderr)

    // Push initial entry
    evalLog(fd: fd, message: "Log console started", level: "debug")

    // Read stdin line by line
    while let line = readLine(strippingNewline: true) {
        if line.isEmpty { continue }

        // Try to parse as JSON {message, level}
        if line.hasPrefix("{"),
           let data = line.data(using: .utf8),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let msg = json["message"] as? String {
            let lvl = json["level"] as? String ?? level
            evalLog(fd: fd, message: msg, level: lvl)
        } else {
            evalLog(fd: fd, message: line, level: level)
        }
    }

    close(fd)
}

// MARK: - Helpers

private func evalLog(fd: Int32, message: String, level: String) {
    let escaped = message
        .replacingOccurrences(of: "\\", with: "\\\\")
        .replacingOccurrences(of: "'", with: "\\'")
        .replacingOccurrences(of: "\n", with: "\\n")
    let js = "pushLog('\(escaped)','\(level)')"
    let evalReq: [String: Any] = ["action": "eval", "id": "__log__", "js": js]
    sendLogJSON(fd: fd, json: evalReq)
    // Don't read response — fire and forget for streaming
}

private func logPushMessage(_ message: String, level: String) {
    // Connect to daemon and eval on existing __log__ canvas
    let fd = tryLogConnect()
    guard fd >= 0 else {
        exitError("Daemon not running or no log console active", code: "CONNECT_ERROR")
    }
    evalLog(fd: fd, message: message, level: level)
    // Read response to flush
    var buf = [UInt8](repeating: 0, count: 4096)
    _ = read(fd, &buf, buf.count)
    close(fd)
    print("{\"status\":\"ok\"}")
}

private func logClearConsole() {
    let fd = tryLogConnect()
    guard fd >= 0 else {
        exitError("Daemon not running or no log console active", code: "CONNECT_ERROR")
    }
    let evalReq: [String: Any] = ["action": "eval", "id": "__log__", "js": "clearLog()"]
    sendLogJSON(fd: fd, json: evalReq)
    var buf = [UInt8](repeating: 0, count: 4096)
    _ = read(fd, &buf, buf.count)
    close(fd)
    print("{\"status\":\"ok\"}")
}

private func findLogHTML() -> String {
    let candidates = [
        (CommandLine.arguments[0] as NSString).deletingLastPathComponent + "/../packages/toolkit/components/log-console.html",
        "packages/toolkit/components/log-console.html",
        NSString(string: "~/Documents/GitHub/agent-os/packages/toolkit/components/log-console.html").expandingTildeInPath
    ]
    for path in candidates {
        let resolved = (path as NSString).standardizingPath
        if FileManager.default.fileExists(atPath: resolved) { return resolved }
    }
    return candidates.last!
}

private func connectToLogDaemon() -> Int32 {
    var fd = tryLogConnect()
    if fd < 0 {
        fputs("Starting daemon...\n", stderr)
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: CommandLine.arguments[0])
        proc.arguments = ["serve", "--idle-timeout", "5m"]
        proc.standardOutput = FileHandle.nullDevice
        proc.standardError = FileHandle.nullDevice
        try? proc.run()
        for _ in 0..<30 {
            usleep(100_000)
            fd = tryLogConnect()
            if fd >= 0 { break }
        }
    }
    guard fd >= 0 else {
        exitError("Cannot connect to daemon", code: "CONNECT_ERROR")
    }
    return fd
}

private func tryLogConnect() -> Int32 {
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else { return -1 }
    let result = withSockAddr(kAosSocketPath) { addr, len in connect(fd, addr, len) }
    if result != 0 { close(fd); return -1 }
    return fd
}

private func sendLogJSON(fd: Int32, json: [String: Any]) {
    guard var data = try? JSONSerialization.data(withJSONObject: json, options: [.sortedKeys]) else { return }
    data.append(contentsOf: "\n".utf8)
    data.withUnsafeBytes { ptr in _ = write(fd, ptr.baseAddress!, ptr.count) }
}
```

- [ ] **Step 2: Add `log` routing to main.swift**

Add to the switch in `AOS.main()`:
```swift
case "log":
    logCommand(args: Array(args.dropFirst()))
```

- [ ] **Step 3: Build and test**

```bash
bash build.sh

# Test streaming mode (briefly)
echo -e "First entry\nSecond entry\nThird entry" | timeout 3 ./aos log 2>/dev/null &
sleep 2
kill %1 2>/dev/null

# Test one-shot push (requires log console to be running)
./aos serve &
sleep 1
# Create a log console manually first
./aos show create --id __log__ --at 20,500,450,300 --file packages/toolkit/components/log-console.html
sleep 1
./aos log push "Test message from CLI"
sleep 1
./aos log push "Warning message" --level warn
sleep 1
./aos show remove --id __log__
kill %1 2>/dev/null
```

- [ ] **Step 4: Commit**

```bash
git add src/commands/log.swift src/main.swift
git commit -m "feat(aos): aos log — visible log console panel

Stream mode: pipe stdin to scrolling overlay. One-shot: aos log push 'msg'.
Clear: aos log clear. Auto-positions bottom-left. Connection-scoped canvas.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Integration Testing + Documentation

**Files:**
- Modify: `packages/toolkit/CLAUDE.md`
- Modify: `src/CLAUDE.md`

### Purpose
End-to-end verification of the inspector and log console, plus documentation updates.

- [ ] **Step 1: Full integration test**

```bash
bash build.sh
echo "Binary size: $(du -h aos | cut -f1)"

# 1. Inspector (run briefly)
timeout 4 ./aos inspect 2>/dev/null &
sleep 3
kill %1 2>/dev/null
echo "PASS: inspector ran"

# 2. Log streaming
echo -e "Hello from test\n{\"message\":\"JSON entry\",\"level\":\"warn\"}\nFinal line" | timeout 3 ./aos log 2>/dev/null
echo "PASS: log stream"

# 3. All modules still work
./aos see cursor 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'cursor' in d; print('PASS: see cursor')"
./aos say --list-voices 2>/dev/null | python3 -c "import sys,json; v=json.load(sys.stdin); assert len(v)>0; print('PASS: voices')"

echo "Phase 5 integration complete."
```

- [ ] **Step 2: Update `packages/toolkit/CLAUDE.md`**

Add the new components to the table:

```markdown
| Component | What it does |
|-----------|-------------|
| `cursor-decor.html` | Three.js shape that follows cursor position, configurable geometry and color |
| `inspector-panel.html` | AX element metadata display — role, title, label, value, bounds, context path |
| `log-console.html` | Scrolling timestamped log with severity levels (info, warn, error, debug) |
```

- [ ] **Step 3: Update `src/CLAUDE.md`**

Add to the One-Shot Commands section:
```
aos inspect                       # Live AX element inspector overlay
aos log push "message"            # Push to log console
```

Add to Daemon Mode section:
```
echo "lines" | aos log            # Stream stdin to log overlay
```

Add Tools section:
```
### Tools

High-level commands that combine modules:

- `aos inspect` — perception + display. Shows AX element details under cursor.
- `aos log` — display + stdin. Scrolling log console overlay.
```

- [ ] **Step 4: Commit**

```bash
git add packages/toolkit/CLAUDE.md src/CLAUDE.md
git commit -m "docs: update toolkit and aos docs for Phase 5 components

Inspector panel, log console documented. High-level tools section added.
All five spec phases complete.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Dependency Graph

```
Task 1 (Inspector HTML) ─── Task 2 (aos inspect command)
                                     │
Task 3 (Log console HTML) ─── Task 4 (aos log command)
                                     │
                               Task 5 (Integration + docs)
```

Tasks 1+2 and Tasks 3+4 are independent pairs. Task 5 depends on all of them.
