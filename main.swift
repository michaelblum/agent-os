import Cocoa
import ScreenCaptureKit
import UniformTypeIdentifiers
import CoreText

// MARK: - JSON Output Models

struct DisplayJSON: Encodable {
    let id: Int
    let type: String
    let resolution: String
    let scale_factor: Double
    let rotation: Double
    let arrangement: String
}

struct TopologyJSON: Encodable {
    let active_app: String
    let displays: [DisplayJSON]
}

struct CursorJSON: Encodable {
    let x: Int
    let y: Int
}

struct BoundsJSON: Encodable {
    let x: Int
    let y: Int
    let width: Int
    let height: Int
}

struct SuccessResponse: Encodable {
    let status = "success"
    var files: [String]?
    var base64: [String]?
    var cursor: CursorJSON?
    var bounds: BoundsJSON?

    enum CodingKeys: String, CodingKey { case status, files, base64, cursor, bounds }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(status, forKey: .status)
        if let f = files { try c.encode(f, forKey: .files) }
        if let b = base64 { try c.encode(b, forKey: .base64) }
        if let cur = cursor { try c.encode(cur, forKey: .cursor) }
        if let bnd = bounds { try c.encode(bnd, forKey: .bounds) }
    }
}

// MARK: - Overlay Types

struct RectOverlay {
    let x: Int
    let y: Int
    let width: Int
    let height: Int
    let color: CGColor
    let fill: Bool
}

struct ShadowSpec {
    let offsetX: CGFloat
    let offsetY: CGFloat
    let blur: CGFloat
    let color: CGColor
}

struct GridSpec {
    let cols: Int
    let rows: Int
}

struct ZoneEntry: Codable {
    let target: String
    let crop: String
}

// MARK: - Internal Display Model

struct DisplayEntry {
    let ordinal: Int
    let cgID: CGDirectDisplayID
    let bounds: CGRect
    let scaleFactor: Double
    let rotation: Double
    let isMain: Bool
    let isMirrored: Bool
    let type: String
    let arrangement: String
    let resolution: String
}

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
        FileHandle.standardError.write(Data((s + "\n").utf8))
    }
    exit(1)
}

// MARK: - Color Parsing

func parseHexColor(_ hex: String) -> CGColor {
    var h = hex
    if h.hasPrefix("#") { h = String(h.dropFirst()) }
    guard h.count == 6 || h.count == 8 else {
        exitError("Invalid color '\(hex)'. Use #RRGGBB or #RRGGBBAA.", code: "INVALID_COLOR")
    }
    let scanner = Scanner(string: h)
    var value: UInt64 = 0
    scanner.scanHexInt64(&value)

    let r, g, b, a: CGFloat
    if h.count == 8 {
        r = CGFloat((value >> 24) & 0xFF) / 255.0
        g = CGFloat((value >> 16) & 0xFF) / 255.0
        b = CGFloat((value >> 8) & 0xFF) / 255.0
        a = CGFloat(value & 0xFF) / 255.0
    } else {
        r = CGFloat((value >> 16) & 0xFF) / 255.0
        g = CGFloat((value >> 8) & 0xFF) / 255.0
        b = CGFloat(value & 0xFF) / 255.0
        a = 1.0
    }
    return CGColor(srgbRed: r, green: g, blue: b, alpha: a)
}

// MARK: - Display Enumeration

func getDisplays() -> [DisplayEntry] {
    let maxD: UInt32 = 16
    var ids = [CGDirectDisplayID](repeating: 0, count: Int(maxD))
    var count: UInt32 = 0
    CGGetActiveDisplayList(maxD, &ids, &count)

    let mainID = CGMainDisplayID()
    let mainBounds = CGDisplayBounds(mainID)
    let mainCX = mainBounds.origin.x + mainBounds.width / 2

    var scaleMap: [CGDirectDisplayID: Double] = [:]
    for screen in NSScreen.screens {
        if let n = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID {
            scaleMap[n] = screen.backingScaleFactor
        }
    }

    let sorted = ids.prefix(Int(count)).sorted { a, b in
        if a == mainID { return true }
        if b == mainID { return false }
        return CGDisplayBounds(a).origin.x < CGDisplayBounds(b).origin.x
    }

    return sorted.enumerated().map { i, did in
        let b = CGDisplayBounds(did)
        let isMain = did == mainID
        let mirror = CGDisplayMirrorsDisplay(did)
        let isMirror = mirror != kCGNullDirectDisplay
        let type = isMirror ? "Mirror for Built-in Display" : (isMain ? "Main display" : "Extended")
        let cx = b.origin.x + b.width / 2
        let arr = isMain ? "main" : (cx < mainCX ? "left" : (cx > mainCX ? "right" : "center"))

        return DisplayEntry(
            ordinal: i + 1, cgID: did, bounds: b,
            scaleFactor: scaleMap[did] ?? 1.0,
            rotation: Double(CGDisplayRotation(did)),
            isMain: isMain, isMirrored: isMirror,
            type: type, arrangement: arr,
            resolution: "\(Int(b.width))x\(Int(b.height))"
        )
    }
}

func displayForWindow(_ window: SCWindow, displays: [DisplayEntry]) -> DisplayEntry {
    let pt = CGPoint(x: window.frame.midX, y: window.frame.midY)
    return displays.first(where: { $0.bounds.contains(pt) }) ?? displays.first(where: { $0.isMain })!
}

func largestWindow(for pid: pid_t, in windows: [SCWindow]) -> SCWindow? {
    windows
        .filter { $0.owningApplication?.processID == pid && $0.windowLayer == 0 && $0.frame.width > 0 }
        .max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height })
}

func largestWindowOnDisplay(_ entry: DisplayEntry, in windows: [SCWindow], preferPID: pid_t? = nil) -> SCWindow? {
    let onDisplay = windows.filter { w in
        w.windowLayer == 0 && w.frame.width > 100
            && entry.bounds.contains(CGPoint(x: w.frame.midX, y: w.frame.midY))
    }
    if let pid = preferPID,
       let w = onDisplay.filter({ $0.owningApplication?.processID == pid })
           .max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }) {
        return w
    }
    return onDisplay.max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height })
}

// MARK: - Process Tree Walking (selfie)

func parentPID(of pid: pid_t) -> pid_t {
    let pipe = Pipe()
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/bin/ps")
    proc.arguments = ["-o", "ppid=", "-p", "\(pid)"]
    proc.standardOutput = pipe
    proc.standardError = FileHandle.nullDevice
    do { try proc.run() } catch { return -1 }
    proc.waitUntilExit()
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    guard let s = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
          let v = Int32(s) else { return -1 }
    return v
}

func selfieWindow(content: SCShareableContent) -> SCWindow? {
    var pid = getpid()
    var visited = Set<pid_t>()
    while pid > 1 && !visited.contains(pid) {
        visited.insert(pid)
        if let w = largestWindow(for: pid, in: content.windows) { return w }
        pid = parentPID(of: pid)
    }
    if let termProgram = ProcessInfo.processInfo.environment["TERM_PROGRAM"] {
        let needle = termProgram.lowercased()
        let candidates = content.windows.filter {
            guard let app = $0.owningApplication else { return false }
            return $0.windowLayer == 0 && $0.frame.width > 100
                && (app.applicationName.lowercased().contains(needle)
                    || app.bundleIdentifier.lowercased().contains(needle))
        }
        if let w = candidates.max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }) {
            return w
        }
    }
    if let frontApp = NSWorkspace.shared.frontmostApplication {
        return largestWindow(for: frontApp.processIdentifier, in: content.windows)
    }
    return nil
}

// MARK: - Image Drawing Infrastructure

/// Create a mutable copy of a CGImage, run drawing commands, return result.
/// CGContext uses bottom-left origin. Use `h - y` to convert from top-left pixel coords.
func drawOnImage(_ image: CGImage, _ draw: (CGContext, Int, Int) -> Void) -> CGImage {
    let w = image.width
    let h = image.height
    guard let ctx = CGContext(
        data: nil, width: w, height: h,
        bitsPerComponent: 8, bytesPerRow: 0,
        space: image.colorSpace ?? CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else { return image }
    ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
    draw(ctx, w, h)
    return ctx.makeImage() ?? image
}

/// Draw a text label with dark background pill using CoreText.
func drawLabel(ctx: CGContext, text: String, at point: CGPoint, font: CTFont) {
    let attrs: [NSAttributedString.Key: Any] = [
        .font: font,
        .foregroundColor: CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 0.9)
    ]
    let attrStr = NSAttributedString(string: text, attributes: attrs)
    let line = CTLineCreateWithAttributedString(attrStr)
    let lineBounds = CTLineGetBoundsWithOptions(line, .useOpticalBounds)
    let padding: CGFloat = 3

    ctx.saveGState()
    ctx.setShadow(offset: .zero, blur: 0)
    ctx.setFillColor(CGColor(srgbRed: 0, green: 0, blue: 0, alpha: 0.6))
    ctx.fill(CGRect(
        x: point.x - padding, y: point.y - padding,
        width: lineBounds.width + padding * 2, height: lineBounds.height + padding * 2
    ))
    ctx.textPosition = point
    CTLineDraw(line, ctx)
    ctx.restoreGState()
}

// MARK: - Image Encoding

func encodeImage(_ image: CGImage, format: UTType, quality: Double) -> Data? {
    let data = NSMutableData()
    guard let dest = CGImageDestinationCreateWithData(data as CFMutableData, format.identifier as CFString, 1, nil)
    else { return nil }
    var props: [CFString: Any] = [:]
    if format != .png { props[kCGImageDestinationLossyCompressionQuality] = quality }
    CGImageDestinationAddImage(dest, image, props as CFDictionary)
    guard CGImageDestinationFinalize(dest) else { return nil }
    return data as Data
}

func writeImage(_ image: CGImage, to path: String, format: UTType, quality: Double) -> Bool {
    let url = URL(fileURLWithPath: (path as NSString).expandingTildeInPath)
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    guard let dest = CGImageDestinationCreateWithURL(url as CFURL, format.identifier as CFString, 1, nil)
    else { return false }
    var props: [CFString: Any] = [:]
    if format != .png { props[kCGImageDestinationLossyCompressionQuality] = quality }
    CGImageDestinationAddImage(dest, image, props as CFDictionary)
    return CGImageDestinationFinalize(dest)
}

// MARK: - Crop

/// Returns both the cropped image and the crop rect used (in pixel coords, top-left origin).
func applyCrop(_ image: CGImage, style: String) -> (image: CGImage, rect: CGRect) {
    let w = CGFloat(image.width)
    let h = CGFloat(image.height)

    let rect: CGRect
    switch style {
    case "top-half":        rect = CGRect(x: 0, y: 0, width: w, height: h / 2)
    case "bottom-half":     rect = CGRect(x: 0, y: h / 2, width: w, height: h / 2)
    case "left-half":       rect = CGRect(x: 0, y: 0, width: w / 2, height: h)
    case "right-half":      rect = CGRect(x: w / 2, y: 0, width: w / 2, height: h)
    case "top-left":        rect = CGRect(x: 0, y: 0, width: w / 2, height: h / 2)
    case "top-right":       rect = CGRect(x: w / 2, y: 0, width: w / 2, height: h / 2)
    case "bottom-left":     rect = CGRect(x: 0, y: h / 2, width: w / 2, height: h / 2)
    case "bottom-right":    rect = CGRect(x: w / 2, y: h / 2, width: w / 2, height: h / 2)
    case "center":          rect = CGRect(x: w / 4, y: h / 4, width: w / 2, height: h / 2)
    default:
        let parts = style.split(separator: ",").compactMap { Int($0) }
        if parts.count == 4 {
            rect = CGRect(x: parts[0], y: parts[1], width: parts[2], height: parts[3])
        } else {
            exitError("Invalid crop style: '\(style)'. Use a named style or x,y,w,h.", code: "INVALID_CROP")
        }
    }
    guard let cropped = image.cropping(to: rect) else {
        exitError("Crop region is outside image bounds", code: "CROP_FAILED")
    }
    return (cropped, rect)
}

// MARK: - Cursor Position

/// Get mouse position in image pixel coordinates (top-left origin) for a given display.
/// Returns nil if cursor is not on the specified display.
func cursorPositionInImageSpace(display: DisplayEntry) -> (x: Int, y: Int)? {
    let mouse = NSEvent.mouseLocation
    // NSEvent: bottom-left of primary screen = (0,0), Y up
    // CG:     top-left of primary screen = (0,0), Y down
    let mainH = CGDisplayBounds(CGMainDisplayID()).height
    let cgX = mouse.x
    let cgY = mainH - mouse.y
    guard display.bounds.contains(CGPoint(x: cgX, y: cgY)) else { return nil }
    let relX = cgX - display.bounds.origin.x
    let relY = cgY - display.bounds.origin.y
    return (Int(relX * display.scaleFactor), Int(relY * display.scaleFactor))
}

// MARK: - Grid Drawing

func drawGrid(on image: CGImage, spec: GridSpec, thickness: CGFloat, shadow: ShadowSpec?) -> CGImage {
    drawOnImage(image) { ctx, w, h in
        if let s = shadow {
            ctx.setShadow(offset: CGSize(width: s.offsetX, height: s.offsetY), blur: s.blur, color: s.color)
        }
        ctx.setStrokeColor(CGColor(srgbRed: 1, green: 0, blue: 0, alpha: 0.6))
        ctx.setLineWidth(thickness)

        let colW = CGFloat(w) / CGFloat(spec.cols)
        let rowH = CGFloat(h) / CGFloat(spec.rows)

        // Vertical interior lines
        for c in 1..<spec.cols {
            let x = CGFloat(c) * colW
            ctx.move(to: CGPoint(x: x, y: 0))
            ctx.addLine(to: CGPoint(x: x, y: CGFloat(h)))
        }
        // Horizontal interior lines
        for r in 1..<spec.rows {
            let y = CGFloat(r) * rowH
            ctx.move(to: CGPoint(x: 0, y: y))
            ctx.addLine(to: CGPoint(x: CGFloat(w), y: y))
        }
        ctx.strokePath()

        // Labels: pixel coordinates at grid boundaries
        ctx.setShadow(offset: .zero, blur: 0)
        let fontSize = max(12.0, min(24.0, CGFloat(min(w, h)) / 80.0))
        let font = CTFontCreateWithName("Helvetica" as CFString, fontSize, nil)

        // Column labels along top edge (CGContext: top = high y)
        for c in 0...spec.cols {
            let px = Int(CGFloat(c) * colW)
            drawLabel(ctx: ctx, text: "\(px)",
                     at: CGPoint(x: CGFloat(px) + 2, y: CGFloat(h) - fontSize - 4), font: font)
        }
        // Row labels along left edge (pixel y = 0 is at CGContext y = h)
        for r in 0...spec.rows {
            let py = Int(CGFloat(r) * rowH)
            drawLabel(ctx: ctx, text: "\(py)",
                     at: CGPoint(x: 2, y: CGFloat(h) - CGFloat(py) - fontSize - 4), font: font)
        }
    }
}

// MARK: - Rect Drawing

func drawRects(on image: CGImage, rects: [RectOverlay], thickness: CGFloat, shadow: ShadowSpec?) -> CGImage {
    drawOnImage(image) { ctx, w, h in
        if let s = shadow {
            ctx.setShadow(offset: CGSize(width: s.offsetX, height: s.offsetY), blur: s.blur, color: s.color)
        }
        ctx.setLineWidth(thickness)
        for r in rects {
            // Convert from top-left origin to CGContext bottom-left origin
            let rect = CGRect(
                x: CGFloat(r.x),
                y: CGFloat(h - r.y - r.height),
                width: CGFloat(r.width),
                height: CGFloat(r.height)
            )
            if r.fill {
                ctx.setFillColor(r.color)
                ctx.fill(rect)
            } else {
                ctx.setStrokeColor(r.color)
                ctx.stroke(rect)
            }
        }
    }
}

// MARK: - ScreenCaptureKit Capture

@available(macOS 14.0, *)
func captureDisplay(_ scDisplay: SCDisplay, scaleFactor: Double, showCursor: Bool) async throws -> CGImage {
    let filter = SCContentFilter(display: scDisplay, excludingApplications: [], exceptingWindows: [])
    let config = SCStreamConfiguration()
    config.width = Int(Double(scDisplay.width) * scaleFactor)
    config.height = Int(Double(scDisplay.height) * scaleFactor)
    config.showsCursor = showCursor
    config.captureResolution = .best
    return try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
}

@available(macOS 14.0, *)
func captureWindow(_ window: SCWindow, scaleFactor: Double, showCursor: Bool) async throws -> CGImage {
    let filter = SCContentFilter(desktopIndependentWindow: window)
    let config = SCStreamConfiguration()
    config.width = Int(window.frame.width * scaleFactor)
    config.height = Int(window.frame.height * scaleFactor)
    config.showsCursor = showCursor
    config.captureResolution = .best
    config.ignoreShadowsSingleWindow = true
    return try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
}

// MARK: - Argument Parsing

struct CaptureOptions {
    var target: String = "main"
    var windowOnly: Bool = false
    var outputPath: String? = nil
    var useBase64: Bool = false
    var crop: String? = nil
    var format: String = "png"
    var quality: String = "high"

    // Cursor
    var showCursor: Bool = false
    var highlightCursor: Bool = false

    // Interactive
    var interactive: Bool = false

    // Utilities
    var delay: Double? = nil
    var clipboard: Bool = false

    // Overlays (all in LCS — post-crop local coordinates)
    var grid: GridSpec? = nil
    var drawRects: [RectOverlay] = []
    var thickness: CGFloat = 2.0
    var shadow: ShadowSpec? = nil

    var resolvedOutputPath: String {
        if let p = outputPath { return p }
        let ext = (format == "jpeg") ? "jpg" : format
        return "./screenshot.\(ext)"
    }
}

func parseCaptureArgs(_ args: [String]) -> CaptureOptions {
    var opts = CaptureOptions()
    var i = 0

    // Extract target (first non-flag arg)
    if i < args.count && !args[i].hasPrefix("--") {
        opts.target = args[i]
        i += 1
        if opts.target == "external" && i < args.count && !args[i].hasPrefix("--") {
            if let _ = Int(args[i]) {
                opts.target += " \(args[i])"
                i += 1
            }
        }
    }

    // Parse flags
    while i < args.count {
        switch args[i] {
        case "--window":
            opts.windowOnly = true
        case "--out":
            i += 1
            guard i < args.count else { exitError("--out requires a path", code: "MISSING_ARG") }
            opts.outputPath = args[i]
        case "--base64":
            opts.useBase64 = true
        case "--crop":
            i += 1
            guard i < args.count else { exitError("--crop requires a value", code: "MISSING_ARG") }
            opts.crop = args[i]
        case "--format":
            i += 1
            guard i < args.count else { exitError("--format requires a value", code: "MISSING_ARG") }
            opts.format = args[i].lowercased()
        case "--quality":
            i += 1
            guard i < args.count else { exitError("--quality requires a value", code: "MISSING_ARG") }
            opts.quality = args[i].lowercased()

        // Cursor
        case "--show-cursor":
            opts.showCursor = true
        case "--highlight-cursor":
            opts.highlightCursor = true

        // Interactive
        case "--interactive":
            opts.interactive = true

        // Utilities
        case "--delay":
            i += 1
            guard i < args.count else { exitError("--delay requires seconds", code: "MISSING_ARG") }
            guard let d = Double(args[i]), d >= 0 else {
                exitError("--delay must be a non-negative number", code: "INVALID_ARG")
            }
            opts.delay = d
        case "--clipboard":
            opts.clipboard = true

        // Grid
        case "--grid":
            i += 1
            guard i < args.count else { exitError("--grid requires COLSxROWS", code: "MISSING_ARG") }
            let parts = args[i].lowercased().split(separator: "x")
            guard parts.count == 2, let c = Int(parts[0]), let r = Int(parts[1]), c > 0, r > 0 else {
                exitError("--grid format: COLSxROWS (e.g., 4x3)", code: "INVALID_ARG")
            }
            opts.grid = GridSpec(cols: c, rows: r)

        // Draw rects (repeatable, each consumes 2 extra args)
        case "--draw-rect", "--draw-rect-fill":
            let fill = args[i] == "--draw-rect-fill"
            let flag = args[i]
            i += 1
            guard i < args.count else { exitError("\(flag) requires x,y,w,h and #color", code: "MISSING_ARG") }
            let coords = args[i]
            i += 1
            guard i < args.count else { exitError("\(flag) requires a color after coordinates", code: "MISSING_ARG") }
            let color = args[i]
            let p = coords.split(separator: ",").compactMap { Int($0) }
            guard p.count == 4 else { exitError("Rect coords must be x,y,w,h", code: "INVALID_ARG") }
            opts.drawRects.append(RectOverlay(
                x: p[0], y: p[1], width: p[2], height: p[3],
                color: parseHexColor(color), fill: fill
            ))

        // Overlay properties
        case "--thickness":
            i += 1
            guard i < args.count else { exitError("--thickness requires a value", code: "MISSING_ARG") }
            guard let t = Double(args[i]), t > 0 else {
                exitError("--thickness must be a positive number", code: "INVALID_ARG")
            }
            opts.thickness = CGFloat(t)

        case "--shadow":
            i += 1
            guard i < args.count else { exitError("--shadow requires \"offsetX,offsetY,blur,#color\"", code: "MISSING_ARG") }
            let parts = args[i].split(separator: ",", maxSplits: 3)
            guard parts.count == 4,
                  let ox = Double(parts[0]), let oy = Double(parts[1]), let bl = Double(parts[2]) else {
                exitError("--shadow format: offsetX,offsetY,blur,#color", code: "INVALID_ARG")
            }
            opts.shadow = ShadowSpec(
                offsetX: CGFloat(ox), offsetY: CGFloat(-oy),  // negate Y for intuitive top-left origin
                blur: CGFloat(bl), color: parseHexColor(String(parts[3]))
            )

        default:
            exitError("Unknown option: \(args[i])", code: "UNKNOWN_OPTION")
        }
        i += 1
    }
    return opts
}

func resolveUTType(for format: String) -> UTType {
    switch format {
    case "png":          return .png
    case "jpg", "jpeg":  return .jpeg
    case "heic":         return .heic
    default: exitError("Unknown format: '\(format)'. Use png, jpg, or heic.", code: "INVALID_FORMAT")
    }
}

func resolveQuality(for level: String) -> Double {
    switch level {
    case "high": return 1.0
    case "med":  return 0.6
    case "low":  return 0.3
    default: exitError("Unknown quality: '\(level)'. Use high, med, or low.", code: "INVALID_QUALITY")
    }
}

// MARK: - Known Targets

let knownTargets: Set<String> = ["main", "center", "middle", "external", "user_active", "all", "selfie"]

// MARK: - Named Zones

let zonesFilePath = NSString("~/.config/side-eye/zones.json").expandingTildeInPath

func loadZones() -> [String: ZoneEntry] {
    guard let data = FileManager.default.contents(atPath: zonesFilePath),
          let zones = try? JSONDecoder().decode([String: ZoneEntry].self, from: data)
    else { return [:] }
    return zones
}

func saveZones(_ zones: [String: ZoneEntry]) {
    let url = URL(fileURLWithPath: zonesFilePath)
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    let enc = JSONEncoder()
    enc.outputFormatting = [.prettyPrinted, .sortedKeys]
    guard let data = try? enc.encode(zones) else { exitError("Failed to encode zones", code: "ZONE_WRITE_FAILED") }
    try? data.write(to: url)
}

func zoneCommand(args: [String]) {
    guard !args.isEmpty else {
        exitError("Usage: side-eye zone <save|list|delete> [args]", code: "MISSING_SUBCOMMAND")
    }
    switch args[0] {
    case "list":
        let zones = loadZones()
        print(jsonString(zones))

    case "save":
        guard args.count >= 3 else {
            exitError("Usage: side-eye zone save <name> [--target <display>] <x,y,w,h>", code: "MISSING_ARG")
        }
        let name = args[1]
        var target = "main"
        var cropStr: String
        if args.count >= 5 && args[2] == "--target" {
            target = args[3]
            cropStr = args[4]
        } else {
            cropStr = args[2]
        }
        let parts = cropStr.split(separator: ",").compactMap { Int($0) }
        guard parts.count == 4 else { exitError("Crop must be x,y,w,h", code: "INVALID_ARG") }
        var zones = loadZones()
        zones[name] = ZoneEntry(target: target, crop: cropStr)
        saveZones(zones)
        print(jsonString(["status": "saved", "zone": name]))

    case "delete":
        guard args.count >= 2 else { exitError("Usage: side-eye zone delete <name>", code: "MISSING_ARG") }
        var zones = loadZones()
        guard zones.removeValue(forKey: args[1]) != nil else {
            exitError("Zone '\(args[1])' not found", code: "ZONE_NOT_FOUND")
        }
        saveZones(zones)
        print(jsonString(["status": "deleted", "zone": args[1]]))

    default:
        exitError("Unknown zone command: '\(args[0])'. Use save, list, or delete.", code: "UNKNOWN_SUBCOMMAND")
    }
}

// MARK: - Interactive Selection

class SelectionOverlayView: NSView {
    var startPoint: NSPoint = .zero
    var currentPoint: NSPoint = .zero
    var isDragging = false
    var onComplete: ((NSRect) -> Void)?
    var onCancel: (() -> Void)?

    override var isFlipped: Bool { true }  // top-left origin, matches image coords
    override var acceptsFirstResponder: Bool { true }

    var selectionRect: NSRect {
        let x = min(startPoint.x, currentPoint.x)
        let y = min(startPoint.y, currentPoint.y)
        return NSRect(x: x, y: y,
                      width: abs(currentPoint.x - startPoint.x),
                      height: abs(currentPoint.y - startPoint.y))
    }

    override func mouseDown(with event: NSEvent) {
        startPoint = convert(event.locationInWindow, from: nil)
        currentPoint = startPoint
        isDragging = true
        needsDisplay = true
    }

    override func mouseDragged(with event: NSEvent) {
        currentPoint = convert(event.locationInWindow, from: nil)
        needsDisplay = true
    }

    override func mouseUp(with event: NSEvent) {
        currentPoint = convert(event.locationInWindow, from: nil)
        isDragging = false
        let sel = selectionRect
        if sel.width > 5 && sel.height > 5 {
            onComplete?(sel)
        } else {
            needsDisplay = true
        }
    }

    override func keyDown(with event: NSEvent) {
        if event.keyCode == 53 { onCancel?() }  // ESC
    }

    override func draw(_ dirtyRect: NSRect) {
        let sel = selectionRect
        let dark = NSColor(calibratedWhite: 0, alpha: 0.3)

        if (isDragging || sel.width > 5) && sel.width > 0 && sel.height > 0 {
            // Draw dark overlay around selection (4 rects)
            dark.setFill()
            NSRect(x: 0, y: 0, width: bounds.width, height: sel.minY).fill()
            NSRect(x: 0, y: sel.maxY, width: bounds.width, height: bounds.height - sel.maxY).fill()
            NSRect(x: 0, y: sel.minY, width: sel.minX, height: sel.height).fill()
            NSRect(x: sel.maxX, y: sel.minY, width: bounds.width - sel.maxX, height: sel.height).fill()

            // Selection border
            NSColor.white.setStroke()
            let path = NSBezierPath(rect: sel)
            path.lineWidth = 2
            path.setLineDash([6, 4], count: 2, phase: 0)
            path.stroke()

            // Dimensions label
            let label = "\(Int(sel.width))x\(Int(sel.height))"
            let attrs: [NSAttributedString.Key: Any] = [
                .foregroundColor: NSColor.white,
                .font: NSFont.systemFont(ofSize: 14, weight: .medium)
            ]
            let size = (label as NSString).size(withAttributes: attrs)
            let labelPt = NSPoint(x: sel.midX - size.width / 2, y: sel.maxY + 6)

            NSColor(calibratedWhite: 0, alpha: 0.7).setFill()
            NSRect(x: labelPt.x - 4, y: labelPt.y - 2, width: size.width + 8, height: size.height + 4).fill()
            (label as NSString).draw(at: labelPt, withAttributes: attrs)
        } else {
            dark.setFill()
            bounds.fill()
        }
    }
}

/// Show interactive selection overlay on a display. Returns the selection rect in logical points, or nil if cancelled.
func showInteractiveSelection(on display: DisplayEntry) -> NSRect? {
    NSApp.setActivationPolicy(.accessory)

    // Find the NSScreen matching this display for correct Cocoa coordinates
    let nsScreen = NSScreen.screens.first { screen in
        (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID) == display.cgID
    }
    let windowRect = nsScreen?.frame ?? NSRect(
        x: Double(display.bounds.origin.x), y: 0,
        width: Double(display.bounds.width), height: Double(display.bounds.height)
    )

    var result: NSRect? = nil
    var done = false

    let window = NSWindow(contentRect: windowRect, styleMask: .borderless, backing: .buffered, defer: false)
    window.level = .screenSaver
    window.backgroundColor = .clear
    window.isOpaque = false
    window.hasShadow = false

    let overlay = SelectionOverlayView(frame: window.contentView!.bounds)
    overlay.autoresizingMask = [.width, .height]
    window.contentView?.addSubview(overlay)

    overlay.onComplete = { rect in result = rect; done = true }
    overlay.onCancel = { done = true }

    window.makeKeyAndOrderFront(nil)
    window.makeFirstResponder(overlay)
    NSApp.activate(ignoringOtherApps: true)

    // Pump run loop until selection completes
    while !done {
        autoreleasepool {
            _ = RunLoop.current.run(mode: .default, before: Date(timeIntervalSinceNow: 0.05))
        }
    }

    window.orderOut(nil)
    NSApp.setActivationPolicy(.prohibited)
    return result
}

// MARK: - Usage

func printUsage() {
    print("""
    side-eye — Agent-first macOS screenshot CLI

    USAGE:
      side-eye list                            Display topology as JSON
      side-eye capture <target> [options]      Take a screenshot
      side-eye <target> [options]              Shorthand for capture
      side-eye zone save <name> [--target <t>] <x,y,w,h>
      side-eye zone list                       List saved zones
      side-eye zone delete <name>              Delete a zone
      side-eye <zone-name> [options]           Capture using saved zone

    TARGETS:
      main, center, middle    Primary display
      external                First external display
      external 1              Leftmost external display
      external 2              Next external display
      user_active             Display with the focused app
      selfie                  Display hosting this process
      all                     Every connected display

    OPTIONS:
      --window                Capture only the targeted window
      --out <path>            Output path (default: ./screenshot.<format>)
      --base64                Output base64 JSON instead of writing file
      --crop <style>          Crop region (named style or x,y,w,h)
      --format <ext>          png (default), jpg, heic
      --quality <level>       high (default), med, low
      --show-cursor           Include system cursor in capture
      --highlight-cursor      Draw translucent circle at cursor position
      --interactive           Drag to select capture region
      --delay <secs>          Wait before capturing
      --clipboard             Also copy image to system clipboard
      --grid <CxR>            Draw coordinate grid (e.g., 4x3)
      --draw-rect <x,y,w,h> <#color>       Draw stroke rectangle
      --draw-rect-fill <x,y,w,h> <#color>  Draw filled rectangle
      --thickness <px>        Line width for overlays (default: 2)
      --shadow <ox,oy,blur,#color>  Drop shadow on drawn elements

    COORDINATE SYSTEM:
      All coordinates are LOCAL to the captured target.
      (0,0) = top-left of whatever you're capturing.
      Overlays (--draw-rect, --grid) use post-crop coordinates.

    CROP STYLES:
      top-half, bottom-half, left-half, right-half
      top-left, top-right, bottom-left, bottom-right, center
      x,y,w,h (exact pixel coordinates)

    COLORS:
      #RRGGBB or #RRGGBBAA (e.g., #FF0000 or #FF000080)
    """)
}

// MARK: - Command: list

@available(macOS 14.0, *)
func listCommand() {
    let displays = getDisplays()
    let activeApp = NSWorkspace.shared.frontmostApplication?.localizedName ?? "Unknown"
    let topology = TopologyJSON(
        active_app: activeApp,
        displays: displays.map {
            DisplayJSON(id: $0.ordinal, type: $0.type, resolution: $0.resolution,
                       scale_factor: $0.scaleFactor, rotation: $0.rotation, arrangement: $0.arrangement)
        }
    )
    print(jsonString(topology))
}

// MARK: - Command: capture

@available(macOS 14.0, *)
func captureCommand(args: [String]) async {
    var opts = parseCaptureArgs(args)
    let fmt = resolveUTType(for: opts.format)
    let quality = resolveQuality(for: opts.quality)

    // ── Zone resolution ──
    if !knownTargets.contains(opts.target) && !opts.target.hasPrefix("external") {
        let zones = loadZones()
        if let zone = zones[opts.target] {
            opts.target = zone.target
            if opts.crop == nil { opts.crop = zone.crop }
        }
    }

    // ── Delay ──
    if let delay = opts.delay {
        try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
    }

    // ── Get ScreenCaptureKit content ──
    let content: SCShareableContent
    do {
        content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    } catch {
        exitError(
            "Screen recording permission denied. Grant in System Settings > Privacy & Security > Screen Recording.",
            code: "PERMISSION_DENIED"
        )
    }

    let displays = getDisplays()

    // ── Resolve target ──
    var targetDisplayIDs: [CGDirectDisplayID] = []
    var specificWindow: SCWindow? = nil

    switch opts.target {
    case "main", "center", "middle":
        guard let d = displays.first(where: { $0.isMain }) else { exitError("No main display", code: "NO_DISPLAY") }
        targetDisplayIDs = [d.cgID]

    case "external":
        guard let d = displays.first(where: { !$0.isMain && !$0.isMirrored }) else {
            exitError("No external display connected", code: "NO_EXTERNAL_DISPLAY")
        }
        targetDisplayIDs = [d.cgID]

    case "external 1":
        let exts = displays.filter { !$0.isMain && !$0.isMirrored }
        guard let d = exts.first else { exitError("No external display connected", code: "NO_EXTERNAL_DISPLAY") }
        targetDisplayIDs = [d.cgID]

    case "external 2":
        let exts = displays.filter { !$0.isMain && !$0.isMirrored }
        if exts.count >= 2 { targetDisplayIDs = [exts[1].cgID] }
        else if let d = exts.first { targetDisplayIDs = [d.cgID] }
        else { exitError("No external display connected", code: "NO_EXTERNAL_DISPLAY") }

    case "user_active":
        guard let app = NSWorkspace.shared.frontmostApplication else {
            exitError("No frontmost application", code: "NO_ACTIVE_APP")
        }
        guard let w = largestWindow(for: app.processIdentifier, in: content.windows) else {
            exitError("No window for active app '\(app.localizedName ?? "?")'", code: "NO_WINDOW")
        }
        specificWindow = w
        targetDisplayIDs = [displayForWindow(w, displays: displays).cgID]

    case "selfie":
        guard let w = selfieWindow(content: content) else {
            exitError("Cannot find hosting app window", code: "SELFIE_NOT_FOUND")
        }
        specificWindow = w
        targetDisplayIDs = [displayForWindow(w, displays: displays).cgID]

    case "all":
        targetDisplayIDs = displays.filter { !$0.isMirrored }.map { $0.cgID }

    default:
        exitError("Unknown target: '\(opts.target)'", code: "UNKNOWN_TARGET")
    }

    // ── Interactive selection ──
    var interactiveBounds: BoundsJSON? = nil
    if opts.interactive {
        guard let firstID = targetDisplayIDs.first,
              let targetDisplay = displays.first(where: { $0.cgID == firstID }) else {
            exitError("Cannot determine display for interactive selection", code: "NO_DISPLAY")
        }
        guard let rect = showInteractiveSelection(on: targetDisplay) else {
            exitError("Interactive selection cancelled", code: "SELECTION_CANCELLED")
        }
        let scale = targetDisplay.scaleFactor
        let px = Int(rect.origin.x * scale)
        let py = Int(rect.origin.y * scale)
        let pw = Int(rect.width * scale)
        let ph = Int(rect.height * scale)
        opts.crop = "\(px),\(py),\(pw),\(ph)"
        interactiveBounds = BoundsJSON(x: 0, y: 0, width: pw, height: ph)  // LCS: (0,0) is selection top-left
    }

    // ── Capture loop ──
    var results: [(CGImage, String)] = []
    var responseCursor: CursorJSON? = nil

    for (idx, cgID) in targetDisplayIDs.enumerated() {
        guard let entry = displays.first(where: { $0.cgID == cgID }) else { continue }
        var image: CGImage

        // 1. Capture
        if opts.windowOnly {
            let window: SCWindow
            if let sw = specificWindow, idx == 0 {
                window = sw
            } else {
                let frontPID = NSWorkspace.shared.frontmostApplication?.processIdentifier
                guard let w = largestWindowOnDisplay(entry, in: content.windows, preferPID: frontPID) else {
                    exitError("No window on display \(entry.ordinal)", code: "NO_WINDOW")
                }
                window = w
            }
            do { image = try await captureWindow(window, scaleFactor: entry.scaleFactor, showCursor: opts.showCursor) }
            catch { exitError("Window capture failed: \(error.localizedDescription)", code: "CAPTURE_FAILED") }
        } else {
            guard let scDisplay = content.displays.first(where: { $0.displayID == cgID }) else {
                exitError("Display \(entry.ordinal) not available", code: "DISPLAY_NOT_FOUND")
            }
            do { image = try await captureDisplay(scDisplay, scaleFactor: entry.scaleFactor, showCursor: opts.showCursor) }
            catch { exitError("Display capture failed: \(error.localizedDescription)", code: "CAPTURE_FAILED") }
        }

        // 2. Cursor highlight (capture-space, before crop)
        var cursorCapPos: (x: Int, y: Int)? = nil
        if opts.highlightCursor, let pos = cursorPositionInImageSpace(display: entry) {
            cursorCapPos = pos
            let radius = 25.0 * entry.scaleFactor
            image = drawOnImage(image) { ctx, w, h in
                ctx.setFillColor(CGColor(srgbRed: 1, green: 1, blue: 0, alpha: 0.4))
                let ctxY = CGFloat(h) - CGFloat(pos.y)
                ctx.fillEllipse(in: CGRect(
                    x: CGFloat(pos.x) - radius, y: ctxY - radius,
                    width: radius * 2, height: radius * 2
                ))
            }
        }

        // 3. Crop (LCS boundary)
        var cropRect: CGRect? = nil
        if let crop = opts.crop {
            let result = applyCrop(image, style: crop)
            image = result.image
            cropRect = result.rect
        }

        // 4. Cursor position in LCS (post-crop local coordinates)
        if let capPos = cursorCapPos {
            if let cr = cropRect {
                let localX = capPos.x - Int(cr.origin.x)
                let localY = capPos.y - Int(cr.origin.y)
                if localX >= 0 && localY >= 0 && localX < Int(cr.width) && localY < Int(cr.height) {
                    responseCursor = CursorJSON(x: localX, y: localY)
                }
            } else {
                responseCursor = CursorJSON(x: capPos.x, y: capPos.y)
            }
        }

        // 5. Overlays (LCS — post-crop coordinates)
        if let grid = opts.grid {
            image = drawGrid(on: image, spec: grid, thickness: opts.thickness, shadow: opts.shadow)
        }
        if !opts.drawRects.isEmpty {
            image = drawRects(on: image, rects: opts.drawRects, thickness: opts.thickness, shadow: opts.shadow)
        }

        // 6. Output path
        let basePath = opts.resolvedOutputPath
        let path: String
        if targetDisplayIDs.count > 1 {
            let ext = (basePath as NSString).pathExtension
            let stem = (basePath as NSString).deletingPathExtension
            path = "\(stem)_\(idx + 1).\(ext)"
        } else {
            path = basePath
        }

        results.append((image, path))
    }

    // ── Clipboard ──
    if opts.clipboard, let (lastImage, _) = results.last {
        let pb = NSPasteboard.general
        pb.clearContents()
        let bitmapRep = NSBitmapImageRep(cgImage: lastImage)
        if let tiff = bitmapRep.tiffRepresentation {
            pb.setData(tiff, forType: .tiff)
        }
    }

    // ── Output ──
    if opts.useBase64 {
        var b64s: [String] = []
        for (img, _) in results {
            guard let data = encodeImage(img, format: fmt, quality: quality) else {
                exitError("Failed to encode image to \(opts.format)", code: "ENCODE_FAILED")
            }
            b64s.append(data.base64EncodedString())
        }
        var resp = SuccessResponse()
        resp.base64 = b64s
        resp.cursor = responseCursor
        resp.bounds = interactiveBounds
        print(jsonString(resp))
    } else {
        var files: [String] = []
        for (img, path) in results {
            guard writeImage(img, to: path, format: fmt, quality: quality) else {
                exitError("Failed to write image to \(path)", code: "WRITE_FAILED")
            }
            files.append(path)
        }
        var resp = SuccessResponse()
        resp.files = files
        resp.cursor = responseCursor
        resp.bounds = interactiveBounds
        print(jsonString(resp))
    }
}

// MARK: - Entry Point

@available(macOS 14.0, *)
@main
struct SideEye {
    static func main() async {
        _ = NSApplication.shared

        let args = Array(CommandLine.arguments.dropFirst())
        guard !args.isEmpty else { printUsage(); exit(0) }

        switch args[0] {
        case "list":
            listCommand()
        case "capture":
            await captureCommand(args: Array(args.dropFirst()))
        case "zone":
            zoneCommand(args: Array(args.dropFirst()))
        case "help", "--help", "-h":
            printUsage()
        default:
            if knownTargets.contains(args[0]) {
                await captureCommand(args: args)
            } else {
                // Check saved zones
                let zones = loadZones()
                if zones[args[0]] != nil {
                    await captureCommand(args: args)
                } else {
                    exitError("Unknown command or target: '\(args[0])'", code: "UNKNOWN_COMMAND")
                }
            }
        }
    }
}
