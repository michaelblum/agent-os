import CoreFoundation
import CryptoKit
import Foundation

enum AOSDesktopWorldNativeEffectValueType: String, Equatable, Hashable {
    case scalar
    case vector2
    case vector3
}

enum AOSDesktopWorldNativeEffectOperator: String, Equatable {
    case absolute
    case add
    case clamp01
    case componentX = "component_x"
    case componentY = "component_y"
    case componentZ = "component_z"
    case compose2
    case compose3
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

enum AOSDesktopWorldNativeEffectProgramVersion: Int, Equatable {
    case v1 = 1
    case v2 = 2
}

struct AOSDesktopWorldNativeEffectProgramMaterial: Equatable {
    enum Lighting: String, Equatable {
        case lambert
        case standard
        case unlit
    }

    let ambient: Double
    let diffuse: Double
    let fresnel: Double
    let lightDirection: [Double]
    let lighting: Lighting
    let normalSampleDistance: Double
    let perspectiveDistance: Double
    let refraction: Double
    let roughness: Double
    let specular: Double
}

struct AOSDesktopWorldNativeEffectProgramGeometry: Equatable {
    enum Kind: String, Equatable {
        case eventEndpoints = "event_endpoints"
        case eventPoint = "event_point"
        case eventSegment = "event_segment"
        case surface
    }

    let cellSize: Double
    let extent: Double
    let kind: Kind
    let padding: Double
}

struct AOSDesktopWorldNativeEffectProgram: Equatable {
    static let contract = "aos.scene.native-effect-program.v1"
    static let contractV2 = "aos.scene.native-effect-program.v2"
    static let digestContract = "aos.scene.native-effect-program-digest.v1"
    static let implementation = "aos.scene.effect.program"
    static let maximumConstantMagnitude = 1_000_000.0
    static let maximumDurationMilliseconds = 3_000
    static let maximumGeometryCellSize = 64.0
    static let maximumGeometryExtent = 5_000.0
    static let maximumGeometryPadding = 512.0
    static let maximumNodes = 64
    static let maximumNormalSampleDistance = 64.0
    static let maximumParameters = 16
    static let maximumPerspectiveDistance = 20_000.0
    static let maximumPositionOffset = 512.0
    static let maximumPreparedPrograms = 32
    static let maximumSerializedBytes = 32_768
    static let maximumTextureDisplacement = 96.0
    static let maximumTranscendentalOperations = 16
    static let minimumDurationMilliseconds = 100
    static let minimumGeometryCellSize = 2.0
    static let minimumNormalSampleDistance = 0.25
    static let minimumPerspectiveDistance = 256.0

    let digest: String
    let durationMilliseconds: Int
    let geometry: AOSDesktopWorldNativeEffectProgramGeometry?
    let id: String
    let material: AOSDesktopWorldNativeEffectProgramMaterial?
    let nodes: [AOSDesktopWorldNativeEffectProgramNode]
    let displacementOutput: String
    let opacityOutput: String
    let parameters: [AOSDesktopWorldNativeEffectProgramParameter]
    let positionOffsetOutput: String?
    let revision: Int
    let version: AOSDesktopWorldNativeEffectProgramVersion
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
        guard let contract = value["contract"] as? String else { return nil }
        let version: AOSDesktopWorldNativeEffectProgramVersion
        switch contract {
        case AOSDesktopWorldNativeEffectProgram.contract:
            version = .v1
        case AOSDesktopWorldNativeEffectProgram.contractV2:
            version = .v2
        default:
            return nil
        }
        let expectedKeys = Set([
            "contract", "durationMs", "id", "nodes", "outputs", "parameters",
            "revision", "schemaVersion",
        ] + (version == .v2 ? ["geometry", "material"] : []))
        let actualKeys = Set(value.keys)
        let requiredKeys = version == .v2
            ? expectedKeys.subtracting(["geometry"])
            : expectedKeys
        let expectedOutputKeys = version == .v2
            ? Set(["opacity", "positionOffset", "textureDisplacement"])
            : Set(["displacement", "opacity"])
        guard requiredKeys.isSubset(of: actualKeys),
              actualKeys.isSubset(of: expectedKeys),
              integer(value["schemaVersion"]) == version.rawValue,
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
              Set(outputs.keys) == expectedOutputKeys,
              let displacementOutput = outputs[
                version == .v2 ? "textureDisplacement" : "displacement"
              ] as? String,
              let opacityOutput = outputs["opacity"] as? String,
              transcendentalCount(rawNodes)
                <= AOSDesktopWorldNativeEffectProgram.maximumTranscendentalOperations else {
            return nil
        }

        var types = builtins
        if version == .v2 {
            types["surface.position"] = .vector3
        }
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
            guard let node = parseNode(
                raw,
                types: &types,
                allowVector3: version == .v2
            ) else { return nil }
            nodes.append(node)
        }
        let positionOffsetOutput = outputs["positionOffset"] as? String
        let geometry = version == .v2 ? parseGeometry(value["geometry"]) : nil
        let material = version == .v2 ? parseMaterial(value["material"]) : nil
        guard types[opacityOutput] == .scalar,
              types[displacementOutput] == .vector2,
              version != .v2 || types[positionOffsetOutput ?? ""] == .vector3,
              version != .v2 || value["geometry"] == nil || geometry != nil,
              version != .v2 || material != nil,
              let digest = digest(value) else {
            return nil
        }

        return AOSDesktopWorldNativeEffectProgram(
            digest: digest,
            durationMilliseconds: duration,
            geometry: geometry,
            id: id,
            material: material,
            nodes: nodes,
            displacementOutput: displacementOutput,
            opacityOutput: opacityOutput,
            parameters: parameters,
            positionOffsetOutput: positionOffsetOutput,
            revision: revision,
            version: version
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
        types: inout [String: AOSDesktopWorldNativeEffectValueType],
        allowVector3: Bool
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
                  let constant = constant(value["value"], allowVector3: allowVector3) else {
                return nil
            }
            let type: AOSDesktopWorldNativeEffectValueType
            switch constant.count {
            case 1: type = .scalar
            case 2: type = .vector2
            case 3: type = .vector3
            default: return nil
            }
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
              let type = outputType(
                known,
                inputs: inputTypes,
                allowVector3: allowVector3
              ) else {
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
        inputs: [AOSDesktopWorldNativeEffectValueType],
        allowVector3: Bool
    ) -> AOSDesktopWorldNativeEffectValueType? {
        switch operation {
        case .add, .subtract, .minimum, .maximum:
            return inputs.count == 2 && inputs[0] == inputs[1] ? inputs[0] : nil
        case .multiply:
            guard inputs.count == 2 else { return nil }
            if inputs[0] == inputs[1] { return inputs[0] }
            if inputs.contains(.scalar), let vector = inputs.first(where: {
                $0 == .vector2 || $0 == .vector3
            }) {
                return vector
            }
            return nil
        case .divide:
            guard inputs.count == 2 else { return nil }
            if inputs == [.scalar, .scalar] { return .scalar }
            return [.vector2, .vector3].contains(inputs[0])
                && [.scalar, inputs[0]].contains(inputs[1]) ? inputs[0] : nil
        case .length:
            return inputs.count == 1 && [.vector2, .vector3].contains(inputs[0])
                ? .scalar
                : nil
        case .normalize:
            return inputs.count == 1 && [.vector2, .vector3].contains(inputs[0])
                ? inputs[0]
                : nil
        case .perpendicular:
            return inputs == [.vector2] ? .vector2 : nil
        case .absolute, .clamp01, .cosine, .exponential, .negate, .oneMinus, .sine:
            return inputs == [.scalar] ? .scalar : nil
        case .dot:
            return inputs.count == 2
                && inputs[0] == inputs[1]
                && [.vector2, .vector3].contains(inputs[0]) ? .scalar : nil
        case .compose2:
            return allowVector3 && inputs == [.scalar, .scalar] ? .vector2 : nil
        case .compose3:
            return allowVector3 && inputs == [.scalar, .scalar, .scalar]
                ? .vector3
                : nil
        case .componentX, .componentY:
            return allowVector3
                && inputs.count == 1
                && [.vector2, .vector3].contains(inputs[0])
                ? .scalar
                : nil
        case .componentZ:
            return allowVector3 && inputs == [.vector3] ? .scalar : nil
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

    private static func constant(_ value: Any?, allowVector3: Bool) -> [Double]? {
        if let scalar = finiteDouble(value), boundedMagnitude(scalar) {
            return [scalar]
        }
        guard let values = value as? [Any],
              values.count == 2 || (allowVector3 && values.count == 3) else {
            return nil
        }
        let scalars = values.compactMap(finiteDouble)
        return scalars.count == values.count && scalars.allSatisfy(boundedMagnitude)
            ? scalars
            : nil
    }

    private static func parseMaterial(
        _ value: Any?
    ) -> AOSDesktopWorldNativeEffectProgramMaterial? {
        guard let material = value as? [String: Any],
              let lightingValue = material["lighting"] as? String,
              let lighting = AOSDesktopWorldNativeEffectProgramMaterial.Lighting(
                rawValue: lightingValue
              ) else {
            return nil
        }
        let commonKeys = Set([
                "ambient", "diffuse", "lightDirection", "lighting",
                "normalSampleDistance", "perspectiveDistance",
              ])
        let expectedKeys = lighting == .standard
            ? commonKeys.union(["fresnel", "refraction", "roughness", "specular"])
            : commonKeys
        guard Set(material.keys) == expectedKeys,
              let ambient = finiteDouble(material["ambient"]),
              (0...2).contains(ambient),
              let diffuse = finiteDouble(material["diffuse"]),
              (0...2).contains(diffuse),
              let directionValues = material["lightDirection"] as? [Any],
              directionValues.count == 3 else {
            return nil
        }
        let lightDirection = directionValues.compactMap(finiteDouble)
        guard lightDirection.count == 3,
              lightDirection.allSatisfy(boundedMagnitude),
              hypot(hypot(lightDirection[0], lightDirection[1]), lightDirection[2])
                >= 0.000_001,
              let normalSampleDistance = finiteDouble(material["normalSampleDistance"]),
              normalSampleDistance
                >= AOSDesktopWorldNativeEffectProgram.minimumNormalSampleDistance,
              normalSampleDistance
                <= AOSDesktopWorldNativeEffectProgram.maximumNormalSampleDistance,
              let perspectiveDistance = finiteDouble(material["perspectiveDistance"]),
              perspectiveDistance
                >= AOSDesktopWorldNativeEffectProgram.minimumPerspectiveDistance,
              perspectiveDistance
                <= AOSDesktopWorldNativeEffectProgram.maximumPerspectiveDistance else {
            return nil
        }
        let fresnel = lighting == .standard ? finiteDouble(material["fresnel"]) : 0
        let refraction = lighting == .standard ? finiteDouble(material["refraction"]) : 0
        let roughness = lighting == .standard ? finiteDouble(material["roughness"]) : 1
        let specular = lighting == .standard ? finiteDouble(material["specular"]) : 0
        guard let fresnel,
              (0...1).contains(fresnel),
              let refraction,
              (0...AOSDesktopWorldNativeEffectProgram.maximumTextureDisplacement)
                .contains(refraction),
              let roughness,
              (0.02...1).contains(roughness),
              let specular,
              (0...2).contains(specular) else {
            return nil
        }
        return .init(
            ambient: ambient,
            diffuse: diffuse,
            fresnel: fresnel,
            lightDirection: lightDirection,
            lighting: lighting,
            normalSampleDistance: normalSampleDistance,
            perspectiveDistance: perspectiveDistance,
            refraction: refraction,
            roughness: roughness,
            specular: specular
        )
    }

    private static func parseGeometry(
        _ value: Any?
    ) -> AOSDesktopWorldNativeEffectProgramGeometry? {
        guard let value else { return nil }
        guard let geometry = value as? [String: Any],
              let kindValue = geometry["kind"] as? String,
              let kind = AOSDesktopWorldNativeEffectProgramGeometry.Kind(rawValue: kindValue),
              let cellSize = finiteDouble(geometry["cellSize"]),
              cellSize >= AOSDesktopWorldNativeEffectProgram.minimumGeometryCellSize,
              cellSize <= AOSDesktopWorldNativeEffectProgram.maximumGeometryCellSize else {
            return nil
        }
        if kind == .surface {
            guard Set(geometry.keys) == Set(["cellSize", "kind"]) else { return nil }
            return .init(cellSize: cellSize, extent: 0, kind: kind, padding: 0)
        }
        let extentKey = kind == .eventSegment ? "width" : "radius"
        guard Set(geometry.keys) == Set(["cellSize", "kind", "padding", extentKey]),
              let padding = finiteDouble(geometry["padding"]),
              (0...AOSDesktopWorldNativeEffectProgram.maximumGeometryPadding).contains(padding),
              let extent = finiteDouble(geometry[extentKey]),
              extent >= cellSize,
              extent <= AOSDesktopWorldNativeEffectProgram.maximumGeometryExtent else {
            return nil
        }
        return .init(cellSize: cellSize, extent: extent, kind: kind, padding: padding)
    }

    private static func digest(_ value: [String: Any]) -> String? {
        var data = Data((AOSDesktopWorldNativeEffectProgram.digestContract + "\0").utf8)
        guard appendDigestValue(value, to: &data),
              data.count <= AOSDesktopWorldNativeEffectProgram.maximumSerializedBytes * 4 else {
            return nil
        }
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private static func appendDigestLength(_ value: Int, to data: inout Data) -> Bool {
        guard value >= 0, value <= Int(UInt32.max) else { return false }
        var encoded = UInt32(value).bigEndian
        withUnsafeBytes(of: &encoded) { data.append(contentsOf: $0) }
        return true
    }

    private static func appendDigestString(_ value: String, to data: inout Data) -> Bool {
        let bytes = Array(value.utf8)
        guard appendDigestLength(bytes.count, to: &data) else { return false }
        data.append(contentsOf: bytes)
        return true
    }

    private static func appendDigestValue(_ value: Any, to data: inout Data) -> Bool {
        if value is NSNull {
            data.append(0)
            return true
        }
        if let number = value as? NSNumber {
            if CFGetTypeID(number) == CFBooleanGetTypeID() {
                data.append(number.boolValue ? 2 : 1)
                return true
            }
            let scalar = number.doubleValue
            guard scalar.isFinite else { return false }
            data.append(3)
            var bits = (scalar == 0 ? 0.0 : scalar).bitPattern.bigEndian
            withUnsafeBytes(of: &bits) { data.append(contentsOf: $0) }
            return true
        }
        if let string = value as? String {
            data.append(4)
            return appendDigestString(string, to: &data)
        }
        if let array = value as? [Any] {
            data.append(5)
            guard appendDigestLength(array.count, to: &data) else { return false }
            return array.allSatisfy { appendDigestValue($0, to: &data) }
        }
        if let object = value as? [String: Any] {
            let keys = object.keys.sorted {
                Array($0.utf8).lexicographicallyPrecedes(Array($1.utf8))
            }
            data.append(6)
            guard appendDigestLength(keys.count, to: &data) else { return false }
            for key in keys {
                guard appendDigestString(key, to: &data),
                      let entry = object[key],
                      appendDigestValue(entry, to: &data) else {
                    return false
                }
            }
            return true
        }
        return false
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
