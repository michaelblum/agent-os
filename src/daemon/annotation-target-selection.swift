import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

let aosAnnotationTargetMaximumDepth = 12
let aosAnnotationTargetMaximumLabelCharacters = 256
let aosAnnotationTargetMessagingTimeout: Float = 0.05
let aosAnnotationTargetOperationTimeout: TimeInterval = 0.5

struct AOSAnnotationTargetNode: Equatable {
    let role: String
    let title: String?
    let label: String?
    let bounds: CGRect?
}

struct AOSAnnotationTargetCandidate: Equatable {
    let role: String
    let title: String?
    let label: String?
    let bounds: CGRect
    let ancestorRoles: [String]

    var summary: String {
        label ?? title ?? role
    }

    var rolePath: [String] {
        ancestorRoles + [role]
    }
}

private func annotationTargetText(_ value: String?, limit: Int) -> String? {
    guard let value else { return nil }
    var result = ""
    var characters = 0
    for scalar in value.unicodeScalars {
        let addition = CharacterSet.controlCharacters.contains(scalar)
            ? " "
            : String(scalar)
        if characters == limit { break }
        result += addition
        characters += 1
    }
    let normalized = result.trimmingCharacters(in: .whitespacesAndNewlines)
    return normalized.isEmpty ? nil : normalized
}

func aosAnnotationTargetCandidates(
    from nodes: [AOSAnnotationTargetNode],
    limit: Int = aosAnnotationTargetMaximumDepth
) -> [AOSAnnotationTargetCandidate] {
    guard limit > 0, !nodes.isEmpty else { return [] }
    let bounded: [AOSAnnotationTargetNode]
    if nodes.count <= limit {
        bounded = nodes
    } else if limit == 1 {
        bounded = [nodes[nodes.count - 1]]
    } else {
        bounded = [nodes[0]] + nodes.suffix(limit - 1)
    }
    var roles: [String] = []
    var candidates: [AOSAnnotationTargetCandidate] = []
    for node in bounded {
        let role = annotationTargetText(node.role, limit: 96) ?? "AXUnknown"
        guard let bounds = node.bounds,
              bounds.origin.x.isFinite,
              bounds.origin.y.isFinite,
              bounds.width.isFinite,
              bounds.height.isFinite,
              bounds.width > 0,
              bounds.height > 0 else {
            roles.append(role)
            continue
        }
        candidates.append(AOSAnnotationTargetCandidate(
            role: role,
            title: annotationTargetText(node.title, limit: aosAnnotationTargetMaximumLabelCharacters),
            label: annotationTargetText(node.label, limit: aosAnnotationTargetMaximumLabelCharacters),
            bounds: bounds,
            ancestorRoles: roles
        ))
        roles.append(role)
    }
    return candidates
}

func aosAnnotationTargetGeometry(_ candidate: AOSAnnotationTargetCandidate) -> [String: Any] {
    [
        "kind": "element",
        "coordinate_space": "desktop_points_top_left",
        "x": candidate.bounds.origin.x,
        "y": candidate.bounds.origin.y,
        "width": candidate.bounds.width,
        "height": candidate.bounds.height,
        "role": candidate.role,
        "title": candidate.title ?? NSNull(),
        "label": candidate.label ?? NSNull(),
        "ancestor_roles": candidate.ancestorRoles,
    ]
}

struct AOSAnnotationTargetResolution {
    let candidates: [AOSAnnotationTargetCandidate]
    let application: [String: Any]
    let window: [String: Any]?
}

struct AOSAnnotationTargetContextIdentity: Equatable {
    let processID: Int
    let windowID: Int?
}

private func annotationTargetInteger(_ value: Any?) -> Int? {
    if let number = value as? NSNumber { return number.intValue }
    return value as? Int
}

func aosAnnotationTargetContextIdentity(
    application: [String: Any]?,
    window: [String: Any]?
) -> AOSAnnotationTargetContextIdentity? {
    guard let processID = annotationTargetInteger(application?["pid"]) else {
        return nil
    }
    return AOSAnnotationTargetContextIdentity(
        processID: processID,
        windowID: annotationTargetInteger(window?["window_id"])
    )
}

func aosAnnotationTargetReconciledIndex(
    previousCandidates: [AOSAnnotationTargetCandidate],
    previousIndex: Int,
    previousContext: AOSAnnotationTargetContextIdentity?,
    nextCandidates: [AOSAnnotationTargetCandidate],
    nextContext: AOSAnnotationTargetContextIdentity?
) -> Int {
    guard !nextCandidates.isEmpty else { return -1 }
    guard previousContext != nil,
          previousContext == nextContext,
          previousIndex >= 0,
          previousIndex < previousCandidates.count else {
        return nextCandidates.count - 1
    }
    let previousPath = previousCandidates[previousIndex].rolePath
    return nextCandidates.firstIndex(where: { $0.rolePath == previousPath })
        ?? (nextCandidates.count - 1)
}

func aosResolveAnnotationTargets(
    at screenPoint: CGPoint,
    excludingPID: pid_t = getpid()
) -> AOSAnnotationTargetResolution? {
    let desktopPoint = screenPointToCG(screenPoint)
    guard let window = aosAnnotationWindowFacts(
        at: desktopPoint,
        excludingPID: excludingPID
    ),
    let application = window["application"] as? [String: Any] else { return nil }
    let pid: pid_t
    if let number = application["pid"] as? NSNumber {
        pid = number.int32Value
    } else if let value = application["pid"] as? Int {
        pid = pid_t(value)
    } else {
        return nil
    }
    guard let path = axSemanticTargetPathAtPoint(
        pid: pid,
        point: desktopPoint,
        maxDepth: aosAnnotationTargetMaximumDepth,
        messagingTimeout: aosAnnotationTargetMessagingTimeout,
        operationTimeout: aosAnnotationTargetOperationTimeout
    ) else { return nil }
    let nodes = path.map {
        AOSAnnotationTargetNode(
            role: $0.role,
            title: $0.title,
            label: $0.label,
            bounds: $0.bounds
        )
    }
    let candidates = aosAnnotationTargetCandidates(from: nodes)
    guard !candidates.isEmpty else { return nil }
    return AOSAnnotationTargetResolution(
        candidates: candidates,
        application: application,
        window: aosAnnotationPublicWindowFacts(window)
    )
}

final class AOSAnnotationTargetResolutionWorker {
    typealias Resolver = (CGPoint) -> AOSAnnotationTargetResolution?
    typealias Completion = (AOSAnnotationTargetResolution?) -> Void

    private struct Request {
        let generation: UInt64
        let point: CGPoint
        let completion: Completion
    }

    private let deliveryQueue: DispatchQueue
    private let resolverQueue: DispatchQueue
    private let resolve: Resolver
    private var closed = false
    private var generation: UInt64 = 0
    private var inFlight = false
    private var pending: Request?

    init(
        deliveryQueue: DispatchQueue = .main,
        resolverQueue: DispatchQueue,
        resolve: @escaping Resolver
    ) {
        self.deliveryQueue = deliveryQueue
        self.resolverQueue = resolverQueue
        self.resolve = resolve
    }

    func request(at point: CGPoint, completion: @escaping Completion) {
        dispatchPrecondition(condition: .onQueue(deliveryQueue))
        guard !closed else { return }
        generation &+= 1
        pending = Request(generation: generation, point: point, completion: completion)
        startNextIfNeeded()
    }

    func close() {
        dispatchPrecondition(condition: .onQueue(deliveryQueue))
        guard !closed else { return }
        closed = true
        generation &+= 1
        pending = nil
    }

    private func startNextIfNeeded() {
        guard !closed, !inFlight, let request = pending else { return }
        pending = nil
        inFlight = true
        resolverQueue.async { [weak self] in
            guard let self else { return }
            let result = self.resolve(request.point)
            self.deliveryQueue.async { [weak self] in
                self?.finish(request, result: result)
            }
        }
    }

    private func finish(
        _ request: Request,
        result: AOSAnnotationTargetResolution?
    ) {
        dispatchPrecondition(condition: .onQueue(deliveryQueue))
        inFlight = false
        if !closed, request.generation == generation {
            request.completion(result)
        }
        startNextIfNeeded()
    }
}

final class AOSAnnotationTargetSelectionView: NSView {
    let onCancel: (String) -> Void
    let onCommit: (CGPoint) -> Void
    let onCycle: (Int) -> Void
    let onMove: (CGPoint) -> Void
    private var candidates: [AOSAnnotationTargetCandidate] = []
    private var selectedIndex = -1
    private var trackingArea: NSTrackingArea?

    init(
        frame: NSRect,
        onMove: @escaping (CGPoint) -> Void,
        onCycle: @escaping (Int) -> Void,
        onCommit: @escaping (CGPoint) -> Void,
        onCancel: @escaping (String) -> Void
    ) {
        self.onMove = onMove
        self.onCycle = onCycle
        self.onCommit = onCommit
        self.onCancel = onCancel
        super.init(frame: frame)
        wantsLayer = true
    }

    required init?(coder: NSCoder) { nil }
    override var acceptsFirstResponder: Bool { true }

    func render(candidates: [AOSAnnotationTargetCandidate], selectedIndex: Int) {
        self.candidates = candidates
        self.selectedIndex = selectedIndex
        needsDisplay = true
    }

    override func updateTrackingAreas() {
        if let trackingArea { removeTrackingArea(trackingArea) }
        let next = NSTrackingArea(
            rect: bounds,
            options: [.activeAlways, .inVisibleRect, .mouseEnteredAndExited, .mouseMoved],
            owner: self,
            userInfo: nil
        )
        addTrackingArea(next)
        trackingArea = next
        super.updateTrackingAreas()
    }

    private func screenPoint(_ event: NSEvent) -> CGPoint {
        window?.convertPoint(toScreen: event.locationInWindow) ?? event.locationInWindow
    }

    override func mouseMoved(with event: NSEvent) {
        onMove(screenPoint(event))
    }

    override func mouseDown(with event: NSEvent) {
        onMove(screenPoint(event))
    }

    override func mouseDragged(with event: NSEvent) {
        onMove(screenPoint(event))
    }

    override func mouseUp(with event: NSEvent) {
        onCommit(screenPoint(event))
    }

    override func scrollWheel(with event: NSEvent) {
        guard event.scrollingDeltaY != 0 else { return }
        onCycle(event.scrollingDeltaY > 0 ? -1 : 1)
    }

    override func keyDown(with event: NSEvent) {
        switch event.keyCode {
        case 53:
            onCancel("escape")
        case 36, 76:
            onCommit(NSEvent.mouseLocation)
        case 48, 123, 126:
            onCycle(-1)
        case 124, 125:
            onCycle(1)
        default:
            super.keyDown(with: event)
        }
    }

    private func localRect(_ candidate: AOSAnnotationTargetCandidate) -> NSRect? {
        guard let window else { return nil }
        let screenRect = cgToScreen(candidate.bounds)
        return NSRect(
            origin: window.convertPoint(fromScreen: screenRect.origin),
            size: screenRect.size
        )
    }

    override func draw(_ dirtyRect: NSRect) {
        NSColor.black.withAlphaComponent(0.035).setFill()
        dirtyRect.fill()
        for (index, candidate) in candidates.enumerated() {
            guard let rect = localRect(candidate), rect.intersects(bounds) else { continue }
            let selected = index == selectedIndex
            let path = NSBezierPath(roundedRect: rect, xRadius: 4, yRadius: 4)
            path.lineWidth = selected ? 3 : 1
            (selected
                ? NSColor.white.withAlphaComponent(0.98)
                : NSColor.systemCyan.withAlphaComponent(0.38)
            ).setStroke()
            path.stroke()
            if selected {
                NSColor.systemCyan.withAlphaComponent(0.1).setFill()
                path.fill()
                drawLabel(candidate.summary, role: candidate.role, near: rect)
            }
        }
    }

    private func drawLabel(_ label: String, role: String, near rect: NSRect) {
        let text = "\(label)  ·  \(role)" as NSString
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 12, weight: .semibold),
            .foregroundColor: NSColor.white,
        ]
        let size = text.size(withAttributes: attributes)
        let width = min(max(120, size.width + 20), max(120, bounds.width - 20))
        let frame = NSRect(
            x: min(max(10, rect.minX), max(10, bounds.width - width - 10)),
            y: max(10, min(bounds.height - 34, rect.maxY + 8)),
            width: width,
            height: 26
        )
        NSColor.black.withAlphaComponent(0.82).setFill()
        NSBezierPath(roundedRect: frame, xRadius: 5, yRadius: 5).fill()
        text.draw(
            in: frame.insetBy(dx: 10, dy: 5),
            withAttributes: attributes
        )
    }
}
