import AppKit
import Foundation
import Metal

enum AOSDesktopPixelNativeBaselineHostKind: String, Encodable {
    case standalone
    case desktopWorld = "desktop-world"
}

struct AOSDesktopPixelNativeBaselineHostCleanup {
    let pendingRetirements: Int
    let retainedGeometryBuffers: Int
    let retainedGPUResources: Int
    let retainedSheets: Int
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
    func retainedGeometryBufferCount() -> Int
    func retainedTextureCount() -> Int
    func retainedViewCount() -> Int
    func retainedWindowCount() -> Int
}

@MainActor
protocol AOSDesktopPixelNativeBaselineHost: AnyObject {
    var kind: AOSDesktopPixelNativeBaselineHostKind { get }
    var endpoints: [any AOSDesktopPixelNativeBaselineEndpoint] { get }
    var canvasGeneration: UInt64? { get }
    var geometryMetrics: DesktopWorldNativeSheetGeometryMetrics { get }
    var topologyGeneration: UInt64? { get }
    var sheetIdentity: AOSDesktopWorldResourceIdentity? { get }
    func present() throws
    func dispose() async -> AOSDesktopPixelNativeBaselineHostCleanup
}

@MainActor
final class AOSDesktopPixelNativeBaselineStandaloneHost: AOSDesktopPixelNativeBaselineHost {
    let kind = AOSDesktopPixelNativeBaselineHostKind.standalone
    private(set) var endpoints: [any AOSDesktopPixelNativeBaselineEndpoint]
    let canvasGeneration: UInt64? = nil
    let geometryMetrics: DesktopWorldNativeSheetGeometryMetrics
    let topologyGeneration: UInt64? = nil
    let sheetIdentity: AOSDesktopWorldResourceIdentity? = nil
    private let context: AOSDesktopPixelNativeBaselineGPUContext

    init(device: MTLDevice) throws {
        let screens = NSScreen.screens
        guard !screens.isEmpty,
              screens.count <= AOSDesktopPixelNativeBaselineCapture.maximumDisplays else {
            throw AOSDesktopPixelNativeBaselineFailure(code: "DESKTOP_PIXEL_BASELINE_DISPLAY_LIMIT")
        }
        let geometryDescriptor = DesktopWorldNativeSheetGeometryDescriptor.standard
        geometryMetrics = try geometryDescriptor.metrics(segmentCount: screens.count)
        let context = try AOSDesktopPixelNativeBaselineGPUContext(
            device: device,
            pixelFormat: .bgra8Unorm
        )
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
                    device: device,
                    context: context,
                    geometryDescriptor: geometryDescriptor
                ))
            }
        } catch {
            created.forEach { $0.dispose() }
            context.dispose()
            throw error
        }
        self.context = context
        endpoints = created
    }

    func present() throws {
        endpoints.forEach { $0.present() }
    }

    func dispose() async -> AOSDesktopPixelNativeBaselineHostCleanup {
        endpoints.forEach { $0.disposeRenderer() }
        context.dispose()
        let result = AOSDesktopPixelNativeBaselineHostCleanup(
            pendingRetirements: 0,
            retainedGeometryBuffers: endpoints.reduce(0) {
                $0 + $1.retainedGeometryBufferCount()
            },
            retainedGPUResources: context.retainedResourceCount,
            retainedSheets: 0,
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
    private let segmentSheet: DesktopWorldNativeSheet.SegmentSheet

    init(
        segmentSheet: DesktopWorldNativeSheet.SegmentSheet,
        context: AOSDesktopPixelNativeBaselineGPUContext
    ) throws {
        let width = Int(CGDisplayPixelsWide(segmentSheet.displayID))
        let height = Int(CGDisplayPixelsHigh(segmentSheet.displayID))
        let backingPixels = width <= Int.max / max(1, height) ? width * height : Int.max
        guard backingPixels > 0,
              backingPixels <= AOSDesktopPixelNativeBaselineCapture.maximumPixelsPerDisplay else {
            throw AOSDesktopPixelNativeBaselineFailure(
                code: "DESKTOP_PIXEL_BASELINE_BACKING_PIXEL_BUDGET_EXCEEDED"
            )
        }
        displayID = segmentSheet.displayID
        self.segmentSheet = segmentSheet
        renderer = AOSDesktopPixelNativeBaselineRenderer(
            view: segmentSheet.host.view,
            context: context,
            mesh: segmentSheet.mesh
        )
    }

    func present() {
        segmentSheet.host.present()
    }

    func disposeRenderer() {
        renderer.dispose()
        segmentSheet.host.detachRenderer()
    }

    func retainedGeometryBufferCount() -> Int {
        segmentSheet.mesh.retainedBufferCount
    }

    func retainedTextureCount() -> Int {
        renderer.retainedTextureCount()
    }

    func retainedViewCount() -> Int {
        segmentSheet.host.retainedViewCount
    }

    func retainedWindowCount() -> Int {
        segmentSheet.segment.window.isVisible || segmentSheet.segment.window.contentView != nil ? 1 : 0
    }
}

@MainActor
final class AOSDesktopPixelNativeBaselineDesktopWorldHost: AOSDesktopPixelNativeBaselineHost {
    let kind = AOSDesktopPixelNativeBaselineHostKind.desktopWorld
    private(set) var endpoints: [any AOSDesktopPixelNativeBaselineEndpoint] = []
    let canvasGeneration: UInt64?
    let geometryMetrics: DesktopWorldNativeSheetGeometryMetrics
    let topologyGeneration: UInt64?
    let sheetIdentity: AOSDesktopWorldResourceIdentity?
    private let canvas: DesktopWorldSurfaceCanvas
    private let coordinator: CanvasLifecycleCoordinator
    private let context: AOSDesktopPixelNativeBaselineGPUContext
    private let generation: CanvasLifecycleGeneration
    private let registry: DesktopWorldNativeSheetRegistry
    private let sheet: DesktopWorldNativeSheet
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
        let context: AOSDesktopPixelNativeBaselineGPUContext
        do {
            context = try AOSDesktopPixelNativeBaselineGPUContext(
                device: device,
                pixelFormat: .bgra8Unorm
            )
        } catch {
            canvas.finalizeRetirement()
            throw error
        }
        let registry = DesktopWorldNativeSheetRegistry(
            segments: canvas.segments,
            device: device
        )
        let sheet: DesktopWorldNativeSheet
        do {
            sheet = try registry.install()
        } catch {
            context.dispose()
            canvas.finalizeRetirement()
            throw AOSDesktopPixelNativeBaselineFailure(
                code: "DESKTOP_PIXEL_BASELINE_SHEET_INSTALLATION_FAILED",
                nativeCode: (error as NSError).code
            )
        }
        let createdEndpoints: [any AOSDesktopPixelNativeBaselineEndpoint]
        do {
            createdEndpoints = try sheet.segmentSheets.map {
                try AOSDesktopPixelNativeBaselineDesktopWorldEndpoint(
                    segmentSheet: $0,
                    context: context
                )
            }
        } catch {
            registry.discardImmediately()
            context.dispose()
            canvas.finalizeRetirement()
            throw error
        }
        self.canvas = canvas
        self.coordinator = coordinator
        self.context = context
        self.generation = generation
        self.registry = registry
        self.sheet = sheet
        geometryMetrics = sheet.metrics
        sheetIdentity = sheet.identity
        endpoints = createdEndpoints
        canvasGeneration = generation.value
        topologyGeneration = canvas.topologyGeneration
    }

    func present() throws {
        let addressed = try registry.sheet(for: sheet.identity)
        guard addressed === sheet else {
            throw AOSDesktopPixelNativeBaselineFailure(
                code: "DESKTOP_PIXEL_BASELINE_SHEET_IDENTITY_MISMATCH"
            )
        }
        canvas.show()
        addressed.present()
    }

    func dispose() async -> AOSDesktopPixelNativeBaselineHostCleanup {
        guard !disposed else {
            return AOSDesktopPixelNativeBaselineHostCleanup(
                pendingRetirements: 0,
                retainedGeometryBuffers: 0,
                retainedGPUResources: 0,
                retainedSheets: 0,
                retainedTextures: 0,
                retainedViews: 0,
                retainedWindows: 0
            )
        }
        disposed = true
        endpoints.forEach { $0.disposeRenderer() }
        let sheetRemoved: Bool
        do {
            try registry.remove(sheet.identity)
            sheetRemoved = true
        } catch {
            sheetRemoved = false
        }
        context.dispose()
        coordinator.retainUntilNextRunLoop(canvas, generation: generation)
        let deadline = DispatchTime.now().uptimeNanoseconds + 2_000_000_000
        while coordinator.pendingFinalizationCount > 0,
              DispatchTime.now().uptimeNanoseconds < deadline {
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        let result = AOSDesktopPixelNativeBaselineHostCleanup(
            pendingRetirements: coordinator.pendingFinalizationCount,
            retainedGeometryBuffers: endpoints.reduce(0) {
                $0 + $1.retainedGeometryBufferCount()
            },
            retainedGPUResources: context.retainedResourceCount,
            retainedSheets: sheetRemoved ? registry.count : max(1, registry.count),
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
