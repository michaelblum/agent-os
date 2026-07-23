import ApplicationServices
import CoreGraphics
import Foundation

struct AXSemanticTargetEvidence {
    let role: String
    let title: String?
    let label: String?
    let bounds: CGRect?
}

enum AXSemanticTargetAttribute: String, CaseIterable {
    case role
    case title
    case label
    case position
    case size
    case parent
}

enum AXSemanticTargetValue<Element> {
    case string(String)
    case point(CGPoint)
    case size(CGSize)
    case element(Element)
}

struct AXSemanticTargetBackend<Element> {
    let makeApplication: (pid_t) -> Element
    let elementAtPosition: (Element, CGPoint, Float) -> Element?
    let read: (Element, AXSemanticTargetAttribute, Float) -> AXSemanticTargetValue<Element>?
}

private func axSemanticTargetCallTimeout(
    deadline: TimeInterval,
    maximumCallTimeout: Float,
    now: () -> TimeInterval
) -> Float? {
    let remaining = deadline - now()
    guard remaining > 0 else { return nil }
    return min(maximumCallTimeout, Float(remaining))
}

private func axSemanticTargetRead<Element>(
    _ element: Element,
    _ attribute: AXSemanticTargetAttribute,
    backend: AXSemanticTargetBackend<Element>,
    deadline: TimeInterval,
    maximumCallTimeout: Float,
    now: () -> TimeInterval
) -> AXSemanticTargetValue<Element>? {
    guard let callTimeout = axSemanticTargetCallTimeout(
        deadline: deadline,
        maximumCallTimeout: maximumCallTimeout,
        now: now
    ) else { return nil }
    return backend.read(element, attribute, callTimeout)
}

private func axSemanticTargetString<Element>(
    _ element: Element,
    _ attribute: AXSemanticTargetAttribute,
    backend: AXSemanticTargetBackend<Element>,
    deadline: TimeInterval,
    maximumCallTimeout: Float,
    now: () -> TimeInterval
) -> String? {
    guard case let .string(value)? = axSemanticTargetRead(
        element,
        attribute,
        backend: backend,
        deadline: deadline,
        maximumCallTimeout: maximumCallTimeout,
        now: now
    ) else { return nil }
    return value
}

private func axSemanticTargetBounds<Element>(
    _ element: Element,
    backend: AXSemanticTargetBackend<Element>,
    deadline: TimeInterval,
    maximumCallTimeout: Float,
    now: () -> TimeInterval
) -> CGRect? {
    guard case let .point(position)? = axSemanticTargetRead(
        element,
        .position,
        backend: backend,
        deadline: deadline,
        maximumCallTimeout: maximumCallTimeout,
        now: now
    ),
    case let .size(size)? = axSemanticTargetRead(
        element,
        .size,
        backend: backend,
        deadline: deadline,
        maximumCallTimeout: maximumCallTimeout,
        now: now
    ) else { return nil }
    return CGRect(origin: position, size: size)
}

private func axSemanticTargetEvidence<Element>(
    _ element: Element,
    backend: AXSemanticTargetBackend<Element>,
    deadline: TimeInterval,
    maximumCallTimeout: Float,
    now: () -> TimeInterval
) -> AXSemanticTargetEvidence {
    AXSemanticTargetEvidence(
        role: axSemanticTargetString(
            element,
            .role,
            backend: backend,
            deadline: deadline,
            maximumCallTimeout: maximumCallTimeout,
            now: now
        ) ?? "AXUnknown",
        title: axSemanticTargetString(
            element,
            .title,
            backend: backend,
            deadline: deadline,
            maximumCallTimeout: maximumCallTimeout,
            now: now
        ),
        label: axSemanticTargetString(
            element,
            .label,
            backend: backend,
            deadline: deadline,
            maximumCallTimeout: maximumCallTimeout,
            now: now
        ),
        bounds: axSemanticTargetBounds(
            element,
            backend: backend,
            deadline: deadline,
            maximumCallTimeout: maximumCallTimeout,
            now: now
        )
    )
}

func axSemanticTargetPathAtPoint<Element>(
    pid: pid_t,
    point: CGPoint,
    maxDepth: Int,
    messagingTimeout: Float,
    operationTimeout: TimeInterval,
    backend: AXSemanticTargetBackend<Element>,
    now: @escaping () -> TimeInterval
) -> [AXSemanticTargetEvidence]? {
    guard pid > 0, maxDepth > 0, operationTimeout > 0 else { return nil }
    let callTimeout = max(0.001, messagingTimeout)
    let deadline = now() + operationTimeout
    let application = backend.makeApplication(pid)
    guard let hitTimeout = axSemanticTargetCallTimeout(
        deadline: deadline,
        maximumCallTimeout: min(callTimeout, Float(operationTimeout)),
        now: now
    ),
    let element = backend.elementAtPosition(application, point, hitTimeout) else {
        return nil
    }

    var path: [AXSemanticTargetEvidence] = []
    var current: Element? = element
    var depth = 0
    while let candidate = current, depth < maxDepth {
        guard axSemanticTargetCallTimeout(
            deadline: deadline,
            maximumCallTimeout: callTimeout,
            now: now
        ) != nil else { break }
        path.insert(axSemanticTargetEvidence(
            candidate,
            backend: backend,
            deadline: deadline,
            maximumCallTimeout: callTimeout,
            now: now
        ), at: 0)
        if case let .element(parent)? = axSemanticTargetRead(
            candidate,
            .parent,
            backend: backend,
            deadline: deadline,
            maximumCallTimeout: callTimeout,
            now: now
        ) {
            current = parent
        } else {
            current = nil
        }
        depth += 1
    }
    return path.isEmpty ? nil : path
}

func axNativeSemanticTargetAttribute(
    _ attribute: AXSemanticTargetAttribute
) -> CFString {
    switch attribute {
    case .role:
        return kAXRoleAttribute as CFString
    case .title:
        return kAXTitleAttribute as CFString
    case .label:
        return kAXDescriptionAttribute as CFString
    case .position:
        return kAXPositionAttribute as CFString
    case .size:
        return kAXSizeAttribute as CFString
    case .parent:
        return kAXParentAttribute as CFString
    }
}

private let axNativeSemanticTargetBackend = AXSemanticTargetBackend<AXUIElement>(
    makeApplication: { AXUIElementCreateApplication($0) },
    elementAtPosition: { application, point, timeout in
        AXUIElementSetMessagingTimeout(application, timeout)
        var element: AXUIElement?
        guard AXUIElementCopyElementAtPosition(
            application,
            Float(point.x),
            Float(point.y),
            &element
        ) == .success else { return nil }
        return element
    },
    read: { element, attribute, timeout in
        AXUIElementSetMessagingTimeout(element, timeout)
        var value: AnyObject?
        guard AXUIElementCopyAttributeValue(
            element,
            axNativeSemanticTargetAttribute(attribute),
            &value
        ) == .success,
        let value else { return nil }
        switch attribute {
        case .role, .title, .label:
            guard let string = value as? String else { return nil }
            return .string(string)
        case .position:
            guard CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
            var point = CGPoint.zero
            guard AXValueGetValue(value as! AXValue, .cgPoint, &point) else { return nil }
            return .point(point)
        case .size:
            guard CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
            var size = CGSize.zero
            guard AXValueGetValue(value as! AXValue, .cgSize, &size) else { return nil }
            return .size(size)
        case .parent:
            guard CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
            return .element(value as! AXUIElement)
        }
    }
)

func axSemanticTargetPathAtPoint(
    pid: pid_t,
    point: CGPoint,
    maxDepth: Int,
    messagingTimeout: Float,
    operationTimeout: TimeInterval
) -> [AXSemanticTargetEvidence]? {
    axSemanticTargetPathAtPoint(
        pid: pid,
        point: point,
        maxDepth: maxDepth,
        messagingTimeout: messagingTimeout,
        operationTimeout: operationTimeout,
        backend: axNativeSemanticTargetBackend,
        now: { ProcessInfo.processInfo.systemUptime }
    )
}
