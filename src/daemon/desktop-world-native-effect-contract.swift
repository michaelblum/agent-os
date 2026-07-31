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

enum AOSDesktopWorldNativeEffectDefinition: Equatable {
    case program(AOSDesktopWorldNativeEffectProgramInstance)
    case ripple(AOSDesktopWorldNativeRippleParameters)

    var durationMilliseconds: Int {
        switch self {
        case .program(let instance):
            return instance.program.durationMilliseconds
        case .ripple(let parameters):
            return parameters.durationMilliseconds
        }
    }
}

struct AOSDesktopWorldNativeEffectInputs: Equatable {
    let current: CGPoint
    let delta: CGPoint
    let origin: CGPoint
    let totalDelta: CGPoint

    static func == (
        lhs: AOSDesktopWorldNativeEffectInputs,
        rhs: AOSDesktopWorldNativeEffectInputs
    ) -> Bool {
        lhs.current.x == rhs.current.x
            && lhs.current.y == rhs.current.y
            && lhs.delta.x == rhs.delta.x
            && lhs.delta.y == rhs.delta.y
            && lhs.origin.x == rhs.origin.x
            && lhs.origin.y == rhs.origin.y
            && lhs.totalDelta.x == rhs.totalDelta.x
            && lhs.totalDelta.y == rhs.totalDelta.y
    }

    static func pointer(_ point: CGPoint) -> Self {
        Self(
            current: point,
            delta: CGPoint(x: 0, y: 0),
            origin: point,
            totalDelta: CGPoint(x: 0, y: 0)
        )
    }
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

    enum Lifecycle: String, Equatable {
        case gesture
        case timed
    }

    let affordanceID: String
    let definition: AOSDesktopWorldNativeEffectDefinition
    let implementation: String
    let interactionID: String
    let lifecycle: Lifecycle
    let trigger: Trigger

    var durationMilliseconds: Int { definition.durationMilliseconds }
    var program: AOSDesktopWorldNativeEffectProgram? {
        guard case .program(let instance) = definition else { return nil }
        return instance.program
    }
}

struct AOSDesktopWorldNativeEffectRequest: Equatable {
    let binding: AOSDesktopWorldNativeEffectBinding
    let canvasGeneration: UInt64
    let eventSequence: Int?
    let inputGeneration: String
    let inputs: AOSDesktopWorldNativeEffectInputs
    let ownerID: String
    let pointerSessionID: String?
    let resourceID: String
    let resourceRevision: Int
    let topologyGeneration: UInt64
    let triggeredAt: TimeInterval

    static func == (
        lhs: AOSDesktopWorldNativeEffectRequest,
        rhs: AOSDesktopWorldNativeEffectRequest
    ) -> Bool {
        lhs.binding == rhs.binding
            && lhs.canvasGeneration == rhs.canvasGeneration
            && lhs.eventSequence == rhs.eventSequence
            && lhs.inputGeneration == rhs.inputGeneration
            && lhs.inputs == rhs.inputs
            && lhs.ownerID == rhs.ownerID
            && lhs.pointerSessionID == rhs.pointerSessionID
            && lhs.resourceID == rhs.resourceID
            && lhs.resourceRevision == rhs.resourceRevision
            && lhs.topologyGeneration == rhs.topologyGeneration
            && lhs.triggeredAt == rhs.triggeredAt
    }

    var desktopWorldOrigin: CGPoint { inputs.current }
}

struct AOSDesktopWorldNativeEffectGestureEvent: Equatable {
    enum Phase: String, Equatable {
        case cancel
        case end
        case update
    }

    let phase: Phase
    let request: AOSDesktopWorldNativeEffectRequest
}

enum AOSDesktopWorldNativeEffectContract {
    private static let maximumInteractions = 256
    private static let maximumBindings = 256
    private static let maximumBindingsPerInteraction = 5
    private static let maximumPrograms = 8

    static func parseBindings(
        _ interactions: [String: Any]?
    ) -> [AOSDesktopWorldNativeEffectBinding]? {
        guard let interactions else { return [] }
        guard Set(interactions.keys).isSubset(of: Set([
            "affordances", "contract", "interactions", "nativeEffectPrograms",
            "schemaVersion",
        ])),
              interactions["contract"] as? String == "aos.scene.cartridge.interactions.v1",
              integer(interactions["schemaVersion"]) == 1,
              let values = interactions["interactions"] as? [[String: Any]],
              values.count <= maximumInteractions else {
            return nil
        }

        let rawPrograms: [[String: Any]]
        if interactions.keys.contains("nativeEffectPrograms") {
            guard let declared = interactions["nativeEffectPrograms"] as? [[String: Any]] else {
                return nil
            }
            rawPrograms = declared
        } else {
            rawPrograms = []
        }
        guard rawPrograms.count <= maximumPrograms else { return nil }
        var programs: [String: AOSDesktopWorldNativeEffectProgram] = [:]
        for raw in rawPrograms {
            guard let program = AOSDesktopWorldNativeEffectProgramContract.parse(
                program: raw
            ), programs[program.id] == nil else {
                return nil
            }
            programs[program.id] = program
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
            guard !(value.keys.contains("nativeEffect")
                && value.keys.contains("nativeEffects")) else {
                return nil
            }
            let rawEffects: [[String: Any]]
            if value.keys.contains("nativeEffects") {
                guard let declared = value["nativeEffects"] as? [[String: Any]],
                      !declared.isEmpty,
                      declared.count <= maximumBindingsPerInteraction else {
                    return nil
                }
                rawEffects = declared
            } else if value.keys.contains("nativeEffect") {
                guard let declared = value["nativeEffect"] as? [String: Any] else {
                    return nil
                }
                rawEffects = [declared]
            } else {
                rawEffects = []
            }
            guard bindings.count + rawEffects.count <= maximumBindings else { return nil }
            for dictionary in rawEffects {
                guard let implementation = dictionary["implementation"] as? String,
                      let trigger = dictionary["trigger"] as? [String: Any],
                      let parsedTrigger = nativeTrigger(trigger),
                      let lifecycle = nativeLifecycle(
                        dictionary["lifecycle"],
                        trigger: parsedTrigger
                      ),
                      let parameters = dictionary["parameters"] as? [String: Any],
                      let definition = effectDefinition(
                        implementation: implementation,
                        dictionary: dictionary,
                        parameters: parameters,
                        programs: programs
                      ) else {
                    return nil
                }
                let triggerKey = "\(affordanceID):\(nativeTriggerKey(parsedTrigger))"
                guard nativeTriggerKeys.insert(triggerKey).inserted else { return nil }
                bindings.append(AOSDesktopWorldNativeEffectBinding(
                    affordanceID: affordanceID,
                    definition: definition,
                    implementation: implementation,
                    interactionID: interactionID,
                    lifecycle: lifecycle,
                    trigger: parsedTrigger
                ))
            }
        }
        return bindings
    }

    static func request(
        binding: AOSDesktopWorldNativeEffectBinding,
        authorization: (ownerID: String, resourceID: String, revision: Int),
        inputGeneration: String,
        identity: AOSDesktopWorldSceneStageIdentity,
        event: [String: Any],
        triggeredAt: TimeInterval = ProcessInfo.processInfo.systemUptime
    ) -> AOSDesktopWorldNativeEffectRequest? {
        guard validInputGeneration(inputGeneration),
              case .gesture(let phase) = binding.trigger else { return nil }
        guard let interactionID = event["interactionId"] as? String,
              interactionID == binding.interactionID,
              let gesture = event["gesture"] as? [String: Any],
              gesture["phase"] as? String == phase.rawValue,
              let pointerSessionID = gesture["pointerSessionId"] as? String,
              canonicalPointerSessionID(pointerSessionID),
              let eventSequence = integer(event["sequence"]),
              eventSequence > 0,
              let coordinates = event["coordinates"] as? [String: Any],
              let inputs = effectInputs(coordinates) else {
            return nil
        }
        return AOSDesktopWorldNativeEffectRequest(
            binding: binding,
            canvasGeneration: identity.canvasGeneration,
            eventSequence: eventSequence,
            inputGeneration: inputGeneration,
            inputs: inputs,
            ownerID: authorization.ownerID,
            pointerSessionID: pointerSessionID,
            resourceID: authorization.resourceID,
            resourceRevision: authorization.revision,
            topologyGeneration: identity.topologyGeneration,
            triggeredAt: triggeredAt
        )
    }

    static func gestureRequest(
        bindings: [AOSDesktopWorldNativeEffectBinding],
        capabilities: Set<String>,
        ownerID: String,
        resourceID: String,
        resourceRevision: Int,
        inputGeneration: String,
        identity: AOSDesktopWorldSceneStageIdentity,
        event: [String: Any],
        triggeredAt: TimeInterval = ProcessInfo.processInfo.systemUptime
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
                inputGeneration: inputGeneration,
                identity: identity,
                event: event,
                triggeredAt: triggeredAt
            ) {
                return request
            }
        }
        return nil
    }

    static func gestureLifecycleEvent(
        bindings: [AOSDesktopWorldNativeEffectBinding],
        capabilities: Set<String>,
        ownerID: String,
        resourceID: String,
        resourceRevision: Int,
        inputGeneration: String,
        identity: AOSDesktopWorldSceneStageIdentity,
        event: [String: Any],
        triggeredAt: TimeInterval = ProcessInfo.processInfo.systemUptime
    ) -> AOSDesktopWorldNativeEffectGestureEvent? {
        guard authorized(capabilities),
              validInputGeneration(inputGeneration),
              let interactionID = event["interactionId"] as? String,
              let gesture = event["gesture"] as? [String: Any],
              let rawPhase = gesture["phase"] as? String,
              let pointerSessionID = gesture["pointerSessionId"] as? String,
              canonicalPointerSessionID(pointerSessionID),
              let eventSequence = integer(event["sequence"]),
              eventSequence > 0,
              let phase = AOSDesktopWorldNativeEffectGestureEvent.Phase(
                rawValue: rawPhase
              ),
              let binding = bindings.first(where: {
                $0.interactionID == interactionID
                    && $0.lifecycle == .gesture
              }) else {
            return nil
        }
        let inputs: AOSDesktopWorldNativeEffectInputs
        if let coordinates = event["coordinates"] as? [String: Any],
           let parsed = effectInputs(coordinates) {
            inputs = parsed
        } else if phase == .cancel {
            inputs = .pointer(CGPoint(x: 0, y: 0))
        } else {
            return nil
        }
        return AOSDesktopWorldNativeEffectGestureEvent(
            phase: phase,
            request: AOSDesktopWorldNativeEffectRequest(
                binding: binding,
                canvasGeneration: identity.canvasGeneration,
                eventSequence: eventSequence,
                inputGeneration: inputGeneration,
                inputs: inputs,
                ownerID: ownerID,
                pointerSessionID: pointerSessionID,
                resourceID: resourceID,
                resourceRevision: resourceRevision,
                topologyGeneration: identity.topologyGeneration,
                triggeredAt: triggeredAt
            )
        )
    }

    static func pointerRequest(
        binding: AOSDesktopWorldNativeEffectBinding,
        authorization: (ownerID: String, resourceID: String, revision: Int),
        inputGeneration: String,
        identity: AOSDesktopWorldSceneStageIdentity,
        affordanceID: String,
        phase: String,
        button: String,
        point: CGPoint,
        pointerSessionID: String,
        triggeredAt: TimeInterval = ProcessInfo.processInfo.systemUptime
    ) -> AOSDesktopWorldNativeEffectRequest? {
        guard validInputGeneration(inputGeneration),
              case .pointerDown(let expectedButton) = binding.trigger,
              phase == "down",
              button == expectedButton,
              binding.affordanceID == affordanceID,
              canonicalPointerSessionID(pointerSessionID),
              point.x.isFinite,
              point.y.isFinite else {
            return nil
        }
        return AOSDesktopWorldNativeEffectRequest(
            binding: binding,
            canvasGeneration: identity.canvasGeneration,
            eventSequence: nil,
            inputGeneration: inputGeneration,
            inputs: .pointer(point),
            ownerID: authorization.ownerID,
            pointerSessionID: pointerSessionID,
            resourceID: authorization.resourceID,
            resourceRevision: authorization.revision,
            topologyGeneration: identity.topologyGeneration,
            triggeredAt: triggeredAt
        )
    }

    static func pointerRequest(
        bindings: [AOSDesktopWorldNativeEffectBinding],
        capabilities: Set<String>,
        ownerID: String,
        resourceID: String,
        resourceRevision: Int,
        inputGeneration: String,
        identity: AOSDesktopWorldSceneStageIdentity,
        affordanceID: String,
        phase: String,
        button: String,
        point: CGPoint,
        pointerSessionID: String,
        triggeredAt: TimeInterval = ProcessInfo.processInfo.systemUptime
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
                inputGeneration: inputGeneration,
                identity: identity,
                affordanceID: affordanceID,
                phase: phase,
                button: button,
                point: point,
                pointerSessionID: pointerSessionID,
                triggeredAt: triggeredAt
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
        inputGeneration: String
    ) -> Bool {
        authorized(capabilities)
            && ownerID == request.ownerID
            && resourceID == request.resourceID
            && inputGeneration == request.inputGeneration
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

    private static func validInputGeneration(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 128
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

    private static func nativeLifecycle(
        _ value: Any?,
        trigger: AOSDesktopWorldNativeEffectBinding.Trigger
    ) -> AOSDesktopWorldNativeEffectBinding.Lifecycle? {
        guard let value else { return .timed }
        guard let dictionary = value as? [String: Any],
              Set(dictionary.keys) == Set(["kind"]),
              let rawKind = dictionary["kind"] as? String,
              let lifecycle = AOSDesktopWorldNativeEffectBinding.Lifecycle(
                rawValue: rawKind
              ) else {
            return nil
        }
        if lifecycle == .gesture {
            guard case .gesture(.start) = trigger else { return nil }
        }
        return lifecycle
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

    private static func effectDefinition(
        implementation: String,
        dictionary: [String: Any],
        parameters: [String: Any],
        programs: [String: AOSDesktopWorldNativeEffectProgram]
    ) -> AOSDesktopWorldNativeEffectDefinition? {
        if implementation == AOSDesktopWorldNativeEffectBinding
            .desktopRippleImplementation {
            guard Set(dictionary.keys) == Set([
                "implementation", "parameters", "trigger",
            ]) || Set(dictionary.keys) == Set([
                "implementation", "lifecycle", "parameters", "trigger",
            ]),
                  let ripple = rippleParameters(parameters) else {
                return nil
            }
            return .ripple(ripple)
        }
        if implementation == AOSDesktopWorldNativeEffectProgram.implementation {
            guard Set(dictionary.keys) == Set([
                "implementation", "parameters", "programId", "trigger",
            ]) || Set(dictionary.keys) == Set([
                "implementation", "lifecycle", "parameters", "programId",
                "trigger",
            ]),
                  let programID = dictionary["programId"] as? String,
                  let program = programs[programID],
                  let instance = AOSDesktopWorldNativeEffectProgramContract.instantiate(
                    program: program,
                    parameters: parameters
                  ) else {
                return nil
            }
            return .program(instance)
        }
        return nil
    }

    private static func effectInputs(
        _ coordinates: [String: Any]
    ) -> AOSDesktopWorldNativeEffectInputs? {
        guard let current = point(coordinates["current"])
            ?? point(coordinates["desktopWorld"]) else {
            return nil
        }
        let origin = point(coordinates["origin"]) ?? current
        let delta = point(coordinates["delta"])
            ?? CGPoint(x: current.x - origin.x, y: current.y - origin.y)
        let totalDelta = point(coordinates["totalDelta"]) ?? delta
        return .init(
            current: current,
            delta: delta,
            origin: origin,
            totalDelta: totalDelta
        )
    }

    private static func point(_ value: Any?) -> CGPoint? {
        guard let dictionary = value as? [String: Any],
              Set(dictionary.keys) == Set(["x", "y"]),
              let x = finiteDouble(dictionary["x"]),
              let y = finiteDouble(dictionary["y"]) else {
            return nil
        }
        return CGPoint(x: x, y: y)
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

    private static func integer(_ value: Any?) -> Int? {
        guard let number = value as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        let result = number.doubleValue
        guard result.isFinite,
              result.rounded(.towardZero) == result,
              result >= Double(Int.min),
              result <= Double(Int.max) else {
            return nil
        }
        return Int(result)
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

    private static func canonicalPointerSessionID(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 256
    }
}
