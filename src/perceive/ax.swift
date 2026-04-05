// ax.swift — Accessibility API utility functions

import ApplicationServices
import Foundation

// MARK: - AX Attribute Helpers

func axString(_ element: AXUIElement, _ attribute: String) -> String? {
    var value: AnyObject?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else { return nil }
    return value as? String
}

func axBool(_ element: AXUIElement, _ attribute: String) -> Bool? {
    var value: AnyObject?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else { return nil }
    return (value as? NSNumber)?.boolValue
}

func axInt(_ element: AXUIElement, _ attribute: String) -> Int? {
    var value: AnyObject?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else { return nil }
    return (value as? NSNumber)?.intValue
}

func axValue(_ element: AXUIElement) -> String? {
    var valRef: AnyObject?
    guard AXUIElementCopyAttributeValue(element, kAXValueAttribute as CFString, &valRef) == .success else { return nil }
    if let s = valRef as? String {
        return s.count > 200 ? String(s.prefix(200)) + "..." : s
    } else if let n = valRef as? NSNumber {
        return n.stringValue
    }
    return nil
}

func axChildren(_ element: AXUIElement) -> [AXUIElement] {
    var value: AnyObject?
    guard AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &value) == .success,
          let children = value as? [AXUIElement] else { return [] }
    return children
}

func axParent(_ element: AXUIElement) -> AXUIElement? {
    var value: AnyObject?
    guard AXUIElementCopyAttributeValue(element, kAXParentAttribute as CFString, &value) == .success else { return nil }
    // The returned value is an AXUIElement (opaque CFTypeRef)
    return (value as! AXUIElement)
}

func axBounds(_ element: AXUIElement) -> CGRect? {
    var posValue: AnyObject?
    var sizeValue: AnyObject?
    guard AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &posValue) == .success,
          AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sizeValue) == .success else { return nil }
    var pos = CGPoint.zero
    var size = CGSize.zero
    guard AXValueGetValue(posValue as! AXValue, .cgPoint, &pos),
          AXValueGetValue(sizeValue as! AXValue, .cgSize, &size) else { return nil }
    return CGRect(origin: pos, size: size)
}

func axActions(_ element: AXUIElement) -> [String] {
    var names: CFArray?
    guard AXUIElementCopyActionNames(element, &names) == .success, let arr = names as? [String] else { return [] }
    return arr
}

// MARK: - Context Path

/// Walk up the AX tree to build a breadcrumb path like ["Finder", "Main Window", "Toolbar", "Open"].
func axContextPath(_ element: AXUIElement, maxDepth: Int = 6) -> [String] {
    var path: [String] = []
    var current: AXUIElement? = element
    var depth = 0
    while let el = current, depth < maxDepth {
        let role = axString(el, kAXRoleAttribute) ?? ""
        let title = axString(el, kAXTitleAttribute)
        let label = axString(el, kAXDescriptionAttribute)
        let name = title ?? label ?? role
        if !name.isEmpty { path.insert(name, at: 0) }
        current = axParent(el)
        depth += 1
    }
    return path
}

// MARK: - Element at Point

struct AXHitResult {
    let element: AXUIElement
    let role: String
    let title: String?
    let label: String?
    let value: String?
    let enabled: Bool
    let bounds: CGRect?
    let contextPath: [String]
}

/// Hit-test the AX tree at a global CG point for a given app PID.
func axElementAtPoint(pid: pid_t, point: CGPoint) -> AXHitResult? {
    let axApp = AXUIElementCreateApplication(pid)
    var elementRef: AXUIElement?
    let result = AXUIElementCopyElementAtPosition(axApp, Float(point.x), Float(point.y), &elementRef)
    guard result == .success, let el = elementRef else { return nil }

    return AXHitResult(
        element: el,
        role: axString(el, kAXRoleAttribute) ?? "unknown",
        title: axString(el, kAXTitleAttribute),
        label: axString(el, kAXDescriptionAttribute),
        value: axValue(el),
        enabled: axBool(el, kAXEnabledAttribute) ?? true,
        bounds: axBounds(el),
        contextPath: axContextPath(el)
    )
}
