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

func axSettableAttributes(_ element: AXUIElement) -> [String] {
    let attributes = [kAXValueAttribute as String, kAXFocusedAttribute as String]
    return attributes.filter { attribute in
        var settable = DarwinBoolean(false)
        return AXUIElementIsAttributeSettable(element, attribute as CFString, &settable) == .success && settable.boolValue
    }
}

func axWindowID(_ element: AXUIElement) -> Int? {
    var windowID: CGWindowID = 0
    guard _AXUIElementGetWindow(element, &windowID) == .success, windowID != 0 else { return nil }
    return Int(windowID)
}

func nativeAXSavedActionNames(_ element: AXUIElement) -> [String] {
    var names = axActions(element)
    let settable = Set(axSettableAttributes(element))
    if settable.contains(kAXValueAttribute as String), !names.contains("AXSetValue") {
        names.append("AXSetValue")
    }
    if settable.contains(kAXFocusedAttribute as String), !names.contains("AXFocus") {
        names.append("AXFocus")
    }
    return names
}

func nativeAXFocusCursorSpaceBaseline() -> NativeFocusCursorSpaceBaselineJSON {
    // This records the observation baseline only; saved-ref conformance still
    // reports no-foreground/focus/cursor/Space preservation as unverified.
    NativeFocusCursorSpaceBaselineJSON(
        captured: true,
        focus: "not_changed",
        cursor: "not_changed",
        space: "not_changed"
    )
}

func nativeAXWindowElement(_ element: AXUIElement) -> AXUIElement? {
    var value: AnyObject?
    if AXUIElementCopyAttributeValue(element, kAXWindowAttribute as CFString, &value) == .success,
       let window = value {
        return (window as! AXUIElement)
    }

    var current: AXUIElement? = element
    var depth = 0
    while let candidate = current, depth < 8 {
        if axString(candidate, kAXRoleAttribute) == "AXWindow" {
            return candidate
        }
        current = axParent(candidate)
        depth += 1
    }
    return nil
}

func nativeAXWindowOnCurrentSpace(windowID: Int?) -> Bool? {
    guard let windowID else { return nil }
    guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] else {
        return nil
    }
    return list.contains { info in
        if let number = info[kCGWindowNumber as String] as? Int {
            return number == windowID
        }
        if let number = info[kCGWindowNumber as String] as? NSNumber {
            return number.intValue == windowID
        }
        return false
    }
}

func nativeAXControlKind(role: String, subrole: String?) -> String {
    if let subrole, subrole.lowercased().contains("unknown") {
        return "custom_control"
    }
    switch role {
    case "AXButton", "AXCheckBox", "AXRadioButton", "AXTextField", "AXTextArea",
         "AXPopUpButton", "AXSlider", "AXMenuItem", "AXTabGroup", "AXLink":
        return "standard_control"
    case "AXGroup", "AXUnknown":
        return "custom_control"
    default:
        return "standard_control"
    }
}

func nativeAXSurfaceKind(role: String, subrole: String?, title: String?, label: String?) -> String {
    let haystack = [role, subrole, title, label]
        .compactMap { $0?.lowercased() }
        .joined(separator: " ")
    if haystack.contains("canvas") || haystack.contains("game") {
        return "game_canvas"
    }
    return "native_app"
}

func nativeAXSavedRefEvidence(
    appPID: Int?,
    windowID: Int?,
    axIdentifier: String?,
    enabled: Bool,
    actionNames: [String],
    permissionState: String,
    baseline: NativeFocusCursorSpaceBaselineJSON,
    knownLimitFactsComplete: Bool = false,
    knownLimitBlockers: [String] = []
) -> NativeSavedRefEvidenceJSON {
    var reasons: [String] = []
    if appPID == nil {
        reasons.append("missing native app_pid")
    }
    if windowID == nil {
        reasons.append("missing native window_id")
    }
    if (axIdentifier ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        reasons.append("missing native AX identifier")
    }
    if !enabled {
        reasons.append("native AX element is disabled")
    }
    if actionNames.isEmpty {
        reasons.append("missing native AX action names")
    }
    if permissionState.lowercased() != "granted" {
        reasons.append("native AX permission is not granted")
    }
    if !baseline.captured {
        reasons.append("focus/cursor/Space baseline was not captured")
    }
    if baseline.focus != "not_changed" {
        reasons.append("focus baseline changed")
    }
    if baseline.cursor != "not_changed" {
        reasons.append("cursor baseline changed")
    }
    if baseline.space != "not_changed" {
        reasons.append("Space baseline changed")
    }
    if !knownLimitFactsComplete {
        reasons.append("native AX producer has not emitted complete known-limit facts for stable saved-ref mutation")
    }
    reasons.append(contentsOf: knownLimitBlockers)

    if knownLimitFactsComplete && reasons.isEmpty {
        return NativeSavedRefEvidenceJSON(
            status: "actionable",
            actionability: "direct_ax_saved_ref_mutation",
            known_limit_facts_complete: true,
            producer: "native_ax",
            reasons: []
        )
    }

    return NativeSavedRefEvidenceJSON(
        status: "inspection_only",
        actionability: "inspection_only",
        known_limit_facts_complete: false,
        producer: "native_ax",
        reasons: reasons
    )
}

struct NativeAXKnownLimitFacts {
    let windowState: String?
    let spaceState: String?
    let controlKind: String?
    let surfaceKind: String?
    let focusState: String?
    let minimized: Bool?
    let offSpace: Bool?
    let customControl: Bool?
    let canvasSurface: Bool?
    let complete: Bool
    let blockers: [String]
}

func nativeAXKnownLimitFacts(
    element: AXUIElement,
    role: String,
    title: String?,
    label: String?,
    hidden: Bool,
    windowID: Int?
) -> NativeAXKnownLimitFacts {
    let windowElement = nativeAXWindowElement(element)
    let minimized = windowElement.flatMap { axBool($0, kAXMinimizedAttribute as String) } ?? false
    let windowState = hidden ? "hidden" : minimized ? "minimized" : "visible"

    let onCurrentSpace = nativeAXWindowOnCurrentSpace(windowID: windowID)
    let spaceState = onCurrentSpace.map { $0 ? "visible_current_space" : "off_space" }
    let offSpace = onCurrentSpace.map { !$0 }

    let subrole = axString(element, kAXSubroleAttribute as String)
    let controlKind = nativeAXControlKind(role: role, subrole: subrole)
    let surfaceKind = nativeAXSurfaceKind(role: role, subrole: subrole, title: title, label: label)
    let focusState = "not_changed"
    let customControl = controlKind == "custom_control"
    let canvasSurface = surfaceKind != "native_app"

    var blockers: [String] = []
    if hidden {
        blockers.append("native AX target was captured in a hidden window")
    }
    if minimized {
        blockers.append("native AX target was captured in a minimized window")
    }
    if offSpace == true {
        blockers.append("native AX target was captured off-Space")
    }
    if customControl {
        blockers.append("native AX target is a custom control")
    }
    if canvasSurface {
        blockers.append("native AX target belongs to a canvas/game surface")
    }
    if focusState == "mismatch" {
        blockers.append("native AX focus baseline reports mismatch")
    }

    let complete = windowID != nil
        && onCurrentSpace != nil
        && !windowState.isEmpty
        && !controlKind.isEmpty
        && !surfaceKind.isEmpty
        && !focusState.isEmpty

    return NativeAXKnownLimitFacts(
        windowState: windowState,
        spaceState: spaceState,
        controlKind: controlKind,
        surfaceKind: surfaceKind,
        focusState: focusState,
        minimized: minimized,
        offSpace: offSpace,
        customControl: customControl,
        canvasSurface: canvasSurface,
        complete: complete,
        blockers: blockers
    )
}

struct AXAncestorEvidence {
    let role: String
    let title: String?
    let label: String?
    let value: String?
    let bounds: CGRect?
}

struct AXSemanticTargetEvidence {
    let role: String
    let title: String?
    let label: String?
    let bounds: CGRect?
}

private func axSemanticTargetAttribute(
    _ element: AXUIElement,
    _ attribute: CFString,
    deadline: TimeInterval,
    maximumCallTimeout: Float
) -> AnyObject? {
    let remaining = deadline - ProcessInfo.processInfo.systemUptime
    guard remaining > 0 else { return nil }
    let callTimeout = min(maximumCallTimeout, Float(remaining))
    AXUIElementSetMessagingTimeout(element, callTimeout)
    var value: AnyObject?
    guard AXUIElementCopyAttributeValue(element, attribute, &value) == .success else {
        return nil
    }
    return value
}

private func axSemanticTargetString(
    _ element: AXUIElement,
    _ attribute: CFString,
    deadline: TimeInterval,
    maximumCallTimeout: Float
) -> String? {
    axSemanticTargetAttribute(
        element,
        attribute,
        deadline: deadline,
        maximumCallTimeout: maximumCallTimeout
    ) as? String
}

private func axSemanticTargetBounds(
    _ element: AXUIElement,
    deadline: TimeInterval,
    maximumCallTimeout: Float
) -> CGRect? {
    guard let positionValue = axSemanticTargetAttribute(
        element,
        kAXPositionAttribute as CFString,
        deadline: deadline,
        maximumCallTimeout: maximumCallTimeout
    ),
    let sizeValue = axSemanticTargetAttribute(
        element,
        kAXSizeAttribute as CFString,
        deadline: deadline,
        maximumCallTimeout: maximumCallTimeout
    ),
    CFGetTypeID(positionValue) == AXValueGetTypeID(),
    CFGetTypeID(sizeValue) == AXValueGetTypeID() else { return nil }
    var position = CGPoint.zero
    var size = CGSize.zero
    guard AXValueGetValue(positionValue as! AXValue, .cgPoint, &position),
          AXValueGetValue(sizeValue as! AXValue, .cgSize, &size) else {
        return nil
    }
    return CGRect(origin: position, size: size)
}

private func axSemanticTargetEvidence(
    _ element: AXUIElement,
    deadline: TimeInterval,
    maximumCallTimeout: Float
) -> AXSemanticTargetEvidence {
    return AXSemanticTargetEvidence(
        role: axSemanticTargetString(
            element,
            kAXRoleAttribute as CFString,
            deadline: deadline,
            maximumCallTimeout: maximumCallTimeout
        ) ?? "AXUnknown",
        title: axSemanticTargetString(
            element,
            kAXTitleAttribute as CFString,
            deadline: deadline,
            maximumCallTimeout: maximumCallTimeout
        ),
        label: axSemanticTargetString(
            element,
            kAXDescriptionAttribute as CFString,
            deadline: deadline,
            maximumCallTimeout: maximumCallTimeout
        ),
        bounds: axSemanticTargetBounds(
            element,
            deadline: deadline,
            maximumCallTimeout: maximumCallTimeout
        )
    )
}

private func axSemanticTargetParent(
    _ element: AXUIElement,
    deadline: TimeInterval,
    maximumCallTimeout: Float
) -> AXUIElement? {
    guard let value = axSemanticTargetAttribute(
        element,
        kAXParentAttribute as CFString,
        deadline: deadline,
        maximumCallTimeout: maximumCallTimeout
    ),
    CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    return (value as! AXUIElement)
}

func axSemanticTargetPathAtPoint(
    pid: pid_t,
    point: CGPoint,
    maxDepth: Int,
    messagingTimeout: Float,
    operationTimeout: TimeInterval
) -> [AXSemanticTargetEvidence]? {
    guard pid > 0, maxDepth > 0, operationTimeout > 0 else { return nil }
    let callTimeout = max(0.001, messagingTimeout)
    let deadline = ProcessInfo.processInfo.systemUptime + operationTimeout
    let application = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(application, min(callTimeout, Float(operationTimeout)))
    var elementRef: AXUIElement?
    guard AXUIElementCopyElementAtPosition(
        application,
        Float(point.x),
        Float(point.y),
        &elementRef
    ) == .success,
    let element = elementRef else { return nil }

    var path: [AXSemanticTargetEvidence] = []
    var current: AXUIElement? = element
    var depth = 0
    while let candidate = current,
          depth < maxDepth,
          ProcessInfo.processInfo.systemUptime < deadline {
        path.insert(axSemanticTargetEvidence(
            candidate,
            deadline: deadline,
            maximumCallTimeout: callTimeout
        ), at: 0)
        current = axSemanticTargetParent(
            candidate,
            deadline: deadline,
            maximumCallTimeout: callTimeout
        )
        depth += 1
    }
    return path.isEmpty ? nil : path
}

// MARK: - Raw Ancestor Evidence

func axAncestorChain(_ element: AXUIElement, maxDepth: Int = 6) -> [AXAncestorEvidence] {
    var chain: [AXAncestorEvidence] = []
    var current: AXUIElement? = element
    var depth = 0
    while let el = current, depth < maxDepth {
        chain.insert(AXAncestorEvidence(
            role: axString(el, kAXRoleAttribute) ?? "",
            title: axString(el, kAXTitleAttribute),
            label: axString(el, kAXDescriptionAttribute),
            value: axValue(el),
            bounds: axBounds(el)
        ), at: 0)
        current = axParent(el)
        depth += 1
    }
    return chain
}

func axAncestorPayloads(_ chain: [AXAncestorEvidence]) -> [[String: Any]] {
    chain.map { item in
        var payload: [String: Any] = ["role": item.role]
        if let title = item.title { payload["title"] = title }
        if let label = item.label { payload["label"] = label }
        if let value = item.value { payload["value"] = value }
        if let bounds = axRectPayload(item.bounds) { payload["bounds"] = bounds }
        return payload
    }
}

func axAncestorJSONs(_ chain: [AXAncestorEvidence]) -> [AXAncestorJSON] {
    chain.map { item in
        AXAncestorJSON(
            role: item.role,
            title: item.title,
            label: item.label,
            value: item.value,
            bounds: item.bounds.map { Bounds(from: $0) }
        )
    }
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
    let settableAttributeNames: [String]
    let ancestorChain: [AXAncestorEvidence]
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
        settableAttributeNames: axSettableAttributes(el),
        ancestorChain: axAncestorChain(el)
    )
}

// MARK: - Browser/Web AX Context

private func axRectPayload(_ rect: CGRect?) -> [String: Any]? {
    guard let rect else { return nil }
    return [
        "x": rect.origin.x,
        "y": rect.origin.y,
        "width": rect.size.width,
        "height": rect.size.height
    ]
}

private func axPointPayload(_ point: CGPoint?) -> [String: Any]? {
    guard let point else { return nil }
    return ["x": point.x, "y": point.y]
}

private func axTrimmed(_ value: String?) -> String {
    (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
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

    var textCandidates: [[String: Any]] = []
    var webAreaBounds: [[String: Any]] = []
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
        let selected = axBool(element, kAXSelectedAttribute) ?? false

        if role == "AXWindow", windowBounds == nil {
            if let point, let bounds, bounds.contains(point) {
                windowBounds = bounds
            } else if point == nil {
                windowBounds = bounds
            }
        }

        var textSources: [(String, String)] = [
            ("AXTitle", title),
            ("AXDescription", label),
            ("AXValue", value)
        ]
        let urlAttributeValue = axAnyString(element, kAXURLAttribute)
        if let urlAttributeValue {
            textSources.append(("AXURL", urlAttributeValue))
        }

        for (attribute, raw) in textSources {
            let trimmed = axTrimmed(raw)
            guard !trimmed.isEmpty else { continue }
            var candidate: [String: Any] = [
                "value": trimmed,
                "source_attribute": attribute,
                "role": role,
                "selected": selected
            ]
            if let rect = axRectPayload(bounds) { candidate["bounds"] = rect }
            textCandidates.append(candidate)
        }

        if role == "AXWebArea" {
            if let bounds, bounds.width > 0, bounds.height > 0 {
                var candidate: [String: Any] = ["bounds": axRectPayload(bounds)!]
                let webTitle = axTrimmed(title)
                if !webTitle.isEmpty { candidate["title"] = webTitle }
                webAreaBounds.append(candidate)
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
    if textCandidates.isEmpty && webAreaBounds.isEmpty && windowBounds == nil { return nil }

    var payload: [String: Any] = [
        "browser_app": true,
        "text_candidates": textCandidates,
        "web_area_bounds": webAreaBounds,
        "node_count": visited,
        "max_nodes": maxNodes,
        "max_depth": maxDepth
    ]
    if let point = axPointPayload(point) { payload["pointer"] = point }
    if let rect = axRectPayload(windowBounds) { payload["window_bounds"] = rect }
    return payload
}

// MARK: - Shared AX Utilities for Capture Pipeline

/// Alias for axBounds — used by capture pipeline code that calls it axFrame.
func axFrame(_ element: AXUIElement) -> CGRect? { axBounds(element) }

// MARK: - AX Traversal (--xray)

/// Recursively traverse AX tree, emitting visible bounded elements as a flat raw array.
func traverseAXElements(
    _ element: AXUIElement,
    appPID: pid_t,
    appName: String,
    permissionState: String,
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
    let focused = axBool(element, kAXFocusedAttribute as String)
    let windowID = axWindowID(element)
    let axIdentifier = axString(element, kAXIdentifierAttribute as String)
    let actionNames = nativeAXSavedActionNames(element)
    let focusCursorSpaceBaseline = nativeAXFocusCursorSpaceBaseline()
    let knownLimitFacts = nativeAXKnownLimitFacts(
        element: element,
        role: role,
        title: title,
        label: label,
        hidden: hidden,
        windowID: windowID
    )

    // Spatial check + emit raw visible elements. Consumers own semantic filtering.
    if !hidden, let frame = axFrame(element), frame.width > 0, frame.height > 0 {
        if let lcsRect = mapper.toLCS(globalRect: frame, imageSize: imageSize) {
            results.append(AXElementJSON(
                app_pid: Int(appPID),
                app_name: appName,
                window_id: windowID,
                role: role,
                title: title,
                label: label,
                identifier: axIdentifier,
                value: valueStr,
                enabled: enabled,
                focused: focused,
                action_names: actionNames,
                permission_state: permissionState,
                focus_cursor_space_baseline: focusCursorSpaceBaseline,
                native_saved_ref_evidence: nativeAXSavedRefEvidence(
                    appPID: Int(appPID),
                    windowID: windowID,
                    axIdentifier: axIdentifier,
                    enabled: enabled,
                    actionNames: actionNames,
                    permissionState: permissionState,
                    baseline: focusCursorSpaceBaseline,
                    knownLimitFactsComplete: knownLimitFacts.complete,
                    knownLimitBlockers: knownLimitFacts.blockers
                ),
                window_state: knownLimitFacts.windowState,
                space_state: knownLimitFacts.spaceState,
                control_kind: knownLimitFacts.controlKind,
                surface_kind: knownLimitFacts.surfaceKind,
                focus_state: knownLimitFacts.focusState,
                minimized: knownLimitFacts.minimized,
                off_space: knownLimitFacts.offSpace,
                custom_control: knownLimitFacts.customControl,
                canvas_surface: knownLimitFacts.canvasSurface,
                context_path: contextPath,
                bounds: BoundsJSON(
                    x: Int(lcsRect.origin.x), y: Int(lcsRect.origin.y),
                    width: max(1, Int(lcsRect.width)), height: max(1, Int(lcsRect.height))
                ),
                ref: nil
            ))
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
        traverseAXElements(child, appPID: appPID, appName: appName, permissionState: permissionState,
                          mapper: mapper, imageSize: imageSize,
                          contextPath: childPath, depth: depth + 1,
                          maxDepth: maxDepth, results: &results)
    }
}

/// Run --xray on a specific app by PID, returning elements in LCS coordinates.
func xrayApp(pid: pid_t, appName: String, mapper: CoordinateMapper, imageSize: CGSize) -> [AXElementJSON] {
    let axApp = AXUIElementCreateApplication(pid)
    var results: [AXElementJSON] = []
    let permissionState = AXIsProcessTrusted() ? "granted" : "unknown"
    traverseAXElements(axApp, appPID: pid, appName: appName, permissionState: permissionState,
                      mapper: mapper, imageSize: imageSize,
                      contextPath: ["app:\(appName)"], depth: 0, maxDepth: 15,
                      results: &results)
    return results
}

/// Run --xray on the frontmost app, returning elements in LCS coordinates.
func xrayFrontmostApp(mapper: CoordinateMapper, imageSize: CGSize) -> [AXElementJSON] {
    guard let frontApp = NSWorkspace.shared.frontmostApplication else { return [] }
    return xrayApp(pid: frontApp.processIdentifier, appName: frontApp.localizedName ?? "App",
                   mapper: mapper, imageSize: imageSize)
}
