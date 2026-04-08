// ax.swift — Accessibility API utility functions

import ApplicationServices
import Cocoa
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

// MARK: - Shared AX Utilities for Capture Pipeline

/// Alias for axBounds — used by capture pipeline code that calls it axFrame.
func axFrame(_ element: AXUIElement) -> CGRect? { axBounds(element) }

/// Roles considered actionable for agent consumption (--xray, channel traversal).
let xrayWhitelistRoles: Set<String> = [
    "AXButton", "AXTextField", "AXTextArea", "AXCheckBox",
    "AXRadioButton", "AXPopUpButton", "AXComboBox", "AXMenuItem",
    "AXMenuBarItem", "AXLink", "AXSlider", "AXIncrementor",
    "AXColorWell", "AXDisclosureTriangle", "AXTab", "AXStaticText",
    "AXSwitch", "AXToggle", "AXSearchField", "AXSecureTextField"
]

// MARK: - AX Traversal (--xray)

/// Recursively traverse AX tree, emitting whitelisted elements as a flat array.
func traverseAXElements(
    _ element: AXUIElement,
    mapper: CoordinateMapper,
    imageSize: CGSize,
    contextPath: [String],
    depth: Int,
    maxDepth: Int,
    results: inout [AXElementJSON]
) {
    guard depth < maxDepth else { return }

    let role = axString(element, kAXRoleAttribute) ?? ""
    let title = axString(element, kAXTitleAttribute)
    let label = axString(element, kAXDescriptionAttribute)
    let hidden = axBool(element, kAXHiddenAttribute) ?? false

    // Get value — truncate if excessively long
    var valueStr: String? = nil
    var valRef: AnyObject?
    if AXUIElementCopyAttributeValue(element, kAXValueAttribute as CFString, &valRef) == .success {
        if let s = valRef as? String {
            valueStr = s.count > 200 ? String(s.prefix(200)) + "..." : s
        } else if let n = valRef as? NSNumber {
            valueStr = n.stringValue
        }
    }

    let enabled = axBool(element, kAXEnabledAttribute) ?? true

    // Spatial check + emit if whitelisted
    if !hidden, let frame = axFrame(element), frame.width > 0, frame.height > 0 {
        if xrayWhitelistRoles.contains(role) {
            if let lcsRect = mapper.toLCS(globalRect: frame, imageSize: imageSize) {
                results.append(AXElementJSON(
                    role: role,
                    title: title,
                    label: label,
                    value: valueStr,
                    enabled: enabled,
                    context_path: contextPath,
                    bounds: BoundsJSON(
                        x: Int(lcsRect.origin.x), y: Int(lcsRect.origin.y),
                        width: max(1, Int(lcsRect.width)), height: max(1, Int(lcsRect.height))
                    )
                ))
            }
        }
    }

    // Build context path for children
    var childPath = contextPath
    if let t = title, !t.isEmpty { childPath.append(t) }
    else if let l = label, !l.isEmpty { childPath.append(l) }
    else if !role.isEmpty && role != "AXGroup" && role != "AXUnknown" && role != "AXSplitGroup"
            && role != "AXScrollArea" && role != "AXLayoutArea" {
        childPath.append(role)
    }

    // Recurse into children
    var childrenRef: AnyObject?
    guard AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &childrenRef) == .success,
          let children = childrenRef as? [AXUIElement] else { return }
    for child in children {
        traverseAXElements(child, mapper: mapper, imageSize: imageSize,
                          contextPath: childPath, depth: depth + 1,
                          maxDepth: maxDepth, results: &results)
    }
}

/// Run --xray on a specific app by PID, returning elements in LCS coordinates.
func xrayApp(pid: pid_t, appName: String, mapper: CoordinateMapper, imageSize: CGSize) -> [AXElementJSON] {
    let axApp = AXUIElementCreateApplication(pid)
    var results: [AXElementJSON] = []
    traverseAXElements(axApp, mapper: mapper, imageSize: imageSize,
                      contextPath: [appName], depth: 0, maxDepth: 15,
                      results: &results)
    return results
}

/// Run --xray on the frontmost app, returning elements in LCS coordinates.
func xrayFrontmostApp(mapper: CoordinateMapper, imageSize: CGSize) -> [AXElementJSON] {
    guard let frontApp = NSWorkspace.shared.frontmostApplication else { return [] }
    return xrayApp(pid: frontApp.processIdentifier, appName: frontApp.localizedName ?? "App",
                   mapper: mapper, imageSize: imageSize)
}
