import Foundation
import CoreGraphics

enum AOSInputEventKind: String {
    case pointer
    case scroll
    case key
    case cancel
}

enum AOSInputEventPhase: String {
    case down
    case move
    case drag
    case up
    case scroll
    case cancel
}

enum AOSInputButton: Equatable {
    case none
    case left
    case right
    case middle
    case other(Int)

    var rawValue: String {
        switch self {
        case .none: return "none"
        case .left: return "left"
        case .right: return "right"
        case .middle: return "middle"
        case .other(let id): return "other:\(id)"
        }
    }
}

enum AOSInputCancelReason: String {
    case osCancelled = "os_cancelled"
    case surfaceRemoved = "surface_removed"
    case surfaceSuspended = "surface_suspended"
    case surfaceDisabled = "surface_disabled"
    case ownerDisconnected = "owner_disconnected"
    case topologyStale = "topology_stale"
    case captureTimeout = "capture_timeout"
    case emergencyCommand = "emergency_command"
}

struct AOSInputButtonState: Equatable {
    let left: Bool
    let right: Bool
    let middle: Bool
    let otherPressed: [Int]

    var jsonObject: [String: Any] {
        [
            "left": left,
            "right": right,
            "middle": middle,
            "other_pressed": otherPressed,
        ]
    }
}

struct AOSInputEventDescriptor: Equatable {
    let type: String
    let kind: AOSInputEventKind
    let phase: AOSInputEventPhase?
    let button: AOSInputButton?

    init?(type: String) {
        self.type = type
        switch type {
        case "left_mouse_down":
            kind = .pointer; phase = .down; button = .left
        case "left_mouse_dragged":
            kind = .pointer; phase = .drag; button = .left
        case "left_mouse_up":
            kind = .pointer; phase = .up; button = .left
        case "right_mouse_down":
            kind = .pointer; phase = .down; button = .right
        case "right_mouse_dragged":
            kind = .pointer; phase = .drag; button = .right
        case "right_mouse_up":
            kind = .pointer; phase = .up; button = .right
        case "middle_mouse_down":
            kind = .pointer; phase = .down; button = .middle
        case "middle_mouse_dragged":
            kind = .pointer; phase = .drag; button = .middle
        case "middle_mouse_up":
            kind = .pointer; phase = .up; button = .middle
        case "other_mouse_down":
            kind = .pointer; phase = .down; button = .other(0)
        case "other_mouse_dragged":
            kind = .pointer; phase = .drag; button = .other(0)
        case "other_mouse_up":
            kind = .pointer; phase = .up; button = .other(0)
        case "mouse_moved":
            kind = .pointer; phase = .move; button = AOSInputButton.none
        case "scroll_wheel":
            kind = .scroll; phase = .scroll; button = nil
        case "key_down", "key_up":
            kind = .key; phase = nil; button = nil
        case "pointer_cancel", "mouse_cancel":
            kind = .cancel; phase = .cancel; button = nil
        default:
            return nil
        }
    }

    var isDown: Bool { phase == .down }
    var isTerminal: Bool { phase == .up || phase == .cancel }

    var buttonState: AOSInputButtonState? {
        guard kind == .pointer, let button else { return nil }
        let pressed = phase == .down || phase == .drag
        switch button {
        case .left:
            return AOSInputButtonState(left: pressed, right: false, middle: false, otherPressed: [])
        case .right:
            return AOSInputButtonState(left: false, right: pressed, middle: false, otherPressed: [])
        case .middle:
            return AOSInputButtonState(left: false, right: false, middle: pressed, otherPressed: [])
        case .other(let id):
            return AOSInputButtonState(left: false, right: false, middle: false, otherPressed: pressed ? [id] : [])
        case .none:
            return AOSInputButtonState(left: false, right: false, middle: false, otherPressed: [])
        }
    }
}

enum AOSCanonicalInputEvent {
    case pointer(descriptor: AOSInputEventDescriptor, native: CGPoint)
    case scroll(descriptor: AOSInputEventDescriptor, native: CGPoint, dx: Double, dy: Double)
    case key(descriptor: AOSInputEventDescriptor, physicalKeyCode: Int64)
    case cancel(descriptor: AOSInputEventDescriptor, reason: AOSInputCancelReason)

    init?(
        type: String,
        x: Double? = nil,
        y: Double? = nil,
        keyCode: Int64? = nil,
        scrollDX: Double? = nil,
        scrollDY: Double? = nil,
        cancelReason: String? = nil
    ) {
        guard let descriptor = AOSInputEventDescriptor(type: type) else { return nil }
        switch descriptor.kind {
        case .pointer:
            guard let x, let y, x.isFinite, y.isFinite else { return nil }
            self = .pointer(descriptor: descriptor, native: CGPoint(x: x, y: y))
        case .scroll:
            guard let x, let y, let scrollDX, let scrollDY,
                  x.isFinite, y.isFinite, scrollDX.isFinite, scrollDY.isFinite else { return nil }
            self = .scroll(
                descriptor: descriptor,
                native: CGPoint(x: x, y: y),
                dx: scrollDX,
                dy: scrollDY
            )
        case .key:
            guard let keyCode, keyCode >= 0 else { return nil }
            self = .key(descriptor: descriptor, physicalKeyCode: keyCode)
        case .cancel:
            guard let cancelReason, let reason = AOSInputCancelReason(rawValue: cancelReason) else { return nil }
            self = .cancel(descriptor: descriptor, reason: reason)
        }
    }

    init?(canonicalData data: [String: Any]) {
        guard (data["input_schema_version"] as? Int) == 2,
              let type = data["type"] as? String,
              let descriptor = AOSInputEventDescriptor(type: type),
              (data["event_kind"] as? String) == descriptor.kind.rawValue,
              (data["phase"] as? String) == descriptor.phase?.rawValue else {
            return nil
        }
        switch descriptor.kind {
        case .pointer:
            guard let point = AOSCanonicalInputEvent.nativePoint(data) else { return nil }
            self = .pointer(descriptor: descriptor, native: point)
        case .scroll:
            guard let point = AOSCanonicalInputEvent.nativePoint(data),
                  let scroll = data["scroll"] as? [String: Any],
                  let dx = scroll["dx"] as? Double,
                  let dy = scroll["dy"] as? Double,
                  (scroll["unit"] as? String) == "point",
                  dx.isFinite,
                  dy.isFinite else { return nil }
            self = .scroll(descriptor: descriptor, native: point, dx: dx, dy: dy)
        case .key:
            guard let key = data["key"] as? [String: Any],
                  let keyCode = key["physical_key_code"] as? Int,
                  keyCode >= 0 else { return nil }
            self = .key(descriptor: descriptor, physicalKeyCode: Int64(keyCode))
        case .cancel:
            guard let value = data["cancel_reason"] as? String,
                  let reason = AOSInputCancelReason(rawValue: value) else { return nil }
            self = .cancel(descriptor: descriptor, reason: reason)
        }
    }

    var descriptor: AOSInputEventDescriptor {
        switch self {
        case .pointer(let descriptor, _),
             .scroll(let descriptor, _, _, _),
             .key(let descriptor, _),
             .cancel(let descriptor, _):
            return descriptor
        }
    }

    var nativePoint: CGPoint? {
        switch self {
        case .pointer(_, let native), .scroll(_, let native, _, _): return native
        case .key, .cancel: return nil
        }
    }

    private static func nativePoint(_ data: [String: Any]) -> CGPoint? {
        guard let native = data["native"] as? [String: Any],
              let x = native["x"] as? Double,
              let y = native["y"] as? Double,
              x.isFinite,
              y.isFinite else { return nil }
        return CGPoint(x: x, y: y)
    }
}
