import CoreFoundation
import CryptoKit
import Foundation

enum AOSDesktopWorldNativeEffectValueType: String, Equatable, Hashable {
    case scalar
    case vector2
}

enum AOSDesktopWorldNativeEffectOperator: String, Equatable {
    case absolute
    case add
    case clamp01
    case cosine
    case distanceToSegment = "distance_to_segment"
    case divide
    case dot
    case exponential
    case length
    case maximum
    case minimum
    case mix
    case multiply
    case negate
    case normalize
    case oneMinus = "one_minus"
    case perpendicular
    case sine
    case smoothstep
    case subtract
}

struct AOSDesktopWorldNativeEffectProgramParameter: Equatable {
    let defaultValue: Double
    let id: String
    let maximum: Double
    let minimum: Double
}

struct AOSDesktopWorldNativeEffectProgramNode: Equatable {
    let constant: [Double]?
    let id: String
    let inputs: [String]
    let operation: String
    let type: AOSDesktopWorldNativeEffectValueType
}

struct AOSDesktopWorldNativeEffectProgram: Equatable {
    static let contract = "aos.scene.native-effect-program.v1"
    static let implementation = "aos.scene.effect.program"
    static let maximumConstantMagnitude = 1_000_000.0
    static let maximumDurationMilliseconds = 3_000
    static let maximumNodes = 64
    static let maximumParameters = 16
    static let maximumPreparedPrograms = 32
    static let maximumSerializedBytes = 32_768
    static let maximumTranscendentalOperations = 16
    static let minimumDurationMilliseconds = 100

    let digest: String
    let durationMilliseconds: Int
    let id: String
    let nodes: [AOSDesktopWorldNativeEffectProgramNode]
    let displacementOutput: String
    let opacityOutput: String
    let parameters: [AOSDesktopWorldNativeEffectProgramParameter]
    let revision: Int
}

struct AOSDesktopWorldNativeEffectProgramInstance: Equatable {
    let parameterValues: [Double]
    let program: AOSDesktopWorldNativeEffectProgram
}

enum AOSDesktopWorldNativeEffectProgramContract {
    private static let builtins: [String: AOSDesktopWorldNativeEffectValueType] = [
        "clock.elapsed": .scalar,
        "event.current": .vector2,
        "event.delta": .vector2,
        "event.origin": .vector2,
        "event.total_delta": .vector2,
        "surface.size": .vector2,
        "surface.uv": .vector2,
        "world.position": .vector2,
    ]

    static func parse(
        program value: [String: Any],
        parameters parameterValues: [String: Any]
    ) -> AOSDesktopWorldNativeEffectProgramInstance? {
        guard let program = parse(program: value) else { return nil }
        return instantiate(program: program, parameters: parameterValues)
    }

    static func parse(
        program value: [String: Any]
    ) -> AOSDesktopWorldNativeEffectProgram? {
        guard Set(value.keys) == Set([
            "contract", "durationMs", "id", "nodes", "outputs", "parameters",
            "revision", "schemaVersion",
        ]),
              value["contract"] as? String == AOSDesktopWorldNativeEffectProgram.contract,
              integer(value["schemaVersion"]) == 1,
              let id = value["id"] as? String,
              canonicalID(id),
              let revision = integer(value["revision"]),
              revision >= 1,
              revision <= Int32.max,
              let duration = integer(value["durationMs"]),
              duration >= AOSDesktopWorldNativeEffectProgram.minimumDurationMilliseconds,
              duration <= AOSDesktopWorldNativeEffectProgram.maximumDurationMilliseconds,
              let rawParameters = value["parameters"] as? [[String: Any]],
              rawParameters.count <= AOSDesktopWorldNativeEffectProgram.maximumParameters,
              let rawNodes = value["nodes"] as? [[String: Any]],
              !rawNodes.isEmpty,
              rawNodes.count <= AOSDesktopWorldNativeEffectProgram.maximumNodes,
              let outputs = value["outputs"] as? [String: Any],
              Set(outputs.keys) == Set(["displacement", "opacity"]),
              let displacementOutput = outputs["displacement"] as? String,
              let opacityOutput = outputs["opacity"] as? String,
              transcendentalCount(rawNodes)
                <= AOSDesktopWorldNativeEffectProgram.maximumTranscendentalOperations else {
            return nil
        }

        var types = builtins
        var parameters: [AOSDesktopWorldNativeEffectProgramParameter] = []
        for raw in rawParameters {
            guard Set(raw.keys) == Set(["default", "id", "max", "min"]),
                  let parameterID = raw["id"] as? String,
                  localID(parameterID),
                  types["parameter.\(parameterID)"] == nil,
                  let defaultValue = finiteDouble(raw["default"]),
                  let minimum = finiteDouble(raw["min"]),
                  let maximum = finiteDouble(raw["max"]),
                  boundedMagnitude(defaultValue),
                  boundedMagnitude(minimum),
                  boundedMagnitude(maximum),
                  minimum <= defaultValue,
                  defaultValue <= maximum else {
                return nil
            }
            parameters.append(.init(
                defaultValue: defaultValue,
                id: parameterID,
                maximum: maximum,
                minimum: minimum
            ))
            types["parameter.\(parameterID)"] = .scalar
        }

        var nodes: [AOSDesktopWorldNativeEffectProgramNode] = []
        for raw in rawNodes {
            guard let node = parseNode(raw, types: &types) else { return nil }
            nodes.append(node)
        }
        guard types[opacityOutput] == .scalar,
              types[displacementOutput] == .vector2,
              let digest = digest(value) else {
            return nil
        }

        return AOSDesktopWorldNativeEffectProgram(
            digest: digest,
            durationMilliseconds: duration,
            id: id,
            nodes: nodes,
            displacementOutput: displacementOutput,
            opacityOutput: opacityOutput,
            parameters: parameters,
            revision: revision
        )
    }

    static func instantiate(
        program: AOSDesktopWorldNativeEffectProgram,
        parameters parameterValues: [String: Any]
    ) -> AOSDesktopWorldNativeEffectProgramInstance? {
        let declarations = Dictionary(
            uniqueKeysWithValues: program.parameters.map { ($0.id, $0) }
        )
        guard Set(parameterValues.keys).isSubset(of: Set(declarations.keys)) else {
            return nil
        }
        var resolved: [Double] = []
        for parameter in program.parameters {
            let candidate = parameterValues[parameter.id]
            guard let number = candidate == nil
                ? parameter.defaultValue
                : finiteDouble(candidate),
                  (parameter.minimum...parameter.maximum).contains(number) else {
                return nil
            }
            resolved.append(number)
        }
        return AOSDesktopWorldNativeEffectProgramInstance(
            parameterValues: resolved,
            program: program
        )
    }

    private static func parseNode(
        _ value: [String: Any],
        types: inout [String: AOSDesktopWorldNativeEffectValueType]
    ) -> AOSDesktopWorldNativeEffectProgramNode? {
        guard let id = value["id"] as? String,
              localID(id),
              let operation = value["op"] as? String else {
            return nil
        }
        let reference = "node.\(id)"
        guard types[reference] == nil else { return nil }
        if operation == "constant" {
            guard Set(value.keys) == Set(["id", "op", "value"]),
                  let constant = constant(value["value"]) else {
                return nil
            }
            let type: AOSDesktopWorldNativeEffectValueType = constant.count == 1
                ? .scalar
                : .vector2
            types[reference] = type
            return .init(
                constant: constant,
                id: id,
                inputs: [],
                operation: operation,
                type: type
            )
        }
        guard Set(value.keys) == Set(["id", "inputs", "op"]),
              let known = AOSDesktopWorldNativeEffectOperator(rawValue: operation),
              let inputs = value["inputs"] as? [String],
              (1...3).contains(inputs.count) else {
            return nil
        }
        let inputTypes = inputs.compactMap { types[$0] }
        guard inputTypes.count == inputs.count,
              let type = outputType(known, inputs: inputTypes) else {
            return nil
        }
        types[reference] = type
        return .init(
            constant: nil,
            id: id,
            inputs: inputs,
            operation: operation,
            type: type
        )
    }

    private static func outputType(
        _ operation: AOSDesktopWorldNativeEffectOperator,
        inputs: [AOSDesktopWorldNativeEffectValueType]
    ) -> AOSDesktopWorldNativeEffectValueType? {
        switch operation {
        case .add, .subtract, .minimum, .maximum:
            return inputs.count == 2 && inputs[0] == inputs[1] ? inputs[0] : nil
        case .multiply:
            guard inputs.count == 2 else { return nil }
            if inputs[0] == inputs[1] { return inputs[0] }
            return Set(inputs) == Set([.scalar, .vector2]) ? .vector2 : nil
        case .divide:
            guard inputs.count == 2 else { return nil }
            if inputs == [.scalar, .scalar] { return .scalar }
            return inputs[0] == .vector2 && [.scalar, .vector2].contains(inputs[1])
                ? .vector2
                : nil
        case .length:
            return inputs == [.vector2] ? .scalar : nil
        case .normalize, .perpendicular:
            return inputs == [.vector2] ? .vector2 : nil
        case .absolute, .clamp01, .cosine, .exponential, .negate, .oneMinus, .sine:
            return inputs == [.scalar] ? .scalar : nil
        case .dot:
            return inputs == [.vector2, .vector2] ? .scalar : nil
        case .smoothstep:
            return inputs == [.scalar, .scalar, .scalar] ? .scalar : nil
        case .distanceToSegment:
            return inputs == [.vector2, .vector2, .vector2] ? .scalar : nil
        case .mix:
            return inputs.count == 3
                && inputs[0] == inputs[1]
                && inputs[2] == .scalar
                ? inputs[0]
                : nil
        }
    }

    private static func constant(_ value: Any?) -> [Double]? {
        if let scalar = finiteDouble(value), boundedMagnitude(scalar) {
            return [scalar]
        }
        guard let values = value as? [Any], values.count == 2 else { return nil }
        let scalars = values.compactMap(finiteDouble)
        return scalars.count == 2 && scalars.allSatisfy(boundedMagnitude) ? scalars : nil
    }

    private static func digest(_ value: [String: Any]) -> String? {
        guard JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
              data.count <= AOSDesktopWorldNativeEffectProgram.maximumSerializedBytes else {
            return nil
        }
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private static func transcendentalCount(
        _ nodes: [[String: Any]]
    ) -> Int {
        let expensive = Set(["cosine", "exponential", "sine", "smoothstep"])
        return nodes.reduce(0) { count, node in
            count + (expensive.contains(node["op"] as? String ?? "") ? 1 : 0)
        }
    }

    private static func finiteDouble(_ value: Any?) -> Double? {
        guard let number = value as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        let result = number.doubleValue
        return result.isFinite ? result : nil
    }

    private static func integer(_ value: Any?) -> Int? {
        guard let number = value as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        let result = number.doubleValue
        guard result.isFinite,
              result.rounded(.towardZero) == result,
              result >= Double(Int.min),
              result <= Double(Int.max) else {
            return nil
        }
        return Int(result)
    }

    private static func boundedMagnitude(_ value: Double) -> Bool {
        abs(value) <= AOSDesktopWorldNativeEffectProgram.maximumConstantMagnitude
    }

    private static func localID(_ value: String) -> Bool {
        canonicalID(value) && !value.contains("/")
    }

    private static func canonicalID(_ value: String) -> Bool {
        let bytes = Array(value.utf8)
        guard !bytes.isEmpty, bytes.count <= 128 else { return false }
        let isAlphanumeric: (UInt8) -> Bool = { byte in
            (byte >= 0x30 && byte <= 0x39) || (byte >= 0x61 && byte <= 0x7a)
        }
        guard isAlphanumeric(bytes[0]), isAlphanumeric(bytes[bytes.count - 1]) else {
            return false
        }
        guard bytes.allSatisfy({ byte in
            let alphanumeric = (byte >= 0x30 && byte <= 0x39)
                || (byte >= 0x61 && byte <= 0x7a)
            return alphanumeric || [0x2d, 0x2e, 0x2f, 0x5f].contains(byte)
        }) else { return false }
        return !value.contains("//")
            && !value.split(separator: "/", omittingEmptySubsequences: false)
                .contains(where: { $0 == "." || $0 == ".." || $0.isEmpty })
    }
}
