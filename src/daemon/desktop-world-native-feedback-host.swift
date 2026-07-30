import Foundation
import Metal

private final class AOSDesktopWorldNativeFeedbackHostPreparation:
    AOSDesktopWorldNativeEffectPreparation,
    @unchecked Sendable
{
    let canvasGeneration: UInt64
    let context: AOSDesktopWorldNativeEffectGPUContext
    let topologyGeneration: UInt64

    init(
        canvasGeneration: UInt64,
        context: AOSDesktopWorldNativeEffectGPUContext,
        topologyGeneration: UInt64
    ) {
        self.canvasGeneration = canvasGeneration
        self.context = context
        self.topologyGeneration = topologyGeneration
    }
}

final class AOSDesktopWorldNativeFeedbackHost:
    AOSDesktopWorldNativeFeedbackHosting
{
    private let canvasID: String
    private let canvasManager: CanvasManager
    @MainActor private var context: AOSDesktopWorldNativeEffectGPUContext?
    private let preparationQueue = DispatchQueue(
        label: "io.agent-os.desktop-world.native-effect-preparation",
        qos: .userInitiated
    )

    init(
        canvasManager: CanvasManager,
        canvasID: String = AOSDesktopWorldSceneTransportController.stageCanvasID
    ) {
        self.canvasID = canvasID
        self.canvasManager = canvasManager
    }

    func captureContext() -> AOSDesktopWorldNativeFeedbackCaptureContext? {
        guard let context = canvasManager.desktopFrameCaptureContext(
            canvasID: canvasID
        ) else {
            return nil
        }
        return AOSDesktopWorldNativeFeedbackCaptureContext(
            canvasGeneration: context.canvasGeneration,
            displayIDs: context.displayIDs,
            excludingWindowIDs: context.excludingWindowIDs,
            topologyGeneration: context.topologyGeneration
        )
    }

    func prepare(
        programs: [AOSDesktopWorldNativeEffectProgram],
        completion: @escaping @Sendable (
            Result<AOSDesktopWorldNativeEffectPreparation, Error>
        ) -> Void
    ) {
        guard let captureContext = captureContext() else {
            completion(.failure(DesktopWorldNativeSheetFailure.rendererUnavailable))
            return
        }
        preparationQueue.async {
            do {
                guard let device = MTLCreateSystemDefaultDevice() else {
                    throw DesktopWorldNativeSheetFailure.rendererUnavailable
                }
                let prepared = try AOSDesktopWorldNativeEffectGPUContext(
                    device: device,
                    pixelFormat: .bgra8Unorm
                )
                try prepared.prepare(programs: programs)
                completion(.success(AOSDesktopWorldNativeFeedbackHostPreparation(
                    canvasGeneration: captureContext.canvasGeneration,
                    context: prepared,
                    topologyGeneration: captureContext.topologyGeneration
                )))
            } catch {
                completion(.failure(error))
            }
        }
    }

    @MainActor func activate(
        preparation: AOSDesktopWorldNativeEffectPreparation
    ) throws {
        guard let prepared = preparation as? AOSDesktopWorldNativeFeedbackHostPreparation,
              let device = prepared.context.commandQueue?.device else {
            throw DesktopWorldNativeSheetFailure.rendererUnavailable
        }
        try canvasManager.prepareDesktopWorldNativeProjectionHosts(
            canvasID: canvasID,
            canvasGeneration: prepared.canvasGeneration,
            topologyGeneration: prepared.topologyGeneration,
            device: device
        )
        context = prepared.context
    }

    @MainActor func install(
        request: AOSDesktopWorldNativeEffectRequest,
        frames: AOSDesktopPixelFrameSet
    ) throws -> AOSDesktopWorldNativeFeedbackInstallationOutcome {
        guard let context else {
            throw DesktopWorldNativeSheetFailure.rendererUnavailable
        }
        guard let device = context.commandQueue?.device else {
            throw DesktopWorldNativeSheetFailure.rendererUnavailable
        }
        let sheet = try canvasManager.installDesktopWorldNativeSheet(
            canvasID: canvasID,
            canvasGeneration: request.canvasGeneration,
            topologyGeneration: request.topologyGeneration,
            device: device
        )
        do {
            let runtime = try AOSDesktopWorldNativeEffectRuntime(
                sheet: sheet,
                context: context,
                frames: frames,
                inputs: request.inputs,
                definition: request.binding.definition,
                lifecycle: request.binding.lifecycle
            )
            return .installed(
                AOSDesktopWorldNativeFeedbackInstallation(
                    identity: sheet.identity,
                    runtime: runtime
                )
            )
        } catch {
            return .rollbackRequired(
                identity: sheet.identity,
                error: error
            )
        }
    }

    @MainActor func remove(
        canvasGeneration: UInt64,
        topologyGeneration: UInt64,
        identity: AOSDesktopWorldResourceIdentity
    ) -> Bool {
        canvasManager.removeDesktopWorldNativeSheet(
            canvasID: canvasID,
            canvasGeneration: canvasGeneration,
            topologyGeneration: topologyGeneration,
            identity: identity
        )
    }

    @MainActor func shutdown() {
        releasePreparedResources()
        canvasManager.finalizeDesktopWorldNativeProjectionHosts(canvasID: canvasID)
    }

    @MainActor func releasePreparedResources() {
        context?.dispose()
        context = nil
    }

}
