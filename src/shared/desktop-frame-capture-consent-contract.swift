import Foundation

enum AOSDesktopFrameDirectCaptureStatus: String {
    case ready
    case permissionRequired = "permission_required"
    case unsupported
    case failed
}

struct AOSDesktopFrameDirectCaptureSnapshot: Equatable {
    static let capability = "screen_capture_direct"

    let status: AOSDesktopFrameDirectCaptureStatus
    let errorCode: String?

    var dictionary: [String: Any] {
        var value: [String: Any] = [
            "capability": Self.capability,
            "status": status.rawValue,
            "capture_persisted": false,
        ]
        value["error_code"] = errorCode ?? NSNull()
        return value
    }
}

enum AOSDesktopFrameDirectCaptureWireContract {
    static let payloadKey = "screen_capture_direct"

    static func responsePayload(
        _ snapshot: AOSDesktopFrameDirectCaptureSnapshot
    ) -> [String: Any] {
        [payloadKey: snapshot.dictionary]
    }

    static func snapshot(
        from response: [String: Any]
    ) -> AOSDesktopFrameDirectCaptureSnapshot? {
        let candidate: [String: Any]
        if response["v"] != nil {
            guard response["v"] as? Int == 1,
                  response["status"] as? String == "success",
                  let envelopeData = response["data"] as? [String: Any],
                  let nested = envelopeData[payloadKey] as? [String: Any] else {
                return nil
            }
            candidate = nested
        } else {
            candidate = (response[payloadKey] as? [String: Any]) ?? response
        }

        guard candidate["capability"] as? String
                == AOSDesktopFrameDirectCaptureSnapshot.capability,
              let statusValue = candidate["status"] as? String,
              let status = AOSDesktopFrameDirectCaptureStatus(rawValue: statusValue),
              candidate["capture_persisted"] as? Bool == false else {
            return nil
        }

        let errorCode: String?
        switch candidate["error_code"] {
        case nil, is NSNull:
            errorCode = nil
        case let value as String:
            errorCode = value
        default:
            return nil
        }

        return AOSDesktopFrameDirectCaptureSnapshot(
            status: status,
            errorCode: errorCode
        )
    }
}
