import CryptoKit
import Foundation

let aosPublicCaptureChunkBytes = 384 * 1024

enum AOSPublicCaptureTransferError: Error {
    case canceled
    case invalidData
}

struct AOSPublicCaptureTransferDescriptor: Equatable {
    let byteCount: Int
    let chunkCount: Int
    let sha256: String
}

func aosPublicCaptureSHA256(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
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
