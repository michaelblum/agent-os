import CryptoKit
import Darwin
import Foundation

let fixtureGeometryCheckpointSchema = "aos.exact-focus-channel-native-fixture-geometry-checkpoint.v1"
let fixtureGeometryCheckpointKeyEnvironment = "AOS_EXACT_FOCUS_CHANNEL_FIXTURE_GEOMETRY_KEY"
let fixtureGeometryCheckpointRequestMaxBytes = 256

enum FixtureGeometryCheckpointPhase: String, CaseIterable, Codable {
    case initialPre = "initial_pre"
    case initialPost = "initial_post"
    case preservedPre = "preserved_pre"
    case preservedPost = "preserved_post"
}

enum FixtureGeometryCheckpointErrorCode: String, CaseIterable, Codable {
    case readinessUnavailable = "FIXTURE_GEOMETRY_CHECKPOINT_READINESS_UNAVAILABLE"
}

struct FixtureGeometryCheckpointRequest: Codable, Equatable {
    let schema: String
    let nonce: String
    let phase: FixtureGeometryCheckpointPhase
}

struct FixtureGeometryCheckpointReadyReceipt: Codable {
    let schema: String
    let status: String
    let nonce: String
    let phase: FixtureGeometryCheckpointPhase
    let target_fact_hmac: String
    let full_fixture_fact_hmac: String
    let receipt_mac: String
}

struct FixtureGeometryCheckpointFailureReceipt: Codable {
    let schema: String
    let status: String
    let nonce: String
    let phase: FixtureGeometryCheckpointPhase
    let error_code: FixtureGeometryCheckpointErrorCode
    let receipt_mac: String
}

struct FixtureBounds: Codable, Equatable {
    let x: Int
    let y: Int
    let width: Int
    let height: Int
}

struct FixtureMetadata: Codable {
    let schema: String
    let pid: Int
    let target_window_id: Int
    let sibling_window_id: Int
    let target_bounds: FixtureBounds
    let sibling_bounds: FixtureBounds
    let display_id: Int
    let scale_factor: Double
    let target_identifier: String
    let sibling_identifier: String
    let ownership_token: String
    let same_process_windows: Bool
    let layer_zero_windows: Bool
    let sibling_above_target: Bool
    let target_center_occluded: Bool
    let overlap_fraction: Double
}

struct FixtureReadyEnvelope: Codable {
    let status: String
    let metadata: FixtureMetadata
}

struct FixtureGeometryFact {
    let ownerPID: Int
    let windowID: Int
    let bounds: FixtureBounds
    let displayID: UInt32
    let scaleFactor: Double
}

struct FixtureGeometryObservation {
    let target: FixtureGeometryFact
    let sibling: FixtureGeometryFact
}

struct FixtureObservation {
    let metadata: FixtureMetadata
    let geometry: FixtureGeometryObservation
}

enum FixtureGeometryCheckpointServiceResult: Equatable {
    case idle
    case publishedReady
    case publishedFailure
}

func fixtureGeometryCheckpointKeyFromEnvironment() -> SymmetricKey? {
    guard let rawValue = getenv(fixtureGeometryCheckpointKeyEnvironment) else { return nil }
    let encoded = String(cString: rawValue)
    unsetenv(fixtureGeometryCheckpointKeyEnvironment)
    guard let data = fixtureGeometryLowercaseHexData(encoded, bytes: 32) else { return nil }
    var decoded = [UInt8](data)
    defer {
        _ = decoded.withUnsafeMutableBytes {
            $0.initializeMemory(as: UInt8.self, repeating: 0)
        }
    }
    return SymmetricKey(data: decoded)
}

func fixtureGeometryCheckpointServiceAllowed(
    metadataPublished: Bool,
    targetClosed: Bool,
    stopStarted: Bool,
    closeRequested: Bool,
    stopRequested: Bool
) -> Bool {
    metadataPublished
        && !targetClosed
        && !stopStarted
        && !closeRequested
        && !stopRequested
}

func fixtureGeometryTargetFactBytes(_ fact: FixtureGeometryFact) -> Data? {
    var data = Data("aos.exact-focus.fixture-target-fact.v1\0".utf8)
    guard appendFixtureGeometryFact(fact, tag: nil, to: &data) else { return nil }
    return data
}

func fixtureGeometryFullFactBytes(_ observation: FixtureGeometryObservation) -> Data? {
    var data = Data("aos.exact-focus.fixture-full-fact.v2\0".utf8)
    guard appendFixtureGeometryFact(observation.target, tag: 1, to: &data),
          appendFixtureGeometryFact(observation.sibling, tag: 2, to: &data) else { return nil }
    return data
}

func fixtureGeometryHMACs(
    observation: FixtureGeometryObservation,
    key: SymmetricKey
) -> (target: String, full: String)? {
    guard let target = fixtureGeometryTargetFactBytes(observation.target),
          let full = fixtureGeometryFullFactBytes(observation) else { return nil }
    return (
        fixtureGeometryHMAC(target, key: key),
        fixtureGeometryHMAC(full, key: key)
    )
}

func fixtureGeometryReadyReceiptMAC(
    schema: String,
    status: String,
    nonce: String,
    phase: FixtureGeometryCheckpointPhase,
    targetFactHMAC: String,
    fullFixtureFactHMAC: String,
    key: SymmetricKey
) -> String? {
    guard let nonceData = fixtureGeometryLowercaseHexData(nonce, bytes: 32),
          let targetData = fixtureGeometryLowercaseHexData(targetFactHMAC, bytes: 32),
          let fullData = fixtureGeometryLowercaseHexData(fullFixtureFactHMAC, bytes: 32) else { return nil }
    guard var data = fixtureGeometryReceiptPrefix(
        schema: schema,
        status: status,
        nonce: nonceData,
        phase: phase,
        variant: 1
    ) else { return nil }
    data.append(targetData)
    data.append(fullData)
    return fixtureGeometryHMAC(data, key: key)
}

func fixtureGeometryFailureReceiptMAC(
    schema: String,
    status: String,
    nonce: String,
    phase: FixtureGeometryCheckpointPhase,
    errorCode: FixtureGeometryCheckpointErrorCode,
    key: SymmetricKey
) -> String? {
    guard let nonceData = fixtureGeometryLowercaseHexData(nonce, bytes: 32),
          var data = fixtureGeometryReceiptPrefix(
              schema: schema,
              status: status,
              nonce: nonceData,
              phase: phase,
              variant: 2
          ),
          appendFixtureGeometryLengthPrefixedUTF8(errorCode.rawValue, to: &data) else { return nil }
    return fixtureGeometryHMAC(data, key: key)
}

func parseFixtureGeometryCheckpointRequest(
    at url: URL
) -> FixtureGeometryCheckpointRequest? {
    guard let data = fixtureGeometryBoundedRegularFileData(
        at: url,
        maximumBytes: fixtureGeometryCheckpointRequestMaxBytes
    ),
    let text = String(data: data, encoding: .utf8),
    Data(text.utf8) == data,
    let value = try? JSONSerialization.jsonObject(with: data),
    let object = value as? [String: Any],
    Set(object.keys) == Set(["nonce", "phase", "schema"]),
    object["schema"] as? String == fixtureGeometryCheckpointSchema,
    let nonce = object["nonce"] as? String,
    fixtureGeometryLowercaseHexData(nonce, bytes: 32) != nil,
    let phaseRaw = object["phase"] as? String,
    let phase = FixtureGeometryCheckpointPhase(rawValue: phaseRaw) else { return nil }
    return FixtureGeometryCheckpointRequest(
        schema: fixtureGeometryCheckpointSchema,
        nonce: nonce,
        phase: phase
    )
}

final class FixtureGeometryCheckpointService {
    private let key: SymmetricKey
    private let publishedReceiptObserver: (() -> Void)?
    private var servedNonces = Set<String>()

    init(key: SymmetricKey, publishedReceiptObserver: (() -> Void)? = nil) {
        self.key = key
        self.publishedReceiptObserver = publishedReceiptObserver
    }

    @discardableResult
    func serviceIfRequested(
        requestURL: URL,
        receiptURL: URL,
        observation: () -> FixtureGeometryObservation?
    ) -> FixtureGeometryCheckpointServiceResult {
        guard FileManager.default.fileExists(atPath: requestURL.path),
              !FileManager.default.fileExists(atPath: receiptURL.path),
              let request = parseFixtureGeometryCheckpointRequest(at: requestURL),
              !servedNonces.contains(request.nonce) else { return .idle }

        let result: FixtureGeometryCheckpointServiceResult
        let published: Bool
        if let current = observation(),
           let hmacs = fixtureGeometryHMACs(observation: current, key: key),
           let receiptMAC = fixtureGeometryReadyReceiptMAC(
               schema: fixtureGeometryCheckpointSchema,
               status: "ready",
               nonce: request.nonce,
               phase: request.phase,
               targetFactHMAC: hmacs.target,
               fullFixtureFactHMAC: hmacs.full,
               key: key
           ) {
            published = publishFixtureGeometryReceipt(
                FixtureGeometryCheckpointReadyReceipt(
                    schema: fixtureGeometryCheckpointSchema,
                    status: "ready",
                    nonce: request.nonce,
                    phase: request.phase,
                    target_fact_hmac: hmacs.target,
                    full_fixture_fact_hmac: hmacs.full,
                    receipt_mac: receiptMAC
                ),
                to: receiptURL
            )
            result = .publishedReady
        } else {
            let code = FixtureGeometryCheckpointErrorCode.readinessUnavailable
            guard let receiptMAC = fixtureGeometryFailureReceiptMAC(
                schema: fixtureGeometryCheckpointSchema,
                status: "failed",
                nonce: request.nonce,
                phase: request.phase,
                errorCode: code,
                key: key
            ) else { return .idle }
            published = publishFixtureGeometryReceipt(
                FixtureGeometryCheckpointFailureReceipt(
                    schema: fixtureGeometryCheckpointSchema,
                    status: "failed",
                    nonce: request.nonce,
                    phase: request.phase,
                    error_code: code,
                    receipt_mac: receiptMAC
                ),
                to: receiptURL
            )
            result = .publishedFailure
        }
        guard published else { return .idle }
        publishedReceiptObserver?()
        servedNonces.insert(request.nonce)
        return result
    }
}

private func fixtureGeometryLowercaseHexData(_ value: String, bytes expectedBytes: Int) -> Data? {
    guard value.utf8.count == expectedBytes * 2,
          value.utf8.allSatisfy({ byte in
              (byte >= 48 && byte <= 57) || (byte >= 97 && byte <= 102)
          }) else { return nil }
    var bytes = [UInt8]()
    bytes.reserveCapacity(expectedBytes)
    var index = value.startIndex
    for _ in 0..<expectedBytes {
        let next = value.index(index, offsetBy: 2)
        guard let byte = UInt8(value[index..<next], radix: 16) else { return nil }
        bytes.append(byte)
        index = next
    }
    return Data(bytes)
}

private func fixtureGeometryHex(_ bytes: some Sequence<UInt8>) -> String {
    bytes.map { String(format: "%02x", $0) }.joined()
}

private func appendFixtureGeometryUInt16BE(_ value: UInt16, to data: inout Data) {
    var encoded = value.bigEndian
    withUnsafeBytes(of: &encoded) { data.append(contentsOf: $0) }
}

private func appendFixtureGeometryUInt32BE(_ value: UInt32, to data: inout Data) {
    var encoded = value.bigEndian
    withUnsafeBytes(of: &encoded) { data.append(contentsOf: $0) }
}

private func appendFixtureGeometryUInt64BE(_ value: UInt64, to data: inout Data) {
    var encoded = value.bigEndian
    withUnsafeBytes(of: &encoded) { data.append(contentsOf: $0) }
}

private func appendFixtureGeometryInt64BE(_ value: Int64, to data: inout Data) {
    var encoded = value.bigEndian
    withUnsafeBytes(of: &encoded) { data.append(contentsOf: $0) }
}

private func appendFixtureGeometryLengthPrefixedUTF8(
    _ value: String,
    to data: inout Data
) -> Bool {
    let bytes = Data(value.utf8)
    guard let count = UInt16(exactly: bytes.count) else { return false }
    appendFixtureGeometryUInt16BE(count, to: &data)
    data.append(bytes)
    return true
}

func fixtureGeometryScaleIsValid(_ value: Double) -> Bool {
    value.isFinite && value > 0 && !(value == 0 && value.sign == .minus)
}

private func appendFixtureGeometryFact(
    _ fact: FixtureGeometryFact,
    tag: UInt8?,
    to data: inout Data
) -> Bool {
    guard fact.ownerPID > 0,
          fact.windowID > 0,
          let ownerPID = UInt64(exactly: fact.ownerPID),
          let windowID = UInt64(exactly: fact.windowID),
          let x = Int64(exactly: fact.bounds.x),
          let y = Int64(exactly: fact.bounds.y),
          let width = Int64(exactly: fact.bounds.width),
          let height = Int64(exactly: fact.bounds.height),
          width > 0,
          height > 0,
          fact.displayID > 0,
          fixtureGeometryScaleIsValid(fact.scaleFactor) else { return false }
    if let tag { data.append(tag) }
    appendFixtureGeometryUInt64BE(ownerPID, to: &data)
    appendFixtureGeometryUInt64BE(windowID, to: &data)
    appendFixtureGeometryInt64BE(x, to: &data)
    appendFixtureGeometryInt64BE(y, to: &data)
    appendFixtureGeometryInt64BE(width, to: &data)
    appendFixtureGeometryInt64BE(height, to: &data)
    appendFixtureGeometryUInt32BE(fact.displayID, to: &data)
    appendFixtureGeometryUInt64BE(fact.scaleFactor.bitPattern, to: &data)
    return true
}

private func fixtureGeometryHMAC(_ data: Data, key: SymmetricKey) -> String {
    fixtureGeometryHex(HMAC<SHA256>.authenticationCode(for: data, using: key))
}

private func fixtureGeometryPhaseTag(_ phase: FixtureGeometryCheckpointPhase) -> UInt8 {
    switch phase {
    case .initialPre: return 1
    case .initialPost: return 2
    case .preservedPre: return 3
    case .preservedPost: return 4
    }
}

private func fixtureGeometryReceiptPrefix(
    schema: String,
    status: String,
    nonce: Data,
    phase: FixtureGeometryCheckpointPhase,
    variant: UInt8
) -> Data? {
    var data = Data("aos.exact-focus.fixture-checkpoint-receipt.v1\0".utf8)
    guard appendFixtureGeometryLengthPrefixedUTF8(schema, to: &data),
          appendFixtureGeometryLengthPrefixedUTF8(status, to: &data) else { return nil }
    data.append(nonce)
    data.append(fixtureGeometryPhaseTag(phase))
    data.append(variant)
    return data
}

private func fixtureGeometryBoundedRegularFileData(
    at url: URL,
    maximumBytes: Int
) -> Data? {
    guard maximumBytes > 0 else { return nil }
    let descriptor = Darwin.open(url.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
    guard descriptor >= 0 else { return nil }
    defer { Darwin.close(descriptor) }
    var metadata = stat()
    guard fstat(descriptor, &metadata) == 0,
          metadata.st_mode & S_IFMT == S_IFREG,
          metadata.st_size >= 1,
          metadata.st_size <= maximumBytes,
          let size = Int(exactly: metadata.st_size) else { return nil }
    var bytes = [UInt8](repeating: 0, count: size)
    var offset = 0
    while offset < size {
        let count = bytes.withUnsafeMutableBytes {
            Darwin.read(descriptor, $0.baseAddress!.advanced(by: offset), size - offset)
        }
        if count < 0 && errno == EINTR { continue }
        guard count > 0 else { return nil }
        offset += count
    }
    var trailing: UInt8 = 0
    var trailingCount: Int
    repeat {
        trailingCount = Darwin.read(descriptor, &trailing, 1)
    } while trailingCount < 0 && errno == EINTR
    guard trailingCount == 0 else { return nil }
    return Data(bytes)
}

private func publishFixtureGeometryReceipt<T: Encodable>(_ receipt: T, to url: URL) -> Bool {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    guard let data = try? encoder.encode(receipt) else { return false }
    let temporaryURL = url.deletingLastPathComponent().appendingPathComponent(
        ".\(url.lastPathComponent).\(UUID().uuidString).tmp"
    )
    let descriptor = Darwin.open(
        temporaryURL.path,
        O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC,
        mode_t(0o600)
    )
    guard descriptor >= 0 else { return false }
    var openDescriptor: Int32? = descriptor
    var removeTemporary = true
    defer {
        if let openDescriptor { Darwin.close(openDescriptor) }
        if removeTemporary { Darwin.unlink(temporaryURL.path) }
    }
    var written = 0
    let writeSucceeded = data.withUnsafeBytes { bytes -> Bool in
        while written < data.count {
            let count = Darwin.write(
                descriptor,
                bytes.baseAddress!.advanced(by: written),
                data.count - written
            )
            if count < 0 && errno == EINTR { continue }
            guard count > 0 else { return false }
            written += count
        }
        return true
    }
    guard writeSucceeded,
          fsync(descriptor) == 0,
          Darwin.close(descriptor) == 0 else { return false }
    openDescriptor = nil
    guard Darwin.rename(temporaryURL.path, url.path) == 0 else { return false }
    removeTemporary = false
    return true
}
