# heads-up Render Mode + Annotation Schema + side-eye --label Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `side-eye --label` — numbered badges baked onto screenshots aligned with `--xray` elements — powered by a new `heads-up render` command that rasterizes HTML/CSS/SVG to transparent PNGs.

**Architecture:** Three deliverables chained together: (1) annotation schema in `shared/schemas/` defines the data contract, (2) `heads-up` CLI renders HTML to bitmap via offscreen WKWebView, (3) side-eye `--label` generates annotation HTML from `--xray` elements, shells out to `heads-up render`, and composites the result onto its screenshot.

**Tech Stack:** Swift (macOS 14+), WebKit (WKWebView), CoreGraphics, JSON Schema (Draft 2020-12). Zero external dependencies for both CLIs.

**Spec:** `docs/superpowers/specs/2026-03-27-heads-up-canvas-and-annotation-design.md`

---

## File Structure

```
shared/schemas/
  annotation.schema.json          ← NEW: annotation data contract
  annotation.md                   ← NEW: companion docs (like spatial-topology.md)

packages/heads-up/
  main.swift                      ← NEW: heads-up CLI (render mode only for now)
  build.sh                        ← NEW: build script
  CLAUDE.md                       ← NEW: package docs

packages/side-eye/
  main.swift                      ← MODIFY: add --label flag, annotation output, heads-up integration
```

---

## Task 1: Annotation Schema

**Files:**
- Create: `shared/schemas/annotation.schema.json`
- Create: `shared/schemas/annotation.md`

- [ ] **Step 1: Create the JSON Schema file**

Write `shared/schemas/annotation.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://github.com/michaelblum/agent-os/shared/schemas/annotation.schema.json",
  "title": "Annotations",
  "description": "Labeled regions for agent-os ecosystem tools. Array position = display ordinal (0-based index, render as 1-based label).",
  "type": "object",
  "required": ["schema", "version", "annotations"],
  "additionalProperties": false,
  "properties": {
    "schema": {
      "const": "annotations"
    },
    "version": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+\\.\\d+$",
      "description": "Semver. Current: 0.1.0."
    },
    "annotations": {
      "type": "array",
      "items": { "$ref": "#/$defs/Annotation" },
      "description": "Labeled regions. Array index = ordinal (display as index + 1)."
    }
  },
  "$defs": {
    "Bounds": {
      "type": "object",
      "required": ["x", "y", "width", "height"],
      "additionalProperties": false,
      "properties": {
        "x": { "type": "number", "description": "Left edge." },
        "y": { "type": "number", "description": "Top edge." },
        "width": { "type": "number", "description": "Width." },
        "height": { "type": "number", "description": "Height." }
      },
      "description": "Rectangle. Coordinate space is determined by context (LCS for screenshots/windows, global CG for topology)."
    },
    "Annotation": {
      "type": "object",
      "required": ["bounds"],
      "additionalProperties": false,
      "properties": {
        "bounds": {
          "$ref": "#/$defs/Bounds",
          "description": "Region this annotation labels."
        },
        "label": {
          "type": "string",
          "description": "Human-readable label. If omitted, the ordinal number is used."
        }
      }
    }
  }
}
```

- [ ] **Step 2: Create the companion documentation**

Write `shared/schemas/annotation.md`:

```markdown
# Annotation Schema

**File:** `annotation.schema.json`
**Version:** 0.1.0
**Producer:** `side-eye --label`
**Consumers:** `heads-up`, orchestrators, vision models

## What This Is

A minimal data format describing labeled regions on a surface. An annotation is a rectangular region plus an optional text label. Array position is the ordinal — no explicit ordinal field.

## Coordinate Space

The schema is coordinate-space-agnostic. The coordinate space depends on the producer:

| Producer | Coordinate space |
|---|---|
| `side-eye --label` | LCS (top-left of captured region = 0,0) |
| Spatial topology cross-reference | Global CG (top-left of primary display = 0,0) |

The consumer knows which space it's operating in.

## How Ordinals Work

Array index = ordinal. Index 0 renders as badge "1", index 1 as badge "2", etc. There is no explicit ordinal field — array position is the single source of truth (same convention as `spatial-topology.schema.json` where array position = z-order).

## Example

```json
{
  "schema": "annotations",
  "version": "0.1.0",
  "annotations": [
    { "bounds": { "x": 100, "y": 200, "width": 50, "height": 30 }, "label": "Search" },
    { "bounds": { "x": 300, "y": 400, "width": 120, "height": 25 }, "label": "Submit" }
  ]
}
```

Badge "1" marks the Search field at (100, 200). Badge "2" marks the Submit button at (300, 400).

## Rendering

The schema describes WHAT to label, not HOW to render it. An HTML/CSS/SVG template turns annotation data into visual content. The `heads-up render` command rasterizes the template to a bitmap. Different templates can produce different visual styles from the same data.

## Relationship to side-eye --xray

`--xray` returns a flat array of interactive UI elements with `role`, `title`, `label`, `value`, `bounds`. `--label` converts these into the annotation schema format, using the AX element's `title` or `label` as the annotation label. The annotation array is a strict subset of the xray data — just `bounds` + `label`.
```

- [ ] **Step 3: Commit**

```bash
git add shared/schemas/annotation.schema.json shared/schemas/annotation.md
git commit -m "feat(schemas): add annotation schema v0.1.0

Minimal data contract for labeled regions. Array position = ordinal.
Coordinate-space-agnostic. First producer: side-eye --label."
```

---

## Task 2: heads-up Render Mode — Transparency Proof

The spec calls out WKWebView transparency as the critical risk. Validate it before building anything else.

**Files:**
- Create: `packages/heads-up/main.swift`
- Create: `packages/heads-up/build.sh`

- [ ] **Step 1: Create the build script**

Write `packages/heads-up/build.sh`:

```bash
#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

echo "Compiling heads-up..."
swiftc -parse-as-library -O -o heads-up main.swift

echo "Done: ./heads-up ($(du -h heads-up | cut -f1 | xargs))"
```

Then: `chmod +x packages/heads-up/build.sh`

- [ ] **Step 2: Write the minimal heads-up render command**

Write `packages/heads-up/main.swift`. This is a single-file Swift CLI, same pattern as side-eye and hand-off. For this step, implement ONLY the render subcommand with `--html`, `--width`, `--height`, `--out`, and `--base64`.

```swift
// heads-up — Display server for agent-os
// Pure Swift + WebKit. Render mode: rasterize HTML/CSS/SVG to transparent PNG.

import AppKit
import WebKit

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
        // Small delay to let CSS/SVG paint settle
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [self] in
            let config = WKSnapshotConfiguration()
            config.snapshotWidth = NSNumber(value: self.width)
            config.afterScreenUpdates = true

            webView.takeSnapshot(with: config) { image, error in
                guard let nsImage = image else {
                    self.completion?(nil)
                    return
                }
                // Convert NSImage to CGImage
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

    // Resolve HTML content
    let html: String
    if let h = htmlContent {
        html = h
    } else if let fp = filePath {
        guard let contents = try? String(contentsOfFile: fp, encoding: .utf8) else {
            exitError("Cannot read file: \(fp)", code: "FILE_NOT_FOUND")
        }
        html = contents
    } else {
        // Try stdin — but only if it's actually piped, not a terminal
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

    // Render
    let renderer = OffscreenRenderer(width: width, height: height)
    var resultImage: CGImage? = nil
    var renderDone = false

    renderer.loadHTML(html) { image in
        resultImage = image
        renderDone = true
        CFRunLoopStop(CFRunLoopGetMain())
    }

    // Pump the run loop until rendering completes, with a 10-second timeout
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

    // Output
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

// MARK: - Usage

func printUsage() {
    let text = """
    heads-up — Display server for agent-os

    USAGE:
      heads-up render [options]     Render HTML/CSS/SVG to a transparent PNG bitmap

    RENDER OPTIONS:
      --width <pixels>              Output width (default: 800)
      --height <pixels>             Output height (default: 600)
      --html "<html string>"        Inline HTML content
      --file <path>                 Load HTML from file
      (stdin)                       Pipe HTML content via stdin
      --out <path>                  Write PNG to file
      --base64                      Output PNG as base64 JSON

    EXAMPLES:
      heads-up render --width 1920 --height 1080 --html "<svg>...</svg>" --base64
      heads-up render --width 500 --height 400 --file overlay.html --out /tmp/overlay.png
      cat annotations.html | heads-up render --width 1920 --height 1080 --base64

    OUTPUT:
      {"status": "success", "file": "/tmp/overlay.png"}
      {"status": "success", "base64": "iVBORw0KG..."}
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
        case "--help", "-h", "help":
            printUsage()
        default:
            exitError("Unknown command: \(args[0]). Use 'heads-up render' or 'heads-up --help'.", code: "UNKNOWN_COMMAND")
        }
    }
}
```

- [ ] **Step 3: Build heads-up**

Run: `cd packages/heads-up && bash build.sh`
Expected: `Compiling heads-up... Done: ./heads-up (XXK)`

- [ ] **Step 4: Test transparency — the critical validation**

This is the make-or-break test. Create a test HTML string with a red circle on a transparent background and verify the output PNG has a working alpha channel.

Run:
```bash
./packages/heads-up/heads-up render --width 200 --height 200 --out /tmp/heads-up-test.png --html '<!DOCTYPE html><html><body style="margin:0;background:transparent"><svg width="200" height="200"><circle cx="100" cy="100" r="40" fill="red"/></svg></body></html>'
```

Expected output:
```json
{
  "status" : "success",
  "file" : "/tmp/heads-up-test.png"
}
```

Verify transparency by checking the PNG has alpha:
```bash
sips -g all /tmp/heads-up-test.png | grep -E "hasAlpha|pixelWidth|pixelHeight"
```

Expected: `hasAlpha: yes`, dimensions match `--width`/`--height`.

Visual check: open the PNG in Preview — should show a red circle on the transparent checkered background, NOT on a white background.

**If transparency fails:** The `drawsBackground` KVC workaround may not work on this macOS version. Alternatives to try:
1. Set `webView.underPageBackgroundColor = .clear` (macOS 12+)
2. Inject `<style>html,body{background:transparent!important}</style>` into the HTML
3. Use `webView.evaluateJavaScript("document.body.style.background='transparent'")` before snapshot

Do not proceed to Task 3 until this test passes with a transparent alpha channel.

- [ ] **Step 5: Test base64 output**

Run:
```bash
./packages/heads-up/heads-up render --width 100 --height 100 --base64 --html '<!DOCTYPE html><html><body style="margin:0;background:transparent"><div style="width:50px;height:50px;background:blue;border-radius:50%"></div></body></html>'
```

Expected: JSON response with `"status": "success"` and a `"base64"` field containing a valid PNG base64 string.

Verify the base64 decodes to a valid PNG:
```bash
./packages/heads-up/heads-up render --width 100 --height 100 --base64 --html '...' | python3 -c "import sys,json,base64; d=json.load(sys.stdin); open('/tmp/b64test.png','wb').write(base64.b64decode(d['base64']))"
open /tmp/b64test.png
```

- [ ] **Step 6: Test stdin input**

Run:
```bash
echo '<!DOCTYPE html><html><body style="margin:0;background:transparent"><p style="color:red;font-size:48px">Hello</p></body></html>' | ./packages/heads-up/heads-up render --width 300 --height 100 --out /tmp/stdin-test.png
```

Expected: JSON success response. `/tmp/stdin-test.png` shows red "Hello" text on transparent background.

- [ ] **Step 7: Commit**

```bash
git add packages/heads-up/main.swift packages/heads-up/build.sh
git commit -m "feat(heads-up): implement render mode — HTML to transparent PNG

Stateless fire-and-exit command: takes HTML/CSS/SVG via --html, --file,
or stdin, rasterizes via offscreen WKWebView, outputs transparent PNG
as file (--out) or base64 JSON (--base64). Zero dependencies."
```

---

## Task 3: heads-up CLAUDE.md

**Files:**
- Create: `packages/heads-up/CLAUDE.md`

- [ ] **Step 1: Write the package documentation**

Write `packages/heads-up/CLAUDE.md`:

```markdown
# heads-up

Display server for agent-os. Renders HTML/CSS/SVG to visual surfaces.

## Build

```bash
./build.sh
# or manually:
swiftc -parse-as-library -O -o heads-up main.swift
```

Requires macOS 14+.

## Usage

### Render Mode (stateless)

Rasterize HTML/CSS/SVG to a transparent PNG bitmap. Used by side-eye --label.

```bash
# Inline HTML to file
heads-up render --width 1920 --height 1080 --html "<svg>...</svg>" --out /tmp/overlay.png

# File to base64
heads-up render --width 500 --height 400 --file overlay.html --base64

# Stdin
cat content.html | heads-up render --width 1920 --height 1080 --base64
```

### Output

All output is JSON. Success to stdout, errors to stderr with exit code 1.

```json
{"status": "success", "file": "/tmp/overlay.png"}
{"status": "success", "base64": "iVBORw0KG..."}
{"error": "...", "code": "RENDER_FAILED"}
```

## Architecture

Single file: `main.swift`. No SPM, no Xcode project.

**Key frameworks:** WebKit (WKWebView for HTML rendering), AppKit (NSApplication lifecycle, NSBitmapImageRep for PNG encoding).

**Transparency:** Output PNGs have a working alpha channel. The WKWebView background is explicitly set to transparent. HTML content should use `background: transparent` on `<body>` to get clean compositing.

**Future:** Serve mode (persistent canvases on screen), browser backend (WebSocket bridge to Chrome extension). See the design spec for the full vision.
```

- [ ] **Step 2: Commit**

```bash
git add packages/heads-up/CLAUDE.md
git commit -m "docs(heads-up): add package documentation"
```

---

## Task 4: side-eye --label — Annotation Generation

Add the `--label` flag to side-eye. This task adds the annotation data generation and HTML template. The next task wires up the heads-up compositing.

**Files:**
- Modify: `packages/side-eye/main.swift`

- [ ] **Step 1: Add AnnotationJSON model**

In `main.swift`, after the `AXElementJSON` struct (around line 138), add the annotation output model:

```swift
// MARK: - Annotation Output Model (annotation.schema.json v0.1.0)

struct AnnotationBoundsJSON: Encodable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct AnnotationJSON: Encodable {
    let bounds: AnnotationBoundsJSON
    let label: String?
}
```

- [ ] **Step 2: Add `annotations` field to SuccessResponse**

Add the field to `SuccessResponse` (around line 140):

In the struct properties, add:
```swift
var annotations: [AnnotationJSON]?
```

In the `CodingKeys` enum, add `annotations`:
```swift
enum CodingKeys: String, CodingKey { case status, files, base64, cursor, bounds, click_x, click_y, warning, elements, annotations }
```

In the `encode(to:)` method, add:
```swift
if let a = annotations { try c.encode(a, forKey: .annotations) }
```

- [ ] **Step 3: Add `label` flag to CaptureOptions**

In `CaptureOptions` (around line 845), add:
```swift
var label: Bool = false
```

- [ ] **Step 4: Parse --label in argument parser**

In `parseCaptureArgs` (the `while i < args.count` switch), add a case:
```swift
case "--label":
    opts.label = true
    opts.xray = true  // --label implies --xray
```

Note: `--label` implicitly enables `--xray` because it needs the element data.

- [ ] **Step 5: Add the annotation HTML template generator**

After the xray-related functions (around line 790), add a function that converts AXElementJSON arrays into annotation data and generates the badge HTML:

```swift
// MARK: - Annotation Label Generation

/// Convert xray elements to annotation schema format.
func buildAnnotations(from elements: [AXElementJSON]) -> [AnnotationJSON] {
    return elements.map { el in
        AnnotationJSON(
            bounds: AnnotationBoundsJSON(
                x: Double(el.bounds.x),
                y: Double(el.bounds.y),
                width: Double(el.bounds.width),
                height: Double(el.bounds.height)
            ),
            label: el.title ?? el.label
        )
    }
}

/// Generate HTML/SVG for numbered badge overlays.
/// Each badge is a small circle with the ordinal number, positioned at the top-left of the element bounds.
/// The HTML has a transparent background for compositing over screenshots.
///
/// IMPORTANT: annotation bounds are in LCS points, but the SVG dimensions are in pixels.
/// The scaleFactor parameter converts from points to pixels so badges align correctly
/// on Retina displays (scale_factor = 2.0 means point 100 = pixel 200).
func generateBadgeHTML(annotations: [AnnotationJSON], width: Int, height: Int, scaleFactor: Double) -> String {
    let r = 10.0  // badge radius in pixels
    var badges = ""
    for (i, ann) in annotations.enumerated() {
        let num = i + 1
        // Convert LCS point bounds to pixel coordinates
        let px = ann.bounds.x * scaleFactor
        let py = ann.bounds.y * scaleFactor
        // Position badge at top-left of element, clamped to stay within image
        let cx = max(r, min(Double(width) - r, px))
        let cy = max(r, min(Double(height) - r, py))
        // Badge: 20px diameter circle with number
        badges += """
            <g>
              <circle cx="\(cx)" cy="\(cy)" r="\(r)" fill="rgba(30,30,30,0.88)" stroke="rgba(255,255,255,0.3)" stroke-width="1.5"/>
              <text x="\(cx)" y="\(cy)" text-anchor="middle" dominant-baseline="central"
                    fill="rgba(255,255,255,0.9)" font-family="-apple-system,system-ui,sans-serif"
                    font-size="10" font-weight="700" style="font-variant-numeric:tabular-nums">\(num)</text>
            </g>

        """
    }
    return """
    <!DOCTYPE html>
    <html><head><style>html,body{margin:0;padding:0;background:transparent!important;overflow:hidden}</style></head>
    <body><svg width="\(width)" height="\(height)" xmlns="http://www.w3.org/2000/svg">
    \(badges)</svg></body></html>
    """
}
```

- [ ] **Step 6: Add --label to the usage text**

In `printUsage()`, add `--label` to the options section (around line 1372, near `--xray`):

```
      --label                 Number interactive elements with badges (requires heads-up).
                              Implies --xray. Emits annotations[] in JSON output.
```

- [ ] **Step 7: Commit**

```bash
git add packages/side-eye/main.swift
git commit -m "feat(side-eye): add --label annotation generation and badge template

Adds AnnotationJSON model, --label flag (implies --xray), badge HTML
generator. Does not yet composite onto screenshots — heads-up
integration comes next."
```

---

## Task 5: side-eye --label — heads-up Integration and Compositing

Wire up the annotation pipeline: generate badges, shell out to heads-up render, composite the transparent overlay onto the screenshot.

**Files:**
- Modify: `packages/side-eye/main.swift`

- [ ] **Step 1: Add the heads-up render integration function**

After `generateBadgeHTML`, add a function that shells out to `heads-up render` and returns the resulting transparent PNG as a CGImage:

```swift
/// Find the heads-up binary: same directory as side-eye, or in PATH.
/// Returns the path, or nil if not found.
func findHeadsUp() -> String? {
    let selfPath = CommandLine.arguments[0]
    let selfDir = (selfPath as NSString).deletingLastPathComponent
    let siblingPath = (selfDir as NSString).appendingPathComponent("heads-up")

    if FileManager.default.isExecutableFile(atPath: siblingPath) {
        return siblingPath
    }

    // Try PATH
    let whichProc = Process()
    whichProc.executableURL = URL(fileURLWithPath: "/usr/bin/which")
    whichProc.arguments = ["heads-up"]
    let whichPipe = Pipe()
    whichProc.standardOutput = whichPipe
    whichProc.standardError = FileHandle.nullDevice
    try? whichProc.run()
    whichProc.waitUntilExit()
    let whichOut = String(data: whichPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
        .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if whichProc.terminationStatus == 0 && !whichOut.isEmpty {
        return whichOut
    }
    return nil
}

/// Shell out to heads-up render to rasterize HTML to a transparent PNG bitmap.
/// Uses stdin for HTML input and a temp file for PNG output to avoid base64 overhead
/// and command-line arg length limits.
/// Returns the resulting CGImage, or nil if heads-up is not available or rendering fails.
func renderHTMLToBitmap(html: String, width: Int, height: Int) -> CGImage? {
    guard let headsUpPath = findHeadsUp() else { return nil }

    // Use a temp file for the output PNG — avoids base64 encoding overhead
    let tempPath = NSTemporaryDirectory() + "heads-up-overlay-\(ProcessInfo.processInfo.processIdentifier).png"
    defer { try? FileManager.default.removeItem(atPath: tempPath) }

    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: headsUpPath)
    proc.arguments = ["render", "--width", "\(width)", "--height", "\(height)", "--out", tempPath]

    // Pipe HTML via stdin — avoids command-line arg length limits
    let inPipe = Pipe()
    proc.standardInput = inPipe
    proc.standardOutput = FileHandle.nullDevice
    proc.standardError = Pipe()  // suppress stderr

    do { try proc.run() } catch { return nil }
    inPipe.fileHandleForWriting.write(html.data(using: .utf8)!)
    inPipe.fileHandleForWriting.closeFile()
    proc.waitUntilExit()
    guard proc.terminationStatus == 0 else { return nil }

    // Read the rendered PNG directly as CGImage
    guard let provider = CGDataProvider(filename: tempPath),
          let image = CGImage(pngDataProviderSource: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)
    else { return nil }

    return image
}
```

- [ ] **Step 2: Add the compositing function**

After `renderHTMLToBitmap`, add:

```swift
/// Composite a transparent overlay image on top of a base image.
/// Both images must have the same pixel dimensions.
func compositeOverlay(_ overlay: CGImage, onto base: CGImage) -> CGImage {
    let w = base.width
    let h = base.height
    guard let ctx = CGContext(
        data: nil, width: w, height: h,
        bitsPerComponent: 8, bytesPerRow: 0,
        space: base.colorSpace ?? CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else { return base }
    ctx.draw(base, in: CGRect(x: 0, y: 0, width: w, height: h))
    ctx.draw(overlay, in: CGRect(x: 0, y: 0, width: w, height: h))
    return ctx.makeImage() ?? base
}
```

- [ ] **Step 3: Wire --label into the capture pipeline**

In the main capture function (around line 2069, after the xray section `// 7. Xray`), add the label pipeline. Find the block:

```swift
        // 8. Overlays (LCS — post-crop coordinates)
```

Insert BEFORE it:

```swift
        // 7b. Label — generate annotation badges and composite via heads-up
        if opts.label, let elems = responseElements, !elems.isEmpty {
            let anns = buildAnnotations(from: elems)
            responseAnnotations = anns

            let badgeHTML = generateBadgeHTML(annotations: anns, width: image.width, height: image.height, scaleFactor: entry.scaleFactor)
            if let overlay = renderHTMLToBitmap(html: badgeHTML, width: image.width, height: image.height) {
                image = compositeOverlay(overlay, onto: image)
            } else {
                exitError("heads-up not found. Install heads-up for --label support.", code: "MISSING_DEPENDENCY")
            }
        }
```

Note: `entry.scaleFactor` is available in the capture loop — it's the display's backing scale factor (2.0 on Retina). This converts LCS point-space annotation bounds to pixel-space SVG coordinates.

This requires a `responseAnnotations` variable. Add it near the other response variables (around line 1941):

```swift
var responseAnnotations: [AnnotationJSON]? = nil
```

- [ ] **Step 4: Add annotations to the response builder**

In the `buildResponse()` function (around line 2104), add:

```swift
resp.annotations = responseAnnotations
```

- [ ] **Step 5: Add the accessibility permission check for --label**

In the permissions section (around line 1816), where `--xray` checks are done, add --label to the same check. Since `--label` implies `--xray`, this is already handled by `opts.xray = true` in the arg parser. Verify the line reads:

```swift
if opts.xray { checkAccessibilityPermission(feature: "--xray") }
```

No change needed — `--label` sets `opts.xray = true`, so this already fires.

- [ ] **Step 6: Build side-eye**

Run: `cd packages/side-eye && bash build.sh`
Expected: Compiles without errors.

- [ ] **Step 7: End-to-end test**

Run with both binaries available:
```bash
# Make sure heads-up is findable (same directory)
cp packages/heads-up/heads-up packages/side-eye/

# Run --label on the active display
./packages/side-eye/side-eye main --label --out /tmp/labeled.png
```

Expected:
1. JSON output on stdout with `"status": "success"`, `"files"`, and `"annotations"` array
2. `/tmp/labeled.png` shows the screenshot with numbered circular badges at the top-left of each interactive element
3. The annotations array has entries with `bounds` and `label` fields
4. Badge "1" on the screenshot corresponds to `annotations[0]`, etc.

```bash
# Verify annotations are in the output
./packages/side-eye/side-eye main --label --out /tmp/labeled.png | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'{len(d.get(\"annotations\",[]))} annotations')"
```

- [ ] **Step 8: Test --label with --base64**

```bash
./packages/side-eye/side-eye main --label --base64 | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'annotations: {len(d.get(\"annotations\",[]))}, base64 length: {len(d.get(\"base64\",[\"\"])[0])}')"
```

Expected: Both `annotations` and `base64` present in the response.

- [ ] **Step 8b: Verify Retina coordinate alignment**

Check that badge positions match element positions. On a Retina display (scale_factor 2.0), annotation bounds in the JSON are in LCS points, but badges on the screenshot should be at pixel positions (2× the point values).

```bash
./packages/side-eye/side-eye main --label --out /tmp/retina-test.png | python3 -c "
import sys, json
d = json.load(sys.stdin)
for i, ann in enumerate(d.get('annotations', [])[:3]):
    b = ann['bounds']
    print(f'Badge {i+1}: point ({b[\"x\"]:.0f}, {b[\"y\"]:.0f}) — check screenshot visually')
"
```

Open `/tmp/retina-test.png` and verify badges align with the top-left corner of their corresponding elements. If badges are offset by half (appearing at 1× instead of 2× positions), the scale factor multiplication is not working.

- [ ] **Step 9: Test --label without heads-up**

Temporarily rename heads-up to verify the error message:
```bash
mv packages/side-eye/heads-up packages/side-eye/heads-up.bak
./packages/side-eye/side-eye main --label --out /tmp/fail.png 2>/tmp/label-err.json; echo "exit: $?"
cat /tmp/label-err.json
mv packages/side-eye/heads-up.bak packages/side-eye/heads-up
```

Expected: Exit code 1, stderr JSON: `{"error": "heads-up not found. Install heads-up for --label support.", "code": "MISSING_DEPENDENCY"}`

- [ ] **Step 10: Clean up the test copy**

```bash
rm packages/side-eye/heads-up
```

- [ ] **Step 11: Commit**

```bash
git add packages/side-eye/main.swift
git commit -m "feat(side-eye): wire --label to heads-up render for badge compositing

side-eye --label now shells out to heads-up render to rasterize SVG
badges as a transparent PNG, then composites the overlay onto the
screenshot. Emits annotations[] in JSON output matching the annotation
schema. Errors clearly if heads-up is not installed."
```

---

## Task 6: Update ARCHITECTURE.md

**Files:**
- Modify: `ARCHITECTURE.md`

- [ ] **Step 1: Update the heads-up entry in the component tables**

In ARCHITECTURE.md, update the heads-up row in the Layer 1 table (around line 83):

Change:
```
| `heads-up` | **Projection** — floating overlays, the avatar orb, spotlights, laser pointers | AppKit (NSWindow), CoreAnimation | Planned |
```

To:
```
| `heads-up` | **Projection** — display server: renders HTML/CSS/SVG to OS overlays, transparent bitmaps, or browser injection | WebKit (WKWebView), AppKit (NSWindow) | Render mode production, serve mode planned |
```

Update the component roster table (around line 145):

Change:
```
| `heads-up` | OS | Swift | `packages/heads-up/` | Planned | Floating overlays, avatar orb, spotlight, laser, `--skin` system |
```

To:
```
| `heads-up` | OS | Swift | `packages/heads-up/` | Render mode production | Display server: HTML→bitmap (render mode), persistent canvases (serve mode planned), browser injection (planned) |
```

- [ ] **Step 2: Update side-eye capabilities**

In the component roster table, update side-eye's Key Capabilities:

Change:
```
| `side-eye` | OS | Swift | `packages/side-eye/` | Production | Screenshots, `--xray` AX tree, cursor query, selection query, grids, overlays, zones, LCS |
```

To:
```
| `side-eye` | OS | Swift | `packages/side-eye/` | Production | Screenshots, `--xray` AX tree, `--label` annotated screenshots, cursor query, selection query, grids, overlays, zones, LCS |
```

- [ ] **Step 3: Add annotation schema to the monorepo structure**

In the monorepo structure diagram (around line 134), add the annotation schema:

Change:
```
      spatial-topology.schema.json   ← Display→Window topology (v0.1.0)
      spatial-topology.md            ← Companion docs + coordinate system spec
```

To:
```
      spatial-topology.schema.json   ← Display→Window topology (v0.1.0)
      spatial-topology.md            ← Companion docs + coordinate system spec
      annotation.schema.json         ← Labeled regions for annotations (v0.1.0)
      annotation.md                  ← Companion docs
```

- [ ] **Step 4: Commit**

```bash
git add ARCHITECTURE.md
git commit -m "docs: update ARCHITECTURE.md for heads-up render mode and --label"
```

---

## Task 7: Update side-eye CLAUDE.md

**Files:**
- Modify: `packages/side-eye/CLAUDE.md`

- [ ] **Step 1: Add --label to the usage examples**

In `packages/side-eye/CLAUDE.md`, add to the usage section:

```markdown
# Annotated screenshots (requires heads-up)
./side-eye main --label --out /tmp/labeled.png
./side-eye user_active --window --label --base64
```

- [ ] **Step 2: Add --label to the architecture notes**

Add to the Architecture section:

```markdown
**--label pipeline:** `--label` implies `--xray`. After capturing elements, side-eye generates SVG badge HTML, shells out to `heads-up render` to rasterize it as a transparent PNG, and composites the result onto the screenshot. The `annotations` array in JSON output follows `shared/schemas/annotation.schema.json`. Requires `heads-up` binary in the same directory or in PATH.
```

- [ ] **Step 3: Commit**

```bash
git add packages/side-eye/CLAUDE.md
git commit -m "docs(side-eye): add --label usage and architecture notes"
```
