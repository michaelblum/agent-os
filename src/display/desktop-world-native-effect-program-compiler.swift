import Foundation

enum AOSDesktopWorldNativeEffectProgramCompiler {
    static let uniformPrefixCount = 11

    static func source(
        for program: AOSDesktopWorldNativeEffectProgram
    ) -> String? {
        let parameterIndexes = Dictionary(uniqueKeysWithValues:
            program.parameters.enumerated().map { ($0.element.id, $0.offset) }
        )
        var nodeVariables: [String: String] = [:]
        var nodeTypes: [String: AOSDesktopWorldNativeEffectValueType] = [:]
        var statements: [String] = []
        for (index, node) in program.nodes.enumerated() {
            let variable = "n\(index)"
            let type = node.type == .scalar ? "float" : "float2"
            guard let expression = expression(
                for: node,
                parameterIndexes: parameterIndexes,
                nodeVariables: nodeVariables,
                nodeTypes: nodeTypes
            ) else { return nil }
            statements.append("    \(type) \(variable) = \(expression);")
            nodeVariables["node.\(node.id)"] = variable
            nodeTypes["node.\(node.id)"] = node.type
        }
        guard let displacement = reference(
            program.displacementOutput,
            parameterIndexes: parameterIndexes,
            nodeVariables: nodeVariables
        ),
              let opacity = reference(
                program.opacityOutput,
                parameterIndexes: parameterIndexes,
                nodeVariables: nodeVariables
              ) else {
            return nil
        }
        return #"""
#include <metal_stdlib>
using namespace metal;

struct NativeSheetVertex {
    float4 clipPosition;
    float4 worldAndUV;
};

struct NativeEffectVertexOut {
    float4 position [[position]];
    float2 uv;
    float2 worldPosition;
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

float2 safeNormalize(float2 value) {
    float magnitude = length(value);
    return magnitude > 0.000001 ? value / magnitude : float2(0.0);
}

float pointSegmentDistance(float2 point, float2 start, float2 end) {
    float2 segment = end - start;
    float denominator = max(dot(segment, segment), 0.000001);
    float t = clamp(dot(point - start, segment) / denominator, 0.0, 1.0);
    return length(point - (start + segment * t));
}

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
\#(statements.joined(separator: "\n"))
    float2 displacement = \#(displacement);
    if (!all(isfinite(displacement))) {
        displacement = float2(0.0);
    }
    float displacementLength = length(displacement);
    if (displacementLength > 96.0) {
        displacement *= 96.0 / displacementLength;
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

    private static func expression(
        for node: AOSDesktopWorldNativeEffectProgramNode,
        parameterIndexes: [String: Int],
        nodeVariables: [String: String],
        nodeTypes: [String: AOSDesktopWorldNativeEffectValueType]
    ) -> String? {
        if node.operation == "constant" {
            guard let constant = node.constant else { return nil }
            return constant.count == 1
                ? scalar(constant[0])
                : "float2(\(scalar(constant[0])), \(scalar(constant[1])))"
        }
        guard let operation = AOSDesktopWorldNativeEffectOperator(
            rawValue: node.operation
        ) else { return nil }
        let inputs = node.inputs.compactMap {
            reference(
                $0,
                parameterIndexes: parameterIndexes,
                nodeVariables: nodeVariables
            )
        }
        guard inputs.count == node.inputs.count else { return nil }
        switch operation {
        case .absolute: return "abs(\(inputs[0]))"
        case .add: return "(\(inputs[0]) + \(inputs[1]))"
        case .clamp01: return "clamp(\(inputs[0]), 0.0, 1.0)"
        case .cosine: return "cos(\(inputs[0]))"
        case .distanceToSegment:
            return "pointSegmentDistance(\(inputs[0]), \(inputs[1]), \(inputs[2]))"
        case .divide:
            let denominatorType = type(
                of: node.inputs[1],
                nodeTypes: nodeTypes
            )
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
        parameterIndexes: [String: Int],
        nodeVariables: [String: String]
    ) -> String? {
        switch value {
        case "clock.elapsed": return "uniforms[10]"
        case "event.current": return "float2(uniforms[2], uniforms[3])"
        case "event.delta": return "float2(uniforms[4], uniforms[5])"
        case "event.origin": return "float2(uniforms[0], uniforms[1])"
        case "event.total_delta": return "float2(uniforms[6], uniforms[7])"
        case "surface.size": return "float2(uniforms[8], uniforms[9])"
        case "surface.uv": return "input.uv"
        case "world.position": return "input.worldPosition"
        default:
            if value.hasPrefix("parameter."),
               let index = parameterIndexes[String(value.dropFirst(10))] {
                return "uniforms[\(uniformPrefixCount + index)]"
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
        if [
            "event.current", "event.delta", "event.origin", "event.total_delta",
            "surface.size", "surface.uv", "world.position",
        ].contains(reference) {
            return .vector2
        }
        return nodeTypes[reference]
    }

    private static func scalar(_ value: Double) -> String {
        String(format: "%.9g", locale: Locale(identifier: "en_US_POSIX"), value)
    }
}
