// input-tap-health.swift — Parsing helpers and recovery guidance for daemon
// input-tap health, shared by service lifecycle (verifyServiceReadiness) and
// operator.swift (permissions check, status, doctor, do-family preflight).

import Foundation

// MARK: - Parsed Health View

struct InputTapHealth {
    let status: String           // "active", "retrying", "unavailable"
    let attempts: Int
    let listenAccess: Bool
    let postAccess: Bool
    let lastErrorAt: String?
}

struct DaemonPermissions {
    let accessibility: Bool
}

struct DaemonHealthView {
    let inputTap: InputTapHealth
    let permissions: DaemonPermissions
}

// MARK: - Ping Payload Parser

/// Parse a `system.ping` response payload into a daemon health view.
/// Accepts either the envelope-wrapped form (`{data: {...}}`) or the flat payload.
/// Returns nil if required fields are missing or malformed.
func parseDaemonHealthView(from response: [String: Any]) -> DaemonHealthView? {
    let payload = (response["data"] as? [String: Any]) ?? response
    guard let tap = payload["input_tap"] as? [String: Any],
          let status = tap["status"] as? String,
          let attempts = tap["attempts"] as? Int,
          let listenAccess = tap["listen_access"] as? Bool,
          let postAccess = tap["post_access"] as? Bool else {
        return nil
    }
    let lastErrorAt = tap["last_error_at"] as? String
    let perms = (payload["permissions"] as? [String: Any]) ?? [:]
    let accessibility = (perms["accessibility"] as? Bool) ?? false
    return DaemonHealthView(
        inputTap: InputTapHealth(
            status: status,
            attempts: attempts,
            listenAccess: listenAccess,
            postAccess: postAccess,
            lastErrorAt: lastErrorAt
        ),
        permissions: DaemonPermissions(accessibility: accessibility)
    )
}

// MARK: - Service Readiness Outcome

enum ServiceReadinessOutcome {
    case ok(view: DaemonHealthView)
    case inputTapInactive(view: DaemonHealthView)
    case socketUnreachable
}

extension ServiceReadinessOutcome {
    var statusString: String {
        switch self {
        case .ok: return "ok"
        case .inputTapInactive, .socketUnreachable: return "degraded"
        }
    }

    var reason: String? {
        switch self {
        case .ok: return nil
        case .inputTapInactive: return "input_tap_not_active"
        case .socketUnreachable: return "socket_unreachable"
        }
    }

    var exitCode: Int32 {
        switch self {
        case .ok: return 0
        case .inputTapInactive, .socketUnreachable: return 1
        }
    }

    var view: DaemonHealthView? {
        switch self {
        case .ok(let view), .inputTapInactive(let view): return view
        case .socketUnreachable: return nil
        }
    }
}

// MARK: - Recovery Guidance

enum RecoveryGuidanceContext {
    /// Generic context: the user is anywhere except mid-`service restart`.
    case `default`
    /// `service restart` has just completed and reported a degraded tap.
    /// We omit the "./aos service restart" line to avoid telling the user to
    /// re-run the exact command that just failed.
    case afterServiceRestart
}

/// Multi-line recovery text matching the spec's two recovery shapes.
/// `attempts` is included in the headline line.
func inputTapRecoveryGuidance(
    context: RecoveryGuidanceContext,
    status: String,
    attempts: Int
) -> String {
    let headline: String
    switch context {
    case .default:
        headline = "Input tap is not active (status=\(status), attempts=\(attempts))."
    case .afterServiceRestart:
        headline = "Input tap is still not active after service restart (status=\(status), attempts=\(attempts))."
    }
    var lines = [headline, "Try:"]
    if context != .afterServiceRestart {
        lines.append("  ./aos service restart              # restart the managed daemon and re-check readiness")
    }
    lines.append("  ./aos permissions setup --once     # refresh macOS permission onboarding")
    lines.append("  ./aos serve --idle-timeout none    # temporary foreground fallback for this session")
    return lines.joined(separator: "\n")
}

/// Recovery list for JSON output. Mirrors the text guidance, one entry per
/// recommended command, in the same order.
func inputTapRecoveryCommands(context: RecoveryGuidanceContext) -> [String] {
    var cmds: [String] = []
    if context != .afterServiceRestart {
        cmds.append("./aos service restart")
    }
    cmds.append("./aos permissions setup --once")
    cmds.append("./aos serve --idle-timeout none")
    return cmds
}

/// Sub-guidance appended when the daemon reports listen_access or post_access
/// as false. Points the operator at the System Settings pane and shows the
/// resolved daemon binary path so they grant access to the right binary.
func inputMonitoringSubGuidance(
    listenAccess: Bool,
    postAccess: Bool,
    daemonBinaryPath: String
) -> String {
    """
    Daemon lacks Input Monitoring access (listen=\(listenAccess), post=\(postAccess)).
    Open System Settings > Privacy & Security > Input Monitoring and grant access to the daemon binary:
      \(daemonBinaryPath)
    """
}
