import Foundation

func responseJSONBytes(_ dict: [String: Any], envelopeActive: Bool, envelopeRef: String?) -> Data? {
    let payload: [String: Any]
    if envelopeActive {
        if let error = dict["error"] as? String, let code = dict["code"] as? String {
            var envelope: [String: Any] = [
                "v": 1,
                "status": "error",
                "error": error,
                "code": code,
            ]
            if let envelopeRef, !envelopeRef.isEmpty { envelope["ref"] = envelopeRef }
            payload = envelope
        } else {
            var data = dict
            data.removeValue(forKey: "status")
            let status = (dict["status"] as? String) ?? "success"
            var envelope: [String: Any] = [
                "v": 1,
                "status": status == "ok" ? "success" : status,
                "data": data,
            ]
            if let envelopeRef, !envelopeRef.isEmpty { envelope["ref"] = envelopeRef }
            payload = envelope
        }
    } else {
        payload = dict
    }
    guard var serialized = try? JSONSerialization.data(
        withJSONObject: payload,
        options: [.sortedKeys]
    ) else { return nil }
    serialized.append(contentsOf: "\n".utf8)
    return serialized
}
