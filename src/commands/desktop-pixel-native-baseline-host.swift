import AppKit
import Foundation
import Metal

enum AOSDesktopPixelNativeBaselineHostKind: String, Encodable {
    case standalone
    case desktopWorld = "desktop-world"
}

struct AOSDesktopPixelNativeBaselineHostCleanup {
    let pendingRetirements: Int
    let retainedTextures: Int
    let retainedViews: Int
    let retainedWindows: Int
}

@MainActor
protocol AOSDesktopPixelNativeBaselineEndpoint: AnyObject {
    var displayID: CGDirectDisplayID { get }
    var renderer: AOSDesktopPixelNativeBaselineRenderer { get }
    func present()
    func disposeRenderer()
    func retainedTextureCount() -> Int
    func retainedViewCount() -> Int
    func retainedWindowCount() -> Int
}

@MainActor
protocol AOSDesktopPixelNativeBaselineHost: AnyObject {
    var kind: AOSDesktopPixelNativeBaselineHostKind { get }
    var endpoints: [any AOSDesktopPixelNativeBaselineEndpoint] { get }
    var canvasGeneration: UInt64? { get }
    var topologyGeneration: UInt64? { get }
    func present()
    func dispose() async -> AOSDesktopPixelNativeBaselineHostCleanup
}

@MainActor
final class AOSDesktopPixelNativeBaselineStandaloneHost: AOSDesktopPixelNativeBaselineHost {
    let kind = AOSDesktopPixelNativeBaselineHostKind.standalone
    private(set) var endpoints: [any AOSDesktopPixelNativeBaselineEndpoint]
    let canvasGeneration: UInt64? = nil
    let topologyGeneration: UInt64? = nil

    init(device: MTLDevice) throws {
        let screens = NSScreen.screens
        guard !screens.isEmpty,
              screens.count <= AOSDesktopPixelNativeBaselineCapture.maximumDisplays else {
            throw AOSDesktopPixelNativeBaselineFailure(code: "DESKTOP_PIXEL_BASELINE_DISPLAY_LIMIT")
        }
        var created: [AOSDesktopPixelNativeBaselineSurface] = []
        do {
            for screen in screens {
                guard let displayID = aosDesktopPixelNativeBaselineDisplayID(screen) else {
                    throw AOSDesktopPixelNativeBaselineFailure(
                        code: "DESKTOP_PIXEL_BASELINE_DISPLAY_ID_UNAVAILABLE"
                    )
                }
                created.append(try AOSDesktopPixelNativeBaselineSurface(
                    screen: screen,
                    displayID: displayID,
                    device: device
                ))
            }
        } catch {
            created.forEach { $0.dispose() }
            throw error
        }
        endpoints = created
    }

    func present() {
        endpoints.forEach { $0.present() }
    }

    func dispose() async -> AOSDesktopPixelNativeBaselineHostCleanup {
        endpoints.forEach { $0.disposeRenderer() }
        let result = AOSDesktopPixelNativeBaselineHostCleanup(
            pendingRetirements: 0,
            retainedTextures: endpoints.reduce(0) { $0 + $1.retainedTextureCount() },
            retainedViews: endpoints.reduce(0) { $0 + $1.retainedViewCount() },
            retainedWindows: endpoints.reduce(0) { $0 + $1.retainedWindowCount() }
        )
        endpoints = []
        return result
    }
}

@MainActor
private final class AOSDesktopPixelNativeBaselineDesktopWorldEndpoint:
    AOSDesktopPixelNativeBaselineEndpoint
{
    let displayID: CGDirectDisplayID
    let renderer: AOSDesktopPixelNativeBaselineRenderer
    private let host: DesktopWorldNativeProjectionHost
    private let segment: DesktopWorldSurfaceCanvas.Segment

    init(segment: DesktopWorldSurfaceCanvas.Segment, device: MTLDevice) throws {
        let width = Int(CGDisplayPixelsWide(segment.displayID))
        let height = Int(CGDisplayPixelsHigh(segment.displayID))
        let backingPixels = width <= Int.max / max(1, height) ? width * height : Int.max
        guard backingPixels > 0,
              backingPixels <= AOSDesktopPixelNativeBaselineCapture.maximumPixelsPerDisplay else {
            throw AOSDesktopPixelNativeBaselineFailure(
                code: "DESKTOP_PIXEL_BASELINE_BACKING_PIXEL_BUDGET_EXCEEDED"
            )
        }
        displayID = segment.displayID
        self.segment = segment
        do {
            host = try segment.ensureNativeProjectionHost(device: device)
        } catch {
            throw AOSDesktopPixelNativeBaselineFailure(
                code: "DESKTOP_PIXEL_BASELINE_DESKTOP_WORLD_HOST_FAILED",
                nativeCode: (error as NSError).code
            )
        }
        renderer = try AOSDesktopPixelNativeBaselineRenderer(view: host.view)
    }

    func present() {
        host.present()
    }

    func disposeRenderer() {
        renderer.clear()
        host.detachRenderer()
    }

    func retainedTextureCount() -> Int {
        renderer.retainedTextureCount()
    }

    func retainedViewCount() -> Int {
        host.retainedViewCount
    }

    func retainedWindowCount() -> Int {
        segment.window.isVisible || segment.window.contentView != nil ? 1 : 0
    }
}

@MainActor
final class AOSDesktopPixelNativeBaselineDesktopWorldHost: AOSDesktopPixelNativeBaselineHost {
    let kind = AOSDesktopPixelNativeBaselineHostKind.desktopWorld
    private(set) var endpoints: [any AOSDesktopPixelNativeBaselineEndpoint] = []
    let canvasGeneration: UInt64?
    let topologyGeneration: UInt64?
    private let canvas: DesktopWorldSurfaceCanvas
    private let coordinator: CanvasLifecycleCoordinator
    private let generation: CanvasLifecycleGeneration
    private var disposed = false

    init(device: MTLDevice) throws {
        let coordinator = CanvasLifecycleCoordinator()
        let canvas = DesktopWorldSurfaceCanvas(
            id: "aos-desktop-pixel-native-baseline",
            interactive: false,
            windowLevel: "screen_saver",
            lifecycleCoordinator: coordinator
        )
        let generation = coordinator.issueGeneration(for: canvas)
        canvas.setInputPassthrough(true)
        guard !canvas.segments.isEmpty,
              canvas.segments.count <= AOSDesktopPixelNativeBaselineCapture.maximumDisplays else {
            canvas.finalizeRetirement()
            throw AOSDesktopPixelNativeBaselineFailure(code: "DESKTOP_PIXEL_BASELINE_DISPLAY_LIMIT")
        }
        let createdEndpoints: [any AOSDesktopPixelNativeBaselineEndpoint]
        do {
            createdEndpoints = try canvas.segments.map {
                try AOSDesktopPixelNativeBaselineDesktopWorldEndpoint(
                    segment: $0,
                    device: device
                )
            }
        } catch {
            canvas.finalizeRetirement()
            throw error
        }
        self.canvas = canvas
        self.coordinator = coordinator
        self.generation = generation
        endpoints = createdEndpoints
        canvasGeneration = generation.value
        topologyGeneration = canvas.topologyGeneration
    }

    func present() {
        canvas.show()
        endpoints.forEach { $0.present() }
    }

    func dispose() async -> AOSDesktopPixelNativeBaselineHostCleanup {
        guard !disposed else {
            return AOSDesktopPixelNativeBaselineHostCleanup(
                pendingRetirements: 0,
                retainedTextures: 0,
                retainedViews: 0,
                retainedWindows: 0
            )
        }
        disposed = true
        endpoints.forEach { $0.disposeRenderer() }
        coordinator.retainUntilNextRunLoop(canvas, generation: generation)
        let deadline = DispatchTime.now().uptimeNanoseconds + 2_000_000_000
        while coordinator.pendingFinalizationCount > 0,
              DispatchTime.now().uptimeNanoseconds < deadline {
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        let result = AOSDesktopPixelNativeBaselineHostCleanup(
            pendingRetirements: coordinator.pendingFinalizationCount,
            retainedTextures: endpoints.reduce(0) { $0 + $1.retainedTextureCount() },
            retainedViews: endpoints.reduce(0) { $0 + $1.retainedViewCount() },
            retainedWindows: endpoints.reduce(0) { $0 + $1.retainedWindowCount() }
        )
        endpoints = []
        return result
    }
}

@MainActor
func makeAOSDesktopPixelNativeBaselineHost(
    kind: AOSDesktopPixelNativeBaselineHostKind,
    device: MTLDevice
) throws -> any AOSDesktopPixelNativeBaselineHost {
    switch kind {
    case .standalone:
        return try AOSDesktopPixelNativeBaselineStandaloneHost(device: device)
    case .desktopWorld:
        return try AOSDesktopPixelNativeBaselineDesktopWorldHost(device: device)
    }
}
