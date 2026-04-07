// operator.swift — Runtime introspection commands for operator parity.

import Foundation
import AppKit
import ApplicationServices
import CoreGraphics

// MARK: - Response Models

private struct PermissionsState: Encodable {
    let accessibility: Bool
    let screen_recording: Bool
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

private struct RuntimeState: Encodable {
    let mode: String
    let state_dir: String
    let other_mode_state_dir: String
    let daemon_running: Bool
    let daemon_pid: Int?
    let socket_path: String
    let socket_exists: Bool
    let socket_reachable: Bool
    let other_mode_socket_path: String
    let other_mode_socket_reachable: Bool
    let uptime_seconds: Double?
    let event_tap_expected: Bool
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
    let sigil_service: LaunchAgentState
    let notes: [String]
}

private struct PermissionsResponse: Encodable {
    let status: String
    let permissions: PermissionsState
    let requirements: [PermissionRequirement]
    let setup: PermissionsSetupState
    let missing_permissions: [String]
    let ready_for_testing: Bool
    let notes: [String]
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

// MARK: - Public Commands

func doctorCommand(args: [String]) {
    guard args.allSatisfy({ $0 == "--json" }) else {
        exitError("Usage: aos doctor [--json]", code: "UNKNOWN_ARG")
    }

    let permissions = currentPermissionsState()
    let permissionRequirements = currentPermissionRequirements(permissions: permissions)
    let permissionsSetup = currentPermissionsSetupState(permissions: permissions)
    let runtime = currentRuntimeState()
    let mode = aosCurrentRuntimeMode()
    let aosService = launchAgentState(
        label: "com.agent-os.aos",
        expectedBinaryPath: aosExpectedBinaryPath(program: "aos", mode: mode),
        logPath: aosDaemonLogPath(for: mode)
    )
    let sigilService = launchAgentState(
        label: "com.agent-os.sigil",
        expectedBinaryPath: aosExpectedBinaryPath(program: "avatar-sub", mode: mode),
        logPath: aosSigilLogPath(for: mode)
    )

    var notes: [String] = []
    if !runtime.daemon_running {
        notes.append("Daemon is not running.")
    } else if !runtime.socket_reachable {
        notes.append("Daemon process appears to be running, but the socket is not reachable.")
    }
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
    if !sigilService.target_matches_expected {
        notes.append("Sigil launch agent target does not match the expected \(runtime.mode) runtime binary.")
    }
    if !runtime.legacy_state_items.isEmpty {
        notes.append("Legacy shared runtime state still exists in \(runtime.legacy_state_dir).")
    }
    if !runtime.repo_artifacts.isEmpty {
        notes.append("Repo build artifacts are still present: \(runtime.repo_artifacts.joined(separator: ", ")).")
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
        sigil_service: sigilService,
        notes: notes
    )
    print(jsonString(response))
}

func permissionsCommand(args: [String]) {
    guard let sub = args.first else {
        exitError("Usage: aos permissions <check|preflight|setup> [--json]", code: "MISSING_SUBCOMMAND")
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

func interactivePreflightReady() -> Bool {
    let permissions = currentPermissionsState()
    let setup = currentPermissionsSetupState(permissions: permissions)
    return setup.setup_completed
}

func ensureInteractivePreflight(command: String) {
    if ProcessInfo.processInfo.environment["AOS_BYPASS_PREFLIGHT"] == "1" {
        return
    }

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

private func currentPermissionsState() -> PermissionsState {
    PermissionsState(
        accessibility: AXIsProcessTrusted(),
        screen_recording: preflightScreenRecordingAccess()
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
    return missing
}

private func permissionsCheckCommand(args: [String], usage: String) {
    guard args.allSatisfy({ $0 == "--json" }) else {
        exitError("Usage: \(usage)", code: "UNKNOWN_ARG")
    }

    let permissions = currentPermissionsState()
    let requirements = currentPermissionRequirements(permissions: permissions)
    let setup = currentPermissionsSetupState(permissions: permissions)
    let missing = missingPermissionIDs(permissions)

    var notes: [String] = []
    if !permissions.accessibility {
        notes.append("Accessibility permission is not granted.")
    }
    if !permissions.screen_recording {
        notes.append("Screen Recording permission is not granted.")
    }
    if !setup.marker_exists {
        notes.append("Permission onboarding has not been completed for this runtime identity.")
    } else if !setup.bundle_matches_current {
        notes.append("Permission onboarding marker belongs to a different app bundle path.")
    }
    if let command = setup.recommended_command {
        notes.append("Run '\(command)' before interactive testing.")
    }

    let response = PermissionsResponse(
        status: notes.isEmpty ? "ok" : "degraded",
        permissions: permissions,
        requirements: requirements,
        setup: setup,
        missing_permissions: missing,
        ready_for_testing: missing.isEmpty && setup.setup_completed,
        notes: notes
    )
    print(jsonString(response))
}

private func currentRuntimeState() -> RuntimeState {
    let mode = aosCurrentRuntimeMode()
    let socketPath = aosSocketPath(for: mode)
    let otherModeSocketPath = aosSocketPath(for: mode.other)
    let socketExists = FileManager.default.fileExists(atPath: socketPath)
    let socketReachable = socketIsReachable(socketPath)
    let otherSocketReachable = socketIsReachable(otherModeSocketPath)
    let daemonPID = daemonProcessID()
    let daemonRunning = daemonPID != nil || socketReachable
    let uptime = fetchDaemonUptime()

    return RuntimeState(
        mode: mode.rawValue,
        state_dir: aosStateDir(for: mode),
        other_mode_state_dir: aosStateDir(for: mode.other),
        daemon_running: daemonRunning,
        daemon_pid: daemonPID,
        socket_path: socketPath,
        socket_exists: socketExists,
        socket_reachable: socketReachable,
        other_mode_socket_path: otherModeSocketPath,
        other_mode_socket_reachable: otherSocketReachable,
        uptime_seconds: uptime,
        event_tap_expected: true,
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

private func daemonProcessID() -> Int? {
    if let pid = launchdProcessID(label: "com.agent-os.aos") {
        return pid
    }

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

private func fetchDaemonUptime() -> Double? {
    let session = DaemonSession(socketPath: kDefaultSocketPath)
    guard session.connect(timeoutMs: 250) else { return nil }
    defer { session.disconnect() }
    guard let response = session.sendAndReceive(["action": "ping"]) else { return nil }
    return response["uptime"] as? Double
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
        candidates.append(contentsOf: [
            "\(repoRoot)/aos",
            "\(repoRoot)/apps/sigil/build"
        ])
    }
    return candidates.filter { FileManager.default.fileExists(atPath: $0) }
}

private func preflightScreenRecordingAccess() -> Bool {
    if #available(macOS 10.15, *) {
        return CGPreflightScreenCaptureAccess()
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

    print("completed=\(response.completed) accessibility=\(response.permissions.accessibility) screen_recording=\(response.permissions.screen_recording)")
    print("ready_for_testing=\(response.completed && response.missing_permissions.isEmpty && response.setup.setup_completed)")
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
            exitError("Usage: aos permissions setup [--once] [--json]", code: "UNKNOWN_ARG")
        }
    }

    return PermissionsSetupOptions(asJSON: asJSON, once: once)
}

private func runPermissionsSetup(once: Bool) -> PermissionsSetupResponse {
    let markerPath = aosPermissionsMarkerPath()
    let initial = currentPermissionsState()
    let initialSetup = currentPermissionsSetupState(permissions: initial)
    let initialRequirements = currentPermissionRequirements(permissions: initial)

    if once && initialSetup.setup_completed {
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

    if once && initial.accessibility && initial.screen_recording {
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

    let finalPermissions = currentPermissionsState()
    if !finalPermissions.accessibility {
        notes.append("Accessibility permission is still not granted.")
    }
    if !finalPermissions.screen_recording {
        notes.append("Screen Recording permission is still not granted.")
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
    let missing = missingPermissionIDs(finalPermissions)

    return PermissionsSetupResponse(
        status: completed ? "ok" : "degraded",
        completed: completed,
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
    alert.alertStyle = .informational
    alert.messageText = "AOS permissions setup"
    alert.informativeText = """
    AOS will request the remaining macOS permissions one at a time from the packaged AOS.app identity.

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
            "screen_recording": permissions.screen_recording
        ]
    ]

    guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys]) else {
        return
    }

    try? data.write(to: URL(fileURLWithPath: path))
}

private func restartPermissionsDependentServices() -> [String] {
    let labels = ["com.agent-os.aos", "com.agent-os.sigil"]
    return labels.filter(restartManagedLaunchAgent)
}

private func restartManagedLaunchAgent(_ label: String) -> Bool {
    let domain = "gui/\(getuid())/\(label)"
    guard runProcess("/bin/launchctl", arguments: ["print", domain]).exitCode == 0 else {
        return false
    }
    return runProcess("/bin/launchctl", arguments: ["kickstart", "-k", domain]).exitCode == 0
}
