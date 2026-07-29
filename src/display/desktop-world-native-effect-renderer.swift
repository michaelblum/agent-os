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

final class AOSDesktopWorldNativeEffectGPUContext:
    AOSDesktopWorldNativeEffectPreparation,
    @unchecked Sendable
{
    private(set) var commandQueue: MTLCommandQueue?
    private(set) var ripplePipeline: MTLRenderPipelineState?
    private(set) var textureCache: CVMetalTextureCache?
    private let pixelFormat: MTLPixelFormat
    private var programPipelines = AOSDesktopWorldNativeEffectPipelineCache<MTLRenderPipelineState>()

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
        self.pixelFormat = pixelFormat
        ripplePipeline = pipeline
        textureCache = cache
    }

    deinit {
        dispose()
    }

    func prepare(
        programs: [AOSDesktopWorldNativeEffectProgram]
    ) throws {
        do {
            try programPipelines.reconcile(programs: programs) { [weak self] program in
                guard let self else {
                    throw DesktopWorldNativeSheetFailure.rendererUnavailable
                }
                return try self.makePipeline(for: program)
            }
        } catch {
            throw DesktopWorldNativeSheetFailure.rendererUnavailable
        }
    }

    func preparedPipeline(
        for program: AOSDesktopWorldNativeEffectProgram
    ) throws -> MTLRenderPipelineState {
        guard let pipeline = programPipelines.pipeline(for: program.digest) else {
            throw DesktopWorldNativeSheetFailure.rendererUnavailable
        }
        return pipeline
    }

    private func makePipeline(
        for program: AOSDesktopWorldNativeEffectProgram
    ) throws -> MTLRenderPipelineState {
        guard let device = commandQueue?.device,
              let source = AOSDesktopWorldNativeEffectProgramCompiler.source(
                for: program
              ) else {
            throw DesktopWorldNativeSheetFailure.rendererUnavailable
        }
        let library = try device.makeLibrary(source: source, options: nil)
        guard let vertex = library.makeFunction(
            name: "desktopWorldNativeProgramVertex"
        ),
              let fragment = library.makeFunction(
                name: "desktopWorldNativeProgramFragment"
              ) else {
            throw DesktopWorldNativeSheetFailure.rendererUnavailable
        }
        let descriptor = MTLRenderPipelineDescriptor()
        descriptor.vertexFunction = vertex
        descriptor.fragmentFunction = fragment
        descriptor.colorAttachments[0].pixelFormat = pixelFormat
        return try device.makeRenderPipelineState(descriptor: descriptor)
    }

    func dispose() {
        if let textureCache { CVMetalTextureCacheFlush(textureCache, 0) }
        textureCache = nil
        ripplePipeline = nil
        programPipelines.removeAll()
        commandQueue = nil
    }

    var retainedResourceCount: Int {
        (commandQueue == nil ? 0 : 1)
            + (ripplePipeline == nil ? 0 : 1)
            + programPipelines.count
            + (textureCache == nil ? 0 : 1)
    }
}

enum AOSDesktopWorldNativeEffectRenderPlan {
    case program(AOSDesktopWorldNativeEffectProgramInstance)
    case ripple(AOSDesktopWorldNativeRippleParameters)

    init(definition: AOSDesktopWorldNativeEffectDefinition) {
        switch definition {
        case .program(let instance): self = .program(instance)
        case .ripple(let parameters): self = .ripple(parameters)
        }
    }

    var duration: TimeInterval {
        switch self {
        case .program(let instance):
            return Double(instance.program.durationMilliseconds) / 1_000
        case .ripple(let parameters):
            return Double(parameters.durationMilliseconds) / 1_000
        }
    }

    @MainActor
    func pipeline(
        context: AOSDesktopWorldNativeEffectGPUContext
    ) throws -> MTLRenderPipelineState {
        switch self {
        case .program(let instance):
            return try context.preparedPipeline(for: instance.program)
        case .ripple:
            guard let pipeline = context.ripplePipeline else {
                throw DesktopWorldNativeSheetFailure.rendererUnavailable
            }
            return pipeline
        }
    }

    var elapsedUniformIndex: Int {
        switch self {
        case .program: return 10
        case .ripple: return 7
        }
    }

    func makeUniformStorage(
        inputs: AOSDesktopWorldNativeEffectInputs,
        segmentSize: CGSize
    ) -> [Float] {
        switch self {
        case .program(let instance):
            return [
                Float(inputs.origin.x), Float(inputs.origin.y),
                Float(inputs.current.x), Float(inputs.current.y),
                Float(inputs.delta.x), Float(inputs.delta.y),
                Float(inputs.totalDelta.x), Float(inputs.totalDelta.y),
                Float(segmentSize.width), Float(segmentSize.height),
                0,
            ] + instance.parameterValues.map(Float.init)
        case .ripple(let parameters):
            let envelopeWidth = min(180, max(24, parameters.radius * 0.08))
            return [
                Float(inputs.current.x), Float(inputs.current.y),
                Float(segmentSize.width), Float(segmentSize.height),
                Float(parameters.amplitude), Float(parameters.decay),
                Float(envelopeWidth), 0,
                Float(parameters.frequency), Float(parameters.radius),
                Float(parameters.speed),
            ]
        }
    }
}

@MainActor
final class AOSDesktopWorldNativeEffectRenderer: NSObject, MTKViewDelegate {
    private let context: AOSDesktopWorldNativeEffectGPUContext
    private let duration: TimeInterval
    private let inputs: AOSDesktopWorldNativeEffectInputs
    private let mesh: DesktopWorldNativeSheetMesh
    private let pipeline: MTLRenderPipelineState
    private let plan: AOSDesktopWorldNativeEffectRenderPlan
    private var uniforms: [Float]
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
        inputs: AOSDesktopWorldNativeEffectInputs,
        plan: AOSDesktopWorldNativeEffectRenderPlan,
        startedAt: TimeInterval
    ) throws {
        self.context = context
        self.duration = plan.duration
        self.inputs = inputs
        self.mesh = mesh
        self.pipeline = try plan.pipeline(context: context)
        self.plan = plan
        self.startedAt = startedAt
        self.uniforms = plan.makeUniformStorage(
            inputs: inputs,
            segmentSize: mesh.worldBounds.size
        )
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
              let descriptor = view.currentRenderPassDescriptor,
              let drawable = view.currentDrawable,
              let commandBuffer = commandQueue.makeCommandBuffer(),
              let encoder = commandBuffer.makeRenderCommandEncoder(
                descriptor: descriptor
              ) else {
            return
        }
        uniforms[plan.elapsedUniformIndex] = Float(elapsed)
        encoder.setRenderPipelineState(pipeline)
        encoder.setVertexBuffer(vertexBuffer, offset: 0, index: 0)
        encoder.setFragmentTexture(texture, index: 0)
        uniforms.withUnsafeBytes { bytes in
            if let address = bytes.baseAddress {
                encoder.setFragmentBytes(
                    address,
                    length: bytes.count,
                    index: 0
                )
            }
        }
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
final class AOSDesktopWorldNativeEffectRuntime {
    private let context: AOSDesktopWorldNativeEffectGPUContext
    private var renderers: [UInt32: AOSDesktopWorldNativeEffectRenderer] = [:]
    private let sheet: DesktopWorldNativeSheet
    private var disposed = false

    init(
        sheet: DesktopWorldNativeSheet,
        context: AOSDesktopWorldNativeEffectGPUContext,
        frames: AOSDesktopPixelFrameSet,
        inputs: AOSDesktopWorldNativeEffectInputs,
        definition: AOSDesktopWorldNativeEffectDefinition
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
        let plan = AOSDesktopWorldNativeEffectRenderPlan(definition: definition)
        let startedAt = ProcessInfo.processInfo.systemUptime
        do {
            for segment in sheet.segmentSheets {
                guard let pixelBuffer = framesByDisplay[segment.displayID]?.pixelBuffer else {
                    throw DesktopWorldNativeSheetFailure.frameSetIncomplete
                }
                renderers[segment.displayID] = try AOSDesktopWorldNativeEffectRenderer(
                    view: segment.host.view,
                    context: context,
                    mesh: segment.mesh,
                    pixelBuffer: pixelBuffer,
                    inputs: inputs,
                    plan: plan,
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

    var retainedBufferCount: Int { sheet.retainedGeometryBufferCount }

    var retainedViewCount: Int {
        sheet.segmentSheets.reduce(0) { $0 + $1.host.retainedViewCount }
    }
}

extension AOSDesktopWorldNativeEffectRuntime:
    AOSDesktopWorldNativeFeedbackRuntime
{}
