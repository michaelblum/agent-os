// ndjson.swift — Newline-delimited JSON framing.
//
// Buffers raw bytes and yields complete parsed JSON dictionaries.
// Used by both request/response (single line) and event stream (continuous).

import Foundation

let aosDaemonMaximumNDJSONFrameBytes = 32 * 1024 * 1024

struct NDJSONReader {
    private var buffer = Data()
    private var trailingFrameByteCount = 0
    let maximumFrameBytes: Int

    init(maximumFrameBytes: Int = aosDaemonMaximumNDJSONFrameBytes) {
        self.maximumFrameBytes = max(1, maximumFrameBytes)
    }

    /// Append raw bytes to the internal buffer.
    @discardableResult
    mutating func append(_ data: Data) -> Bool {
        append(Array(data), count: data.count)
    }

    /// Append raw bytes from a fixed-size array.
    @discardableResult
    mutating func append(_ bytes: [UInt8], count: Int) -> Bool {
        guard count >= 0, count <= bytes.count else { return false }
        var nextTrailingCount = trailingFrameByteCount
        for byte in bytes.prefix(count) {
            if byte == UInt8(ascii: "\n") {
                nextTrailingCount = 0
                continue
            }
            nextTrailingCount += 1
            if nextTrailingCount > maximumFrameBytes { return false }
        }
        buffer.append(contentsOf: bytes[0..<count])
        trailingFrameByteCount = nextTrailingCount
        return true
    }

    /// Extract and parse the next complete JSON line, if available.
    /// Returns nil when no complete line is buffered.
    mutating func nextJSON() -> [String: Any]? {
        while let newlineIndex = buffer.firstIndex(of: UInt8(ascii: "\n")) {
            let lineData = Data(buffer[buffer.startIndex..<newlineIndex])
            buffer = Data(buffer[buffer.index(after: newlineIndex)...])
            if lineData.isEmpty { continue }
            if let json = try? JSONSerialization.jsonObject(with: lineData) as? [String: Any] {
                return json
            }
        }
        return nil
    }

    /// Extract the next complete line as raw Data, if available.
    /// Returns nil when no complete line is buffered.
    mutating func nextRawLine() -> Data? {
        guard let newlineIndex = buffer.firstIndex(of: UInt8(ascii: "\n")) else {
            return nil
        }
        let lineData = Data(buffer[buffer.startIndex..<newlineIndex])
        buffer = Data(buffer[buffer.index(after: newlineIndex)...])
        return lineData.isEmpty ? nextRawLine() : lineData
    }

    /// Whether the buffer is empty.
    var isEmpty: Bool { buffer.isEmpty }

    /// Content bytes retained across complete and partial frames. Exposed for
    /// bounded framing diagnostics and disposable production-reader proofs.
    var bufferedByteCount: Int { buffer.count }
}

// MARK: - Envelope Decoding

/// Attempt to decode a raw JSON dictionary as a daemon event envelope.
/// Returns (service, event, timestamp, data) if the message matches the envelope schema.
/// Returns nil for non-envelope messages (e.g. channel relays, lifecycle events).
func decodeEnvelope(_ json: [String: Any]) -> (service: String, event: String, ts: Double, data: [String: Any])? {
    guard let v = json["v"] as? Int, v == 1,
          let service = json["service"] as? String,
          let event = json["event"] as? String,
          let ts = json["ts"] as? Double,
          let data = json["data"] as? [String: Any] else {
        return nil
    }
    return (service, event, ts, data)
}
