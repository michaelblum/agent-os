import Foundation

func permissionsDirectScreenCaptureCommand(args: [String]) {
    guard args.count == 2,
          let action = args.first,
          ["status", "prime"].contains(action),
          args[1] == "--json" else {
        exitError(
            "__permissions direct-screen-capture requires <status|prime> --json.",
            code: "INVALID_ARG"
        )
    }
    guard let response = sendEnvelopeRequest(
        service: "permissions",
        action: action == "prime"
            ? "screen_capture_direct_prime"
            : "screen_capture_direct_status",
        data: [:],
        socketPath: aosSocketPath(for: aosCurrentRuntimeMode()),
        timeoutMs: action == "prime" ? 152_000 : 1_000
    ) else {
        exitError(
            "The AOS daemon must be reachable for direct screen-capture permission status.",
            code: "DAEMON_UNREACHABLE"
        )
    }
    if let error = response["error"] as? String {
        exitError(
            error,
            code: response["code"] as? String ?? "DESKTOP_FRAME_PERMISSION_STATUS_FAILED"
        )
    }
    guard let snapshot = AOSDesktopFrameDirectCaptureWireContract.snapshot(from: response) else {
        exitError(
            "The daemon returned malformed direct screen-capture permission facts.",
            code: "DESKTOP_FRAME_PERMISSION_RESPONSE_INVALID"
        )
    }
    print(jsonString(PermissionsDirectScreenCaptureFacts(snapshot: snapshot)))
    if action == "prime" && snapshot.status != .ready {
        exit(1)
    }
}

private struct PermissionsDirectScreenCaptureFacts: Encodable {
    let capability: String
    let status: String
    let capture_persisted: Bool
    let error_code: String?

    init(snapshot: AOSDesktopFrameDirectCaptureSnapshot) {
        capability = AOSDesktopFrameDirectCaptureSnapshot.capability
        status = snapshot.status.rawValue
        capture_persisted = false
        error_code = snapshot.errorCode
    }

    private enum CodingKeys: String, CodingKey {
        case capability, status, capture_persisted, error_code
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(capability, forKey: .capability)
        try container.encode(status, forKey: .status)
        try container.encode(capture_persisted, forKey: .capture_persisted)
        if let error_code {
            try container.encode(error_code, forKey: .error_code)
        } else {
            try container.encodeNil(forKey: .error_code)
        }
    }
}
