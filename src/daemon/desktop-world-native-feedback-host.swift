import Foundation
import Metal

final class AOSDesktopWorldNativeFeedbackHost:
    AOSDesktopWorldNativeFeedbackHosting
{
    private let canvasID: String
    private let canvasManager: CanvasManager
    @MainActor private var context: AOSDesktopWorldNativeEffectGPUContext?

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

    @MainActor func prepare() throws {
        _ = try preparedContext()
    }

    @MainActor func install(
        request: AOSDesktopWorldNativeEffectRequest,
        frames: AOSDesktopPixelFrameSet
    ) throws -> AOSDesktopWorldNativeFeedbackInstallation {
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
            let runtime = try AOSDesktopWorldNativeRippleRuntime(
                sheet: sheet,
                context: context,
                frames: frames,
                origin: request.desktopWorldOrigin,
                parameters: request.binding.ripple
            )
            return AOSDesktopWorldNativeFeedbackInstallation(
                identity: sheet.identity,
                runtime: runtime
            )
        } catch {
            _ = canvasManager.removeDesktopWorldNativeSheet(
                canvasID: canvasID,
                canvasGeneration: request.canvasGeneration,
                topologyGeneration: request.topologyGeneration,
                identity: sheet.identity
            )
            throw error
        }
    }

    @MainActor func remove(
        canvasGeneration: UInt64,
        topologyGeneration: UInt64,
        identity: AOSDesktopWorldResourceIdentity
    ) {
        _ = canvasManager.removeDesktopWorldNativeSheet(
            canvasID: canvasID,
            canvasGeneration: canvasGeneration,
            topologyGeneration: topologyGeneration,
            identity: identity
        )
    }

    @MainActor func shutdown() {
        releasePreparedResources()
    }

    @MainActor func releasePreparedResources() {
        context?.dispose()
        context = nil
    }

    @MainActor private func preparedContext()
        throws -> AOSDesktopWorldNativeEffectGPUContext {
        if let context { return context }
        guard let device = MTLCreateSystemDefaultDevice() else {
            throw DesktopWorldNativeSheetFailure.rendererUnavailable
        }
        let prepared = try AOSDesktopWorldNativeEffectGPUContext(
            device: device,
            pixelFormat: .bgra8Unorm
        )
        context = prepared
        return prepared
    }
}
