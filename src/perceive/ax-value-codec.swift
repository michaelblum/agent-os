import Foundation

public struct AOSAXPoint: Codable, Equatable, Sendable {
    public let x: Double
    public let y: Double

    public init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }
}

public struct AOSAXSize: Codable, Equatable, Sendable {
    public let width: Double
    public let height: Double

    public init(width: Double, height: Double) {
        self.width = width
        self.height = height
    }
}

public struct AOSAXRect: Codable, Equatable, Sendable {
    public let x: Double
    public let y: Double
    public let width: Double
    public let height: Double

    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }

    public init(from decoder: Decoder) throws {
        try aosAXRejectSurplusKeys(decoder, allowed: ["x", "y", "width", "height"])
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            x: try container.decode(Double.self, forKey: .x),
            y: try container.decode(Double.self, forKey: .y),
            width: try container.decode(Double.self, forKey: .width),
            height: try container.decode(Double.self, forKey: .height)
        )
    }

    private enum CodingKeys: String, CodingKey {
        case x, y, width, height
    }
}

public struct AOSAXRange: Codable, Equatable, Sendable {
    public let location: UInt64
    public let length: UInt64

    public init(location: UInt64, length: UInt64) {
        self.location = location
        self.length = length
    }
}

public enum AOSAXPlatformDictionaryKey: Sendable, Equatable {
    case string(String)
    case unsupported(String)
}

public struct AOSAXPlatformDictionaryEntry<Handle: Hashable & Sendable>: Sendable {
    public let key: AOSAXPlatformDictionaryKey
    public let value: AOSAXPlatformValue<Handle>

    public init(key: AOSAXPlatformDictionaryKey, value: AOSAXPlatformValue<Handle>) {
        self.key = key
        self.value = value
    }
}

public indirect enum AOSAXPlatformValue<Handle: Hashable & Sendable>: Sendable {
    case null
    case boolean(Bool)
    case signedInteger(Int64)
    case unsignedInteger(UInt64)
    case floatingPoint(Double)
    case string(String)
    case data(Data)
    case date(Date)
    case url(URL)
    case point(AOSAXPoint)
    case size(AOSAXSize)
    case rect(AOSAXRect)
    case range(AOSAXRange)
    case element(Handle)
    case array([AOSAXPlatformValue<Handle>])
    case dictionary([AOSAXPlatformDictionaryEntry<Handle>])
    case unknownType(String)
}

public enum AOSAXAttributeRead<Handle: Hashable & Sendable>: Sendable {
    case value(AOSAXPlatformValue<Handle>)
    case noValue
    case unsupported
    case unavailable(AOSAXPlatformError)
    case platformError(AOSAXPlatformError)
}

public enum AOSAXAttributeOutcomeKind: String, Codable, Sendable {
    case value
    case noValue = "no_value"
    case unsupported
    case platformError = "platform_error"
    case deadlineExceeded = "deadline_exceeded"
    case recursionBound = "recursion_bound"
    case arrayBound = "array_bound"
    case unrepresentableType = "unrepresentable_type"
}

public enum AOSAXSettableOutcome: String, Codable, Sendable {
    case settable
    case notSettable = "not_settable"
    case unsupported
    case platformError = "platform_error"
    case deadlineExceeded = "deadline_exceeded"
}

public struct AOSAXSettableFact: Codable, Equatable, Sendable {
    public let name: String
    public let outcome: AOSAXSettableOutcome
    public let error: AOSAXPlatformError?

    public init(name: String, outcome: AOSAXSettableOutcome, error: AOSAXPlatformError? = nil) {
        self.name = name
        self.outcome = outcome
        self.error = error
    }
}

public indirect enum AOSAXValue: Equatable, Sendable {
    case null
    case boolean(Bool)
    case signedInteger(Int64)
    case unsignedInteger(UInt64)
    case floatingPoint(Double)
    case string(String)
    case data(String)
    case date(String)
    case url(String)
    case point(AOSAXPoint)
    case size(AOSAXSize)
    case rect(AOSAXRect)
    case range(AOSAXRange)
    case elementRef(String)
    case array([AOSAXValue])
    case dictionary([AOSAXDictionaryEntry])
}

public struct AOSAXDictionaryEntry: Codable, Equatable, Sendable {
    public let key: String
    public let value: AOSAXValue

    public init(key: String, value: AOSAXValue) {
        self.key = key
        self.value = value
    }
}

extension AOSAXValue: Codable {
    private enum CodingKeys: String, CodingKey {
        case type
        case value
    }

    private enum Kind: String, Codable {
        case null
        case boolean
        case signedInteger = "signed_integer"
        case unsignedInteger = "unsigned_integer"
        case floatingPoint = "floating_point"
        case string
        case data
        case date
        case url
        case point
        case size
        case rect
        case range
        case elementRef = "element_ref"
        case array
        case dictionary
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .null:
            try container.encode(Kind.null, forKey: .type)
        case .boolean(let value):
            try container.encode(Kind.boolean, forKey: .type)
            try container.encode(value, forKey: .value)
        case .signedInteger(let value):
            try container.encode(Kind.signedInteger, forKey: .type)
            try container.encode(value, forKey: .value)
        case .unsignedInteger(let value):
            try container.encode(Kind.unsignedInteger, forKey: .type)
            try container.encode(value, forKey: .value)
        case .floatingPoint(let value):
            try container.encode(Kind.floatingPoint, forKey: .type)
            try container.encode(value, forKey: .value)
        case .string(let value):
            try container.encode(Kind.string, forKey: .type)
            try container.encode(value, forKey: .value)
        case .data(let value):
            try container.encode(Kind.data, forKey: .type)
            try container.encode(value, forKey: .value)
        case .date(let value):
            try container.encode(Kind.date, forKey: .type)
            try container.encode(value, forKey: .value)
        case .url(let value):
            try container.encode(Kind.url, forKey: .type)
            try container.encode(value, forKey: .value)
        case .point(let value):
            try container.encode(Kind.point, forKey: .type)
            try container.encode(value, forKey: .value)
        case .size(let value):
            try container.encode(Kind.size, forKey: .type)
            try container.encode(value, forKey: .value)
        case .rect(let value):
            try container.encode(Kind.rect, forKey: .type)
            try container.encode(value, forKey: .value)
        case .range(let value):
            try container.encode(Kind.range, forKey: .type)
            try container.encode(value, forKey: .value)
        case .elementRef(let value):
            try container.encode(Kind.elementRef, forKey: .type)
            try container.encode(value, forKey: .value)
        case .array(let value):
            try container.encode(Kind.array, forKey: .type)
            try container.encode(value, forKey: .value)
        case .dictionary(let value):
            try container.encode(Kind.dictionary, forKey: .type)
            try container.encode(value, forKey: .value)
        }
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(Kind.self, forKey: .type) {
        case .null: self = .null
        case .boolean: self = .boolean(try container.decode(Bool.self, forKey: .value))
        case .signedInteger: self = .signedInteger(try container.decode(Int64.self, forKey: .value))
        case .unsignedInteger: self = .unsignedInteger(try container.decode(UInt64.self, forKey: .value))
        case .floatingPoint: self = .floatingPoint(try container.decode(Double.self, forKey: .value))
        case .string: self = .string(try container.decode(String.self, forKey: .value))
        case .data: self = .data(try container.decode(String.self, forKey: .value))
        case .date: self = .date(try container.decode(String.self, forKey: .value))
        case .url: self = .url(try container.decode(String.self, forKey: .value))
        case .point: self = .point(try container.decode(AOSAXPoint.self, forKey: .value))
        case .size: self = .size(try container.decode(AOSAXSize.self, forKey: .value))
        case .rect: self = .rect(try container.decode(AOSAXRect.self, forKey: .value))
        case .range: self = .range(try container.decode(AOSAXRange.self, forKey: .value))
        case .elementRef: self = .elementRef(try container.decode(String.self, forKey: .value))
        case .array: self = .array(try container.decode([AOSAXValue].self, forKey: .value))
        case .dictionary: self = .dictionary(try container.decode([AOSAXDictionaryEntry].self, forKey: .value))
        }
    }
}

public struct AOSAXAttributeProjection: Codable, Equatable, Sendable {
    public let name: String
    public let outcome: AOSAXAttributeOutcomeKind
    public let value: AOSAXValue?
    public let error: AOSAXPlatformError?
    public let detail: String?

    public init(
        name: String,
        outcome: AOSAXAttributeOutcomeKind,
        value: AOSAXValue? = nil,
        error: AOSAXPlatformError? = nil,
        detail: String? = nil
    ) {
        self.name = name
        self.outcome = outcome
        self.value = value
        self.error = error
        self.detail = detail
    }
}

public struct AOSAXValueCodecBounds: Codable, Equatable, Sendable {
    public let maxArrayDepth: Int
    public let maxArrayItems: Int
    public let maxAggregateCost: Int

    public init(maxArrayDepth: Int, maxArrayItems: Int, maxAggregateCost: Int) throws {
        guard maxArrayDepth > 0, maxArrayItems > 0, maxAggregateCost > 0 else {
            throw AOSAXObservationError.invalidBounds
        }
        self.maxArrayDepth = maxArrayDepth
        self.maxArrayItems = maxArrayItems
        self.maxAggregateCost = maxAggregateCost
    }
}

public enum AOSAXValueLimit: String, Sendable {
    case recursion
    case arrayItems = "array_items"
    case aggregateCost = "aggregate_cost"
    case retainedRefs = "retained_refs"
    case unrepresentable
}

public struct AOSAXValueEncoding: Sendable {
    public let value: AOSAXValue?
    public let cost: Int
    public let limit: AOSAXValueLimit?

    public init(value: AOSAXValue?, cost: Int, limit: AOSAXValueLimit?) {
        self.value = value
        self.cost = cost
        self.limit = limit
    }
}

public struct AOSAXValueCodec<Handle: Hashable & Sendable> {
    public typealias ElementRefResolver = (Handle) throws -> String

    private let bounds: AOSAXValueCodecBounds
    private let resolveElementRef: ElementRefResolver

    public init(bounds: AOSAXValueCodecBounds, resolveElementRef: @escaping ElementRefResolver) {
        self.bounds = bounds
        self.resolveElementRef = resolveElementRef
    }

    public func encode(_ value: AOSAXPlatformValue<Handle>, consumed: Int) throws -> AOSAXValueEncoding {
        guard consumed >= 0, consumed < bounds.maxAggregateCost else {
            return AOSAXValueEncoding(value: nil, cost: 0, limit: .aggregateCost)
        }
        return try encode(value, depth: 0, remaining: bounds.maxAggregateCost - consumed)
    }

    private func encode(
        _ value: AOSAXPlatformValue<Handle>,
        depth: Int,
        remaining: Int
    ) throws -> AOSAXValueEncoding {
        guard remaining > 0 else {
            return AOSAXValueEncoding(value: nil, cost: 0, limit: .aggregateCost)
        }
        switch value {
        case .null:
            return scalar(.null, cost: 1, remaining: remaining)
        case .boolean(let value):
            return scalar(.boolean(value), cost: 1, remaining: remaining)
        case .signedInteger(let value):
            return scalar(.signedInteger(value), cost: 1, remaining: remaining)
        case .unsignedInteger(let value):
            return scalar(.unsignedInteger(value), cost: 1, remaining: remaining)
        case .floatingPoint(let value):
            guard value.isFinite else {
                return AOSAXValueEncoding(value: nil, cost: 0, limit: .unrepresentable)
            }
            return scalar(.floatingPoint(value), cost: 1, remaining: remaining)
        case .string(let value):
            return scalar(.string(value), cost: 1 + value.utf8.count, remaining: remaining)
        case .data(let value):
            let groups = value.count.addingReportingOverflow(2)
            guard !groups.overflow else {
                return AOSAXValueEncoding(value: nil, cost: 0, limit: .aggregateCost)
            }
            let encodedLength = (groups.partialValue / 3).multipliedReportingOverflow(by: 4)
            guard !encodedLength.overflow else {
                return AOSAXValueEncoding(value: nil, cost: 0, limit: .aggregateCost)
            }
            let cost = encodedLength.partialValue.addingReportingOverflow(1)
            guard !cost.overflow, cost.partialValue <= remaining else {
                return AOSAXValueEncoding(value: nil, cost: 0, limit: .aggregateCost)
            }
            return AOSAXValueEncoding(
                value: .data(value.base64EncodedString()),
                cost: cost.partialValue,
                limit: nil
            )
        case .date(let value):
            let encoded = Self.iso8601(value)
            return scalar(.date(encoded), cost: 1 + encoded.utf8.count, remaining: remaining)
        case .url(let value):
            let encoded = value.absoluteString
            return scalar(.url(encoded), cost: 1 + encoded.utf8.count, remaining: remaining)
        case .point(let value):
            guard value.x.isFinite, value.y.isFinite else {
                return AOSAXValueEncoding(value: nil, cost: 0, limit: .unrepresentable)
            }
            return scalar(.point(value), cost: 3, remaining: remaining)
        case .size(let value):
            guard value.width.isFinite, value.height.isFinite else {
                return AOSAXValueEncoding(value: nil, cost: 0, limit: .unrepresentable)
            }
            return scalar(.size(value), cost: 3, remaining: remaining)
        case .rect(let value):
            guard value.x.isFinite, value.y.isFinite, value.width.isFinite, value.height.isFinite else {
                return AOSAXValueEncoding(value: nil, cost: 0, limit: .unrepresentable)
            }
            return scalar(.rect(value), cost: 5, remaining: remaining)
        case .range(let value):
            return scalar(.range(value), cost: 3, remaining: remaining)
        case .element(let handle):
            let ref: String
            do {
                ref = try resolveElementRef(handle)
            } catch AOSAXObservationError.retentionLimit {
                return AOSAXValueEncoding(value: nil, cost: 0, limit: .retainedRefs)
            }
            return scalar(.elementRef(ref), cost: 1 + ref.utf8.count, remaining: remaining)
        case .array(let values):
            guard depth < bounds.maxArrayDepth else {
                return AOSAXValueEncoding(value: nil, cost: 0, limit: .recursion)
            }
            guard values.count <= bounds.maxArrayItems else {
                return AOSAXValueEncoding(value: nil, cost: 0, limit: .arrayItems)
            }
            var cost = 1
            var encoded: [AOSAXValue] = []
            encoded.reserveCapacity(values.count)
            for item in values {
                let itemResult = try encode(item, depth: depth + 1, remaining: remaining - cost)
                guard itemResult.limit == nil, let itemValue = itemResult.value else {
                    return AOSAXValueEncoding(value: nil, cost: 0, limit: itemResult.limit)
                }
                cost += itemResult.cost
                guard cost <= remaining else {
                    return AOSAXValueEncoding(value: nil, cost: 0, limit: .aggregateCost)
                }
                encoded.append(itemValue)
            }
            return AOSAXValueEncoding(value: .array(encoded), cost: cost, limit: nil)
        case .dictionary(let entries):
            guard depth < bounds.maxArrayDepth else {
                return AOSAXValueEncoding(value: nil, cost: 0, limit: .recursion)
            }
            guard entries.count <= bounds.maxArrayItems else {
                return AOSAXValueEncoding(value: nil, cost: 0, limit: .arrayItems)
            }
            var unique = Set<String>()
            var sortable: [(String, AOSAXPlatformValue<Handle>)] = []
            sortable.reserveCapacity(entries.count)
            for entry in entries {
                guard case .string(let key) = entry.key, unique.insert(key).inserted else {
                    return AOSAXValueEncoding(value: nil, cost: 0, limit: .unrepresentable)
                }
                sortable.append((key, entry.value))
            }
            sortable.sort { Self.unicodeScalarLess($0.0, $1.0) }
            var cost = 1
            var encoded: [AOSAXDictionaryEntry] = []
            encoded.reserveCapacity(sortable.count)
            for (key, item) in sortable {
                cost += key.utf8.count
                guard cost <= remaining else {
                    return AOSAXValueEncoding(value: nil, cost: 0, limit: .aggregateCost)
                }
                let itemResult = try encode(item, depth: depth + 1, remaining: remaining - cost)
                guard itemResult.limit == nil, let itemValue = itemResult.value else {
                    return AOSAXValueEncoding(value: nil, cost: 0, limit: itemResult.limit)
                }
                cost += itemResult.cost
                guard cost <= remaining else {
                    return AOSAXValueEncoding(value: nil, cost: 0, limit: .aggregateCost)
                }
                encoded.append(AOSAXDictionaryEntry(key: key, value: itemValue))
            }
            return AOSAXValueEncoding(value: .dictionary(encoded), cost: cost, limit: nil)
        case .unknownType:
            return AOSAXValueEncoding(value: nil, cost: 0, limit: .unrepresentable)
        }
    }

    private func scalar(_ value: AOSAXValue, cost: Int, remaining: Int) -> AOSAXValueEncoding {
        guard cost <= remaining else {
            return AOSAXValueEncoding(value: nil, cost: 0, limit: .aggregateCost)
        }
        return AOSAXValueEncoding(value: value, cost: cost, limit: nil)
    }

    private static func iso8601(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    public static func unicodeScalarLess(_ lhs: String, _ rhs: String) -> Bool {
        let left = lhs.unicodeScalars.map(\.value)
        let right = rhs.unicodeScalars.map(\.value)
        for (l, r) in zip(left, right) where l != r {
            return l < r
        }
        return left.count < right.count
    }
}
