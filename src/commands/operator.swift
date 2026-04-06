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

private struct RuntimeState: Encodable {
    let daemon_running: Bool
    let daemon_pid: Int?
    let socket_path: String
    let socket_exists: Bool
    let socket_reachable: Bool
    let uptime_seconds: Double?
    let event_tap_expected: Bool
}

private struct DoctorPlatform: Encodable {
    let os: String
    let version: String
}

private struct DoctorResponse: Encodable {
    let status: String
    let platform: DoctorPlatform
    let permissions: PermissionsState
    let runtime: RuntimeState
    let notes: [String]
}

private struct PermissionsResponse: Encodable {
    let status: String
    let permissions: PermissionsState
    let notes: [String]
}

private struct PermissionsSetupResponse: Encodable {
    let status: String
    let completed: Bool
    let permissions: PermissionsState
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
    let runtime = currentRuntimeState()

    var notes: [String] = []
    if !runtime.daemon_running {
        notes.append("Daemon is not running.")
    } else if !runtime.socket_reachable {
        notes.append("Daemon process appears to be running, but the socket is not reachable.")
    }
    if !permissions.accessibility {
        notes.append("Accessibility permission is not granted.")
    }
    if !permissions.screen_recording {
        notes.append("Screen Recording permission is not granted.")
    }

    let version = ProcessInfo.processInfo.operatingSystemVersion
    let response = DoctorResponse(
        status: notes.isEmpty ? "ok" : "degraded",
        platform: DoctorPlatform(
            os: "macOS",
            version: "\(version.majorVersion).\(version.minorVersion).\(version.patchVersion)"
        ),
        permissions: permissions,
        runtime: runtime,
        notes: notes
    )
    print(jsonString(response))
}

func permissionsCommand(args: [String]) {
    guard let sub = args.first else {
        exitError("Usage: aos permissions <check|setup> [--json]", code: "MISSING_SUBCOMMAND")
    }
    switch sub {
    case "check":
        let rest = Array(args.dropFirst())
        guard rest.allSatisfy({ $0 == "--json" }) else {
            exitError("Usage: aos permissions check [--json]", code: "UNKNOWN_ARG")
        }
        let permissions = currentPermissionsState()
        var notes: [String] = []
        if !permissions.accessibility {
            notes.append("Accessibility permission is not granted.")
        }
        if !permissions.screen_recording {
            notes.append("Screen Recording permission is not granted.")
        }
        let response = PermissionsResponse(
            status: notes.isEmpty ? "ok" : "degraded",
            permissions: permissions,
            notes: notes
        )
        print(jsonString(response))
    case "setup":
        permissionsSetupCommand(args: Array(args.dropFirst()))
    default:
        exitError("Unknown permissions subcommand: \(sub)", code: "UNKNOWN_SUBCOMMAND")
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

private func currentRuntimeState() -> RuntimeState {
    let socketPath = kDefaultSocketPath
    let socketExists = FileManager.default.fileExists(atPath: socketPath)
    let socketReachable = canReachSocket(socketPath)
    let daemonPID = daemonProcessID()
    let daemonRunning = daemonPID != nil || socketReachable
    let uptime = fetchDaemonUptime()

    return RuntimeState(
        daemon_running: daemonRunning,
        daemon_pid: daemonPID,
        socket_path: socketPath,
        socket_exists: socketExists,
        socket_reachable: socketReachable,
        uptime_seconds: uptime,
        event_tap_expected: true
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

private func canReachSocket(_ path: String) -> Bool {
    let fd = connectSocket(path, timeoutMs: 250)
    guard fd >= 0 else { return false }
    close(fd)
    return true
}

private func daemonProcessID() -> Int? {
    let output = runProcess("/usr/bin/pgrep", arguments: ["-f", "aos serve"])
    guard output.exitCode == 0 else { return nil }
    return output.stdout
        .split(whereSeparator: \.isNewline)
        .compactMap { Int($0.trimmingCharacters(in: .whitespaces)) }
        .first
}

private func fetchDaemonUptime() -> Double? {
    let session = DaemonSession(socketPath: kDefaultSocketPath)
    guard session.connect(timeoutMs: 250) else { return nil }
    defer { session.disconnect() }
    guard let response = session.sendAndReceive(["action": "ping"]) else { return nil }
    return response["uptime"] as? Double
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
    let markerPath = permissionsSetupMarkerPath()
    let initial = currentPermissionsState()

    if once && initial.accessibility && initial.screen_recording && FileManager.default.fileExists(atPath: markerPath) {
        return PermissionsSetupResponse(
            status: "ok",
            completed: true,
            permissions: initial,
            marker_path: markerPath,
            restarted_services: [],
            notes: ["Permissions are already granted; onboarding was skipped."]
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

    return PermissionsSetupResponse(
        status: completed ? "ok" : "degraded",
        completed: completed,
        permissions: finalPermissions,
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

    Keep this window open while you approve each prompt. If macOS sends you to System Settings instead, grant access there and then come back here.
    """
    alert.addButton(withTitle: "Continue")
    alert.addButton(withTitle: "Cancel")
    return alert.runModal()
}

private func requestAccessibilityPermission() -> Bool {
    var prompted = false

    while !AXIsProcessTrusted() {
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "Grant Accessibility"
        alert.informativeText = """
        Accessibility is required for the global input tap and controlled input actions.

        Click "\(prompted ? "I’ve Granted Access" : "Request Accessibility")" to continue after approving the macOS prompt. If the prompt does not appear, open System Settings directly.
        """
        alert.addButton(withTitle: prompted ? "I’ve Granted Access" : "Request Accessibility")
        alert.addButton(withTitle: "Open Settings")
        alert.addButton(withTitle: "Cancel")

        switch alert.runModal() {
        case .alertFirstButtonReturn:
            if !prompted {
                _ = requestAccessibilityAccess()
                prompted = true
            }
        case .alertSecondButtonReturn:
            openPrivacySettingsPane(anchor: "Privacy_Accessibility")
        default:
            return false
        }
    }

    return true
}

private func requestAccessibilityAccess() -> Bool {
    let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
    let options = [key: true] as CFDictionary
    return AXIsProcessTrustedWithOptions(options)
}

private func requestScreenRecordingPermission() -> Bool {
    var prompted = false

    while !preflightScreenRecordingAccess() {
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "Grant Screen Recording"
        alert.informativeText = """
        Screen Recording is required for capture and some perception features.

        Click "\(prompted ? "I’ve Granted Access" : "Request Screen Recording")" to trigger the macOS prompt. If macOS opens System Settings instead, enable AOS there and then continue here.
        """
        alert.addButton(withTitle: prompted ? "I’ve Granted Access" : "Request Screen Recording")
        alert.addButton(withTitle: "Open Settings")
        alert.addButton(withTitle: "Cancel")

        switch alert.runModal() {
        case .alertFirstButtonReturn:
            if !prompted {
                _ = requestScreenRecordingAccess()
                prompted = true
            }
        case .alertSecondButtonReturn:
            openPrivacySettingsPane(anchor: "Privacy_ScreenCapture")
        default:
            return false
        }
    }

    return true
}

private func requestScreenRecordingAccess() -> Bool {
    if #available(macOS 10.15, *) {
        return CGRequestScreenCaptureAccess()
    }
    return true
}

private func openPrivacySettingsPane(anchor: String) {
    guard let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?\(anchor)") else { return }
    NSWorkspace.shared.open(url)
}

private func permissionsSetupMarkerPath() -> String {
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    return "\(home)/.config/aos/permissions-onboarding.json"
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
