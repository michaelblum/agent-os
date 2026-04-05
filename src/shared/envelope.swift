// envelope.swift — Daemon event envelope builder per shared/schemas/daemon-event.schema.json

import Foundation

/// Build a standard daemon event envelope.
/// Returns a JSON dictionary ready for serialization.
func buildEnvelope(service: String, event: String, data: [String: Any], ref: String? = nil) -> [String: Any] {
    var envelope: [String: Any] = [
        "v": 1,
        "service": service,
        "event": event,
        "ts": Date().timeIntervalSince1970,
        "data": data
    ]
    if let ref = ref { envelope["ref"] = ref }
    return envelope
}

/// Serialize an envelope to ndjson bytes (JSON + newline).
func envelopeBytes(service: String, event: String, data: [String: Any], ref: String? = nil) -> Data? {
    let dict = buildEnvelope(service: service, event: event, data: data, ref: ref)
    guard var jsonData = try? JSONSerialization.data(withJSONObject: dict, options: [.sortedKeys]) else { return nil }
    jsonData.append(contentsOf: "\n".utf8)
    return jsonData
}
