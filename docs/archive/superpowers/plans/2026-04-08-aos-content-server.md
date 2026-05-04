# AOS Content Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a built-in HTTP file server to the AOS daemon so WKWebView canvases can load multi-file HTML surfaces (with ES modules) without bundling.

**Architecture:** A new `ContentServer` class using Apple's Network framework (`NWListener`) runs inside `aos serve` alongside the existing Unix socket. It serves static files from configurable content roots on `127.0.0.1`. Canvases use `loadURL("http://localhost:PORT/...")`. An `aos://` URL prefix is rewritten to the real address inside the daemon.

**Tech Stack:** Swift, Network framework (NWListener/NWConnection), existing AOS config system

**Spec:** `docs/superpowers/specs/2026-04-08-aos-content-server.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/content/server.swift` | Create | `ContentServer` class — NWListener, HTTP request parsing, file serving, MIME types |
| `src/shared/config.swift` | Modify | Add `ContentConfig` struct with port and roots |
| `src/daemon/unified.swift` | Modify | Create and start `ContentServer`, wire `content_status` action, expose port for `aos://` rewriting |
| `src/display/canvas.swift` | Modify | Rewrite `aos://` URLs in `loadURL()` |
| `src/commands/serve.swift` | Modify | Pass config to daemon (if needed for content config) |
| `src/display/client.swift` | Modify | Rewrite `aos://` URLs in `--url` argument on CLI side |

---

### Task 1: ContentConfig in config.swift

**Files:**
- Modify: `src/shared/config.swift`

- [ ] **Step 1: Add ContentConfig struct and wire it into AosConfig**

In `src/shared/config.swift`, add the new config struct and field:

```swift
struct ContentConfig: Codable {
    var port: Int
    var roots: [String: String]  // prefix -> directory path
}
```

Add to `AosConfig`:

```swift
struct AosConfig: Codable {
    var voice: VoiceConfig
    var perception: PerceptionConfig
    var feedback: FeedbackConfig
    var status_item: StatusItemConfig?
    var content: ContentConfig?         // ← add
    // ... rest unchanged
}
```

Update `AosConfig.defaults`:

```swift
static let defaults = AosConfig(
    voice: VoiceConfig(enabled: false, announce_actions: true, voice: nil, rate: nil),
    perception: PerceptionConfig(default_depth: 1, settle_threshold_ms: 200),
    feedback: FeedbackConfig(visual: true, sound: false),
    status_item: nil,
    content: nil                        // ← add
)
```

- [ ] **Step 2: Add `aos set content.*` support in `setConfigValue`**

Add these cases to the `switch key` block in `setConfigValue`:

```swift
case "content.port":
    if config.content == nil { config.content = ContentConfig(port: 0, roots: [:]) }
    if let n = Int(value), n >= 0 { config.content?.port = n }
    else { exitError("content.port must be a non-negative integer", code: "INVALID_VALUE") }
case _ where key.hasPrefix("content.roots."):
    if config.content == nil { config.content = ContentConfig(port: 0, roots: [:]) }
    let rootName = String(key.dropFirst("content.roots.".count))
    guard !rootName.isEmpty else { exitError("content.roots requires a name", code: "INVALID_VALUE") }
    config.content?.roots[rootName] = value
```

- [ ] **Step 3: Build and verify config compiles**

Run:
```bash
cd /Users/Michael/Code/agent-os && bash build.sh
```
Expected: Compiles with no errors.

- [ ] **Step 4: Test config round-trip**

```bash
./aos set content.port 0
./aos set content.roots.sigil apps/sigil
cat ~/.config/aos/repo/config.json | python3 -m json.tool | grep -A5 content
```
Expected: Config file contains `content` section with port and roots.

- [ ] **Step 5: Commit**

```bash
git add src/shared/config.swift
git commit -m "feat(daemon): add ContentConfig for content server port and roots"
```

---

### Task 2: ContentServer — HTTP file server

**Files:**
- Create: `src/content/server.swift`

This is the core implementation. The server uses `NWListener` to accept TCP connections, parses minimal HTTP/1.1 GET requests, resolves paths against content roots, and serves files with correct MIME types.

- [ ] **Step 1: Create `src/content/server.swift` with the full ContentServer class**

```swift
// content/server.swift — Lightweight HTTP file server for local content
//
// Serves static files from named content roots over localhost.
// Used by WKWebView canvases to load multi-file HTML surfaces
// (ES modules, CSS imports, etc.) without bundling.

import Foundation
import Network

class ContentServer {
    private var listener: NWListener?
    private let roots: [String: String]  // URL prefix -> absolute directory path
    let port: NWEndpoint.Port
    var assignedPort: UInt16 = 0

    init(config: ContentConfig?, repoRoot: String?) {
        let cfg = config ?? ContentConfig(port: 0, roots: [:])
        self.port = cfg.port == 0 ? .any : NWEndpoint.Port(rawValue: UInt16(cfg.port))!

        // Resolve root paths: relative paths resolve against repo root
        var resolved: [String: String] = [:]
        for (prefix, path) in cfg.roots {
            if path.hasPrefix("/") {
                resolved[prefix] = path
            } else if let root = repoRoot {
                resolved[prefix] = (root as NSString).appendingPathComponent(path)
            } else {
                fputs("Warning: content root '\(prefix)' has relative path '\(path)' but no repo root found — skipping\n", stderr)
            }
        }
        self.roots = resolved
    }

    func start() {
        guard !roots.isEmpty else {
            fputs("Content server: no roots configured, skipping\n", stderr)
            return
        }

        let params = NWParameters.tcp
        // Force IPv4 localhost only
        params.requiredLocalEndpoint = NWEndpoint.hostPort(host: .ipv4(.loopback), port: port)

        do {
            listener = try NWListener(using: params)
        } catch {
            fputs("Content server: failed to create listener: \(error)\n", stderr)
            return
        }

        listener?.stateUpdateHandler = { [weak self] state in
            switch state {
            case .ready:
                if let port = self?.listener?.port?.rawValue {
                    self?.assignedPort = port
                    fputs("Content server listening on http://127.0.0.1:\(port)/\n", stderr)
                    // Log available roots
                    for (prefix, dir) in self?.roots ?? [:] {
                        fputs("  /\(prefix)/ → \(dir)\n", stderr)
                    }
                }
            case .failed(let error):
                fputs("Content server failed: \(error)\n", stderr)
                self?.listener?.cancel()
            default:
                break
            }
        }

        listener?.newConnectionHandler = { [weak self] connection in
            self?.handleConnection(connection)
        }

        listener?.start(queue: DispatchQueue(label: "aos.content-server"))
    }

    func stop() {
        listener?.cancel()
        listener = nil
    }

    // MARK: - Connection Handling

    private func handleConnection(_ connection: NWConnection) {
        connection.start(queue: DispatchQueue(label: "aos.content-conn"))

        // Read up to 8KB for the HTTP request (headers only, no body needed)
        connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] data, _, _, error in
            guard let self = self, let data = data, error == nil else {
                connection.cancel()
                return
            }

            let request = String(data: data, encoding: .utf8) ?? ""
            let response = self.handleHTTPRequest(request)

            connection.send(content: response, completion: .contentProcessed { _ in
                connection.cancel()
            })
        }
    }

    // MARK: - HTTP Request Processing

    private func handleHTTPRequest(_ raw: String) -> Data {
        // Parse request line: "GET /path HTTP/1.1"
        let lines = raw.components(separatedBy: "\r\n")
        guard let requestLine = lines.first else {
            return httpResponse(status: 400, statusText: "Bad Request", body: "Bad Request")
        }

        let parts = requestLine.split(separator: " ", maxSplits: 2)
        guard parts.count >= 2 else {
            return httpResponse(status: 400, statusText: "Bad Request", body: "Bad Request")
        }

        let method = String(parts[0])
        guard method == "GET" || method == "HEAD" else {
            return httpResponse(status: 405, statusText: "Method Not Allowed", body: "Method Not Allowed")
        }

        let rawPath = String(parts[1])

        // Strip query string
        let path = rawPath.components(separatedBy: "?").first ?? rawPath

        // URL-decode the path
        guard let decoded = path.removingPercentEncoding else {
            return httpResponse(status: 400, statusText: "Bad Request", body: "Bad path encoding")
        }

        // Block directory traversal
        if decoded.contains("..") {
            return httpResponse(status: 403, statusText: "Forbidden", body: "Forbidden")
        }

        // Strip leading slash, split into prefix + rest
        let trimmed = decoded.hasPrefix("/") ? String(decoded.dropFirst()) : decoded
        guard !trimmed.isEmpty else {
            return httpResponse(status: 404, statusText: "Not Found", body: "Not Found")
        }

        // Find matching content root
        let segments = trimmed.split(separator: "/", maxSplits: 1)
        let prefix = String(segments[0])

        guard let rootDir = roots[prefix] else {
            return httpResponse(status: 404, statusText: "Not Found", body: "Unknown content root: \(prefix)")
        }

        let relativePath = segments.count > 1 ? String(segments[1]) : "index.html"
        let filePath = (rootDir as NSString).appendingPathComponent(relativePath)

        // Resolve symlinks and verify the file is within the root
        let resolvedPath = (filePath as NSString).standardizingPath
        let resolvedRoot = (rootDir as NSString).standardizingPath
        guard resolvedPath.hasPrefix(resolvedRoot) else {
            return httpResponse(status: 403, statusText: "Forbidden", body: "Forbidden")
        }

        // Read file
        guard FileManager.default.fileExists(atPath: resolvedPath),
              let fileData = FileManager.default.contents(atPath: resolvedPath) else {
            return httpResponse(status: 404, statusText: "Not Found", body: "Not Found: \(decoded)")
        }

        let mimeType = mimeTypeForExtension((resolvedPath as NSString).pathExtension)
        let isHead = method == "HEAD"

        return httpResponse(status: 200, statusText: "OK", contentType: mimeType, body: isHead ? nil : fileData)
    }

    // MARK: - HTTP Response Building

    private func httpResponse(status: Int, statusText: String, body: String) -> Data {
        httpResponse(status: status, statusText: statusText, contentType: "text/plain; charset=utf-8", body: body.data(using: .utf8))
    }

    private func httpResponse(status: Int, statusText: String, contentType: String, body: Data?) -> Data {
        let bodyLen = body?.count ?? 0
        var header = "HTTP/1.1 \(status) \(statusText)\r\n"
        header += "Content-Type: \(contentType)\r\n"
        header += "Content-Length: \(bodyLen)\r\n"
        header += "Connection: close\r\n"
        header += "Access-Control-Allow-Origin: *\r\n"
        header += "\r\n"

        var response = header.data(using: .utf8)!
        if let body = body {
            response.append(body)
        }
        return response
    }

    // MARK: - MIME Types

    private func mimeTypeForExtension(_ ext: String) -> String {
        switch ext.lowercased() {
        case "html", "htm":  return "text/html; charset=utf-8"
        case "js", "mjs":    return "application/javascript; charset=utf-8"
        case "css":          return "text/css; charset=utf-8"
        case "json":         return "application/json; charset=utf-8"
        case "svg":          return "image/svg+xml"
        case "png":          return "image/png"
        case "jpg", "jpeg":  return "image/jpeg"
        case "gif":          return "image/gif"
        case "woff2":        return "font/woff2"
        case "woff":         return "font/woff"
        case "glsl":         return "text/plain; charset=utf-8"
        case "wasm":         return "application/wasm"
        default:             return "application/octet-stream"
        }
    }

    // MARK: - Status

    func statusDict() -> [String: Any] {
        return [
            "address": "127.0.0.1",
            "port": Int(assignedPort),
            "roots": roots
        ]
    }
}
```

- [ ] **Step 2: Build and verify it compiles**

```bash
cd /Users/Michael/Code/agent-os && bash build.sh
```
Expected: Compiles with no errors. The `Network` framework is resolved automatically by `swiftc` on macOS.

- [ ] **Step 3: Commit**

```bash
git add src/content/server.swift
git commit -m "feat(daemon): add ContentServer — HTTP file server for local content"
```

---

### Task 3: Wire ContentServer into the daemon

**Files:**
- Modify: `src/daemon/unified.swift`

- [ ] **Step 1: Add ContentServer as a daemon module**

In `unified.swift`, add the content server property and initialization. Add after the existing module declarations:

```swift
// In the property declarations (after speechEngine):
private var contentServer: ContentServer?
```

In the `start()` method, after the existing module setup (after `perception.start()` and before the accept loop), add:

```swift
// Start content server
if let contentConfig = currentConfig.content, !contentConfig.roots.isEmpty {
    let repoRoot = aosCurrentRepoRoot()
    contentServer = ContentServer(config: contentConfig, repoRoot: repoRoot)
    contentServer?.start()
}
```

- [ ] **Step 2: Add `content_status` action to `routeAction`**

In the `routeAction` switch statement, add a new case before the `default`:

```swift
case "content_status":
    if let server = contentServer {
        var result = server.statusDict()
        result["status"] = "ok"
        sendResponseJSON(to: clientFD, result)
    } else {
        sendResponseJSON(to: clientFD, ["status": "ok", "port": 0, "roots": [:], "note": "content server not configured"])
    }
```

- [ ] **Step 3: Expose content server port in `ping` response**

In the existing `case "ping":` handler, add the content port to the response dict:

```swift
case "ping":
    let uptime = Date().timeIntervalSince(startTime)
    let perceptionChannels = perception.attention.channelCount
    subscriberLock.lock()
    let subscriberCount = subscribers.count
    subscriberLock.unlock()
    var response: [String: Any] = [
        "status": "ok",
        "uptime": uptime,
        "perception_channels": perceptionChannels,
        "subscribers": subscriberCount
    ]
    if let port = contentServer?.assignedPort, port > 0 {
        response["content_port"] = Int(port)
    }
    sendResponseJSON(to: clientFD, response)
```

- [ ] **Step 4: Add content config to hot-reload handler**

In `onConfigChanged`, add a log line for content changes:

```swift
if old.content?.roots != new.content?.roots {
    fputs("Config: content.roots changed — restart daemon to apply\n", stderr)
}
```

Note: Hot-reloading content roots would require stopping/restarting the NWListener or dynamically updating the roots dict. For v1, log a message and require restart. The port and roots are read at startup.

- [ ] **Step 5: Build and verify**

```bash
cd /Users/Michael/Code/agent-os && bash build.sh
```
Expected: Compiles clean.

- [ ] **Step 6: Commit**

```bash
git add src/daemon/unified.swift
git commit -m "feat(daemon): wire ContentServer into daemon startup and routing"
```

---

### Task 4: `aos://` URL rewriting in Canvas and CLI

**Files:**
- Modify: `src/display/canvas.swift`
- Modify: `src/daemon/unified.swift`

The `aos://` prefix is a convenience that rewrites to the content server's real address. The daemon knows the assigned port, so rewriting happens there.

- [ ] **Step 1: Add URL resolver method to UnifiedDaemon**

In `unified.swift`, add a helper method:

```swift
/// Rewrite `aos://` URLs to the content server's localhost address.
/// E.g. "aos://sigil/studio/index.html" → "http://127.0.0.1:8492/sigil/studio/index.html"
func resolveContentURL(_ urlString: String) -> String {
    guard urlString.hasPrefix("aos://"),
          let server = contentServer,
          server.assignedPort > 0 else {
        return urlString
    }
    let path = String(urlString.dropFirst("aos://".count))
    return "http://127.0.0.1:\(server.assignedPort)/\(path)"
}
```

- [ ] **Step 2: Apply URL rewriting in canvas create/update**

In the `routeAction` method, the canvas requests pass through `canvasManager.handle(request)`. The cleanest place to rewrite is before dispatching. In the `case "create", "update", ...` block, after parsing the request and before dispatching to main queue:

```swift
case "create", "update", "remove", "remove-all", "list", "eval", "to-front":
    let requestData = lineData(from: json)
    guard var request = CanvasRequest.from(requestData) else {
        sendResponseJSON(to: clientFD, ["error": "Failed to parse request", "code": "PARSE_ERROR"])
        return
    }

    // Rewrite aos:// URLs
    if let url = request.url {
        request.url = resolveContentURL(url)
    }

    let semaphore = DispatchSemaphore(value: 0)
    // ... rest unchanged
```

Note: `CanvasRequest.from()` returns a `CanvasRequest` which needs to be `var` now instead of `let`. Check that the existing code assigns `request` to a `let` — if so, change to `var`.

- [ ] **Step 3: Apply URL rewriting for `toggle_url` in StatusItemManager**

In `src/display/status-item.swift`, the `toggleUrl` is read from config at init time. The daemon needs to resolve it. The simplest approach: add a resolve step in `StatusItemManager.init` or have the daemon pass the resolved URL.

In `unified.swift`, find where `StatusItemManager` is initialized (search for `StatusItemManager(`). Modify the config passed to it so `toggle_url` is resolved:

First, find where StatusItemManager is created:

```swift
// In unified.swift or serve.swift — wherever StatusItemManager is initialized
```

If it's in `serve.swift`, the content server port isn't known at that point (it's assigned when the listener starts). Instead, resolve the URL lazily in `StatusItemManager.summonAvatar()`.

Alternative simpler approach: In `StatusItemManager`, replace `toggleUrl` usage with a closure or make `toggleUrl` a computed property. But the simplest v1 approach: resolve in `summonAvatar()` by calling through to the daemon.

For v1, add a `urlResolver` closure to StatusItemManager:

In `status-item.swift`, add:
```swift
var urlResolver: ((String) -> String)?
```

In `summonAvatar()`, where `toggleUrl` is used as `req.url`:
```swift
req.url = urlResolver?(toggleUrl) ?? toggleUrl
```

In the daemon where StatusItemManager is created, wire it:
```swift
statusItemManager?.urlResolver = { [weak self] url in
    self?.resolveContentURL(url) ?? url
}
```

- [ ] **Step 4: Build and verify**

```bash
cd /Users/Michael/Code/agent-os && bash build.sh
```

- [ ] **Step 5: Commit**

```bash
git add src/daemon/unified.swift src/display/canvas.swift src/display/status-item.swift
git commit -m "feat(daemon): rewrite aos:// URLs to content server address"
```

---

### Task 5: `aos content status` CLI command

**Files:**
- Modify: `src/main.swift` (add subcommand routing)
- Modify: `src/display/client.swift` or create `src/content/client.swift`

- [ ] **Step 1: Add `content status` command routing in main.swift**

Find the subcommand routing in `main.swift`. Add a `content` group:

```swift
case "content":
    guard args.count > 1 else { exitError("Usage: aos content status [--json]", code: "MISSING_SUBCOMMAND") }
    switch args[1] {
    case "status":
        runContentStatus(Array(args.dropFirst(2)))
    default:
        exitError("Unknown content command: \(args[1])", code: "UNKNOWN_COMMAND")
    }
```

- [ ] **Step 2: Implement `runContentStatus`**

Add to a new file `src/content/client.swift` or inline in an existing commands file:

```swift
// content/client.swift — CLI client for content server status

import Foundation

func runContentStatus(_ args: [String]) {
    let session = DaemonSession()
    guard session.connect() else {
        exitError("Cannot connect to daemon — is 'aos serve' running?", code: "NO_DAEMON")
    }
    defer { session.disconnect() }

    let request: [String: Any] = ["action": "content_status"]
    guard let requestData = try? JSONSerialization.data(withJSONObject: request, options: []) else {
        exitError("Failed to serialize request", code: "INTERNAL")
    }

    session.sendRaw(requestData)
    session.sendNewline()

    guard let responseData = session.readLine(),
          let response = try? JSONSerialization.jsonObject(with: responseData) as? [String: Any] else {
        exitError("No response from daemon", code: "NO_RESPONSE")
    }

    let isJSON = args.contains("--json")
    if isJSON {
        if let pretty = try? JSONSerialization.data(withJSONObject: response, options: [.prettyPrinted, .sortedKeys]),
           let str = String(data: pretty, encoding: .utf8) {
            print(str)
        }
    } else {
        let port = response["port"] as? Int ?? 0
        let roots = response["roots"] as? [String: String] ?? [:]
        if port > 0 {
            print("Content server: http://127.0.0.1:\(port)/")
            for (prefix, dir) in roots.sorted(by: { $0.key < $1.key }) {
                print("  /\(prefix)/ → \(dir)")
            }
        } else {
            print("Content server: not running (no roots configured)")
        }
    }
}
```

- [ ] **Step 3: Build and verify**

```bash
cd /Users/Michael/Code/agent-os && bash build.sh
```

- [ ] **Step 4: Commit**

```bash
git add src/content/client.swift src/main.swift
git commit -m "feat(cli): add 'aos content status' command"
```

---

### Task 6: End-to-end smoke test

**Files:** None created — manual verification

- [ ] **Step 1: Configure content roots**

```bash
./aos set content.roots.sigil apps/sigil
```

- [ ] **Step 2: Start the daemon**

```bash
./aos serve &
```

Watch stderr for the content server startup message:
```
Content server listening on http://127.0.0.1:XXXXX/
  /sigil/ → /Users/Michael/Code/agent-os/apps/sigil
```

- [ ] **Step 3: Verify content status**

```bash
./aos content status
```
Expected:
```
Content server: http://127.0.0.1:XXXXX/
  /sigil/ → /Users/Michael/Code/agent-os/apps/sigil
```

- [ ] **Step 4: Test file serving with curl**

```bash
PORT=$(./aos content status --json | python3 -c "import sys,json; print(json.load(sys.stdin)['port'])")

# HTML file
curl -s -o /dev/null -w "%{http_code} %{content_type}" http://127.0.0.1:$PORT/sigil/studio/index.html
# Expected: 200 text/html; charset=utf-8

# JS file (ES module)
curl -s -o /dev/null -w "%{http_code} %{content_type}" http://127.0.0.1:$PORT/sigil/renderer/state.js
# Expected: 200 application/javascript; charset=utf-8

# CSS file
curl -s -o /dev/null -w "%{http_code} %{content_type}" http://127.0.0.1:$PORT/sigil/studio/css/base.css
# Expected: 200 text/css; charset=utf-8

# 404
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:$PORT/sigil/nonexistent.html
# Expected: 404

# Directory traversal blocked
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:$PORT/sigil/../../etc/passwd
# Expected: 403

# Unknown root
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:$PORT/unknown/file.html
# Expected: 404
```

- [ ] **Step 5: Test canvas loading via content server**

```bash
# Create a canvas that loads the studio from the content server
./aos show create --id test-studio \
  --url "http://127.0.0.1:$PORT/sigil/studio/index.html" \
  --at 100,100,900,700 \
  --interactive
```

Expected: A canvas appears with the Avatar Studio fully rendered — 3D preview, sidebar controls, all working. ES modules load correctly (no console errors about CORS or module loading).

```bash
# Clean up
./aos show remove --id test-studio
```

- [ ] **Step 6: Test aos:// URL rewriting**

```bash
./aos show create --id test-aos-url \
  --url "aos://sigil/studio/index.html" \
  --at 100,100,900,700 \
  --interactive
```

Expected: Same result — the `aos://` prefix is rewritten to the content server address.

```bash
./aos show remove --id test-aos-url
```

- [ ] **Step 7: Stop daemon and commit any fixes**

```bash
kill %1  # stop backgrounded daemon
```

If everything passes:
```bash
git add -A
git commit -m "test: verify content server end-to-end — file serving, MIME types, canvas loading"
```

---

### Task 7: Update docs and config

**Files:**
- Modify: `src/CLAUDE.md`
- Modify: `apps/sigil/CLAUDE.md`

- [ ] **Step 1: Add content server to src/CLAUDE.md**

In the Config Keys table, add:

```
| content.port | int | 0 | Content server port (0 = OS-assigned) |
| content.roots.{name} | string | — | Content root: URL prefix → directory path |
```

In the Daemon Mode section, add:

```bash
aos content status [--json]           # Content server address and roots
```

- [ ] **Step 2: Update apps/sigil/CLAUDE.md**

In the Run section or Canvas Model section, note that the studio and live renderer can load via the content server:

```
### Content Server

The AOS daemon serves Sigil's HTML surfaces (renderer, studio) over localhost.
Configure in `~/.config/aos/{mode}/config.json`:

  "content": { "roots": { "sigil": "apps/sigil" } }

Canvases load via `aos://sigil/studio/index.html` or `aos://sigil/renderer/index.html`.
No bundling required — ES modules work over HTTP.
```

- [ ] **Step 3: Commit**

```bash
git add src/CLAUDE.md apps/sigil/CLAUDE.md
git commit -m "docs: document content server config and usage"
```
