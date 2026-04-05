// ndjson.swift — Newline-delimited JSON framing.
//
// Buffers raw bytes and yields complete parsed JSON dictionaries.
// Used by both request/response (single line) and event stream (continuous).

import Foundation

struct NDJSONReader {
    private var buffer = Data()

    /// Append raw bytes to the internal buffer.
    mutating func append(_ data: Data) {
        buffer.append(data)
    }

    /// Append raw bytes from a fixed-size array.
    mutating func append(_ bytes: [UInt8], count: Int) {
        buffer.append(contentsOf: bytes[0..<count])
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
