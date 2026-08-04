import Foundation
import CoreGraphics
import CryptoKit

enum AOSDisplayTopologyError: Error, CustomStringConvertible {
    case noDisplays
    case duplicateRuntimeDisplayID(UInt32)
    case invalidMainDisplayCount(Int)
    case invalidUUID(displayID: UInt32, value: String)
    case nonFinite(field: String)
    case invalidBounds(field: String)
    case invalidScaleFactor(displayID: UInt32)

    var description: String {
        switch self {
        case .noDisplays:
            return "display topology observation contains no displays"
        case .duplicateRuntimeDisplayID(let displayID):
            return "display topology observation repeats runtime display id \(displayID)"
        case .invalidMainDisplayCount(let count):
            return "display topology observation must contain exactly one main display; found \(count)"
        case .invalidUUID(let displayID, let value):
            return "display topology observation has invalid UUID for display \(displayID): \(value)"
        case .nonFinite(let field):
            return "display topology observation has non-finite \(field)"
        case .invalidBounds(let field):
            return "display topology observation has invalid \(field)"
        case .invalidScaleFactor(let displayID):
            return "display topology observation has invalid scale factor for display \(displayID)"
        }
    }
}

struct AOSDisplayTopologyBounds: Codable, Equatable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct AOSDisplayTopologyPoint: Codable, Equatable {
    let x: Double
    let y: Double
}

struct AOSDisplayTopologyObservationMember {
    let runtimeDisplayID: UInt32
    let displayUUID: String?
    let label: String
    let isMain: Bool
    let isMirrored: Bool
    let nativeBounds: AOSDisplayTopologyBounds
    let nativeVisibleBounds: AOSDisplayTopologyBounds
    let scaleFactor: Double
    let rotation: Double
}

enum AOSDisplayTopologyMemberIdentity: Encodable, Equatable {
    case displayUUID(value: String, bytes: [UInt8])
    case displayIDFallback(UInt32)

    private enum CodingKeys: String, CodingKey {
        case kind
        case displayUUID = "display_uuid"
        case displayIDFallback = "display_id_fallback"
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .displayUUID(let value, _):
            try container.encode("display_uuid", forKey: .kind)
            try container.encode(value, forKey: .displayUUID)
        case .displayIDFallback(let displayID):
            try container.encode("display_id_fallback", forKey: .kind)
            try container.encode(displayID, forKey: .displayIDFallback)
        }
    }
}

struct AOSDisplayTopologyDisplay: Encodable {
    // Runtime-only lookup facts are deliberately omitted from public encoding
    // and from the content identity when a persistent UUID is usable.
    let runtimeDisplayID: UInt32
    let runtimeDisplayUUID: String?
    let runtimeLabel: String
    let runtimeIsMirrored: Bool

    let ordinal: Int
    let isMain: Bool
    let memberIdentity: AOSDisplayTopologyMemberIdentity
    let nativeBounds: AOSDisplayTopologyBounds
    let nativeVisibleBounds: AOSDisplayTopologyBounds
    let desktopWorldBounds: AOSDisplayTopologyBounds
    let visibleDesktopWorldBounds: AOSDisplayTopologyBounds
    let scaleFactor: Double
    let rotation: Double

    private enum CodingKeys: String, CodingKey {
        case ordinal
        case isMain = "is_main"
        case memberIdentity = "member_identity"
        case nativeBounds = "native_bounds"
        case nativeVisibleBounds = "native_visible_bounds"
        case desktopWorldBounds = "desktop_world_bounds"
        case visibleDesktopWorldBounds = "visible_desktop_world_bounds"
        case scaleFactor = "scale_factor"
        case rotation
    }
}

struct AOSDisplayTopologySnapshot: Encodable {
    let schema = "aos.display-topology.v1"
    let identity: String
    let usesDisplayIDFallback: Bool
    let screensHaveSeparateSpaces: Bool
    let desktopWorldOriginNative: AOSDisplayTopologyPoint
    let nativeBounds: AOSDisplayTopologyBounds
    let nativeVisibleBounds: AOSDisplayTopologyBounds
    let desktopWorldBounds: AOSDisplayTopologyBounds
    let visibleDesktopWorldBounds: AOSDisplayTopologyBounds
    let displays: [AOSDisplayTopologyDisplay]

    private enum CodingKeys: String, CodingKey {
        case schema
        case identity
        case usesDisplayIDFallback = "uses_display_id_fallback"
        case screensHaveSeparateSpaces = "screens_have_separate_spaces"
        case desktopWorldOriginNative = "desktop_world_origin_native"
        case nativeBounds = "native_bounds"
        case nativeVisibleBounds = "native_visible_bounds"
        case desktopWorldBounds = "desktop_world_bounds"
        case visibleDesktopWorldBounds = "visible_desktop_world_bounds"
        case displays
    }
}

private struct AOSNormalizedDisplayTopologyMember {
    let runtimeDisplayID: UInt32
    let displayUUID: String?
    let uuidBytes: [UInt8]?
    let label: String
    let isMain: Bool
    let isMirrored: Bool
    let nativeBounds: AOSDisplayTopologyBounds
    let nativeVisibleBounds: AOSDisplayTopologyBounds
    let scaleFactor: Double
    let rotation: Double
}

private extension UUID {
    var aosRawBytes: [UInt8] {
        var value = uuid
        return withUnsafeBytes(of: &value) { Array($0) }
    }
}

private func aosCanonicalFinite(_ value: Double, field: String) throws -> Double {
    guard value.isFinite else { throw AOSDisplayTopologyError.nonFinite(field: field) }
    return value == 0 ? 0 : value
}

private func aosCanonicalBounds(
    _ bounds: AOSDisplayTopologyBounds,
    field: String,
    requiresPositiveSize: Bool
) throws -> AOSDisplayTopologyBounds {
    let canonical = AOSDisplayTopologyBounds(
        x: try aosCanonicalFinite(bounds.x, field: "\(field).x"),
        y: try aosCanonicalFinite(bounds.y, field: "\(field).y"),
        width: try aosCanonicalFinite(bounds.width, field: "\(field).width"),
        height: try aosCanonicalFinite(bounds.height, field: "\(field).height")
    )
    let sizeIsValid = requiresPositiveSize
        ? (canonical.width > 0 && canonical.height > 0)
        : (canonical.width >= 0 && canonical.height >= 0)
    guard sizeIsValid else {
        throw AOSDisplayTopologyError.invalidBounds(field: field)
    }
    return canonical
}

private func aosCanonicalRotation(_ value: Double, displayID: UInt32) throws -> Double {
    let finite = try aosCanonicalFinite(value, field: "display[\(displayID)].rotation")
    var normalized = finite.truncatingRemainder(dividingBy: 360)
    if normalized < 0 { normalized += 360 }
    return normalized == 0 ? 0 : normalized
}

private func aosCanonicalUUID(_ value: String, displayID: UInt32) throws -> (String, [UInt8]) {
    guard value.utf8.count == 36,
          value.enumerated().allSatisfy({ index, character in
              [8, 13, 18, 23].contains(index) ? character == "-" : character.isHexDigit
          }),
          let uuid = UUID(uuidString: value)
    else {
        throw AOSDisplayTopologyError.invalidUUID(displayID: displayID, value: value)
    }
    return (uuid.uuidString.lowercased(), uuid.aosRawBytes)
}

private func aosUnion(
    _ bounds: [AOSDisplayTopologyBounds],
    field: String,
    requiresPositiveSize: Bool
) throws -> AOSDisplayTopologyBounds {
    guard let first = bounds.first else { throw AOSDisplayTopologyError.noDisplays }
    var minX = first.x
    var minY = first.y
    var maxX = first.x + first.width
    var maxY = first.y + first.height
    for item in bounds.dropFirst() {
        minX = min(minX, item.x)
        minY = min(minY, item.y)
        maxX = max(maxX, item.x + item.width)
        maxY = max(maxY, item.y + item.height)
    }
    return try aosCanonicalBounds(
        AOSDisplayTopologyBounds(x: minX, y: minY, width: maxX - minX, height: maxY - minY),
        field: field,
        requiresPositiveSize: requiresPositiveSize
    )
}

private func aosReanchor(
    _ bounds: AOSDisplayTopologyBounds,
    origin: AOSDisplayTopologyPoint,
    field: String
) throws -> AOSDisplayTopologyBounds {
    try aosCanonicalBounds(
        AOSDisplayTopologyBounds(
            x: bounds.x - origin.x,
            y: bounds.y - origin.y,
            width: bounds.width,
            height: bounds.height
        ),
        field: field,
        requiresPositiveSize: false
    )
}

private func aosIdentityPrecedes(
    _ lhs: AOSDisplayTopologyMemberIdentity,
    _ rhs: AOSDisplayTopologyMemberIdentity
) -> Bool {
    switch (lhs, rhs) {
    case let (.displayUUID(_, leftBytes), .displayUUID(_, rightBytes)):
        return leftBytes.lexicographicallyPrecedes(rightBytes)
    case (.displayUUID, .displayIDFallback):
        return true
    case (.displayIDFallback, .displayUUID):
        return false
    case let (.displayIDFallback(left), .displayIDFallback(right)):
        return left < right
    }
}

private struct AOSDisplayTopologyIdentityEncoder {
    private(set) var data = Data("AOS_DISPLAY_TOPOLOGY_ID_V1\0".utf8)

    mutating func appendRecord(fieldCount: UInt32) {
        data.append(0x10)
        appendRawUInt32(fieldCount)
    }

    mutating func appendArray(count: UInt32) {
        data.append(0x11)
        appendRawUInt32(count)
    }

    mutating func appendBool(_ value: Bool) {
        data.append(0x01)
        data.append(value ? 1 : 0)
    }

    mutating func appendUInt32(_ value: UInt32) {
        data.append(0x02)
        appendRawUInt32(value)
    }

    mutating func appendDouble(_ value: Double) {
        precondition(value.isFinite)
        data.append(0x03)
        var bits = (value == 0 ? 0.0 : value).bitPattern.bigEndian
        withUnsafeBytes(of: &bits) { data.append(contentsOf: $0) }
    }

    mutating func appendUUID(_ bytes: [UInt8]) {
        precondition(bytes.count == 16)
        data.append(0x04)
        data.append(contentsOf: bytes)
    }

    mutating func appendMemberIdentity(_ identity: AOSDisplayTopologyMemberIdentity) {
        switch identity {
        case .displayUUID(_, let bytes):
            data.append(0x20)
            appendUUID(bytes)
        case .displayIDFallback(let displayID):
            data.append(0x21)
            appendUInt32(displayID)
        }
    }

    mutating func appendPoint(_ point: AOSDisplayTopologyPoint) {
        appendRecord(fieldCount: 2)
        appendDouble(point.x)
        appendDouble(point.y)
    }

    mutating func appendBounds(_ bounds: AOSDisplayTopologyBounds) {
        appendRecord(fieldCount: 4)
        appendDouble(bounds.x)
        appendDouble(bounds.y)
        appendDouble(bounds.width)
        appendDouble(bounds.height)
    }

    private mutating func appendRawUInt32(_ value: UInt32) {
        var bigEndian = value.bigEndian
        withUnsafeBytes(of: &bigEndian) { data.append(contentsOf: $0) }
    }
}

private func aosDisplayTopologyIdentity(
    usesDisplayIDFallback: Bool,
    screensHaveSeparateSpaces: Bool,
    desktopWorldOriginNative: AOSDisplayTopologyPoint,
    nativeBounds: AOSDisplayTopologyBounds,
    nativeVisibleBounds: AOSDisplayTopologyBounds,
    desktopWorldBounds: AOSDisplayTopologyBounds,
    visibleDesktopWorldBounds: AOSDisplayTopologyBounds,
    displays: [AOSDisplayTopologyDisplay]
) -> String {
    var encoder = AOSDisplayTopologyIdentityEncoder()
    encoder.appendRecord(fieldCount: 8)
    encoder.appendBool(usesDisplayIDFallback)
    encoder.appendBool(screensHaveSeparateSpaces)
    encoder.appendPoint(desktopWorldOriginNative)
    encoder.appendBounds(nativeBounds)
    encoder.appendBounds(nativeVisibleBounds)
    encoder.appendBounds(desktopWorldBounds)
    encoder.appendBounds(visibleDesktopWorldBounds)
    encoder.appendArray(count: UInt32(displays.count))
    for display in displays {
        encoder.appendRecord(fieldCount: 9)
        encoder.appendUInt32(UInt32(display.ordinal))
        encoder.appendBool(display.isMain)
        encoder.appendMemberIdentity(display.memberIdentity)
        encoder.appendBounds(display.nativeBounds)
        encoder.appendBounds(display.nativeVisibleBounds)
        encoder.appendBounds(display.desktopWorldBounds)
        encoder.appendBounds(display.visibleDesktopWorldBounds)
        encoder.appendDouble(display.scaleFactor)
        encoder.appendDouble(display.rotation)
    }
    let digest = SHA256.hash(data: encoder.data).map { String(format: "%02x", $0) }.joined()
    return "sha256:\(digest)"
}

func buildAOSDisplayTopologySnapshot(
    observation: [AOSDisplayTopologyObservationMember],
    screensHaveSeparateSpaces: Bool
) throws -> AOSDisplayTopologySnapshot {
    guard !observation.isEmpty else { throw AOSDisplayTopologyError.noDisplays }

    var seenDisplayIDs = Set<UInt32>()
    var normalized: [AOSNormalizedDisplayTopologyMember] = []
    normalized.reserveCapacity(observation.count)
    for member in observation {
        guard seenDisplayIDs.insert(member.runtimeDisplayID).inserted else {
            throw AOSDisplayTopologyError.duplicateRuntimeDisplayID(member.runtimeDisplayID)
        }
        let uuid: (String, [UInt8])?
        if let rawUUID = member.displayUUID {
            uuid = try aosCanonicalUUID(rawUUID, displayID: member.runtimeDisplayID)
        } else {
            uuid = nil
        }
        let nativeBounds = try aosCanonicalBounds(
            member.nativeBounds,
            field: "display[\(member.runtimeDisplayID)].native_bounds",
            requiresPositiveSize: true
        )
        let nativeVisibleBounds = try aosCanonicalBounds(
            member.nativeVisibleBounds,
            field: "display[\(member.runtimeDisplayID)].native_visible_bounds",
            requiresPositiveSize: false
        )
        let scale = try aosCanonicalFinite(
            member.scaleFactor,
            field: "display[\(member.runtimeDisplayID)].scale_factor"
        )
        guard scale > 0 else {
            throw AOSDisplayTopologyError.invalidScaleFactor(displayID: member.runtimeDisplayID)
        }
        normalized.append(AOSNormalizedDisplayTopologyMember(
            runtimeDisplayID: member.runtimeDisplayID,
            displayUUID: uuid?.0,
            uuidBytes: uuid?.1,
            label: member.label,
            isMain: member.isMain,
            isMirrored: member.isMirrored,
            nativeBounds: nativeBounds,
            nativeVisibleBounds: nativeVisibleBounds,
            scaleFactor: scale,
            rotation: try aosCanonicalRotation(member.rotation, displayID: member.runtimeDisplayID)
        ))
    }

    let mainCount = normalized.filter(\.isMain).count
    guard mainCount == 1 else { throw AOSDisplayTopologyError.invalidMainDisplayCount(mainCount) }

    var uuidCounts: [String: Int] = [:]
    for member in normalized {
        if let uuid = member.displayUUID { uuidCounts[uuid, default: 0] += 1 }
    }

    struct IdentifiedMember {
        let member: AOSNormalizedDisplayTopologyMember
        let identity: AOSDisplayTopologyMemberIdentity
    }
    var identified = normalized.map { member -> IdentifiedMember in
        if let uuid = member.displayUUID,
           let uuidBytes = member.uuidBytes,
           uuidCounts[uuid] == 1 {
            return IdentifiedMember(member: member, identity: .displayUUID(value: uuid, bytes: uuidBytes))
        }
        return IdentifiedMember(member: member, identity: .displayIDFallback(member.runtimeDisplayID))
    }
    identified.sort { left, right in
        if left.member.isMain != right.member.isMain { return left.member.isMain }
        if left.member.nativeBounds.x != right.member.nativeBounds.x {
            return left.member.nativeBounds.x < right.member.nativeBounds.x
        }
        if left.member.nativeBounds.y != right.member.nativeBounds.y {
            return left.member.nativeBounds.y < right.member.nativeBounds.y
        }
        return aosIdentityPrecedes(left.identity, right.identity)
    }

    let nativeUnion = try aosUnion(
        identified.map { $0.member.nativeBounds },
        field: "native_bounds",
        requiresPositiveSize: true
    )
    let visibleNativeUnion = try aosUnion(
        identified.map { $0.member.nativeVisibleBounds },
        field: "native_visible_bounds",
        requiresPositiveSize: false
    )
    let desktopOrigin = AOSDisplayTopologyPoint(x: nativeUnion.x, y: nativeUnion.y)
    let displays = try identified.enumerated().map { index, item in
        AOSDisplayTopologyDisplay(
            runtimeDisplayID: item.member.runtimeDisplayID,
            runtimeDisplayUUID: item.member.displayUUID,
            runtimeLabel: item.member.label,
            runtimeIsMirrored: item.member.isMirrored,
            ordinal: index + 1,
            isMain: item.member.isMain,
            memberIdentity: item.identity,
            nativeBounds: item.member.nativeBounds,
            nativeVisibleBounds: item.member.nativeVisibleBounds,
            desktopWorldBounds: try aosReanchor(
                item.member.nativeBounds,
                origin: desktopOrigin,
                field: "display[\(item.member.runtimeDisplayID)].desktop_world_bounds"
            ),
            visibleDesktopWorldBounds: try aosReanchor(
                item.member.nativeVisibleBounds,
                origin: desktopOrigin,
                field: "display[\(item.member.runtimeDisplayID)].visible_desktop_world_bounds"
            ),
            scaleFactor: item.member.scaleFactor,
            rotation: item.member.rotation
        )
    }
    let desktopUnion = try aosUnion(
        displays.map(\.desktopWorldBounds),
        field: "desktop_world_bounds",
        requiresPositiveSize: true
    )
    let visibleDesktopUnion = try aosUnion(
        displays.map(\.visibleDesktopWorldBounds),
        field: "visible_desktop_world_bounds",
        requiresPositiveSize: false
    )
    let usesFallback = displays.contains {
        if case .displayIDFallback = $0.memberIdentity { return true }
        return false
    }
    let identity = aosDisplayTopologyIdentity(
        usesDisplayIDFallback: usesFallback,
        screensHaveSeparateSpaces: screensHaveSeparateSpaces,
        desktopWorldOriginNative: desktopOrigin,
        nativeBounds: nativeUnion,
        nativeVisibleBounds: visibleNativeUnion,
        desktopWorldBounds: desktopUnion,
        visibleDesktopWorldBounds: visibleDesktopUnion,
        displays: displays
    )
    return AOSDisplayTopologySnapshot(
        identity: identity,
        usesDisplayIDFallback: usesFallback,
        screensHaveSeparateSpaces: screensHaveSeparateSpaces,
        desktopWorldOriginNative: desktopOrigin,
        nativeBounds: nativeUnion,
        nativeVisibleBounds: visibleNativeUnion,
        desktopWorldBounds: desktopUnion,
        visibleDesktopWorldBounds: visibleDesktopUnion,
        displays: displays
    )
}
