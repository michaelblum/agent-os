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
