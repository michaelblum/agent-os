import Foundation

extension AOSDesktopWorldSceneController {
    func nativeEffectRequest(
        identity: AOSDesktopWorldSceneStageIdentity,
        key: String,
        event: [String: Any],
        triggeredAt: TimeInterval = ProcessInfo.processInfo.systemUptime
    ) -> AOSDesktopWorldNativeEffectRequest? {
        withLock {
            guard retirement == nil,
                  readiness.isReady(for: identity),
                  let authorization = resourceAuthorizations[key],
                  let resourceIdentity = leaseIdentity(from: key) else {
                return nil
            }
            return AOSDesktopWorldNativeEffectContract.gestureRequest(
                bindings: authorization.nativeEffects,
                capabilities: authorization.capabilities,
                ownerID: resourceIdentity.owner,
                resourceID: resourceIdentity.resource,
                resourceRevision: authorization.resourceRevision,
                identity: identity,
                event: event,
                triggeredAt: triggeredAt
            )
        }
    }

    func nativeEffectGestureEvent(
        identity: AOSDesktopWorldSceneStageIdentity,
        key: String,
        event: [String: Any],
        triggeredAt: TimeInterval = ProcessInfo.processInfo.systemUptime
    ) -> AOSDesktopWorldNativeEffectGestureEvent? {
        withLock {
            guard retirement == nil,
                  readiness.isReady(for: identity),
                  let authorization = resourceAuthorizations[key],
                  let resourceIdentity = leaseIdentity(from: key) else {
                return nil
            }
            return AOSDesktopWorldNativeEffectContract.gestureLifecycleEvent(
                bindings: authorization.nativeEffects,
                capabilities: authorization.capabilities,
                ownerID: resourceIdentity.owner,
                resourceID: resourceIdentity.resource,
                resourceRevision: authorization.resourceRevision,
                identity: identity,
                event: event,
                triggeredAt: triggeredAt
            )
        }
    }

    func nativePointerEffectRequest(
        ownerID: String,
        resourceID: String,
        resourceRevision: Int,
        affordanceID: String,
        canvasGeneration: UInt64,
        phase: String,
        button: String,
        point: CGPoint,
        pointerSessionID: String,
        triggeredAt: TimeInterval = ProcessInfo.processInfo.systemUptime
    ) -> AOSDesktopWorldNativeEffectRequest? {
        withLock {
            guard retirement == nil,
                  let identity = readiness.currentIdentity(),
                  identity.canvasGeneration == canvasGeneration,
                  readiness.isReady(for: identity),
                  let authorization = resourceAuthorizations[key(
                    owner: ownerID,
                    resource: resourceID
                  )],
                  authorization.ownerID == ownerID,
                  authorization.resourceRevision == resourceRevision else {
                return nil
            }
            return AOSDesktopWorldNativeEffectContract.pointerRequest(
                bindings: authorization.nativeEffects,
                capabilities: authorization.capabilities,
                ownerID: ownerID,
                resourceID: resourceID,
                resourceRevision: resourceRevision,
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
        return withLock {
            guard retirement == nil,
                  readiness.isReady(for: identity),
                  let authorization = resourceAuthorizations[key(
                    owner: request.ownerID,
                    resource: request.resourceID
                  )],
                  authorization.resourceRevision == request.resourceRevision else {
                return false
            }
            return AOSDesktopWorldNativeEffectContract.authorizes(
                request,
                bindings: authorization.nativeEffects,
                capabilities: authorization.capabilities,
                ownerID: authorization.ownerID,
                resourceID: request.resourceID,
                resourceRevision: authorization.resourceRevision
            )
        }
    }

    func hasNativeEffectAuthorization() -> Bool {
        withLock {
            retirement == nil && resourceAuthorizations.values.contains {
                AOSDesktopWorldNativeEffectContract.available(
                    bindings: $0.nativeEffects,
                    capabilities: $0.capabilities
                )
            }
        }
    }

    func nativeEffectPrograms() -> [AOSDesktopWorldNativeEffectProgram] {
        withLock {
            nativeEffectProgramsLocked(in: resourceAuthorizations)
        }
    }
}
