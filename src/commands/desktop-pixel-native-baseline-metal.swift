import AppKit
import CoreVideo
import Foundation
import MetalKit

enum AOSDesktopPixelNativeBaselinePresentation: String, Encodable {
    case identity
    case inverted
}

private let aosDesktopPixelNativeBaselineShader = #"""
#include <metal_stdlib>
using namespace metal;

struct VertexOut {
    float4 position [[position]];
    float2 uv;
    float2 worldPosition;
};

struct NativeSheetVertex {
    float4 clipPosition;
    float4 worldAndUV;
};

struct Uniforms {
    float inverted;
};

vertex VertexOut desktopPixelBaselineVertex(
    const device NativeSheetVertex *vertices [[buffer(0)]],
    uint vertexID [[vertex_id]]
) {
    NativeSheetVertex sheetVertex = vertices[vertexID];
    VertexOut output;
    output.position = sheetVertex.clipPosition;
    output.worldPosition = sheetVertex.worldAndUV.xy;
    output.uv = sheetVertex.worldAndUV.zw;
    return output;
}

fragment float4 desktopPixelBaselineFragment(
    VertexOut input [[stage_in]],
    texture2d<float> desktop [[texture(0)]],
    constant Uniforms &uniforms [[buffer(0)]]
) {
    constexpr sampler sampleFilter(address::clamp_to_edge, filter::linear);
    float4 color = desktop.sample(sampleFilter, input.uv);
    if (uniforms.inverted > 0.5) {
        color.rgb = 1.0 - color.rgb;
    }
    return float4(color.rgb, 1.0);
}
"""#

private struct AOSDesktopPixelNativeBaselineUniforms {
    var inverted: Float
}

@MainActor
final class AOSDesktopPixelNativeBaselineGPUContext {
    private(set) var commandQueue: MTLCommandQueue?
    private(set) var pipeline: MTLRenderPipelineState?
    private(set) var textureCache: CVMetalTextureCache?

    init(device: MTLDevice, pixelFormat: MTLPixelFormat) throws {
        guard let commandQueue = device.makeCommandQueue() else {
            throw AOSDesktopPixelNativeBaselineFailure(code: "DESKTOP_PIXEL_BASELINE_METAL_UNAVAILABLE")
        }
        self.commandQueue = commandQueue
        let library = try device.makeLibrary(source: aosDesktopPixelNativeBaselineShader, options: nil)
        guard let vertex = library.makeFunction(name: "desktopPixelBaselineVertex"),
              let fragment = library.makeFunction(name: "desktopPixelBaselineFragment") else {
            throw AOSDesktopPixelNativeBaselineFailure(code: "DESKTOP_PIXEL_BASELINE_SHADER_INVALID")
        }
        let descriptor = MTLRenderPipelineDescriptor()
        descriptor.vertexFunction = vertex
        descriptor.fragmentFunction = fragment
        descriptor.colorAttachments[0].pixelFormat = pixelFormat
        pipeline = try device.makeRenderPipelineState(descriptor: descriptor)

        var cache: CVMetalTextureCache?
        let status = CVMetalTextureCacheCreate(kCFAllocatorDefault, nil, device, nil, &cache)
        guard status == kCVReturnSuccess, let cache else {
            throw AOSDesktopPixelNativeBaselineFailure(
                code: "DESKTOP_PIXEL_BASELINE_TEXTURE_CACHE_FAILED",
                nativeCode: Int(status)
            )
        }
        textureCache = cache
    }

    func dispose() {
        if let textureCache { CVMetalTextureCacheFlush(textureCache, 0) }
        textureCache = nil
        pipeline = nil
        commandQueue = nil
    }

    var retainedResourceCount: Int {
        (commandQueue == nil ? 0 : 1)
            + (pipeline == nil ? 0 : 1)
            + (textureCache == nil ? 0 : 1)
    }
}

@MainActor
final class AOSDesktopPixelNativeBaselineRenderer: NSObject, MTKViewDelegate {
    private let context: AOSDesktopPixelNativeBaselineGPUContext
    private let mesh: DesktopWorldNativeSheetMesh
    private var retainedCVTexture: CVMetalTexture?
    private var retainedPixelBuffer: CVPixelBuffer?
    private var texture: MTLTexture?
    private var presentation: AOSDesktopPixelNativeBaselinePresentation = .identity
    var onPresented: (() -> Void)?

    init(
        view: MTKView,
        context: AOSDesktopPixelNativeBaselineGPUContext,
        mesh: DesktopWorldNativeSheetMesh
    ) {
        self.context = context
        self.mesh = mesh
        super.init()
        view.delegate = self
    }

    func setFrame(
        _ frame: AOSDesktopPixelNativeBaselineFrame,
        presentation: AOSDesktopPixelNativeBaselinePresentation
    ) throws {
        clearFrame()
        guard let textureCache = context.textureCache else {
            throw AOSDesktopPixelNativeBaselineFailure(code: "DESKTOP_PIXEL_BASELINE_RENDERER_DISPOSED")
        }
        let width = CVPixelBufferGetWidth(frame.pixelBuffer)
        let height = CVPixelBufferGetHeight(frame.pixelBuffer)
        var cvTexture: CVMetalTexture?
        let status = CVMetalTextureCacheCreateTextureFromImage(
            kCFAllocatorDefault,
            textureCache,
            frame.pixelBuffer,
            nil,
            .bgra8Unorm,
            width,
            height,
            0,
            &cvTexture
        )
        guard status == kCVReturnSuccess,
              let cvTexture,
              let metalTexture = CVMetalTextureGetTexture(cvTexture) else {
            throw AOSDesktopPixelNativeBaselineFailure(
                code: "DESKTOP_PIXEL_BASELINE_TEXTURE_FAILED",
                nativeCode: Int(status)
            )
        }
        retainedPixelBuffer = frame.pixelBuffer
        retainedCVTexture = cvTexture
        texture = metalTexture
        self.presentation = presentation
    }

    func clearFrame() {
        onPresented = nil
        texture = nil
        retainedCVTexture = nil
        retainedPixelBuffer = nil
    }

    func dispose() {
        clearFrame()
    }

    func retainedTextureCount() -> Int {
        texture == nil && retainedCVTexture == nil && retainedPixelBuffer == nil ? 0 : 1
    }

    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

    func draw(in view: MTKView) {
        guard let texture,
              let vertexBuffer = mesh.vertexBuffer,
              let indexBuffer = mesh.indexBuffer,
              let commandQueue = context.commandQueue,
              let pipeline = context.pipeline,
              let descriptor = view.currentRenderPassDescriptor,
              let drawable = view.currentDrawable,
              let commandBuffer = commandQueue.makeCommandBuffer(),
              let encoder = commandBuffer.makeRenderCommandEncoder(descriptor: descriptor) else {
            return
        }
        var uniforms = AOSDesktopPixelNativeBaselineUniforms(
            inverted: presentation == .inverted ? 1 : 0
        )
        encoder.setRenderPipelineState(pipeline)
        encoder.setVertexBuffer(vertexBuffer, offset: 0, index: 0)
        encoder.setFragmentTexture(texture, index: 0)
        encoder.setFragmentBytes(
            &uniforms,
            length: MemoryLayout<AOSDesktopPixelNativeBaselineUniforms>.stride,
            index: 0
        )
        encoder.drawIndexedPrimitives(
            type: .triangle,
            indexCount: mesh.indexCount,
            indexType: .uint32,
            indexBuffer: indexBuffer,
            indexBufferOffset: 0
        )
        encoder.endEncoding()
        if let callback = onPresented {
            onPresented = nil
            drawable.addPresentedHandler { _ in callback() }
        }
        commandBuffer.present(drawable)
        commandBuffer.commit()
    }
}

@MainActor
private final class AOSDesktopPixelNativeBaselineWindow: NSWindow {
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect {
        frameRect
    }

    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

@MainActor
final class AOSDesktopPixelNativeBaselineSurface: AOSDesktopPixelNativeBaselineEndpoint {
    let displayID: CGDirectDisplayID
    let renderer: AOSDesktopPixelNativeBaselineRenderer
    let mesh: DesktopWorldNativeSheetMesh
    let view: MTKView
    let window: NSWindow

    init(
        screen: NSScreen,
        displayID: CGDirectDisplayID,
        device: MTLDevice,
        context: AOSDesktopPixelNativeBaselineGPUContext,
        geometryDescriptor: DesktopWorldNativeSheetGeometryDescriptor
    ) throws {
        self.displayID = displayID
        let backingPixels = Int(screen.frame.width * screen.backingScaleFactor)
            * Int(screen.frame.height * screen.backingScaleFactor)
        guard backingPixels > 0,
              backingPixels <= AOSDesktopPixelNativeBaselineCapture.maximumPixelsPerDisplay else {
            throw AOSDesktopPixelNativeBaselineFailure(
                code: "DESKTOP_PIXEL_BASELINE_BACKING_PIXEL_BUDGET_EXCEEDED"
            )
        }

        let view = MTKView(frame: NSRect(origin: .zero, size: screen.frame.size), device: device)
        view.autoResizeDrawable = true
        view.clearColor = MTLClearColorMake(0, 0, 0, 0)
        view.colorPixelFormat = .bgra8Unorm
        view.enableSetNeedsDisplay = true
        view.framebufferOnly = true
        view.isPaused = true
        self.view = view
        mesh = try DesktopWorldNativeSheetMesh(
            descriptor: geometryDescriptor,
            device: device,
            worldBounds: screen.frame
        )
        renderer = AOSDesktopPixelNativeBaselineRenderer(
            view: view,
            context: context,
            mesh: mesh
        )

        let window = AOSDesktopPixelNativeBaselineWindow(
            contentRect: screen.frame,
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        window.animationBehavior = .none
        window.backgroundColor = .clear
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
        window.contentView = view
        window.hasShadow = false
        window.ignoresMouseEvents = true
        window.isOpaque = false
        window.isReleasedWhenClosed = false
        window.level = .screenSaver
        window.setFrame(screen.frame, display: true)
        window.orderOut(nil)
        self.window = window
    }

    func show() {
        window.orderFront(nil)
        view.draw()
    }

    func present() {
        show()
    }

    func dispose() {
        window.orderOut(nil)
        renderer.dispose()
        mesh.dispose()
        view.delegate = nil
        view.removeFromSuperview()
        window.contentView = nil
        window.close()
    }

    func disposeRenderer() {
        dispose()
    }

    func retainedTextureCount() -> Int {
        renderer.retainedTextureCount()
    }

    func retainedGeometryBufferCount() -> Int {
        mesh.retainedBufferCount
    }

    func retainedWindowCount() -> Int {
        window.isVisible || window.contentView != nil ? 1 : 0
    }

    func retainedViewCount() -> Int {
        view.superview == nil ? 0 : 1
    }
}
