// capture-pipeline.swift — Full capture pipeline
//
// Core screenshot pipeline: parse args → resolve target → capture →
// crop → overlay → encode → output.

import Cocoa
import UniformTypeIdentifiers
import CoreText
import ApplicationServices
import Darwin
import CryptoKit

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

struct CaptureApplicationFact {
    let applicationName: String
    let processID: pid_t
}

struct CaptureWindowFact {
    let frame: CGRect
    let owningApplication: CaptureApplicationFact?
    let title: String?
    let windowID: Int
    let windowLayer: Int
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

func observeDisplayTopologySnapshot() -> AOSDisplayTopologySnapshot {
    // One bounded read owns this observation. Every downstream display lookup,
    // region segment, stitch, response, and optional perception consumes the
    // immutable value returned here.
    let maxD: UInt32 = 64
    var ids = [CGDirectDisplayID](repeating: 0, count: Int(maxD))
    var count: UInt32 = 0
    let displayListResult = CGGetActiveDisplayList(maxD, &ids, &count)
    guard displayListResult == .success, count <= maxD else {
        exitError("Failed to observe active displays", code: "DISPLAY_TOPOLOGY_INVALID")
    }

    let mainID = CGMainDisplayID()
    let screens = NSScreen.screens
    let screensHaveSeparateSpaces = NSScreen.screensHaveSeparateSpaces
    let activeDisplayIDs = Array(ids.prefix(Int(count)))
    let activeDisplayIDSet = Set(activeDisplayIDs)
    let observation = screens.compactMap { screen -> AOSDisplayTopologyObservationMember? in
        guard let displayID = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID,
              activeDisplayIDSet.contains(displayID)
        else {
            return nil
        }
        let nativeFrame = CGDisplayBounds(displayID)
        let frame = screen.frame
        let visible = screen.visibleFrame
        let localX = visible.origin.x - frame.origin.x
        let localY = frame.height - (visible.origin.y - frame.origin.y) - visible.height
        let visibleFrame = CGRect(
            x: nativeFrame.origin.x + localX,
            y: nativeFrame.origin.y + localY,
            width: visible.width,
            height: visible.height
        )
        let displayUUID: String? = {
            guard let unmanaged = CGDisplayCreateUUIDFromDisplayID(displayID) else { return nil }
            return CFUUIDCreateString(nil, unmanaged.takeRetainedValue()) as String
        }()
        return AOSDisplayTopologyObservationMember(
            runtimeDisplayID: displayID,
            displayUUID: displayUUID,
            label: screen.localizedName,
            isMain: displayID == mainID,
            isMirrored: CGDisplayMirrorsDisplay(displayID) != kCGNullDirectDisplay,
            nativeBounds: AOSDisplayTopologyBounds(
                x: nativeFrame.origin.x,
                y: nativeFrame.origin.y,
                width: nativeFrame.width,
                height: nativeFrame.height
            ),
            nativeVisibleBounds: AOSDisplayTopologyBounds(
                x: visibleFrame.origin.x,
                y: visibleFrame.origin.y,
                width: visibleFrame.width,
                height: visibleFrame.height
            ),
            scaleFactor: Double(screen.backingScaleFactor),
            rotation: Double(CGDisplayRotation(displayID))
        )
    }

    do {
        return try buildAOSDisplayTopologySnapshot(
            activeDisplayIDs: activeDisplayIDs,
            observation: observation,
            screensHaveSeparateSpaces: screensHaveSeparateSpaces
        )
    } catch {
        exitError("Invalid display topology observation: \(error)", code: "DISPLAY_TOPOLOGY_INVALID")
    }
}

func getCaptureDisplays(from snapshot: AOSDisplayTopologySnapshot) -> [CaptureDisplayEntry] {
    let main = snapshot.displays.first(where: \.isMain)!
    let mainCenterX = main.nativeBounds.x + main.nativeBounds.width / 2
    return snapshot.displays.map { display in
        let centerX = display.nativeBounds.x + display.nativeBounds.width / 2
        let type = display.runtimeIsMirrored
            ? "Mirror for Built-in Display"
            : (display.isMain ? "Main display" : "Extended")
        let arrangement = display.isMain
            ? "main"
            : (centerX < mainCenterX ? "left" : (centerX > mainCenterX ? "right" : "center"))

        return CaptureDisplayEntry(
            ordinal: display.ordinal,
            cgID: display.runtimeDisplayID,
            bounds: CGRect(
                x: display.nativeBounds.x,
                y: display.nativeBounds.y,
                width: display.nativeBounds.width,
                height: display.nativeBounds.height
            ),
            scaleFactor: display.scaleFactor,
            rotation: display.rotation,
            isMain: display.isMain,
            isMirrored: display.runtimeIsMirrored,
            type: type,
            arrangement: arrangement,
            resolution: "\(Int(display.nativeBounds.width))x\(Int(display.nativeBounds.height))"
        )
    }
}

func getCaptureDisplays() -> [CaptureDisplayEntry] {
    getCaptureDisplays(from: observeDisplayTopologySnapshot())
}

func displayForWindow(_ window: CaptureWindowFact, displays: [CaptureDisplayEntry]) -> CaptureDisplayEntry {
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

func observeCaptureWindowFacts() -> [CaptureWindowFact] {
    guard let raw = CGWindowListCopyWindowInfo(
        [.optionOnScreenOnly, .excludeDesktopElements],
        kCGNullWindowID
    ) as? [[CFString: Any]] else { return [] }
    return raw.compactMap { item in
        guard let number = item[kCGWindowNumber] as? NSNumber,
              let layer = item[kCGWindowLayer] as? NSNumber,
              let rawBounds = item[kCGWindowBounds] else {
            return nil
        }
        let bounds = rawBounds as! CFDictionary
        guard let frame = CGRect(dictionaryRepresentation: bounds) else {
            return nil
        }
        let application: CaptureApplicationFact?
        if let pid = (item[kCGWindowOwnerPID] as? NSNumber)?.int32Value {
            application = CaptureApplicationFact(
                applicationName: item[kCGWindowOwnerName] as? String ?? "",
                processID: pid
            )
        } else {
            application = nil
        }
        return CaptureWindowFact(
            frame: frame,
            owningApplication: application,
            title: item[kCGWindowName] as? String,
            windowID: number.intValue,
            windowLayer: layer.intValue
        )
    }
}

func largestWindow(for pid: pid_t, in windows: [CaptureWindowFact]) -> CaptureWindowFact? {
    windows
        .filter { $0.owningApplication?.processID == pid && $0.windowLayer == 0 && $0.frame.width > 0 }
        .max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height })
}

func largestWindowOnDisplay(_ entry: CaptureDisplayEntry, in windows: [CaptureWindowFact], preferPID: pid_t? = nil) -> CaptureWindowFact? {
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

func selfieWindow(windows: [CaptureWindowFact]) -> CaptureWindowFact? {
    var pid = getpid()
    var visited = Set<pid_t>()
    while pid > 1 && !visited.contains(pid) {
        visited.insert(pid)
        if let w = largestWindow(for: pid, in: windows) { return w }
        pid = parentPID(of: pid)
    }
    if let termProgram = ProcessInfo.processInfo.environment["TERM_PROGRAM"] {
        let needle = termProgram.lowercased()
        let candidates = windows.filter {
            guard let app = $0.owningApplication else { return false }
            return $0.windowLayer == 0 && $0.frame.width > 100
                && (app.applicationName.lowercased().contains(needle)
                    || app.applicationName.lowercased().contains(needle))
        }
        if let w = candidates.max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }) {
            return w
        }
    }
    if let frontApp = NSWorkspace.shared.frontmostApplication {
        return largestWindow(for: frontApp.processIdentifier, in: windows)
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

func parseViewportPoint(_ spec: String, label: String = "--browser-dom-point") -> BrowserDomHitTestPoint {
    let parts = spec.split(separator: ",").compactMap { Double($0) }
    guard parts.count == 2 else {
        exitError("\(label) must be x,y", code: "INVALID_ARG")
    }
    guard parts[0] >= 0, parts[1] >= 0 else {
        exitError("\(label) coordinates must be non-negative viewport points", code: "INVALID_ARG")
    }
    return BrowserDomHitTestPoint(x: parts[0], y: parts[1])
}

func parseBrowserContentRect(_ spec: String, label: String = "--browser-content-rect") -> BrowserDomContentRect {
    let rect = parseGlobalRect(spec, label: label)
    return BrowserDomContentRect(
        x: Double(rect.origin.x),
        y: Double(rect.origin.y),
        w: Double(rect.size.width),
        h: Double(rect.size.height)
    )
}

struct CaptureSurfaceSelection {
    let kind: String
    let id: String?
    let globalBounds: CGRect
    let windowID: Int?
    let windowPID: Int?
    let segments: [CaptureSurfaceSegmentSelection]
}

private struct ResolvedExactChannelCapture {
    let plan: AOSExactChannelCapturePlan
    let display: CaptureDisplayEntry
    let window: CaptureWindowFact
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

func xrayAppsIntersectingCapture(
    windows: [CaptureWindowFact],
    captureRect: CGRect,
    mapper: CoordinateMapper,
    imageSize: CGSize,
    preferredPID: pid_t? = nil
) -> [AXElementJSON] {
    struct Candidate {
        let pid: pid_t
        let appName: String
        let area: CGFloat
        let preferred: Bool
    }

    var candidatesByPID: [pid_t: Candidate] = [:]
    for window in windows {
        guard
            window.frame.width > 0,
            window.frame.height > 0,
            window.frame.intersects(captureRect),
            let app = window.owningApplication
        else { continue }

        let pid = app.processID
        let intersection = window.frame.intersection(captureRect)
        let area = max(0, intersection.width) * max(0, intersection.height)
        let candidate = Candidate(
            pid: pid,
            appName: app.applicationName,
            area: area,
            preferred: preferredPID != nil && pid == preferredPID
        )
        if let current = candidatesByPID[pid] {
            candidatesByPID[pid] = candidate.area > current.area ? candidate : current
        } else {
            candidatesByPID[pid] = candidate
        }
    }

    let candidates = candidatesByPID.values.sorted {
        if $0.preferred != $1.preferred { return $0.preferred && !$1.preferred }
        if $0.area != $1.area { return $0.area > $1.area }
        return $0.appName < $1.appName
    }
    return candidates.flatMap { candidate in
        xrayApp(pid: candidate.pid, appName: candidate.appName, mapper: mapper, imageSize: imageSize)
    }
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
        display_id: Int(segment.display.cgID),
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
    CanvasResponse.fromDict(response)
}

func readCanvasInfo(id: String) -> CanvasInfo? {
    guard let response = sendEnvelopeRequest(service: "show", action: "list", data: [:], autoStartBinary: aosExecutablePath()),
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
            windowID: canvas.windowNumbers?.first ?? canvas.anchorWindow,
            windowPID: nil,
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
            windowPID: channel.target.pid,
            // Stored bounds are recency evidence only. Exact channel planning
            // resolves current bounds and display membership before segments.
            segments: []
        )
    }
    if let regionSpec = opts.region {
        let region = parseGlobalRect(regionSpec)
        return CaptureSurfaceSelection(
            kind: "region",
            id: nil,
            globalBounds: region,
            windowID: nil,
            windowPID: nil,
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
    return elements.compactMap { el -> AnnotationJSON? in
        guard let bounds = el.bounds else { return nil }
        return AnnotationJSON(
            bounds: AnnotationBoundsJSON(
                x: Double(bounds.x),
                y: Double(bounds.y),
                width: Double(bounds.width),
                height: Double(bounds.height)
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

// MARK: - Daemon-owned native capture

private struct AOSPublicCaptureChunkAccumulator {
    var byteCount: Int
    var chunkCount: Int
    var data = Data()
    var nextChunkIndex = 0
    var sha256: String
}

private struct AOSPublicNativeCaptureResult {
    let images: [CGDirectDisplayID: CGImage]
    let usedDisplayFallback: Set<CGDirectDisplayID>
}

// One absolute foreground budget covers warm quiescence (5s), the two
// sequential still callback phases (2 x 5s), and bounded warm restoration
// startup/retirement (under 10s), while retaining margin inside the existing
// 30s outer consumer deadline.
let aosPublicCaptureForegroundBudgetMilliseconds =
    Int(aosPublicCaptureDaemonTransactionBudget * 1_000) + 1_000

private func aosCaptureDigest(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

private func aosDecodeCapturePNG(_ data: Data) -> CGImage? {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil) else {
        return nil
    }
    return CGImageSourceCreateImageAtIndex(source, 0, [
        kCGImageSourceShouldCacheImmediately: true,
    ] as CFDictionary)
}

private func aosPublicCaptureErrorCode(_ daemonCode: String?) -> String {
    switch daemonCode {
    case "DESKTOP_FRAME_BUSY":
        return "CAPTURE_BUSY"
    case "DESKTOP_FRAME_PERMISSION_DENIED":
        return "PERMISSION_DENIED"
    case "DESKTOP_FRAME_DISPLAY_NOT_FOUND",
         "DESKTOP_FRAME_TOPOLOGY_MISMATCH":
        return "CAPTURE_TOPOLOGY_MISMATCH"
    case "DESKTOP_FRAME_CAPTURE_FAILED",
         "DESKTOP_FRAME_RETIREMENT_UNCERTAIN",
         "DESKTOP_FRAME_UNAUTHORIZED",
         "DESKTOP_FRAME_UNSUPPORTED",
         nil:
        return "CAPTURE_FAILED"
    default:
        return "CAPTURE_FAILED"
    }
}

private func captureNativeFramesThroughDaemon(
    topology: AOSDisplayTopologySnapshot,
    selectedDisplayIDs: [CGDirectDisplayID],
    excludedWindowIDs: [Int],
    windowTargetsByDisplay: [CGDirectDisplayID: AOSDesktopPixelWindowTarget],
    showsCursor: Bool
) -> AOSPublicNativeCaptureResult {
    let selectedSet = Set(selectedDisplayIDs)
    let selectedDisplays = topology.displays.filter {
        selectedSet.contains($0.runtimeDisplayID)
    }.sorted { left, right in
        guard let leftIndex = selectedDisplayIDs.firstIndex(of: left.runtimeDisplayID),
              let rightIndex = selectedDisplayIDs.firstIndex(of: right.runtimeDisplayID) else {
            return left.ordinal < right.ordinal
        }
        return leftIndex < rightIndex
    }
    guard selectedDisplays.count == selectedDisplayIDs.count,
          Set(selectedDisplayIDs).count == selectedDisplayIDs.count else {
        exitError("Capture selection does not match frozen display topology", code: "CAPTURE_TOPOLOGY_MISMATCH")
    }
    let maximumPixels = selectedDisplays.reduce(0) { current, display in
        let dimensions = AOSDesktopPixelDimensions(
            pointWidth: display.nativeBounds.width,
            pointHeight: display.nativeBounds.height,
            pointPixelScale: display.scaleFactor
        )
        return max(current, dimensions?.pixelCount ?? Int.max)
    }
    guard maximumPixels > 0,
          maximumPixels <= AOSDesktopPixelLimits.publicCaptureMaximumPixelsPerDisplay else {
        exitError("Capture exceeds the native pixel budget", code: "CAPTURE_FAILED")
    }
    let captureID = UUID().uuidString.lowercased()
    let displaysWire: [[String: Any]] = selectedDisplays.enumerated().map { index, display in
        [
            "display_id": NSNumber(value: display.runtimeDisplayID),
            "index": index,
            "topology_ordinal": display.ordinal,
        ]
    }
    let windowWire = windowTargetsByDisplay.map { displayID, target in
        [
            "display_id": NSNumber(value: displayID),
            "window_id": target.windowID,
            "owner_pid": target.ownerPID,
            "expected_bounds": [
                "x": target.expectedBounds.origin.x,
                "y": target.expectedBounds.origin.y,
                "width": target.expectedBounds.width,
                "height": target.expectedBounds.height,
            ],
            "fallback": target.fallback.rawValue,
        ] as [String: Any]
    }.sorted { left, right in
        let leftID = aosExactJSONUInt32(left["display_id"] as Any) ?? 0
        let rightID = aosExactJSONUInt32(right["display_id"] as Any) ?? 0
        return leftID < rightID
    }
    let topologyWire: [String: Any]
    do {
        topologyWire = try aosDisplayTopologyWireValue(topology)
    } catch {
        exitError("Display topology could not be serialized", code: "CAPTURE_TOPOLOGY_MISMATCH")
    }
    let payload = buildEnvelopePayload(
        service: "see",
        action: "capture",
        data: [
            "capture_id": captureID,
            "display_topology": topologyWire,
            "displays": displaysWire,
            "display_ids": selectedDisplayIDs.map { NSNumber(value: $0) },
            "excluded_window_ids": excludedWindowIDs,
            "window_targets": windowWire,
            "maximum_pixels_per_display": maximumPixels,
            "shows_cursor": showsCursor,
        ],
        ref: captureID
    )
    let session = DaemonSession(socketPath: kDefaultSocketPath)
    guard session.connectWithAutoStart(binaryPath: aosExecutablePath(), timeoutMs: 1_000) else {
        exitError("The AOS daemon is unavailable", code: "DAEMON_UNREACHABLE")
    }
    defer { session.disconnect() }
    session.sendOnly(payload)

    let startedAt = DispatchTime.now().uptimeNanoseconds
    let budgetNanoseconds = UInt64(aosPublicCaptureForegroundBudgetMilliseconds)
        * 1_000_000
    var accumulators: [Int: AOSPublicCaptureChunkAccumulator] = [:]
    var expectedFrameIndex = 0
    var finalFrames: [[String: Any]]?
    while finalFrames == nil {
        let elapsed = DispatchTime.now().uptimeNanoseconds - startedAt
        guard elapsed < budgetNanoseconds else {
            exitError("The AOS daemon did not settle capture", code: "CAPTURE_FAILED")
        }
        let remainingMilliseconds = max(
            1,
            Int((budgetNanoseconds - elapsed + 999_999) / 1_000_000)
        )
        guard let message = session.readOneJSON(
            timeoutMs: Int32(min(remainingMilliseconds, Int(Int32.max)))
        ) else {
            exitError("The AOS daemon did not settle capture", code: "CAPTURE_FAILED")
        }
        let encodedBudget = maximumPixels.multipliedReportingOverflow(by: 5)
        let overheadBudget = encodedBudget.partialValue.addingReportingOverflow(1_048_576)
        guard !encodedBudget.overflow, !overheadBudget.overflow else {
            exitError("Capture byte budget overflowed", code: "CAPTURE_FAILED")
        }
        let foregroundMessage: AOSPublicCaptureForegroundMessage
        do {
            foregroundMessage = try aosDecodePublicCaptureForegroundMessage(
                message,
                captureID: captureID,
                topologyIdentity: topology.identity,
                maximumByteCount: overheadBudget.partialValue
            )
        } catch {
            exitError("Capture response contract failed", code: "CAPTURE_FAILED")
        }
        switch foregroundMessage {
        case .chunk(let chunkWire):
            let frameIndex = chunkWire.frameIndex
            let displayID = chunkWire.displayID
            let chunkIndex = chunkWire.chunkIndex
            let chunkCount = chunkWire.chunkCount
            let byteCount = chunkWire.byteCount
            let digest = chunkWire.sha256
            let chunk = chunkWire.chunk
            guard frameIndex == expectedFrameIndex,
                  frameIndex < selectedDisplayIDs.count,
                  displayID == selectedDisplayIDs[frameIndex] else {
                exitError("Capture chunk contract failed", code: "CAPTURE_FAILED")
            }
            var accumulator = accumulators[frameIndex]
                ?? AOSPublicCaptureChunkAccumulator(
                    byteCount: byteCount,
                    chunkCount: chunkCount,
                    sha256: digest
                )
            guard accumulator.byteCount == byteCount,
                  accumulator.chunkCount == chunkCount,
                  accumulator.sha256 == digest,
                  accumulator.nextChunkIndex == chunkIndex,
                  chunkIndex < chunkCount,
                  accumulator.data.count <= byteCount - chunk.count else {
                exitError("Capture chunk order or budget failed", code: "CAPTURE_FAILED")
            }
            accumulator.data.append(chunk)
            accumulator.nextChunkIndex += 1
            accumulators[frameIndex] = accumulator
            if accumulator.nextChunkIndex == chunkCount {
                expectedFrameIndex += 1
            }
            continue
        case .failure(let code):
            exitError(
                "Native capture failed",
                code: aosPublicCaptureErrorCode(code)
            )
        case .success(let frames):
            finalFrames = frames
        }
    }

    guard let finalFrames,
          finalFrames.count == selectedDisplayIDs.count,
          expectedFrameIndex == selectedDisplayIDs.count else {
        exitError("Capture response is incomplete", code: "CAPTURE_FAILED")
    }
    var images: [CGDirectDisplayID: CGImage] = [:]
    var usedDisplayFallback = Set<CGDirectDisplayID>()
    for (frameIndex, metadata) in finalFrames.enumerated() {
        let wire: AOSPublicCaptureFrameWireValue
        do {
            wire = try aosDecodePublicCaptureFrameWireValue(metadata)
        } catch {
            exitError("Capture metadata contract failed", code: "CAPTURE_FAILED")
        }
        let displayID = wire.displayID
        let byteCount = wire.byteCount
        let chunkCount = wire.chunkCount
        let digest = wire.sha256
        guard displayID == selectedDisplayIDs[frameIndex],
              wire.frameIndex == frameIndex,
              let accumulator = accumulators[frameIndex],
              accumulator.nextChunkIndex == chunkCount,
              accumulator.chunkCount == chunkCount,
              accumulator.byteCount == byteCount,
              accumulator.data.count == byteCount,
              accumulator.sha256 == digest,
              aosCaptureDigest(accumulator.data) == digest,
              let image = aosDecodeCapturePNG(accumulator.data),
              wire.width == image.width,
              wire.height == image.height,
              aosPublicCaptureFrameMatchesRequestedWindow(
                wire,
                requestedWindowID: windowTargetsByDisplay[displayID]?.windowID
              ),
              !(windowTargetsByDisplay[displayID].map(\.fallback) == .some(.none)
                && wire.windowFallback) else {
            exitError("Capture digest or geometry failed", code: "CAPTURE_FAILED")
        }
        images[displayID] = image
        if wire.windowFallback { usedDisplayFallback.insert(displayID) }
    }
    return AOSPublicNativeCaptureResult(
        images: images,
        usedDisplayFallback: usedDisplayFallback
    )
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
    var excludedWindowIDs: [Int] = []
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

    // Browser DOM point hit test for explicit local browser sessions.
    var browserDomPoint: BrowserDomHitTestPoint? = nil
    var browserContentRect: BrowserDomContentRect? = nil

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
        case "--exclude-window":
            i += 1
            guard i < args.count else { exitError("--exclude-window requires a CGWindowID", code: "MISSING_ARG") }
            guard let windowID = Int(args[i]), windowID > 0 else {
                exitError("--exclude-window must be a positive integer CGWindowID", code: "INVALID_ARG")
            }
            opts.excludedWindowIDs.append(windowID)
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

        // Browser DOM point targeting.
        case "--browser-dom-point":
            i += 1
            guard i < args.count else { exitError("--browser-dom-point requires x,y", code: "MISSING_ARG") }
            opts.browserDomPoint = parseViewportPoint(args[i])
        case "--browser-content-rect":
            i += 1
            guard i < args.count else { exitError("--browser-content-rect requires x,y,w,h", code: "MISSING_ARG") }
            opts.browserContentRect = parseBrowserContentRect(args[i])

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
    if opts.interactive {
        let conflicts = [
            (opts.region != nil, "--region"),
            (opts.canvasID != nil, "--canvas"),
            (opts.channelID != nil, "--channel"),
            (opts.windowOnly, "--window"),
            (opts.crop != nil, "--crop"),
        ].compactMap { pair in pair.0 ? pair.1 : nil }
        if !conflicts.isEmpty {
            exitError(
                "--interactive cannot be combined with \(conflicts.joined(separator: ", "))",
                code: "INVALID_ARG"
            )
        }
        if opts.target.hasPrefix("browser:") {
            exitError("--interactive requires one native display target", code: "INVALID_ARG")
        }
    }
    return opts
}

func resolveUTType(for format: String) -> UTType {
    switch format {
    case "png":          return .png
    case "jpg", "jpeg":  return .jpeg
    case "heic":         return .heic
    default: exitError("Unknown format: '\(format)'. Use png, jpg/jpeg, or heic.", code: "INVALID_FORMAT")
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

enum InteractiveSelectionResult {
    case selected(NSRect)
    case cancelled
    case timedOut
}

func showInteractiveSelection(
    on display: CaptureDisplayEntry,
    mainDisplayHeight: Double,
    timeout: Double = 60
) -> InteractiveSelectionResult {
    if !Thread.isMainThread {
        var result: InteractiveSelectionResult = .timedOut
        DispatchQueue.main.sync {
            result = showInteractiveSelection(
                on: display,
                mainDisplayHeight: mainDisplayHeight,
                timeout: timeout
            )
        }
        return result
    }
    NSApp.setActivationPolicy(.regular)

    let frozenWindowBounds: AOSDisplayTopologyBounds
    do {
        frozenWindowBounds = try aosInteractiveSelectionWindowBounds(
            displayNativeBounds: AOSDisplayTopologyBounds(
                x: display.bounds.origin.x,
                y: display.bounds.origin.y,
                width: display.bounds.width,
                height: display.bounds.height
            ),
            mainDisplayHeight: mainDisplayHeight
        )
    } catch {
        exitError("Invalid frozen interactive display geometry: \(error)", code: "DISPLAY_TOPOLOGY_INVALID")
    }
    let windowRect = NSRect(
        x: frozenWindowBounds.x,
        y: frozenWindowBounds.y,
        width: frozenWindowBounds.width,
        height: frozenWindowBounds.height
    )

    var result: NSRect? = nil
    var done = false
    var cancelled = false
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
    overlay.onCancel = { cancelled = true; done = true }

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
    if let result { return .selected(result) }
    return cancelled ? .cancelled : .timedOut
}

// MARK: - Command: list (spatial topology)

@available(macOS 14.0, *)
func buildSpatialTopology(displayTopology: AOSDisplayTopologySnapshot) -> SpatialTopology {
    let displays = getCaptureDisplays(from: displayTopology)

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

    let unionOrigin = displayTopology.desktopWorldOriginNative

    // Cursor
    let cursorPt = mouseInCGCoords()
    let cursorDisplay = displays.first(where: { $0.bounds.contains(cursorPt) }) ?? displays.first(where: { $0.isMain })!
    let stCursor = STCursor(
        x: cursorPt.x,
        y: cursorPt.y,
        desktop_world_x: cursorPt.x - Double(unionOrigin.x),
        desktop_world_y: cursorPt.y - Double(unionOrigin.y),
        display: cursorDisplay.ordinal
    )

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
    let stDisplays: [STDisplay] = displayTopology.displays.map { display in
        func stBounds(_ bounds: AOSDisplayTopologyBounds) -> STBounds {
            STBounds(x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height)
        }
        let nativeBounds = stBounds(display.nativeBounds)
        let visibleBounds = stBounds(display.nativeVisibleBounds)
        return STDisplay(
            display_id: Int(display.runtimeDisplayID),
            display_uuid: display.runtimeDisplayUUID,
            ordinal: display.ordinal,
            label: display.runtimeLabel == "Display" ? "Display \(display.ordinal)" : display.runtimeLabel,
            is_main: display.isMain,
            bounds: nativeBounds,
            visible_bounds: visibleBounds,
            native_bounds: nativeBounds,
            native_visible_bounds: visibleBounds,
            desktop_world_bounds: stBounds(display.desktopWorldBounds),
            visible_desktop_world_bounds: stBounds(display.visibleDesktopWorldBounds),
            scale_factor: display.scaleFactor,
            rotation: display.rotation,
            windows: windowsByDisplay[display.runtimeDisplayID] ?? []
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

    let desktopWorldUnion = STBounds(
        x: displayTopology.desktopWorldBounds.x,
        y: displayTopology.desktopWorldBounds.y,
        width: displayTopology.desktopWorldBounds.width,
        height: displayTopology.desktopWorldBounds.height
    )
    let visibleDesktopWorldUnion = STBounds(
        x: displayTopology.visibleDesktopWorldBounds.x,
        y: displayTopology.visibleDesktopWorldBounds.y,
        width: displayTopology.visibleDesktopWorldBounds.width,
        height: displayTopology.visibleDesktopWorldBounds.height
    )

    let topology = SpatialTopology(
        schema: "spatial-topology",
        version: "0.3.0",
        timestamp: iso8601.string(from: Date()),
        display_topology: displayTopology,
        screens_have_separate_spaces: displayTopology.screensHaveSeparateSpaces,
        cursor: stCursor,
        focused_window_id: focusedWinID.map { Int($0) },
        focused_app: focusedApp,
        displays: stDisplays,
        desktop_world_bounds: desktopWorldUnion,
        visible_desktop_world_bounds: visibleDesktopWorldUnion,
        apps: stApps
    )
    return topology
}

@available(macOS 14.0, *)
func seeListCommand() {
    let displayTopology = observeDisplayTopologySnapshot()
    print(jsonString(buildSpatialTopology(displayTopology: displayTopology)))
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
    if let pid = matchedPID, AXIsProcessTrusted(), let hit = axElementAtPoint(pid: pid, point: cursorPt) {
        matchedElement = CursorElementJSON(
            role: hit.role,
            title: hit.title,
            label: hit.label,
            value: hit.value,
            enabled: hit.enabled,
            action_names: hit.actionNames,
            settable_attributes: hit.settableAttributeNames,
            bounds: hit.bounds.map { STBounds(x: $0.origin.x, y: $0.origin.y, width: $0.size.width, height: $0.size.height) },
            ancestor_chain: axAncestorJSONs(hit.ancestorChain)
        )
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
/// Handle `aos see capture browser:<session>[/<ref>]`. Xray-only runs snapshot
/// (no bounds). `--label` runs snapshot + per-ref eval for bounds and composes
/// a badge overlay over a PNG. Errors from version check, target parse, and
/// subprocess propagate as structured codes.
func captureBrowserTarget(opts: CaptureOptions) async {
    do {
        let bt = try parseBrowserTarget(opts.target)
        if let point = opts.browserDomPoint {
            let response = try seeCaptureBrowserDomElementTarget(
                target: bt,
                point: point,
                contentRect: opts.browserContentRect
            )
            print(response)
            return
        }
        if opts.xray {
            var elements = try seeCaptureXray(target: bt, withBounds: opts.label)
            var resp = SuccessResponse()
            let stateID = makeAOSStateID()
            resp.state_id = stateID
            for index in elements.indices {
                if let ref = elements[index].ref {
                    elements[index].handle = TargetHandleJSON.browser(
                        session: bt.session,
                        stateID: stateID,
                        ref: ref
                    )
                }
            }
            resp.elements = elements
            if opts.label {
                let anns = buildAnnotations(from: elements)
                resp.annotations = anns
                let dst = opts.resolvedOutputPath
                _ = try seeCaptureScreenshot(target: bt, outPath: dst)
                if let base = CGDataProvider(url: URL(fileURLWithPath: dst) as CFURL).flatMap({
                    CGImage(pngDataProviderSource: $0, decode: nil, shouldInterpolate: true, intent: .defaultIntent)
                }) {
                    let badgeHTML = generateBadgeHTML(annotations: anns, width: base.width, height: base.height, scaleFactor: 1.0)
                    var composited = base
                    if let overlay = renderHTMLToBitmap(html: badgeHTML, width: base.width, height: base.height) {
                        composited = compositeOverlay(overlay, onto: base)
                    }
                    _ = writeImage(composited, to: dst, format: .png, quality: 1.0)
                }
                resp.files = [dst]
            }
            print(jsonString(resp))
            return
        }

        // Screenshot-only path
        let dst = opts.resolvedOutputPath
        _ = try seeCaptureScreenshot(target: bt, outPath: dst)
        var resp = SuccessResponse()
        resp.state_id = makeAOSStateID()
        resp.files = [dst]
        print(jsonString(resp))
        return
    } catch BrowserTargetError.missingSession {
        exitError("PLAYWRIGHT_CLI_SESSION not set", code: "MISSING_SESSION")
    } catch BrowserTargetError.invalid(let msg) {
        exitError("invalid browser target: \(msg)", code: "INVALID_TARGET")
    } catch BrowserAdapterError.versionCheckFailed(let msg, let code) {
        exitError(msg, code: code)
    } catch BrowserAdapterError.subprocess(let msg, let code) {
        exitError(msg, code: code)
    } catch BrowserAdapterError.invalidTarget(let msg) {
        exitError("invalid browser target: \(msg)", code: "INVALID_TARGET")
    } catch BrowserAdapterError.notLocalBrowser(let msg) {
        exitError(msg, code: "NOT_LOCAL_BROWSER")
    } catch {
        exitError("\(error)", code: "INTERNAL")
    }
}

func captureCommand(args: [String]) async {
    var opts = parseCaptureArgs(args)
    let fmt = resolveUTType(for: opts.format)
    let quality = resolveQuality(for: opts.quality)

    // ── Browser target dispatch ──
    // Browser targets route through BrowserAdapter (snapshot + screenshot via
    // @playwright/cli), bypassing ScreenCaptureKit, AX permissions, zone
    // resolution, and all the local-sensor plumbing below.
    if opts.target.hasPrefix("browser:") {
        await captureBrowserTarget(opts: opts)
        return
    }

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

    let displayTopologySnapshot = observeDisplayTopologySnapshot()
    let displays = getCaptureDisplays(from: displayTopologySnapshot)
    let captureWindows = observeCaptureWindowFacts()
    var explicitSurface = resolveCaptureSurface(opts: opts, displays: displays)

    // ── Resolve target ──
    var targetDisplayIDs: [CGDirectDisplayID] = []
    var specificWindow: CaptureWindowFact? = nil
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
            guard let w = largestWindow(for: app.processIdentifier, in: captureWindows) else {
                exitError("No window for active app '\(app.localizedName ?? "?")'", code: "NO_WINDOW")
            }
            specificWindow = w
            targetDisplayIDs = [displayForWindow(w, displays: displays).cgID]

        case "selfie":
            guard let w = selfieWindow(windows: captureWindows) else {
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

    // ── Interactive bounds selection ──
    // The overlay selects only frozen display-local points. Pixels still flow
    // through the canonical validated region capture path below.
    var interactiveBounds: BoundsJSON? = nil
    if opts.interactive {
        if opts.crop != nil {
            exitError("--interactive cannot resolve with a crop", code: "INVALID_ARG")
        }
        guard targetDisplayIDs.count == 1,
              let selectedDisplay = displays.first(where: { $0.cgID == targetDisplayIDs[0] }),
              let mainDisplay = displays.first(where: \.isMain)
        else {
            exitError("--interactive requires exactly one resolved display", code: "INVALID_ARG")
        }

        let localSelection: NSRect
        switch showInteractiveSelection(
            on: selectedDisplay,
            mainDisplayHeight: mainDisplay.bounds.height,
            timeout: opts.timeout
        ) {
        case .selected(let bounds):
            localSelection = bounds.integral
        case .cancelled:
            exitError("Interactive selection cancelled", code: "SELECTION_CANCELLED")
        case .timedOut:
            exitError("Interactive selection timed out", code: "TIMEOUT")
        }

        let selectedGlobalBounds: AOSDisplayTopologyBounds
        do {
            selectedGlobalBounds = try aosInteractiveSelectionGlobalBounds(
                localSelection: AOSDisplayTopologyBounds(
                    x: localSelection.origin.x,
                    y: localSelection.origin.y,
                    width: localSelection.width,
                    height: localSelection.height
                ),
                displayNativeBounds: AOSDisplayTopologyBounds(
                    x: selectedDisplay.bounds.origin.x,
                    y: selectedDisplay.bounds.origin.y,
                    width: selectedDisplay.bounds.width,
                    height: selectedDisplay.bounds.height
                )
            )
        } catch {
            exitError("Invalid interactive selection: \(error)", code: "INVALID_ARG")
        }
        let globalBounds = CGRect(
            x: selectedGlobalBounds.x,
            y: selectedGlobalBounds.y,
            width: selectedGlobalBounds.width,
            height: selectedGlobalBounds.height
        ).integral
        explicitSurface = CaptureSurfaceSelection(
            kind: "region",
            id: nil,
            globalBounds: globalBounds,
            windowID: nil,
            windowPID: nil,
            segments: resolveSurfaceSegments(globalBounds, displays: displays)
        )
    }

    var exactChannelCapture: ResolvedExactChannelCapture? = nil
    if let surface = explicitSurface {
        do {
            if let plan = try aosExactChannelCapturePlan(
                surface: AOSExactChannelCaptureSurface(
                    kind: surface.kind,
                    windowID: surface.windowID,
                    ownerPID: surface.windowPID
                ),
                windows: captureWindows.map {
                    AOSExactChannelCaptureWindow(
                        windowID: $0.windowID,
                        ownerPID: $0.owningApplication.map { Int($0.processID) },
                        layer: $0.windowLayer,
                        frame: $0.frame
                    )
                },
                displays: displays.map {
                    AOSExactChannelCaptureDisplay(
                        displayID: $0.cgID,
                        bounds: $0.bounds,
                        scaleFactor: $0.scaleFactor,
                        mirrored: $0.isMirrored
                    )
                }
            ) {
                guard let window = captureWindows.first(where: { $0.windowID == plan.windowID }),
                      let display = displays.first(where: { $0.cgID == plan.displayID }) else {
                    exitError("Exact channel window capture plan lost its observed target", code: "CAPTURE_TOPOLOGY_MISMATCH")
                }
                let resolvedSurface = CaptureSurfaceSelection(
                    kind: surface.kind,
                    id: surface.id,
                    globalBounds: plan.globalBounds,
                    windowID: plan.windowID,
                    windowPID: plan.ownerPID,
                    segments: resolveSurfaceSegments(plan.globalBounds, displays: displays)
                )
                explicitSurface = resolvedSurface
                exactChannelCapture = ResolvedExactChannelCapture(
                    plan: plan,
                    display: display,
                    window: window
                )
            }
        } catch AOSExactChannelCapturePlanError.missingIdentity {
            exitError("Channel is missing exact window identity", code: "CHANNEL_STALE")
        } catch AOSExactChannelCapturePlanError.windowNotFound {
            exitError("Channel window is no longer available", code: "WINDOW_NOT_FOUND")
        } catch AOSExactChannelCapturePlanError.ownerMismatch {
            exitError("Channel window owner changed", code: "CHANNEL_STALE")
        } catch {
            exitError("Channel window identity is not uniquely capturable", code: "CAPTURE_TOPOLOGY_MISMATCH")
        }
    }

    let selectedCaptureDisplayIDs = (exactChannelCapture.map { [$0.display.cgID] }
        ?? explicitSurface?.segments.map { $0.display.cgID }
        ?? targetDisplayIDs).reduce(into: [CGDirectDisplayID]()) { ordered, id in
        if !ordered.contains(id) { ordered.append(id) }
    }
    var capturedWindowsByDisplay: [CGDirectDisplayID: CaptureWindowFact] = [:]
    if let exactChannelCapture {
        capturedWindowsByDisplay[exactChannelCapture.display.cgID] = exactChannelCapture.window
    } else if opts.windowOnly {
        for (index, displayID) in selectedCaptureDisplayIDs.enumerated() {
            guard let entry = displays.first(where: { $0.cgID == displayID }) else {
                exitError("Capture display is absent from frozen topology", code: "CAPTURE_TOPOLOGY_MISMATCH")
            }
            let window = (index == 0 ? specificWindow : nil)
                ?? largestWindowOnDisplay(
                    entry,
                    in: captureWindows,
                    preferPID: NSWorkspace.shared.frontmostApplication?.processIdentifier
                )
            if let window,
               window.frame.width >= 10,
               window.frame.height >= 10 {
                capturedWindowsByDisplay[displayID] = window
            } else {
                responseWarning = "Window capture was unavailable; returned the full display."
            }
        }
    }
    var windowTargetsByDisplay: [CGDirectDisplayID: AOSDesktopPixelWindowTarget] = [:]
    for displayID in Array(capturedWindowsByDisplay.keys) {
        guard let window = capturedWindowsByDisplay[displayID] else { continue }
        guard let ownerPID = window.owningApplication.map({ Int($0.processID) }),
              ownerPID > 0 else {
            if exactChannelCapture != nil {
                exitError("Exact channel window owner is unavailable", code: "CHANNEL_STALE")
            }
            capturedWindowsByDisplay.removeValue(forKey: displayID)
            responseWarning = "Window capture was unavailable; returned the full display."
            continue
        }
        windowTargetsByDisplay[displayID] = AOSDesktopPixelWindowTarget(
            windowID: window.windowID,
            ownerPID: ownerPID,
            expectedBounds: window.frame.integral,
            fallback: exactChannelCapture == nil ? .display : .none
        )
    }
    let nativeCapture = captureNativeFramesThroughDaemon(
        topology: displayTopologySnapshot,
        selectedDisplayIDs: selectedCaptureDisplayIDs,
        excludedWindowIDs: opts.excludedWindowIDs,
        windowTargetsByDisplay: windowTargetsByDisplay,
        showsCursor: opts.showCursor
    )
    if let exactChannelCapture,
       nativeCapture.usedDisplayFallback.contains(exactChannelCapture.display.cgID) {
        exitError("Exact channel window pixels were unavailable", code: "CAPTURE_FAILED")
    }
    for displayID in nativeCapture.usedDisplayFallback {
        capturedWindowsByDisplay.removeValue(forKey: displayID)
        responseWarning = "Window capture was unavailable; returned the full display."
    }
    let nativeImages = nativeCapture.images

    // ── Capture loop ──
    var results: [(CGImage, String)] = []
    var responseCursor: CursorJSON? = nil
    var responseClickX: Int? = nil
    var responseClickY: Int? = nil
    var responseElements: [AXElementJSON]? = nil
    var responseSemanticTargets: [AOSSemanticTargetJSON]? = nil
    var responseAnnotations: [AnnotationJSON]? = nil
    var responseWindow: CaptureWindowJSON? = nil
    var responseSurfaces: [CaptureSurfaceJSON] = []
    let topologySnapshot = opts.perception
        ? buildSpatialTopology(displayTopology: displayTopologySnapshot)
        : nil
    var responsePerceptions: [CapturePerceptionJSON] = []

    if let surface = explicitSurface {
        let captureScale = exactChannelCapture?.plan.captureScaleFactor
            ?? max(surface.segments.map { $0.display.scaleFactor }.max() ?? 1.0, 1.0)
        var image: CGImage
        if let exactChannelCapture {
            guard let windowImage = nativeImages[exactChannelCapture.display.cgID] else {
                exitError("Exact channel window capture is incomplete", code: "CAPTURE_FAILED")
            }
            let expectedWidth = Int((surface.globalBounds.width * captureScale).rounded())
            let expectedHeight = Int((surface.globalBounds.height * captureScale).rounded())
            guard windowImage.width == expectedWidth,
                  windowImage.height == expectedHeight else {
                exitError("Exact channel window geometry disagrees with the captured frame", code: "CAPTURE_TOPOLOGY_MISMATCH")
            }
            image = windowImage
        } else {
            let stitchedRect = CGRect(
                x: 0,
                y: 0,
                width: surface.globalBounds.width * captureScale,
                height: surface.globalBounds.height * captureScale
            ).integral
            var capturedSegments: [CapturedSurfaceSegment] = []
            for segment in surface.segments {
                guard let displayImage = nativeImages[segment.display.cgID] else {
                    exitError("Display capture is incomplete", code: "CAPTURE_FAILED")
                }

                let pixelRect = capturePixelRect(globalRect: segment.globalBounds, in: segment.display)
                let cropped = cropImage(displayImage, to: pixelRect)
                let localRect = captureLocalRect(globalRect: segment.globalBounds, within: surface.globalBounds, scaleFactor: captureScale)
                capturedSegments.append(CapturedSurfaceSegment(segment: segment, image: cropped, localRect: localRect))
            }
            image = stitchSurfaceSegments(capturedSegments, canvasSize: stitchedRect.size)
        }
        if opts.interactive {
            interactiveBounds = BoundsJSON(x: 0, y: 0, width: image.width, height: image.height)
        }
        let mapper = CoordinateMapper(
            displayOrigin: surface.globalBounds.origin,
            scaleFactor: captureScale,
            cropRect: nil,
            windowFrame: nil
        )
        let imageSize = CGSize(width: image.width, height: image.height)

        if responseWindow == nil,
           let windowID = surface.windowID,
           let sw = captureWindows.first(where: { $0.windowID == windowID }) {
            let scale = displayForWindow(sw, displays: displays).scaleFactor
            responseWindow = CaptureWindowJSON(
                window_id: sw.windowID,
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
            if let exactChannelCapture {
                guard let elements = xrayWindow(
                    pid: pid_t(exactChannelCapture.plan.ownerPID),
                    appName: exactChannelCapture.window.owningApplication?.applicationName ?? "",
                    windowID: exactChannelCapture.plan.windowID,
                    mapper: mapper,
                    imageSize: imageSize
                ) else {
                    exitError("Exact channel AX window is unavailable", code: "WINDOW_NOT_FOUND")
                }
                responseElements = elements
            } else if let windowID = surface.windowID,
               let ownerApp = captureWindows.first(where: { $0.windowID == windowID })?.owningApplication {
                responseElements = xrayApp(
                    pid: ownerApp.processID,
                    appName: ownerApp.applicationName,
                    mapper: mapper,
                    imageSize: imageSize
                )
            } else {
                responseElements = xrayAppsIntersectingCapture(
                    windows: captureWindows,
                    captureRect: surface.globalBounds,
                    mapper: mapper,
                    imageSize: imageSize,
                    preferredPID: NSWorkspace.shared.frontmostApplication?.processIdentifier
                )
            }
            if surface.kind == "canvas", let canvasID = surface.id {
                responseSemanticTargets = collectCanvasSemanticTargets(canvasID: canvasID, scaleFactor: captureScale)
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
            guard let entry = displays.first(where: { $0.cgID == cgID }) else { continue }
            guard var image = nativeImages[cgID] else {
                exitError("Display capture is incomplete", code: "CAPTURE_FAILED")
            }
            let capturedWindow = capturedWindowsByDisplay[cgID]
            if capturedWindow == nil {
                do {
                    try validateAOSCapturedDisplayPixelGeometry(
                        alignment: AOSDisplayCaptureAlignment(
                            runtimeDisplayID: cgID,
                            expectedPixelWidth: Int((entry.bounds.width * entry.scaleFactor).rounded()),
                            expectedPixelHeight: Int((entry.bounds.height * entry.scaleFactor).rounded())
                        ),
                        actualWidth: image.width,
                        actualHeight: image.height
                    )
                } catch {
                    exitError("Capture geometry disagrees with frozen topology", code: "CAPTURE_TOPOLOGY_MISMATCH")
                }
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
            let captureRect = globalCaptureRect(display: entry, windowFrame: windowFrame, cropRect: cropRect)
            if responseWindow == nil, let sw = capturedWindow {
                responseWindow = CaptureWindowJSON(
                    window_id: sw.windowID,
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
                    responseElements = xrayAppsIntersectingCapture(
                        windows: captureWindows,
                        captureRect: captureRect,
                        mapper: mapper,
                        imageSize: imageSize,
                        preferredPID: NSWorkspace.shared.frontmostApplication?.processIdentifier
                    )
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
                        windowPID: sw.owningApplication.map { Int($0.processID) },
                        segments: [CaptureSurfaceSegmentSelection(display: entry, globalBounds: sw.frame.integral)]
                    )
                }
                return CaptureSurfaceSelection(
                    kind: "display",
                    id: opts.target == "all" ? "display-\(entry.ordinal)" : opts.target,
                    globalBounds: captureRect,
                    windowID: nil,
                    windowPID: nil,
                    segments: [CaptureSurfaceSegmentSelection(display: entry, globalBounds: captureRect)]
                )
            }()
            let surfaceJSON = captureSurfaceJSON(selection: surfaceSelection, imageSize: imageSize, scaleFactor: entry.scaleFactor)
            responseSurfaces.append(surfaceJSON)

            if let topology = topologySnapshot {
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
        resp.state_id = makeAOSStateID()
        if opts.region != nil || opts.interactive {
            resp.display_topology = displayTopologySnapshot
        }
        resp.cursor = responseCursor
        resp.bounds = interactiveBounds
        resp.click_x = responseClickX
        resp.click_y = responseClickY
        resp.warning = responseWarning
        resp.elements = responseElements
        resp.semantic_targets = responseSemanticTargets
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
