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
