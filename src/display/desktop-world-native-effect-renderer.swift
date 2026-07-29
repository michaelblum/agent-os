import CoreVideo
import Foundation
import MetalKit

private let aosDesktopWorldNativeRippleShader = #"""
#include <metal_stdlib>
using namespace metal;

struct NativeSheetVertex {
    float4 clipPosition;
    float4 worldAndUV;
};

struct RippleVertexOut {
    float4 position [[position]];
    float2 uv;
    float2 worldPosition;
};

struct RippleUniforms {
    float2 origin;
    float2 segmentSize;
    float amplitude;
    float decay;
    float envelopeWidth;
    float elapsed;
    float frequency;
    float radius;
    float speed;
};

vertex RippleVertexOut desktopWorldNativeRippleVertex(
    const device NativeSheetVertex *vertices [[buffer(0)]],
    uint vertexID [[vertex_id]]
) {
    NativeSheetVertex sheetVertex = vertices[vertexID];
    RippleVertexOut output;
    output.position = sheetVertex.clipPosition;
    output.worldPosition = sheetVertex.worldAndUV.xy;
    output.uv = sheetVertex.worldAndUV.zw;
    return output;
}

fragment float4 desktopWorldNativeRippleFragment(
    RippleVertexOut input [[stage_in]],
    texture2d<float> desktop [[texture(0)]],
    constant RippleUniforms &uniforms [[buffer(0)]]
) {
    constexpr sampler sampleFilter(address::clamp_to_edge, filter::linear);
    float2 delta = input.worldPosition - uniforms.origin;
    float distanceFromOrigin = length(delta);
    float waveFront = distanceFromOrigin - uniforms.elapsed * uniforms.speed;
    float packet = exp(
        -(waveFront * waveFront)
            / (uniforms.envelopeWidth * uniforms.envelopeWidth)
    );
    float distanceFade = 1.0 / (1.0 + distanceFromOrigin * uniforms.decay * 0.001);
    float timeFade = exp(-uniforms.elapsed * uniforms.decay);
    float radiusFade = 1.0 - smoothstep(uniforms.radius * 0.85, uniforms.radius, distanceFromOrigin);
    float wave = cos(waveFront * uniforms.frequency);
    float2 direction = distanceFromOrigin > 0.001 ? delta / distanceFromOrigin : float2(0.0);
    float displacement = uniforms.amplitude * wave * packet * distanceFade * timeFade * radiusFade;
    float2 uv = input.uv + direction * displacement / max(uniforms.segmentSize, float2(1.0));
    float effectAlpha = clamp(packet * radiusFade * timeFade * 1.5, 0.0, 1.0);
    if (effectAlpha < 0.001) {
        discard_fragment();
    }
    float3 color = desktop.sample(sampleFilter, uv).rgb;
    return float4(color * effectAlpha, effectAlpha);
}
"""#

private struct AOSDesktopWorldNativeRippleUniforms {
    var origin: SIMD2<Float>
    var segmentSize: SIMD2<Float>
    var amplitude: Float
    var decay: Float
    var envelopeWidth: Float
    var elapsed: Float
    var frequency: Float
    var radius: Float
    var speed: Float
}

@MainActor
final class AOSDesktopWorldNativeEffectGPUContext {
    private(set) var commandQueue: MTLCommandQueue?
    private(set) var ripplePipeline: MTLRenderPipelineState?
    private(set) var textureCache: CVMetalTextureCache?

    init(device: MTLDevice, pixelFormat: MTLPixelFormat) throws {
        guard let commandQueue = device.makeCommandQueue() else {
            throw DesktopWorldNativeSheetFailure.rendererUnavailable
        }
        let library = try device.makeLibrary(
            source: aosDesktopWorldNativeRippleShader,
            options: nil
        )
        guard let vertex = library.makeFunction(
            name: "desktopWorldNativeRippleVertex"
        ),
              let fragment = library.makeFunction(
                name: "desktopWorldNativeRippleFragment"
              ) else {
            throw DesktopWorldNativeSheetFailure.rendererUnavailable
        }
        let descriptor = MTLRenderPipelineDescriptor()
        descriptor.vertexFunction = vertex
        descriptor.fragmentFunction = fragment
        descriptor.colorAttachments[0].pixelFormat = pixelFormat
        guard let pipeline = try? device.makeRenderPipelineState(
            descriptor: descriptor
        ) else {
            throw DesktopWorldNativeSheetFailure.rendererUnavailable
        }
        var cache: CVMetalTextureCache?
        let status = CVMetalTextureCacheCreate(
            kCFAllocatorDefault,
            nil,
            device,
            nil,
            &cache
        )
        guard status == kCVReturnSuccess, let cache else {
            throw DesktopWorldNativeSheetFailure.rendererUnavailable
        }
        self.commandQueue = commandQueue
        ripplePipeline = pipeline
        textureCache = cache
    }

    func dispose() {
        if let textureCache { CVMetalTextureCacheFlush(textureCache, 0) }
        textureCache = nil
        ripplePipeline = nil
        commandQueue = nil
    }

    var retainedResourceCount: Int {
        (commandQueue == nil ? 0 : 1)
            + (ripplePipeline == nil ? 0 : 1)
            + (textureCache == nil ? 0 : 1)
    }
}

@MainActor
final class AOSDesktopWorldNativeRippleRenderer: NSObject, MTKViewDelegate {
    private let context: AOSDesktopWorldNativeEffectGPUContext
    private let duration: TimeInterval
    private let envelopeWidth: Float
    private let mesh: DesktopWorldNativeSheetMesh
    private let origin: CGPoint
    private let parameters: AOSDesktopWorldNativeRippleParameters
    private var completed = false
    private var retainedCVTexture: CVMetalTexture?
    private var retainedPixelBuffer: CVPixelBuffer?
    private var presentationReported = false
    private let startedAt: TimeInterval
    private var texture: MTLTexture?
    var onComplete: (() -> Void)?
    var onFailure: ((String) -> Void)?
    var onPresented: (() -> Void)?

    init(
        view: MTKView,
        context: AOSDesktopWorldNativeEffectGPUContext,
        mesh: DesktopWorldNativeSheetMesh,
        pixelBuffer: CVPixelBuffer,
        origin: CGPoint,
        parameters: AOSDesktopWorldNativeRippleParameters,
        startedAt: TimeInterval
    ) throws {
        self.context = context
        self.duration = Double(parameters.durationMilliseconds) / 1_000
        self.envelopeWidth = Float(Self.envelopeWidth(for: parameters.radius))
        self.mesh = mesh
        self.origin = origin
        self.parameters = parameters
        self.startedAt = startedAt
        super.init()

        guard let textureCache = context.textureCache else {
            throw DesktopWorldNativeSheetFailure.rendererUnavailable
        }
        var cvTexture: CVMetalTexture?
        let status = CVMetalTextureCacheCreateTextureFromImage(
            kCFAllocatorDefault,
            textureCache,
            pixelBuffer,
            nil,
            .bgra8Unorm,
            CVPixelBufferGetWidth(pixelBuffer),
            CVPixelBufferGetHeight(pixelBuffer),
            0,
            &cvTexture
        )
        guard status == kCVReturnSuccess,
              let cvTexture,
              let texture = CVMetalTextureGetTexture(cvTexture) else {
            throw DesktopWorldNativeSheetFailure.textureUnavailable
        }
        retainedPixelBuffer = pixelBuffer
        retainedCVTexture = cvTexture
        self.texture = texture
        view.delegate = self
        view.enableSetNeedsDisplay = false
        view.preferredFramesPerSecond = 60
        view.isPaused = false
    }

    func dispose(view: MTKView) {
        onComplete = nil
        onFailure = nil
        onPresented = nil
        view.isPaused = true
        view.enableSetNeedsDisplay = true
        if view.delegate === self { view.delegate = nil }
        texture = nil
        retainedCVTexture = nil
        retainedPixelBuffer = nil
    }

    var retainedTextureCount: Int {
        texture == nil && retainedCVTexture == nil && retainedPixelBuffer == nil ? 0 : 1
    }

    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

    func draw(in view: MTKView) {
        let elapsed = max(0, ProcessInfo.processInfo.systemUptime - startedAt)
        if elapsed >= duration {
            view.isPaused = true
            if !completed {
                completed = true
                let callback = presentationReported ? onComplete : nil
                let failure = presentationReported ? nil : onFailure
                onComplete = nil
                onFailure = nil
                onPresented = nil
                failure?("NATIVE_EFFECT_NO_PRESENTED_FRAME")
                callback?()
            }
            return
        }
        guard let texture,
              let vertexBuffer = mesh.vertexBuffer,
              let indexBuffer = mesh.indexBuffer,
              let commandQueue = context.commandQueue,
              let pipeline = context.ripplePipeline,
              let descriptor = view.currentRenderPassDescriptor,
              let drawable = view.currentDrawable,
              let commandBuffer = commandQueue.makeCommandBuffer(),
              let encoder = commandBuffer.makeRenderCommandEncoder(
                descriptor: descriptor
              ) else {
            return
        }
        var uniforms = AOSDesktopWorldNativeRippleUniforms(
            origin: SIMD2(Float(origin.x), Float(origin.y)),
            segmentSize: SIMD2(
                Float(mesh.worldBounds.width),
                Float(mesh.worldBounds.height)
            ),
            amplitude: Float(parameters.amplitude),
            decay: Float(parameters.decay),
            envelopeWidth: envelopeWidth,
            elapsed: Float(elapsed),
            frequency: Float(parameters.frequency),
            radius: Float(parameters.radius),
            speed: Float(parameters.speed)
        )
        encoder.setRenderPipelineState(pipeline)
        encoder.setVertexBuffer(vertexBuffer, offset: 0, index: 0)
        encoder.setFragmentTexture(texture, index: 0)
        encoder.setFragmentBytes(
            &uniforms,
            length: MemoryLayout<AOSDesktopWorldNativeRippleUniforms>.stride,
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
        if !presentationReported {
            drawable.addPresentedHandler { [weak self] _ in
                DispatchQueue.main.async {
                    self?.markPresented()
                }
            }
        }
        commandBuffer.addCompletedHandler { [weak self] completedBuffer in
            guard completedBuffer.status == .error else { return }
            DispatchQueue.main.async {
                self?.fail("NATIVE_EFFECT_COMMAND_BUFFER_FAILED", view: view)
            }
        }
        commandBuffer.present(drawable)
        commandBuffer.commit()
    }

    private static func envelopeWidth(for radius: Double) -> Double {
        min(180, max(24, radius * 0.08))
    }

    private func markPresented() {
        guard !completed, !presentationReported else { return }
        presentationReported = true
        let callback = onPresented
        onPresented = nil
        callback?()
    }

    private func fail(_ code: String, view: MTKView) {
        guard !completed else { return }
        completed = true
        view.isPaused = true
        let callback = onFailure
        onComplete = nil
        onFailure = nil
        onPresented = nil
        callback?(code)
    }
}

@MainActor
final class AOSDesktopWorldNativeRippleRuntime {
    private let context: AOSDesktopWorldNativeEffectGPUContext
    private var renderers: [UInt32: AOSDesktopWorldNativeRippleRenderer] = [:]
    private let sheet: DesktopWorldNativeSheet
    private var disposed = false

    init(
        sheet: DesktopWorldNativeSheet,
        context: AOSDesktopWorldNativeEffectGPUContext,
        frames: AOSDesktopPixelFrameSet,
        origin: CGPoint,
        parameters: AOSDesktopWorldNativeRippleParameters
    ) throws {
        let framesByDisplay = Dictionary(
            uniqueKeysWithValues: frames.frames.map { ($0.displayID, $0) }
        )
        let sheetDisplays = Set(sheet.segmentSheets.map(\.displayID))
        guard Set(framesByDisplay.keys) == sheetDisplays else {
            throw DesktopWorldNativeSheetFailure.frameSetIncomplete
        }
        self.context = context
        self.sheet = sheet
        let startedAt = ProcessInfo.processInfo.systemUptime
        do {
            for segment in sheet.segmentSheets {
                guard let pixelBuffer = framesByDisplay[segment.displayID]?.pixelBuffer else {
                    throw DesktopWorldNativeSheetFailure.frameSetIncomplete
                }
                renderers[segment.displayID] = try AOSDesktopWorldNativeRippleRenderer(
                    view: segment.host.view,
                    context: context,
                    mesh: segment.mesh,
                    pixelBuffer: pixelBuffer,
                    origin: origin,
                    parameters: parameters,
                    startedAt: startedAt
                )
            }
        } catch {
            dispose()
            throw error
        }
    }

    func present(
        onPresented: @escaping () -> Void,
        onFailure: @escaping (String) -> Void,
        onComplete: @escaping () -> Void
    ) {
        guard !disposed, !renderers.isEmpty else { return }
        var failed = false
        var remainingPresentations = renderers.count
        var remaining = renderers.count
        for renderer in renderers.values {
            renderer.onPresented = {
                guard !failed else { return }
                remainingPresentations -= 1
                if remainingPresentations == 0 { onPresented() }
            }
            renderer.onFailure = { code in
                guard !failed else { return }
                failed = true
                onFailure(code)
            }
            renderer.onComplete = {
                guard !failed else { return }
                remaining -= 1
                if remaining == 0 { onComplete() }
            }
        }
        sheet.present()
    }

    func dispose() {
        guard !disposed else { return }
        disposed = true
        for segment in sheet.segmentSheets {
            renderers[segment.displayID]?.dispose(view: segment.host.view)
        }
        renderers.removeAll(keepingCapacity: false)
        sheet.suspend()
    }

    var retainedTextureCount: Int {
        renderers.values.reduce(0) { $0 + $1.retainedTextureCount }
    }
}

extension AOSDesktopWorldNativeRippleRuntime:
    AOSDesktopWorldNativeFeedbackRuntime
{}
