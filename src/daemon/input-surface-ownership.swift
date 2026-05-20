import Foundation
import CoreGraphics

private let aosInputRegionPointerPhases: [String: String] = [
    "left_mouse_down": "down",
    "left_mouse_dragged": "drag",
    "left_mouse_up": "up",
    "right_mouse_down": "down",
    "right_mouse_dragged": "drag",
    "right_mouse_up": "up",
    "middle_mouse_down": "down",
    "middle_mouse_dragged": "drag",
    "middle_mouse_up": "up",
    "other_mouse_down": "down",
    "other_mouse_dragged": "drag",
    "other_mouse_up": "up",
    "mouse_moved": "move",
    "scroll_wheel": "scroll",
    "pointer_cancel": "cancel",
    "mouse_cancel": "cancel",
]

private let aosInputRegionDownPhases: Set<String> = [
    "left_mouse_down",
    "right_mouse_down",
    "middle_mouse_down",
    "other_mouse_down",
]

private let aosInputRegionTerminalPhases: Set<String> = [
    "left_mouse_up",
    "right_mouse_up",
    "middle_mouse_up",
    "other_mouse_up",
    "pointer_cancel",
    "mouse_cancel",
]

struct AOSInputRegionRecord: Equatable {
    let id: String
    let ownerCanvasID: String
    let nativeFrame: CGRect
    let coordinateSpace: String
    let semanticLabel: String
    let priority: Int
    let consumePolicy: String
    let metadata: [String: String]
    let removeOnOwnerSuspend: Bool
    let enabled: Bool

    init(
        id: String,
        ownerCanvasID: String,
        nativeFrame: CGRect,
        coordinateSpace: String = "native",
        semanticLabel: String = "",
        priority: Int = 0,
        consumePolicy: String = "always",
        metadata: [String: String] = [:],
        removeOnOwnerSuspend: Bool = true,
        enabled: Bool = true
    ) {
        self.id = id
        self.ownerCanvasID = ownerCanvasID
        self.nativeFrame = nativeFrame
        self.coordinateSpace = coordinateSpace
        self.semanticLabel = semanticLabel
        self.priority = priority
        self.consumePolicy = consumePolicy
        self.metadata = metadata
        self.removeOnOwnerSuspend = removeOnOwnerSuspend
        self.enabled = enabled
    }

    func contains(_ point: CGPoint) -> Bool {
        enabled && nativeFrame.width > 0 && nativeFrame.height > 0 && nativeFrame.contains(point)
    }

    var shouldConsumeOnDown: Bool {
        consumePolicy != "never"
    }

    func shouldConsume(eventType: String, captured: Bool) -> Bool {
        switch consumePolicy {
        case "never":
            return false
        case "down_only":
            return aosInputRegionDownPhases.contains(eventType)
        case "captured":
            return captured || aosInputRegionDownPhases.contains(eventType)
        default:
            return true
        }
    }
}

struct AOSInputRegionRoute: Equatable {
    let region: AOSInputRegionRecord
    let phase: String
    let captured: Bool
    let captureID: String?
    let shouldConsume: Bool
}

func aosInputRegionRoutedInputPayload(
    event: String,
    data: [String: Any],
    route: AOSInputRegionRoute,
    desktopWorld: [String: Any]?,
    sourceSequence: String?,
    sourceSequencePayload: [String: Any]?,
    gestureID: String?
) -> [String: Any] {
    let eventKind = (data["event_kind"] as? String) ?? aosInputRegionEventKind(event)
    var routed: [String: Any] = [
        "event_kind": eventKind,
        "type": event,
        "phase": route.phase,
        "delivery_role": route.captured ? "captured" : "owned",
        "sequence": sourceSequencePayload ?? ["source": "daemon", "value": sourceSequence ?? event],
        "gesture_id": gestureID ?? sourceSequence ?? "\(event):\(route.region.id)",
        "coordinate_authority": "daemon",
        "source_origin": "daemon",
        "source_event": sourceSequence ?? event,
        "region_id": route.region.id,
        "owner_canvas_id": route.region.ownerCanvasID,
    ]
    if let sourceSequencePayload {
        routed["source_sequence"] = sourceSequencePayload
    }
    if let desktopWorld {
        routed["desktop_world"] = desktopWorld
    }
    if let captureID = route.captureID {
        routed["capture_id"] = captureID
    }
    if let button = data["button"] {
        routed["button"] = button
    } else if eventKind == "pointer" {
        routed["button"] = aosInputRegionButton(event)
    }
    if let buttons = data["buttons"] {
        routed["buttons"] = buttons
    } else if eventKind == "pointer" {
        routed["buttons"] = aosInputRegionButtons(event: event, phase: route.phase)
    }
    if let scroll = data["scroll"] {
        routed["scroll"] = scroll
    }
    if let key = data["key"] {
        routed["key"] = key
    }
    if let cancelReason = data["cancel_reason"] {
        routed["cancel_reason"] = cancelReason
    }
    if aosInputRegionCanClaimRoutedSchemaVersion(routed) {
        routed["routed_schema_version"] = 1
    }
    return routed
}

private func aosInputRegionEventKind(_ event: String) -> String {
    switch event {
    case "scroll_wheel":
        return "scroll"
    case "key_down", "key_up":
        return "key"
    case "pointer_cancel", "mouse_cancel":
        return "cancel"
    default:
        return "pointer"
    }
}

private func aosInputRegionButton(_ event: String) -> String {
    if event.hasPrefix("left_") { return "left" }
    if event.hasPrefix("right_") { return "right" }
    if event.hasPrefix("middle_") { return "middle" }
    if event.hasPrefix("other_") { return "other:0" }
    return "none"
}

private func aosInputRegionButtons(event: String, phase: String) -> [String: Any] {
    let pressed = phase == "down" || phase == "drag"
    return [
        "left": event.hasPrefix("left_") && pressed,
        "right": event.hasPrefix("right_") && pressed,
        "middle": event.hasPrefix("middle_") && pressed,
        "other_pressed": event.hasPrefix("other_") && pressed ? [0] : [],
    ]
}

private func aosInputRegionCanClaimRoutedSchemaVersion(_ routed: [String: Any]) -> Bool {
    guard routed["type"] is String,
          routed["delivery_role"] is String,
          routed["sequence"] is [String: Any],
          routed["gesture_id"] is String,
          routed["desktop_world"] is [String: Any],
          routed["coordinate_authority"] is String,
          routed["source_origin"] is String,
          routed["source_event"] != nil else {
        return false
    }

    if let deliveryRole = routed["delivery_role"] as? String,
       deliveryRole == "owned" || deliveryRole == "captured",
       !(routed["region_id"] is String && routed["owner_canvas_id"] is String) {
        return false
    }
    if (routed["delivery_role"] as? String) == "captured" && !(routed["capture_id"] is String) {
        return false
    }

    switch routed["event_kind"] as? String {
    case "pointer":
        guard let phase = routed["phase"] as? String,
              ["down", "move", "drag", "up", "enter", "hover", "leave", "hover_cancel"].contains(phase),
              routed["button"] != nil,
              routed["buttons"] is [String: Any] else {
            return false
        }
        return true
    case "scroll":
        return (routed["phase"] as? String) == "scroll" && routed["scroll"] is [String: Any]
    case "key":
        return routed["key"] is [String: Any]
    case "cancel":
        return (routed["phase"] as? String) == "cancel" && routed["cancel_reason"] is String
    default:
        return false
    }
}

final class AOSInputRegionRegistry {
    private var regions: [String: AOSInputRegionRecord] = [:]
    private var captureRegionID: String?
    private var captureID: String?

    var allRegions: [AOSInputRegionRecord] {
        regions.values.sorted(by: sortRegions)
    }

    func register(_ region: AOSInputRegionRecord) {
        regions[region.id] = region
    }

    func remove(id: String) -> AOSInputRegionRecord? {
        if captureRegionID == id {
            captureRegionID = nil
            captureID = nil
        }
        return regions.removeValue(forKey: id)
    }

    @discardableResult
    func removeOwned(by ownerCanvasID: String, includeSuspendRetained: Bool = true) -> [AOSInputRegionRecord] {
        let removed = regions.values.filter { region in
            region.ownerCanvasID == ownerCanvasID && (includeSuspendRetained || region.removeOnOwnerSuspend)
        }
        for region in removed {
            _ = remove(id: region.id)
        }
        return removed.sorted(by: sortRegions)
    }

    func snapshot(ownerCanvasID: String? = nil) -> [AOSInputRegionRecord] {
        allRegions.filter { ownerCanvasID == nil || $0.ownerCanvasID == ownerCanvasID }
    }

    func activeCaptureSnapshot() -> [String: Any]? {
        guard let captureRegionID else { return nil }
        var snapshot: [String: Any] = ["region_id": captureRegionID]
        if let captureID {
            snapshot["capture_id"] = captureID
        }
        if let region = regions[captureRegionID] {
            snapshot["owner_canvas_id"] = region.ownerCanvasID
            snapshot["semantic_label"] = region.semanticLabel
            snapshot["consume_policy"] = region.consumePolicy
        }
        return snapshot
    }

    func route(eventType: String, point: CGPoint?, sourceSequence: String? = nil, gestureID: String? = nil) -> AOSInputRegionRoute? {
        guard let phase = aosInputRegionPointerPhases[eventType] else { return nil }

        if let capturedID = captureRegionID, let capturedRegion = regions[capturedID] {
            let stableCaptureID = captureID ?? AOSInputRegionRegistry.defaultCaptureID(
                regionID: capturedRegion.id,
                sourceSequence: sourceSequence,
                gestureID: gestureID
            )
            let route = AOSInputRegionRoute(
                region: capturedRegion,
                phase: phase,
                captured: true,
                captureID: stableCaptureID,
                shouldConsume: capturedRegion.shouldConsume(eventType: eventType, captured: true)
            )
            if aosInputRegionTerminalPhases.contains(eventType) {
                captureRegionID = nil
                captureID = nil
            }
            return route
        }

        guard let point,
              let region = pickRegion(at: point) else { return nil }

        if aosInputRegionDownPhases.contains(eventType), region.shouldConsumeOnDown {
            captureRegionID = region.id
            captureID = AOSInputRegionRegistry.defaultCaptureID(
                regionID: region.id,
                sourceSequence: sourceSequence,
                gestureID: gestureID
            )
        }

        return AOSInputRegionRoute(
            region: region,
            phase: phase,
            captured: false,
            captureID: captureID,
            shouldConsume: region.shouldConsume(eventType: eventType, captured: false)
        )
    }

    static func defaultCaptureID(regionID: String, sourceSequence: String?, gestureID: String?) -> String {
        if let sourceSequence, !sourceSequence.isEmpty { return "\(sourceSequence):\(regionID)" }
        if let gestureID, !gestureID.isEmpty { return "\(gestureID):\(regionID)" }
        return "capture:\(regionID)"
    }

    private func pickRegion(at point: CGPoint) -> AOSInputRegionRecord? {
        regions.values
            .filter { $0.contains(point) }
            .sorted(by: sortRegions)
            .first
    }

    private func sortRegions(_ lhs: AOSInputRegionRecord, _ rhs: AOSInputRegionRecord) -> Bool {
        if lhs.priority != rhs.priority { return lhs.priority > rhs.priority }
        if lhs.ownerCanvasID != rhs.ownerCanvasID { return lhs.ownerCanvasID < rhs.ownerCanvasID }
        return lhs.id < rhs.id
    }
}

struct AOSInputSurfaceRecord: Equatable {
    let id: String
    let nativeFrame: CGRect
    let interactive: Bool
    let suspended: Bool
    let clickThrough: Bool
    let windowLevel: String?
    let windowNumber: Int?

    init(
        id: String,
        nativeFrame: CGRect,
        interactive: Bool,
        suspended: Bool = false,
        clickThrough: Bool = false,
        windowLevel: String? = nil,
        windowNumber: Int? = nil
    ) {
        self.id = id
        self.nativeFrame = nativeFrame
        self.interactive = interactive
        self.suspended = suspended
        self.clickThrough = clickThrough
        self.windowLevel = windowLevel
        self.windowNumber = windowNumber
    }
}

enum AOSInputSurfaceHitDecision: Equatable {
    case none
    case surface(AOSInputSurfaceRecord)
    case ambiguous([AOSInputSurfaceRecord])

    var shouldConsume: Bool {
        if case .surface = self { return true }
        return false
    }
}

func aosInputWindowLevelRank(_ level: String?, interactive: Bool) -> Int {
    let normalized = level?
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .lowercased()
        .replacingOccurrences(of: "-", with: "_")

    switch normalized {
    case "screen_saver":
        return 300
    case "status_bar":
        return 200
    case "floating":
        return 100
    case "automatic", nil:
        return interactive ? 100 : 200
    default:
        return interactive ? 100 : 200
    }
}

func frontmostHittableAOSSurface(
    at point: CGPoint,
    surfaces: [AOSInputSurfaceRecord],
    frontToBackWindowNumbers: [Int] = []
) -> AOSInputSurfaceHitDecision {
    let hittable = surfaces.filter { surface in
        surface.interactive &&
        !surface.suspended &&
        !surface.clickThrough &&
        surface.nativeFrame.width > 0 &&
        surface.nativeFrame.height > 0 &&
        surface.nativeFrame.contains(point)
    }

    guard !hittable.isEmpty else { return .none }
    if hittable.count == 1, let only = hittable.first { return .surface(only) }

    let order = Dictionary(uniqueKeysWithValues: frontToBackWindowNumbers.enumerated().map { ($0.element, $0.offset) })
    let ordered = hittable.sorted { lhs, rhs in
        let lhsOrder = lhs.windowNumber.flatMap { order[$0] }
        let rhsOrder = rhs.windowNumber.flatMap { order[$0] }
        if let lhsOrder, let rhsOrder, lhsOrder != rhsOrder { return lhsOrder < rhsOrder }

        let lhsRank = aosInputWindowLevelRank(lhs.windowLevel, interactive: lhs.interactive)
        let rhsRank = aosInputWindowLevelRank(rhs.windowLevel, interactive: rhs.interactive)
        if lhsRank != rhsRank { return lhsRank > rhsRank }

        return lhs.id < rhs.id
    }

    guard let first = ordered.first else { return .none }
    let tied = ordered.filter { candidate in
        let firstOrder = first.windowNumber.flatMap { order[$0] }
        let candidateOrder = candidate.windowNumber.flatMap { order[$0] }
        let bothHaveKnownOrder = firstOrder != nil && candidateOrder != nil
        let sameKnownOrder = bothHaveKnownOrder && firstOrder == candidateOrder
        let missingKnownOrder = firstOrder == nil || candidateOrder == nil
        let sameLevel = aosInputWindowLevelRank(first.windowLevel, interactive: first.interactive)
            == aosInputWindowLevelRank(candidate.windowLevel, interactive: candidate.interactive)

        return sameKnownOrder || (missingKnownOrder && sameLevel)
    }

    if tied.count > 1 { return .ambiguous(tied) }
    return .surface(first)
}
