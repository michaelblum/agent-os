import CoreGraphics
import Foundation

enum AOSInputRegionCursorMode: String {
    case hover
    case captured
}

enum AOSInputRegionCursorPhase: String {
    case enter
    case move
    case leave
}

struct AOSInputRegionCursorTarget: Equatable {
    let region: AOSInputRegionRecord
    let mode: AOSInputRegionCursorMode
    let desktopWorld: CGPoint

    func sameIdentity(as other: AOSInputRegionCursorTarget) -> Bool {
        region.id == other.region.id
            && region.ownerCanvasGeneration == other.region.ownerCanvasGeneration
            && mode == other.mode
    }
}

struct AOSInputRegionCursorDelivery {
    let target: AOSInputRegionCursorTarget
    let phase: AOSInputRegionCursorPhase

    var ownerCanvasGeneration: CanvasLifecycleGeneration {
        target.region.ownerCanvasGeneration
    }

    var payload: [String: Any] {
        [
            "type": "input_region.cursor",
            "cursor_presentation": [
                "cursor_schema_version": 1,
                "phase": phase.rawValue,
                "mode": target.mode.rawValue,
                "region_id": target.region.id,
                "desktop_world": [
                    "x": Double(target.desktopWorld.x),
                    "y": Double(target.desktopWorld.y),
                ],
            ],
        ]
    }
}

func aosInputRegionCursorDeliveries(
    from previous: AOSInputRegionCursorTarget?,
    to current: AOSInputRegionCursorTarget?,
    emitMove: Bool
) -> [AOSInputRegionCursorDelivery] {
    if let previous, let current, previous.sameIdentity(as: current) {
        return emitMove ? [AOSInputRegionCursorDelivery(target: current, phase: .move)] : []
    }
    var deliveries: [AOSInputRegionCursorDelivery] = []
    if let previous {
        deliveries.append(AOSInputRegionCursorDelivery(target: previous, phase: .leave))
    }
    if let current {
        deliveries.append(AOSInputRegionCursorDelivery(target: current, phase: .enter))
    }
    return deliveries
}

struct AOSNativeCursorPresentationResult: Equatable {
    let requestedHidden: Bool
    let appliedHidden: Bool
    let didHide: Bool
    let didShow: Bool
    let errorCode: Int32?
}

struct AOSInputRegionCursorPresentationReconcileResult {
    let native: AOSNativeCursorPresentationResult
    let deliveries: [AOSInputRegionCursorDelivery]
}

final class AOSNativeCursorPresentationController {
    typealias CursorOperation = () -> CGError

    private let lock = NSLock()
    private let hide: CursorOperation
    private let show: CursorOperation
    private var requestedHidden = false
    private var appliedHidden = false
    private var hideAttempts = 0
    private var showAttempts = 0
    private var errorCode: Int32?

    init(
        hide: @escaping CursorOperation = { CGDisplayHideCursor(CGMainDisplayID()) },
        show: @escaping CursorOperation = { CGDisplayShowCursor(CGMainDisplayID()) }
    ) {
        self.hide = hide
        self.show = show
    }

    func reconcile(hidden targetHidden: Bool) -> AOSNativeCursorPresentationResult {
        lock.lock()
        defer { lock.unlock() }
        return reconcileLocked(hidden: targetHidden)
    }

    private func reconcileLocked(hidden targetHidden: Bool) -> AOSNativeCursorPresentationResult {
        if requestedHidden != targetHidden {
            requestedHidden = targetHidden
            hideAttempts = 0
            showAttempts = 0
            errorCode = nil
        }

        var didHide = false
        var didShow = false
        if requestedHidden && !appliedHidden && hideAttempts < 2 {
            hideAttempts += 1
            let result = hide()
            if result == .success {
                appliedHidden = true
                errorCode = nil
                didHide = true
            } else {
                errorCode = result.rawValue
            }
        } else if !requestedHidden && appliedHidden && showAttempts < 2 {
            showAttempts += 1
            let result = show()
            if result == .success {
                appliedHidden = false
                errorCode = nil
                didShow = true
            } else {
                errorCode = result.rawValue
            }
        }

        return AOSNativeCursorPresentationResult(
            requestedHidden: requestedHidden,
            appliedHidden: appliedHidden,
            didHide: didHide,
            didShow: didShow,
            errorCode: errorCode
        )
    }

    func restore() -> AOSNativeCursorPresentationResult {
        lock.lock()
        defer { lock.unlock() }
        return reconcileLocked(hidden: false)
    }

    func snapshot() -> AOSNativeCursorPresentationResult {
        lock.lock()
        defer { lock.unlock() }
        return AOSNativeCursorPresentationResult(
            requestedHidden: requestedHidden,
            appliedHidden: appliedHidden,
            didHide: false,
            didShow: false,
            errorCode: errorCode
        )
    }
}

final class AOSInputRegionCursorPresentationCoordinator {
    private let lock = NSLock()
    private let native: AOSNativeCursorPresentationController
    private var publishedTarget: AOSInputRegionCursorTarget?

    init(native: AOSNativeCursorPresentationController = AOSNativeCursorPresentationController()) {
        self.native = native
    }

    func reconcile(
        target: AOSInputRegionCursorTarget?,
        emitMove: Bool
    ) -> AOSInputRegionCursorPresentationReconcileResult {
        lock.lock()
        defer { lock.unlock() }

        let nativeResult = native.reconcile(hidden: target != nil)
        let nextPublishedTarget: AOSInputRegionCursorTarget?
        if let target, nativeResult.appliedHidden {
            nextPublishedTarget = target.region.shouldPublishCursorVisual(mode: target.mode)
                ? target
                : nil
        } else if target == nil, !nativeResult.appliedHidden {
            nextPublishedTarget = nil
        } else {
            nextPublishedTarget = publishedTarget
        }
        let deliveries = aosInputRegionCursorDeliveries(
            from: publishedTarget,
            to: nextPublishedTarget,
            emitMove: emitMove
        )
        publishedTarget = nextPublishedTarget
        return AOSInputRegionCursorPresentationReconcileResult(
            native: nativeResult,
            deliveries: deliveries
        )
    }

    func restore() -> AOSInputRegionCursorPresentationReconcileResult {
        lock.lock()
        defer { lock.unlock() }

        let nativeResult = native.restore()
        let nextPublishedTarget = nativeResult.appliedHidden ? publishedTarget : nil
        let deliveries = aosInputRegionCursorDeliveries(
            from: publishedTarget,
            to: nextPublishedTarget,
            emitMove: false
        )
        publishedTarget = nextPublishedTarget
        return AOSInputRegionCursorPresentationReconcileResult(
            native: nativeResult,
            deliveries: deliveries
        )
    }

    func snapshot() -> AOSNativeCursorPresentationResult {
        native.snapshot()
    }
}
