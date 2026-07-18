import Foundation
import CoreGraphics

struct AOSNativeCursorSuppressionReconcileResult: Equatable {
    let hideNativeCursor: Bool
    let showNativeCursor: Bool
    let active: Bool
}

final class AOSNativeCursorSuppressionReconciler {
    private var active = false

    func reconcile(active targetActive: Bool) -> AOSNativeCursorSuppressionReconcileResult {
        let hide = targetActive && !active
        let show = !targetActive && active
        active = targetActive
        return AOSNativeCursorSuppressionReconcileResult(
            hideNativeCursor: hide,
            showNativeCursor: show,
            active: active
        )
    }

    func restore() -> AOSNativeCursorSuppressionReconcileResult {
        reconcile(active: false)
    }

    func snapshot() -> Bool {
        active
    }
}

struct AOSInputRegionRecord: Equatable {
    let id: String
    let ownerCanvasGeneration: CanvasLifecycleGeneration
    let nativeFrame: CGRect
    let coordinateSpace: String
    let semanticLabel: String
    let priority: Int
    let consumePolicy: String
    let metadata: [String: String]
    let removeOnOwnerSuspend: Bool
    let enabled: Bool

    var ownerCanvasID: String { ownerCanvasGeneration.canvasID }

    init(
        id: String,
        ownerCanvasGeneration: CanvasLifecycleGeneration,
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
        self.ownerCanvasGeneration = ownerCanvasGeneration
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

    func shouldConsume(phase: AOSInputEventPhase, captured: Bool) -> Bool {
        switch consumePolicy {
        case "never":
            return false
        case "down_only":
            return phase == .down
        case "captured":
            return captured || phase == .down
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

private enum AOSInputRegionDeliveryRole: String {
    case owned
    case captured
}

private enum AOSInputCoordinateAuthority: String {
    case daemon
}

private enum AOSInputSourceOrigin: String {
    case daemon
}

struct AOSInputRegionRoutedInput {
    private let eventKind: AOSInputEventKind
    private let type: String
    private let phase: AOSInputEventPhase
    private let deliveryRole: AOSInputRegionDeliveryRole
    private let sequenceValue: String
    private let gestureID: String
    private let desktopWorld: CGPoint
    private let sourceEvent: String
    private let regionID: String
    private let ownerCanvasID: String
    private let captureID: String?
    private let button: String?
    private let buttons: [String: Any]?
    private let scroll: (dx: Double, dy: Double)?
    private let cancelReason: String?

    init?(
        event: AOSCanonicalInputEvent,
        route: AOSInputRegionRoute,
        desktopWorld: CGPoint?,
        sourceSequence: String?,
        gestureID: String?
    ) {
        let descriptor = event.descriptor
        guard descriptor.kind != .key,
              let phase = descriptor.phase,
              route.phase == phase.rawValue,
              let desktopWorld,
              desktopWorld.x.isFinite,
              desktopWorld.y.isFinite,
              !route.region.id.isEmpty,
              !route.region.ownerCanvasID.isEmpty else {
            return nil
        }

        let deliveryRole: AOSInputRegionDeliveryRole = route.captured ? .captured : .owned
        let captureID: String?
        if deliveryRole == .captured {
            guard let candidate = route.captureID, !candidate.isEmpty else { return nil }
            captureID = candidate
        } else {
            captureID = nil
        }

        let button: String?
        let buttons: [String: Any]?
        let scroll: (dx: Double, dy: Double)?
        let canonicalCancelReason: String?
        switch event {
        case .pointer:
            button = descriptor.button?.rawValue
            buttons = descriptor.buttonState?.jsonObject
            scroll = nil
            canonicalCancelReason = nil
        case .scroll(_, _, let dx, let dy):
            button = nil
            buttons = nil
            scroll = (dx, dy)
            canonicalCancelReason = nil
        case .cancel(_, let reason):
            button = nil
            buttons = nil
            scroll = nil
            canonicalCancelReason = reason.rawValue
        case .key:
            return nil
        }

        let canonicalSequenceValue = (sourceSequence?.isEmpty == false ? sourceSequence : nil) ?? descriptor.type
        let fallbackIdentity = "\(descriptor.type):\(route.region.id)"
        let canonicalGestureID = (gestureID?.isEmpty == false ? gestureID : nil) ?? fallbackIdentity
        guard !canonicalSequenceValue.isEmpty, !canonicalGestureID.isEmpty else { return nil }

        self.eventKind = descriptor.kind
        self.type = descriptor.type
        self.phase = phase
        self.deliveryRole = deliveryRole
        self.sequenceValue = canonicalSequenceValue
        self.gestureID = canonicalGestureID
        self.desktopWorld = desktopWorld
        self.sourceEvent = canonicalSequenceValue
        self.regionID = route.region.id
        self.ownerCanvasID = route.region.ownerCanvasID
        self.captureID = captureID
        self.button = button
        self.buttons = buttons
        self.scroll = scroll
        self.cancelReason = canonicalCancelReason
    }

    var jsonObject: [String: Any] {
        var result: [String: Any] = [
            "routed_schema_version": 1,
            "event_kind": eventKind.rawValue,
            "type": type,
            "phase": phase.rawValue,
            "delivery_role": deliveryRole.rawValue,
            "sequence": ["source": "daemon", "value": sequenceValue],
            "gesture_id": gestureID,
            "desktop_world": ["x": Double(desktopWorld.x), "y": Double(desktopWorld.y)],
            "coordinate_authority": AOSInputCoordinateAuthority.daemon.rawValue,
            "source_origin": AOSInputSourceOrigin.daemon.rawValue,
            "source_event": sourceEvent,
            "region_id": regionID,
            "owner_canvas_id": ownerCanvasID,
        ]
        if let captureID { result["capture_id"] = captureID }
        if let button { result["button"] = button }
        if let buttons { result["buttons"] = buttons }
        if let scroll { result["scroll"] = ["dx": scroll.dx, "dy": scroll.dy, "unit": "point"] }
        if let cancelReason { result["cancel_reason"] = cancelReason }
        return result
    }
}

func aosInputRegionEventEnvelope(routedInput: AOSInputRegionRoutedInput) -> [String: Any] {
    return [
        "type": "input_region.event",
        "routed_input": routedInput.jsonObject,
    ]
}

struct AOSInputRegionDelivery {
    let ownerCanvasID: String
    let ownerCanvasGeneration: CanvasLifecycleGeneration
    let phase: AOSInputEventPhase
    let regionID: String
    let consume: Bool
    private let routedInput: AOSInputRegionRoutedInput

    init(
        routedInput: AOSInputRegionRoutedInput,
        route: AOSInputRegionRoute,
        phase: AOSInputEventPhase
    ) {
        self.ownerCanvasID = route.region.ownerCanvasID
        self.ownerCanvasGeneration = route.region.ownerCanvasGeneration
        self.phase = phase
        self.regionID = route.region.id
        self.consume = route.shouldConsume
        self.routedInput = routedInput
    }

    var payload: [String: Any] {
        aosInputRegionEventEnvelope(routedInput: routedInput)
    }
}

enum AOSInputRegionDeliveryDecision {
    case deliver(AOSInputRegionDelivery)
    case failOpen
}

func aosInputRegionDeliveryDecision(
    event: AOSCanonicalInputEvent?,
    route: AOSInputRegionRoute,
    desktopWorld: CGPoint?,
    sourceSequence: String?,
    gestureID: String?
) -> AOSInputRegionDeliveryDecision {
    guard let event,
          let phase = event.descriptor.phase,
          let routedInput = AOSInputRegionRoutedInput(
            event: event,
            route: route,
            desktopWorld: desktopWorld,
            sourceSequence: sourceSequence,
            gestureID: gestureID
          ) else {
        return .failOpen
    }
    return .deliver(AOSInputRegionDelivery(routedInput: routedInput, route: route, phase: phase))
}

final class AOSInputRegionRegistry {
    private var regions: [String: AOSInputRegionRecord] = [:]
    private var captureRegionID: String?
    private var captureID: String?
    private var captureDesktopWorld: CGPoint?

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
            captureDesktopWorld = nil
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

    func nativeCursorSuppressionActive() -> Bool {
        regions.values.contains { region in
            guard region.enabled else { return false }
            let value = region.metadata["cursor_suppression"]?
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .lowercased()
                .replacingOccurrences(of: "-", with: "_")
            return value == "hide_native" || value == "hidden" || value == "true"
        }
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

    func clearCapture() {
        captureRegionID = nil
        captureID = nil
        captureDesktopWorld = nil
    }

    func route(
        event: AOSInputEventDescriptor,
        point: CGPoint?,
        desktopWorld: CGPoint? = nil,
        sourceSequence: String? = nil,
        gestureID: String? = nil
    ) -> AOSInputRegionRoute? {
        guard let phase = event.phase else { return nil }

        if let capturedID = captureRegionID, let capturedRegion = regions[capturedID] {
            let stableCaptureID = captureID ?? AOSInputRegionRegistry.defaultCaptureID(
                regionID: capturedRegion.id,
                sourceSequence: sourceSequence,
                gestureID: gestureID
            )
            let route = AOSInputRegionRoute(
                region: capturedRegion,
                phase: phase.rawValue,
                captured: true,
                captureID: stableCaptureID,
                shouldConsume: capturedRegion.shouldConsume(phase: phase, captured: true)
            )
            if event.isTerminal {
                clearCapture()
            } else if let desktopWorld {
                captureDesktopWorld = desktopWorld
            }
            return route
        }

        guard let point,
              let region = pickRegion(at: point) else { return nil }

        if event.isDown, region.shouldConsumeOnDown {
            captureRegionID = region.id
            captureID = AOSInputRegionRegistry.defaultCaptureID(
                regionID: region.id,
                sourceSequence: sourceSequence,
                gestureID: gestureID
            )
            captureDesktopWorld = desktopWorld
        }

        return AOSInputRegionRoute(
            region: region,
            phase: phase.rawValue,
            captured: false,
            captureID: captureID,
            shouldConsume: region.shouldConsume(phase: phase, captured: false)
        )
    }

    func resolveDelivery(
        descriptor: AOSInputEventDescriptor,
        event: AOSCanonicalInputEvent?,
        point: CGPoint?,
        desktopWorld: CGPoint?,
        sourceSequence: String? = nil,
        gestureID: String? = nil
    ) -> AOSInputRegionDeliveryDecision? {
        guard let route = route(
            event: descriptor,
            point: point,
            desktopWorld: desktopWorld,
            sourceSequence: sourceSequence,
            gestureID: gestureID
        ) else {
            return nil
        }
        let decision = aosInputRegionDeliveryDecision(
            event: event,
            route: route,
            desktopWorld: desktopWorld,
            sourceSequence: sourceSequence,
            gestureID: gestureID
        )
        if case .failOpen = decision {
            clearCapture()
        }
        return decision
    }

    func cancelActiveCapture(
        reason: AOSInputCancelReason,
        sourceSequence: String? = nil,
        gestureID: String? = nil
    ) -> AOSInputRegionDeliveryDecision? {
        guard let capturedID = captureRegionID,
              let region = regions[capturedID] else { return nil }
        guard let desktopWorld = captureDesktopWorld,
              let event = AOSCanonicalInputEvent(type: "pointer_cancel", cancelReason: reason.rawValue) else {
            clearCapture()
            return .failOpen
        }
        let route = AOSInputRegionRoute(
            region: region,
            phase: AOSInputEventPhase.cancel.rawValue,
            captured: true,
            captureID: captureID ?? AOSInputRegionRegistry.defaultCaptureID(
                regionID: region.id,
                sourceSequence: sourceSequence,
                gestureID: gestureID
            ),
            shouldConsume: region.shouldConsume(phase: .cancel, captured: true)
        )
        clearCapture()
        return aosInputRegionDeliveryDecision(
            event: event,
            route: route,
            desktopWorld: desktopWorld,
            sourceSequence: sourceSequence,
            gestureID: gestureID
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
