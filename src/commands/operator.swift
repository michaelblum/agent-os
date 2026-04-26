// operator.swift — Runtime introspection commands for operator parity.

import Foundation
import AppKit
import ApplicationServices
import CoreGraphics

// MARK: - Response Models

private struct PermissionsState: Encodable {
    let accessibility: Bool
    let screen_recording: Bool
    let listen_access: Bool
    let post_access: Bool
}

private struct DaemonViewBlock: Encodable {
    let reachable: Bool
    let accessibility: Bool?
    let input_tap: PermissionsInputTapBlock?
}

private struct PermissionsInputTapBlock: Encodable {
    let status: String
    let attempts: Int
    // Optional: a legacy daemon (lacking the structured `input_tap` block)
    // doesn't expose these. Emit with encodeIfPresent so consumers can detect
    // "unknown" rather than reading a fabricated `false`.
    let listen_access: Bool?
    let post_access: Bool?

    private enum CodingKeys: String, CodingKey {
        case status, attempts, listen_access, post_access
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(status, forKey: .status)
        try c.encode(attempts, forKey: .attempts)
        try c.encodeIfPresent(listen_access, forKey: .listen_access)
        try c.encodeIfPresent(post_access, forKey: .post_access)
    }
}

private struct CLIViewBlock: Encodable {
    let accessibility: Bool
    let screen_recording: Bool
    let listen_access: Bool
    let post_access: Bool
}

private struct DisagreementEntry: Encodable {
    let cli: Bool
    let daemon: Bool
}

private struct PermissionRequirement: Encodable {
    let id: String
    let granted: Bool
    let required_for: [String]
    let setup_trigger: String
}

private struct PermissionsSetupState: Encodable {
    let marker_exists: Bool
    let marker_path: String
    let completed_at: String?
    let bundle_path: String?
    let current_bundle_path: String
    let bundle_matches_current: Bool
    let setup_completed: Bool
    let recommended_command: String?
}

private struct RuntimeInputTapBlock: Encodable {
    let status: String
    let attempts: Int
    // Optional: a legacy daemon (lacking the structured `input_tap` block)
    // doesn't expose these. Emit with encodeIfPresent so consumers see "field
    // absent" rather than a fabricated `false`.
    let listen_access: Bool?
    let post_access: Bool?
    let last_error_at: String?

    private enum CodingKeys: String, CodingKey {
        case status, attempts, listen_access, post_access, last_error_at
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(status, forKey: .status)
        try c.encode(attempts, forKey: .attempts)
        try c.encodeIfPresent(listen_access, forKey: .listen_access)
        try c.encodeIfPresent(post_access, forKey: .post_access)
        try c.encodeIfPresent(last_error_at, forKey: .last_error_at)
    }
}

private struct RuntimeState: Encodable {
    let mode: String
    let state_dir: String
    let other_mode_state_dir: String
    let daemon_running: Bool
    let daemon_pid: Int?
    let serving_pid: Int?
    let lock_owner_pid: Int?
    let service_pid: Int?
    let ownership_state: String
    let socket_path: String
    let socket_exists: Bool
    let socket_reachable: Bool
    let other_mode_socket_path: String
    let other_mode_socket_reachable: Bool
    let uptime_seconds: Double?
    let event_tap_expected: Bool
    let input_tap_status: String?
    let input_tap_attempts: Int?
    let input_tap: RuntimeInputTapBlock?
    let installed_app_path: String
    let installed_app_exists: Bool
    let legacy_state_dir: String
    let legacy_state_items: [String]
    let repo_artifacts: [String]
}

private struct RuntimeIdentityState: Encodable {
    let program: String
    let mode: String
    let executable_path: String
    let state_dir: String
    let socket_path: String
    let build_timestamp: String?
    let repo_root: String?
    let git_commit: String?
    let bundle_version: String?
    let bundle_build: String?
}

private struct LaunchAgentState: Encodable {
    let label: String
    let installed: Bool
    let loaded: Bool
    let running: Bool
    let pid: Int?
    let plist_path: String
    let actual_binary_path: String?
    let expected_binary_path: String
    let actual_log_path: String?
    let expected_log_path: String
    let target_matches_expected: Bool
    let log_path_matches_expected: Bool
    let notes: [String]
}

private struct DoctorPlatform: Encodable {
    let os: String
    let version: String
}

private struct DoctorResponse: Encodable {
    let status: String
    let platform: DoctorPlatform
    let identity: RuntimeIdentityState
    let permissions: PermissionsState
    let permissions_requirements: [PermissionRequirement]
    let permissions_setup: PermissionsSetupState
    let runtime: RuntimeState
    let aos_service: LaunchAgentState
    let ready_for_testing: Bool
    let ready_source: String
    let notes: [String]
}

private struct PermissionsResponse: Encodable {
    let status: String
    let permissions: PermissionsState
    let daemon_view: DaemonViewBlock
    let cli_view: CLIViewBlock
    let requirements: [PermissionRequirement]
    let setup: PermissionsSetupState
    let missing_permissions: [String]
    let ready_for_testing: Bool
    let ready_source: String
    let disagreement: [String: DisagreementEntry]?
    let notes: [String]

    private enum CodingKeys: String, CodingKey {
        case status, permissions, daemon_view, cli_view, requirements, setup
        case missing_permissions, ready_for_testing, ready_source
        case disagreement, notes
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(status, forKey: .status)
        try c.encode(permissions, forKey: .permissions)
        try c.encode(daemon_view, forKey: .daemon_view)
        try c.encode(cli_view, forKey: .cli_view)
        try c.encode(requirements, forKey: .requirements)
        try c.encode(setup, forKey: .setup)
        try c.encode(missing_permissions, forKey: .missing_permissions)
        try c.encode(ready_for_testing, forKey: .ready_for_testing)
        try c.encode(ready_source, forKey: .ready_source)
        try c.encodeIfPresent(disagreement, forKey: .disagreement)
        try c.encode(notes, forKey: .notes)
    }
}

private struct PermissionsSetupResponse: Encodable {
    let status: String
    let completed: Bool
    let permissions: PermissionsState
    let requirements: [PermissionRequirement]
    let setup: PermissionsSetupState
    let missing_permissions: [String]
    let marker_path: String
    let restarted_services: [String]
    let notes: [String]
}

private struct CanvasLookupResponse: Encodable {
    let status: String
    let exists: Bool
    let daemon_running: Bool
    let socket_reachable: Bool
    let canvas: CanvasInfo?
    let notes: [String]
}

private struct GitStatusState: Encodable {
    let branch: String
    let ahead_of_origin_main: Int?
    let dirty_files: Int
    let worktrees: Int
}

private struct StatusStaleResources: Encodable {
    let status: String
    let stale_daemons: Int
    let canvases: [String]
    let notes: [String]
}

private struct StatusResponse: Encodable {
    let status: String
    let identity: RuntimeIdentityState
    let runtime: RuntimeState
    let permissions: PermissionsState
    let permissions_setup: PermissionsSetupState
    let daemon_snapshot: SpatialSnapshotData?
    let stale_resources: StatusStaleResources
    let git: GitStatusState?
    let recommended_entrypoints: [String]
    let notes: [String]
}

private struct ReadyStartupBlock: Encodable {
    let attempted: Bool
    let command: String
    let exit_code: Int32
    let status: String
}

private struct ReadyBlocker: Encodable {
    let kind: String
    let id: String
    let scope: String?
    let message: String
    let target_path: String?
    let settings_url: String?
    let blocks: [String]

    private enum CodingKeys: String, CodingKey {
        case kind, id, scope, message, target_path, settings_url, blocks
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(kind, forKey: .kind)
        try c.encode(id, forKey: .id)
        try c.encodeIfPresent(scope, forKey: .scope)
        try c.encode(message, forKey: .message)
        try c.encodeIfPresent(target_path, forKey: .target_path)
        try c.encodeIfPresent(settings_url, forKey: .settings_url)
        try c.encode(blocks, forKey: .blocks)
    }
}

private struct ReadyNextAction: Encodable {
    let type: String
    let label: String
    let command: String?

    private enum CodingKeys: String, CodingKey {
        case type, label, command
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(type, forKey: .type)
        try c.encode(label, forKey: .label)
        try c.encodeIfPresent(command, forKey: .command)
    }
}

private struct ReadyActionStep: Encodable {
    let step: String
    let result: String
    let detail: String?

    private enum CodingKeys: String, CodingKey {
        case step, result, detail
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(step, forKey: .step)
        try c.encode(result, forKey: .result)
        try c.encodeIfPresent(detail, forKey: .detail)
    }
}

private struct ReadyResponse: Encodable {
    let status: String
    let ready: Bool
    let phase: String
    let diagnosis: String
    let mode: String
    let ready_source: String
    let startup: ReadyStartupBlock
    let runtime: RuntimeState
    let permissions: PermissionsState
    let permissions_setup: PermissionsSetupState
    let blocked_capabilities: [String]
    let blockers: [ReadyBlocker]
    let next_actions: [ReadyNextAction]
    let action_trace: [ReadyActionStep]
    let notes: [String]
}

private struct DaemonHealthState {
    let servingPID: Int?
    let uptime: Double?
    let inputTapStatus: String?
    let inputTapAttempts: Int?
    let inputTapListenAccess: Bool?
    let inputTapPostAccess: Bool?
    let inputTapLastErrorAt: String?
    let daemonAccessibility: Bool?
}

// MARK: - Public Commands

func readyCommand(args: [String]) {
    if args.contains("--help") || args.contains("-h") {
        printCommandHelp(["ready"], json: args.contains("--json"))
        exit(0)
    }
    guard args.allSatisfy({ $0 == "--json" || $0 == "--repair" }) else {
        let unknown = args.first(where: { $0 != "--json" && $0 != "--repair" }) ?? ""
        exitError("Unknown flag: \(unknown). Usage: \(aosInvocationDisplayName()) ready [--json] [--repair]", code: "UNKNOWN_FLAG")
    }

    let asJSON = args.contains("--json")
    let repair = args.contains("--repair")
    let mode = aosCurrentRuntimeMode()
    let prefix = aosInvocationDisplayName()
    // Test-only escape hatch: readiness regression tests run against isolated
    // mock sockets and must not rewrite or kickstart the developer LaunchAgent.
    let skipServiceStart = ProcessInfo.processInfo.environment["AOS_TEST_SKIP_READY_SERVICE_START"] == "1"
    let serviceArgs = ["service", "start", "--mode", mode.rawValue, "--json"]
    let startupResult: ProcessOutput?
    let startup: ReadyStartupBlock
    if skipServiceStart {
        startupResult = nil
        startup = ReadyStartupBlock(
            attempted: false,
            command: "\(prefix) \(serviceArgs.joined(separator: " "))",
            exit_code: 0,
            status: "skipped"
        )
    } else {
        let result = runProcess(aosExecutablePath(), arguments: serviceArgs)
        startupResult = result
        startup = ReadyStartupBlock(
            attempted: true,
            command: "\(prefix) \(serviceArgs.joined(separator: " "))",
            exit_code: result.exitCode,
            status: result.exitCode == 0 ? "ok" : "degraded"
        )
    }

    var actionTrace: [ReadyActionStep] = []
    var response = buildReadyResponse(startup: startup, actionTrace: actionTrace, mode: mode, prefix: prefix)

    if skipServiceStart {
        actionTrace.append(ReadyActionStep(
            step: "service_start",
            result: "skipped",
            detail: "AOS_TEST_SKIP_READY_SERVICE_START=1"
        ))
    } else if let startupResult, startupResult.exitCode != 0 {
        actionTrace.append(ReadyActionStep(
            step: "service_start",
            result: "degraded",
            detail: compactProcessDetail(startupResult)
        ))
    } else {
        actionTrace.append(ReadyActionStep(step: "service_start", result: startup.status, detail: nil))
    }

    if repair && !response.ready {
        if response.blockers.contains(where: { isRepairableRuntimeBlockerID($0.id) }) {
            let restartArgs = ["service", "restart", "--mode", mode.rawValue, "--json"]
            let restart = runProcess(aosExecutablePath(), arguments: restartArgs)
            actionTrace.append(ReadyActionStep(
                step: "service_restart",
                result: restart.exitCode == 0 ? "ok" : "degraded",
                detail: compactProcessDetail(restart)
            ))
            response = waitForReadyResponse(
                startup: startup,
                actionTrace: actionTrace,
                mode: mode,
                prefix: prefix,
                budgetMs: 20_000
            )
            actionTrace = response.action_trace
        }

        if !response.ready, let settingsBlocker = firstSettingsBlocker(in: response.blockers),
           let url = settingsBlocker.settings_url {
            actionTrace.append(ReadyActionStep(
                step: "settings_handoff",
                result: "human_required",
                detail: "\(settingsOpenReason(for: settingsBlocker)) (\(url))"
            ))
            response = buildReadyResponse(startup: startup, actionTrace: actionTrace, mode: mode, prefix: prefix)
        }
    } else {
        response = buildReadyResponse(startup: startup, actionTrace: actionTrace, mode: mode, prefix: prefix)
    }

    if asJSON {
        print(jsonString(response))
    } else {
        if response.ready {
            print("ready=true mode=\(mode.rawValue) daemon=reachable tap=\(response.runtime.input_tap_status ?? "unknown")")
        } else {
            let daemonState = response.runtime.socket_reachable ? "reachable" : (response.runtime.daemon_running ? "running" : "down")
            print("ready=false phase=\(response.phase) diagnosis=\(response.diagnosis) mode=\(mode.rawValue) daemon=\(daemonState) tap=\(response.runtime.input_tap_status ?? "unknown") blocked=\(response.blocked_capabilities.joined(separator: ","))")
            if !response.action_trace.isEmpty {
                print("Action trace:")
                for step in response.action_trace {
                    print("  \(step.step): \(step.result)")
                    if let detail = step.detail, !detail.isEmpty {
                        print("    \(detail)")
                    }
                }
            }
            for blocker in response.blockers {
                if response.phase == "human_required", blocker.kind == "permission" {
                    continue
                }
                print("- \(blocker.message)")
                if let target = blocker.target_path {
                    print("  target: \(target)")
                }
                if let settings = blocker.settings_url {
                    print("  settings: \(settings)")
                }
            }
            printReadyHumanHandoff(response: response, mode: mode, prefix: prefix)
            if !response.next_actions.isEmpty {
                print("Next:")
                for action in response.next_actions {
                    if response.phase == "human_required", action.type == "open_settings" {
                        continue
                    }
                    if let command = action.command {
                        print("  \(command)  # \(action.label)")
                    } else {
                        print("  \(action.label)")
                    }
                }
            }
        }
    }

    exit(response.ready ? 0 : 1)
}

private func printReadyHumanHandoff(response: ReadyResponse, mode: AOSRuntimeMode, prefix: String) {
    guard response.phase == "human_required" else { return }
    let permissionBlockers = response.blockers.filter { $0.kind == "permission" }
    guard !permissionBlockers.isEmpty else { return }

    print("")
    print("Human action needed:")
    print("Permissions to fix:")
    for line in permissionFixLines(blockers: permissionBlockers, mode: mode) {
        print("  \(line)")
    }

    print("After fixing those rows, come back and say: ready")
    print("The agent should run: \(prefix) ready")
}

func statusCommand(args: [String]) {
    if args.contains("--help") || args.contains("-h") {
        printCommandHelp(["status"], json: args.contains("--json"))
        exit(0)
    }
    guard args.allSatisfy({ $0 == "--json" }) else {
        let unknown = args.first(where: { $0 != "--json" }) ?? ""
        exitError("Unknown flag: \(unknown). Usage: \(aosInvocationDisplayName()) status [--json]", code: "UNKNOWN_FLAG")
    }

    let prefix = aosInvocationDisplayName()
    let permissions = currentPermissionsState()
    let permissionsSetup = currentPermissionsSetupState(permissions: permissions)
    let runtime = currentRuntimeState()
    let identity = aosCurrentRuntimeIdentity(program: "aos")
    let snapshotResult = currentSpatialSnapshot()
    let cleanReport = runClean(dryRun: true)
    let git = currentGitStatus()

    var notes: [String] = []
    if !runtime.daemon_running {
        notes.append("Daemon is not running.")
    } else if !runtime.socket_reachable {
        notes.append("Daemon process appears to be running, but the socket is not reachable.")
    }
    notes.append(contentsOf: runtimeHealthNotes(runtime))
    if runtime.socket_reachable, let tap = runtime.input_tap, tap.status != "active" {
        notes.append(inputTapRecoveryGuidance(
            context: .default,
            status: tap.status,
            attempts: tap.attempts
        ))
        if tap.listen_access == false || tap.post_access == false {
            notes.append(inputMonitoringSubGuidance(
                listenAccess: tap.listen_access,
                postAccess: tap.post_access,
                daemonBinaryPath: aosExpectedBinaryPath(program: "aos", mode: aosCurrentRuntimeMode())
            ))
        }
    }
    if !permissions.accessibility {
        notes.append("Accessibility permission is not granted.")
    }
    if !permissions.screen_recording {
        notes.append("Screen Recording permission is not granted.")
    }
    if !permissionsSetup.setup_completed, let command = permissionsSetup.recommended_command {
        notes.append("Run '\(command)' before interactive testing.")
    }
    if cleanReport.status == "dirty" {
        let canvasIDs = cleanReport.canvases.map(\.id)
        if !canvasIDs.isEmpty {
            notes.append("Stale canvas cleanup recommended: \(canvasIDs.joined(separator: ", ")).")
        }
        if !cleanReport.stale_daemons.isEmpty {
            notes.append("Stale daemon cleanup recommended: \(cleanReport.stale_daemons.map { String($0.pid) }.joined(separator: ", ")).")
        }
    }
    notes.append(contentsOf: snapshotResult.notes)

    let response = StatusResponse(
        status: notes.isEmpty ? "ok" : "degraded",
        identity: RuntimeIdentityState(
            program: identity.program,
            mode: identity.mode,
            executable_path: identity.executable_path,
            state_dir: identity.state_dir,
            socket_path: identity.socket_path,
            build_timestamp: identity.build_timestamp,
            repo_root: identity.repo_root,
            git_commit: identity.git_commit,
            bundle_version: identity.bundle_version,
            bundle_build: identity.bundle_build
        ),
        runtime: runtime,
        permissions: permissions,
        permissions_setup: permissionsSetup,
        daemon_snapshot: snapshotResult.snapshot,
        stale_resources: StatusStaleResources(
            status: cleanReport.status,
            stale_daemons: cleanReport.stale_daemons.count,
            canvases: cleanReport.canvases.map(\.id),
            notes: cleanReport.notes
        ),
        git: git,
        recommended_entrypoints: [
            "\(prefix) help <command> [--json]",
            "\(prefix) introspect review",
            "\(prefix) clean"
        ],
        notes: notes
    )

    if args.contains("--json") {
        print(jsonString(response))
        return
    }

    let focusedApp = snapshotResult.snapshot?.focused_app ?? "?"
    let displays = snapshotResult.snapshot?.displays ?? 0
    let windows = snapshotResult.snapshot?.windows ?? 0
    let channels = snapshotResult.snapshot?.channels ?? 0
    let staleCanvasCount = cleanReport.canvases.count
    let tapValue: String
    if !runtime.socket_reachable {
        tapValue = "unknown"
    } else {
        tapValue = runtime.input_tap_status ?? "unknown"
    }
    let daemonState = runtime.socket_reachable ? "reachable" : (runtime.daemon_running ? "running" : "down")
    var line = "status=\(response.status) mode=\(runtime.mode) daemon=\(daemonState) pid=\(runtime.daemon_pid.map { String($0) } ?? "?") tap=\(tapValue) focused_app=\(focusedApp) displays=\(displays) windows=\(windows) channels=\(channels) stale_canvases=\(staleCanvasCount)"
    if let git {
        let ahead = git.ahead_of_origin_main.map { String($0) } ?? "?"
        line += " branch=\(git.branch) ahead=\(ahead) dirty=\(git.dirty_files)"
    }
    print(line)
    for note in response.notes {
        print(note)
    }
    print("Next: \(prefix) help <command> | \(prefix) introspect review")
}

func doctorCommand(args: [String]) {
    // Route `aos doctor gateway ...` to the gateway subcommand handler.
    if args.first == "gateway" {
        doctorGatewayCommand(args: Array(args.dropFirst()))
        return
    }
    if args.contains("--help") || args.contains("-h") {
        printCommandHelp(["doctor"], json: args.contains("--json"))
        exit(0)
    }
    guard args.allSatisfy({ $0 == "--json" }) else {
        let unknown = args.first(where: { $0 != "--json" }) ?? ""
        exitError("Unknown flag: \(unknown). Usage: \(aosInvocationDisplayName()) doctor [--json]", code: "UNKNOWN_FLAG")
    }

    let permissions = currentPermissionsState()
    let permissionRequirements = currentPermissionRequirements(permissions: permissions)
    let permissionsSetup = currentPermissionsSetupState(permissions: permissions)
    let mode = aosCurrentRuntimeMode()
    // Fetch daemon health once and share it with currentRuntimeState so the
    // ready_for_testing computation below consumes the same view that populated
    // runtime.input_tap. Avoids a race where a second fetch could fail and flip
    // ready_for_testing to the CLI fallback while recovery notes still cite the
    // daemon-reported tap state.
    let daemonHealth = fetchDaemonHealth(socketPath: aosSocketPath(for: mode))
    let runtime = currentRuntimeState(preFetchedHealth: daemonHealth)
    let aosService = launchAgentState(
        label: aosServiceLabel(for: mode),
        expectedBinaryPath: aosExpectedBinaryPath(program: "aos", mode: mode),
        logPath: aosDaemonLogPath(for: mode)
    )

    var notes: [String] = []
    if !runtime.daemon_running {
        notes.append("Daemon is not running.")
    } else if !runtime.socket_reachable {
        notes.append("Daemon process appears to be running, but the socket is not reachable.")
    }
    notes.append(contentsOf: runtimeHealthNotes(runtime))
    if runtime.other_mode_socket_reachable {
        notes.append("BROKEN STATE: \(runtime.mode) runtime is active while the \(mode.other.rawValue) socket is also reachable.")
    }
    if !permissions.accessibility {
        notes.append("Accessibility permission is not granted.")
    }
    if !permissions.screen_recording {
        notes.append("Screen Recording permission is not granted.")
    }
    if !permissionsSetup.setup_completed, let command = permissionsSetup.recommended_command {
        notes.append("Run '\(command)' before interactive testing.")
    }
    if !aosService.target_matches_expected {
        notes.append("AOS launch agent target does not match the expected \(runtime.mode) runtime binary.")
    }
    if !runtime.legacy_state_items.isEmpty {
        notes.append("Legacy shared runtime state still exists in \(runtime.legacy_state_dir).")
    }
    if !runtime.repo_artifacts.isEmpty {
        notes.append("Repo build artifacts are still present: \(runtime.repo_artifacts.joined(separator: ", ")).")
    }

    let evaluation = evaluateReadyForTesting(
        daemon: daemonHealth?.asView,
        cliAccessibility: permissions.accessibility,
        cliScreenRecording: permissions.screen_recording,
        setupCompleted: permissionsSetup.setup_completed
    )

    if runtime.socket_reachable, let tap = runtime.input_tap, tap.status != "active" {
        notes.append(inputTapRecoveryGuidance(
            context: .default,
            status: tap.status,
            attempts: tap.attempts
        ))
        if tap.listen_access == false || tap.post_access == false {
            notes.append(inputMonitoringSubGuidance(
                listenAccess: tap.listen_access,
                postAccess: tap.post_access,
                daemonBinaryPath: aosExpectedBinaryPath(program: "aos", mode: mode)
            ))
        }
    }

    let version = ProcessInfo.processInfo.operatingSystemVersion
    let identity = aosCurrentRuntimeIdentity(program: "aos")
    let response = DoctorResponse(
        status: notes.isEmpty ? "ok" : "degraded",
        platform: DoctorPlatform(
            os: "macOS",
            version: "\(version.majorVersion).\(version.minorVersion).\(version.patchVersion)"
        ),
        identity: RuntimeIdentityState(
            program: identity.program,
            mode: identity.mode,
            executable_path: identity.executable_path,
            state_dir: identity.state_dir,
            socket_path: identity.socket_path,
            build_timestamp: identity.build_timestamp,
            repo_root: identity.repo_root,
            git_commit: identity.git_commit,
            bundle_version: identity.bundle_version,
            bundle_build: identity.bundle_build
        ),
        permissions: permissions,
        permissions_requirements: permissionRequirements,
        permissions_setup: permissionsSetup,
        runtime: runtime,
        aos_service: aosService,
        ready_for_testing: evaluation.readyForTesting,
        ready_source: evaluation.readySource,
        notes: notes
    )
    print(jsonString(response))
}

func permissionsCommand(args: [String]) {
    if args.contains("--help") || args.contains("-h") {
        printCommandHelp(["permissions"], json: args.contains("--json"))
        exit(0)
    }
    guard let sub = args.first else {
        exitError("permissions requires a subcommand. Usage: aos permissions <check|preflight|setup> ...",
                  code: "MISSING_SUBCOMMAND")
    }
    switch sub {
    case "check":
        permissionsCheckCommand(args: Array(args.dropFirst()), usage: "aos permissions check [--json]")
    case "preflight":
        permissionsCheckCommand(args: Array(args.dropFirst()), usage: "aos permissions preflight [--json]")
    case "setup":
        permissionsSetupCommand(args: Array(args.dropFirst()))
    default:
        exitError("Unknown permissions subcommand: \(sub)", code: "UNKNOWN_SUBCOMMAND")
    }
}

func ensureInteractivePreflight(command: String, requiresInputTap: Bool = false) {
    if ProcessInfo.processInfo.environment["AOS_BYPASS_PREFLIGHT"] == "1" {
        return
    }

    // The setup gate may be skipped via AOS_BYPASS_PERMISSIONS_SETUP for
    // tests that want to exercise the input-tap gate without depending on
    // live macOS TCC grants for the running binary.
    if ProcessInfo.processInfo.environment["AOS_BYPASS_PERMISSIONS_SETUP"] != "1" {
        let permissions = currentPermissionsState()
        let setup = currentPermissionsSetupState(permissions: permissions)
        guard setup.setup_completed else {
            let missing = missingPermissionIDs(permissions)
            let details = missing.isEmpty
                ? "Permissions appear granted, but onboarding has not been completed for this runtime identity."
                : "Missing permissions: \(missing.joined(separator: ", "))."
            let nextStep = setup.recommended_command ?? "aos permissions setup --once"
            exitError(
                "\(command) requires upfront permissions onboarding. \(details) Run '\(nextStep)' before interactive testing.",
                code: "PERMISSIONS_SETUP_REQUIRED"
            )
        }
    }

    // Only do-family commands gate on tap state. see/inspect commands don't
    // need the input tap.
    guard requiresInputTap else { return }

    let mode = aosCurrentRuntimeMode()
    if let response = sendEnvelopeRequest(
        service: "system",
        action: "ping",
        data: [:],
        socketPath: aosSocketPath(for: mode),
        timeoutMs: 250
    ), let view = parseDaemonHealthView(from: response), view.inputTap.status != "active" {
        let guidance = inputTapRecoveryGuidance(
            context: .default,
            status: view.inputTap.status,
            attempts: view.inputTap.attempts
        )
        var message = "\(command) requires an active input tap, but the daemon reports input_tap.status=\(view.inputTap.status). \(guidance)"
        if view.inputTap.listenAccess == false || view.inputTap.postAccess == false {
            message += "\n" + inputMonitoringSubGuidance(
                listenAccess: view.inputTap.listenAccess,
                postAccess: view.inputTap.postAccess,
                daemonBinaryPath: aosExpectedBinaryPath(program: "aos", mode: mode)
            )
        }
        exitError(message, code: "INPUT_TAP_NOT_ACTIVE")
    }
}

func showExistsCommand(args: [String]) {
    let options = parseCanvasLookupArgs(args)
    let snapshot = fetchCanvasSnapshot()
    let canvas = snapshot.canvases.first(where: { $0.id == options.id })

    var notes = snapshot.notes
    if !snapshot.socketReachable {
        notes.append("Daemon socket is not reachable.")
    }

    let response = CanvasLookupResponse(
        status: snapshot.socketReachable ? "ok" : "degraded",
        exists: canvas != nil,
        daemon_running: snapshot.daemonRunning,
        socket_reachable: snapshot.socketReachable,
        canvas: nil,
        notes: notes
    )
    print(jsonString(response))
}

func showGetCommand(args: [String]) {
    let options = parseCanvasLookupArgs(args)
    let snapshot = fetchCanvasSnapshot()
    let canvas = snapshot.canvases.first(where: { $0.id == options.id })

    var notes = snapshot.notes
    if !snapshot.socketReachable {
        notes.append("Daemon socket is not reachable.")
    } else if canvas == nil {
        notes.append("Canvas '\(options.id)' was not found.")
    }

    let response = CanvasLookupResponse(
        status: snapshot.socketReachable ? "ok" : "degraded",
        exists: canvas != nil,
        daemon_running: snapshot.daemonRunning,
        socket_reachable: snapshot.socketReachable,
        canvas: canvas,
        notes: notes
    )
    print(jsonString(response))
}

// MARK: - Shared Introspection Helpers

private struct CanvasLookupOptions {
    let id: String
}

private struct CanvasSnapshot {
    let daemonRunning: Bool
    let socketReachable: Bool
    let canvases: [CanvasInfo]
    let notes: [String]
}

private struct SpatialSnapshotResult {
    let snapshot: SpatialSnapshotData?
    let notes: [String]
}

private func parseCanvasLookupArgs(_ args: [String]) -> CanvasLookupOptions {
    var id: String? = nil
    var i = 0
    while i < args.count {
        switch args[i] {
        case "--id":
            i += 1
            guard i < args.count else { exitError("--id requires a value", code: "MISSING_ARG") }
            id = args[i]
        case "--json":
            break
        default:
            exitError("Unknown argument: \(args[i])", code: "UNKNOWN_ARG")
        }
        i += 1
    }

    guard let canvasID = id else { exitError("Missing required argument: --id <name>", code: "MISSING_ARG") }
    return CanvasLookupOptions(id: canvasID)
}

private func currentGitStatus() -> GitStatusState? {
    guard let repoRoot = aosCurrentRepoRoot() else { return nil }
    let branch = runProcess("/usr/bin/git", arguments: ["-C", repoRoot, "branch", "--show-current"])
        .stdout
        .trimmingCharacters(in: .whitespacesAndNewlines)
    let aheadRaw = runProcess("/usr/bin/git", arguments: ["-C", repoRoot, "rev-list", "--count", "origin/main..HEAD"])
        .stdout
        .trimmingCharacters(in: .whitespacesAndNewlines)
    let dirtyRaw = runProcess("/usr/bin/git", arguments: ["-C", repoRoot, "status", "--porcelain"])
        .stdout
    let worktreesRaw = runProcess("/usr/bin/git", arguments: ["-C", repoRoot, "worktree", "list"])
        .stdout

    return GitStatusState(
        branch: branch.isEmpty ? "?" : branch,
        ahead_of_origin_main: Int(aheadRaw),
        dirty_files: dirtyRaw.split(whereSeparator: \.isNewline).count,
        worktrees: max(worktreesRaw.split(whereSeparator: \.isNewline).count, 1)
    )
}

private func currentPermissionsState() -> PermissionsState {
    PermissionsState(
        accessibility: AXIsProcessTrusted(),
        screen_recording: preflightScreenRecordingAccess(),
        listen_access: preflightListenEventAccess(),
        post_access: preflightPostEventAccess()
    )
}

private func currentPermissionRequirements(permissions: PermissionsState) -> [PermissionRequirement] {
    [
        PermissionRequirement(
            id: "accessibility",
            granted: permissions.accessibility,
            required_for: ["global input tap", "mouse/keyboard actions", "AX element actions"],
            setup_trigger: "AXIsProcessTrustedWithOptions prompt"
        ),
        PermissionRequirement(
            id: "screen_recording",
            granted: permissions.screen_recording,
            required_for: ["screen capture", "perception", "visual debugging"],
            setup_trigger: "CGRequestScreenCaptureAccess prompt"
        ),
        PermissionRequirement(
            id: "listen_access",
            granted: permissions.listen_access,
            required_for: ["global input tap", "input event fan-out", "hotkeys"],
            setup_trigger: "CGRequestListenEventAccess prompt"
        ),
        PermissionRequirement(
            id: "post_access",
            granted: permissions.post_access,
            required_for: ["synthetic events", "mouse/keyboard actions", "AX element actions"],
            setup_trigger: "CGRequestPostEventAccess prompt"
        )
    ]
}

private func currentPermissionsSetupState(permissions: PermissionsState) -> PermissionsSetupState {
    let markerPath = aosPermissionsMarkerPath()
    let marker = readPermissionsSetupMarker(path: markerPath)
    let currentBundlePath = Bundle.main.bundlePath
    let bundlePath = marker?["bundle_path"] as? String
    let completedAt = marker?["completed_at"] as? String
    let bundleMatchesCurrent = bundlePath == nil ? false : bundlePath == currentBundlePath
    let setupCompleted = permissions.accessibility &&
        permissions.screen_recording &&
        permissions.listen_access &&
        permissions.post_access &&
        marker != nil &&
        bundleMatchesCurrent

    return PermissionsSetupState(
        marker_exists: marker != nil,
        marker_path: markerPath,
        completed_at: completedAt,
        bundle_path: bundlePath,
        current_bundle_path: currentBundlePath,
        bundle_matches_current: bundleMatchesCurrent,
        setup_completed: setupCompleted,
        recommended_command: setupCompleted ? nil : "aos permissions setup --once"
    )
}

private func missingPermissionIDs(_ permissions: PermissionsState) -> [String] {
    var missing: [String] = []
    if !permissions.accessibility { missing.append("accessibility") }
    if !permissions.screen_recording { missing.append("screen_recording") }
    if !permissions.listen_access { missing.append("listen_access") }
    if !permissions.post_access { missing.append("post_access") }
    return missing
}

private func permissionsCheckCommand(args: [String], usage: String) {
    guard args.allSatisfy({ $0 == "--json" }) else {
        let unknown = args.first(where: { $0 != "--json" }) ?? ""
        exitError("Unknown flag: \(unknown). Usage: \(usage)", code: "UNKNOWN_FLAG")
    }

    let cliPermissions = currentPermissionsState()
    let cliView = cliView(from: cliPermissions)

    let mode = aosCurrentRuntimeMode()
    let daemonView: DaemonViewBlock
    var daemonHealth: DaemonHealthView? = nil
    if let response = sendEnvelopeRequest(
        service: "system",
        action: "ping",
        data: [:],
        socketPath: aosSocketPath(for: mode),
        timeoutMs: 250
    ), let view = parseDaemonHealthView(from: response) {
        daemonHealth = view
        daemonView = DaemonViewBlock(
            reachable: true,
            accessibility: view.permissions.accessibility,
            input_tap: PermissionsInputTapBlock(
                status: view.inputTap.status,
                attempts: view.inputTap.attempts,
                listen_access: view.inputTap.listenAccess,
                post_access: view.inputTap.postAccess
            )
        )
    } else {
        daemonView = DaemonViewBlock(reachable: false, accessibility: nil, input_tap: nil)
    }

    let setup = currentPermissionsSetupState(permissions: cliPermissions)

    let requirements = currentPermissionRequirements(permissions: cliPermissions)

    let evaluation = evaluateReadyForTesting(
        daemon: daemonHealth,
        cliAccessibility: cliPermissions.accessibility,
        cliScreenRecording: cliPermissions.screen_recording,
        setupCompleted: setup.setup_completed
    )

    let missing = missingPermissionIDsFor(
        daemon: daemonHealth,
        cli: cliView
    )

    // Disagreement only flags fields where BOTH sides have an opinion. A
    // legacy daemon that doesn't expose a field (Bool? == nil) is treated as
    // "no opinion", not as a divergence vs. the CLI view (CONTRACT-GOVERNANCE
    // rule 2: "comparable field").
    var disagreement: [String: DisagreementEntry] = [:]
    if let view = daemonHealth {
        if let daemonAcc = view.permissions.accessibility, daemonAcc != cliView.accessibility {
            disagreement["accessibility"] = DisagreementEntry(cli: cliView.accessibility, daemon: daemonAcc)
        }
        if let daemonListen = view.inputTap.listenAccess, daemonListen != cliView.listen_access {
            disagreement["listen_access"] = DisagreementEntry(cli: cliView.listen_access, daemon: daemonListen)
        }
        if let daemonPost = view.inputTap.postAccess, daemonPost != cliView.post_access {
            disagreement["post_access"] = DisagreementEntry(cli: cliView.post_access, daemon: daemonPost)
        }
    }

    var notes: [String] = []
    if !cliPermissions.accessibility {
        notes.append("Accessibility permission is not granted (CLI view).")
    }
    if !cliPermissions.screen_recording {
        notes.append("Screen Recording permission is not granted.")
    }
    if !cliPermissions.listen_access {
        notes.append("Input Monitoring listen access is not granted (CLI view).")
    }
    if !cliPermissions.post_access {
        notes.append("Input Monitoring post access is not granted (CLI view).")
    }
    if !setup.marker_exists {
        notes.append("Permission onboarding has not been completed for this runtime identity.")
    } else if !setup.bundle_matches_current {
        notes.append("Permission onboarding marker belongs to a different app bundle path.")
    }
    if let command = setup.recommended_command {
        notes.append("Run '\(command)' before interactive testing.")
    }
    if daemonHealth == nil {
        notes.append("Daemon unreachable; readiness computed from CLI preflights only.")
    } else if let view = daemonHealth, view.inputTap.status != "active" {
        notes.append(inputTapRecoveryGuidance(
            context: .default,
            status: view.inputTap.status,
            attempts: view.inputTap.attempts
        ))
        if view.inputTap.listenAccess == false || view.inputTap.postAccess == false {
            notes.append(inputMonitoringSubGuidance(
                listenAccess: view.inputTap.listenAccess,
                postAccess: view.inputTap.postAccess,
                daemonBinaryPath: aosExpectedBinaryPath(program: "aos", mode: mode)
            ))
        }
    }

    let response = PermissionsResponse(
        status: notes.isEmpty ? "ok" : "degraded",
        permissions: cliPermissions,
        daemon_view: daemonView,
        cli_view: cliView,
        requirements: requirements,
        setup: setup,
        missing_permissions: missing,
        ready_for_testing: evaluation.readyForTesting,
        ready_source: evaluation.readySource,
        disagreement: disagreement.isEmpty ? nil : disagreement,
        notes: notes
    )
    print(jsonString(response))
}

private func missingPermissionIDsFor(daemon: DaemonHealthView?, cli: CLIViewBlock) -> [String] {
    var missing: [String] = []
    let accessibility = daemon?.permissions.accessibility ?? cli.accessibility
    let listen = daemon?.inputTap.listenAccess ?? cli.listen_access
    let post = daemon?.inputTap.postAccess ?? cli.post_access
    if !accessibility { missing.append("accessibility") }
    if !cli.screen_recording { missing.append("screen_recording") }
    if !listen { missing.append("listen_access") }
    if !post { missing.append("post_access") }
    return missing
}

private func cliView(from permissions: PermissionsState) -> CLIViewBlock {
    CLIViewBlock(
        accessibility: permissions.accessibility,
        screen_recording: permissions.screen_recording,
        listen_access: permissions.listen_access,
        post_access: permissions.post_access
    )
}

private func permissionRecoveryNotes(missing: [String], mode: AOSRuntimeMode) -> [String] {
    var notes: [String] = []
    for id in missing {
        switch id {
        case "accessibility":
            notes.append(staleGrantGuidance(mode: mode, service: "Accessibility"))
        case "screen_recording":
            notes.append("Screen Recording permission is not granted. Run \(aosInvocationDisplayName()) permissions setup --once or grant Screen Recording in System Settings.")
        case "listen_access":
            notes.append(staleGrantGuidance(mode: mode, service: "Input Monitoring listen access"))
        case "post_access":
            notes.append(staleGrantGuidance(mode: mode, service: "Input Monitoring post access"))
        default:
            notes.append("Missing permission: \(id).")
        }
    }
    return notes
}

private func permissionPanel(for id: String) -> String {
    switch id {
    case "accessibility":
        return "Accessibility"
    case "screen_recording":
        return "Screen Recording"
    case "listen_access", "post_access", "input_monitoring_listen", "input_monitoring_post":
        return "Input Monitoring"
    default:
        return id
    }
}

private func permissionEntryName(mode: AOSRuntimeMode) -> String {
    switch mode {
    case .repo:
        return "aos"
    case .installed:
        return "AOS.app"
    }
}

private func permissionAction(for blocker: ReadyBlocker, mode: AOSRuntimeMode) -> String {
    if mode == .repo, blocker.scope == "daemon" {
        return "remove/add back"
    }
    return "enable"
}

private func permissionFixLines(blockers: [ReadyBlocker], mode: AOSRuntimeMode) -> [String] {
    var seen = Set<String>()
    var lines: [String] = []
    for blocker in blockers {
        let panel = permissionPanel(for: blocker.id)
        let action = permissionAction(for: blocker, mode: mode)
        let key = "\(panel)|\(action)"
        if seen.insert(key).inserted {
            lines.append("\(panel) -> \(permissionEntryName(mode: mode)) (\(action))")
        }
    }
    return lines
}

private func buildReadyResponse(
    startup: ReadyStartupBlock,
    actionTrace: [ReadyActionStep],
    mode: AOSRuntimeMode,
    prefix: String
) -> ReadyResponse {
    let permissions = currentPermissionsState()
    let setup = currentPermissionsSetupState(permissions: permissions)
    let daemonHealth = fetchDaemonHealth(socketPath: aosSocketPath(for: mode))
    let runtime = currentRuntimeState(preFetchedHealth: daemonHealth)
    let evaluation = evaluateReadyForTesting(
        daemon: daemonHealth?.asView,
        cliAccessibility: permissions.accessibility,
        cliScreenRecording: permissions.screen_recording,
        setupCompleted: setup.setup_completed
    )
    let blockers = readyBlockers(
        runtime: runtime,
        daemon: daemonHealth?.asView,
        permissions: permissions,
        setup: setup,
        mode: mode
    )
    let ready = runtime.socket_reachable && evaluation.readyForTesting && blockers.isEmpty
    let blockedCapabilities = Array(Set(blockers.flatMap(\.blocks))).sorted()
    let phase = readyPhase(ready: ready, blockers: blockers)
    let diagnosis = readyDiagnosis(
        ready: ready,
        blockers: blockers,
        daemon: daemonHealth?.asView,
        permissions: permissions
    )

    return ReadyResponse(
        status: ready ? "ok" : "degraded",
        ready: ready,
        phase: phase,
        diagnosis: diagnosis,
        mode: mode.rawValue,
        ready_source: evaluation.readySource,
        startup: startup,
        runtime: runtime,
        permissions: permissions,
        permissions_setup: setup,
        blocked_capabilities: blockedCapabilities,
        blockers: blockers,
        next_actions: readyNextActions(blockers: blockers, setup: setup, mode: mode, prefix: prefix),
        action_trace: actionTrace,
        notes: readyNotes(
            runtime: runtime,
            daemon: daemonHealth?.asView,
            permissions: permissions,
            setup: setup,
            mode: mode
        )
    )
}

private func waitForReadyResponse(
    startup: ReadyStartupBlock,
    actionTrace: [ReadyActionStep],
    mode: AOSRuntimeMode,
    prefix: String,
    budgetMs: Int
) -> ReadyResponse {
    let deadline = Date().addingTimeInterval(Double(budgetMs) / 1000.0)
    var trace = actionTrace
    var response = buildReadyResponse(startup: startup, actionTrace: trace, mode: mode, prefix: prefix)
    while Date() < deadline {
        response = buildReadyResponse(startup: startup, actionTrace: trace, mode: mode, prefix: prefix)
        if response.ready {
            trace.append(ReadyActionStep(step: "wait_for_recovery", result: "ready", detail: "daemon became ready during repair wait"))
            return buildReadyResponse(startup: startup, actionTrace: trace, mode: mode, prefix: prefix)
        }
        usleep(500_000)
    }
    trace.append(ReadyActionStep(step: "wait_for_recovery", result: "timed_out", detail: "daemon did not become ready within \(budgetMs)ms"))
    return buildReadyResponse(startup: startup, actionTrace: trace, mode: mode, prefix: prefix)
}

private func firstSettingsBlocker(in blockers: [ReadyBlocker]) -> ReadyBlocker? {
    blockers.first(where: { $0.settings_url != nil })
}

private func settingsOpenReason(for blocker: ReadyBlocker) -> String {
    switch blocker.id {
    case "accessibility":
        return "review Accessibility access for \(blocker.scope ?? "AOS")"
    case "screen_recording":
        return "review Screen Recording access for \(blocker.scope ?? "AOS")"
    case "input_monitoring_listen", "input_monitoring_post":
        return "review Input Monitoring access for \(blocker.scope ?? "AOS")"
    default:
        return "review \(blocker.id)"
    }
}

private func runtimeIdentityLabel(mode: AOSRuntimeMode) -> String {
    switch mode {
    case .repo:
        return "repo-mode 'aos'"
    case .installed:
        return "installed-mode 'AOS.app'"
    }
}

private func staleGrantGuidance(mode: AOSRuntimeMode, service: String) -> String {
    let panel: String
    if service.lowercased().contains("input monitoring") {
        panel = "Input Monitoring"
    } else if service.lowercased().contains("screen") {
        panel = "Screen Recording"
    } else {
        panel = "Accessibility"
    }
    let entry = permissionEntryName(mode: mode)
    switch mode {
    case .repo:
        return "\(panel) -> \(entry) (remove/add back)"
    case .installed:
        return "\(panel) -> \(entry) (enable)"
    }
}

private func readyPhase(ready: Bool, blockers: [ReadyBlocker]) -> String {
    if ready { return "ready" }
    if blockers.contains(where: { $0.id == "daemon_unreachable" }) { return "runtime_blocked" }
    if blockers.contains(where: { $0.id == "daemon_ownership_mismatch" }) { return "runtime_blocked" }
    if blockers.contains(where: { $0.kind == "permission" }) { return "human_required" }
    if blockers.contains(where: { $0.id == "input_tap_not_active" }) { return "runtime_blocked" }
    if blockers.contains(where: { $0.kind == "setup" }) { return "setup_required" }
    return "degraded"
}

private func readyDiagnosis(
    ready: Bool,
    blockers: [ReadyBlocker],
    daemon: DaemonHealthView?,
    permissions: PermissionsState
) -> String {
    if ready { return "ready" }
    if blockers.contains(where: { $0.id == "daemon_ownership_mismatch" }) {
        return "daemon_ownership_mismatch"
    }
    if blockers.contains(where: { $0.id == "daemon_unreachable" }) {
        return "daemon_socket_unreachable"
    }
    if let view = daemon,
       (view.permissions.accessibility == false && permissions.accessibility) ||
        (view.inputTap.listenAccess == false || view.inputTap.postAccess == false) {
        return "daemon_tcc_grant_stale_or_missing"
    }
    if blockers.contains(where: { $0.id == "input_tap_not_active" }) {
        return "input_tap_not_active"
    }
    if blockers.contains(where: { $0.kind == "setup" }) {
        return "permissions_onboarding_required"
    }
    return "not_ready"
}

private func readyBlockers(
    runtime: RuntimeState,
    daemon: DaemonHealthView?,
    permissions: PermissionsState,
    setup: PermissionsSetupState,
    mode: AOSRuntimeMode
) -> [ReadyBlocker] {
    var blockers: [ReadyBlocker] = []
    let daemonPath = aosExpectedBinaryPath(program: "aos", mode: mode)
    let currentPath = aosExecutablePath()

    if !runtime.socket_reachable {
        blockers.append(ReadyBlocker(
            kind: "runtime",
            id: "daemon_unreachable",
            scope: "daemon",
            message: runtime.daemon_running
                ? "Daemon process appears to be running, but the socket is not reachable."
                : "Daemon is not running or did not become reachable.",
            target_path: daemonPath,
            settings_url: nil,
            blocks: ["see", "do", "show", "tell", "listen"]
        ))
    }

    if runtime.ownership_state == "mismatch" {
        let serving = runtime.serving_pid.map(String.init) ?? "none"
        let lock = runtime.lock_owner_pid.map(String.init) ?? "none"
        let service = runtime.service_pid.map(String.init) ?? "none"
        blockers.append(ReadyBlocker(
            kind: "runtime",
            id: "daemon_ownership_mismatch",
            scope: "daemon",
            message: "Daemon ownership mismatch: serving pid=\(serving), lock pid=\(lock), service pid=\(service).",
            target_path: daemonPath,
            settings_url: nil,
            blocks: ["see", "do", "show", "tell", "listen"]
        ))
    }

    if !permissions.accessibility {
        blockers.append(ReadyBlocker(
            kind: "permission",
            id: "accessibility",
            scope: "cli",
            message: "CLI lacks Accessibility permission.",
            target_path: currentPath,
            settings_url: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
            blocks: ["see", "do", "inspect"]
        ))
    }

    if daemon?.permissions.accessibility == false {
        blockers.append(ReadyBlocker(
            kind: "permission",
            id: "accessibility",
            scope: "daemon",
            message: staleGrantGuidance(mode: mode, service: "Accessibility"),
            target_path: daemonPath,
            settings_url: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
            blocks: ["see", "do", "inspect", "listen"]
        ))
    }

    if !permissions.screen_recording {
        blockers.append(ReadyBlocker(
            kind: "permission",
            id: "screen_recording",
            scope: "cli",
            message: "CLI lacks Screen Recording permission.",
            target_path: currentPath,
            settings_url: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
            blocks: ["see"]
        ))
    }

    if let tap = daemon?.inputTap, tap.status != "active" {
        blockers.append(ReadyBlocker(
            kind: "runtime",
            id: "input_tap_not_active",
            scope: "daemon",
            message: "Daemon input tap is not active (status=\(tap.status), attempts=\(tap.attempts)).",
            target_path: daemonPath,
            settings_url: nil,
            blocks: ["see", "do", "listen"]
        ))
    }

    if daemon?.inputTap.listenAccess == false {
        blockers.append(ReadyBlocker(
            kind: "permission",
            id: "input_monitoring_listen",
            scope: "daemon",
            message: staleGrantGuidance(mode: mode, service: "Input Monitoring listen access"),
            target_path: daemonPath,
            settings_url: "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent",
            blocks: ["see", "listen"]
        ))
    }

    if daemon?.inputTap.postAccess == false {
        blockers.append(ReadyBlocker(
            kind: "permission",
            id: "input_monitoring_post",
            scope: "daemon",
            message: staleGrantGuidance(mode: mode, service: "Input Monitoring post access"),
            target_path: daemonPath,
            settings_url: "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent",
            blocks: ["do"]
        ))
    }

    if !setup.setup_completed {
        blockers.append(ReadyBlocker(
            kind: "setup",
            id: "permissions_onboarding",
            scope: nil,
            message: "Permission onboarding has not completed for this runtime identity.",
            target_path: nil,
            settings_url: nil,
            blocks: ["see", "do", "inspect"]
        ))
    }

    return blockers
}

private func isRepairableRuntimeBlockerID(_ id: String) -> Bool {
    return id == "daemon_unreachable" ||
        id == "daemon_ownership_mismatch" ||
        id == "input_tap_not_active"
}

private func readyNextActions(blockers: [ReadyBlocker], setup: PermissionsSetupState, mode: AOSRuntimeMode, prefix: String) -> [ReadyNextAction] {
    var actions: [ReadyNextAction] = []
    var seen = Set<String>()

    func append(_ action: ReadyNextAction) {
        let key = "\(action.type)|\(action.command ?? action.label)"
        if seen.insert(key).inserted {
            actions.append(action)
        }
    }

    if blockers.isEmpty {
        return actions
    }

    if blockers.contains(where: { isRepairableRuntimeBlockerID($0.id) || $0.kind == "permission" }) {
        append(ReadyNextAction(
            type: "command",
            label: "run automated repair: restart/recheck, then print human instructions if needed",
            command: "\(prefix) ready --repair"
        ))
    }

    if blockers.contains(where: { isRepairableRuntimeBlockerID($0.id) }) {
        append(ReadyNextAction(
            type: "command",
            label: "restart the managed daemon and re-check readiness",
            command: "\(prefix) service restart --mode \(mode.rawValue)"
        ))
    }

    if !setup.setup_completed {
        append(ReadyNextAction(
            type: "command",
            label: "run permission onboarding",
            command: setup.recommended_command ?? "\(prefix) permissions setup --once"
        ))
    }

    for blocker in blockers where blocker.kind == "permission" {
        if let settingsURL = blocker.settings_url {
            append(ReadyNextAction(
                type: "open_settings",
                label: "open System Settings to \(settingsOpenReason(for: blocker))",
                command: "open \"\(settingsURL)\""
            ))
        }
    }

    append(ReadyNextAction(
        type: "command",
        label: "re-check readiness",
        command: "\(prefix) ready"
    ))

    return actions
}

private func compactProcessDetail(_ output: ProcessOutput) -> String? {
    let combined = [output.stderr, output.stdout]
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
        .joined(separator: "\n")
        .trimmingCharacters(in: .whitespacesAndNewlines)
    guard !combined.isEmpty else { return nil }

    if let data = combined.data(using: .utf8),
       let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
        if let error = object["error"] as? [String: Any] {
            let code = error["code"].map { "\($0)" } ?? "unknown"
            let message = error["message"].map { "\($0)" } ?? ""
            return message.isEmpty ? "error=\(code)" : "error=\(code): \(message)"
        }
        let status = object["status"].map { "\($0)" }
        let reason = object["reason"].map { "\($0)" }
        let inputTap = object["input_tap"] as? [String: Any]
        let tapStatus = inputTap?["status"].map { "\($0)" }
        let attempts = inputTap?["attempts"].map { "\($0)" }
        let parts = [
            status.map { "status=\($0)" },
            reason.map { "reason=\($0)" },
            tapStatus.map { "tap=\($0)" },
            attempts.map { "attempts=\($0)" }
        ].compactMap { $0 }
        if !parts.isEmpty {
            return parts.joined(separator: " ")
        }
    }

    let lines = combined.split(separator: "\n").prefix(6).map(String.init)
    let clipped = lines.joined(separator: "\n")
    if clipped.count <= 700 {
        return clipped
    }
    return String(clipped.prefix(700)) + "..."
}

private func readyNotes(
    runtime: RuntimeState,
    daemon: DaemonHealthView?,
    permissions: PermissionsState,
    setup: PermissionsSetupState,
    mode: AOSRuntimeMode
) -> [String] {
    var notes: [String] = []
    if !runtime.daemon_running {
        notes.append("Daemon is not running.")
    } else if !runtime.socket_reachable {
        notes.append("Daemon process appears to be running, but the socket is not reachable.")
    }
    notes.append(contentsOf: runtimeHealthNotes(runtime))
    if let tap = daemon?.inputTap, tap.status != "active" {
        notes.append(inputTapRecoveryGuidance(
            context: .default,
            status: tap.status,
            attempts: tap.attempts
        ))
        if tap.listenAccess == false || tap.postAccess == false {
            notes.append(inputMonitoringSubGuidance(
                listenAccess: tap.listenAccess,
                postAccess: tap.postAccess,
                daemonBinaryPath: aosExpectedBinaryPath(program: "aos", mode: mode)
            ))
        }
    }
    if !permissions.accessibility {
        notes.append("Accessibility permission is not granted (CLI view).")
    }
    if daemon?.permissions.accessibility == false {
        notes.append("Accessibility permission is not granted (daemon view).")
    }
    if !permissions.screen_recording {
        notes.append("Screen Recording permission is not granted.")
    }
    if !setup.setup_completed, let command = setup.recommended_command {
        notes.append("Run '\(command)' before interactive testing.")
    }
    return notes
}

private func currentRuntimeState(preFetchedHealth: DaemonHealthState? = nil) -> RuntimeState {
    let mode = aosCurrentRuntimeMode()
    let socketPath = aosSocketPath(for: mode)
    let otherModeSocketPath = aosSocketPath(for: mode.other)
    let socketExists = FileManager.default.fileExists(atPath: socketPath)
    let socketReachable = socketIsReachable(socketPath)
    let otherSocketReachable = socketIsReachable(otherModeSocketPath)
    let health = preFetchedHealth ?? fetchDaemonHealth(socketPath: socketPath)
    let explicitStateRootOverride = aosHasExplicitStateRootOverride()
    let servicePID = explicitStateRootOverride ? nil : launchdProcessID(label: aosServiceLabel(for: mode))
    let lockOwnerPID = aosDaemonLockOwnerPID(for: mode)
    let servingPID = health?.servingPID
    let daemonPID = servingPID ?? lockOwnerPID ?? servicePID ?? fallbackDaemonProcessID()
    let daemonRunning = daemonPID != nil || socketReachable
    let ownershipState = currentOwnershipState(
        socketReachable: socketReachable,
        servingPID: servingPID,
        lockOwnerPID: lockOwnerPID,
        servicePID: servicePID
    )

    let inputTapBlock: RuntimeInputTapBlock?
    if let status = health?.inputTapStatus, let attempts = health?.inputTapAttempts {
        // listen/post may be nil when talking to a legacy daemon that doesn't
        // expose them; preserve the unknown signal rather than coercing to false.
        inputTapBlock = RuntimeInputTapBlock(
            status: status,
            attempts: attempts,
            listen_access: health?.inputTapListenAccess,
            post_access: health?.inputTapPostAccess,
            last_error_at: health?.inputTapLastErrorAt
        )
    } else {
        inputTapBlock = nil
    }

    return RuntimeState(
        mode: mode.rawValue,
        state_dir: aosStateDir(for: mode),
        other_mode_state_dir: aosStateDir(for: mode.other),
        daemon_running: daemonRunning,
        daemon_pid: daemonPID,
        serving_pid: servingPID,
        lock_owner_pid: lockOwnerPID,
        service_pid: servicePID,
        ownership_state: ownershipState,
        socket_path: socketPath,
        socket_exists: socketExists,
        socket_reachable: socketReachable,
        other_mode_socket_path: otherModeSocketPath,
        other_mode_socket_reachable: otherSocketReachable,
        uptime_seconds: health?.uptime,
        event_tap_expected: true,
        input_tap_status: health?.inputTapStatus,
        input_tap_attempts: health?.inputTapAttempts,
        input_tap: inputTapBlock,
        installed_app_path: aosInstallAppPath(),
        installed_app_exists: FileManager.default.fileExists(atPath: aosInstallAppPath()),
        legacy_state_dir: aosLegacyStateDir(),
        legacy_state_items: legacyStateItems(),
        repo_artifacts: repoArtifactList()
    )
}

private func fetchCanvasSnapshot() -> CanvasSnapshot {
    let runtime = currentRuntimeState()
    guard runtime.socket_reachable else {
        return CanvasSnapshot(
            daemonRunning: runtime.daemon_running,
            socketReachable: false,
            canvases: [],
            notes: runtime.daemon_running
                ? ["Daemon appears to be running, but canvas state is unavailable because the socket is not reachable."]
                : ["Daemon is not running."]
        )
    }

    let request = CanvasRequest(action: "list")
    let client = DaemonClient()
    let response = client.send(request)
    if let canvases = response.canvases {
        return CanvasSnapshot(
            daemonRunning: runtime.daemon_running,
            socketReachable: true,
            canvases: canvases,
            notes: []
        )
    }

    return CanvasSnapshot(
        daemonRunning: runtime.daemon_running,
        socketReachable: true,
        canvases: [],
        notes: response.error.map { [$0] } ?? ["Failed to decode canvas list."]
    )
}

private func currentSpatialSnapshot() -> SpatialSnapshotResult {
    guard let response = sendEnvelopeRequest(service: "see", action: "snapshot", data: [:]) else {
        return SpatialSnapshotResult(snapshot: nil, notes: ["Daemon snapshot is unavailable."])
    }
    if let error = response["error"] as? String {
        return SpatialSnapshotResult(snapshot: nil, notes: [error])
    }
    let snapshotDict = (response["data"] as? [String: Any])?["snapshot"] as? [String: Any]
        ?? response["snapshot"] as? [String: Any]
    guard let snapshotDict,
          let data = try? JSONSerialization.data(withJSONObject: snapshotDict, options: [.sortedKeys]),
          let snapshot = try? JSONDecoder().decode(SpatialSnapshotData.self, from: data) else {
        return SpatialSnapshotResult(snapshot: nil, notes: ["Failed to decode daemon snapshot."])
    }
    return SpatialSnapshotResult(snapshot: snapshot, notes: [])
}

private func fallbackDaemonProcessID() -> Int? {
    let output = runProcess("/usr/bin/pgrep", arguments: ["-f", "aos serve"])
    guard output.exitCode == 0 else { return nil }
    return output.stdout
        .split(whereSeparator: \.isNewline)
        .compactMap { Int($0.trimmingCharacters(in: .whitespaces)) }
        .first
}

private func launchdProcessID(label: String) -> Int? {
    let domain = "gui/\(getuid())/\(label)"
    let output = runProcess("/bin/launchctl", arguments: ["print", domain])
    guard output.exitCode == 0 else { return nil }

    for rawLine in output.stdout.split(whereSeparator: \.isNewline) {
        let line = rawLine.trimmingCharacters(in: .whitespaces)
        if line.hasPrefix("pid = ") {
            return Int(line.replacingOccurrences(of: "pid = ", with: ""))
        }
    }
    return nil
}

private func fetchDaemonHealth(socketPath: String) -> DaemonHealthState? {
    guard let response = sendEnvelopeRequest(service: "system", action: "ping", data: [:], socketPath: socketPath, timeoutMs: 250) else {
        return nil
    }
    let payload = (response["data"] as? [String: Any]) ?? response
    // parseDaemonHealthView already accepts both the structured `input_tap`
    // block and the legacy flat `input_tap_status`/`input_tap_attempts` shape.
    let view = parseDaemonHealthView(from: response)
    return DaemonHealthState(
        servingPID: payload["pid"] as? Int,
        uptime: payload["uptime"] as? Double,
        inputTapStatus: view?.inputTap.status,
        inputTapAttempts: view?.inputTap.attempts,
        inputTapListenAccess: view?.inputTap.listenAccess,
        inputTapPostAccess: view?.inputTap.postAccess,
        inputTapLastErrorAt: view?.inputTap.lastErrorAt,
        daemonAccessibility: view?.permissions.accessibility
    )
}

extension DaemonHealthState {
    /// Reconstruct the typed daemon health view from this state. Returns nil
    /// when the minimum (status + attempts) is missing — i.e. the daemon
    /// either was unreachable or returned a payload that the parser couldn't
    /// classify. Listen/post/accessibility carry their unknown (nil) signal
    /// through unchanged for the legacy-daemon case.
    var asView: DaemonHealthView? {
        guard let status = inputTapStatus, let attempts = inputTapAttempts else { return nil }
        return DaemonHealthView(
            inputTap: InputTapHealth(
                status: status,
                attempts: attempts,
                listenAccess: inputTapListenAccess,
                postAccess: inputTapPostAccess,
                lastErrorAt: inputTapLastErrorAt
            ),
            permissions: DaemonPermissions(accessibility: daemonAccessibility)
        )
    }
}

private func currentOwnershipState(
    socketReachable: Bool,
    servingPID: Int?,
    lockOwnerPID: Int?,
    servicePID: Int?
) -> String {
    let pids = [servingPID, lockOwnerPID, servicePID].compactMap { $0 }
    if pids.isEmpty {
        return socketReachable ? "unknown" : "absent"
    }
    return Set(pids).count <= 1 ? "consistent" : "mismatch"
}

private func runtimeHealthNotes(_ runtime: RuntimeState) -> [String] {
    var notes: [String] = []
    if runtime.ownership_state == "mismatch" {
        let serving = runtime.serving_pid.map(String.init) ?? "none"
        let lock = runtime.lock_owner_pid.map(String.init) ?? "none"
        let service = runtime.service_pid.map(String.init) ?? "none"
        notes.append("Daemon ownership mismatch: serving pid=\(serving), lock pid=\(lock), service pid=\(service).")
    }
    // Suppress when the typed runtime.input_tap block is present: callers
    // (statusCommand, doctorCommand) emit a richer headline via
    // inputTapRecoveryGuidance that supersedes this short one.
    if runtime.event_tap_expected, let tapStatus = runtime.input_tap_status,
       tapStatus != "active", runtime.input_tap == nil {
        notes.append("Perception input tap is not active (status=\(tapStatus)).")
    }
    return notes
}

private func launchAgentState(label: String, expectedBinaryPath: String, logPath: String) -> LaunchAgentState {
    let home = aosHomeDir()
    let plistPath = "\(home)/Library/LaunchAgents/\(label).plist"
    let installed = FileManager.default.fileExists(atPath: plistPath)
    let loaded = installed && isLaunchAgentLoaded(label: label)
    let pid = launchdProcessID(label: label)
    let running = pid != nil
    let actualBinaryPath = installed ? plistProgramPathAt(path: plistPath) : nil
    let actualLogPath = installed ? plistValueAt(path: plistPath, keyPath: ":StandardErrorPath") : nil
    var notes: [String] = []

    if !installed {
        notes.append("Launch agent plist is not installed.")
    } else if !loaded {
        notes.append("Launch agent plist exists but is not loaded.")
    }
    if installed && !running {
        notes.append("Launch agent is not running.")
    }
    if let actualBinaryPath, actualBinaryPath != expectedBinaryPath {
        notes.append("Launch agent target differs from the expected binary.")
    }
    if let actualLogPath, actualLogPath != logPath {
        notes.append("Launch agent log path differs from the expected state directory.")
    }

    return LaunchAgentState(
        label: label,
        installed: installed,
        loaded: loaded,
        running: running,
        pid: pid,
        plist_path: plistPath,
        actual_binary_path: actualBinaryPath,
        expected_binary_path: expectedBinaryPath,
        actual_log_path: actualLogPath,
        expected_log_path: logPath,
        target_matches_expected: actualBinaryPath == nil ? !installed : actualBinaryPath == expectedBinaryPath,
        log_path_matches_expected: actualLogPath == nil ? !installed : actualLogPath == logPath,
        notes: notes
    )
}

private func isLaunchAgentLoaded(label: String) -> Bool {
    runProcess("/bin/launchctl", arguments: ["print", "gui/\(getuid())/\(label)"]).exitCode == 0
}

private func plistProgramPathAt(path: String) -> String? {
    plistValueAt(path: path, keyPath: ":ProgramArguments:0")
}

private func plistValueAt(path: String, keyPath: String) -> String? {
    let output = runProcess("/usr/libexec/PlistBuddy", arguments: ["-c", "Print \(keyPath)", path])
    guard output.exitCode == 0 else { return nil }
    let value = output.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
    return value.isEmpty ? nil : value
}

private func legacyStateItems() -> [String] {
    let legacyDir = aosLegacyStateDir()
    let modeDirs = Set(AOSRuntimeMode.allCases.map(\.rawValue))
    guard let items = try? FileManager.default.contentsOfDirectory(atPath: legacyDir) else { return [] }
    return items
        .filter { !modeDirs.contains($0) }
        .sorted()
}

private func repoArtifactList() -> [String] {
    guard let repoRoot = aosCurrentRepoRoot() else { return [] }
    let mode = aosCurrentRuntimeMode()
    var candidates = ["\(repoRoot)/dist"]
    if mode != .repo {
        candidates.append("\(repoRoot)/aos")
    }
    return candidates.filter { FileManager.default.fileExists(atPath: $0) }
}

private func preflightScreenRecordingAccess() -> Bool {
    if #available(macOS 10.15, *) {
        return CGPreflightScreenCaptureAccess()
    }
    return true
}

private func preflightListenEventAccess() -> Bool {
    if #available(macOS 10.15, *) {
        return CGPreflightListenEventAccess()
    }
    return true
}

private func preflightPostEventAccess() -> Bool {
    if #available(macOS 10.15, *) {
        return CGPreflightPostEventAccess()
    }
    return true
}

private func requestListenEventAccess() -> Bool {
    if #available(macOS 10.15, *) {
        return CGRequestListenEventAccess()
    }
    return true
}

private func requestPostEventAccess() -> Bool {
    if #available(macOS 10.15, *) {
        return CGRequestPostEventAccess()
    }
    return true
}

private struct PermissionsSetupOptions {
    let asJSON: Bool
    let once: Bool
}

private func permissionsSetupCommand(args: [String]) {
    let options = parsePermissionsSetupArgs(args)
    let response = runPermissionsSetup(once: options.once)
    if options.asJSON {
        print(jsonString(response))
        return
    }

    print("completed=\(response.completed) accessibility=\(response.permissions.accessibility) screen_recording=\(response.permissions.screen_recording) listen_access=\(response.permissions.listen_access) post_access=\(response.permissions.post_access)")
    // This summary line is the CLI-side setup state. The structured response
    // below can still be degraded when daemon-owned grants are stale.
    let setupEval = evaluateReadyForTesting(
        daemon: nil,
        cliAccessibility: response.permissions.accessibility,
        cliScreenRecording: response.permissions.screen_recording,
        setupCompleted: response.setup.setup_completed
    )
    print("ready_for_testing=\(setupEval.readyForTesting)")
    if !response.restarted_services.isEmpty {
        print("restarted=\(response.restarted_services.joined(separator: ","))")
    }
    if !response.notes.isEmpty {
        for note in response.notes {
            print(note)
        }
    }
}

private func parsePermissionsSetupArgs(_ args: [String]) -> PermissionsSetupOptions {
    var asJSON = false
    var once = false

    for arg in args {
        switch arg {
        case "--json":
            asJSON = true
        case "--once":
            once = true
        default:
            exitError("Unknown flag: \(arg). Usage: aos permissions setup [--json] [--once]",
                      code: "UNKNOWN_FLAG")
        }
    }

    return PermissionsSetupOptions(asJSON: asJSON, once: once)
}

private func runPermissionsSetup(once: Bool) -> PermissionsSetupResponse {
    let markerPath = aosPermissionsMarkerPath()
    let mode = aosCurrentRuntimeMode()
    let initial = currentPermissionsState()
    let initialSetup = currentPermissionsSetupState(permissions: initial)
    let initialRequirements = currentPermissionRequirements(permissions: initial)
    let initialDaemonHealth = fetchDaemonHealth(socketPath: aosSocketPath(for: mode))?.asView
    let initialMissing = missingPermissionIDsFor(
        daemon: initialDaemonHealth,
        cli: cliView(from: initial)
    )

    if once && initialSetup.setup_completed && initialMissing.isEmpty {
        return PermissionsSetupResponse(
            status: "ok",
            completed: true,
            permissions: initial,
            requirements: initialRequirements,
            setup: initialSetup,
            missing_permissions: [],
            marker_path: markerPath,
            restarted_services: [],
            notes: ["Permissions are already granted; onboarding was skipped."]
        )
    }

    if once && initialSetup.setup_completed && !initialMissing.isEmpty {
        return PermissionsSetupResponse(
            status: "degraded",
            completed: false,
            permissions: initial,
            requirements: initialRequirements,
            setup: initialSetup,
            missing_permissions: initialMissing,
            marker_path: markerPath,
            restarted_services: [],
            notes: permissionRecoveryNotes(missing: initialMissing, mode: mode)
        )
    }

    if once &&
        initial.accessibility &&
        initial.screen_recording &&
        initial.listen_access &&
        initial.post_access &&
        initialMissing.isEmpty {
        writePermissionsSetupMarker(path: markerPath, permissions: initial)
        let restartedServices = restartPermissionsDependentServices()
        var notes = ["Permissions were already granted; onboarding marker was recorded without additional prompts."]
        if restartedServices.isEmpty {
            notes.append("No managed services were running to restart.")
        } else {
            notes.append("Restarted services: \(restartedServices.joined(separator: ", ")).")
        }

        let finalSetup = currentPermissionsSetupState(permissions: initial)
        return PermissionsSetupResponse(
            status: "ok",
            completed: true,
            permissions: initial,
            requirements: initialRequirements,
            setup: finalSetup,
            missing_permissions: [],
            marker_path: markerPath,
            restarted_services: restartedServices,
            notes: notes
        )
    }

    if once &&
        initial.accessibility &&
        initial.screen_recording &&
        initial.listen_access &&
        initial.post_access &&
        !initialMissing.isEmpty {
        return PermissionsSetupResponse(
            status: "degraded",
            completed: false,
            permissions: initial,
            requirements: initialRequirements,
            setup: initialSetup,
            missing_permissions: initialMissing,
            marker_path: markerPath,
            restarted_services: [],
            notes: permissionRecoveryNotes(missing: initialMissing, mode: mode)
        )
    }

    preparePermissionsSetupUI()

    var notes: [String] = []
    let intro = permissionSetupIntroAlert()
    if intro == .alertSecondButtonReturn {
        notes.append("Permission onboarding was cancelled before any prompts were shown.")
        return PermissionsSetupResponse(
            status: "degraded",
            completed: false,
            permissions: currentPermissionsState(),
            requirements: currentPermissionRequirements(permissions: currentPermissionsState()),
            setup: currentPermissionsSetupState(permissions: currentPermissionsState()),
            missing_permissions: missingPermissionIDs(currentPermissionsState()),
            marker_path: markerPath,
            restarted_services: [],
            notes: notes
        )
    }

    if !initial.accessibility && !requestAccessibilityPermission() {
        notes.append("Accessibility permission setup was cancelled before completion.")
    }

    let afterAX = currentPermissionsState()
    if notes.isEmpty && !afterAX.screen_recording && !requestScreenRecordingPermission() {
        notes.append("Screen Recording permission setup was cancelled before completion.")
    }

    let afterScreen = currentPermissionsState()
    if notes.isEmpty && !afterScreen.listen_access && !requestListenEventPermission() {
        notes.append("Input Monitoring listen access setup was cancelled before completion.")
    }

    let afterListen = currentPermissionsState()
    if notes.isEmpty && !afterListen.post_access && !requestPostEventPermission() {
        notes.append("Input Monitoring post access setup was cancelled before completion.")
    }

    let finalPermissions = currentPermissionsState()
    if !finalPermissions.accessibility {
        notes.append("Accessibility permission is still not granted.")
    }
    if !finalPermissions.screen_recording {
        notes.append("Screen Recording permission is still not granted.")
    }
    if !finalPermissions.listen_access {
        notes.append("Input Monitoring listen access is still not granted.")
    }
    if !finalPermissions.post_access {
        notes.append("Input Monitoring post access is still not granted.")
    }

    let completed = notes.isEmpty
    var restartedServices: [String] = []
    if completed {
        writePermissionsSetupMarker(path: markerPath, permissions: finalPermissions)
        restartedServices = restartPermissionsDependentServices()
        if restartedServices.isEmpty {
            notes.append("Permissions were granted, but no managed services were running to restart.")
        } else {
            notes.append("Restarted services: \(restartedServices.joined(separator: ", ")).")
        }
    }

    let requirements = currentPermissionRequirements(permissions: finalPermissions)
    let setup = currentPermissionsSetupState(permissions: finalPermissions)
    let finalDaemonHealth = fetchDaemonHealth(socketPath: aosSocketPath(for: mode))?.asView
    let missing = missingPermissionIDsFor(
        daemon: finalDaemonHealth,
        cli: cliView(from: finalPermissions)
    )
    if completed && !missing.isEmpty {
        notes.append(contentsOf: permissionRecoveryNotes(missing: missing, mode: mode))
    }

    return PermissionsSetupResponse(
        status: completed && missing.isEmpty ? "ok" : "degraded",
        completed: completed && missing.isEmpty,
        permissions: finalPermissions,
        requirements: requirements,
        setup: setup,
        missing_permissions: missing,
        marker_path: markerPath,
        restarted_services: restartedServices,
        notes: notes
    )
}

private func preparePermissionsSetupUI() {
    _ = NSApplication.shared
    NSApp.setActivationPolicy(.regular)
    NSApp.activate(ignoringOtherApps: true)
}

private func permissionSetupIntroAlert() -> NSApplication.ModalResponse {
    NSApp.activate(ignoringOtherApps: true)
    let alert = NSAlert()
    let identity = runtimeIdentityLabel(mode: aosCurrentRuntimeMode())
    alert.alertStyle = .informational
    alert.messageText = "AOS permissions setup"
    alert.informativeText = """
    AOS will request the remaining macOS permissions one at a time for the current \(identity) identity.

    This flow only uses safe prompt-triggering probes. It does not perform destructive actions.

    Keep this window open while you approve each prompt. If macOS sends you to System Settings instead, grant access there and then come back here.
    """
    alert.addButton(withTitle: "Continue")
    alert.addButton(withTitle: "Cancel")
    return alert.runModal()
}

private func requestPermissionWithDialog(
    title: String,
    description: String,
    settingsAnchor: String,
    isGranted: () -> Bool,
    triggerPrompt: () -> Void
) -> Bool {
    var prompted = false
    while !isGranted() {
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = title
        alert.informativeText = """
        \(description)

        Click "\(prompted ? "I’ve Granted Access" : "Request \(title)")" to continue after approving the macOS prompt. If the prompt does not appear, open System Settings directly.
        """
        alert.addButton(withTitle: prompted ? "I’ve Granted Access" : "Request \(title)")
        alert.addButton(withTitle: "Open Settings")
        alert.addButton(withTitle: "Cancel")

        switch alert.runModal() {
        case .alertFirstButtonReturn:
            if !prompted { triggerPrompt(); prompted = true }
        case .alertSecondButtonReturn:
            if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?\(settingsAnchor)") {
                NSWorkspace.shared.open(url)
            }
        default:
            return false
        }
    }
    return true
}

private func requestAccessibilityPermission() -> Bool {
    requestPermissionWithDialog(
        title: "Grant Accessibility",
        description: "Accessibility is required for the global input tap and controlled input actions.",
        settingsAnchor: "Privacy_Accessibility",
        isGranted: { AXIsProcessTrusted() },
        triggerPrompt: {
            let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
            AXIsProcessTrustedWithOptions([key: true] as CFDictionary)
        }
    )
}

private func requestScreenRecordingPermission() -> Bool {
    requestPermissionWithDialog(
        title: "Grant Screen Recording",
        description: "Screen Recording is required for capture and some perception features.",
        settingsAnchor: "Privacy_ScreenCapture",
        isGranted: { preflightScreenRecordingAccess() },
        triggerPrompt: { CGRequestScreenCaptureAccess() }
    )
}

private func requestListenEventPermission() -> Bool {
    requestPermissionWithDialog(
        title: "Grant Input Monitoring Listen Access",
        description: "Input Monitoring listen access is required for the daemon's global input tap, input event fan-out, and hotkeys.",
        settingsAnchor: "Privacy_ListenEvent",
        isGranted: { preflightListenEventAccess() },
        triggerPrompt: { _ = requestListenEventAccess() }
    )
}

private func requestPostEventPermission() -> Bool {
    requestPermissionWithDialog(
        title: "Grant Input Monitoring Post Access",
        description: "Input Monitoring post access is required for synthetic mouse and keyboard actions.",
        settingsAnchor: "Privacy_ListenEvent",
        isGranted: { preflightPostEventAccess() },
        triggerPrompt: { _ = requestPostEventAccess() }
    )
}


private func readPermissionsSetupMarker(path: String) -> [String: Any]? {
    guard let data = FileManager.default.contents(atPath: path),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        return nil
    }
    return json
}

private func writePermissionsSetupMarker(path: String, permissions: PermissionsState) {
    let dir = (path as NSString).deletingLastPathComponent
    try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)

    let payload: [String: Any] = [
        "bundle_path": Bundle.main.bundlePath,
        "completed_at": iso8601Now(),
        "permissions": [
            "accessibility": permissions.accessibility,
            "screen_recording": permissions.screen_recording,
            "listen_access": permissions.listen_access,
            "post_access": permissions.post_access
        ]
    ]

    guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys]) else {
        return
    }

    try? data.write(to: URL(fileURLWithPath: path))
}

private func restartPermissionsDependentServices() -> [String] {
    return [aosServiceLabel()].filter(restartManagedLaunchAgent)
}

private func restartManagedLaunchAgent(_ label: String) -> Bool {
    let domain = "gui/\(getuid())/\(label)"
    guard runProcess("/bin/launchctl", arguments: ["print", domain]).exitCode == 0 else {
        return false
    }
    return runProcess("/bin/launchctl", arguments: ["kickstart", "-k", domain]).exitCode == 0
}
