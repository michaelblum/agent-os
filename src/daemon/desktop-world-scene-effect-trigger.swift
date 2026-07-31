import CoreFoundation
import CoreGraphics
import Foundation

struct AOSDesktopWorldSceneEffectProgramIdentity: Equatable {
    let digest: String
    let id: String
    let revision: Int
}

enum AOSDesktopWorldSceneEffectTriggerPhase: String {
    case cancel
    case end
    case pointerDown = "pointer_down"
    case start
    case update
}

struct AOSDesktopWorldSceneEffectTriggerInput {
    let affordanceID: String
    let current: CGPoint
    let dryRun: Bool
    let expectedProgram: AOSDesktopWorldSceneEffectProgramIdentity
    let expectedRevision: Int
    let interactionID: String
    let origin: CGPoint
    let ownerID: String
    let phase: AOSDesktopWorldSceneEffectTriggerPhase
    let pointerSessionID: String
    let resourceID: String
    let sequence: Int
}

enum AOSDesktopWorldSceneEffectTriggerOperation {
    case gesture(
        AOSDesktopWorldNativeEffectGestureEvent,
        replacement: AOSDesktopWorldNativeEffectRequest?
    )
    case trigger(AOSDesktopWorldNativeEffectRequest)
}

struct AOSDesktopWorldSceneEffectTriggerPlan {
    let input: AOSDesktopWorldSceneEffectTriggerInput
    let operation: AOSDesktopWorldSceneEffectTriggerOperation
    let program: AOSDesktopWorldSceneEffectProgramIdentity
    let resourceRevision: Int

    var response: [String: Any] {
        [
            "status": "ok",
            "contract": "aos.scene.effect-trigger.v1",
            "owner": input.ownerID,
            "resource": input.resourceID,
            "affordance": input.affordanceID,
            "interaction": input.interactionID,
            "phase": input.phase.rawValue,
            "resource_revision": resourceRevision,
            "program": [
                "id": program.id,
                "revision": program.revision,
                "digest": program.digest,
            ],
            "dry_run": input.dryRun,
        ]
    }
}

enum AOSDesktopWorldSceneEffectTriggerPreparation {
    case failure(code: String, message: String)
    case success(AOSDesktopWorldSceneEffectTriggerPlan)
}

enum AOSDesktopWorldSceneEffectTriggerContract {
    private static let payloadKeys = Set([
        "affordance", "current", "dry_run", "expected_program",
        "expected_revision", "interaction", "origin", "owner", "phase",
        "pointer_session", "resource", "sequence",
    ])

    static func parse(_ payload: [String: Any])
        -> Result<AOSDesktopWorldSceneEffectTriggerInput, Error>
    {
        guard Set(payload.keys) == payloadKeys,
            let ownerID = AOSDesktopWorldResourceIdentity.canonicalIdentifier(
                payload["owner"],
                allowSlash: false
            ),
            let resourceID = AOSDesktopWorldResourceIdentity.canonicalIdentifier(
                payload["resource"],
                allowSlash: true
            ),
            let affordanceID = AOSDesktopWorldResourceIdentity.canonicalIdentifier(
                payload["affordance"],
                allowSlash: true
            ),
            let interactionID = AOSDesktopWorldResourceIdentity.canonicalIdentifier(
                payload["interaction"],
                allowSlash: true
            ),
            let phaseValue = payload["phase"] as? String,
            let phase = AOSDesktopWorldSceneEffectTriggerPhase(
                rawValue: phaseValue
            ),
            let expectedRevision = integer(payload["expected_revision"]),
            expectedRevision >= 0,
            expectedRevision <= Int32.max,
            let expectedProgramValue =
                payload["expected_program"] as? [String: Any],
            Set(expectedProgramValue.keys)
                == Set([
                    "digest", "id", "revision",
                ]),
            let expectedProgramID =
                AOSDesktopWorldResourceIdentity.canonicalIdentifier(
                    expectedProgramValue["id"],
                    allowSlash: true
                ),
            let expectedProgramRevision =
                integer(expectedProgramValue["revision"]),
            expectedProgramRevision >= 1,
            expectedProgramRevision <= Int32.max,
            let expectedProgramDigest =
                expectedProgramValue["digest"] as? String,
            expectedProgramDigest.range(
                of: #"^[a-f0-9]{64}$"#,
                options: .regularExpression
            ) != nil,
            let origin = point(payload["origin"]),
            let current = point(payload["current"]),
            let pointerSessionID = payload["pointer_session"] as? String,
            validPointerSessionID(pointerSessionID),
            let sequence = integer(payload["sequence"]),
            sequence >= 1,
            sequence <= Int32.max,
            let dryRun = payload["dry_run"] as? Bool
        else {
            return .failure(
                ContractError(
                    code: "SCENE_EFFECT_TRIGGER_INVALID",
                    message: "DesktopWorld scene effect trigger input is invalid"
                ))
        }
        return .success(
            AOSDesktopWorldSceneEffectTriggerInput(
                affordanceID: affordanceID,
                current: current,
                dryRun: dryRun,
                expectedProgram: AOSDesktopWorldSceneEffectProgramIdentity(
                    digest: expectedProgramDigest,
                    id: expectedProgramID,
                    revision: expectedProgramRevision
                ),
                expectedRevision: expectedRevision,
                interactionID: interactionID,
                origin: origin,
                ownerID: ownerID,
                phase: phase,
                pointerSessionID: pointerSessionID,
                resourceID: resourceID,
                sequence: sequence
            ))
    }

    static func failure(_ error: Error) -> [String: Any] {
        if let contract = error as? ContractError {
            return ["status": "error", "code": contract.code, "error": contract.message]
        }
        return [
            "status": "error",
            "code": "SCENE_EFFECT_TRIGGER_INVALID",
            "error": "DesktopWorld scene effect trigger input is invalid",
        ]
    }

    struct ContractError: Error {
        let code: String
        let message: String
    }

    private static func integer(_ value: Any?) -> Int? {
        guard let double = finiteDouble(value),
            double.rounded() == double,
            double >= Double(Int.min),
            double <= Double(Int.max)
        else { return nil }
        return Int(double)
    }

    private static func point(_ value: Any?) -> CGPoint? {
        guard let dictionary = value as? [String: Any],
            Set(dictionary.keys) == Set(["x", "y"]),
            let x = finiteDouble(dictionary["x"]),
            let y = finiteDouble(dictionary["y"])
        else { return nil }
        return CGPoint(x: x, y: y)
    }

    private static func finiteDouble(_ value: Any?) -> Double? {
        guard let number = value as? NSNumber,
            CFGetTypeID(number) != CFBooleanGetTypeID()
        else { return nil }
        let result = number.doubleValue
        return result.isFinite ? result : nil
    }

    private static func validPointerSessionID(_ value: String) -> Bool {
        guard !value.isEmpty, value.utf8.count <= 128 else { return false }
        return value.unicodeScalars.allSatisfy { scalar in
            scalar.properties.generalCategory != .control
                && scalar.properties.generalCategory != .format
        }
    }
}

extension AOSDesktopWorldSceneController {
    func prepareNativeEffectTrigger(
        _ input: AOSDesktopWorldSceneEffectTriggerInput,
        triggeredAt: TimeInterval = ProcessInfo.processInfo.systemUptime
    ) -> AOSDesktopWorldSceneEffectTriggerPreparation {
        withLock { prepareNativeEffectTriggerLocked(input, triggeredAt: triggeredAt) }
    }

    func executeNativeEffectTrigger<PreparedAdmission>(
        _ input: AOSDesktopWorldSceneEffectTriggerInput,
        triggeredAt: TimeInterval = ProcessInfo.processInfo.systemUptime,
        prepare: (AOSDesktopWorldSceneEffectTriggerOperation) -> PreparedAdmission?,
        admit: (PreparedAdmission) -> Bool
    ) -> AOSDesktopWorldSceneEffectTriggerPreparation {
        let reserved = withLock {
            let preparation = prepareNativeEffectTriggerLocked(
                input,
                triggeredAt: triggeredAt
            )
            guard case .success(let plan) = preparation,
                !input.dryRun
            else {
                return (
                    preparation: preparation,
                    plan: Optional<AOSDesktopWorldSceneEffectTriggerPlan>.none,
                    reservation:
                        Optional<AOSDesktopWorldSceneEffectTriggerReservation>.none
                )
            }
            let resourceKey = key(
                owner: input.ownerID,
                resource: input.resourceID
            )
            guard let reservation = beginEffectTriggerReservationLocked(
                key: resourceKey
            ) else {
                return (
                    preparation: .failure(
                        code: "SCENE_EFFECT_TRIGGER_OPERATION_PENDING",
                        message:
                            "DesktopWorld scene effect trigger conflicts with an active operation"
                    ),
                    plan: Optional<AOSDesktopWorldSceneEffectTriggerPlan>.none,
                    reservation:
                        Optional<AOSDesktopWorldSceneEffectTriggerReservation>.none
                )
            }
            return (
                preparation: preparation,
                plan: Optional(plan),
                reservation: Optional(reservation)
            )
        }
        guard let plan = reserved.plan,
              let reservation = reserved.reservation else {
            return reserved.preparation
        }
        guard let preparedAdmission = prepare(plan.operation) else {
            releaseEffectTriggerReservation(reservation)
            return .failure(
                code: "SCENE_EFFECT_TRIGGER_REJECTED",
                message: "DesktopWorld scene effect trigger was rejected"
            )
        }
        let accepted = reservation.performIfActive {
            admit(preparedAdmission)
        }
        releaseEffectTriggerReservation(reservation)
        guard accepted else {
            return .failure(
                code: "SCENE_EFFECT_TRIGGER_REJECTED",
                message: "DesktopWorld scene effect trigger was rejected"
            )
        }
        return .success(plan)
    }

    private func prepareNativeEffectTriggerLocked(
        _ input: AOSDesktopWorldSceneEffectTriggerInput,
        triggeredAt: TimeInterval
    ) -> AOSDesktopWorldSceneEffectTriggerPreparation {
        guard retirement == nil,
            let identity = readiness.currentIdentity(),
            readiness.isReady(for: identity)
        else {
            return .failure(
                code: "SCENE_EFFECT_TRIGGER_STAGE_UNAVAILABLE",
                message: "DesktopWorld scene stage is unavailable"
            )
        }
        let resourceKey = key(
            owner: input.ownerID,
            resource: input.resourceID
        )
        guard let projection = resourceProjectionAuthorities[resourceKey],
            let authorization = projection.authorization,
            authorization.ownerID == input.ownerID,
            let inputGeneration = projection.inputGeneration
        else {
            return .failure(
                code: "SCENE_EFFECT_TRIGGER_TARGET_UNAVAILABLE",
                message: "DesktopWorld scene effect target is unavailable"
            )
        }
        guard authorization.resourceRevision == input.expectedRevision else {
            return .failure(
                code: "SCENE_EFFECT_TRIGGER_REVISION_CONFLICT",
                message: "DesktopWorld scene resource revision changed"
            )
        }

        let operation: AOSDesktopWorldSceneEffectTriggerOperation?
        switch input.phase {
        case .pointerDown:
            operation = AOSDesktopWorldNativeEffectContract.pointerRequest(
                bindings: authorization.nativeEffects,
                capabilities: authorization.capabilities,
                ownerID: input.ownerID,
                resourceID: input.resourceID,
                resourceRevision: authorization.resourceRevision,
                inputGeneration: inputGeneration,
                identity: identity,
                affordanceID: input.affordanceID,
                phase: "down",
                button: "left",
                point: input.current,
                pointerSessionID: input.pointerSessionID,
                triggeredAt: triggeredAt
            ).map(AOSDesktopWorldSceneEffectTriggerOperation.trigger)
        case .start, .update, .end, .cancel:
            let phase = input.phase.rawValue
            let event: [String: Any] = [
                "interactionId": input.interactionID,
                "sequence": input.sequence,
                "gesture": [
                    "phase": phase,
                    "pointerSessionId": input.pointerSessionID,
                ],
                "coordinates": [
                    "origin": pointDictionary(input.origin),
                    "current": pointDictionary(input.current),
                    "delta": pointDictionary(
                        CGPoint(
                            x: input.current.x - input.origin.x,
                            y: input.current.y - input.origin.y
                        )),
                    "totalDelta": pointDictionary(
                        CGPoint(
                            x: input.current.x - input.origin.x,
                            y: input.current.y - input.origin.y
                        )),
                ],
            ]
            let request = nativeEffectRequestLocked(
                identity: identity,
                authorization: authorization,
                inputGeneration: inputGeneration,
                resourceID: input.resourceID,
                event: event,
                triggeredAt: triggeredAt
            )
            let lifecycle = nativeEffectGestureEventLocked(
                identity: identity,
                authorization: authorization,
                inputGeneration: inputGeneration,
                resourceID: input.resourceID,
                event: event,
                triggeredAt: triggeredAt
            )
            if let lifecycle {
                operation = .gesture(lifecycle, replacement: request)
            } else {
                operation = request.map(
                    AOSDesktopWorldSceneEffectTriggerOperation.trigger
                )
            }
        }

        guard let operation,
            let selected = selectedRequest(operation),
            selected.binding.affordanceID == input.affordanceID,
            selected.binding.interactionID == input.interactionID,
            let program = programIdentity(selected.binding),
            program == input.expectedProgram
        else {
            return .failure(
                code: "SCENE_EFFECT_TRIGGER_BINDING_MISMATCH",
                message: "DesktopWorld scene effect binding does not match"
            )
        }
        return .success(
            AOSDesktopWorldSceneEffectTriggerPlan(
                input: input,
                operation: operation,
                program: program,
                resourceRevision: authorization.resourceRevision
            ))
    }

    private func nativeEffectRequestLocked(
        identity: AOSDesktopWorldSceneStageIdentity,
        authorization: AOSDesktopWorldSceneCapabilityAuthorization,
        inputGeneration: String,
        resourceID: String,
        event: [String: Any],
        triggeredAt: TimeInterval
    ) -> AOSDesktopWorldNativeEffectRequest? {
        AOSDesktopWorldNativeEffectContract.gestureRequest(
            bindings: authorization.nativeEffects,
            capabilities: authorization.capabilities,
            ownerID: authorization.ownerID,
            resourceID: resourceID,
            resourceRevision: authorization.resourceRevision,
            inputGeneration: inputGeneration,
            identity: identity,
            event: event,
            triggeredAt: triggeredAt
        )
    }

    private func nativeEffectGestureEventLocked(
        identity: AOSDesktopWorldSceneStageIdentity,
        authorization: AOSDesktopWorldSceneCapabilityAuthorization,
        inputGeneration: String,
        resourceID: String,
        event: [String: Any],
        triggeredAt: TimeInterval
    ) -> AOSDesktopWorldNativeEffectGestureEvent? {
        AOSDesktopWorldNativeEffectContract.gestureLifecycleEvent(
            bindings: authorization.nativeEffects,
            capabilities: authorization.capabilities,
            ownerID: authorization.ownerID,
            resourceID: resourceID,
            resourceRevision: authorization.resourceRevision,
            inputGeneration: inputGeneration,
            identity: identity,
            event: event,
            triggeredAt: triggeredAt
        )
    }

    private func selectedRequest(
        _ operation: AOSDesktopWorldSceneEffectTriggerOperation
    ) -> AOSDesktopWorldNativeEffectRequest? {
        switch operation {
        case .trigger(let request):
            return request
        case .gesture(let event, let replacement):
            return replacement ?? event.request
        }
    }

    private func programIdentity(
        _ binding: AOSDesktopWorldNativeEffectBinding
    ) -> AOSDesktopWorldSceneEffectProgramIdentity? {
        guard case .program(let instance) = binding.definition else { return nil }
        return AOSDesktopWorldSceneEffectProgramIdentity(
            digest: instance.program.digest,
            id: instance.program.id,
            revision: instance.program.revision
        )
    }

    private func pointDictionary(_ point: CGPoint) -> [String: Double] {
        ["x": Double(point.x), "y": Double(point.y)]
    }
}
