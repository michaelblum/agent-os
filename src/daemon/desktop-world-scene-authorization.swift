import Foundation

struct AOSDesktopWorldSceneCapabilityAuthorization: Equatable {
    let capabilities: Set<String>
    let digest: String
    let extensionID: String
    let framebufferProofIDs: Set<String>
    let ownerID: String
    let nativeEffects: [AOSDesktopWorldNativeEffectBinding]
    let resourceRevision: Int
    let sceneABI: String
    let threeRevision: String

    func advancingResourceRevision(
        to revision: Int,
        nativeEffects replacementEffects: [AOSDesktopWorldNativeEffectBinding]? = nil
    ) -> Self {
        Self(
            capabilities: capabilities,
            digest: digest,
            extensionID: extensionID,
            framebufferProofIDs: framebufferProofIDs,
            ownerID: ownerID,
            nativeEffects: replacementEffects ?? nativeEffects,
            resourceRevision: revision,
            sceneABI: sceneABI,
            threeRevision: threeRevision
        )
    }

    func replacingNativeEffects(
        _ nativeEffects: [AOSDesktopWorldNativeEffectBinding]
    ) -> Self {
        advancingResourceRevision(
            to: resourceRevision,
            nativeEffects: nativeEffects
        )
    }
}

struct AOSDesktopWorldSceneCommittedProjectionAuthority {
    var authorization: AOSDesktopWorldSceneCapabilityAuthorization?
    var inputGeneration: String?
}
