// input-tap-health.swift — Parsing helpers and recovery guidance for daemon
// input-tap health, shared by service lifecycle (verifyServiceReadiness) and
// operator.swift (permissions check, status, doctor, do-family preflight).

import Foundation

// MARK: - Parsed Health View

struct InputTapHealth {
    let status: String           // "active", "retrying", "unavailable"
    let attempts: Int
    // Optional when a current daemon cannot resolve the live value. Callers
    // MUST treat nil as "unknown" rather than fabricating a daemon answer.
    let listenAccess: Bool?
    let postAccess: Bool?
    let lastErrorAt: String?
}

struct DaemonPermissions {
    // Optional when the daemon cannot resolve the corresponding permission.
    let accessibility: Bool?
    let microphone: Bool?
    let microphoneState: String?
    let screenCaptureDirect: DaemonScreenCaptureDirect?
}

struct DaemonScreenCaptureDirect {
    let capability: String
    let status: String
    let capturePersisted: Bool
    let errorCode: String?
}

struct DaemonHealthView {
    let inputTap: InputTapHealth
    let permissions: DaemonPermissions
}

// MARK: - Ping Payload Parser

/// Parse a `system.ping` response payload into a daemon health view.
/// Accepts either the envelope-wrapped form (`{data: {...}}`) or the flat payload.
///
/// Requires the current structured `input_tap` block. Returns nil when the
/// response does not provide the minimum required fields (status + attempts).
func parseDaemonHealthView(from response: [String: Any]) -> DaemonHealthView? {
    let payload = (response["data"] as? [String: Any]) ?? response

    let status: String
    let attempts: Int
    let listenAccess: Bool?
    let postAccess: Bool?
    let lastErrorAt: String?

    guard let tap = payload["input_tap"] as? [String: Any],
          let s = tap["status"] as? String,
          let a = tap["attempts"] as? Int else {
        return nil
    }
    status = s
    attempts = a
    listenAccess = tap["listen_access"] as? Bool
    postAccess = tap["post_access"] as? Bool
    lastErrorAt = tap["last_error_at"] as? String

    let perms = payload["permissions"] as? [String: Any]
    let accessibility = perms?["accessibility"] as? Bool
    let microphone = perms?["microphone"] as? Bool
    let microphoneState = perms?["microphone_state"] as? String
    let direct = perms?["screen_capture_direct"] as? [String: Any]
    let screenCaptureDirect: DaemonScreenCaptureDirect?
    if let direct,
       let capability = direct["capability"] as? String,
       let status = direct["status"] as? String,
       let capturePersisted = direct["capture_persisted"] as? Bool {
        screenCaptureDirect = DaemonScreenCaptureDirect(
            capability: capability,
            status: status,
            capturePersisted: capturePersisted,
            errorCode: direct["error_code"] as? String
        )
    } else {
        screenCaptureDirect = nil
    }

    return DaemonHealthView(
        inputTap: InputTapHealth(
            status: status,
            attempts: attempts,
            listenAccess: listenAccess,
            postAccess: postAccess,
            lastErrorAt: lastErrorAt
        ),
        permissions: DaemonPermissions(
            accessibility: accessibility,
            microphone: microphone,
            microphoneState: microphoneState,
            screenCaptureDirect: screenCaptureDirect
        )
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

// MARK: - Readiness Evaluation

/// Canonical `ready_for_testing` formula shared by `aos doctor`,
/// `aos permissions check`, and `aos permissions setup`. Per
/// `shared/schemas/CONTRACT-GOVERNANCE.md` rules 1 & 2:
///
/// 1. **Reachable-daemon tap status is authoritative.** If the daemon is
///    reachable and reports `input_tap.status != "active"`, readiness is
///    `false` regardless of CLI fallbacks. This also holds for an incomplete
///    health payload with no `permissions` block; a broken daemon tap must not
///    be overridden by healthy foreground-CLI TCC facts.
/// 2. **Daemon microphone authorization is required.** Foreground CLI
///    microphone preflight is diagnostic only because the daemon owns capture.
/// 3. **Otherwise, accessibility source determines `ready_source`:**
///    - Daemon reachable + tap active + `permissions.accessibility` known:
///      daemon-sourced (`ready_source="daemon"`).
///    - Daemon unreachable, OR daemon reachable + tap active + unresolved
///      accessibility: CLI fallback (`ready_source="cli"`). No
///      silent merging of a daemon-sourced tap status with a CLI-sourced
///      accessibility check — and the tap-inactive case has already been
///      handled above so this branch only runs when the tap is OK.
struct ReadinessEvaluation {
    let readyForTesting: Bool
    let readySource: String  // "daemon" | "cli"
}

func evaluateReadyForTesting(
    daemon: DaemonHealthView?,
    cliAccessibility: Bool,
    cliScreenRecording: Bool,
    setupCompleted: Bool
) -> ReadinessEvaluation {
    // Reachable daemon reporting a non-active tap caps readiness to false
    // even when accessibility is missing from the payload. The daemon's tap
    // status is daemon-owned and authoritative whenever the daemon answers
    // the ping at all.
    if let view = daemon, view.inputTap.status != "active" {
        return ReadinessEvaluation(readyForTesting: false, readySource: "daemon")
    }

    guard let view = daemon,
          view.permissions.microphone == true,
          view.permissions.microphoneState == "authorized" else {
        return ReadinessEvaluation(
            readyForTesting: false,
            readySource: daemon == nil ? "cli" : "daemon"
        )
    }

    if let daemonAccessibility = view.permissions.accessibility {
        let ready = daemonAccessibility
            && cliScreenRecording
            && setupCompleted
        return ReadinessEvaluation(readyForTesting: ready, readySource: "daemon")
    }

    let ready = cliAccessibility && cliScreenRecording && setupCompleted
    return ReadinessEvaluation(readyForTesting: ready, readySource: "cli")
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
    lines.append("  ./aos serve --idle-timeout 30m     # bounded foreground fallback for this session")
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
    cmds.append("./aos serve --idle-timeout 30m")
    return cmds
}

/// Sub-guidance appended when the daemon reports listen_access or post_access
/// as known-false. Points the operator at the System Settings pane and shows
/// the resolved daemon binary path so they grant access to the right binary.
/// `nil` arguments render as "unknown" when a live value could not be resolved;
/// callers should generally only invoke this when at least one access field is
/// known false.
func inputMonitoringSubGuidance(
    listenAccess: Bool?,
    postAccess: Bool?,
    daemonBinaryPath: String
) -> String {
    func render(_ value: Bool?) -> String {
        guard let value else { return "unknown" }
        return value ? "true" : "false"
    }
    return """
    Daemon lacks Input Monitoring access (listen=\(render(listenAccess)), post=\(render(postAccess))).
    In repo mode, prefer:
      ./aos permissions reset-runtime --mode repo
      ./aos permissions setup --once
      ./aos ready --repair --post-permission
    Manual Settings fallback: Privacy & Security > Input Monitoring for daemon binary:
      \(daemonBinaryPath)
    """
}
