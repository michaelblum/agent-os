import Foundation

extension AOSDesktopWorldSceneController {
    func nativeEffectRequest(
        identity: AOSDesktopWorldSceneStageIdentity,
        key: String,
        inputGeneration: String,
        event: [String: Any],
        triggeredAt: TimeInterval = ProcessInfo.processInfo.systemUptime
    ) -> AOSDesktopWorldNativeEffectRequest? {
        withLock {
            guard retirement == nil,
                  readiness.isReady(for: identity),
                  let projection = resourceProjectionAuthorities[key],
                  let authorization = projection.authorization,
                  projection.inputGeneration == inputGeneration,
                  let resourceIdentity = leaseIdentity(from: key) else {
                return nil
            }
            return AOSDesktopWorldNativeEffectContract.gestureRequest(
                bindings: authorization.nativeEffects,
                capabilities: authorization.capabilities,
                ownerID: resourceIdentity.owner,
                resourceID: resourceIdentity.resource,
                resourceRevision: authorization.resourceRevision,
                inputGeneration: inputGeneration,
                identity: identity,
                event: event,
                triggeredAt: triggeredAt
            )
        }
    }

    func nativeEffectGestureEvent(
        identity: AOSDesktopWorldSceneStageIdentity,
        key: String,
        inputGeneration: String,
        event: [String: Any],
        triggeredAt: TimeInterval = ProcessInfo.processInfo.systemUptime
    ) -> AOSDesktopWorldNativeEffectGestureEvent? {
        withLock {
            guard retirement == nil,
                  readiness.isReady(for: identity),
                  let projection = resourceProjectionAuthorities[key],
                  let authorization = projection.authorization,
                  projection.inputGeneration == inputGeneration,
                  let resourceIdentity = leaseIdentity(from: key) else {
                return nil
            }
            return AOSDesktopWorldNativeEffectContract.gestureLifecycleEvent(
                bindings: authorization.nativeEffects,
                capabilities: authorization.capabilities,
                ownerID: resourceIdentity.owner,
                resourceID: resourceIdentity.resource,
                resourceRevision: authorization.resourceRevision,
                inputGeneration: inputGeneration,
                identity: identity,
                event: event,
                triggeredAt: triggeredAt
            )
        }
    }

    func nativePointerEffectRequest(
        ownerID: String,
        resourceID: String,
        regionGeneration: String,
        affordanceID: String,
        canvasGeneration: UInt64,
        phase: String,
        button: String,
        point: CGPoint,
        pointerSessionID: String,
        triggeredAt: TimeInterval = ProcessInfo.processInfo.systemUptime
    ) -> AOSDesktopWorldNativeEffectRequest? {
        let resourceKey = key(owner: ownerID, resource: resourceID)
        return withLock {
            guard retirement == nil,
                  let identity = readiness.currentIdentity(),
                  identity.canvasGeneration == canvasGeneration,
                  readiness.isReady(for: identity),
                  let projection = resourceProjectionAuthorities[resourceKey],
                  let authorization = projection.authorization,
                  authorization.ownerID == ownerID,
                  projection.inputGeneration == regionGeneration else {
                return nil
            }
            return AOSDesktopWorldNativeEffectContract.pointerRequest(
                bindings: authorization.nativeEffects,
                capabilities: authorization.capabilities,
                ownerID: ownerID,
                resourceID: resourceID,
                resourceRevision: authorization.resourceRevision,
                inputGeneration: regionGeneration,
                identity: identity,
                affordanceID: affordanceID,
                phase: phase,
                button: button,
                point: point,
                pointerSessionID: pointerSessionID,
                triggeredAt: triggeredAt
            )
        }
    }

    func authorizesNativeEffect(
        _ request: AOSDesktopWorldNativeEffectRequest
    ) -> Bool {
        let identity = AOSDesktopWorldSceneStageIdentity(
            canvasGeneration: request.canvasGeneration,
            topologyGeneration: request.topologyGeneration
        )
        let resourceKey = key(
            owner: request.ownerID,
            resource: request.resourceID
        )
        return withLock {
            guard retirement == nil,
                  readiness.isReady(for: identity),
                  let projection = resourceProjectionAuthorities[resourceKey],
                  let authorization = projection.authorization,
                  let inputGeneration = projection.inputGeneration else {
                return false
            }
            return AOSDesktopWorldNativeEffectContract.authorizes(
                request,
                bindings: authorization.nativeEffects,
                capabilities: authorization.capabilities,
                ownerID: authorization.ownerID,
                resourceID: request.resourceID,
                inputGeneration: inputGeneration
            )
        }
    }

    func hasNativeEffectAuthorization() -> Bool {
        withLock {
            retirement == nil && resourceProjectionAuthorities.values.contains {
                guard let authorization = $0.authorization else { return false }
                return AOSDesktopWorldNativeEffectContract.available(
                    bindings: authorization.nativeEffects,
                    capabilities: authorization.capabilities
                )
            }
        }
    }

    func nativeEffectPrograms() -> [AOSDesktopWorldNativeEffectProgram] {
        withLock {
            nativeEffectProgramsLocked(in: Dictionary(uniqueKeysWithValues:
                resourceProjectionAuthorities.compactMap { key, value in
                    value.authorization.map { (key, $0) }
                }
            ))
        }
    }
}
