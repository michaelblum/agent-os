// operator.swift — Runtime introspection commands for operator parity.

import Foundation
import ApplicationServices
import CoreGraphics

// MARK: - Response Models

private struct PermissionsState: Encodable {
    let accessibility: Bool
    let screen_recording: Bool
    let listen_access: Bool
    let post_access: Bool
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

private struct PermissionsIdentityFacts: Encodable {
    let executable_path: String
    let bundle_path: String
}

private struct PermissionsFactsResponse: Encodable {
    let status: String
    let mode: String
    let permissions: PermissionsState
    let identity: PermissionsIdentityFacts
}

private struct PermissionsSetupMarkerFacts: Encodable {
    let marker_exists: Bool
    let marker_path: String
    let completed_at: String?
    let bundle_path: String?
    let current_bundle_path: String
    let bundle_matches_current: Bool
    let setup_completed: Bool

    private enum CodingKeys: String, CodingKey {
        case marker_exists, marker_path, completed_at, bundle_path
        case current_bundle_path, bundle_matches_current, setup_completed
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(marker_exists, forKey: .marker_exists)
        try c.encode(marker_path, forKey: .marker_path)
        try c.encodeIfPresent(completed_at, forKey: .completed_at)
        try c.encodeIfPresent(bundle_path, forKey: .bundle_path)
        try c.encode(current_bundle_path, forKey: .current_bundle_path)
        try c.encode(bundle_matches_current, forKey: .bundle_matches_current)
        try c.encode(setup_completed, forKey: .setup_completed)
    }
}

private struct PermissionsSetupMarkerWriteResponse: Encodable {
    let status: String
    let action: String
    let marker: PermissionsSetupMarkerFacts
}

private struct PermissionsPromptResponse: Encodable {
    let status: String
    let permission: String
    let native_trigger: String
    let attempted: Bool
    let trigger_result: Bool?
    let before: PermissionsState
    let after: PermissionsState
    let granted: Bool
}

private struct PermissionsResetTargetResponse: Encodable {
    let status: String
    let mode: String
    let target_path: String
    let tcc_identifier: String
    let available: Bool
    let command: String
    let arguments: [String]
    let unavailable_reason: String?
}

private struct PermissionsTCCResetResponse: Encodable {
    let status: String
    let mode: String
    let target_path: String
    let tcc_identifier: String
    let tcc_reset: PermissionsResetRuntimeStep
}

private struct RuntimeInputTapBlock: Encodable {
    let status: String
    let attempts: Int
    let owner_pid: Int?
    let owner_kind: String
    let launchd_managed: Bool
    let installed_mode_socket_reachable: Bool
    let stale_input_tap_capable_daemons: Int
    // Optional: a legacy daemon (lacking the structured `input_tap` block)
    // doesn't expose these. Emit with encodeIfPresent so consumers see "field
    // absent" rather than a fabricated `false`.
    let listen_access: Bool?
    let post_access: Bool?
    let last_error_at: String?
    let duplicate_tcc_rows_observable: Bool
    let duplicate_tcc_rows_observability: String

    private enum CodingKeys: String, CodingKey {
        case status, attempts, owner_pid, owner_kind, launchd_managed
        case installed_mode_socket_reachable, stale_input_tap_capable_daemons
        case listen_access, post_access, last_error_at
        case duplicate_tcc_rows_observable, duplicate_tcc_rows_observability
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(status, forKey: .status)
        try c.encode(attempts, forKey: .attempts)
        try c.encodeIfPresent(owner_pid, forKey: .owner_pid)
        try c.encode(owner_kind, forKey: .owner_kind)
        try c.encode(launchd_managed, forKey: .launchd_managed)
        try c.encode(installed_mode_socket_reachable, forKey: .installed_mode_socket_reachable)
        try c.encode(stale_input_tap_capable_daemons, forKey: .stale_input_tap_capable_daemons)
        try c.encodeIfPresent(listen_access, forKey: .listen_access)
        try c.encodeIfPresent(post_access, forKey: .post_access)
        try c.encodeIfPresent(last_error_at, forKey: .last_error_at)
        try c.encode(duplicate_tcc_rows_observable, forKey: .duplicate_tcc_rows_observable)
        try c.encode(duplicate_tcc_rows_observability, forKey: .duplicate_tcc_rows_observability)
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
    let ownership_kind: String
    let owner_pid: Int?
    let owner_launchd_managed: Bool
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

private struct PermissionsResetRuntimeStep: Encodable {
    let command: String
    let attempted: Bool
    let exit_code: Int32?
    let status: String
    let stdout: String?
    let stderr: String?
}

private struct RuntimeTCCResetTarget {
    let identifier: String
    let available: Bool
    let unavailableReason: String?
}

private struct RuntimeOwnershipClassification {
    let state: String
    let kind: String
    let ownerPID: Int?
    let launchdManaged: Bool
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

private struct DaemonHealthInputTapFacts: Encodable {
    let status: String
    let attempts: Int
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

private struct DaemonHealthPermissionsFacts: Encodable {
    let accessibility: Bool?

    private enum CodingKeys: String, CodingKey {
        case accessibility
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(accessibility, forKey: .accessibility)
    }
}

private struct DaemonHealthFacts: Encodable {
    let mode: String
    let socket_path: String
    let socket_exists: Bool
    let reachable: Bool
    let pid: Int?
    let uptime_seconds: Double?
    let input_tap: DaemonHealthInputTapFacts?
    let permissions: DaemonHealthPermissionsFacts

    private enum CodingKeys: String, CodingKey {
        case mode, socket_path, socket_exists, reachable, pid
        case uptime_seconds, input_tap, permissions
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(mode, forKey: .mode)
        try c.encode(socket_path, forKey: .socket_path)
        try c.encode(socket_exists, forKey: .socket_exists)
        try c.encode(reachable, forKey: .reachable)
        try c.encodeIfPresent(pid, forKey: .pid)
        try c.encodeIfPresent(uptime_seconds, forKey: .uptime_seconds)
        try c.encodeIfPresent(input_tap, forKey: .input_tap)
        try c.encode(permissions, forKey: .permissions)
    }
}

private func currentDaemonHealthFacts() -> DaemonHealthFacts {
    let mode = aosCurrentRuntimeMode()
    let socketPath = aosSocketPath(for: mode)
    let socketExists = FileManager.default.fileExists(atPath: socketPath)
    let socketReachable = socketIsReachable(socketPath)
    let health = fetchDaemonHealth(socketPath: socketPath)

    let inputTap: DaemonHealthInputTapFacts?
    if let status = health?.inputTapStatus,
       let attempts = health?.inputTapAttempts {
        inputTap = DaemonHealthInputTapFacts(
            status: status,
            attempts: attempts,
            listen_access: health?.inputTapListenAccess,
            post_access: health?.inputTapPostAccess,
            last_error_at: health?.inputTapLastErrorAt
        )
    } else {
        inputTap = nil
    }

    return DaemonHealthFacts(
        mode: mode.rawValue,
        socket_path: socketPath,
        socket_exists: socketExists,
        reachable: socketReachable,
        pid: health?.servingPID,
        uptime_seconds: health?.uptime,
        input_tap: inputTap,
        permissions: DaemonHealthPermissionsFacts(accessibility: health?.daemonAccessibility)
    )
}

// MARK: - Broker Primitive Commands

func daemonBrokerCommand(args: [String]) {
    guard args.first == "health" else {
        exitError("__daemon requires the health primitive.", code: "UNKNOWN_SUBCOMMAND")
    }
    let subArgs = Array(args.dropFirst())
    guard subArgs == ["--json"] else {
        exitError("__daemon health requires --json.", code: "INVALID_ARG")
    }

    print(jsonString(currentDaemonHealthFacts()))
}

func runtimeBrokerCommand(args: [String]) {
    guard args.first == "status-facts" else {
        exitError("__runtime requires the status-facts primitive.", code: "UNKNOWN_SUBCOMMAND")
    }
    let subArgs = Array(args.dropFirst())
    guard subArgs == ["--json"] else {
        exitError("__runtime status-facts requires --json.", code: "INVALID_ARG")
    }

    let mode = aosCurrentRuntimeMode()
    let health = fetchDaemonHealth(socketPath: aosSocketPath(for: mode))
    print(jsonString(currentRuntimeState(preFetchedHealth: health)))
}

// MARK: - Permission Broker Commands

func permissionsCommand(args: [String]) {
    guard let sub = args.first else {
        exitError("__permissions requires a primitive. Usage: aos __permissions <facts|setup-marker|prompt|reset-target|tcc-reset> ...",
                  code: "MISSING_SUBCOMMAND")
    }
    switch sub {
    case "facts":
        permissionsFactsCommand(args: Array(args.dropFirst()))
    case "setup-marker":
        permissionsSetupMarkerCommand(args: Array(args.dropFirst()))
    case "prompt":
        permissionsPromptCommand(args: Array(args.dropFirst()))
    case "reset-target":
        permissionsResetTargetCommand(args: Array(args.dropFirst()))
    case "tcc-reset":
        permissionsTCCResetCommand(args: Array(args.dropFirst()))
    default:
        exitError("Unknown __permissions primitive: \(sub)", code: "UNKNOWN_SUBCOMMAND")
    }
}

private func permissionsFactsCommand(args: [String]) {
    guard args == ["--json"] else {
        exitError("__permissions facts requires --json.", code: "INVALID_ARG")
    }

    let permissions = currentPermissionsState()
    let complete = permissions.accessibility &&
        permissions.screen_recording &&
        permissions.listen_access &&
        permissions.post_access
    let response = PermissionsFactsResponse(
        status: complete ? "ok" : "degraded",
        mode: aosCurrentRuntimeMode().rawValue,
        permissions: permissions,
        identity: PermissionsIdentityFacts(
            executable_path: aosExpectedBinaryPath(program: "aos", mode: aosCurrentRuntimeMode()),
            bundle_path: Bundle.main.bundlePath
        )
    )
    print(jsonString(response))
}

private func permissionsSetupMarkerCommand(args: [String]) {
    guard let action = args.first else {
        exitError("__permissions setup-marker requires get or write.", code: "MISSING_SUBCOMMAND")
    }
    let subArgs = Array(args.dropFirst())
    guard subArgs == ["--json"] else {
        exitError("__permissions setup-marker \(action) requires --json.", code: "INVALID_ARG")
    }

    switch action {
    case "get":
        let permissions = currentPermissionsState()
        print(jsonString(currentPermissionsSetupMarkerFacts(permissions: permissions)))
    case "write":
        let permissions = currentPermissionsState()
        let markerPath = aosPermissionsMarkerPath()
        let writeOK = writePermissionsSetupMarker(path: markerPath, permissions: permissions)
        let marker = currentPermissionsSetupMarkerFacts(permissions: permissions)
        print(jsonString(PermissionsSetupMarkerWriteResponse(
            status: writeOK ? "ok" : "degraded",
            action: "write",
            marker: marker
        )))
        if !writeOK {
            exit(1)
        }
    default:
        exitError("Unknown __permissions setup-marker action: \(action)", code: "UNKNOWN_SUBCOMMAND")
    }
}

private enum PermissionPromptKind: String {
    case accessibility
    case screenRecording = "screen-recording"
    case listenEvent = "listen-event"
    case postEvent = "post-event"

    var permissionID: String {
        switch self {
        case .accessibility:
            return "accessibility"
        case .screenRecording:
            return "screen_recording"
        case .listenEvent:
            return "listen_access"
        case .postEvent:
            return "post_access"
        }
    }

    var nativeTrigger: String {
        switch self {
        case .accessibility:
            return "AXIsProcessTrustedWithOptions"
        case .screenRecording:
            return "CGRequestScreenCaptureAccess"
        case .listenEvent:
            return "CGRequestListenEventAccess"
        case .postEvent:
            return "CGRequestPostEventAccess"
        }
    }
}

private func permissionsPromptCommand(args: [String]) {
    guard args.count == 2, let rawPermission = args.first, args[1] == "--json" else {
        exitError("__permissions prompt requires <accessibility|screen-recording|listen-event|post-event> --json.",
                  code: "INVALID_ARG")
    }
    guard let kind = PermissionPromptKind(rawValue: rawPermission) else {
        exitError("Unknown __permissions prompt permission: \(rawPermission)", code: "UNKNOWN_PERMISSION")
    }

    let before = currentPermissionsState()
    let attempted: Bool
    let triggerResult: Bool?
    if permissionGranted(kind, in: before) {
        attempted = false
        triggerResult = nil
    } else {
        attempted = true
        triggerResult = triggerPermissionPrompt(kind)
    }

    let after = currentPermissionsState()
    let granted = permissionGranted(kind, in: after)
    print(jsonString(PermissionsPromptResponse(
        status: granted ? "ok" : "degraded",
        permission: kind.permissionID,
        native_trigger: kind.nativeTrigger,
        attempted: attempted,
        trigger_result: triggerResult,
        before: before,
        after: after,
        granted: granted
    )))
    exit(granted ? 0 : 1)
}

private func permissionGranted(_ kind: PermissionPromptKind, in permissions: PermissionsState) -> Bool {
    switch kind {
    case .accessibility:
        return permissions.accessibility
    case .screenRecording:
        return permissions.screen_recording
    case .listenEvent:
        return permissions.listen_access
    case .postEvent:
        return permissions.post_access
    }
}

private func triggerPermissionPrompt(_ kind: PermissionPromptKind) -> Bool {
    switch kind {
    case .accessibility:
        let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        return AXIsProcessTrustedWithOptions([key: true] as CFDictionary)
    case .screenRecording:
        return CGRequestScreenCaptureAccess()
    case .listenEvent:
        return requestListenEventAccess()
    case .postEvent:
        return requestPostEventAccess()
    }
}

private func permissionsResetTargetCommand(args: [String]) {
    let mode = parsePermissionsResetPrimitiveArgs(args, command: "reset-target")
    let facts = currentPermissionsResetTargetResponse(mode: mode)
    print(jsonString(facts))
}

private func permissionsTCCResetCommand(args: [String]) {
    let mode = parsePermissionsResetPrimitiveArgs(args, command: "tcc-reset")
    let targetPath = permissionResetTargetPath(mode: mode)
    let target = tccResetTargetForRuntime(mode: mode, targetPath: targetPath)
    let resetArgs = permissionsTCCResetArguments(identifier: target.identifier)
    let resetCommand = permissionsTCCResetCommandString(arguments: resetArgs)

    if !target.available {
        print(jsonString(PermissionsTCCResetResponse(
            status: "degraded",
            mode: mode.rawValue,
            target_path: targetPath,
            tcc_identifier: target.identifier,
            tcc_reset: PermissionsResetRuntimeStep(
                command: resetCommand,
                attempted: false,
                exit_code: nil,
                status: "unavailable",
                stdout: nil,
                stderr: target.unavailableReason
            )
        )))
        exit(1)
    }

    let result = runProcess("/usr/bin/tccutil", arguments: resetArgs)
    let resetOK = result.exitCode == 0
    print(jsonString(PermissionsTCCResetResponse(
        status: resetOK ? "ok" : "degraded",
        mode: mode.rawValue,
        target_path: targetPath,
        tcc_identifier: target.identifier,
        tcc_reset: PermissionsResetRuntimeStep(
            command: resetCommand,
            attempted: true,
            exit_code: result.exitCode,
            status: resetOK ? "ok" : "failed",
            stdout: trimmedOutput(result.stdout),
            stderr: trimmedOutput(result.stderr)
        )
    )))
    exit(resetOK ? 0 : 1)
}

private func parsePermissionsResetPrimitiveArgs(_ args: [String], command: String) -> AOSRuntimeMode {
    var asJSON = false
    var mode: AOSRuntimeMode? = nil
    var i = 0

    while i < args.count {
        switch args[i] {
        case "--json":
            asJSON = true
        case "--mode":
            i += 1
            guard i < args.count, let parsed = AOSRuntimeMode(rawValue: args[i]) else {
                exitError("--mode must be 'repo' or 'installed'", code: "INVALID_ARG")
            }
            mode = parsed
        default:
            exitError("Unknown flag: \(args[i]). Usage: aos __permissions \(command) [--mode repo|installed] --json",
                      code: "UNKNOWN_FLAG")
        }
        i += 1
    }

    guard asJSON else {
        exitError("__permissions \(command) requires --json.", code: "INVALID_ARG")
    }
    return mode ?? aosCurrentRuntimeMode()
}

private func currentPermissionsResetTargetResponse(mode: AOSRuntimeMode) -> PermissionsResetTargetResponse {
    let targetPath = permissionResetTargetPath(mode: mode)
    let target = tccResetTargetForRuntime(mode: mode, targetPath: targetPath)
    let resetArgs = permissionsTCCResetArguments(identifier: target.identifier)
    return PermissionsResetTargetResponse(
        status: "ok",
        mode: mode.rawValue,
        target_path: targetPath,
        tcc_identifier: target.identifier,
        available: target.available,
        command: permissionsTCCResetCommandString(arguments: resetArgs),
        arguments: resetArgs,
        unavailable_reason: target.unavailableReason
    )
}

private func permissionsTCCResetArguments(identifier: String) -> [String] {
    ["reset", "All", identifier]
}

private func permissionsTCCResetCommandString(arguments: [String]) -> String {
    "tccutil \(arguments.joined(separator: " "))"
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

// MARK: - Shared Introspection Helpers

private func currentPermissionsState() -> PermissionsState {
    if testAssumePermissionsGranted() {
        return PermissionsState(
            accessibility: true,
            screen_recording: true,
            listen_access: true,
            post_access: true
        )
    }

    return PermissionsState(
        accessibility: AXIsProcessTrusted(),
        screen_recording: preflightScreenRecordingAccess(),
        listen_access: preflightListenEventAccess(),
        post_access: preflightPostEventAccess()
    )
}

private func testAssumePermissionsGranted() -> Bool {
    // Test-only hook for isolated-state mock daemon tests. Requiring an
    // explicit state root keeps real repo/installed runtime checks bound to
    // the macOS TCC preflight APIs.
    let env = ProcessInfo.processInfo.environment
    return env["AOS_TEST_ASSUME_PERMISSIONS_GRANTED"] == "1" &&
        aosHasExplicitStateRootOverride()
}

private func currentPermissionsSetupState(permissions: PermissionsState) -> PermissionsSetupState {
    let marker = currentPermissionsSetupMarkerFacts(permissions: permissions)
    return PermissionsSetupState(
        marker_exists: marker.marker_exists,
        marker_path: marker.marker_path,
        completed_at: marker.completed_at,
        bundle_path: marker.bundle_path,
        current_bundle_path: marker.current_bundle_path,
        bundle_matches_current: marker.bundle_matches_current,
        setup_completed: marker.setup_completed,
        recommended_command: marker.setup_completed ? nil : "aos permissions setup --once"
    )
}

private func currentPermissionsSetupMarkerFacts(permissions: PermissionsState) -> PermissionsSetupMarkerFacts {
    let markerPath = aosPermissionsMarkerPath()
    let marker = readPermissionsSetupMarker(path: markerPath)
    let currentBundlePath = Bundle.main.bundlePath
    let bundlePath = marker?["bundle_path"] as? String
    let completedAt = marker?["completed_at"] as? String
    let bundleMatchesCurrent = bundlePath == nil ? false : bundlePath == currentBundlePath
    let mode = aosCurrentRuntimeMode()
    let setupCompleted = permissions.accessibility &&
        permissions.screen_recording &&
        permissions.listen_access &&
        permissions.post_access &&
        marker != nil &&
        (bundleMatchesCurrent || mode == .repo)

    return PermissionsSetupMarkerFacts(
        marker_exists: marker != nil,
        marker_path: markerPath,
        completed_at: completedAt,
        bundle_path: bundlePath,
        current_bundle_path: currentBundlePath,
        bundle_matches_current: bundleMatchesCurrent,
        setup_completed: setupCompleted
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

private func permissionResetTargetPath(mode: AOSRuntimeMode) -> String {
    aosExpectedBinaryPath(program: "aos", mode: mode)
}

private func currentRuntimeState(
    preFetchedHealth: DaemonHealthState? = nil
) -> RuntimeState {
    let mode = aosCurrentRuntimeMode()
    let socketPath = aosSocketPath(for: mode)
    let otherModeSocketPath = aosSocketPath(for: mode.other)
    let socketExists = FileManager.default.fileExists(atPath: socketPath)
    let socketReachable = socketIsReachable(socketPath)
    let otherSocketReachable = socketIsReachable(otherModeSocketPath)
    let health = preFetchedHealth ?? fetchDaemonHealth(socketPath: socketPath)
    let explicitStateRootOverride = aosHasExplicitStateRootOverride()
        && ProcessInfo.processInfo.environment["AOS_TEST_CLASSIFY_STATE_ROOT_AS_NORMAL"] != "1"
    let ignoreLaunchdForTest = ProcessInfo.processInfo.environment["AOS_TEST_IGNORE_LAUNCHD"] == "1"
    let servicePID = (explicitStateRootOverride || ignoreLaunchdForTest) ? nil : launchdProcessID(label: aosServiceLabel(for: mode))
    let lockOwnerPID = aosDaemonLockOwnerPID(for: mode)
    let servingPID = health?.servingPID
    let daemonPID = servingPID ?? lockOwnerPID ?? servicePID ?? fallbackDaemonProcessID()
    let daemonRunning = daemonPID != nil || socketReachable
    let ownership = currentOwnershipClassification(
        socketReachable: socketReachable,
        servingPID: servingPID,
        lockOwnerPID: lockOwnerPID,
        servicePID: servicePID,
        explicitStateRootOverride: explicitStateRootOverride
    )

    let inputTapBlock: RuntimeInputTapBlock?
    if let status = health?.inputTapStatus, let attempts = health?.inputTapAttempts {
        // listen/post may be nil when talking to a legacy daemon that doesn't
        // expose them; preserve the unknown signal rather than coercing to false.
        inputTapBlock = RuntimeInputTapBlock(
            status: status,
            attempts: attempts,
            owner_pid: ownership.ownerPID,
            owner_kind: ownership.kind,
            launchd_managed: ownership.launchdManaged,
            installed_mode_socket_reachable: otherSocketReachable,
            stale_input_tap_capable_daemons: 0,
            listen_access: health?.inputTapListenAccess,
            post_access: health?.inputTapPostAccess,
            last_error_at: health?.inputTapLastErrorAt,
            duplicate_tcc_rows_observable: false,
            duplicate_tcc_rows_observability: "unavailable: AOS does not query or mutate the macOS TCC database; duplicate Privacy UI rows require human observation."
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
        ownership_state: ownership.state,
        ownership_kind: ownership.kind,
        owner_pid: ownership.ownerPID,
        owner_launchd_managed: ownership.launchdManaged,
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

private func fallbackDaemonProcessID() -> Int? {
    let output = runProcess("/usr/bin/pgrep", arguments: ["-f", "aos serve"])
    guard output.exitCode == 0 else { return nil }
    return output.stdout
        .split(whereSeparator: \.isNewline)
        .compactMap { Int($0.trimmingCharacters(in: .whitespaces)) }
        .first
}

private func launchdProcessID(label: String) -> Int? {
    if let override = ProcessInfo.processInfo.environment["AOS_TEST_SERVICE_PID"],
       let pid = Int(override),
       pid > 0 {
        return pid
    }
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

private func fetchDaemonHealthResponse(socketPath: String, budgetMs: Int = 250) -> [String: Any]? {
    let deadline = Date().addingTimeInterval(Double(budgetMs) / 1000.0)
    repeat {
        if let response = sendEnvelopeRequest(service: "system", action: "ping", data: [:], socketPath: socketPath, timeoutMs: 250),
           parseDaemonHealthView(from: response) != nil {
            return response
        }
        usleep(50_000)
    } while Date() < deadline
    return nil
}

private func fetchDaemonHealth(socketPath: String, budgetMs: Int = 250) -> DaemonHealthState? {
    guard let response = fetchDaemonHealthResponse(socketPath: socketPath, budgetMs: budgetMs),
          let view = parseDaemonHealthView(from: response) else {
        return nil
    }
    let payload = (response["data"] as? [String: Any]) ?? response
    return DaemonHealthState(
        servingPID: payload["pid"] as? Int,
        uptime: payload["uptime"] as? Double,
        inputTapStatus: view.inputTap.status,
        inputTapAttempts: view.inputTap.attempts,
        inputTapListenAccess: view.inputTap.listenAccess,
        inputTapPostAccess: view.inputTap.postAccess,
        inputTapLastErrorAt: view.inputTap.lastErrorAt,
        daemonAccessibility: view.permissions.accessibility
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

private func currentOwnershipClassification(
    socketReachable: Bool,
    servingPID: Int?,
    lockOwnerPID: Int?,
    servicePID: Int?,
    explicitStateRootOverride: Bool
) -> RuntimeOwnershipClassification {
    if let servingPID, let lockOwnerPID, servingPID != lockOwnerPID {
        return RuntimeOwnershipClassification(
            state: "mismatch",
            kind: "mismatch",
            ownerPID: servingPID,
            launchdManaged: false
        )
    }

    let ownerPID = servingPID ?? lockOwnerPID
    let foregroundServeOwner = ownerPID.map(isForegroundAOSServeOwner) ?? false
    if let ownerPID, let servicePID, ownerPID != servicePID {
        if parentProcessID(of: ownerPID) == servicePID {
            return RuntimeOwnershipClassification(
                state: "consistent",
                kind: "launchd_managed",
                ownerPID: ownerPID,
                launchdManaged: true
            )
        }
        if foregroundServeOwner {
            return RuntimeOwnershipClassification(
                state: "consistent",
                kind: "foreground_dev",
                ownerPID: ownerPID,
                launchdManaged: false
            )
        }
        return RuntimeOwnershipClassification(
            state: "mismatch",
            kind: "mismatch",
            ownerPID: ownerPID,
            launchdManaged: false
        )
    }

    if let ownerPID, servicePID == nil {
        if explicitStateRootOverride || foregroundServeOwner {
            return RuntimeOwnershipClassification(
                state: "consistent",
                kind: "foreground_dev",
                ownerPID: ownerPID,
                launchdManaged: false
            )
        }
        return RuntimeOwnershipClassification(
            state: "unmanaged",
            kind: "unmanaged",
            ownerPID: ownerPID,
            launchdManaged: false
        )
    }

    let pids = [ownerPID, servicePID].compactMap { $0 }
    if pids.isEmpty {
        return RuntimeOwnershipClassification(
            state: socketReachable ? "unknown" : "absent",
            kind: socketReachable ? "unknown" : "absent",
            ownerPID: nil,
            launchdManaged: false
        )
    }
    if Set(pids).count <= 1 {
        return RuntimeOwnershipClassification(
            state: "consistent",
            kind: servicePID == nil ? "unknown" : "launchd_managed",
            ownerPID: ownerPID ?? servicePID,
            launchdManaged: servicePID != nil
        )
    }
    return RuntimeOwnershipClassification(
        state: "mismatch",
        kind: "mismatch",
        ownerPID: ownerPID,
        launchdManaged: false
    )
}

private func isForegroundAOSServeOwner(_ pid: Int) -> Bool {
    guard let commandLine = processCommandLine(of: pid),
          isAOSServeChildCommand(commandLine),
          let parentPID = parentProcessID(of: pid),
          let parentCommandLine = processCommandLine(of: parentPID) else {
        return false
    }
    return isAOSServeWrapperCommand(parentCommandLine)
}

private func processCommandLine(of pid: Int) -> String? {
    let output = runProcess("/bin/ps", arguments: ["-p", String(pid), "-o", "command="])
    guard output.exitCode == 0 else { return nil }
    let commandLine = output.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
    return commandLine.isEmpty ? nil : commandLine
}

private func isAOSServeChildCommand(_ commandLine: String) -> Bool {
    commandLineContainsAOSCommand(commandLine, command: "__serve")
}

private func isAOSServeWrapperCommand(_ commandLine: String) -> Bool {
    commandLineContainsAOSCommand(commandLine, command: "serve")
}

private func commandLineContainsAOSCommand(_ commandLine: String, command: String) -> Bool {
    let expected = aosExpectedBinaryPath(program: "aos", mode: aosCurrentRuntimeMode())
    return commandLine.hasPrefix("\(expected) \(command)")
        || commandLine.hasPrefix("./aos \(command)")
        || commandLine.hasPrefix("aos \(command)")
}

private func parentProcessID(of pid: Int) -> Int? {
    let output = runProcess("/bin/ps", arguments: ["-o", "ppid=", "-p", String(pid)])
    guard output.exitCode == 0 else { return nil }
    return Int(output.stdout.trimmingCharacters(in: .whitespacesAndNewlines))
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

private func tccResetTargetForRuntime(mode: AOSRuntimeMode, targetPath: String) -> RuntimeTCCResetTarget {
    let identifier: String
    if let identifier = codeSigningIdentifier(path: targetPath) {
        switch mode {
        case .repo where !isLaunchServicesBundlePath(targetPath):
            return RuntimeTCCResetTarget(
                identifier: identifier,
                available: false,
                unavailableReason: "Targeted tccutil reset is unavailable for the bare repo ./aos binary because it is not a LaunchServices app bundle."
            )
        default:
            return RuntimeTCCResetTarget(identifier: identifier, available: true, unavailableReason: nil)
        }
    }
    switch mode {
    case .repo:
        identifier = "aos"
        return RuntimeTCCResetTarget(
            identifier: identifier,
            available: false,
            unavailableReason: "Targeted tccutil reset is unavailable for the bare repo ./aos binary because it has no targetable LaunchServices bundle identifier."
        )
    case .installed:
        identifier = Bundle(path: aosInstallAppPath())?.bundleIdentifier ?? "com.agent-os.aos"
        return RuntimeTCCResetTarget(identifier: identifier, available: true, unavailableReason: nil)
    }
}

private func isLaunchServicesBundlePath(_ path: String) -> Bool {
    path.split(separator: "/").contains { $0.hasSuffix(".app") }
}

private func codeSigningIdentifier(path: String) -> String? {
    let output = runProcess("/usr/bin/codesign", arguments: ["-dv", path])
    let combined = [output.stderr, output.stdout].joined(separator: "\n")
    for rawLine in combined.split(whereSeparator: \.isNewline) {
        let line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
        guard line.hasPrefix("Identifier=") else { continue }
        let identifier = line.replacingOccurrences(of: "Identifier=", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if !identifier.isEmpty {
            return identifier
        }
    }
    return nil
}

private func trimmedOutput(_ value: String) -> String? {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
}

private func readPermissionsSetupMarker(path: String) -> [String: Any]? {
    guard let data = FileManager.default.contents(atPath: path),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        return nil
    }
    return json
}

@discardableResult
private func writePermissionsSetupMarker(path: String, permissions: PermissionsState) -> Bool {
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
        return false
    }

    do {
        try data.write(to: URL(fileURLWithPath: path))
        return true
    } catch {
        return false
    }
}
