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

func axAnyString(_ element: AXUIElement, _ attribute: String) -> String? {
    var value: AnyObject?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else { return nil }
    if let string = value as? String { return string }
    if let url = value as? URL { return url.absoluteString }
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

func axCapabilities(role: String, actions: [String], element: AXUIElement? = nil) -> [String] {
    var capabilities = Set<String>()
    if actions.contains(kAXPressAction as String) { capabilities.insert("press") }
    if actions.contains(kAXIncrementAction as String) { capabilities.insert("increment") }
    if actions.contains(kAXDecrementAction as String) { capabilities.insert("decrement") }
    if actions.contains(kAXShowMenuAction as String) { capabilities.insert("press") }

    switch role {
    case "AXButton", "AXCheckBox", "AXRadioButton", "AXPopUpButton", "AXMenuItem", "AXMenuBarItem", "AXLink":
        capabilities.insert("press")
    case "AXTextField", "AXTextArea", "AXComboBox":
        capabilities.insert("focus")
        capabilities.insert("set_value")
    case "AXSlider", "AXIncrementor":
        capabilities.insert("focus")
        capabilities.insert("increment")
        capabilities.insert("decrement")
    case "AXScrollArea":
        capabilities.insert("scroll")
    default:
        break
    }

    if let element {
        var settable = DarwinBoolean(false)
        if AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &settable) == .success, settable.boolValue {
            capabilities.insert("set_value")
        }
        if AXUIElementIsAttributeSettable(element, kAXFocusedAttribute as CFString, &settable) == .success, settable.boolValue {
            capabilities.insert("focus")
        }
    }

    return Array(capabilities).sorted()
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
    let actionNames: [String]
    let capabilities: [String]
    let contextPath: [String]
}

/// Hit-test the AX tree at a global CG point for a given app PID.
func axElementAtPoint(pid: pid_t, point: CGPoint) -> AXHitResult? {
    let axApp = AXUIElementCreateApplication(pid)
    var elementRef: AXUIElement?
    let result = AXUIElementCopyElementAtPosition(axApp, Float(point.x), Float(point.y), &elementRef)
    guard result == .success, let el = elementRef else { return nil }

    let role = axString(el, kAXRoleAttribute) ?? "unknown"
    let actions = axActions(el)
    return AXHitResult(
        element: el,
        role: role,
        title: axString(el, kAXTitleAttribute),
        label: axString(el, kAXDescriptionAttribute),
        value: axValue(el),
        enabled: axBool(el, kAXEnabledAttribute) ?? true,
        bounds: axBounds(el),
        actionNames: actions,
        capabilities: axCapabilities(role: role, actions: actions, element: el),
        contextPath: axContextPath(el)
    )
}

// MARK: - Browser AX Context

private func axLooksLikeBrowserApp(appName: String, bundleID: String?) -> Bool {
    let app = appName.lowercased()
    let bundle = (bundleID ?? "").lowercased()
    if app.contains("comet") || app.contains("chrome") || app.contains("safari")
        || app.contains("arc") || app.contains("brave") || app.contains("edge")
        || app.contains("firefox") {
        return true
    }
    return bundle.contains("chrome") || bundle.contains("safari") || bundle.contains("browser")
        || bundle.contains("brave") || bundle.contains("firefox") || bundle.contains("perplexity")
        || bundle.contains("comet") || bundle.contains("edgemac")
}

private func axLooksLikeURL(_ value: String?) -> Bool {
    guard let raw = value?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else { return false }
    let lower = raw.lowercased()
    return lower.hasPrefix("http://") || lower.hasPrefix("https://")
}

private func axRectPayload(_ rect: CGRect?) -> [String: Any]? {
    guard let rect else { return nil }
    return [
        "x": rect.origin.x,
        "y": rect.origin.y,
        "width": rect.size.width,
        "height": rect.size.height
    ]
}

private func axRectArea(_ rect: CGRect) -> CGFloat {
    max(0, rect.size.width) * max(0, rect.size.height)
}

private func axElementChildrenForTraversal(_ element: AXUIElement) -> [AXUIElement] {
    var children = axChildren(element)
    if children.isEmpty {
        var value: AnyObject?
        if AXUIElementCopyAttributeValue(element, "AXVisibleChildren" as CFString, &value) == .success,
           let visible = value as? [AXUIElement] {
            children = visible
        }
    }
    return children
}

func axBrowserContext(pid: pid_t, appName: String, bundleID: String?, point: CGPoint? = nil) -> [String: Any]? {
    guard axLooksLikeBrowserApp(appName: appName, bundleID: bundleID) else { return nil }

    let axApp = AXUIElementCreateApplication(pid)
    var roots: [AXUIElement] = []
    var focusedWindow: AnyObject?
    if AXUIElementCopyAttributeValue(axApp, kAXFocusedWindowAttribute as CFString, &focusedWindow) == .success,
       let window = focusedWindow {
        roots.append(window as! AXUIElement)
    }
    var windowsValue: AnyObject?
    if AXUIElementCopyAttributeValue(axApp, kAXWindowsAttribute as CFString, &windowsValue) == .success,
       let windows = windowsValue as? [AXUIElement] {
        roots.append(contentsOf: windows)
    }
    if roots.isEmpty {
        roots = axChildren(axApp)
    }

    var activeURL = ""
    var activeTabTitle = ""
    var pageTitle = ""
    var webAreaBounds: [CGRect] = []
    var windowBounds: CGRect?
    var queue = roots.map { ($0, 0) }
    var visited = 0
    let maxNodes = 700
    let maxDepth = 10

    while !queue.isEmpty && visited < maxNodes {
        let (element, depth) = queue.removeFirst()
        visited += 1

        let role = axString(element, kAXRoleAttribute) ?? ""
        let title = axString(element, kAXTitleAttribute) ?? ""
        let label = axString(element, kAXDescriptionAttribute) ?? ""
        let value = axValue(element) ?? ""
        let bounds = axBounds(element)

        if role == "AXWindow", windowBounds == nil {
            if let point, let bounds, bounds.contains(point) {
                windowBounds = bounds
            } else if point == nil {
                windowBounds = bounds
            }
        }

        if activeURL.isEmpty {
            let urlAttr = axAnyString(element, kAXURLAttribute)
            if axLooksLikeURL(urlAttr) {
                activeURL = urlAttr!.trimmingCharacters(in: .whitespacesAndNewlines)
            } else if axLooksLikeURL(value) {
                activeURL = value.trimmingCharacters(in: .whitespacesAndNewlines)
            } else if axLooksLikeURL(title) {
                activeURL = title.trimmingCharacters(in: .whitespacesAndNewlines)
            }
        }

        let selected = axBool(element, kAXSelectedAttribute) ?? false
        if activeTabTitle.isEmpty && selected && (role == "AXTab" || role == "AXRadioButton" || role == "AXButton") {
            activeTabTitle = [title, label, value].first(where: { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) ?? ""
        }

        if role == "AXWebArea" {
            if pageTitle.isEmpty {
                pageTitle = [title, label].first(where: { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) ?? ""
            }
            if let bounds, bounds.width > 0, bounds.height > 0 {
                webAreaBounds.append(bounds)
            }
        }

        if depth < maxDepth {
            for child in axElementChildrenForTraversal(element) {
                queue.append((child, depth + 1))
            }
        }
    }

    if windowBounds == nil, let firstWindow = roots.first {
        windowBounds = axBounds(firstWindow)
    }
    let pointContainingWebAreas = point == nil
        ? webAreaBounds
        : webAreaBounds.filter { rect in rect.contains(point!) }
    let contentBounds = (pointContainingWebAreas.isEmpty ? webAreaBounds : pointContainingWebAreas)
        .max { axRectArea($0) < axRectArea($1) }
    let tabTitle = activeTabTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        ? pageTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        : activeTabTitle.trimmingCharacters(in: .whitespacesAndNewlines)
    if activeURL.isEmpty && tabTitle.isEmpty && contentBounds == nil && windowBounds == nil { return nil }

    var payload: [String: Any] = [
        "browser_app": true,
        "active_url": activeURL,
        "active_tab_title": tabTitle,
    ]
    if let rect = axRectPayload(contentBounds) { payload["content_bounds"] = rect }
    if let rect = axRectPayload(windowBounds) { payload["window_bounds"] = rect }
    return payload
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
    "AXSwitch", "AXToggle", "AXSearchField", "AXSecureTextField",
    "AXScrollArea", "AXTable", "AXOutline", "AXGroup"
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
                    ),
                    ref: nil
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
