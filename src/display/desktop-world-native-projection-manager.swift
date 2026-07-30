import Foundation
import Metal

extension CanvasManager {
    func prepareDesktopWorldNativeProjectionHosts(
        canvasID: String,
        canvasGeneration: UInt64,
        topologyGeneration: UInt64,
        device: MTLDevice
    ) throws {
        let prepare = { [weak self] () throws in
            guard let surface = self?.canvas(forID: canvasID) as? DesktopWorldSurfaceCanvas,
                  surface.lifecycleGeneration == canvasGeneration,
                  surface.topologyGeneration == topologyGeneration else {
                throw DesktopWorldNativeSheetFailure.invalidGeometry
            }
            try surface.prepareNativeProjectionHosts(device: device)
        }
        if Thread.isMainThread {
            try prepare()
        } else {
            try DispatchQueue.main.sync(execute: prepare)
        }
    }

    func finalizeDesktopWorldNativeProjectionHosts(canvasID: String) {
        let finalize = { [weak self] in
            (self?.canvas(forID: canvasID) as? DesktopWorldSurfaceCanvas)?
                .finalizeNativeProjectionHosts()
        }
        if Thread.isMainThread {
            finalize()
        } else {
            DispatchQueue.main.sync(execute: finalize)
        }
    }
}
