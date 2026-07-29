import CoreGraphics
import Foundation

enum AOSDesktopWorldNativeEffectProgramCompiler {
    static let uniformPrefixCount = 11
    static let uniformPrefixCountV2 = 17

    private struct ExpressionContext {
        let surfacePosition: String?
        let surfaceSize: String
        let surfaceUV: String
        let uniformPrefixCount: Int
        let worldPosition: String
    }

    private struct GraphSource {
        let nodeVariables: [String: String]
        let statements: String
    }

    static func source(
        for program: AOSDesktopWorldNativeEffectProgram
    ) -> String? {
        switch program.version {
        case .v1: return sourceV1(for: program)
        case .v2: return sourceV2(for: program)
        }
    }

    static func uniformStorage(
        for instance: AOSDesktopWorldNativeEffectProgramInstance,
        eventCurrent: CGPoint,
        eventDelta: CGPoint,
        eventOrigin: CGPoint,
        eventTotalDelta: CGPoint,
        globalBounds: CGRect,
        segmentBounds: CGRect
    ) -> [Float] {
        let common: [Float] = [
            Float(eventOrigin.x), Float(eventOrigin.y),
            Float(eventCurrent.x), Float(eventCurrent.y),
            Float(eventDelta.x), Float(eventDelta.y),
            Float(eventTotalDelta.x), Float(eventTotalDelta.y),
            Float(segmentBounds.size.width), Float(segmentBounds.size.height),
            0,
        ]
        let geometry: [Float]
        if instance.program.version == .v2 {
            geometry = [
                Float(segmentBounds.origin.x), Float(segmentBounds.origin.y),
                Float(globalBounds.origin.x), Float(globalBounds.origin.y),
                Float(globalBounds.size.width), Float(globalBounds.size.height),
            ]
        } else {
            geometry = []
        }
        return common + geometry + instance.parameterValues.map(Float.init)
    }

    private static func sourceV1(
        for program: AOSDesktopWorldNativeEffectProgram
    ) -> String? {
        let parameterIndexes = parameterIndexes(for: program)
        let context = ExpressionContext(
            surfacePosition: nil,
            surfaceSize: "float2(uniforms[8], uniforms[9])",
            surfaceUV: "input.uv",
            uniformPrefixCount: uniformPrefixCount,
            worldPosition: "input.worldPosition"
        )
        guard let graph = graph(
            for: program,
            context: context,
            parameterIndexes: parameterIndexes,
            outputs: [program.displacementOutput, program.opacityOutput]
        ),
              let displacement = reference(
                program.displacementOutput,
                context: context,
                parameterIndexes: parameterIndexes,
                nodeVariables: graph.nodeVariables
              ),
              let opacity = reference(
                program.opacityOutput,
                context: context,
                parameterIndexes: parameterIndexes,
                nodeVariables: graph.nodeVariables
              ) else {
            return nil
        }
        return #"""
#include <metal_stdlib>
using namespace metal;

\#(commonMetalSource)

struct NativeEffectVertexOut {
    float4 position [[position]];
    float2 uv;
    float2 worldPosition;
};

vertex NativeEffectVertexOut desktopWorldNativeProgramVertex(
    const device NativeSheetVertex *vertices [[buffer(0)]],
    uint vertexID [[vertex_id]]
) {
    NativeSheetVertex sheetVertex = vertices[vertexID];
    NativeEffectVertexOut output;
    output.position = sheetVertex.clipPosition;
    output.worldPosition = sheetVertex.worldAndUV.xy;
    output.uv = sheetVertex.worldAndUV.zw;
    return output;
}

fragment float4 desktopWorldNativeProgramFragment(
    NativeEffectVertexOut input [[stage_in]],
    texture2d<float> desktop [[texture(0)]],
    constant float *uniforms [[buffer(0)]]
) {
    constexpr sampler sampleFilter(address::clamp_to_edge, filter::linear);
\#(graph.statements)
    float2 displacement = \#(displacement);
    if (!all(isfinite(displacement))) {
        displacement = float2(0.0);
    }
    float displacementLength = length(displacement);
    if (displacementLength > \#(scalar(AOSDesktopWorldNativeEffectProgram.maximumTextureDisplacement))) {
        displacement *= \#(scalar(AOSDesktopWorldNativeEffectProgram.maximumTextureDisplacement)) / displacementLength;
    }
    float2 uvOffset = safeVectorDivide(
        displacement,
        float2(uniforms[8], uniforms[9])
    );
    float rawOpacity = \#(opacity);
    float effectAlpha = isfinite(rawOpacity) ? clamp(rawOpacity, 0.0, 1.0) : 0.0;
    if (effectAlpha < 0.001) {
        discard_fragment();
    }
    float3 color = desktop.sample(sampleFilter, input.uv + uvOffset).rgb;
    return float4(color * effectAlpha, effectAlpha);
}
"""#
    }

    private static func sourceV2(
        for program: AOSDesktopWorldNativeEffectProgram
    ) -> String? {
        guard let material = program.material,
              let positionOutput = program.positionOffsetOutput else {
            return nil
        }
        let parameterIndexes = parameterIndexes(for: program)
        let context = ExpressionContext(
            surfacePosition: "surfacePosition",
            surfaceSize: "float2(uniforms[15], uniforms[16])",
            surfaceUV: "surfaceUV",
            uniformPrefixCount: uniformPrefixCountV2,
            worldPosition: "worldPosition"
        )
        guard let positionGraph = graph(
            for: program,
            context: context,
            parameterIndexes: parameterIndexes,
            outputs: [positionOutput]
        ),
              let positionOffset = reference(
                positionOutput,
                context: context,
                parameterIndexes: parameterIndexes,
                nodeVariables: positionGraph.nodeVariables
              ),
              let fragmentGraph = graph(
                for: program,
                context: context,
                parameterIndexes: parameterIndexes,
                outputs: [program.displacementOutput, program.opacityOutput]
              ),
              let textureDisplacement = reference(
                program.displacementOutput,
                context: context,
                parameterIndexes: parameterIndexes,
                nodeVariables: fragmentGraph.nodeVariables
              ),
              let opacity = reference(
                program.opacityOutput,
                context: context,
                parameterIndexes: parameterIndexes,
                nodeVariables: fragmentGraph.nodeVariables
              ) else {
            return nil
        }
        let lightDirection = material.lightDirection.map(scalar)
        let lighting = material.lighting == .unlit
            ? "1.0"
            : "clamp(\(scalar(material.ambient)) + \(scalar(material.diffuse)) * max(dot(safeNormalize(input.normal), safeNormalize(float3(\(lightDirection.joined(separator: ", "))))), 0.0), 0.0, 2.0)"
        return #"""
#include <metal_stdlib>
using namespace metal;

\#(commonMetalSource)

struct NativeEffectFragmentEvaluation {
    float opacity;
    float2 textureDisplacement;
};

struct NativeEffectVertexOut {
    float4 position [[position]];
    float2 textureUV;
    float2 worldPosition;
    float3 normal;
};

float2 globalSurfaceUV(float2 worldPosition, constant float *uniforms) {
    float2 globalOrigin = float2(uniforms[13], uniforms[14]);
    float2 globalSize = max(float2(uniforms[15], uniforms[16]), float2(1.0));
    return (worldPosition - globalOrigin) / globalSize;
}

float3 evaluateNativePositionOffset(
    float2 worldPosition,
    float2 surfaceUV,
    float3 surfacePosition,
    constant float *uniforms
) {
\#(positionGraph.statements)
    float3 output = \#(positionOffset);
    if (!all(isfinite(output))) {
        output = float3(0.0);
    }
    float offsetLength = length(output);
    if (offsetLength > \#(scalar(AOSDesktopWorldNativeEffectProgram.maximumPositionOffset))) {
        output *= \#(scalar(AOSDesktopWorldNativeEffectProgram.maximumPositionOffset)) / offsetLength;
    }
    return output;
}

NativeEffectFragmentEvaluation evaluateNativeFragment(
    float2 worldPosition,
    float2 surfaceUV,
    float3 surfacePosition,
    constant float *uniforms
) {
\#(fragmentGraph.statements)
    NativeEffectFragmentEvaluation output;
    output.textureDisplacement = \#(textureDisplacement);
    if (!all(isfinite(output.textureDisplacement))) {
        output.textureDisplacement = float2(0.0);
    }
    float displacementLength = length(output.textureDisplacement);
    if (displacementLength > \#(scalar(AOSDesktopWorldNativeEffectProgram.maximumTextureDisplacement))) {
        output.textureDisplacement *= \#(scalar(AOSDesktopWorldNativeEffectProgram.maximumTextureDisplacement)) / displacementLength;
    }
    float rawOpacity = \#(opacity);
    output.opacity = isfinite(rawOpacity) ? clamp(rawOpacity, 0.0, 1.0) : 0.0;
    return output;
}

float3 deformedPosition(float2 worldPosition, constant float *uniforms) {
    float3 basePosition = float3(worldPosition, 0.0);
    return basePosition + evaluateNativePositionOffset(
        worldPosition,
        globalSurfaceUV(worldPosition, uniforms),
        basePosition,
        uniforms
    );
}

vertex NativeEffectVertexOut desktopWorldNativeProgramVertex(
    const device NativeSheetVertex *vertices [[buffer(0)]],
    constant float *uniforms [[buffer(1)]],
    uint vertexID [[vertex_id]]
) {
    NativeSheetVertex sheetVertex = vertices[vertexID];
    float2 worldPosition = sheetVertex.worldAndUV.xy;
    float3 deformed = deformedPosition(worldPosition, uniforms);
    float sampleDistance = \#(scalar(material.normalSampleDistance));
    float3 tangentX = deformedPosition(
        worldPosition + float2(sampleDistance, 0.0), uniforms
    ) - deformedPosition(
        worldPosition - float2(sampleDistance, 0.0), uniforms
    );
    float3 tangentY = deformedPosition(
        worldPosition + float2(0.0, sampleDistance), uniforms
    ) - deformedPosition(
        worldPosition - float2(0.0, sampleDistance), uniforms
    );
    float2 globalOrigin = float2(uniforms[13], uniforms[14]);
    float2 globalSize = max(float2(uniforms[15], uniforms[16]), float2(1.0));
    float2 globalCenter = globalOrigin + globalSize * 0.5;
    float perspectiveDistance = \#(scalar(material.perspectiveDistance));
    float perspectiveScale = clamp(
        perspectiveDistance / max(perspectiveDistance - deformed.z, perspectiveDistance * 0.1),
        0.25,
        4.0
    );
    float2 projected = globalCenter + (deformed.xy - globalCenter) * perspectiveScale;
    float2 segmentOrigin = float2(uniforms[11], uniforms[12]);
    float2 segmentSize = max(float2(uniforms[8], uniforms[9]), float2(1.0));
    float2 segmentUV = (projected - segmentOrigin) / segmentSize;
    NativeEffectVertexOut output;
    output.position = float4(
        segmentUV.x * 2.0 - 1.0,
        1.0 - segmentUV.y * 2.0,
        clamp(0.5 - deformed.z / (perspectiveDistance * 2.0), 0.0, 1.0),
        1.0
    );
    output.textureUV = sheetVertex.worldAndUV.zw;
    output.worldPosition = worldPosition;
    output.normal = safeNormalize(cross(tangentX, tangentY));
    return output;
}

fragment float4 desktopWorldNativeProgramFragment(
    NativeEffectVertexOut input [[stage_in]],
    texture2d<float> desktop [[texture(0)]],
    constant float *uniforms [[buffer(0)]]
) {
    constexpr sampler sampleFilter(address::clamp_to_edge, filter::linear);
    float3 surfacePosition = float3(input.worldPosition, 0.0);
    NativeEffectFragmentEvaluation evaluation = evaluateNativeFragment(
        input.worldPosition,
        globalSurfaceUV(input.worldPosition, uniforms),
        surfacePosition,
        uniforms
    );
    if (evaluation.opacity < 0.001) {
        discard_fragment();
    }
    float2 segmentSize = max(float2(uniforms[8], uniforms[9]), float2(1.0));
    float2 uvOffset = safeVectorDivide(evaluation.textureDisplacement, segmentSize);
    float3 color = desktop.sample(sampleFilter, input.textureUV + uvOffset).rgb;
    float light = \#(lighting);
    return float4(color * light * evaluation.opacity, evaluation.opacity);
}
"""#
    }

    private static func graph(
        for program: AOSDesktopWorldNativeEffectProgram,
        context: ExpressionContext,
        parameterIndexes: [String: Int],
        outputs: [String]
    ) -> GraphSource? {
        guard let requiredNodes = requiredNodeReferences(
            for: program,
            outputs: outputs
        ) else { return nil }
        var nodeVariables: [String: String] = [:]
        var nodeTypes: [String: AOSDesktopWorldNativeEffectValueType] = [:]
        var statements: [String] = []
        for (index, node) in program.nodes.enumerated() {
            let reference = "node.\(node.id)"
            guard requiredNodes.contains(reference) else { continue }
            let variable = "n\(index)"
            guard let expression = expression(
                for: node,
                context: context,
                parameterIndexes: parameterIndexes,
                nodeVariables: nodeVariables,
                nodeTypes: nodeTypes
            ) else { return nil }
            statements.append("    \(metalType(node.type)) \(variable) = \(expression);")
            nodeVariables[reference] = variable
            nodeTypes[reference] = node.type
        }
        return GraphSource(
            nodeVariables: nodeVariables,
            statements: statements.joined(separator: "\n")
        )
    }

    private static func requiredNodeReferences(
        for program: AOSDesktopWorldNativeEffectProgram,
        outputs: [String]
    ) -> Set<String>? {
        let nodesByReference = Dictionary(
            uniqueKeysWithValues: program.nodes.map { ("node.\($0.id)", $0) }
        )
        var required = Set<String>()
        var pending = outputs.filter { $0.hasPrefix("node.") }
        while let reference = pending.popLast() {
            guard required.insert(reference).inserted else { continue }
            guard let node = nodesByReference[reference] else { return nil }
            pending.append(contentsOf: node.inputs.filter { $0.hasPrefix("node.") })
        }
        return required
    }

    private static func expression(
        for node: AOSDesktopWorldNativeEffectProgramNode,
        context: ExpressionContext,
        parameterIndexes: [String: Int],
        nodeVariables: [String: String],
        nodeTypes: [String: AOSDesktopWorldNativeEffectValueType]
    ) -> String? {
        if node.operation == "constant" {
            guard let constant = node.constant else { return nil }
            return "\(metalType(node.type))(\(constant.map(scalar).joined(separator: ", ")))"
        }
        guard let operation = AOSDesktopWorldNativeEffectOperator(
            rawValue: node.operation
        ) else { return nil }
        let inputs = node.inputs.compactMap {
            reference(
                $0,
                context: context,
                parameterIndexes: parameterIndexes,
                nodeVariables: nodeVariables
            )
        }
        guard inputs.count == node.inputs.count else { return nil }
        switch operation {
        case .absolute: return "abs(\(inputs[0]))"
        case .add: return "(\(inputs[0]) + \(inputs[1]))"
        case .clamp01: return "clamp(\(inputs[0]), 0.0, 1.0)"
        case .componentX: return "(\(inputs[0]).x)"
        case .componentY: return "(\(inputs[0]).y)"
        case .componentZ: return "(\(inputs[0]).z)"
        case .compose2: return "float2(\(inputs[0]), \(inputs[1]))"
        case .compose3: return "float3(\(inputs[0]), \(inputs[1]), \(inputs[2]))"
        case .cosine: return "cos(\(inputs[0]))"
        case .distanceToSegment:
            return "pointSegmentDistance(\(inputs[0]), \(inputs[1]), \(inputs[2]))"
        case .divide:
            let denominatorType = type(of: node.inputs[1], nodeTypes: nodeTypes)
            if node.type == .scalar {
                return "safeScalarDivide(\(inputs[0]), \(inputs[1]))"
            }
            return denominatorType == .scalar
                ? "(\(inputs[0]) / safeScalarDenominator(\(inputs[1])))"
                : "safeVectorDivide(\(inputs[0]), \(inputs[1]))"
        case .dot: return "dot(\(inputs[0]), \(inputs[1]))"
        case .exponential: return "exp(clamp(\(inputs[0]), -32.0, 32.0))"
        case .length: return "length(\(inputs[0]))"
        case .maximum: return "max(\(inputs[0]), \(inputs[1]))"
        case .minimum: return "min(\(inputs[0]), \(inputs[1]))"
        case .mix: return "mix(\(inputs[0]), \(inputs[1]), \(inputs[2]))"
        case .multiply: return "(\(inputs[0]) * \(inputs[1]))"
        case .negate: return "(-\(inputs[0]))"
        case .normalize: return "safeNormalize(\(inputs[0]))"
        case .oneMinus: return "(1.0 - \(inputs[0]))"
        case .perpendicular: return "float2(-\(inputs[0]).y, \(inputs[0]).x)"
        case .sine: return "sin(\(inputs[0]))"
        case .smoothstep:
            return "smoothstep(\(inputs[0]), \(inputs[1]), \(inputs[2]))"
        case .subtract: return "(\(inputs[0]) - \(inputs[1]))"
        }
    }

    private static func reference(
        _ value: String,
        context: ExpressionContext,
        parameterIndexes: [String: Int],
        nodeVariables: [String: String]
    ) -> String? {
        switch value {
        case "clock.elapsed": return "uniforms[10]"
        case "event.current": return "float2(uniforms[2], uniforms[3])"
        case "event.delta": return "float2(uniforms[4], uniforms[5])"
        case "event.origin": return "float2(uniforms[0], uniforms[1])"
        case "event.total_delta": return "float2(uniforms[6], uniforms[7])"
        case "surface.position": return context.surfacePosition
        case "surface.size": return context.surfaceSize
        case "surface.uv": return context.surfaceUV
        case "world.position": return context.worldPosition
        default:
            if value.hasPrefix("parameter."),
               let index = parameterIndexes[String(value.dropFirst(10))] {
                return "uniforms[\(context.uniformPrefixCount + index)]"
            }
            return nodeVariables[value]
        }
    }

    private static func type(
        of reference: String,
        nodeTypes: [String: AOSDesktopWorldNativeEffectValueType]
    ) -> AOSDesktopWorldNativeEffectValueType? {
        if reference.hasPrefix("parameter.") || reference == "clock.elapsed" {
            return .scalar
        }
        if reference == "surface.position" { return .vector3 }
        if [
            "event.current", "event.delta", "event.origin", "event.total_delta",
            "surface.size", "surface.uv", "world.position",
        ].contains(reference) {
            return .vector2
        }
        return nodeTypes[reference]
    }

    private static func parameterIndexes(
        for program: AOSDesktopWorldNativeEffectProgram
    ) -> [String: Int] {
        Dictionary(uniqueKeysWithValues:
            program.parameters.enumerated().map { ($0.element.id, $0.offset) }
        )
    }

    private static func metalType(
        _ type: AOSDesktopWorldNativeEffectValueType
    ) -> String {
        switch type {
        case .scalar: return "float"
        case .vector2: return "float2"
        case .vector3: return "float3"
        }
    }

    private static func scalar(_ value: Double) -> String {
        String(format: "%.9g", locale: Locale(identifier: "en_US_POSIX"), value)
    }

    private static let commonMetalSource = #"""
struct NativeSheetVertex {
    float4 clipPosition;
    float4 worldAndUV;
};

float safeScalarDenominator(float denominator) {
    float safe = max(abs(denominator), 0.000001);
    return denominator < 0.0 ? -safe : safe;
}

float safeScalarDivide(float numerator, float denominator) {
    return numerator / safeScalarDenominator(denominator);
}

float2 safeVectorDivide(float2 numerator, float2 denominator) {
    float2 safe = max(abs(denominator), float2(0.000001));
    return numerator / select(safe, -safe, denominator < float2(0.0));
}

float3 safeVectorDivide(float3 numerator, float3 denominator) {
    float3 safe = max(abs(denominator), float3(0.000001));
    return numerator / select(safe, -safe, denominator < float3(0.0));
}

float2 safeNormalize(float2 value) {
    float magnitude = length(value);
    return magnitude > 0.000001 ? value / magnitude : float2(0.0);
}

float3 safeNormalize(float3 value) {
    float magnitude = length(value);
    return magnitude > 0.000001 ? value / magnitude : float3(0.0, 0.0, 1.0);
}

float pointSegmentDistance(float2 point, float2 start, float2 end) {
    float2 segment = end - start;
    float denominator = max(dot(segment, segment), 0.000001);
    float t = clamp(dot(point - start, segment) / denominator, 0.0, 1.0);
    return length(point - (start + segment * t));
}
"""#
}
