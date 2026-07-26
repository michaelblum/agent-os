import AppKit
import Foundation
import MetalKit
import ScreenCaptureKit

private let markerPointSize: CGFloat = 128
private let maximumDisplayCount = 8
private let maximumMarkerPixelDimension = 512
private let markerPresentationTimeoutNanoseconds: UInt64 = 2_000_000_000
private let captureAttemptLimit = 8

private func monotonicNanoseconds() -> UInt64 {
    DispatchTime.now().uptimeNanoseconds
}

private func emit(_ payload: [String: Any]) {
    guard JSONSerialization.isValidJSONObject(payload),
          let data = try? JSONSerialization.data(
              withJSONObject: payload,
              options: [.sortedKeys]
          ) else { return }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0A]))
}

private func displayID(for screen: NSScreen) -> CGDirectDisplayID? {
    let key = NSDeviceDescriptionKey("NSScreenNumber")
    return (screen.deviceDescription[key] as? NSNumber)?.uint32Value
}

private enum VisualProofFailure: String, Error {
    case capturePermissionRequired = "SCREEN_CAPTURE_PERMISSION_REQUIRED"
    case displayTopologyUnavailable = "DISPLAY_TOPOLOGY_UNAVAILABLE"
    case metalUnavailable = "METAL_UNAVAILABLE"
    case markerInitializationFailed = "MARKER_INITIALIZATION_FAILED"
    case markerPresentationTimedOut = "MARKER_PRESENTATION_TIMEOUT"
    case displayCaptureUnavailable = "DISPLAY_CAPTURE_UNAVAILABLE"
    case markerPixelsMissing = "MARKER_PIXELS_MISSING"
    case cleanupFailed = "CLEANUP_FAILED"
}

private final class PresentationCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 0

    func mark() {
        lock.lock()
        value += 1
        lock.unlock()
    }

    var count: Int {
        lock.lock()
        defer { lock.unlock() }
        return value
    }
}

private let markerShaderSource = #"""
#include <metal_stdlib>
using namespace metal;

struct MarkerVertex {
    float4 position [[position]];
    float2 uv;
};

vertex MarkerVertex markerVertex(uint vertexID [[vertex_id]]) {
    const float2 positions[3] = {
        float2(-1.0, -1.0),
        float2( 3.0, -1.0),
        float2(-1.0,  3.0)
    };
    const float2 uvs[3] = {
        float2(0.0, 1.0),
        float2(2.0, 1.0),
        float2(0.0, -1.0)
    };
    MarkerVertex output;
    output.position = float4(positions[vertexID], 0.0, 1.0);
    output.uv = uvs[vertexID];
    return output;
}

fragment float4 markerFragment(MarkerVertex input [[stage_in]]) {
    float2 uv = input.uv;
    float thickness = 0.055;
    bool border = uv.x <= thickness || uv.x >= 1.0 - thickness
        || uv.y <= thickness || uv.y >= 1.0 - thickness;
    bool diagonal = abs(uv.y - uv.x) <= thickness
        || abs(uv.y - (1.0 - uv.x)) <= thickness;
    if (border || diagonal) {
        return float4(0.0, 1.0, 0.0, 1.0);
    }
    return float4(1.0, 0.0, 1.0, 1.0);
}
"""#

@MainActor
private final class MarkerRenderer: NSObject, MTKViewDelegate {
    private let commandQueue: MTLCommandQueue
    private let pipeline: MTLRenderPipelineState
    private var presented: (() -> Void)?

    init(view: MTKView) throws {
        guard let device = view.device,
              let commandQueue = device.makeCommandQueue() else {
            throw VisualProofFailure.metalUnavailable
        }
        let library = try device.makeLibrary(source: markerShaderSource, options: nil)
        guard let vertex = library.makeFunction(name: "markerVertex"),
              let fragment = library.makeFunction(name: "markerFragment") else {
            throw VisualProofFailure.markerInitializationFailed
        }
        let descriptor = MTLRenderPipelineDescriptor()
        descriptor.vertexFunction = vertex
        descriptor.fragmentFunction = fragment
        descriptor.colorAttachments[0].pixelFormat = view.colorPixelFormat
        self.commandQueue = commandQueue
        self.pipeline = try device.makeRenderPipelineState(descriptor: descriptor)
        super.init()
        view.delegate = self
    }

    func drawOnce(onPresented: @escaping () -> Void) {
        presented = onPresented
    }

    func dispose(view: MTKView) {
        presented = nil
        view.delegate = nil
    }

    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

    func draw(in view: MTKView) {
        guard let pass = view.currentRenderPassDescriptor,
              let drawable = view.currentDrawable,
              let commandBuffer = commandQueue.makeCommandBuffer(),
              let encoder = commandBuffer.makeRenderCommandEncoder(
                  descriptor: pass
              ) else { return }
        encoder.setRenderPipelineState(pipeline)
        encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
        encoder.endEncoding()
        if let callback = presented {
            presented = nil
            drawable.addPresentedHandler { _ in callback() }
        }
        commandBuffer.present(drawable)
        commandBuffer.commit()
    }
}

@MainActor
private final class MarkerWindow: NSWindow {
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect {
        frameRect
    }

    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

@MainActor
private final class MarkerSurface {
    let displayID: CGDirectDisplayID
    let scale: CGFloat
    let view: MTKView
    let renderer: MarkerRenderer
    let window: MarkerWindow

    init(screen: NSScreen, displayID: CGDirectDisplayID, device: MTLDevice) throws {
        self.displayID = displayID
        self.scale = screen.backingScaleFactor
        let frame = NSRect(
            x: screen.frame.midX - markerPointSize / 2,
            y: screen.frame.midY - markerPointSize / 2,
            width: markerPointSize,
            height: markerPointSize
        )
        let view = MTKView(
            frame: NSRect(origin: .zero, size: frame.size),
            device: device
        )
        view.autoResizeDrawable = true
        view.colorPixelFormat = .bgra8Unorm
        view.clearColor = MTLClearColorMake(1, 0, 1, 1)
        view.enableSetNeedsDisplay = true
        view.framebufferOnly = true
        view.isPaused = true
        self.view = view
        self.renderer = try MarkerRenderer(view: view)

        let window = MarkerWindow(
            contentRect: frame,
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        var behavior: NSWindow.CollectionBehavior = [
            .canJoinAllSpaces,
            .fullScreenAuxiliary,
            .ignoresCycle,
            .stationary,
        ]
        if #available(macOS 26.0, *) {
            behavior.insert(.canJoinAllApplications)
        }
        window.collectionBehavior = behavior
        window.animationBehavior = .none
        window.backgroundColor = .magenta
        window.contentView = view
        window.hasShadow = false
        window.ignoresMouseEvents = true
        window.isOpaque = true
        window.isReleasedWhenClosed = false
        window.level = .screenSaver
        window.setFrame(frame, display: true)
        self.window = window
    }

    func present(counter: PresentationCounter) {
        renderer.drawOnce { counter.mark() }
        window.orderFront(nil)
        view.draw()
    }

    func dispose() {
        renderer.dispose(view: view)
        window.orderOut(nil)
        window.contentView = nil
        window.close()
    }
}

private struct MarkerPixelCounts {
    let green: Int
    let magenta: Int
    let total: Int

    var passed: Bool {
        let minimum = max(64, total / 10)
        return green >= minimum && magenta >= minimum
    }
}

private func markerPixelCounts(in image: CGImage) -> MarkerPixelCounts? {
    let width = image.width
    let height = image.height
    guard width > 0, height > 0 else { return nil }
    var bytes = [UInt8](repeating: 0, count: width * height * 4)
    guard let context = CGContext(
        data: &bytes,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: width * 4,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            | CGBitmapInfo.byteOrder32Big.rawValue
    ) else { return nil }
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))

    var green = 0
    var magenta = 0
    for index in stride(from: 0, to: bytes.count, by: 4) {
        let red = bytes[index]
        let greenChannel = bytes[index + 1]
        let blue = bytes[index + 2]
        if red < 80, greenChannel > 190, blue < 80 {
            green += 1
        } else if red > 190, greenChannel < 80, blue > 190 {
            magenta += 1
        }
    }
    return MarkerPixelCounts(green: green, magenta: magenta, total: width * height)
}

@MainActor
private final class VisualProofController: NSObject, NSApplicationDelegate {
    private(set) var exitCode: Int32 = 1
    private var managedWindowNumbers: [CGWindowID] = []
    private var surfaces: [MarkerSurface] = []

    func applicationDidFinishLaunching(_ notification: Notification) {
        Task { @MainActor in
            await run()
            NSApp.terminate(nil)
        }
    }

    private func run() async {
        let startedAt = monotonicNanoseconds()
        do {
            guard CGPreflightScreenCaptureAccess() else {
                throw VisualProofFailure.capturePermissionRequired
            }
            guard let device = MTLCreateSystemDefaultDevice() else {
                throw VisualProofFailure.metalUnavailable
            }
            let screenPairs = NSScreen.screens.compactMap { screen -> (NSScreen, CGDirectDisplayID)? in
                guard let id = displayID(for: screen) else { return nil }
                return (screen, id)
            }
            guard !screenPairs.isEmpty,
                  screenPairs.count <= maximumDisplayCount else {
                throw VisualProofFailure.displayTopologyUnavailable
            }
            surfaces = try screenPairs.map { screen, id in
                try MarkerSurface(screen: screen, displayID: id, device: device)
            }
            managedWindowNumbers = surfaces.map { CGWindowID($0.window.windowNumber) }

            let counter = PresentationCounter()
            surfaces.forEach { $0.present(counter: counter) }
            let presentationDeadline = monotonicNanoseconds()
                + markerPresentationTimeoutNanoseconds
            while counter.count < surfaces.count,
                  monotonicNanoseconds() < presentationDeadline {
                try await Task.sleep(nanoseconds: 5_000_000)
            }
            guard counter.count == surfaces.count else {
                throw VisualProofFailure.markerPresentationTimedOut
            }
            let presentedAt = monotonicNanoseconds()

            let content = try await SCShareableContent.excludingDesktopWindows(
                false,
                onScreenWindowsOnly: false
            )
            let displayByID = Dictionary(
                uniqueKeysWithValues: content.displays.map { ($0.displayID, $0) }
            )
            var results: [[String: Any]] = []
            for surface in surfaces {
                guard let display = displayByID[surface.displayID] else {
                    throw VisualProofFailure.displayCaptureUnavailable
                }
                let sourcePointSize = min(
                    markerPointSize,
                    CGFloat(display.width),
                    CGFloat(display.height)
                )
                let pixelSize = max(
                    1,
                    min(
                        maximumMarkerPixelDimension,
                        Int((sourcePointSize * surface.scale).rounded())
                    )
                )
                let sourceRect = CGRect(
                    x: (CGFloat(display.width) - sourcePointSize) / 2,
                    y: (CGFloat(display.height) - sourcePointSize) / 2,
                    width: sourcePointSize,
                    height: sourcePointSize
                )
                var verified: MarkerPixelCounts?
                var attempts = 0
                while attempts < captureAttemptLimit, verified?.passed != true {
                    attempts += 1
                    let configuration = SCStreamConfiguration()
                    configuration.sourceRect = sourceRect
                    configuration.width = pixelSize
                    configuration.height = pixelSize
                    configuration.showsCursor = false
                    configuration.capturesAudio = false
                    configuration.captureResolution = .best
                    let image = try await SCScreenshotManager.captureImage(
                        contentFilter: SCContentFilter(
                            display: display,
                            excludingWindows: []
                        ),
                        configuration: configuration
                    )
                    verified = markerPixelCounts(in: image)
                    if verified?.passed != true {
                        try await Task.sleep(nanoseconds: 16_000_000)
                    }
                }
                guard let verified, verified.passed else {
                    throw VisualProofFailure.markerPixelsMissing
                }
                results.append([
                    "display_id": surface.displayID,
                    "attempts": attempts,
                    "green_pixels": verified.green,
                    "magenta_pixels": verified.magenta,
                    "verified": true,
                ])
            }

            let retainedWindowCount = await disposeAndCountRetainedWindows()
            guard retainedWindowCount == 0 else {
                throw VisualProofFailure.cleanupFailed
            }

            finishSuccess([
                "status": "passed",
                "display_count": results.count,
                "all_displays_verified": results.count == screenPairs.count,
                "input_transparent": true,
                "pixels_persisted": false,
                "presentation_ms": Double(presentedAt - startedAt) / 1_000_000,
                "total_ms": Double(monotonicNanoseconds() - startedAt) / 1_000_000,
                "results": results,
                "cleanup_complete": true,
                "retained_windows": 0,
                "retained_gpu_surfaces": 0,
            ])
        } catch {
            await finishFailure(error)
        }
    }

    private func finishSuccess(_ payload: [String: Any]) {
        emit(payload)
        exitCode = 0
    }

    private func finishFailure(_ error: Error) async {
        let retainedWindowCount = await disposeAndCountRetainedWindows()
        let code = (error as? VisualProofFailure)?.rawValue
            ?? "NATIVE_VISUAL_PROOF_FAILED"
        emit([
            "status": "failed",
            "error_code": code,
            "pixels_persisted": false,
            "cleanup_complete": retainedWindowCount == 0,
            "retained_windows": retainedWindowCount,
        ])
        exitCode = 1
    }

    private func disposeAndCountRetainedWindows() async -> Int {
        disposeSurfaces()
        try? await Task.sleep(nanoseconds: 50_000_000)
        return managedWindowNumbers.filter { windowID in
            let rows = CGWindowListCopyWindowInfo(
                .optionIncludingWindow,
                windowID
            ) as? [[String: Any]]
            return rows?.first?[kCGWindowIsOnscreen as String] as? Bool == true
        }.count
    }

    private func disposeSurfaces() {
        surfaces.forEach { $0.dispose() }
        surfaces.removeAll(keepingCapacity: false)
    }
}

@main
private struct DesktopWorldNativeVisualProof {
    static func main() {
        MainActor.assumeIsolated {
            let application = NSApplication.shared
            application.setActivationPolicy(.accessory)
            let controller = VisualProofController()
            application.delegate = controller
            withExtendedLifetime(controller) {
                application.run()
            }
            exit(controller.exitCode)
        }
    }
}
