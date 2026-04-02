# heads-up Foundation Layers 0.5a + 2a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add canvas TTL, ping/health, configurable idle timeout, and eval (JS execution) to the heads-up daemon — the first foundation layer features that prevent orphaned canvases and enable external control of canvas content.

**Architecture:** All changes are in `packages/heads-up/`. TTL adds a per-canvas `DispatchSourceTimer` that auto-removes the canvas on expiry. Ping returns daemon uptime and canvas count. Eval calls `webView.evaluateJavaScript()` on a canvas and returns the result via a nested run-loop pump. Idle timeout becomes a CLI flag on `serve`. Protocol types gain `ttl`, `js`, `result`, and `uptime` fields.

**Tech Stack:** Swift (macOS 14+), WebKit, AppKit, POSIX sockets. Zero external dependencies.

**Spec:** `docs/superpowers/specs/2026-03-27-heads-up-foundation-layers.md` (Layer 0.5a + Layer 2a)

---

## File Structure

```
packages/heads-up/
  protocol.swift      ← MODIFY: add ttl, js, result, uptime fields
  canvas.swift        ← MODIFY: add TTL timer to Canvas, ping/eval/ttl handling to CanvasManager
  daemon.swift        ← MODIFY: configurable idleTimeout, uptime tracking, parse --idle-timeout
  client.swift        ← MODIFY: add --ttl to create/update, add eval/ping CLI commands
  main.swift          ← MODIFY: add eval/ping command routing
  helpers.swift       ← MODIFY: add parseDuration()
  build.sh            ← no changes
```

---

## Task 1: Protocol Additions

**Files:**
- Modify: `packages/heads-up/protocol.swift`

- [ ] **Step 1: Add new fields to CanvasRequest**

Add `ttl` and `js` fields to the `CanvasRequest` struct:

```swift
struct CanvasRequest: Codable {
    let action: String          // "create", "update", "remove", "remove-all", "list", "ping", "eval"
    var id: String?             // canvas ID (required for create/update/remove/eval)
    var at: [CGFloat]?          // [x, y, w, h] in global CG coords (Y-down)
    var anchorWindow: Int?      // CGWindowID to track
    var offset: [CGFloat]?      // [x, y, w, h] relative to anchored window (LCS)
    var html: String?           // HTML content (resolved by client)
    var url: String?            // URL for WKWebView to load directly
    var interactive: Bool?      // override click-through (default: false)
    var ttl: Double?            // seconds until auto-remove (nil = no expiry)
    var js: String?             // JavaScript to evaluate (for "eval" action)
}
```

- [ ] **Step 2: Add new fields to CanvasResponse and CanvasInfo**

Add `result` and `uptime` to `CanvasResponse`. Add `ttl` to `CanvasInfo`:

```swift
struct CanvasResponse: Codable {
    var status: String?         // "success" on success
    var error: String?          // error message on failure
    var code: String?           // machine-readable error code
    var canvases: [CanvasInfo]? // populated by "list" action
    var result: String?         // JS eval return value (for "eval" action)
    var uptime: Double?         // daemon uptime in seconds (for "ping" action)
}

struct CanvasInfo: Codable {
    let id: String
    var at: [CGFloat]           // current [x, y, w, h] in CG coords
    var anchorWindow: Int?
    var offset: [CGFloat]?
    var interactive: Bool
    var ttl: Double?            // remaining seconds until expiry (nil = no expiry)
}
```

- [ ] **Step 3: Build to verify compilation**

Run:
```bash
cd packages/heads-up && bash build.sh
```
Expected: compiles successfully. Existing functionality unchanged (new fields are optional).

- [ ] **Step 4: Commit**

```bash
git add packages/heads-up/protocol.swift
git commit -m "feat(heads-up): add ttl, js, result, uptime fields to protocol types"
```

---

## Task 2: Duration Parser

**Files:**
- Modify: `packages/heads-up/helpers.swift`

- [ ] **Step 1: Add parseDuration function**

Add to the end of `packages/heads-up/helpers.swift`:

```swift
// MARK: - Duration Parser

/// Parse a duration string like "5s", "10m", "1h", or "none".
/// Returns seconds. "none" returns .infinity (no timeout).
func parseDuration(_ str: String) -> TimeInterval {
    if str == "none" { return .infinity }
    let s = str.lowercased()
    if s.hasSuffix("s"), let n = Double(s.dropLast()) { return n }
    if s.hasSuffix("m"), let n = Double(s.dropLast()) { return n * 60 }
    if s.hasSuffix("h"), let n = Double(s.dropLast()) { return n * 3600 }
    if let n = Double(s) { return n }  // plain number = seconds
    exitError("Invalid duration: \(str). Use format like 5s, 10m, 1h, or 'none'.", code: "INVALID_DURATION")
}
```

- [ ] **Step 2: Build**

```bash
cd packages/heads-up && bash build.sh
```
Expected: compiles successfully.

- [ ] **Step 3: Commit**

```bash
git add packages/heads-up/helpers.swift
git commit -m "feat(heads-up): add duration parser (5s, 10m, 1h, none)"
```

---

## Task 3: Canvas TTL

**Files:**
- Modify: `packages/heads-up/canvas.swift`
- Modify: `packages/heads-up/client.swift`

- [ ] **Step 1: Add TTL timer to Canvas class**

Add these properties and methods to the `Canvas` class in `canvas.swift`, after the `isInteractive` property (line 58):

```swift
    var ttlTimer: DispatchSourceTimer?
    var ttlDeadline: Date?         // when the TTL expires (for reporting remaining time)
    var onTTLExpired: (() -> Void)?

    /// Set a TTL in seconds. When it expires, onTTLExpired is called.
    /// Calling again resets the timer. Pass nil to cancel.
    func setTTL(_ seconds: Double?) {
        ttlTimer?.cancel()
        ttlTimer = nil
        ttlDeadline = nil

        guard let seconds = seconds else { return }

        ttlDeadline = Date().addingTimeInterval(seconds)
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + seconds)
        timer.setEventHandler { [weak self] in
            self?.onTTLExpired?()
        }
        timer.resume()
        ttlTimer = timer
    }

    /// Remaining TTL in seconds, or nil if no TTL set.
    var remainingTTL: Double? {
        guard let deadline = ttlDeadline else { return nil }
        return max(0, deadline.timeIntervalSinceNow)
    }
```

- [ ] **Step 2: Update Canvas.close() to cancel the TTL timer**

Replace the `close()` method in Canvas:

```swift
    func close() {
        ttlTimer?.cancel()
        ttlTimer = nil
        window.orderOut(nil)
        window.close()
    }
```

- [ ] **Step 3: Update toInfo() to include remaining TTL**

Replace the `toInfo()` method in Canvas:

```swift
    func toInfo() -> CanvasInfo {
        let f = cgFrame
        return CanvasInfo(
            id: id,
            at: [f.origin.x, f.origin.y, f.size.width, f.size.height],
            anchorWindow: anchorWindowID.map { Int($0) },
            offset: offset.map { [$0.origin.x, $0.origin.y, $0.size.width, $0.size.height] },
            interactive: isInteractive,
            ttl: remainingTTL
        )
    }
```

- [ ] **Step 4: Add canvas-removed callback and TTL handling to CanvasManager**

Add a callback property to `CanvasManager` (after line 136 — the `anchorTimer` property):

```swift
    /// Called whenever the canvas count changes (add, remove, TTL expiry).
    /// The daemon uses this to check idle state.
    var onCanvasCountChanged: (() -> Void)?
```

Add a method to remove a canvas by TTL (after `handleRemoveAll`):

```swift
    /// Remove a canvas due to TTL expiry. Called from Canvas.onTTLExpired.
    func removeByTTL(_ id: String) {
        guard let canvas = canvases.removeValue(forKey: id) else { return }
        canvas.close()
        if !hasAnchoredCanvases { stopAnchorPolling() }
        onCanvasCountChanged?()
    }
```

- [ ] **Step 5: Wire TTL into handleCreate**

In `handleCreate`, after `canvases[id] = canvas` (line 195), add TTL setup:

```swift
        canvas.show()
        canvases[id] = canvas

        // Set up TTL if requested
        if let ttl = req.ttl {
            canvas.onTTLExpired = { [weak self] in
                self?.removeByTTL(id)
            }
            canvas.setTTL(ttl)
        }

        if hasAnchoredCanvases { startAnchorPolling() }
```

- [ ] **Step 6: Wire TTL into handleUpdate**

In `handleUpdate`, before `return .ok()` (line 242), add:

```swift
        // Update TTL if provided
        if let ttl = req.ttl {
            canvas.onTTLExpired = { [weak self] in
                self?.removeByTTL(id)
            }
            canvas.setTTL(ttl > 0 ? ttl : nil)  // ttl=0 clears the TTL
        }

        return .ok()
```

- [ ] **Step 7: Add --ttl flag to createCommand in client.swift**

In `createCommand`, add the `--ttl` case inside the arg parsing switch (after the `--interactive` case):

```swift
        case "--ttl":
            i += 1; guard i < args.count else { exitError("--ttl requires a duration (e.g. 5s, 10m)", code: "MISSING_ARG") }
            ttlValue = args[i]
```

And declare `var ttlValue: String? = nil` at the top of the function (with the other vars).

After building the request (before sending), add:

```swift
    if let ttlStr = ttlValue {
        request.ttl = parseDuration(ttlStr)
    }
```

- [ ] **Step 8: Add --ttl flag to updateCommand in client.swift**

Same pattern in `updateCommand` — add `--ttl` to the switch and `var ttlValue: String? = nil`. Before `let response = client.send(request)`, add:

```swift
    if let ttlStr = ttlValue {
        request.ttl = parseDuration(ttlStr)
    }
```

- [ ] **Step 9: Build and verify**

```bash
cd packages/heads-up && bash build.sh
```
Expected: compiles successfully.

Test TTL:
```bash
# Create a canvas that auto-removes after 3 seconds
./heads-up create --id ttl-test --at 100,100,200,200 --ttl 3s --html '<body style="margin:0;background:rgba(255,0,0,0.3)"></body>'
# Should appear
./heads-up list
# Should show ttl field with ~3 seconds
sleep 4
./heads-up list
# Should show empty canvases array (canvas auto-removed)
```

- [ ] **Step 10: Commit**

```bash
git add packages/heads-up/canvas.swift packages/heads-up/client.swift
git commit -m "feat(heads-up): add canvas TTL — auto-remove after timeout"
```

---

## Task 4: Ping + Configurable Idle Timeout

**Files:**
- Modify: `packages/heads-up/daemon.swift`
- Modify: `packages/heads-up/canvas.swift`

- [ ] **Step 1: Make DaemonServer.idleTimeout configurable**

In `DaemonServer`, change `idleTimeout` from `let` with hardcoded value to a `var` set via `init`:

```swift
    var idleTimeout: TimeInterval

    init(socketPath: String, canvasManager: CanvasManager, idleTimeout: TimeInterval = 5.0) {
        self.socketPath = socketPath
        self.canvasManager = canvasManager
        self.idleTimeout = idleTimeout
    }
```

- [ ] **Step 2: Handle ping in the connection handler**

In `handleConnection`, modify the main dispatch block to intercept ping before CanvasManager:

Replace the block inside the `while let newlineIndex` loop (lines 90–106) with:

```swift
                guard let request = CanvasRequest.from(lineData) else {
                    let errResp = CanvasResponse.fail("Invalid JSON", code: "PARSE_ERROR")
                    self.sendResponse(to: clientFD, errResp)
                    continue
                }

                // Handle ping directly (doesn't need main thread)
                if request.action == "ping" {
                    let uptime = Date().timeIntervalSince(self.startTime)
                    var resp = CanvasResponse.ok()
                    resp.uptime = uptime
                    // Get canvas count on main thread
                    let semaphore = DispatchSemaphore(value: 0)
                    DispatchQueue.main.async {
                        resp.canvases = []  // just count, not full list
                        let count = self.canvasManager.isEmpty ? 0 : -1  // placeholder
                        semaphore.signal()
                    }
                    semaphore.wait()
                    self.sendResponse(to: clientFD, resp)
                    continue
                }

                let semaphore = DispatchSemaphore(value: 0)
                var response = CanvasResponse.fail("Internal error", code: "INTERNAL")
                DispatchQueue.main.async { [weak self] in
                    guard let self = self else { semaphore.signal(); return }
                    response = self.canvasManager.handle(request)
                    self.checkIdle()
                    semaphore.signal()
                }
                semaphore.wait()

                self.sendResponse(to: clientFD, response)
```

Actually, let me simplify — just add "ping" to CanvasManager.handle() instead. It's cleaner.

- [ ] **Step 2 (revised): Add ping handling to CanvasManager**

In `canvas.swift`, add a `startTime` property to CanvasManager:

```swift
class CanvasManager {
    private var canvases: [String: Canvas] = [:]
    private var anchorTimer: DispatchSourceTimer?
    let startTime = Date()
```

Add the "ping" case to the `handle()` switch:

```swift
    func handle(_ request: CanvasRequest) -> CanvasResponse {
        switch request.action {
        case "create":     return handleCreate(request)
        case "update":     return handleUpdate(request)
        case "remove":     return handleRemove(request)
        case "remove-all": return handleRemoveAll()
        case "list":       return handleList()
        case "ping":       return handlePing()
        default:
            return .fail("Unknown action: \(request.action)", code: "UNKNOWN_ACTION")
        }
    }
```

Add the handler:

```swift
    private func handlePing() -> CanvasResponse {
        var resp = CanvasResponse.ok()
        resp.uptime = Date().timeIntervalSince(startTime)
        return resp
    }
```

- [ ] **Step 3: Parse --idle-timeout in serveCommand**

In `daemon.swift`, modify `serveCommand` to parse the flag:

```swift
func serveCommand(args: [String]) {
    var idleTimeout: TimeInterval = 5.0

    var i = 0
    while i < args.count {
        switch args[i] {
        case "--idle-timeout":
            i += 1
            guard i < args.count else { exitError("--idle-timeout requires a duration", code: "MISSING_ARG") }
            idleTimeout = parseDuration(args[i])
        default:
            exitError("Unknown argument: \(args[i])", code: "UNKNOWN_ARG")
        }
        i += 1
    }

    // Check for existing daemon
    let testSock = socket(AF_UNIX, SOCK_STREAM, 0)
    if testSock >= 0 {
        let result = withSockAddr(kSocketPath) { addr, len in
            connect(testSock, addr, len)
        }
        close(testSock)
        if result == 0 {
            exitError("Daemon already running at \(kSocketPath)", code: "ALREADY_RUNNING")
        }
    }

    let canvasManager = CanvasManager()
    let server = DaemonServer(socketPath: kSocketPath, canvasManager: canvasManager, idleTimeout: idleTimeout)

    // Wire up canvas count changes → idle check
    canvasManager.onCanvasCountChanged = { [weak server] in
        server?.checkIdle()
    }

    server.start()

    NSApplication.shared.run()
}
```

- [ ] **Step 4: Skip idle timer when timeout is infinity**

In `DaemonServer.startIdleTimer()`, add a guard:

```swift
    private func startIdleTimer() {
        cancelIdleTimer()
        guard idleTimeout.isFinite else { return }  // "none" = never timeout
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + idleTimeout)
        timer.setEventHandler { [weak self] in
            guard let self = self, self.canvasManager.isEmpty else { return }
            self.shutdown()
        }
        timer.resume()
        idleTimer = timer
    }
```

- [ ] **Step 5: Add ping CLI command to client.swift**

Add to `client.swift`:

```swift
// MARK: - CLI Command: ping

func pingCommand(args: [String]) {
    let request = CanvasRequest(action: "ping")
    let client = DaemonClient()
    guard let fd = client.connect() else {
        exitError("Daemon not running.", code: "NO_DAEMON")
    }
    close(fd)
    let response = client.send(request)
    outputResponse(response)
}
```

- [ ] **Step 6: Add ping and eval routing to main.swift**

In `main.swift`, add cases to the switch:

```swift
        case "ping":
            pingCommand(args: Array(args.dropFirst()))
        case "eval":
            evalCommand(args: Array(args.dropFirst()))
```

(Add these before the `"--help"` case.)

- [ ] **Step 7: Build and verify**

```bash
cd packages/heads-up && bash build.sh
```
Expected: compiles (evalCommand doesn't exist yet — add a stub in client.swift):

```swift
func evalCommand(args: [String]) {
    exitError("eval not yet implemented", code: "NOT_IMPLEMENTED")
}
```

Test ping:
```bash
# Start daemon, create a canvas, then ping
./heads-up create --id test --at 100,100,100,100 --html '<body style="background:red"></body>'
./heads-up ping
# Should show: {"status":"success","uptime":X.XX}
./heads-up remove --id test
```

- [ ] **Step 8: Commit**

```bash
git add packages/heads-up/canvas.swift packages/heads-up/daemon.swift packages/heads-up/client.swift packages/heads-up/main.swift
git commit -m "feat(heads-up): add ping, configurable --idle-timeout, and TTL→idle wiring"
```

---

## Task 5: eval Action

**Files:**
- Modify: `packages/heads-up/canvas.swift`
- Modify: `packages/heads-up/client.swift`

- [ ] **Step 1: Add eval handler to CanvasManager**

In `canvas.swift`, add the "eval" case to the `handle()` switch:

```swift
        case "eval":       return handleEval(request)
```

Add the handler method (after `handlePing`):

```swift
    private func handleEval(_ req: CanvasRequest) -> CanvasResponse {
        guard let id = req.id else {
            return .fail("eval requires --id", code: "MISSING_ID")
        }
        guard let canvas = canvases[id] else {
            return .fail("Canvas '\(id)' not found", code: "NOT_FOUND")
        }
        guard let js = req.js else {
            return .fail("eval requires --js", code: "MISSING_JS")
        }

        // evaluateJavaScript dispatches its callback on the main thread.
        // We're already on the main thread, so pump the run loop to process it.
        var evalResult: String? = nil
        var evalDone = false

        canvas.webView.evaluateJavaScript(js) { result, error in
            if let error = error {
                evalResult = "error: \(error.localizedDescription)"
            } else if let result = result {
                if JSONSerialization.isValidJSONObject(result),
                   let data = try? JSONSerialization.data(withJSONObject: result),
                   let str = String(data: data, encoding: .utf8) {
                    evalResult = str
                } else {
                    evalResult = "\(result)"
                }
            }
            evalDone = true
        }

        let deadline = Date().addingTimeInterval(5.0)
        while !evalDone && Date() < deadline {
            CFRunLoopRunInMode(.defaultMode, 0.01, true)
        }

        if !evalDone {
            return .fail("eval timed out after 5 seconds", code: "EVAL_TIMEOUT")
        }

        var response = CanvasResponse.ok()
        response.result = evalResult
        return response
    }
```

- [ ] **Step 2: Implement evalCommand in client.swift**

Replace the `evalCommand` stub:

```swift
// MARK: - CLI Command: eval

func evalCommand(args: [String]) {
    var id: String? = nil
    var js: String? = nil

    var i = 0
    while i < args.count {
        switch args[i] {
        case "--id":
            i += 1; guard i < args.count else { exitError("--id requires a value", code: "MISSING_ARG") }
            id = args[i]
        case "--js":
            i += 1; guard i < args.count else { exitError("--js requires a value", code: "MISSING_ARG") }
            js = args[i]
        default:
            exitError("Unknown argument: \(args[i])", code: "UNKNOWN_ARG")
        }
        i += 1
    }

    guard let canvasID = id else { exitError("eval requires --id <name>", code: "MISSING_ARG") }
    guard let jsCode = js else { exitError("eval requires --js <code>", code: "MISSING_ARG") }

    var request = CanvasRequest(action: "eval")
    request.id = canvasID
    request.js = jsCode

    let client = DaemonClient()
    guard let fd = client.connect() else {
        exitError("Daemon not running.", code: "NO_DAEMON")
    }
    close(fd)
    let response = client.send(request)
    outputResponse(response)
}
```

- [ ] **Step 3: Build and verify**

```bash
cd packages/heads-up && bash build.sh
```
Expected: compiles.

Test eval:
```bash
# Create a canvas with some JS state
./heads-up create --id eval-test --at 100,100,200,200 --html '<!DOCTYPE html><html><body style="background:blue"><script>var counter = 0; function inc() { return ++counter; }</script></body></html>'

# Eval some JS
./heads-up eval --id eval-test --js "1 + 2"
# Expected: {"result":"3","status":"success"}

./heads-up eval --id eval-test --js "inc()"
# Expected: {"result":"1","status":"success"}

./heads-up eval --id eval-test --js "inc()"
# Expected: {"result":"2","status":"success"}

./heads-up eval --id eval-test --js "document.body.style.background = 'green'"
# Expected: {"result":"green","status":"success"} — canvas turns green

./heads-up remove --id eval-test
```

- [ ] **Step 4: Commit**

```bash
git add packages/heads-up/canvas.swift packages/heads-up/client.swift
git commit -m "feat(heads-up): add eval action — run JavaScript in canvas WKWebView"
```

---

## Task 6: Update Usage Text and CLAUDE.md

**Files:**
- Modify: `packages/heads-up/main.swift`
- Modify: `packages/heads-up/CLAUDE.md`

- [ ] **Step 1: Update usage text in main.swift**

Replace the `printUsage()` function:

```swift
func printUsage() {
    let text = """
    heads-up — Display server for agent-os

    COMMANDS:
      render                  Render HTML/CSS/SVG to a transparent PNG bitmap
      create                  Create a canvas on screen (starts daemon if needed)
      update                  Update an existing canvas
      remove                  Remove a canvas
      remove-all              Remove all canvases
      list                    List active canvases
      ping                    Check if daemon is running, get uptime
      eval                    Run JavaScript in a canvas
      serve                   Start the daemon (normally auto-started by create)

    Run 'heads-up <command> --help' for command-specific options.
    """
    print(text)
}
```

- [ ] **Step 2: Add foundation layer docs to CLAUDE.md**

Add after the "IPC" section in CLAUDE.md:

```markdown
#### Canvas Lifecycle

- `--ttl <duration>` on create/update — auto-remove after timeout (e.g. `5s`, `10m`, `1h`)
- Reset TTL with `heads-up update --id foo --ttl 10s`
- Clear TTL with `heads-up update --id foo --ttl 0`

#### Daemon Configuration

- `heads-up serve --idle-timeout 10m` — daemon exits after this duration with no canvases (default: 5s)
- `heads-up serve --idle-timeout none` — daemon never auto-exits

#### JavaScript Eval

Run JavaScript inside a canvas's WKWebView:

```bash
heads-up eval --id mycanvas --js "document.title"
heads-up eval --id mycanvas --js "setState({mode: 'active'})"
```

Returns `{"status": "success", "result": "..."}` with the JS return value.

#### Health Check

```bash
heads-up ping
# {"status": "success", "uptime": 45.2}
```
```

- [ ] **Step 3: Commit**

```bash
git add packages/heads-up/main.swift packages/heads-up/CLAUDE.md
git commit -m "docs(heads-up): update usage and CLAUDE.md with TTL, eval, ping, idle-timeout"
```

---

## Task 7: Acceptance Tests

- [ ] **Step 1: Build**

```bash
cd packages/heads-up && bash build.sh
```
Expected: compiles successfully.

- [ ] **Step 2: Test TTL auto-removal**

```bash
./heads-up create --id toast --at 200,200,300,100 --ttl 3s --html '<body style="margin:0;background:rgba(0,200,0,0.5);color:white;font:bold 24px sans-serif;display:flex;align-items:center;justify-content:center">Toast! (3s)</body>'
./heads-up list | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'TTL remaining: {d[\"canvases\"][0][\"ttl\"]:.1f}s')"
sleep 4
./heads-up list | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'Canvases: {len(d[\"canvases\"])}')"
```
Expected: Toast appears for 3 seconds then vanishes. First list shows TTL ~3s. Second list shows 0 canvases.

- [ ] **Step 3: Test TTL reset**

```bash
./heads-up create --id ttl-reset --at 200,200,200,200 --ttl 3s --html '<body style="background:rgba(255,0,0,0.3)"></body>'
sleep 2
./heads-up update --id ttl-reset --ttl 5s  # reset clock
sleep 3
./heads-up list | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'Still alive: {len(d[\"canvases\"])} canvas(es)')"
sleep 3
./heads-up list | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'After expiry: {len(d[\"canvases\"])} canvas(es)')"
```
Expected: Canvas survives past the original 3s because TTL was reset to 5s at t=2s. Dies at t≈7s.

- [ ] **Step 4: Test ping**

```bash
./heads-up create --id ping-test --at 100,100,100,100 --html '<body style="background:blue"></body>'
sleep 1
./heads-up ping
```
Expected: `{"status":"success","uptime":X.X}` with uptime > 1.

```bash
./heads-up remove --id ping-test
```

- [ ] **Step 5: Test eval**

```bash
./heads-up create --id eval-test --at 300,300,300,200 --html '<!DOCTYPE html><html><body style="margin:0;background:rgba(0,0,255,0.3);color:white;font:20px sans-serif;padding:20px"><div id="out">Waiting...</div><script>function setMsg(m) { document.getElementById("out").textContent = m; return m; }</script></body></html>'

# Read DOM state
./heads-up eval --id eval-test --js "document.getElementById('out').textContent"

# Modify DOM
./heads-up eval --id eval-test --js "setMsg('Hello from eval!')"

# Return computed value
./heads-up eval --id eval-test --js "2 + 2"

./heads-up remove --id eval-test
```
Expected: First eval returns "Waiting...", second returns "Hello from eval!" (and visually updates the canvas), third returns "4".

- [ ] **Step 6: Test idle timeout**

```bash
# Kill any existing daemon
pkill -f "heads-up serve" 2>/dev/null; rm -f ~/.config/heads-up/sock; sleep 1

# Start with a long idle timeout
./heads-up create --id timeout-test --at 100,100,100,100 --ttl 2s --html '<body style="background:green"></body>'
# Canvas should auto-remove after 2s, daemon should stay alive for default 5s
sleep 3
./heads-up ping  # should still be alive (within 5s idle)
sleep 4
./heads-up ping 2>&1  # should fail (daemon exited after 5s idle)
```
Expected: Ping works at t=3s (daemon alive). Ping fails at t=7s (daemon exited after 5s of no canvases).

- [ ] **Step 7: Commit if any fixes were needed**

```bash
git add packages/heads-up/
git commit -m "fix(heads-up): fixes from foundation layers acceptance testing"
```
