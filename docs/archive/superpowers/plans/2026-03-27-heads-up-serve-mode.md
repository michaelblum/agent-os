# heads-up Serve Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `heads-up serve` — a daemon that manages persistent transparent NSWindow canvases on screen, controllable via CLI commands over a Unix socket.

**Architecture:** The daemon is an NSApplication process that listens on a Unix socket (`~/.config/heads-up/sock`) for newline-delimited JSON commands. CLI commands (`create`, `update`, `remove`, `list`, `remove-all`) connect to the daemon (auto-starting it if needed), send a JSON request, read the response, and exit. Each canvas is a borderless transparent NSWindow containing a WKWebView. Window anchoring polls CGWindowListCopyWindowInfo at 30fps. The daemon auto-exits after 5 seconds idle with no canvases.

**Tech Stack:** Swift (macOS 14+), WebKit (WKWebView), AppKit (NSWindow), POSIX sockets. Zero external dependencies.

**Spec:** `docs/superpowers/specs/2026-03-27-heads-up-canvas-and-annotation-design.md` (steps 4–5)

---

## File Structure

```
packages/heads-up/
  main.swift          ← MODIFY: slim to entry point + CLI routing only
  helpers.swift       ← NEW: jsonString(), exitError(), withSockAddr() — shared utilities
  render.swift        ← NEW: OffscreenRenderer + renderCommand() (moved from main.swift)
  protocol.swift      ← NEW: CanvasRequest, CanvasResponse, CanvasInfo (Codable types)
  canvas.swift        ← NEW: Canvas (NSWindow + WKWebView), CanvasManager, coordinate conversion
  daemon.swift        ← NEW: DaemonServer (Unix socket listener, idle timeout), serveCommand()
  client.swift        ← NEW: DaemonClient (connect, auto-start) + CLI command handlers
  build.sh            ← MODIFY: compile *.swift instead of main.swift
  CLAUDE.md           ← MODIFY: add serve mode docs
```

---

## Task 1: Refactor into Multi-File Structure

**Files:**
- Create: `packages/heads-up/helpers.swift`
- Create: `packages/heads-up/render.swift`
- Modify: `packages/heads-up/main.swift`
- Modify: `packages/heads-up/build.sh`

- [ ] **Step 1: Create `helpers.swift`**

Write `packages/heads-up/helpers.swift`:

```swift
// heads-up — Shared utilities

import Foundation

// MARK: - JSON Helpers

func jsonString<T: Encodable>(_ value: T) -> String {
    let enc = JSONEncoder()
    enc.outputFormatting = [.prettyPrinted, .sortedKeys]
    guard let data = try? enc.encode(value), let s = String(data: data, encoding: .utf8) else { return "{}" }
    return s
}

func exitError(_ message: String, code: String) -> Never {
    let obj: [String: String] = ["error": message, "code": code]
    if let data = try? JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted, .sortedKeys]),
       let s = String(data: data, encoding: .utf8) {
        FileHandle.standardError.write(s.data(using: .utf8)!)
        FileHandle.standardError.write("\n".data(using: .utf8)!)
    }
    exit(1)
}

// MARK: - Socket Path

let kSocketDir = NSString(string: "~/.config/heads-up").expandingTildeInPath
let kSocketPath = kSocketDir + "/sock"

// MARK: - Unix Socket Helper

/// Execute a closure with a properly bound sockaddr_un. Handles the ugly C interop.
func withSockAddr(_ path: String, _ body: (UnsafePointer<sockaddr>, socklen_t) -> Int32) -> Int32 {
    var addr = sockaddr_un()
    addr.sun_family = sa_family_t(AF_UNIX)
    let pathBytes = path.utf8CString
    let maxLen = MemoryLayout.size(ofValue: addr.sun_path)
    withUnsafeMutablePointer(to: &addr.sun_path) { ptr in
        pathBytes.withUnsafeBufferPointer { src in
            UnsafeMutableRawPointer(ptr).copyMemory(
                from: src.baseAddress!, byteCount: min(pathBytes.count, maxLen))
        }
    }
    return withUnsafePointer(to: &addr) { ptr in
        ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
            body(sockPtr, socklen_t(MemoryLayout<sockaddr_un>.size))
        }
    }
}
```

- [ ] **Step 2: Create `render.swift`**

Write `packages/heads-up/render.swift` — move the `OffscreenRenderer` class (lines 36–89 of current main.swift), `RenderResponse` struct (lines 28–32), and `renderCommand()` function (lines 93–211) from main.swift. Copy them verbatim. Add the import header:

```swift
// heads-up — Render mode: rasterize HTML/CSS/SVG to transparent PNG

import AppKit
import WebKit

// MARK: - JSON Output Models

struct RenderResponse: Encodable {
    let status = "success"
    var file: String?
    var base64: String?
}

// MARK: - WKWebView Renderer

class OffscreenRenderer: NSObject, WKNavigationDelegate {
    let webView: WKWebView
    let width: Int
    let height: Int
    var completion: ((CGImage?) -> Void)?

    init(width: Int, height: Int) {
        self.width = width
        self.height = height

        let config = WKWebViewConfiguration()
        config.suppressesIncrementalRendering = true
        let webView = WKWebView(frame: NSRect(x: 0, y: 0, width: width, height: height), configuration: config)

        // Critical: transparent background
        webView.setValue(false, forKey: "drawsBackground")
        webView.wantsLayer = true
        webView.layer?.backgroundColor = NSColor.clear.cgColor
        webView.layer?.isOpaque = false

        self.webView = webView
        super.init()
        webView.navigationDelegate = self
    }

    func loadHTML(_ html: String, completion: @escaping (CGImage?) -> Void) {
        self.completion = completion
        webView.loadHTMLString(html, baseURL: nil)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [self] in
            let config = WKSnapshotConfiguration()
            config.snapshotWidth = NSNumber(value: self.width)
            config.afterScreenUpdates = true

            webView.takeSnapshot(with: config) { image, error in
                guard let nsImage = image else {
                    self.completion?(nil)
                    return
                }
                var rect = NSRect(x: 0, y: 0, width: nsImage.size.width, height: nsImage.size.height)
                let cgImage = nsImage.cgImage(forProposedRect: &rect, context: nil, hints: nil)
                self.completion?(cgImage)
            }
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        completion?(nil)
    }
}

// MARK: - Render Command

func renderCommand(args: [String]) {
    var width = 800
    var height = 600
    var htmlContent: String? = nil
    var filePath: String? = nil
    var outputPath: String? = nil
    var useBase64 = false

    var i = 0
    while i < args.count {
        switch args[i] {
        case "--width":
            i += 1
            guard i < args.count, let w = Int(args[i]), w > 0 else {
                exitError("--width requires a positive integer", code: "INVALID_ARG")
            }
            width = w
        case "--height":
            i += 1
            guard i < args.count, let h = Int(args[i]), h > 0 else {
                exitError("--height requires a positive integer", code: "INVALID_ARG")
            }
            height = h
        case "--html":
            i += 1
            guard i < args.count else { exitError("--html requires a value", code: "MISSING_ARG") }
            htmlContent = args[i]
        case "--file":
            i += 1
            guard i < args.count else { exitError("--file requires a path", code: "MISSING_ARG") }
            filePath = args[i]
        case "--out":
            i += 1
            guard i < args.count else { exitError("--out requires a path", code: "MISSING_ARG") }
            outputPath = args[i]
        case "--base64":
            useBase64 = true
        default:
            exitError("Unknown argument: \(args[i])", code: "UNKNOWN_ARG")
        }
        i += 1
    }

    let html: String
    if let h = htmlContent {
        html = h
    } else if let fp = filePath {
        guard let contents = try? String(contentsOfFile: fp, encoding: .utf8) else {
            exitError("Cannot read file: \(fp)", code: "FILE_NOT_FOUND")
        }
        html = contents
    } else {
        if isatty(FileHandle.standardInput.fileDescriptor) != 0 {
            exitError("No HTML content provided. Use --html, --file, or pipe to stdin.", code: "NO_CONTENT")
        }
        let stdinData = FileHandle.standardInput.readDataToEndOfFile()
        if stdinData.isEmpty {
            exitError("No HTML content provided via stdin.", code: "NO_CONTENT")
        }
        guard let s = String(data: stdinData, encoding: .utf8) else {
            exitError("stdin is not valid UTF-8", code: "INVALID_CONTENT")
        }
        html = s
    }

    if !useBase64 && outputPath == nil {
        exitError("Specify --out <path> or --base64 for output", code: "NO_OUTPUT")
    }

    let renderer = OffscreenRenderer(width: width, height: height)
    var resultImage: CGImage? = nil
    var renderDone = false

    renderer.loadHTML(html) { image in
        resultImage = image
        renderDone = true
        CFRunLoopStop(CFRunLoopGetMain())
    }

    let deadline = Date().addingTimeInterval(10.0)
    while !renderDone {
        if Date() > deadline {
            exitError("WKWebView rendering timed out after 10 seconds", code: "RENDER_TIMEOUT")
        }
        CFRunLoopRunInMode(.defaultMode, 0.1, false)
    }

    guard let image = resultImage else {
        exitError("WKWebView rendering failed", code: "RENDER_FAILED")
    }

    if useBase64 {
        let bitmapRep = NSBitmapImageRep(cgImage: image)
        guard let pngData = bitmapRep.representation(using: .png, properties: [:]) else {
            exitError("PNG encoding failed", code: "ENCODE_FAILED")
        }
        let resp = RenderResponse(base64: pngData.base64EncodedString())
        print(jsonString(resp))
    } else if let outPath = outputPath {
        let url = URL(fileURLWithPath: (outPath as NSString).expandingTildeInPath)
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let bitmapRep = NSBitmapImageRep(cgImage: image)
        guard let pngData = bitmapRep.representation(using: .png, properties: [:]) else {
            exitError("PNG encoding failed", code: "ENCODE_FAILED")
        }
        do {
            try pngData.write(to: url)
        } catch {
            exitError("Failed to write to \(outPath): \(error.localizedDescription)", code: "WRITE_FAILED")
        }
        let resp = RenderResponse(file: outPath)
        print(jsonString(resp))
    }
}
```

- [ ] **Step 3: Slim down `main.swift`**

Replace `packages/heads-up/main.swift` with just the entry point and routing:

```swift
// heads-up — Display server for agent-os
// Render mode: HTML/CSS/SVG → transparent PNG bitmap
// Serve mode: persistent transparent canvases on screen

import AppKit

// MARK: - Usage

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
      serve                   Start the daemon (normally auto-started by create)

    Run 'heads-up <command> --help' for command-specific options.
    """
    print(text)
}

// MARK: - Entry Point

@main
struct HeadsUp {
    static func main() {
        _ = NSApplication.shared

        let args = Array(CommandLine.arguments.dropFirst())
        guard !args.isEmpty else { printUsage(); exit(0) }

        switch args[0] {
        case "render":
            renderCommand(args: Array(args.dropFirst()))
        case "create":
            createCommand(args: Array(args.dropFirst()))
        case "update":
            updateCommand(args: Array(args.dropFirst()))
        case "remove":
            removeCommand(args: Array(args.dropFirst()))
        case "remove-all":
            removeAllCommand(args: Array(args.dropFirst()))
        case "list":
            listCommand(args: Array(args.dropFirst()))
        case "serve":
            serveCommand(args: Array(args.dropFirst()))
        case "--help", "-h", "help":
            printUsage()
        default:
            exitError("Unknown command: \(args[0]). Run 'heads-up --help' for usage.", code: "UNKNOWN_COMMAND")
        }
    }
}
```

- [ ] **Step 4: Update `build.sh`**

Replace `packages/heads-up/build.sh`:

```bash
#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

echo "Compiling heads-up..."
swiftc -parse-as-library -O -o heads-up *.swift

echo "Done: ./heads-up ($(du -h heads-up | cut -f1 | xargs))"
```

- [ ] **Step 5: Add stub functions for new commands**

The new commands referenced in main.swift don't exist yet. Create temporary stubs so the build passes. Write `packages/heads-up/client.swift` with stubs:

```swift
// heads-up — CLI client: connects to daemon, sends commands

import Foundation

func createCommand(args: [String]) {
    exitError("create not yet implemented", code: "NOT_IMPLEMENTED")
}

func updateCommand(args: [String]) {
    exitError("update not yet implemented", code: "NOT_IMPLEMENTED")
}

func removeCommand(args: [String]) {
    exitError("remove not yet implemented", code: "NOT_IMPLEMENTED")
}

func removeAllCommand(args: [String]) {
    exitError("remove-all not yet implemented", code: "NOT_IMPLEMENTED")
}

func listCommand(args: [String]) {
    exitError("list not yet implemented", code: "NOT_IMPLEMENTED")
}
```

Write `packages/heads-up/daemon.swift` with a stub:

```swift
// heads-up — Daemon server: Unix socket listener + canvas management

import Foundation

func serveCommand(args: [String]) {
    exitError("serve not yet implemented", code: "NOT_IMPLEMENTED")
}
```

- [ ] **Step 6: Build and verify render still works**

Run:
```bash
cd packages/heads-up && bash build.sh
```
Expected: compiles successfully.

Run:
```bash
./heads-up render --width 100 --height 100 --html "<div style='color:red'>test</div>" --base64
```
Expected: JSON output with `status: "success"` and a base64 PNG.

Run:
```bash
./heads-up --help
```
Expected: usage text showing all commands (render, create, update, remove, remove-all, list, serve).

- [ ] **Step 7: Commit**

```bash
git add packages/heads-up/helpers.swift packages/heads-up/render.swift packages/heads-up/main.swift packages/heads-up/build.sh packages/heads-up/client.swift packages/heads-up/daemon.swift
git commit -m "refactor(heads-up): split into multi-file structure for serve mode"
```

---

## Task 2: Protocol — Message Types

**Files:**
- Create: `packages/heads-up/protocol.swift`

- [ ] **Step 1: Write `protocol.swift`**

Write `packages/heads-up/protocol.swift`:

```swift
// heads-up — JSON protocol types for daemon IPC
// Newline-delimited JSON over Unix socket.

import Foundation

// MARK: - Request (CLI → Daemon)

struct CanvasRequest: Codable {
    let action: String          // "create", "update", "remove", "remove-all", "list"
    var id: String?             // canvas ID (required for create/update/remove)
    var at: [CGFloat]?          // [x, y, w, h] in global CG coords (Y-down)
    var anchorWindow: Int?      // CGWindowID to track
    var offset: [CGFloat]?      // [x, y, w, h] relative to anchored window (LCS)
    var html: String?           // HTML content (resolved by client)
    var url: String?            // URL for WKWebView to load directly
    var interactive: Bool?      // override click-through (default: false)
}

// MARK: - Response (Daemon → CLI)

struct CanvasResponse: Codable {
    var status: String?         // "success" on success
    var error: String?          // error message on failure
    var code: String?           // machine-readable error code
    var canvases: [CanvasInfo]? // populated by "list" action
}

struct CanvasInfo: Codable {
    let id: String
    var at: [CGFloat]           // current [x, y, w, h] in CG coords
    var anchorWindow: Int?
    var offset: [CGFloat]?
    var interactive: Bool
}

// MARK: - Encode/Decode Helpers

extension CanvasRequest {
    /// Decode from a single JSON line (Data).
    static func from(_ data: Data) -> CanvasRequest? {
        return try? JSONDecoder().decode(CanvasRequest.self, from: data)
    }

    /// Encode to a JSON line (Data, no trailing newline).
    func toData() -> Data? {
        let enc = JSONEncoder()
        enc.outputFormatting = .sortedKeys  // deterministic, no pretty-print for wire format
        return try? enc.encode(self)
    }
}

extension CanvasResponse {
    /// Convenience for success with no extra data.
    static func ok() -> CanvasResponse {
        return CanvasResponse(status: "success")
    }

    /// Convenience for error.
    static func fail(_ message: String, code: String) -> CanvasResponse {
        return CanvasResponse(error: message, code: code)
    }

    /// Encode to JSON Data.
    func toData() -> Data? {
        let enc = JSONEncoder()
        enc.outputFormatting = .sortedKeys
        return try? enc.encode(self)
    }

    /// Decode from JSON Data.
    static func from(_ data: Data) -> CanvasResponse? {
        return try? JSONDecoder().decode(CanvasResponse.self, from: data)
    }
}
```

- [ ] **Step 2: Build to verify it compiles**

Run:
```bash
cd packages/heads-up && bash build.sh
```
Expected: compiles successfully.

- [ ] **Step 3: Commit**

```bash
git add packages/heads-up/protocol.swift
git commit -m "feat(heads-up): add JSON protocol types for daemon IPC"
```

---

## Task 3: Canvas — NSWindow + WKWebView Management

**Files:**
- Create: `packages/heads-up/canvas.swift`

- [ ] **Step 1: Write `canvas.swift`**

Write `packages/heads-up/canvas.swift`:

```swift
// heads-up — Canvas: transparent NSWindow + WKWebView
// Each canvas is an (id, bounds, content) tuple rendered on screen.

import AppKit
import WebKit

// MARK: - Coordinate Conversion

/// Convert CG coordinates (top-left origin, Y-down) to NSScreen coordinates (bottom-left origin, Y-up).
func cgToScreen(_ cgRect: CGRect) -> NSRect {
    guard let screen = NSScreen.screens.first else {
        return NSRect(x: cgRect.origin.x, y: cgRect.origin.y,
                      width: cgRect.size.width, height: cgRect.size.height)
    }
    let screenHeight = screen.frame.height
    return NSRect(
        x: cgRect.origin.x,
        y: screenHeight - cgRect.origin.y - cgRect.size.height,
        width: cgRect.size.width,
        height: cgRect.size.height
    )
}

/// Convert NSScreen coordinates back to CG coordinates.
func screenToCG(_ nsRect: NSRect) -> CGRect {
    guard let screen = NSScreen.screens.first else {
        return CGRect(x: nsRect.origin.x, y: nsRect.origin.y,
                      width: nsRect.size.width, height: nsRect.size.height)
    }
    let screenHeight = screen.frame.height
    return CGRect(
        x: nsRect.origin.x,
        y: screenHeight - nsRect.origin.y - nsRect.size.height,
        width: nsRect.size.width,
        height: nsRect.size.height
    )
}

// MARK: - Canvas

class Canvas {
    let id: String
    let window: NSWindow
    let webView: WKWebView
    var anchorWindowID: CGWindowID?
    var offset: CGRect?           // LCS offset relative to anchored window
    var isInteractive: Bool

    init(id: String, cgFrame: CGRect, interactive: Bool) {
        self.id = id
        self.isInteractive = interactive

        let screenFrame = cgToScreen(cgFrame)

        let window = NSWindow(
            contentRect: screenFrame,
            styleMask: .borderless,
            backing: .buffered,
            defer: false
        )
        window.backgroundColor = .clear
        window.isOpaque = false
        window.hasShadow = false
        window.level = .floating
        window.ignoresMouseEvents = !interactive
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]

        let config = WKWebViewConfiguration()
        let webView = WKWebView(frame: NSRect(origin: .zero, size: screenFrame.size), configuration: config)
        webView.setValue(false, forKey: "drawsBackground")
        webView.wantsLayer = true
        webView.layer?.backgroundColor = NSColor.clear.cgColor
        webView.layer?.isOpaque = false
        webView.autoresizingMask = [.width, .height]

        window.contentView = webView

        self.window = window
        self.webView = webView
    }

    /// Load HTML content into the canvas.
    func loadHTML(_ html: String) {
        webView.loadHTMLString(html, baseURL: nil)
    }

    /// Load a URL into the canvas.
    func loadURL(_ urlString: String) {
        guard let url = URL(string: urlString) else { return }
        webView.load(URLRequest(url: url))
    }

    /// Show the canvas on screen.
    func show() {
        window.orderFront(nil)
    }

    /// Hide and close the canvas.
    func close() {
        window.orderOut(nil)
        window.close()
    }

    /// Reposition using CG coordinates.
    func updatePosition(cgRect: CGRect) {
        let screenFrame = cgToScreen(cgRect)
        window.setFrame(screenFrame, display: true)
    }

    /// Get current position in CG coordinates.
    var cgFrame: CGRect {
        return screenToCG(window.frame)
    }

    /// Build a CanvasInfo for the list response.
    func toInfo() -> CanvasInfo {
        let f = cgFrame
        return CanvasInfo(
            id: id,
            at: [f.origin.x, f.origin.y, f.size.width, f.size.height],
            anchorWindow: anchorWindowID.map { Int($0) },
            offset: offset.map { [$0.origin.x, $0.origin.y, $0.size.width, $0.size.height] },
            interactive: isInteractive
        )
    }
}

// MARK: - Canvas Manager

class CanvasManager {
    private var canvases: [String: Canvas] = [:]
    private var anchorTimer: DispatchSourceTimer?

    var isEmpty: Bool { canvases.isEmpty }
    var hasAnchoredCanvases: Bool { canvases.values.contains { $0.anchorWindowID != nil } }

    /// Handle a request and return a response. Must be called on main thread.
    func handle(_ request: CanvasRequest) -> CanvasResponse {
        switch request.action {
        case "create":  return handleCreate(request)
        case "update":  return handleUpdate(request)
        case "remove":  return handleRemove(request)
        case "remove-all": return handleRemoveAll()
        case "list":    return handleList()
        default:
            return .fail("Unknown action: \(request.action)", code: "UNKNOWN_ACTION")
        }
    }

    private func handleCreate(_ req: CanvasRequest) -> CanvasResponse {
        guard let id = req.id else {
            return .fail("create requires --id", code: "MISSING_ID")
        }
        if canvases[id] != nil {
            return .fail("Canvas '\(id)' already exists. Use update or remove first.", code: "DUPLICATE_ID")
        }

        // Determine frame
        let cgFrame: CGRect
        if let at = req.at, at.count == 4 {
            cgFrame = CGRect(x: at[0], y: at[1], width: at[2], height: at[3])
        } else if let anchorWin = req.anchorWindow, let off = req.offset, off.count == 4 {
            // Resolve from anchor window + offset
            guard let windowBounds = getWindowBounds(CGWindowID(anchorWin)) else {
                return .fail("Window \(anchorWin) not found", code: "WINDOW_NOT_FOUND")
            }
            cgFrame = CGRect(
                x: windowBounds.origin.x + off[0],
                y: windowBounds.origin.y + off[1],
                width: off[2], height: off[3]
            )
        } else {
            return .fail("create requires --at x,y,w,h or --anchor-window + --offset", code: "MISSING_POSITION")
        }

        let interactive = req.interactive ?? false
        let canvas = Canvas(id: id, cgFrame: cgFrame, interactive: interactive)

        // Set up anchoring
        if let anchorWin = req.anchorWindow, let off = req.offset, off.count == 4 {
            canvas.anchorWindowID = CGWindowID(anchorWin)
            canvas.offset = CGRect(x: off[0], y: off[1], width: off[2], height: off[3])
        }

        // Load content
        if let html = req.html {
            canvas.loadHTML(html)
        } else if let url = req.url {
            canvas.loadURL(url)
        } else {
            canvas.close()
            return .fail("create requires --html, --file, --url, or stdin content", code: "NO_CONTENT")
        }

        canvas.show()
        canvases[id] = canvas

        // Start anchor polling if needed
        if hasAnchoredCanvases { startAnchorPolling() }

        return .ok()
    }

    private func handleUpdate(_ req: CanvasRequest) -> CanvasResponse {
        guard let id = req.id else {
            return .fail("update requires --id", code: "MISSING_ID")
        }
        guard let canvas = canvases[id] else {
            return .fail("Canvas '\(id)' not found", code: "NOT_FOUND")
        }

        // Update position if provided
        if let at = req.at, at.count == 4 {
            let newFrame = CGRect(x: at[0], y: at[1], width: at[2], height: at[3])
            canvas.updatePosition(cgRect: newFrame)
            // Clear anchoring if explicit position given
            canvas.anchorWindowID = nil
            canvas.offset = nil
        }

        // Update anchor if provided
        if let anchorWin = req.anchorWindow, let off = req.offset, off.count == 4 {
            canvas.anchorWindowID = CGWindowID(anchorWin)
            canvas.offset = CGRect(x: off[0], y: off[1], width: off[2], height: off[3])
            // Apply immediately
            if let windowBounds = getWindowBounds(CGWindowID(anchorWin)) {
                let newFrame = CGRect(
                    x: windowBounds.origin.x + off[0],
                    y: windowBounds.origin.y + off[1],
                    width: off[2], height: off[3]
                )
                canvas.updatePosition(cgRect: newFrame)
            }
            startAnchorPolling()
        }

        // Update content if provided
        if let html = req.html {
            canvas.loadHTML(html)
        } else if let url = req.url {
            canvas.loadURL(url)
        }

        // Update interactivity if provided
        if let interactive = req.interactive {
            canvas.isInteractive = interactive
            canvas.window.ignoresMouseEvents = !interactive
        }

        return .ok()
    }

    private func handleRemove(_ req: CanvasRequest) -> CanvasResponse {
        guard let id = req.id else {
            return .fail("remove requires --id", code: "MISSING_ID")
        }
        guard let canvas = canvases.removeValue(forKey: id) else {
            return .fail("Canvas '\(id)' not found", code: "NOT_FOUND")
        }
        canvas.close()
        if !hasAnchoredCanvases { stopAnchorPolling() }
        return .ok()
    }

    private func handleRemoveAll() -> CanvasResponse {
        for (_, canvas) in canvases {
            canvas.close()
        }
        canvases.removeAll()
        stopAnchorPolling()
        return .ok()
    }

    private func handleList() -> CanvasResponse {
        let infos = canvases.values.map { $0.toInfo() }.sorted { $0.id < $1.id }
        return CanvasResponse(status: "success", canvases: infos)
    }

    // MARK: - Window Anchoring

    func startAnchorPolling() {
        guard anchorTimer == nil else { return }
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now(), repeating: 1.0 / 30.0)
        timer.setEventHandler { [weak self] in
            self?.updateAnchoredCanvases()
        }
        timer.resume()
        anchorTimer = timer
    }

    func stopAnchorPolling() {
        anchorTimer?.cancel()
        anchorTimer = nil
    }

    private func updateAnchoredCanvases() {
        var anyAnchored = false
        for (_, canvas) in canvases {
            guard let wid = canvas.anchorWindowID, let offset = canvas.offset else { continue }
            anyAnchored = true
            guard let windowBounds = getWindowBounds(wid) else { continue }
            let newFrame = CGRect(
                x: windowBounds.origin.x + offset.origin.x,
                y: windowBounds.origin.y + offset.origin.y,
                width: offset.size.width,
                height: offset.size.height
            )
            canvas.updatePosition(cgRect: newFrame)
        }
        if !anyAnchored { stopAnchorPolling() }
    }
}

// MARK: - CGWindowList Helper

/// Look up a window's bounds (CG coordinates) by CGWindowID.
func getWindowBounds(_ windowID: CGWindowID) -> CGRect? {
    guard let list = CGWindowListCopyWindowInfo([.optionIncludingWindow], windowID) as? [[String: Any]],
          let info = list.first,
          let boundsDict = info[kCGWindowBounds as String] as? CFDictionary else {
        return nil
    }
    var rect = CGRect.zero
    guard CGRectMakeWithDictionaryRepresentation(boundsDict, &rect) else { return nil }
    return rect
}
```

- [ ] **Step 2: Build to verify it compiles**

Run:
```bash
cd packages/heads-up && bash build.sh
```
Expected: compiles successfully.

- [ ] **Step 3: Commit**

```bash
git add packages/heads-up/canvas.swift
git commit -m "feat(heads-up): add Canvas and CanvasManager for persistent overlays"
```

---

## Task 4: Daemon — Unix Socket Server

**Files:**
- Modify: `packages/heads-up/daemon.swift` (replace stub)

- [ ] **Step 1: Implement the daemon server**

Replace `packages/heads-up/daemon.swift`:

```swift
// heads-up — Daemon server
// Listens on Unix socket, dispatches commands to CanvasManager, manages idle timeout.

import AppKit
import Foundation

// MARK: - Daemon Server

class DaemonServer {
    let socketPath: String
    let canvasManager: CanvasManager
    var serverFD: Int32 = -1
    var idleTimer: DispatchSourceTimer?
    let idleTimeout: TimeInterval = 5.0

    init(socketPath: String, canvasManager: CanvasManager) {
        self.socketPath = socketPath
        self.canvasManager = canvasManager
    }

    /// Create the socket file and start accepting connections.
    /// Call this BEFORE NSApplication.run().
    func start() {
        // Ensure directory exists
        try? FileManager.default.createDirectory(
            atPath: (socketPath as NSString).deletingLastPathComponent,
            withIntermediateDirectories: true)

        // Remove stale socket
        unlink(socketPath)

        // Create socket
        serverFD = socket(AF_UNIX, SOCK_STREAM, 0)
        guard serverFD >= 0 else {
            exitError("socket() failed: \(errno)", code: "SOCKET_ERROR")
        }

        // Bind
        let bindResult = withSockAddr(socketPath) { addr, len in
            bind(serverFD, addr, len)
        }
        guard bindResult == 0 else {
            exitError("bind() failed: \(errno)", code: "BIND_ERROR")
        }

        // Listen
        guard listen(serverFD, 5) == 0 else {
            exitError("listen() failed: \(errno)", code: "LISTEN_ERROR")
        }

        // Accept connections on a background queue
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.acceptLoop()
        }

        // Start idle timer (daemon starts idle — no canvases yet)
        startIdleTimer()

        // Clean up socket on termination
        setupSignalHandlers()
    }

    // MARK: - Accept Loop

    private func acceptLoop() {
        while true {
            let clientFD = accept(serverFD, nil, nil)
            guard clientFD >= 0 else { continue }

            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                self?.handleConnection(clientFD)
            }
        }
    }

    // MARK: - Connection Handler

    private func handleConnection(_ clientFD: Int32) {
        defer { close(clientFD) }

        var buffer = Data()
        var chunk = [UInt8](repeating: 0, count: 4096)

        outer: while true {
            let bytesRead = read(clientFD, &chunk, chunk.count)
            guard bytesRead > 0 else { break }

            buffer.append(contentsOf: chunk[0..<bytesRead])

            // Process complete lines
            while let newlineIndex = buffer.firstIndex(of: UInt8(ascii: "\n")) {
                let lineData = Data(buffer[buffer.startIndex..<newlineIndex])
                buffer = Data(buffer[(buffer.index(after: newlineIndex))...])

                guard let request = CanvasRequest.from(lineData) else {
                    let errResp = CanvasResponse.fail("Invalid JSON", code: "PARSE_ERROR")
                    self.sendResponse(to: clientFD, errResp)
                    continue
                }

                // Dispatch to main thread for UI work
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
            }
        }
    }

    private func sendResponse(to clientFD: Int32, _ response: CanvasResponse) {
        guard var data = response.toData() else { return }
        data.append(UInt8(ascii: "\n"))
        data.withUnsafeBytes { ptr in
            _ = write(clientFD, ptr.baseAddress!, ptr.count)
        }
    }

    // MARK: - Idle Timeout

    func checkIdle() {
        if canvasManager.isEmpty {
            startIdleTimer()
        } else {
            cancelIdleTimer()
        }
    }

    private func startIdleTimer() {
        cancelIdleTimer()
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + idleTimeout)
        timer.setEventHandler { [weak self] in
            guard let self = self, self.canvasManager.isEmpty else { return }
            self.shutdown()
        }
        timer.resume()
        idleTimer = timer
    }

    private func cancelIdleTimer() {
        idleTimer?.cancel()
        idleTimer = nil
    }

    // MARK: - Shutdown

    func shutdown() {
        cancelIdleTimer()
        close(serverFD)
        try? FileManager.default.removeItem(atPath: socketPath)
        exit(0)
    }

    // MARK: - Signal Handling

    private func setupSignalHandlers() {
        // Use DispatchSource for SIGTERM/SIGINT so we clean up the socket file
        let sigterm = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        sigterm.setEventHandler { [weak self] in self?.shutdown() }
        sigterm.resume()
        signal(SIGTERM, SIG_IGN)

        let sigint = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
        sigint.setEventHandler { [weak self] in self?.shutdown() }
        sigint.resume()
        signal(SIGINT, SIG_IGN)

        // Keep references alive
        _sigSources = [sigterm, sigint]
    }
    private var _sigSources: [Any] = []
}

// MARK: - Serve Command

func serveCommand(args: [String]) {
    // Check for stale socket
    let testSock = socket(AF_UNIX, SOCK_STREAM, 0)
    if testSock >= 0 {
        let result = withSockAddr(kSocketPath) { addr, len in
            connect(testSock, addr, len)
        }
        close(testSock)
        if result == 0 {
            exitError("Daemon already running at \(kSocketPath)", code: "ALREADY_RUNNING")
        }
        // Stale socket — will be cleaned up by server.start()
    }

    let canvasManager = CanvasManager()
    let server = DaemonServer(socketPath: kSocketPath, canvasManager: canvasManager)

    // Start listening (creates socket file)
    server.start()

    // Run the application event loop (blocks, processes window events)
    NSApplication.shared.run()
}
```

- [ ] **Step 2: Build and verify**

Run:
```bash
cd packages/heads-up && bash build.sh
```
Expected: compiles successfully.

Run:
```bash
./heads-up serve &
sleep 1
ls -la ~/.config/heads-up/sock
kill %1
```
Expected: socket file created at `~/.config/heads-up/sock`. Daemon starts and listens. Ctrl+C or kill cleans up the socket.

- [ ] **Step 3: Commit**

```bash
git add packages/heads-up/daemon.swift
git commit -m "feat(heads-up): implement daemon server with Unix socket and idle timeout"
```

---

## Task 5: Client — CLI Commands with Auto-Start

**Files:**
- Modify: `packages/heads-up/client.swift` (replace stubs)

- [ ] **Step 1: Implement the client and CLI commands**

Replace `packages/heads-up/client.swift`:

```swift
// heads-up — CLI client: auto-starts daemon, sends commands via Unix socket

import Foundation

// MARK: - Daemon Client

class DaemonClient {
    /// Try to connect to the daemon socket. Returns file descriptor or nil.
    func connect() -> Int32? {
        let sock = socket(AF_UNIX, SOCK_STREAM, 0)
        guard sock >= 0 else { return nil }

        let result = withSockAddr(kSocketPath) { addr, len in
            Foundation.connect(sock, addr, len)
        }
        if result == 0 { return sock }
        close(sock)
        return nil
    }

    /// Start the daemon process if not running. Returns true if daemon is reachable.
    func ensureDaemon() -> Bool {
        if connect() != nil { return true }  // already running (fd leaks here but we reconnect below)

        // Launch daemon subprocess
        let selfPath = ProcessInfo.processInfo.arguments[0]
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: selfPath)
        proc.arguments = ["serve"]
        proc.standardInput = FileHandle.nullDevice
        proc.standardOutput = FileHandle.nullDevice
        proc.standardError = FileHandle.nullDevice
        do { try proc.run() } catch { return false }

        // Poll for socket to become connectable
        for _ in 0..<50 {
            usleep(100_000)  // 100ms, up to 5s total
            if let fd = connect() {
                close(fd)
                return true
            }
        }
        return false
    }

    /// Send a request to the daemon, return the response.
    func send(_ request: CanvasRequest) -> CanvasResponse {
        guard let fd = connect() else {
            return .fail("Cannot connect to daemon", code: "CONNECTION_FAILED")
        }
        defer { close(fd) }

        // Write request as JSON line
        guard var data = request.toData() else {
            return .fail("Failed to encode request", code: "ENCODE_ERROR")
        }
        data.append(UInt8(ascii: "\n"))
        let written = data.withUnsafeBytes { ptr in
            write(fd, ptr.baseAddress!, ptr.count)
        }
        guard written == data.count else {
            return .fail("Failed to write to socket", code: "WRITE_ERROR")
        }

        // Read response (single JSON line)
        var buffer = Data()
        var chunk = [UInt8](repeating: 0, count: 4096)
        let deadline = Date().addingTimeInterval(10.0)
        while Date() < deadline {
            let bytesRead = read(fd, &chunk, chunk.count)
            if bytesRead <= 0 { break }
            buffer.append(contentsOf: chunk[0..<bytesRead])
            if buffer.contains(UInt8(ascii: "\n")) { break }
        }

        guard let newlineIdx = buffer.firstIndex(of: UInt8(ascii: "\n")) else {
            return .fail("No response from daemon", code: "NO_RESPONSE")
        }
        let responseData = Data(buffer[buffer.startIndex..<newlineIdx])
        return CanvasResponse.from(responseData) ?? .fail("Invalid response from daemon", code: "PARSE_ERROR")
    }
}

// MARK: - Resolve HTML content from CLI args

/// Parse --html, --file, or stdin into an HTML string. Returns nil if no content source found.
func resolveHTML(htmlValue: String?, fileValue: String?) -> String? {
    if let html = htmlValue { return html }
    if let filePath = fileValue {
        guard let contents = try? String(contentsOfFile: filePath, encoding: .utf8) else {
            exitError("Cannot read file: \(filePath)", code: "FILE_NOT_FOUND")
        }
        return contents
    }
    // Try stdin (only if piped)
    if isatty(FileHandle.standardInput.fileDescriptor) == 0 {
        let data = FileHandle.standardInput.readDataToEndOfFile()
        if !data.isEmpty, let s = String(data: data, encoding: .utf8) { return s }
    }
    return nil
}

// MARK: - CLI Command: create

func createCommand(args: [String]) {
    var id: String? = nil
    var at: String? = nil
    var anchorWindow: Int? = nil
    var offset: String? = nil
    var htmlValue: String? = nil
    var fileValue: String? = nil
    var urlValue: String? = nil
    var interactive = false

    var i = 0
    while i < args.count {
        switch args[i] {
        case "--id":
            i += 1; guard i < args.count else { exitError("--id requires a value", code: "MISSING_ARG") }
            id = args[i]
        case "--at":
            i += 1; guard i < args.count else { exitError("--at requires x,y,w,h", code: "MISSING_ARG") }
            at = args[i]
        case "--anchor-window":
            i += 1; guard i < args.count, let w = Int(args[i]) else { exitError("--anchor-window requires an integer", code: "INVALID_ARG") }
            anchorWindow = w
        case "--offset":
            i += 1; guard i < args.count else { exitError("--offset requires x,y,w,h", code: "MISSING_ARG") }
            offset = args[i]
        case "--html":
            i += 1; guard i < args.count else { exitError("--html requires a value", code: "MISSING_ARG") }
            htmlValue = args[i]
        case "--file":
            i += 1; guard i < args.count else { exitError("--file requires a path", code: "MISSING_ARG") }
            fileValue = args[i]
        case "--url":
            i += 1; guard i < args.count else { exitError("--url requires a value", code: "MISSING_ARG") }
            urlValue = args[i]
        case "--interactive":
            interactive = true
        default:
            exitError("Unknown argument: \(args[i])", code: "UNKNOWN_ARG")
        }
        i += 1
    }

    guard let canvasID = id else { exitError("create requires --id <name>", code: "MISSING_ARG") }

    // Build request
    var request = CanvasRequest(action: "create")
    request.id = canvasID
    request.interactive = interactive

    if let atStr = at {
        let parts = atStr.split(separator: ",").compactMap { CGFloat(Double($0) ?? 0) }
        guard parts.count == 4 else { exitError("--at must be x,y,w,h (comma-separated)", code: "INVALID_ARG") }
        request.at = parts
    }
    if let aw = anchorWindow { request.anchorWindow = aw }
    if let offStr = offset {
        let parts = offStr.split(separator: ",").compactMap { CGFloat(Double($0) ?? 0) }
        guard parts.count == 4 else { exitError("--offset must be x,y,w,h (comma-separated)", code: "INVALID_ARG") }
        request.offset = parts
    }

    // Resolve content
    if let url = urlValue {
        request.url = url
    } else {
        request.html = resolveHTML(htmlValue: htmlValue, fileValue: fileValue)
    }

    // Connect and send
    let client = DaemonClient()
    if !client.ensureDaemon() {
        exitError("Failed to start heads-up daemon", code: "DAEMON_START_FAILED")
    }
    let response = client.send(request)
    outputResponse(response)
}

// MARK: - CLI Command: update

func updateCommand(args: [String]) {
    var id: String? = nil
    var at: String? = nil
    var anchorWindow: Int? = nil
    var offset: String? = nil
    var htmlValue: String? = nil
    var fileValue: String? = nil
    var urlValue: String? = nil
    var interactive: Bool? = nil

    var i = 0
    while i < args.count {
        switch args[i] {
        case "--id":
            i += 1; guard i < args.count else { exitError("--id requires a value", code: "MISSING_ARG") }
            id = args[i]
        case "--at":
            i += 1; guard i < args.count else { exitError("--at requires x,y,w,h", code: "MISSING_ARG") }
            at = args[i]
        case "--anchor-window":
            i += 1; guard i < args.count, let w = Int(args[i]) else { exitError("--anchor-window requires an integer", code: "INVALID_ARG") }
            anchorWindow = w
        case "--offset":
            i += 1; guard i < args.count else { exitError("--offset requires x,y,w,h", code: "MISSING_ARG") }
            offset = args[i]
        case "--html":
            i += 1; guard i < args.count else { exitError("--html requires a value", code: "MISSING_ARG") }
            htmlValue = args[i]
        case "--file":
            i += 1; guard i < args.count else { exitError("--file requires a path", code: "MISSING_ARG") }
            fileValue = args[i]
        case "--url":
            i += 1; guard i < args.count else { exitError("--url requires a value", code: "MISSING_ARG") }
            urlValue = args[i]
        case "--interactive":
            interactive = true
        case "--no-interactive":
            interactive = false
        default:
            exitError("Unknown argument: \(args[i])", code: "UNKNOWN_ARG")
        }
        i += 1
    }

    guard let canvasID = id else { exitError("update requires --id <name>", code: "MISSING_ARG") }

    var request = CanvasRequest(action: "update")
    request.id = canvasID
    request.interactive = interactive

    if let atStr = at {
        let parts = atStr.split(separator: ",").compactMap { CGFloat(Double($0) ?? 0) }
        guard parts.count == 4 else { exitError("--at must be x,y,w,h", code: "INVALID_ARG") }
        request.at = parts
    }
    if let aw = anchorWindow { request.anchorWindow = aw }
    if let offStr = offset {
        let parts = offStr.split(separator: ",").compactMap { CGFloat(Double($0) ?? 0) }
        guard parts.count == 4 else { exitError("--offset must be x,y,w,h", code: "INVALID_ARG") }
        request.offset = parts
    }
    if let url = urlValue {
        request.url = url
    } else if htmlValue != nil || fileValue != nil {
        request.html = resolveHTML(htmlValue: htmlValue, fileValue: fileValue)
    }

    let client = DaemonClient()
    guard client.connect() != nil else {
        exitError("Daemon not running. Create a canvas first.", code: "NO_DAEMON")
    }
    let response = client.send(request)
    outputResponse(response)
}

// MARK: - CLI Command: remove

func removeCommand(args: [String]) {
    var id: String? = nil

    var i = 0
    while i < args.count {
        switch args[i] {
        case "--id":
            i += 1; guard i < args.count else { exitError("--id requires a value", code: "MISSING_ARG") }
            id = args[i]
        default:
            exitError("Unknown argument: \(args[i])", code: "UNKNOWN_ARG")
        }
        i += 1
    }

    guard let canvasID = id else { exitError("remove requires --id <name>", code: "MISSING_ARG") }

    var request = CanvasRequest(action: "remove")
    request.id = canvasID

    let client = DaemonClient()
    guard client.connect() != nil else {
        exitError("Daemon not running. Nothing to remove.", code: "NO_DAEMON")
    }
    let response = client.send(request)
    outputResponse(response)
}

// MARK: - CLI Command: remove-all

func removeAllCommand(args: [String]) {
    let request = CanvasRequest(action: "remove-all")
    let client = DaemonClient()
    guard client.connect() != nil else {
        exitError("Daemon not running. Nothing to remove.", code: "NO_DAEMON")
    }
    let response = client.send(request)
    outputResponse(response)
}

// MARK: - CLI Command: list

func listCommand(args: [String]) {
    let request = CanvasRequest(action: "list")
    let client = DaemonClient()
    guard client.connect() != nil else {
        // No daemon = no canvases
        let empty = CanvasResponse(status: "success", canvases: [])
        outputResponse(empty)
        return
    }
    let response = client.send(request)
    outputResponse(response)
}

// MARK: - Output

private func outputResponse(_ response: CanvasResponse) {
    if response.error != nil {
        // Error — write to stderr
        if let data = response.toData(), let s = String(data: data, encoding: .utf8) {
            FileHandle.standardError.write(s.data(using: .utf8)!)
            FileHandle.standardError.write("\n".data(using: .utf8)!)
        }
        exit(1)
    } else {
        // Success — write to stdout
        if let data = response.toData(), let s = String(data: data, encoding: .utf8) {
            print(s)
        }
    }
}
```

- [ ] **Step 2: Build**

Run:
```bash
cd packages/heads-up && bash build.sh
```
Expected: compiles successfully.

- [ ] **Step 3: Smoke test the daemon lifecycle**

Run:
```bash
# Should auto-start daemon and create a red box
./heads-up create --id test --at 100,100,200,200 --html '<body style="margin:0;background:red"></body>'
```
Expected: `{"status":"success"}` on stdout. A red rectangle appears at screen coordinates (100, 100).

```bash
# Should list the canvas
./heads-up list
```
Expected: JSON with one canvas entry showing id "test", at [100, 100, 200, 200].

```bash
# Should remove it
./heads-up remove --id test
```
Expected: `{"status":"success"}`. Red rectangle disappears. Daemon exits after 5s.

- [ ] **Step 4: Commit**

```bash
git add packages/heads-up/client.swift
git commit -m "feat(heads-up): implement CLI client with auto-start daemon and all commands"
```

---

## Task 6: Update CLAUDE.md with Serve Mode Docs

**Files:**
- Modify: `packages/heads-up/CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md**

Add serve mode documentation after the existing render mode docs in `packages/heads-up/CLAUDE.md`:

```markdown
### Serve Mode (daemon)

Manage persistent transparent canvases on screen. The daemon auto-starts on first `create` and auto-exits after 5s with no canvases.

```bash
# Create a canvas (auto-starts daemon)
heads-up create --id ball --at 100,100,200,200 --html "<div>...</div>"
heads-up create --id orb --anchor-window 4521 --offset 10,10,80,80 --html "..." --interactive
heads-up create --id app --at 0,0,800,600 --url http://localhost:3000

# Update content, position, or interactivity
heads-up update --id ball --html "<div>new content</div>"
heads-up update --id ball --at 200,200,300,300

# List, remove, remove all
heads-up list
heads-up remove --id ball
heads-up remove-all
```

#### Coordinates

- `--at x,y,w,h` — Global CG space (top-left = 0,0, Y down)
- `--anchor-window <wid> --offset x,y,w,h` — LCS relative to window, auto-tracks at 30fps

#### Content Sources

- `--html "..."` — Inline HTML
- `--file path.html` — Local file
- `--url http://...` — URL loaded in WKWebView
- stdin — Piped HTML content

#### IPC

Unix socket at `~/.config/heads-up/sock`. Newline-delimited JSON protocol. The `serve` command starts the daemon directly (normally auto-started by `create`).
```

- [ ] **Step 2: Commit**

```bash
git add packages/heads-up/CLAUDE.md
git commit -m "docs(heads-up): add serve mode documentation"
```

---

## Task 7: Acceptance Test — Bouncing Yellow Ball

- [ ] **Step 1: Build heads-up**

```bash
cd packages/heads-up && bash build.sh
```
Expected: compiles successfully.

- [ ] **Step 2: Create the bouncing ball canvas**

Run:
```bash
./heads-up create --id ball --at 200,200,300,300 --html '<!DOCTYPE html>
<html><head><style>
  * { margin: 0; padding: 0; }
  body { background: transparent; overflow: hidden; }
  .ball {
    width: 60px; height: 60px;
    background: radial-gradient(circle at 30% 30%, #ffe066, #ffcc00, #e6a800);
    border-radius: 50%;
    position: absolute;
    box-shadow: 0 4px 15px rgba(0,0,0,0.3);
  }
</style></head><body>
<div class="ball" id="ball"></div>
<script>
  const ball = document.getElementById("ball");
  let x = 120, y = 120, dx = 2.5, dy = 1.8;
  const w = 300, h = 300, r = 30;
  function animate() {
    x += dx; y += dy;
    if (x - r < 0 || x + r > w) dx = -dx;
    if (y - r < 0 || y + r > h) dy = -dy;
    x = Math.max(r, Math.min(w - r, x));
    y = Math.max(r, Math.min(h - r, y));
    ball.style.left = (x - r) + "px";
    ball.style.top = (y - r) + "px";
    requestAnimationFrame(animate);
  }
  animate();
</script></body></html>'
```
Expected: A yellow ball appears on screen, bouncing within a 300x300 transparent area. The desktop beneath is visible through the transparent background.

- [ ] **Step 3: Verify list shows the canvas**

```bash
./heads-up list
```
Expected: JSON output showing canvas "ball" with its position.

- [ ] **Step 4: Update the ball position**

```bash
./heads-up update --id ball --at 500,300,300,300
```
Expected: The bouncing ball window moves to position (500, 300). Animation continues.

- [ ] **Step 5: Remove the ball**

```bash
./heads-up remove --id ball
```
Expected: Ball disappears. Daemon auto-exits after 5 seconds.

- [ ] **Step 6: Verify daemon exited**

```bash
sleep 6
ls ~/.config/heads-up/sock 2>&1
```
Expected: Socket file no longer exists (daemon cleaned up on exit).

- [ ] **Step 7: Commit (if any fixes were needed)**

If any bug fixes were applied during testing:
```bash
git add packages/heads-up/
git commit -m "fix(heads-up): fixes from bouncing ball acceptance test"
```

---

## Post-Implementation Notes

**Not included in this plan (deferred):**

- **Alpha hit-testing:** The spec suggests testing whether WKWebView's alpha channel naturally handles hit-testing (clicks pass through transparent pixels). v1 uses binary `ignoresMouseEvents`. Test alpha hit-testing empirically and switch if it works.
- **WebSocket for browser backend:** Step 5 in the spec. Separate plan when ready.
- **Two-way WKWebView messaging:** `window.webkit.messageHandlers` → event flow back through socket. Add when interactive overlays need it.
- **`--file` and stdin for serve mode:** Content is resolved client-side before sending to daemon. `--url` is sent as-is. `--file` and stdin both resolve to `--html` on the client before sending.
