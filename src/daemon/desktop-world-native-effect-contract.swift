import CoreFoundation
import Foundation

struct AOSDesktopWorldNativeRippleParameters: Equatable {
    static let defaults = Self(
        amplitude: 18,
        decay: 2.4,
        durationMilliseconds: 900,
        frequency: 0.045,
        radius: 1_200,
        speed: 850
    )

    let amplitude: Double
    let decay: Double
    let durationMilliseconds: Int
    let frequency: Double
    let radius: Double
    let speed: Double
}

struct AOSDesktopWorldNativeEffectBinding: Equatable {
    static let capability = "aos.scene.native_sheet_effect"
    static let desktopRippleImplementation = "aos.scene.effect.desktop-ripple"

    enum Phase: String {
        case end
        case start
    }

    enum Trigger: Equatable {
        case gesture(Phase)
        case pointerDown(button: String)
    }

    let affordanceID: String
    let implementation: String
    let interactionID: String
    let ripple: AOSDesktopWorldNativeRippleParameters
    let trigger: Trigger
}

struct AOSDesktopWorldNativeEffectRequest: Equatable {
    let binding: AOSDesktopWorldNativeEffectBinding
    let canvasGeneration: UInt64
    let desktopWorldOrigin: CGPoint
    let ownerID: String
    let resourceID: String
    let resourceRevision: Int
    let topologyGeneration: UInt64

    static func == (
        lhs: AOSDesktopWorldNativeEffectRequest,
        rhs: AOSDesktopWorldNativeEffectRequest
    ) -> Bool {
        lhs.binding == rhs.binding
            && lhs.canvasGeneration == rhs.canvasGeneration
            && lhs.desktopWorldOrigin.x == rhs.desktopWorldOrigin.x
            && lhs.desktopWorldOrigin.y == rhs.desktopWorldOrigin.y
            && lhs.ownerID == rhs.ownerID
            && lhs.resourceID == rhs.resourceID
            && lhs.resourceRevision == rhs.resourceRevision
            && lhs.topologyGeneration == rhs.topologyGeneration
    }
}

enum AOSDesktopWorldNativeEffectContract {
    private static let maximumInteractions = 256

    static func parseBindings(
        _ interactions: [String: Any]?
    ) -> [AOSDesktopWorldNativeEffectBinding]? {
        guard let interactions else { return [] }
        guard Set(interactions.keys).isSubset(of: Set([
            "affordances", "contract", "interactions", "schemaVersion",
        ])),
              interactions["contract"] as? String == "aos.scene.cartridge.interactions.v1",
              interactions["schemaVersion"] as? Int == 1,
              let values = interactions["interactions"] as? [[String: Any]],
              values.count <= maximumInteractions else {
            return nil
        }

        var bindings: [AOSDesktopWorldNativeEffectBinding] = []
        var interactionIDs = Set<String>()
        var nativeTriggerKeys = Set<String>()
        for value in values {
            guard let interactionID = value["id"] as? String,
                  canonicalID(interactionID),
                  let affordanceID = value["affordanceId"] as? String,
                  canonicalID(affordanceID),
                  interactionIDs.insert(interactionID).inserted else {
                return nil
            }
            guard let effect = value["nativeEffect"] else { continue }
            guard
                  let dictionary = effect as? [String: Any],
                  Set(dictionary.keys) == Set(["implementation", "parameters", "trigger"]),
                  dictionary["implementation"] as? String ==
                    AOSDesktopWorldNativeEffectBinding.desktopRippleImplementation,
                  let trigger = dictionary["trigger"] as? [String: Any],
                  let parsedTrigger = nativeTrigger(trigger),
                  let parameters = dictionary["parameters"] as? [String: Any],
                  let ripple = rippleParameters(parameters) else {
                return nil
            }
            let triggerKey = "\(affordanceID):\(nativeTriggerKey(parsedTrigger))"
            guard nativeTriggerKeys.insert(triggerKey).inserted else { return nil }
            bindings.append(AOSDesktopWorldNativeEffectBinding(
                affordanceID: affordanceID,
                implementation: AOSDesktopWorldNativeEffectBinding.desktopRippleImplementation,
                interactionID: interactionID,
                ripple: ripple,
                trigger: parsedTrigger
            ))
        }
        return bindings
    }

    static func request(
        binding: AOSDesktopWorldNativeEffectBinding,
        authorization: (ownerID: String, resourceID: String, revision: Int),
        identity: AOSDesktopWorldSceneStageIdentity,
        event: [String: Any]
    ) -> AOSDesktopWorldNativeEffectRequest? {
        guard case .gesture(let phase) = binding.trigger else { return nil }
        guard let interactionID = event["interactionId"] as? String,
              interactionID == binding.interactionID,
              let gesture = event["gesture"] as? [String: Any],
              gesture["phase"] as? String == phase.rawValue,
              let coordinates = event["coordinates"] as? [String: Any],
              let point = coordinates["desktopWorld"] as? [String: Any],
              let x = finiteDouble(point["x"]),
              let y = finiteDouble(point["y"]) else {
            return nil
        }
        return AOSDesktopWorldNativeEffectRequest(
            binding: binding,
            canvasGeneration: identity.canvasGeneration,
            desktopWorldOrigin: CGPoint(x: x, y: y),
            ownerID: authorization.ownerID,
            resourceID: authorization.resourceID,
            resourceRevision: authorization.revision,
            topologyGeneration: identity.topologyGeneration
        )
    }

    static func gestureRequest(
        bindings: [AOSDesktopWorldNativeEffectBinding],
        capabilities: Set<String>,
        ownerID: String,
        resourceID: String,
        resourceRevision: Int,
        identity: AOSDesktopWorldSceneStageIdentity,
        event: [String: Any]
    ) -> AOSDesktopWorldNativeEffectRequest? {
        guard authorized(capabilities) else { return nil }
        for binding in bindings {
            if let request = request(
                binding: binding,
                authorization: (
                    ownerID: ownerID,
                    resourceID: resourceID,
                    revision: resourceRevision
                ),
                identity: identity,
                event: event
            ) {
                return request
            }
        }
        return nil
    }

    static func pointerRequest(
        binding: AOSDesktopWorldNativeEffectBinding,
        authorization: (ownerID: String, resourceID: String, revision: Int),
        identity: AOSDesktopWorldSceneStageIdentity,
        affordanceID: String,
        phase: String,
        button: String,
        point: CGPoint
    ) -> AOSDesktopWorldNativeEffectRequest? {
        guard case .pointerDown(let expectedButton) = binding.trigger,
              phase == "down",
              button == expectedButton,
              binding.affordanceID == affordanceID,
              point.x.isFinite,
              point.y.isFinite else {
            return nil
        }
        return AOSDesktopWorldNativeEffectRequest(
            binding: binding,
            canvasGeneration: identity.canvasGeneration,
            desktopWorldOrigin: point,
            ownerID: authorization.ownerID,
            resourceID: authorization.resourceID,
            resourceRevision: authorization.revision,
            topologyGeneration: identity.topologyGeneration
        )
    }

    static func pointerRequest(
        bindings: [AOSDesktopWorldNativeEffectBinding],
        capabilities: Set<String>,
        ownerID: String,
        resourceID: String,
        resourceRevision: Int,
        identity: AOSDesktopWorldSceneStageIdentity,
        affordanceID: String,
        phase: String,
        button: String,
        point: CGPoint
    ) -> AOSDesktopWorldNativeEffectRequest? {
        guard authorized(capabilities) else { return nil }
        for binding in bindings {
            if let request = pointerRequest(
                binding: binding,
                authorization: (
                    ownerID: ownerID,
                    resourceID: resourceID,
                    revision: resourceRevision
                ),
                identity: identity,
                affordanceID: affordanceID,
                phase: phase,
                button: button,
                point: point
            ) {
                return request
            }
        }
        return nil
    }

    static func authorizes(
        _ request: AOSDesktopWorldNativeEffectRequest,
        bindings: [AOSDesktopWorldNativeEffectBinding],
        capabilities: Set<String>,
        ownerID: String,
        resourceID: String,
        resourceRevision: Int
    ) -> Bool {
        authorized(capabilities)
            && ownerID == request.ownerID
            && resourceID == request.resourceID
            && resourceRevision == request.resourceRevision
            && bindings.contains(request.binding)
    }

    static func available(
        bindings: [AOSDesktopWorldNativeEffectBinding],
        capabilities: Set<String>
    ) -> Bool {
        !bindings.isEmpty && authorized(capabilities)
    }

    private static func authorized(_ capabilities: Set<String>) -> Bool {
        capabilities.contains(AOSDesktopWorldNativeEffectBinding.capability)
            && capabilities.contains("aos.scene.desktop_frame_texture")
    }

    private static func nativeTrigger(
        _ value: [String: Any]
    ) -> AOSDesktopWorldNativeEffectBinding.Trigger? {
        if Set(value.keys).isSubset(of: Set(["button", "input"])),
           value["input"] as? String == "pointer_down" {
            let button: String
            if value.keys.contains("button") {
                guard let declared = value["button"] as? String else { return nil }
                button = declared
            } else {
                button = "left"
            }
            guard ["left", "middle", "right"].contains(button) else { return nil }
            return .pointerDown(button: button)
        }
        if Set(value.keys) == Set(["phase"]),
           let phaseValue = value["phase"] as? String,
           let phase = AOSDesktopWorldNativeEffectBinding.Phase(rawValue: phaseValue) {
            return .gesture(phase)
        }
        return nil
    }

    private static func nativeTriggerKey(
        _ value: AOSDesktopWorldNativeEffectBinding.Trigger
    ) -> String {
        switch value {
        case .pointerDown(let button):
            return "input:pointer_down:\(button)"
        case .gesture(let phase):
            return "gesture:\(phase.rawValue)"
        }
    }

    private static func rippleParameters(
        _ value: [String: Any]
    ) -> AOSDesktopWorldNativeRippleParameters? {
        guard Set(value.keys).isSubset(of: Set([
            "amplitude", "decay", "durationMs", "frequency", "radius", "speed",
        ])) else { return nil }
        let defaults = AOSDesktopWorldNativeRippleParameters.defaults
        guard let amplitude = bounded(value["amplitude"], default: defaults.amplitude, 0...96),
              let decay = bounded(value["decay"], default: defaults.decay, 0...10),
              let duration = bounded(value["durationMs"], default: Double(defaults.durationMilliseconds), 100...3_000),
              duration.rounded() == duration,
              let frequency = bounded(value["frequency"], default: defaults.frequency, 0.001...0.25),
              let radius = bounded(value["radius"], default: defaults.radius, 32...5_000),
              let speed = bounded(value["speed"], default: defaults.speed, 10...4_000) else {
            return nil
        }
        return AOSDesktopWorldNativeRippleParameters(
            amplitude: amplitude,
            decay: decay,
            durationMilliseconds: Int(duration),
            frequency: frequency,
            radius: radius,
            speed: speed
        )
    }

    private static func bounded(
        _ value: Any?,
        default fallback: Double,
        _ range: ClosedRange<Double>
    ) -> Double? {
        guard value != nil else { return fallback }
        guard let number = finiteDouble(value), range.contains(number) else { return nil }
        return number
    }

    private static func finiteDouble(_ value: Any?) -> Double? {
        guard let number = value as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        let result = number.doubleValue
        return result.isFinite ? result : nil
    }

    private static func canonicalID(_ value: String) -> Bool {
        let bytes = Array(value.utf8)
        guard !bytes.isEmpty, bytes.count <= 128 else { return false }
        return bytes.enumerated().allSatisfy { index, byte in
            let alphanumeric = (byte >= 0x30 && byte <= 0x39)
                || (byte >= 0x61 && byte <= 0x7a)
            if index == 0 { return alphanumeric }
            return alphanumeric || [0x2d, 0x2e, 0x2f, 0x5f].contains(byte)
        }
    }
}
