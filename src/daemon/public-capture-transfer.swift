import CryptoKit
import Foundation

let aosPublicCaptureChunkBytes = 384 * 1024
let aosPublicCaptureMaximumWireBytes = 336_592_896
let aosPublicCaptureMaximumDisplayCount = 16
let aosPublicCaptureMaximumDimension = 67_108_864
let aosMaximumExactJSONInteger: UInt64 = 9_007_199_254_740_991

enum AOSPublicCaptureTransferError: Error {
    case canceled
    case invalidData
    case invalidWireValue
}

enum AOSPublicCaptureForegroundMessage {
    case chunk(AOSPublicCaptureChunkWireValue)
    case failure(String)
    case success([[String: Any]])
}

struct AOSPublicCaptureChunkWireValue {
    let byteCount: Int
    let chunk: Data
    let chunkCount: Int
    let chunkIndex: Int
    let displayID: UInt32
    let frameIndex: Int
    let sha256: String
}

struct AOSPublicCaptureFrameWireValue {
    let byteCount: Int
    let captureSource: String
    let chunkCount: Int
    let displayID: UInt32
    let frameIndex: Int
    let height: Int
    let sha256: String
    let width: Int
    let windowFallback: Bool
    let windowID: Int?
}

struct AOSPublicCaptureTransferDescriptor: Equatable {
    let byteCount: Int
    let chunkCount: Int
    let sha256: String
}

func aosPublicCaptureFrameMatchesRequestedWindow(
    _ frame: AOSPublicCaptureFrameWireValue,
    requestedWindowID: Int?
) -> Bool {
    switch frame.captureSource {
    case "display":
        return frame.windowID == nil
            && frame.windowFallback == (requestedWindowID != nil)
    case "window":
        return !frame.windowFallback
            && frame.windowID == requestedWindowID
            && requestedWindowID != nil
    default:
        return false
    }
}

func aosPublicCaptureSHA256(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

/// JSONSerialization preserves whether a token was encoded as an integer or a
/// floating-point number in NSNumber.objCType. Capture IPC accepts only integer
/// tokens inside the interoperable JSON safe-integer range; it never repairs a
/// floating token, boolean, wrapped unsigned value, or lossy large integer.
func aosExactJSONInteger(
    _ value: Any,
    minimum: Int = Int.min,
    maximum: Int = Int.max
) -> Int? {
    guard minimum <= maximum,
          let number = value as? NSNumber,
          CFGetTypeID(number) != CFBooleanGetTypeID() else {
        return nil
    }
    let type = String(cString: number.objCType)
    let exact: Int64
    switch type {
    case "c", "s", "i", "l", "q":
        exact = number.int64Value
        guard exact >= -Int64(aosMaximumExactJSONInteger),
              exact <= Int64(aosMaximumExactJSONInteger) else {
            return nil
        }
    case "C", "S", "I", "L", "Q":
        let unsigned = number.uint64Value
        guard unsigned <= aosMaximumExactJSONInteger else { return nil }
        exact = Int64(unsigned)
    default:
        return nil
    }
    guard let result = Int(exactly: exact),
          result >= minimum,
          result <= maximum else {
        return nil
    }
    return result
}

func aosExactJSONUInt32(
    _ value: Any,
    minimum: UInt32 = 0,
    maximum: UInt32 = UInt32.max
) -> UInt32? {
    guard minimum <= maximum,
          let integer = aosExactJSONInteger(
            value,
            minimum: Int(minimum),
            maximum: Int(maximum)
          ) else {
        return nil
    }
    return UInt32(exactly: integer)
}

private func aosPublicCaptureDigestIsValid(_ value: String) -> Bool {
    value.range(
        of: #"^[a-f0-9]{64}$"#,
        options: String.CompareOptions.regularExpression
    ) != nil
}

func aosDecodePublicCaptureForegroundMessage(
    _ message: [String: Any],
    captureID: String,
    topologyIdentity: String,
    maximumByteCount: Int
) throws -> AOSPublicCaptureForegroundMessage {
    let eventKeys: Set<String> = [
        "v", "service", "event", "ts", "ref", "data",
    ]
    if Set(message.keys) == eventKeys {
        guard aosExactJSONInteger(message["v"] as Any, minimum: 1, maximum: 1) == 1,
              message["service"] as? String == "see",
              message["event"] as? String == "capture_chunk",
              message["ref"] as? String == captureID,
              let timestamp = message["ts"] as? NSNumber,
              CFGetTypeID(timestamp) != CFBooleanGetTypeID(),
              timestamp.doubleValue.isFinite,
              let data = message["data"] as? [String: Any],
              Set(data.keys) == [
                "capture_id", "topology_identity", "display_id", "frame_index",
                "chunk_index", "chunk_count", "byte_count", "sha256",
                "bytes_base64",
              ],
              data["capture_id"] as? String == captureID,
              data["topology_identity"] as? String == topologyIdentity,
              let displayID = aosExactJSONUInt32(
                data["display_id"] as Any,
                minimum: 1
              ),
              let frameIndex = aosExactJSONInteger(
                data["frame_index"] as Any,
                minimum: 0,
                maximum: aosPublicCaptureMaximumDisplayCount - 1
              ),
              let byteCount = aosExactJSONInteger(
                data["byte_count"] as Any,
                minimum: 1,
                maximum: min(maximumByteCount, aosPublicCaptureMaximumWireBytes)
              ),
              let chunkCount = aosExactJSONInteger(
                data["chunk_count"] as Any,
                minimum: 1,
                maximum: (byteCount + aosPublicCaptureChunkBytes - 1)
                    / aosPublicCaptureChunkBytes
              ),
              chunkCount == (byteCount + aosPublicCaptureChunkBytes - 1)
                    / aosPublicCaptureChunkBytes,
              let chunkIndex = aosExactJSONInteger(
                data["chunk_index"] as Any,
                minimum: 0,
                maximum: chunkCount - 1
              ),
              let digest = data["sha256"] as? String,
              aosPublicCaptureDigestIsValid(digest),
              let encoded = data["bytes_base64"] as? String,
              encoded.utf8.count <= 524_288,
              let chunk = Data(base64Encoded: encoded),
              chunk.count == min(
                aosPublicCaptureChunkBytes,
                byteCount - chunkIndex * aosPublicCaptureChunkBytes
              ) else {
            throw AOSPublicCaptureTransferError.invalidWireValue
        }
        return .chunk(AOSPublicCaptureChunkWireValue(
            byteCount: byteCount,
            chunk: chunk,
            chunkCount: chunkCount,
            chunkIndex: chunkIndex,
            displayID: displayID,
            frameIndex: frameIndex,
            sha256: digest
        ))
    }

    let errorKeys: Set<String> = ["v", "status", "error", "code", "ref"]
    if Set(message.keys) == errorKeys {
        guard aosExactJSONInteger(message["v"] as Any, minimum: 1, maximum: 1) == 1,
              message["status"] as? String == "error",
              message["ref"] as? String == captureID,
              let error = message["error"] as? String,
              !error.isEmpty,
              let code = message["code"] as? String,
              !code.isEmpty else {
            throw AOSPublicCaptureTransferError.invalidWireValue
        }
        return .failure(code)
    }

    let successKeys: Set<String> = ["v", "status", "data", "ref"]
    guard Set(message.keys) == successKeys,
          aosExactJSONInteger(message["v"] as Any, minimum: 1, maximum: 1) == 1,
          message["status"] as? String == "success",
          message["ref"] as? String == captureID,
          let data = message["data"] as? [String: Any],
          Set(data.keys) == ["capture_id", "topology_identity", "frames"],
          data["capture_id"] as? String == captureID,
          data["topology_identity"] as? String == topologyIdentity,
          let frames = data["frames"] as? [[String: Any]],
          !frames.isEmpty,
          frames.count <= aosPublicCaptureMaximumDisplayCount else {
        throw AOSPublicCaptureTransferError.invalidWireValue
    }
    return .success(frames)
}

func aosDecodePublicCaptureFrameWireValue(
    _ metadata: [String: Any]
) throws -> AOSPublicCaptureFrameWireValue {
    let displayKeys: Set<String> = [
        "display_id", "frame_index", "chunk_count", "byte_count", "sha256",
        "width", "height", "capture_source", "window_fallback",
    ]
    let windowKeys: Set<String> = [
        "display_id", "frame_index", "chunk_count", "byte_count", "sha256",
        "width", "height", "capture_source", "window_fallback", "window_id",
    ]
    let keys = Set(metadata.keys)
    guard keys == displayKeys || keys == windowKeys,
          let captureSource = metadata["capture_source"] as? String,
          (captureSource == "display" && keys == displayKeys)
            || (captureSource == "window" && keys == windowKeys),
          let displayID = aosExactJSONUInt32(
            metadata["display_id"] as Any,
            minimum: 1
          ),
          let frameIndex = aosExactJSONInteger(
            metadata["frame_index"] as Any,
            minimum: 0,
            maximum: aosPublicCaptureMaximumDisplayCount - 1
          ),
          let chunkCount = aosExactJSONInteger(
            metadata["chunk_count"] as Any,
            minimum: 1,
            maximum: aosPublicCaptureMaximumWireBytes
          ),
          let byteCount = aosExactJSONInteger(
            metadata["byte_count"] as Any,
            minimum: 1,
            maximum: aosPublicCaptureMaximumWireBytes
          ),
          let digest = metadata["sha256"] as? String,
          aosPublicCaptureDigestIsValid(digest),
          let width = aosExactJSONInteger(
            metadata["width"] as Any,
            minimum: 1,
            maximum: aosPublicCaptureMaximumDimension
          ),
          let height = aosExactJSONInteger(
            metadata["height"] as Any,
            minimum: 1,
            maximum: aosPublicCaptureMaximumDimension
          ),
          let windowFallback = metadata["window_fallback"] as? Bool else {
        throw AOSPublicCaptureTransferError.invalidWireValue
    }
    let windowID: Int?
    if captureSource == "window" {
        guard !windowFallback,
              let exactWindowID = aosExactJSONUInt32(
                metadata["window_id"] as Any,
                minimum: 1
              ) else {
            throw AOSPublicCaptureTransferError.invalidWireValue
        }
        windowID = Int(exactWindowID)
    } else {
        windowID = nil
    }
    return AOSPublicCaptureFrameWireValue(
        byteCount: byteCount,
        captureSource: captureSource,
        chunkCount: chunkCount,
        displayID: displayID,
        frameIndex: frameIndex,
        height: height,
        sha256: digest,
        width: width,
        windowFallback: windowFallback,
        windowID: windowID
    )
}

/// Emits one bounded event at a time. The daemon's normal outbound writer owns
/// queue admission, so an encoded frame may exceed the socket's queued-byte
/// budget without creating an unbounded side channel or a filesystem artifact.
func aosStreamPublicCaptureData(
    _ data: Data,
    captureID: String,
    topologyIdentity: String,
    displayID: UInt32,
    frameIndex: Int,
    emitChunk: ([String: Any]) -> Bool
) throws -> AOSPublicCaptureTransferDescriptor {
    guard !data.isEmpty, frameIndex >= 0 else {
        throw AOSPublicCaptureTransferError.invalidData
    }
    let digest = aosPublicCaptureSHA256(data)
    let chunkCount = max(
        1,
        (data.count + aosPublicCaptureChunkBytes - 1)
            / aosPublicCaptureChunkBytes
    )
    for chunkIndex in 0..<chunkCount {
        let lower = chunkIndex * aosPublicCaptureChunkBytes
        let upper = min(data.count, lower + aosPublicCaptureChunkBytes)
        let chunk = data.subdata(in: lower..<upper)
        guard emitChunk([
            "capture_id": captureID,
            "topology_identity": topologyIdentity,
            "display_id": NSNumber(value: displayID),
            "frame_index": frameIndex,
            "chunk_index": chunkIndex,
            "chunk_count": chunkCount,
            "byte_count": data.count,
            "sha256": digest,
            "bytes_base64": chunk.base64EncodedString(),
        ]) else {
            throw AOSPublicCaptureTransferError.canceled
        }
    }
    return AOSPublicCaptureTransferDescriptor(
        byteCount: data.count,
        chunkCount: chunkCount,
        sha256: digest
    )
}
