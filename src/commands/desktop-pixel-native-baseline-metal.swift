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
};

struct Uniforms {
    float inverted;
};

vertex VertexOut desktopPixelBaselineVertex(uint vertexID [[vertex_id]]) {
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
    VertexOut output;
    output.position = float4(positions[vertexID], 0.0, 1.0);
    output.uv = uvs[vertexID];
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
final class AOSDesktopPixelNativeBaselineRenderer: NSObject, MTKViewDelegate {
    private let commandQueue: MTLCommandQueue
    private let pipeline: MTLRenderPipelineState
    private let textureCache: CVMetalTextureCache
    private var retainedCVTexture: CVMetalTexture?
    private var retainedPixelBuffer: CVPixelBuffer?
    private var texture: MTLTexture?
    private var presentation: AOSDesktopPixelNativeBaselinePresentation = .identity
    var onPresented: (() -> Void)?

    init(view: MTKView) throws {
        guard let device = view.device, let commandQueue = device.makeCommandQueue() else {
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
        descriptor.colorAttachments[0].pixelFormat = view.colorPixelFormat
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
        super.init()
        view.delegate = self
    }

    func setFrame(
        _ frame: AOSDesktopPixelNativeBaselineFrame,
        presentation: AOSDesktopPixelNativeBaselinePresentation
    ) throws {
        clear()
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

    func clear() {
        onPresented = nil
        texture = nil
        retainedCVTexture = nil
        retainedPixelBuffer = nil
        CVMetalTextureCacheFlush(textureCache, 0)
    }

    func retainedTextureCount() -> Int {
        texture == nil && retainedCVTexture == nil && retainedPixelBuffer == nil ? 0 : 1
    }

    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

    func draw(in view: MTKView) {
        guard let texture,
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
        encoder.setFragmentTexture(texture, index: 0)
        encoder.setFragmentBytes(
            &uniforms,
            length: MemoryLayout<AOSDesktopPixelNativeBaselineUniforms>.stride,
            index: 0
        )
        encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
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
final class AOSDesktopPixelNativeBaselineSurface {
    let displayID: CGDirectDisplayID
    let renderer: AOSDesktopPixelNativeBaselineRenderer
    let view: MTKView
    let window: NSWindow

    init(screen: NSScreen, displayID: CGDirectDisplayID, device: MTLDevice) throws {
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
        renderer = try AOSDesktopPixelNativeBaselineRenderer(view: view)

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

    func dispose() {
        window.orderOut(nil)
        renderer.clear()
        view.delegate = nil
        window.contentView = nil
        window.close()
    }

    func retainedTextureCount() -> Int {
        renderer.retainedTextureCount()
    }

    func retainedWindowCount() -> Int {
        window.isVisible || window.contentView != nil ? 1 : 0
    }
}
