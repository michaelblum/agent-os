// helpers.swift — JSON output, key codes, arg parsing, math utilities

import ApplicationServices
import CoreGraphics
import Foundation

// MARK: - JSON Output

let jsonEncoder: JSONEncoder = {
    let enc = JSONEncoder()
    enc.outputFormatting = [.sortedKeys]
    return enc
}()

func writeJSON<T: Encodable>(_ value: T, to handle: FileHandle = .standardOutput) {
    guard let data = try? jsonEncoder.encode(value),
          let s = String(data: data, encoding: .utf8) else { return }
    handle.write((s + "\n").data(using: .utf8)!)
}

func exitWithError(_ message: String, code: String) -> Never {
    let obj: [String: String] = ["error": message, "code": code]
    if let data = try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys]),
       let s = String(data: data, encoding: .utf8) {
        FileHandle.standardError.write((s + "\n").data(using: .utf8)!)
    }
    exit(1)
}

// MARK: - Arg Parsing (CLI mode)

func getArg(_ args: [String], _ flag: String) -> String? {
    guard let idx = args.firstIndex(of: flag), idx + 1 < args.count else { return nil }
    return args[idx + 1]
}

func hasFlag(_ args: [String], _ flag: String) -> Bool {
    args.contains(flag)
}

func parseInt(_ s: String?) -> Int? {
    guard let s = s else { return nil }
    return Int(s)
}

func parseDouble(_ s: String?) -> Double? {
    guard let s = s else { return nil }
    return Double(s)
}

func parseCoords(_ s: String) -> (Double, Double)? {
    let parts = s.split(separator: ",").map(String.init)
    guard parts.count == 2, let x = Double(parts[0]), let y = Double(parts[1]) else { return nil }
    return (x, y)
}

// MARK: - Key Code Mapping

let keyCodeMap: [String: CGKeyCode] = [
    // Letters
    "a": 0x00, "b": 0x0B, "c": 0x08, "d": 0x02, "e": 0x0E,
    "f": 0x03, "g": 0x05, "h": 0x04, "i": 0x22, "j": 0x26,
    "k": 0x28, "l": 0x25, "m": 0x2E, "n": 0x2D, "o": 0x1F,
    "p": 0x23, "q": 0x0C, "r": 0x0F, "s": 0x01, "t": 0x11,
    "u": 0x20, "v": 0x09, "w": 0x0D, "x": 0x07, "y": 0x10,
    "z": 0x06,
    // Numbers
    "0": 0x1D, "1": 0x12, "2": 0x13, "3": 0x14, "4": 0x15,
    "5": 0x17, "6": 0x16, "7": 0x1A, "8": 0x1C, "9": 0x19,
    // Special keys
    "return": 0x24, "enter": 0x24, "tab": 0x30, "space": 0x31,
    "delete": 0x33, "backspace": 0x33, "escape": 0x35, "esc": 0x35,
    "up": 0x7E, "down": 0x7D, "left": 0x7B, "right": 0x7C,
    "home": 0x73, "end": 0x77, "pageup": 0x74, "pagedown": 0x79,
    "f1": 0x7A, "f2": 0x78, "f3": 0x63, "f4": 0x76,
    "f5": 0x60, "f6": 0x61, "f7": 0x62, "f8": 0x64,
    "f9": 0x65, "f10": 0x6D, "f11": 0x67, "f12": 0x6F,
    // Punctuation
    "-": 0x1B, "=": 0x18, "[": 0x21, "]": 0x1E,
    "\\": 0x2A, ";": 0x29, "'": 0x27, ",": 0x2B,
    ".": 0x2F, "/": 0x2C, "`": 0x32,
]

/// Modifier name -> (CGKeyCode for key_down/key_up, CGEventFlags for flag masking)
let modifierMap: [String: (keyCode: CGKeyCode, flag: CGEventFlags)] = [
    "cmd":     (0x37, .maskCommand),
    "command": (0x37, .maskCommand),
    "shift":   (0x38, .maskShift),
    "alt":     (0x3A, .maskAlternate),
    "option":  (0x3A, .maskAlternate),
    "opt":     (0x3A, .maskAlternate),
    "ctrl":    (0x3B, .maskControl),
    "control": (0x3B, .maskControl),
    "fn":      (0x3F, .maskSecondaryFn),
]

/// Parse "cmd+shift+tab" -> (keyCode, flags) for the non-modifier key, with modifier flags combined.
func parseKeyCombo(_ combo: String) -> (CGKeyCode, CGEventFlags)? {
    let parts = combo.lowercased().split(separator: "+").map(String.init)
    var flags: CGEventFlags = []
    var keyName: String?

    for part in parts {
        if let mod = modifierMap[part] {
            flags.insert(mod.flag)
        } else {
            keyName = part
        }
    }

    guard let key = keyName, let keyCode = keyCodeMap[key] else { return nil }
    return (keyCode, flags)
}

/// Modifier name -> CGEventFlags (for building the flags mask from held modifiers).
func flagsForModifier(_ name: String) -> CGEventFlags? {
    return modifierMap[name]?.flag
}

// MARK: - Timing Math

/// Sample a random delay from a DelayRange using the specified distribution.
/// Returns microseconds (for usleep).
func sampleDelay(_ range: DelayRange) -> UInt32 {
    let lo = Double(range.min)
    let hi = Double(range.max)
    guard lo < hi else { return UInt32(lo) * 1000 }

    let value: Double
    switch range.distribution {
    case "gaussian":
        // Box-Muller transform, clamped to [min, max]
        let mid = (lo + hi) / 2.0
        let sigma = (hi - lo) / 6.0 // 99.7% within range
        let u1 = Double.random(in: 0.001...1.0)
        let u2 = Double.random(in: 0.0...1.0)
        let z = sqrt(-2.0 * log(u1)) * cos(2.0 * .pi * u2)
        value = min(hi, max(lo, mid + z * sigma))
    default: // "uniform" or unspecified
        value = Double.random(in: lo...hi)
    }
    return UInt32(value) * 1000 // ms -> microseconds
}

// MARK: - Bezier Curve Math

/// Generate points along a cubic Bezier from `start` to `end` with overshoot and jitter.
func bezierPath(from start: CGPoint, to end: CGPoint, steps: Int, overshoot: Double, jitter: Double) -> [CGPoint] {
    guard steps > 0 else { return [end] }

    let dx = end.x - start.x
    let dy = end.y - start.y
    let dist = sqrt(dx * dx + dy * dy)
    guard dist > 1.0 else { return [end] }

    // Control points: offset perpendicular to the line for a natural curve
    let perpX = -dy / dist
    let perpY = dx / dist
    let curvature = Double.random(in: 0.1...0.4) * Double(dist)
    let side: Double = Bool.random() ? 1.0 : -1.0

    let cp1 = CGPoint(
        x: Double(start.x) + Double(dx) * 0.3 + Double(perpX) * curvature * side,
        y: Double(start.y) + Double(dy) * 0.3 + Double(perpY) * curvature * side
    )

    // Overshoot target
    let overshootDist = Double(dist) * overshoot
    let cp2 = CGPoint(
        x: Double(end.x) + Double(dx / dist) * overshootDist - Double(dx) * 0.1,
        y: Double(end.y) + Double(dy / dist) * overshootDist - Double(dy) * 0.1
    )

    var points: [CGPoint] = []
    for i in 1...steps {
        let t = Double(i) / Double(steps)
        let u = 1.0 - t
        let bx = u*u*u*Double(start.x) + 3*u*u*t*Double(cp1.x) + 3*u*t*t*Double(cp2.x) + t*t*t*Double(end.x)
        let by = u*u*u*Double(start.y) + 3*u*u*t*Double(cp1.y) + 3*u*t*t*Double(cp2.y) + t*t*t*Double(end.y)

        let jx = jitter > 0 ? Double.random(in: -jitter...jitter) : 0
        let jy = jitter > 0 ? Double.random(in: -jitter...jitter) : 0

        points.append(CGPoint(x: bx + jx, y: by + jy))
    }

    // Final point is exactly the target (no jitter)
    if !points.isEmpty {
        points[points.count - 1] = end
    }

    return points
}

// MARK: - AX Helpers

func axString(_ element: AXUIElement, _ attr: String) -> String? {
    var ref: AnyObject?
    guard AXUIElementCopyAttributeValue(element, attr as CFString, &ref) == .success else { return nil }
    return ref as? String
}

func axChildren(_ element: AXUIElement) -> [AXUIElement] {
    var ref: AnyObject?
    guard AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &ref) == .success,
          let children = ref as? [AXUIElement] else { return [] }
    return children
}

func axActions(_ element: AXUIElement) -> [String] {
    var ref: CFArray?
    guard AXUIElementCopyActionNames(element, &ref) == .success,
          let names = ref as? [String] else { return [] }
    return names
}

func axBounds(_ element: AXUIElement) -> CGRect? {
    var posRef: AnyObject?
    var sizeRef: AnyObject?
    guard AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &posRef) == .success,
          AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sizeRef) == .success else {
        return nil
    }
    var pos = CGPoint.zero
    var size = CGSize.zero
    guard AXValueGetValue(posRef as! AXValue, .cgPoint, &pos),
          AXValueGetValue(sizeRef as! AXValue, .cgSize, &size) else { return nil }
    return CGRect(origin: pos, size: size)
}

// Undocumented but stable API to get CGWindowID from AXUIElement
@_silgen_name("_AXUIElementGetWindow")
func _AXUIElementGetWindow(_ element: AXUIElement, _ windowID: UnsafeMutablePointer<CGWindowID>) -> AXError

/// Find a window by CGWindowID for a given pid.
func findWindowByID(pid: pid_t, windowID: Int) -> AXUIElement? {
    let app = AXUIElementCreateApplication(pid)
    var ref: AnyObject?
    guard AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &ref) == .success,
          let windows = ref as? [AXUIElement] else { return nil }
    for win in windows {
        var winID: CGWindowID = 0
        if _AXUIElementGetWindow(win, &winID) == .success && Int(winID) == windowID {
            return win
        }
    }
    return nil
}

/// Find the first window for a given pid.
func findFirstWindow(pid: pid_t) -> AXUIElement? {
    let app = AXUIElementCreateApplication(pid)
    var ref: AnyObject?
    guard AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &ref) == .success,
          let windows = ref as? [AXUIElement], let first = windows.first else { return nil }
    return first
}

// MARK: - Window Origin Lookup

/// Get a window's origin in global CG coordinates via CGWindowListCopyWindowInfo.
func windowOrigin(windowID: Int) -> CGPoint? {
    guard let infoList = CGWindowListCopyWindowInfo([.optionIncludingWindow], CGWindowID(windowID)) as? [[String: Any]],
          let info = infoList.first,
          let boundsDict = info[kCGWindowBounds as String] as? [String: Any],
          let x = boundsDict["X"] as? Double,
          let y = boundsDict["Y"] as? Double else { return nil }
    return CGPoint(x: x, y: y)
}
