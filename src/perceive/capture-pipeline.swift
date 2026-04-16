// capture-pipeline.swift — Full capture pipeline
//
// Core screenshot pipeline: parse args → resolve target → capture →
// crop → overlay → encode → output.

import Cocoa
import ScreenCaptureKit
import UniformTypeIdentifiers
import CoreText
import ApplicationServices
import Darwin

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

final class CaptureSessionLock {
    private var fd: Int32 = -1

    init(timeout: TimeInterval = 15.0) {
        let mode = aosCurrentRuntimeMode()
        let stateDir = aosStateDir(for: mode)
        do {
            try FileManager.default.createDirectory(atPath: stateDir, withIntermediateDirectories: true)
        } catch {
            exitError("Failed to prepare capture state dir: \(error.localizedDescription)", code: "LOCK_ERROR")
        }

        let lockPath = aosCaptureLockPath(for: mode)
        let handle = open(lockPath, O_CREAT | O_RDWR, 0o644)
        guard handle >= 0 else {
            exitError("open(\(lockPath)) failed: \(errno)", code: "LOCK_ERROR")
        }

        let deadline = Date().addingTimeInterval(timeout)
        while flock(handle, LOCK_EX | LOCK_NB) != 0 {
            if errno != EWOULDBLOCK && errno != EAGAIN {
                close(handle)
                exitError("flock(\(lockPath)) failed: \(errno)", code: "LOCK_ERROR")
            }
            if Date() >= deadline {
                close(handle)
                exitError(
                    "Another \(mode.rawValue) capture is already in progress. Wait for it to finish and retry.",
                    code: "CAPTURE_BUSY"
                )
            }
            usleep(50_000)
        }

        _ = fcntl(handle, F_SETFD, FD_CLOEXEC)
        fd = handle
    }

    deinit {
        guard fd >= 0 else { return }
        _ = flock(fd, LOCK_UN)
        close(fd)
        fd = -1
    }
}

// MARK: - Internal Display Model (capture pipeline)
//
// This is the richer display model used by the capture pipeline. It carries
// fields like rotation, isMirrored, type, arrangement that the simpler
// DisplayEntry in models.swift does not have. Renamed to CaptureDisplayEntry
// to avoid collision.

struct CaptureDisplayEntry {
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

// MARK: - Color Parsing

func parseHexColor(_ hex: String) -> CGColor {
    var h = hex
    if h.hasPrefix("#") { h = String(h.dropFirst()) }
    guard h.count == 6 || h.count == 8 else {
        exitError("Invalid color '\(hex)'. Use #RRGGBB or #RRGGBBAA.", code: "INVALID_COLOR")
    }
    guard h.allSatisfy({ $0.isHexDigit }) else {
        exitError("Invalid color '\(hex)'. Contains non-hex characters.", code: "INVALID_COLOR")
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

// MARK: - Permission Checks

func checkScreenRecordingPermission() {
    if !CGPreflightScreenCaptureAccess() {
        CGRequestScreenCaptureAccess()
        exitError(
            "Screen recording permission required. A system prompt should appear. Grant access in System Settings > Privacy & Security > Screen Recording, then retry.",
            code: "PERMISSION_DENIED"
        )
    }
}

func checkAccessibilityPermission(feature: String = "this feature") {
    let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue(): true] as CFDictionary
    if !AXIsProcessTrustedWithOptions(opts) {
        exitError(
            "Accessibility permission required for \(feature). Grant in System Settings > Privacy & Security > Accessibility.",
            code: "ACCESSIBILITY_DENIED"
        )
    }
}

// MARK: - Focused Window

/// Returns the CGWindowID of the currently focused window, or nil if unavailable.
/// Uses _AXUIElementGetWindow declared in act-helpers.swift.
/// Requires Accessibility permission. Does NOT exit on failure — returns nil instead.
func getFocusedWindowID() -> CGWindowID? {
    guard AXIsProcessTrusted() else { return nil }
    guard let frontApp = NSWorkspace.shared.frontmostApplication else { return nil }

    let appElement = AXUIElementCreateApplication(frontApp.processIdentifier)
    var value: AnyObject?
    let result = AXUIElementCopyAttributeValue(appElement, kAXFocusedWindowAttribute as CFString, &value)
    guard result == .success, let rawValue = value,
          CFGetTypeID(rawValue) == AXUIElementGetTypeID() else { return nil }
    let windowElement = rawValue as! AXUIElement

    var windowID: CGWindowID = 0
    let axResult = _AXUIElementGetWindow(windowElement, &windowID)
    guard axResult == .success, windowID != 0 else { return nil }

    return windowID
}

// MARK: - Coordinate Mapper (Global CG → LCS)

/// Translates global macOS screen coordinates into the Local Coordinate System
/// of a captured target (display, window, or cropped region).
struct CoordinateMapper {
    let displayOrigin: CGPoint   // CG top-left origin of the target display
    let scaleFactor: Double
    let cropRect: CGRect?        // In pixel coords (post-scale), nil = no crop
    let windowFrame: CGRect?     // CG global frame of window (nil = full display capture)

    /// The base origin for coordinate translation (window origin if window capture, else display origin).
    private var baseOrigin: CGPoint { windowFrame?.origin ?? displayOrigin }

    /// Convert a global CG screen point to LCS pixel coordinates.
    /// Returns nil if the point falls outside the capture area.
    func toLCS(globalPoint pt: CGPoint) -> (x: Int, y: Int)? {
        var px = Int((pt.x - baseOrigin.x) * scaleFactor)
        var py = Int((pt.y - baseOrigin.y) * scaleFactor)

        if let crop = cropRect {
            px -= Int(crop.origin.x)
            py -= Int(crop.origin.y)
            guard px >= 0 && py >= 0 && px < Int(crop.width) && py < Int(crop.height) else { return nil }
        }
        return (px, py)
    }

    /// Convert a global CG screen rect to LCS pixel rect.
    /// Returns nil if the rect doesn't intersect the capture area.
    func toLCS(globalRect rect: CGRect, imageSize: CGSize) -> CGRect? {
        let lcsX = (rect.origin.x - baseOrigin.x) * scaleFactor
        let lcsY = (rect.origin.y - baseOrigin.y) * scaleFactor
        let lcsW = rect.width * scaleFactor
        let lcsH = rect.height * scaleFactor

        var lcsRect = CGRect(x: lcsX, y: lcsY, width: lcsW, height: lcsH)

        if let crop = cropRect {
            lcsRect = lcsRect.offsetBy(dx: -crop.origin.x, dy: -crop.origin.y)
        }

        let captureRect = CGRect(origin: .zero, size: imageSize)
        guard lcsRect.intersects(captureRect) else { return nil }
        return lcsRect.intersection(captureRect)
    }
}

// MARK: - Display Enumeration (capture pipeline)

func getCaptureDisplays() -> [CaptureDisplayEntry] {
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

        return CaptureDisplayEntry(
            ordinal: i + 1, cgID: did, bounds: b,
            scaleFactor: scaleMap[did] ?? 1.0,
            rotation: Double(CGDisplayRotation(did)),
            isMain: isMain, isMirrored: isMirror,
            type: type, arrangement: arr,
            resolution: "\(Int(b.width))x\(Int(b.height))"
        )
    }
}

func displayForWindow(_ window: SCWindow, displays: [CaptureDisplayEntry]) -> CaptureDisplayEntry {
    let pt = CGPoint(x: window.frame.midX, y: window.frame.midY)
    return displays.first(where: { $0.bounds.contains(pt) }) ?? displays.first(where: { $0.isMain })!
}

/// Resolve a target string to a display entry.
func resolveDisplayTarget(_ target: String, displays: [CaptureDisplayEntry]) -> CaptureDisplayEntry? {
    switch target {
    case "main", "center", "middle":
        return displays.first(where: { $0.isMain })
    case "external":
        return displays.first(where: { !$0.isMain && !$0.isMirrored })
    case "external 1":
        return displays.filter({ !$0.isMain && !$0.isMirrored }).first
    case "external 2":
        let exts = displays.filter({ !$0.isMain && !$0.isMirrored })
        return exts.count >= 2 ? exts[1] : exts.first
    default:
        return displays.first(where: { $0.isMain })
    }
}

/// Find the display containing the current mouse cursor.
func displayForMouse(displays: [CaptureDisplayEntry]) -> CaptureDisplayEntry? {
    let pt = mouseInCGCoords()
    return displays.first(where: { $0.bounds.contains(pt) }) ?? displays.first(where: { $0.isMain })
}

func largestWindow(for pid: pid_t, in windows: [SCWindow]) -> SCWindow? {
    windows
        .filter { $0.owningApplication?.processID == pid && $0.windowLayer == 0 && $0.frame.width > 0 }
        .max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height })
}

func largestWindowOnDisplay(_ entry: CaptureDisplayEntry, in windows: [SCWindow], preferPID: pid_t? = nil) -> SCWindow? {
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

func parseGlobalRect(_ spec: String, label: String = "--region") -> CGRect {
    let parts = spec.split(separator: ",").compactMap { Double($0) }
    guard parts.count == 4 else {
        exitError("\(label) must be x,y,w,h", code: "INVALID_ARG")
    }
    let rect = CGRect(x: parts[0], y: parts[1], width: parts[2], height: parts[3])
    guard rect.width > 0, rect.height > 0 else {
        exitError("\(label) width and height must be positive", code: "INVALID_ARG")
    }
    return rect.integral
}

struct CaptureSurfaceSelection {
    let kind: String
    let id: String?
    let globalBounds: CGRect
    let windowID: Int?
    let segments: [CaptureSurfaceSegmentSelection]
}

struct CaptureSurfaceSegmentSelection {
    let display: CaptureDisplayEntry
    let globalBounds: CGRect
}

func stBounds(_ rect: CGRect) -> STBounds {
    STBounds(x: rect.origin.x, y: rect.origin.y, width: rect.width, height: rect.height)
}

func resolveSurfaceSegments(_ region: CGRect, displays: [CaptureDisplayEntry]) -> [CaptureSurfaceSegmentSelection] {
    let active = displays.filter { !$0.isMirrored }
    let segments = active.compactMap { display -> CaptureSurfaceSegmentSelection? in
        let intersection = region.intersection(display.bounds)
        guard !intersection.isNull, intersection.width > 0, intersection.height > 0 else { return nil }
        return CaptureSurfaceSegmentSelection(display: display, globalBounds: intersection.integral)
    }
    guard !segments.isEmpty else {
        exitError("Region \(NSStringFromRect(region)) does not intersect any active display.", code: "NO_DISPLAY")
    }
    return segments.sorted {
        if $0.globalBounds.minY == $1.globalBounds.minY {
            return $0.globalBounds.minX < $1.globalBounds.minX
        }
        return $0.globalBounds.minY < $1.globalBounds.minY
    }
}

func capturePixelRect(globalRect: CGRect, in display: CaptureDisplayEntry) -> CGRect {
    CGRect(
        x: (globalRect.origin.x - display.bounds.origin.x) * display.scaleFactor,
        y: (globalRect.origin.y - display.bounds.origin.y) * display.scaleFactor,
        width: globalRect.width * display.scaleFactor,
        height: globalRect.height * display.scaleFactor
    ).integral
}

func captureLocalRect(globalRect: CGRect, within captureBounds: CGRect, scaleFactor: Double) -> CGRect {
    CGRect(
        x: (globalRect.origin.x - captureBounds.origin.x) * scaleFactor,
        y: (globalRect.origin.y - captureBounds.origin.y) * scaleFactor,
        width: globalRect.width * scaleFactor,
        height: globalRect.height * scaleFactor
    ).integral
}

func globalCaptureRect(display: CaptureDisplayEntry, windowFrame: CGRect?, cropRect: CGRect?) -> CGRect {
    let base = windowFrame ?? display.bounds
    guard let crop = cropRect else { return base }
    return CGRect(
        x: base.origin.x + crop.origin.x / display.scaleFactor,
        y: base.origin.y + crop.origin.y / display.scaleFactor,
        width: crop.width / display.scaleFactor,
        height: crop.height / display.scaleFactor
    )
}

func localCursorInCapture(topology: SpatialTopology, captureRect: CGRect, scaleFactor: Double) -> CursorJSON? {
    let point = CGPoint(x: topology.cursor.x, y: topology.cursor.y)
    guard captureRect.contains(point) else { return nil }
    return CursorJSON(
        x: Int((point.x - captureRect.origin.x) * scaleFactor),
        y: Int((point.y - captureRect.origin.y) * scaleFactor)
    )
}

func capturePerceptionSnapshot(
    topology: SpatialTopology,
    captureRect: CGRect,
    imageSize: CGSize,
    scaleFactor: Double,
    segments: [CaptureSurfaceSegmentJSON]
) -> CapturePerceptionJSON {
    CapturePerceptionJSON(
        capture_bounds_global: stBounds(captureRect),
        capture_bounds_local: BoundsJSON(x: 0, y: 0, width: Int(imageSize.width), height: Int(imageSize.height)),
        capture_scale_factor: scaleFactor,
        cursor_local: localCursorInCapture(topology: topology, captureRect: captureRect, scaleFactor: scaleFactor),
        segments: segments,
        topology: topology
    )
}

func captureSurfaceSegmentJSON(
    segment: CaptureSurfaceSegmentSelection,
    captureBounds: CGRect,
    scaleFactor: Double
) -> CaptureSurfaceSegmentJSON {
    let localBounds = captureLocalRect(globalRect: segment.globalBounds, within: captureBounds, scaleFactor: scaleFactor)
    return CaptureSurfaceSegmentJSON(
        display: segment.display.ordinal,
        scale_factor: segment.display.scaleFactor,
        bounds_global: stBounds(segment.globalBounds),
        bounds_local: BoundsJSON(
            x: Int(localBounds.origin.x),
            y: Int(localBounds.origin.y),
            width: Int(localBounds.width),
            height: Int(localBounds.height)
        )
    )
}

func captureSurfaceJSON(
    selection: CaptureSurfaceSelection,
    imageSize: CGSize,
    scaleFactor: Double
) -> CaptureSurfaceJSON {
    let segments = selection.segments.map {
        captureSurfaceSegmentJSON(segment: $0, captureBounds: selection.globalBounds, scaleFactor: scaleFactor)
    }
    let displays = segments.map(\.display)
    return CaptureSurfaceJSON(
        kind: selection.kind,
        id: selection.id,
        display: displays.count == 1 ? displays[0] : nil,
        displays: displays,
        scale_factor: segments.count == 1 ? segments[0].scale_factor : nil,
        capture_scale_factor: scaleFactor,
        window_id: selection.windowID,
        bounds_global: stBounds(selection.globalBounds),
        bounds_local: BoundsJSON(x: 0, y: 0, width: Int(imageSize.width), height: Int(imageSize.height)),
        segments: segments
    )
}

func decodeCanvasResponse(_ response: [String: Any]) -> CanvasResponse? {
    guard JSONSerialization.isValidJSONObject(response),
          let data = try? JSONSerialization.data(withJSONObject: response, options: []) else { return nil }
    return CanvasResponse.from(data)
}

func readCanvasInfo(id: String) -> CanvasInfo? {
    guard let response = daemonOneShot(["action": "list"], autoStartBinary: aosExecutablePath()),
          let decoded = decodeCanvasResponse(response),
          decoded.error == nil,
          let canvases = decoded.canvases else { return nil }
    return canvases.first(where: { $0.id == id })
}

func resolveCaptureSurface(opts: CaptureOptions, displays: [CaptureDisplayEntry]) -> CaptureSurfaceSelection? {
    if let canvasID = opts.canvasID {
        guard let canvas = readCanvasInfo(id: canvasID) else {
            exitError("Canvas '\(canvasID)' not found", code: "CANVAS_NOT_FOUND")
        }
        let bounds = CGRect(x: canvas.at[0], y: canvas.at[1], width: canvas.at[2], height: canvas.at[3]).integral
        return CaptureSurfaceSelection(
            kind: "canvas",
            id: canvasID,
            globalBounds: bounds,
            windowID: nil,
            segments: resolveSurfaceSegments(bounds, displays: displays)
        )
    }
    if let channelID = opts.channelID {
        guard let channel = readChannelFile(id: channelID) else {
            exitError("Channel '\(channelID)' not found", code: "CHANNEL_NOT_FOUND")
        }
        if isChannelStale(channel) {
            exitError("Channel '\(channelID)' is stale (>10s since last update)", code: "CHANNEL_STALE")
        }
        let wb = channel.window_bounds
        let bounds = CGRect(x: wb.x, y: wb.y, width: wb.w, height: wb.h).integral
        return CaptureSurfaceSelection(
            kind: "channel",
            id: channelID,
            globalBounds: bounds,
            windowID: channel.target.window_id,
            segments: resolveSurfaceSegments(bounds, displays: displays)
        )
    }
    if let regionSpec = opts.region {
        let region = parseGlobalRect(regionSpec)
        return CaptureSurfaceSelection(
            kind: "region",
            id: nil,
            globalBounds: region,
            windowID: nil,
            segments: resolveSurfaceSegments(region, displays: displays)
        )
    }
    return nil
}

// MARK: - Cursor Position

func cursorPositionInImageSpace(display: CaptureDisplayEntry) -> (x: Int, y: Int)? {
    let pt = mouseInCGCoords()
    guard display.bounds.contains(pt) else { return nil }
    let relX = pt.x - display.bounds.origin.x
    let relY = pt.y - display.bounds.origin.y
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

        for c in 1..<spec.cols {
            let x = CGFloat(c) * colW
            ctx.move(to: CGPoint(x: x, y: 0))
            ctx.addLine(to: CGPoint(x: x, y: CGFloat(h)))
        }
        for r in 1..<spec.rows {
            let y = CGFloat(r) * rowH
            ctx.move(to: CGPoint(x: 0, y: y))
            ctx.addLine(to: CGPoint(x: CGFloat(w), y: y))
        }
        ctx.strokePath()

        ctx.setShadow(offset: .zero, blur: 0)
        let fontSize = max(12.0, min(24.0, CGFloat(min(w, h)) / 80.0))
        let font = CTFontCreateWithName("Helvetica" as CFString, fontSize, nil)

        for c in 0...spec.cols {
            let px = Int(CGFloat(c) * colW)
            drawLabel(ctx: ctx, text: "\(px)",
                     at: CGPoint(x: CGFloat(px) + 2, y: CGFloat(h) - fontSize - 4), font: font)
        }
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
            label: [el.title, el.label].compactMap { $0?.isEmpty == false ? $0 : nil }.first
        )
    }
}

/// Generate HTML/SVG for numbered badge overlays.
func generateBadgeHTML(annotations: [AnnotationJSON], width: Int, height: Int, scaleFactor: Double) -> String {
    let r = 10.0  // badge radius in pixels
    var badges = ""
    for (i, ann) in annotations.enumerated() {
        let num = i + 1
        let px = ann.bounds.x * scaleFactor
        let py = ann.bounds.y * scaleFactor
        let cx = max(r, min(Double(width) - r, px))
        let cy = max(r, min(Double(height) - r, py))
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

/// Resolve this binary's path for invoking `aos show render` as a subprocess.
func findRenderBinary() -> String? {
    let resolvedSelf = (CommandLine.arguments[0] as NSString).resolvingSymlinksInPath
    return FileManager.default.isExecutableFile(atPath: resolvedSelf) ? resolvedSelf : nil
}

/// Shell out to `aos show render` to rasterize HTML to a transparent PNG for --label compositing.
func renderHTMLToBitmap(html: String, width: Int, height: Int) -> CGImage? {
    guard let binaryPath = findRenderBinary() else { return nil }

    let tempPath = NSTemporaryDirectory() + "aos-overlay-\(ProcessInfo.processInfo.processIdentifier).png"
    defer { try? FileManager.default.removeItem(atPath: tempPath) }

    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: binaryPath)
    proc.arguments = ["show", "render", "--width", "\(width)", "--height", "\(height)", "--out", tempPath]

    let inPipe = Pipe()
    proc.standardInput = inPipe
    proc.standardOutput = FileHandle.nullDevice
    proc.standardError = Pipe()  // suppress stderr

    do { try proc.run() } catch { return nil }
    inPipe.fileHandleForWriting.write(html.data(using: .utf8)!)
    inPipe.fileHandleForWriting.closeFile()
    proc.waitUntilExit()
    guard proc.terminationStatus == 0 else { return nil }

    guard let provider = CGDataProvider(filename: tempPath),
          let image = CGImage(pngDataProviderSource: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)
    else { return nil }

    return image
}

/// Composite a transparent overlay image on top of a base image.
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

func cropImage(_ image: CGImage, to rect: CGRect) -> CGImage {
    let integral = rect.integral
    guard let cropped = image.cropping(to: integral) else {
        exitError("Crop region is outside image bounds", code: "CROP_FAILED")
    }
    return cropped
}

struct CapturedSurfaceSegment {
    let segment: CaptureSurfaceSegmentSelection
    let image: CGImage
    let localRect: CGRect
}

func stitchSurfaceSegments(
    _ segments: [CapturedSurfaceSegment],
    canvasSize: CGSize
) -> CGImage {
    let width = Int(canvasSize.width)
    let height = Int(canvasSize.height)
    guard let ctx = CGContext(
        data: nil,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else {
        exitError("Failed to create stitched capture context", code: "CAPTURE_FAILED")
    }

    ctx.clear(CGRect(x: 0, y: 0, width: width, height: height))
    for segment in segments {
        let rect = segment.localRect
        let drawRect = CGRect(
            x: rect.origin.x,
            y: canvasSize.height - rect.origin.y - rect.height,
            width: rect.width,
            height: rect.height
        )
        ctx.draw(segment.image, in: drawRect)
    }
    return ctx.makeImage() ?? segments[0].image
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
    var region: String? = nil
    var canvasID: String? = nil
    var channelID: String? = nil
    var format: String = "png"
    var quality: String = "high"
    var perception: Bool = false

    // Cursor
    var showCursor: Bool = false
    var highlightCursorColor: String? = nil

    // Mouse target
    var radius: Int? = nil

    // Interactive
    var interactive: Bool = false

    // Wait for click
    var waitForClick: Bool = false

    // Xray (accessibility traversal)
    var xray: Bool = false

    // Label (badge annotations; implies xray)
    var label: Bool = false

    // Timeout for interactive flags (seconds)
    var timeout: Double = 60.0

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
        case "--region":
            i += 1
            guard i < args.count else { exitError("--region requires x,y,w,h in global CG points", code: "MISSING_ARG") }
            opts.region = args[i]
        case "--canvas":
            i += 1
            guard i < args.count else { exitError("--canvas requires a canvas id", code: "MISSING_ARG") }
            opts.canvasID = args[i]
        case "--channel":
            i += 1
            guard i < args.count else { exitError("--channel requires a focus channel id", code: "MISSING_ARG") }
            opts.channelID = args[i]
        case "--format":
            i += 1
            guard i < args.count else { exitError("--format requires a value", code: "MISSING_ARG") }
            opts.format = args[i].lowercased()
        case "--quality":
            i += 1
            guard i < args.count else { exitError("--quality requires a value", code: "MISSING_ARG") }
            opts.quality = args[i].lowercased()
        case "--perception":
            opts.perception = true

        // Cursor
        case "--show-cursor":
            opts.showCursor = true
        case "--highlight-cursor":
            if i + 1 < args.count && args[i + 1].hasPrefix("#") {
                i += 1
                opts.highlightCursorColor = args[i]
            } else {
                opts.highlightCursorColor = "#FFFF0066"
            }

        // Mouse radius
        case "--radius":
            i += 1
            guard i < args.count else { exitError("--radius requires a pixel value", code: "MISSING_ARG") }
            guard let r = Int(args[i]), r > 0 else {
                exitError("--radius must be a positive integer", code: "INVALID_ARG")
            }
            opts.radius = r

        // Interactive
        case "--interactive":
            opts.interactive = true

        // Wait for click
        case "--wait-for-click":
            opts.waitForClick = true

        // Xray (accessibility traversal)
        case "--xray":
            opts.xray = true

        // Label (badge annotations; implies --xray)
        case "--label":
            opts.label = true
            opts.xray = true

        // Timeout
        case "--timeout":
            i += 1
            guard i < args.count else { exitError("--timeout requires seconds", code: "MISSING_ARG") }
            guard let t = Double(args[i]), t > 0 else {
                exitError("--timeout must be a positive number", code: "INVALID_ARG")
            }
            opts.timeout = t

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

        // Draw rects
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
                offsetX: CGFloat(ox), offsetY: CGFloat(-oy),
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

/// Capture targets that can be used as bare subcommands (aos see main, etc.)
let captureTargets: Set<String> = ["main", "center", "middle", "external", "user_active", "all", "selfie", "mouse"]

// MARK: - Named Zones

let zonesFilePath = (aosStateDir() as NSString).appendingPathComponent("zones.json")

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
        exitError("zone requires a subcommand. Usage: aos see zone <list|save|define|remove> ...",
                  code: "MISSING_SUBCOMMAND")
    }
    switch args[0] {
    case "list":
        let zones = loadZones()
        print(jsonString(zones))

    case "save":
        guard args.count >= 3 else {
            exitError("zone save requires <name> and <bounds>. Usage: aos see zone save <name> <x,y,w,h> [--target <d>]",
                      code: "MISSING_ARG")
        }
        let name = args[1]
        var target = "main"
        var cropStr: String? = nil
        var j = 2
        while j < args.count {
            if args[j] == "--target" && j + 1 < args.count {
                target = args[j + 1]; j += 2
            } else if args[j] == "--bounds" && j + 1 < args.count {
                cropStr = args[j + 1]; j += 2
            } else {
                cropStr = args[j]; j += 1
            }
        }
        guard let crop = cropStr else { exitError("Missing bounds. Provide x,y,w,h.", code: "MISSING_ARG") }
        let parts = crop.split(separator: ",").compactMap { Int($0) }
        guard parts.count == 4 else { exitError("Bounds must be x,y,w,h", code: "INVALID_ARG") }
        var zones = loadZones()
        zones[name] = ZoneEntry(target: target, crop: crop)
        saveZones(zones)
        print(jsonString(["status": "saved", "zone": name]))

    case "define":
        guard args.count >= 2 else {
            exitError("zone define requires <name>. Usage: aos see zone define <name> [--target <display>]",
                      code: "MISSING_ARG")
        }
        let name = args[1]
        var target = "main"
        if args.count >= 4 && args[2] == "--target" { target = args[3] }

        let displays = getCaptureDisplays()
        guard let targetDisplay = resolveDisplayTarget(target, displays: displays) else {
            exitError("Cannot resolve display '\(target)'", code: "NO_DISPLAY")
        }

        if let rect = showInteractiveSelection(on: targetDisplay, timeout: 120) {
            let scale = targetDisplay.scaleFactor
            let cropStr = "\(Int(rect.origin.x * scale)),\(Int(rect.origin.y * scale)),\(Int(rect.width * scale)),\(Int(rect.height * scale))"
            var zones = loadZones()
            zones[name] = ZoneEntry(target: target, crop: cropStr)
            saveZones(zones)
            print(jsonString(["status": "saved", "zone": name, "bounds": cropStr]))
        } else {
            exitError(
                "Interactive overlay timed out (window could not acquire focus). "
                + "Use 'aos see zone save \(name) --target \(target) --bounds x,y,w,h' instead, "
                + "or run 'aos see capture \(target) --interactive --grid 10x10' to identify coordinates visually.",
                code: "INTERACTIVE_UNAVAILABLE"
            )
        }

    case "delete":
        guard args.count >= 2 else {
            exitError("zone delete requires <name>. Usage: aos see zone delete <name>",
                      code: "MISSING_ARG")
        }
        var zones = loadZones()
        guard zones.removeValue(forKey: args[1]) != nil else {
            exitError("Zone '\(args[1])' not found", code: "ZONE_NOT_FOUND")
        }
        saveZones(zones)
        print(jsonString(["status": "deleted", "zone": args[1]]))

    default:
        exitError("Unknown zone command: '\(args[0])'. Use save, define, list, or delete.", code: "UNKNOWN_SUBCOMMAND")
    }
}

// MARK: - Wait For Click

/// Block until a global left-click occurs. Returns click position in CG screen coords (top-left origin).
func waitForGlobalClick(timeout: Double) -> CGPoint {
    if !Thread.isMainThread {
        var result: CGPoint = .zero
        DispatchQueue.main.sync { result = waitForGlobalClick(timeout: timeout) }
        return result
    }

    var clickPoint: CGPoint? = nil
    var done = false
    let deadline = Date(timeIntervalSinceNow: timeout)

    let monitor = NSEvent.addGlobalMonitorForEvents(matching: .leftMouseDown) { _ in
        clickPoint = mouseInCGCoords()
        done = true
    }

    while !done && Date() < deadline {
        autoreleasepool {
            _ = RunLoop.current.run(mode: .default, before: Date(timeIntervalSinceNow: 0.05))
        }
    }

    if let m = monitor { NSEvent.removeMonitor(m) }

    guard done, let pt = clickPoint else {
        exitError("Timed out waiting for click (\(Int(timeout))s)", code: "TIMEOUT")
    }
    return pt
}

// MARK: - Interactive Selection

/// Borderless windows can't become key by default. Override to allow event delivery.
class KeyableWindow: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

class SelectionOverlayView: NSView {
    var startPoint: NSPoint = .zero
    var currentPoint: NSPoint = .zero
    var isDragging = false
    var onComplete: ((NSRect) -> Void)?
    var onCancel: (() -> Void)?

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

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
        if sel.width > 5 && sel.height > 5 { onComplete?(sel) }
        else { needsDisplay = true }
    }

    override func keyDown(with event: NSEvent) {
        if event.keyCode == 53 { onCancel?() }
    }

    override func draw(_ dirtyRect: NSRect) {
        let sel = selectionRect
        let dark = NSColor(calibratedWhite: 0, alpha: 0.3)

        if (isDragging || sel.width > 5) && sel.width > 0 && sel.height > 0 {
            dark.setFill()
            NSRect(x: 0, y: 0, width: bounds.width, height: sel.minY).fill()
            NSRect(x: 0, y: sel.maxY, width: bounds.width, height: bounds.height - sel.maxY).fill()
            NSRect(x: 0, y: sel.minY, width: sel.minX, height: sel.height).fill()
            NSRect(x: sel.maxX, y: sel.minY, width: bounds.width - sel.maxX, height: sel.height).fill()

            NSColor.white.setStroke()
            let path = NSBezierPath(rect: sel)
            path.lineWidth = 2
            path.setLineDash([6, 4], count: 2, phase: 0)
            path.stroke()

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

func showInteractiveSelection(on display: CaptureDisplayEntry, timeout: Double = 60) -> NSRect? {
    if !Thread.isMainThread {
        var result: NSRect? = nil
        DispatchQueue.main.sync { result = showInteractiveSelection(on: display, timeout: timeout) }
        return result
    }
    NSApp.setActivationPolicy(.regular)

    let nsScreen = NSScreen.screens.first { screen in
        (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID) == display.cgID
    }
    let windowRect = nsScreen?.frame ?? NSRect(
        x: Double(display.bounds.origin.x), y: 0,
        width: Double(display.bounds.width), height: Double(display.bounds.height)
    )

    var result: NSRect? = nil
    var done = false
    let deadline = Date(timeIntervalSinceNow: timeout)

    let window = KeyableWindow(contentRect: windowRect, styleMask: .borderless, backing: .buffered, defer: false)
    window.level = .screenSaver
    window.backgroundColor = NSColor(calibratedWhite: 0, alpha: 0.3)
    window.isOpaque = false
    window.hasShadow = false
    window.ignoresMouseEvents = false
    window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]

    let overlay = SelectionOverlayView(frame: window.contentView!.bounds)
    overlay.autoresizingMask = [.width, .height]
    overlay.wantsLayer = true
    window.contentView?.addSubview(overlay)

    overlay.onComplete = { rect in result = rect; done = true }
    overlay.onCancel = { done = true }

    window.orderFrontRegardless()
    window.makeKey()
    window.makeFirstResponder(overlay)
    NSRunningApplication.current.activate(options: [.activateAllWindows])

    overlay.needsDisplay = true
    RunLoop.current.run(mode: .default, before: Date(timeIntervalSinceNow: 0.1))
    NSCursor.crosshair.push()

    while !done && Date() < deadline {
        autoreleasepool {
            _ = RunLoop.current.run(mode: .default, before: Date(timeIntervalSinceNow: 0.05))
        }
    }

    NSCursor.pop()
    window.orderOut(nil)
    NSApp.setActivationPolicy(.prohibited)
    return done ? result : nil
}

// MARK: - Command: list (spatial topology)

@available(macOS 14.0, *)
func buildSpatialTopology() -> SpatialTopology {
    let displays = getCaptureDisplays()

    // Build window list using CGWindowList directly.

    let windowInfoList = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []

    // App lookup
    var appLookup: [pid_t: (name: String, bundleId: String?, isHidden: Bool)] = [:]
    for app in NSWorkspace.shared.runningApplications where app.activationPolicy == .regular {
        appLookup[app.processIdentifier] = (
            name: app.localizedName ?? "Unknown",
            bundleId: app.bundleIdentifier,
            isHidden: app.isHidden
        )
    }

    // Focused app + window
    let frontApp = NSWorkspace.shared.frontmostApplication
    let focusedWinID = getFocusedWindowID()

    let focusedApp: STFocusedApp? = frontApp.map {
        STFocusedApp(pid: Int($0.processIdentifier), name: $0.localizedName ?? "Unknown", bundle_id: $0.bundleIdentifier)
    }

    // Cursor
    let cursorPt = mouseInCGCoords()
    let cursorDisplay = displays.first(where: { $0.bounds.contains(cursorPt) }) ?? displays.first(where: { $0.isMain })!
    let stCursor = STCursor(x: cursorPt.x, y: cursorPt.y, display: cursorDisplay.ordinal)

    // NSScreen map
    var screenMap: [CGDirectDisplayID: NSScreen] = [:]
    for screen in NSScreen.screens {
        if let n = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID {
            screenMap[n] = screen
        }
    }

    // Windows — assign to displays
    var windowsByDisplay: [CGDirectDisplayID: [STWindow]] = [:]
    for d in displays { windowsByDisplay[d.cgID] = [] }

    var appWindows: [pid_t: [Int]] = [:]
    var appNames: [pid_t: (name: String, bundleId: String?)] = [:]

    for info in windowInfoList {
        guard let isOnScreen = info[kCGWindowIsOnscreen as String] as? Bool, isOnScreen else { continue }
        guard let boundsDict = info[kCGWindowBounds as String] as? [String: Any],
              let rect = CGRect(dictionaryRepresentation: boundsDict as CFDictionary) else { continue }
        guard rect.width > 0 && rect.height > 0 else { continue }
        let ownerName = info[kCGWindowOwnerName as String] as? String ?? ""
        guard ownerName != "Window Server" else { continue }

        let windowID = info[kCGWindowNumber as String] as? Int ?? 0
        let pid = info[kCGWindowOwnerPID as String] as? pid_t ?? 0
        let title = info[kCGWindowName as String] as? String
        let layer = info[kCGWindowLayer as String] as? Int ?? 0
        let alpha = info[kCGWindowAlpha as String] as? Double ?? 1.0
        let bundleID = appLookup[pid]?.bundleId

        let center = CGPoint(x: rect.midX, y: rect.midY)
        let targetDisplay = displays.first(where: { $0.bounds.contains(center) }) ?? displays.first(where: { $0.isMain })!

        let stWindow = STWindow(
            window_id: windowID,
            title: title,
            app_pid: Int(pid),
            app_name: ownerName,
            bundle_id: bundleID,
            bounds: STBounds(x: rect.origin.x, y: rect.origin.y, width: rect.width, height: rect.height),
            is_focused: focusedWinID != nil && windowID == Int(focusedWinID!),
            is_on_screen: true,
            layer: layer,
            alpha: alpha
        )
        windowsByDisplay[targetDisplay.cgID, default: []].append(stWindow)

        appWindows[pid, default: []].append(windowID)
        if appNames[pid] == nil {
            appNames[pid] = (name: ownerName, bundleId: bundleID)
        }
    }

    // Build STDisplay array
    let stDisplays: [STDisplay] = displays.map { d in
        let uuid: String? = {
            guard let unmanaged = CGDisplayCreateUUIDFromDisplayID(d.cgID) else { return nil }
            let cfUUID = unmanaged.takeRetainedValue()
            return CFUUIDCreateString(nil, cfUUID) as String
        }()

        let label: String = screenMap[d.cgID]?.localizedName ?? "Display \(d.ordinal)"

        let visibleBounds: STBounds = {
            guard let screen = screenMap[d.cgID] else {
                return STBounds(x: d.bounds.origin.x, y: d.bounds.origin.y,
                                width: d.bounds.width, height: d.bounds.height)
            }
            let sf = screen.frame
            let vf = screen.visibleFrame
            let localX = vf.origin.x - sf.origin.x
            let localY = sf.height - (vf.origin.y - sf.origin.y) - vf.height
            return STBounds(
                x: d.bounds.origin.x + localX,
                y: d.bounds.origin.y + localY,
                width: vf.width,
                height: vf.height
            )
        }()

        return STDisplay(
            display_id: Int(d.cgID),
            display_uuid: uuid,
            ordinal: d.ordinal,
            label: label,
            is_main: d.isMain,
            bounds: STBounds(x: d.bounds.origin.x, y: d.bounds.origin.y,
                             width: d.bounds.width, height: d.bounds.height),
            visible_bounds: visibleBounds,
            scale_factor: d.scaleFactor,
            rotation: d.rotation,
            windows: windowsByDisplay[d.cgID] ?? []
        )
    }

    // Build apps
    let activePID = frontApp?.processIdentifier ?? -1
    let stApps: [STApp] = appWindows.keys.sorted(by: {
        (appNames[$0]?.name ?? "") < (appNames[$1]?.name ?? "")
    }).map { pid in
        STApp(
            pid: Int(pid),
            name: appNames[pid]?.name ?? "Unknown",
            bundle_id: appNames[pid]?.bundleId,
            is_active: pid == activePID,
            is_hidden: appLookup[pid]?.isHidden ?? false,
            window_ids: appWindows[pid] ?? []
        )
    }

    let iso8601 = ISO8601DateFormatter()
    iso8601.formatOptions = [.withInternetDateTime]

    let topology = SpatialTopology(
        schema: "spatial-topology",
        version: "0.1.0",
        timestamp: iso8601.string(from: Date()),
        screens_have_separate_spaces: NSScreen.screensHaveSeparateSpaces,
        cursor: stCursor,
        focused_window_id: focusedWinID.map { Int($0) },
        focused_app: focusedApp,
        displays: stDisplays,
        apps: stApps
    )
    return topology
}

@available(macOS 14.0, *)
func seeListCommand() {
    print(jsonString(buildSpatialTopology()))
}

// MARK: - Command: cursor (capture pipeline version)

@available(macOS 14.0, *)
func seeCursorCommand() {
    let cursorPt = mouseInCGCoords()

    let displays = getCaptureDisplays()
    let display = displays.first(where: { $0.bounds.contains(cursorPt) }) ?? displays.first(where: { $0.isMain })!

    let windowInfoList = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []

    var appLookup: [pid_t: String?] = [:]
    for app in NSWorkspace.shared.runningApplications where app.activationPolicy == .regular {
        appLookup[app.processIdentifier] = app.bundleIdentifier
    }

    var matchedWindow: CursorWindowJSON? = nil
    var matchedPID: pid_t? = nil
    for info in windowInfoList {
        guard let boundsDict = info[kCGWindowBounds as String] as? [String: Any],
              let rect = CGRect(dictionaryRepresentation: boundsDict as CFDictionary) else { continue }
        guard rect.contains(cursorPt) else { continue }
        let layer = info[kCGWindowLayer as String] as? Int ?? 0
        guard layer == 0 else { continue }
        let alpha = info[kCGWindowAlpha as String] as? Double ?? 1.0
        guard alpha > 0 else { continue }
        let ownerName = info[kCGWindowOwnerName as String] as? String ?? ""
        guard ownerName != "Window Server" else { continue }

        let windowID = info[kCGWindowNumber as String] as? Int ?? 0
        let pid = info[kCGWindowOwnerPID as String] as? pid_t ?? 0
        let title = info[kCGWindowName as String] as? String

        matchedWindow = CursorWindowJSON(
            window_id: windowID,
            title: title,
            app_name: ownerName,
            app_pid: Int(pid),
            bundle_id: appLookup[pid] ?? nil,
            bounds: STBounds(x: rect.origin.x, y: rect.origin.y,
                             width: rect.width, height: rect.height)
        )
        matchedPID = pid
        break
    }

    var matchedElement: CursorElementJSON? = nil
    if let pid = matchedPID, AXIsProcessTrusted() {
        let axApp = AXUIElementCreateApplication(pid)
        var elementRef: AXUIElement?
        let axResult = AXUIElementCopyElementAtPosition(axApp, Float(cursorPt.x), Float(cursorPt.y), &elementRef)
        if axResult == .success, let el = elementRef {
            let role = axString(el, kAXRoleAttribute) ?? "unknown"
            let title = axString(el, kAXTitleAttribute)
            let label = axString(el, kAXDescriptionAttribute)
            var valueStr: String? = nil
            var valRef: AnyObject?
            if AXUIElementCopyAttributeValue(el, kAXValueAttribute as CFString, &valRef) == .success {
                if let s = valRef as? String {
                    valueStr = s.count > 200 ? String(s.prefix(200)) + "..." : s
                } else if let n = valRef as? NSNumber {
                    valueStr = n.stringValue
                }
            }
            let enabled = axBool(el, kAXEnabledAttribute) ?? true

            matchedElement = CursorElementJSON(
                role: role, title: title, label: label, value: valueStr, enabled: enabled
            )
        }
    }

    let response = CaptureCursorResponse(
        cursor: CursorPointJSON(x: cursorPt.x, y: cursorPt.y),
        display: display.ordinal,
        window: matchedWindow,
        element: matchedElement
    )
    print(jsonString(response))
}

// MARK: - Command: selection

/// Roles most likely to carry selected text — check these first for speed.
private let textBearingRoles: Set<String> = [
    "AXWebArea",
    "AXTextArea",
    "AXTextField",
    "AXSearchField",
    "AXSecureTextField",
    "AXStaticText",
]

@available(macOS 14.0, *)
func selectionCommand() {
    guard AXIsProcessTrusted() else {
        exitError("Accessibility permission required.", code: "PERMISSION_DENIED")
    }

    let windowInfoList = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []
    var visiblePIDs: Set<pid_t> = []
    for info in windowInfoList {
        let layer = info[kCGWindowLayer as String] as? Int ?? 0
        guard layer == 0 else { continue }
        let alpha = info[kCGWindowAlpha as String] as? Double ?? 1.0
        guard alpha > 0 else { continue }
        if let pid = info[kCGWindowOwnerPID as String] as? pid_t {
            visiblePIDs.insert(pid)
        }
    }

    var appInfo: [pid_t: (name: String, bundleId: String?)] = [:]
    for app in NSWorkspace.shared.runningApplications where app.activationPolicy == .regular {
        appInfo[app.processIdentifier] = (
            name: app.localizedName ?? "Unknown",
            bundleId: app.bundleIdentifier
        )
    }

    let frontPID = NSWorkspace.shared.frontmostApplication?.processIdentifier ?? -1
    let sortedPIDs = visiblePIDs.sorted { pid1, pid2 in
        (pid1 != frontPID ? 0 : 1) < (pid2 != frontPID ? 0 : 1)
    }

    for pid in sortedPIDs {
        let axApp = AXUIElementCreateApplication(pid)
        if let result = findSelectedText(in: axApp, maxDepth: 12) {
            let info = appInfo[pid]
            let response = SelectionResponse(
                selected_text: result.text,
                app_name: info?.name ?? "Unknown",
                app_pid: Int(pid),
                bundle_id: info?.bundleId,
                role: result.role
            )
            print(jsonString(response))
            return
        }
    }

    print("{\"selected_text\":null}")
}

/// Targeted AX tree search for selected text.
private func findSelectedText(in element: AXUIElement, depth: Int = 0, maxDepth: Int) -> (text: String, role: String)? {
    guard depth < maxDepth else { return nil }

    let role = axString(element, kAXRoleAttribute) ?? ""

    if textBearingRoles.contains(role) {
        if let sel = axString(element, kAXSelectedTextAttribute), !sel.isEmpty {
            return (text: sel, role: role)
        }
    }

    var childrenRef: AnyObject?
    guard AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &childrenRef) == .success,
          let children = childrenRef as? [AXUIElement] else { return nil }

    var textFirst: [AXUIElement] = []
    var rest: [AXUIElement] = []
    for child in children {
        let childRole = axString(child, kAXRoleAttribute) ?? ""
        if textBearingRoles.contains(childRole) {
            textFirst.append(child)
        } else {
            rest.append(child)
        }
    }

    for child in textFirst + rest {
        if let result = findSelectedText(in: child, depth: depth + 1, maxDepth: maxDepth) {
            return result
        }
    }

    return nil
}

// MARK: - Command: capture

@available(macOS 14.0, *)
func captureCommand(args: [String]) async {
    var opts = parseCaptureArgs(args)
    let fmt = resolveUTType(for: opts.format)
    let quality = resolveQuality(for: opts.quality)

    if opts.region != nil && opts.crop != nil {
        exitError("--region and --crop cannot be used together", code: "INVALID_ARG")
    }
    if opts.region != nil && opts.windowOnly {
        exitError("--region and --window cannot be used together", code: "INVALID_ARG")
    }
    let explicitSurfaceFlags = [opts.region != nil, opts.canvasID != nil, opts.channelID != nil].filter { $0 }.count
    if explicitSurfaceFlags > 1 {
        exitError("Use only one of --region, --canvas, or --channel", code: "INVALID_ARG")
    }
    if (opts.canvasID != nil || opts.channelID != nil) && opts.windowOnly {
        exitError("--window cannot be combined with --canvas or --channel", code: "INVALID_ARG")
    }

    // ── Zone resolution ──
    if !captureTargets.contains(opts.target) && !opts.target.hasPrefix("external") {
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

    // ── Accessibility pre-check (for features that need it) ──
    if opts.waitForClick { checkAccessibilityPermission(feature: "--wait-for-click") }
    if opts.xray { checkAccessibilityPermission(feature: "--xray") }

    // ── Wait for click (blocks until click or timeout) ──
    var clickCGPos: CGPoint? = nil
    if opts.waitForClick {
        clickCGPos = waitForGlobalClick(timeout: opts.timeout)
    }

    // ── Acquire ScreenCaptureKit session lock ──
    // Concurrent ScreenCaptureKit sessions can wedge both callers. Serialize
    // the capture session per runtime mode, similar to daemon singletoning.
    let captureLock = CaptureSessionLock()
    defer { _fixLifetime(captureLock) }

    // ── Permission pre-check ──
    checkScreenRecordingPermission()

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

    let displays = getCaptureDisplays()
    let explicitSurface = resolveCaptureSurface(opts: opts, displays: displays)

    // ── Resolve target ──
    var targetDisplayIDs: [CGDirectDisplayID] = []
    var specificWindow: SCWindow? = nil
    var responseWarning: String? = nil
    if explicitSurface == nil {
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

        case "mouse":
            guard let d = displayForMouse(displays: displays) else {
                exitError("Cannot determine display for cursor", code: "NO_DISPLAY")
            }
            targetDisplayIDs = [d.cgID]
            if let r = opts.radius {
                let pt = mouseInCGCoords()
                let relX = pt.x - d.bounds.origin.x
                let relY = pt.y - d.bounds.origin.y
                let scale = d.scaleFactor
                let px = Int(relX * scale)
                let py = Int(relY * scale)
                let pr = Int(Double(r) * scale)
                opts.crop = "\(max(0, px - pr)),\(max(0, py - pr)),\(pr * 2),\(pr * 2)"
            }

        case "all":
            targetDisplayIDs = displays.filter { !$0.isMirrored }.map { $0.cgID }

        default:
            exitError("Unknown target: '\(opts.target)'", code: "UNKNOWN_TARGET")
        }
    }

    // ── Interactive selection ──
    var interactiveBounds: BoundsJSON? = nil
    var interactiveImage: CGImage? = nil
    if opts.interactive {
        let tmpPath = NSTemporaryDirectory() + "aos-interactive-\(ProcessInfo.processInfo.processIdentifier).png"
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
        proc.arguments = ["-i", "-x", tmpPath]
        proc.standardOutput = FileHandle.nullDevice
        proc.standardError = FileHandle.nullDevice
        do { try proc.run() } catch {
            exitError("Failed to launch screencapture: \(error.localizedDescription)", code: "INTERACTIVE_FAILED")
        }
        proc.waitUntilExit()

        guard proc.terminationStatus == 0,
              let dataProvider = CGDataProvider(url: URL(fileURLWithPath: tmpPath) as CFURL),
              let img = CGImage(pngDataProviderSource: dataProvider, decode: nil, shouldInterpolate: true, intent: .defaultIntent)
        else {
            try? FileManager.default.removeItem(atPath: tmpPath)
            exitError("Interactive selection cancelled", code: "SELECTION_CANCELLED")
        }
        try? FileManager.default.removeItem(atPath: tmpPath)

        interactiveImage = img
        interactiveBounds = BoundsJSON(x: 0, y: 0, width: img.width, height: img.height)
    }

    // ── Capture loop ──
    var results: [(CGImage, String)] = []
    var responseCursor: CursorJSON? = nil
    var responseClickX: Int? = nil
    var responseClickY: Int? = nil
    var responseElements: [AXElementJSON]? = nil
    var responseAnnotations: [AnnotationJSON]? = nil
    var responseWindow: CaptureWindowJSON? = nil
    var responseSurfaces: [CaptureSurfaceJSON] = []
    let topologySnapshot = opts.perception ? buildSpatialTopology() : nil
    var responsePerceptions: [CapturePerceptionJSON] = []

    if let iImg = interactiveImage {
        var finalImage = iImg
        if let grid = opts.grid {
            finalImage = drawGrid(on: finalImage, spec: grid, thickness: opts.thickness, shadow: opts.shadow)
        }
        if !opts.drawRects.isEmpty {
            finalImage = drawRects(on: finalImage, rects: opts.drawRects, thickness: opts.thickness, shadow: opts.shadow)
        }
        results.append((finalImage, opts.resolvedOutputPath))
    }

    if interactiveImage == nil, let surface = explicitSurface {
        let captureScale = max(surface.segments.map { $0.display.scaleFactor }.max() ?? 1.0, 1.0)
        let stitchedRect = CGRect(
            x: 0,
            y: 0,
            width: surface.globalBounds.width * captureScale,
            height: surface.globalBounds.height * captureScale
        ).integral

        var capturedSegments: [CapturedSurfaceSegment] = []
        for segment in surface.segments {
            guard let scDisplay = content.displays.first(where: { $0.displayID == segment.display.cgID }) else {
                exitError("Display \(segment.display.ordinal) not available", code: "DISPLAY_NOT_FOUND")
            }
            let displayImage: CGImage
            do {
                displayImage = try await captureDisplay(scDisplay, scaleFactor: segment.display.scaleFactor, showCursor: opts.showCursor)
            } catch {
                exitError("Display capture failed: \(error.localizedDescription)", code: "CAPTURE_FAILED")
            }

            let pixelRect = capturePixelRect(globalRect: segment.globalBounds, in: segment.display)
            let cropped = cropImage(displayImage, to: pixelRect)
            let localRect = captureLocalRect(globalRect: segment.globalBounds, within: surface.globalBounds, scaleFactor: captureScale)
            capturedSegments.append(CapturedSurfaceSegment(segment: segment, image: cropped, localRect: localRect))
        }

        var image = stitchSurfaceSegments(capturedSegments, canvasSize: stitchedRect.size)
        let mapper = CoordinateMapper(
            displayOrigin: surface.globalBounds.origin,
            scaleFactor: captureScale,
            cropRect: nil,
            windowFrame: nil
        )
        let imageSize = CGSize(width: image.width, height: image.height)

        if responseWindow == nil,
           let windowID = surface.windowID,
           let sw = content.windows.first(where: { Int($0.windowID) == windowID }) {
            let scale = displayForWindow(sw, displays: displays).scaleFactor
            responseWindow = CaptureWindowJSON(
                window_id: Int(sw.windowID),
                title: sw.title,
                app_name: sw.owningApplication?.applicationName ?? "",
                app_pid: Int(sw.owningApplication?.processID ?? 0),
                bounds: STBounds(x: sw.frame.origin.x, y: sw.frame.origin.y, width: sw.frame.width, height: sw.frame.height),
                scale_factor: scale
            )
        }

        if let hlColor = opts.highlightCursorColor {
            let cursorPoint = mouseInCGCoords()
            if let lcs = mapper.toLCS(globalPoint: cursorPoint) {
                responseCursor = CursorJSON(x: lcs.x, y: lcs.y)
                let radius = 25.0 * captureScale
                let color = parseHexColor(hlColor)
                image = drawOnImage(image) { ctx, w, h in
                    ctx.setFillColor(color)
                    let ctxY = CGFloat(h) - CGFloat(lcs.y)
                    ctx.fillEllipse(in: CGRect(
                        x: CGFloat(lcs.x) - radius,
                        y: ctxY - radius,
                        width: radius * 2,
                        height: radius * 2
                    ))
                }
            }
        }

        if let clickPt = clickCGPos, let lcs = mapper.toLCS(globalPoint: clickPt) {
            responseClickX = lcs.x
            responseClickY = lcs.y
        }

        if opts.xray {
            if let windowID = surface.windowID,
               let ownerApp = content.windows.first(where: { Int($0.windowID) == windowID })?.owningApplication {
                responseElements = xrayApp(
                    pid: ownerApp.processID,
                    appName: ownerApp.applicationName,
                    mapper: mapper,
                    imageSize: imageSize
                )
            } else {
                responseElements = xrayFrontmostApp(mapper: mapper, imageSize: imageSize)
            }
        }

        if opts.label, let elems = responseElements, !elems.isEmpty {
            let anns = buildAnnotations(from: elems)
            responseAnnotations = anns

            let badgeHTML = generateBadgeHTML(annotations: anns, width: image.width, height: image.height, scaleFactor: captureScale)
            if let overlay = renderHTMLToBitmap(html: badgeHTML, width: image.width, height: image.height) {
                image = compositeOverlay(overlay, onto: image)
            } else {
                exitError("Render binary not found — could not locate `aos show render`.", code: "MISSING_DEPENDENCY")
            }
        }

        if let grid = opts.grid {
            image = drawGrid(on: image, spec: grid, thickness: opts.thickness, shadow: opts.shadow)
        }
        if !opts.drawRects.isEmpty {
            image = drawRects(on: image, rects: opts.drawRects, thickness: opts.thickness, shadow: opts.shadow)
        }

        let surfaceJSON = captureSurfaceJSON(selection: surface, imageSize: imageSize, scaleFactor: captureScale)
        responseSurfaces.append(surfaceJSON)
        if let topology = topologySnapshot {
            responsePerceptions.append(
                capturePerceptionSnapshot(
                    topology: topology,
                    captureRect: surface.globalBounds,
                    imageSize: imageSize,
                    scaleFactor: captureScale,
                    segments: surfaceJSON.segments
                )
            )
        }

        results.append((image, opts.resolvedOutputPath))
    } else {
        for (idx, cgID) in targetDisplayIDs.enumerated() {
            if interactiveImage != nil { break }
            guard let entry = displays.first(where: { $0.cgID == cgID }) else { continue }
            var image: CGImage
            var capturedWindow: SCWindow? = nil

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

                if window.frame.width < 10 || window.frame.height < 10 {
                    responseWarning = "Window appears minimized or hidden (frame: \(Int(window.frame.width))x\(Int(window.frame.height))). Falling back to display capture."
                    guard let scDisplay = content.displays.first(where: { $0.displayID == cgID }) else {
                        exitError("Display \(entry.ordinal) not available", code: "DISPLAY_NOT_FOUND")
                    }
                    do { image = try await captureDisplay(scDisplay, scaleFactor: entry.scaleFactor, showCursor: opts.showCursor) }
                    catch { exitError("Display capture failed: \(error.localizedDescription)", code: "CAPTURE_FAILED") }
                } else {
                    do {
                        image = try await captureWindow(window, scaleFactor: entry.scaleFactor, showCursor: opts.showCursor)
                        capturedWindow = window
                    }
                    catch {
                        responseWarning = "Window capture failed (\(error.localizedDescription)). Falling back to display capture."
                        guard let scDisplay = content.displays.first(where: { $0.displayID == cgID }) else {
                            exitError("Display \(entry.ordinal) not available", code: "DISPLAY_NOT_FOUND")
                        }
                        do { image = try await captureDisplay(scDisplay, scaleFactor: entry.scaleFactor, showCursor: opts.showCursor) }
                        catch { exitError("Display capture also failed: \(error.localizedDescription)", code: "CAPTURE_FAILED") }
                    }
                }
            } else {
                guard let scDisplay = content.displays.first(where: { $0.displayID == cgID }) else {
                    exitError("Display \(entry.ordinal) not available", code: "DISPLAY_NOT_FOUND")
                }
                do { image = try await captureDisplay(scDisplay, scaleFactor: entry.scaleFactor, showCursor: opts.showCursor) }
                catch { exitError("Display capture failed: \(error.localizedDescription)", code: "CAPTURE_FAILED") }
            }

            // 2. Cursor highlight
            var cursorCapPos: (x: Int, y: Int)? = nil
            if let hlColor = opts.highlightCursorColor, let pos = cursorPositionInImageSpace(display: entry) {
                cursorCapPos = pos
                let radius = 25.0 * entry.scaleFactor
                let color = parseHexColor(hlColor)
                image = drawOnImage(image) { ctx, w, h in
                    ctx.setFillColor(color)
                    let ctxY = CGFloat(h) - CGFloat(pos.y)
                    ctx.fillEllipse(in: CGRect(
                        x: CGFloat(pos.x) - radius, y: ctxY - radius,
                        width: radius * 2, height: radius * 2
                    ))
                }
            }

            // 3. Crop
            var cropRect: CGRect? = nil
            if let crop = opts.crop {
                let result = applyCrop(image, style: crop)
                image = result.image
                cropRect = result.rect
            }

            // 4. Build CoordinateMapper
            let windowFrame: CGRect? = capturedWindow?.frame
            let mapper = CoordinateMapper(
                displayOrigin: entry.bounds.origin,
                scaleFactor: entry.scaleFactor,
                cropRect: cropRect,
                windowFrame: windowFrame
            )
            let imageSize = CGSize(width: image.width, height: image.height)
            if responseWindow == nil, let sw = capturedWindow {
                responseWindow = CaptureWindowJSON(
                    window_id: Int(sw.windowID),
                    title: sw.title,
                    app_name: sw.owningApplication?.applicationName ?? "",
                    app_pid: Int(sw.owningApplication?.processID ?? 0),
                    bounds: STBounds(x: sw.frame.origin.x, y: sw.frame.origin.y, width: sw.frame.width, height: sw.frame.height),
                    scale_factor: entry.scaleFactor
                )
            }

            // 5. Cursor position in LCS
            if let capPos = cursorCapPos {
                let displayRelPt = CGPoint(
                    x: entry.bounds.origin.x + Double(capPos.x) / entry.scaleFactor,
                    y: entry.bounds.origin.y + Double(capPos.y) / entry.scaleFactor
                )
                if let lcs = mapper.toLCS(globalPoint: displayRelPt) {
                    responseCursor = CursorJSON(x: lcs.x, y: lcs.y)
                }
            }

            // 6. Click position in LCS
            if let clickPt = clickCGPos {
                if let lcs = mapper.toLCS(globalPoint: clickPt) {
                    responseClickX = lcs.x
                    responseClickY = lcs.y
                }
            }

            // 7. Xray
            if opts.xray {
                if opts.windowOnly, let ownerApp = (capturedWindow ?? specificWindow)?.owningApplication {
                    responseElements = xrayApp(
                        pid: ownerApp.processID,
                        appName: ownerApp.applicationName,
                        mapper: mapper, imageSize: imageSize
                    )
                } else {
                    responseElements = xrayFrontmostApp(mapper: mapper, imageSize: imageSize)
                }
            }

            // 7b. Label
            if opts.label, let elems = responseElements, !elems.isEmpty {
                let anns = buildAnnotations(from: elems)
                responseAnnotations = anns

                let badgeHTML = generateBadgeHTML(annotations: anns, width: image.width, height: image.height, scaleFactor: entry.scaleFactor)
                if let overlay = renderHTMLToBitmap(html: badgeHTML, width: image.width, height: image.height) {
                    image = compositeOverlay(overlay, onto: image)
                } else {
                    exitError("Render binary not found — could not locate `aos show render`.", code: "MISSING_DEPENDENCY")
                }
            }

            // 8. Overlays
            if let grid = opts.grid {
                image = drawGrid(on: image, spec: grid, thickness: opts.thickness, shadow: opts.shadow)
            }
            if !opts.drawRects.isEmpty {
                image = drawRects(on: image, rects: opts.drawRects, thickness: opts.thickness, shadow: opts.shadow)
            }

            let surfaceSelection: CaptureSurfaceSelection = {
                if let sw = capturedWindow {
                    return CaptureSurfaceSelection(
                        kind: "window",
                        id: nil,
                        globalBounds: sw.frame.integral,
                        windowID: Int(sw.windowID),
                        segments: [CaptureSurfaceSegmentSelection(display: entry, globalBounds: sw.frame.integral)]
                    )
                }
                let captureRect = globalCaptureRect(display: entry, windowFrame: windowFrame, cropRect: cropRect)
                return CaptureSurfaceSelection(
                    kind: "display",
                    id: opts.target == "all" ? "display-\(entry.ordinal)" : opts.target,
                    globalBounds: captureRect,
                    windowID: nil,
                    segments: [CaptureSurfaceSegmentSelection(display: entry, globalBounds: captureRect)]
                )
            }()
            let surfaceJSON = captureSurfaceJSON(selection: surfaceSelection, imageSize: imageSize, scaleFactor: entry.scaleFactor)
            responseSurfaces.append(surfaceJSON)

            if let topology = topologySnapshot {
                let captureRect = globalCaptureRect(display: entry, windowFrame: windowFrame, cropRect: cropRect)
                responsePerceptions.append(
                    capturePerceptionSnapshot(
                        topology: topology,
                        captureRect: captureRect,
                        imageSize: CGSize(width: image.width, height: image.height),
                        scaleFactor: entry.scaleFactor,
                        segments: surfaceJSON.segments
                    )
                )
            }

            // 9. Output path
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
    func buildResponse() -> SuccessResponse {
        var resp = SuccessResponse()
        resp.cursor = responseCursor
        resp.bounds = interactiveBounds
        resp.click_x = responseClickX
        resp.click_y = responseClickY
        resp.warning = responseWarning
        resp.elements = responseElements
        resp.annotations = responseAnnotations
        if !responseSurfaces.isEmpty {
            resp.surfaces = responseSurfaces
        }
        if opts.perception && !responsePerceptions.isEmpty {
            resp.perceptions = responsePerceptions
        }
        if opts.windowOnly, let window = responseWindow {
            resp.window = window
        }
        return resp
    }

    if opts.useBase64 {
        var b64s: [String] = []
        for (img, _) in results {
            guard let data = encodeImage(img, format: fmt, quality: quality) else {
                exitError("Failed to encode image to \(opts.format)", code: "ENCODE_FAILED")
            }
            b64s.append(data.base64EncodedString())
        }
        var resp = buildResponse()
        resp.base64 = b64s
        print(jsonString(resp))
    } else {
        var files: [String] = []
        for (img, path) in results {
            guard writeImage(img, to: path, format: fmt, quality: quality) else {
                exitError("Failed to write image to \(path)", code: "WRITE_FAILED")
            }
            files.append(path)
        }
        var resp = buildResponse()
        resp.files = files
        print(jsonString(resp))
    }
}
