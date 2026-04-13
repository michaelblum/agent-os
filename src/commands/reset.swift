// reset.swift — deterministic runtime cleanup for repo/installed modes.

import Foundation

private enum ResetMode: String {
    case current
    case repo
    case installed
    case all
}

private struct ResetResponse: Encodable {
    let status: String
    let reset_mode: String
    let stopped_services: [String]
    let removed_paths: [String]
    let remaining_paths: [String]
    let notes: [String]
}

func resetCommand(args: [String]) {
    let options = parseResetOptions(args)
    let response = runReset(mode: options.mode)
    if options.asJSON {
        print(jsonString(response))
    } else {
        print("status=\(response.status) mode=\(response.reset_mode)")
        if !response.stopped_services.isEmpty {
            print("stopped_services=\(response.stopped_services.joined(separator: ","))")
        }
        if !response.removed_paths.isEmpty {
            print("removed_paths=\(response.removed_paths.joined(separator: ","))")
        }
        if !response.remaining_paths.isEmpty {
            print("remaining_paths=\(response.remaining_paths.joined(separator: ","))")
        }
        for note in response.notes {
            print(note)
        }
    }
}

private struct ResetOptions {
    let mode: ResetMode
    let asJSON: Bool
}

private func parseResetOptions(_ args: [String]) -> ResetOptions {
    var mode: ResetMode = .current
    var asJSON = false
    var i = 0

    while i < args.count {
        switch args[i] {
        case "--json":
            asJSON = true
        case "--mode":
            i += 1
            guard i < args.count, let parsed = ResetMode(rawValue: args[i]) else {
                exitError("--mode must be current, repo, installed, or all", code: "INVALID_ARG")
            }
            mode = parsed
        default:
            exitError("Usage: aos reset [--mode current|repo|installed|all] [--json]", code: "UNKNOWN_ARG")
        }
        i += 1
    }

    return ResetOptions(mode: mode, asJSON: asJSON)
}

private func runReset(mode: ResetMode) -> ResetResponse {
    let targetModes: [AOSRuntimeMode] = {
        switch mode {
        case .current:
            return [aosCurrentRuntimeMode()]
        case .repo:
            return [.repo]
        case .installed:
            return [.installed]
        case .all:
            return AOSRuntimeMode.allCases
        }
    }()

    var stoppedServices: [String] = []
    var removedPaths: [String] = []
    var notes: [String] = []

    // Stop mode-scoped services for targeted modes
    for mode in targetModes {
        let label = aosServiceLabel(for: mode)
        if stopLaunchAgent(label: label) {
            stoppedServices.append(label)
        }
    }
    // Also stop any legacy (pre-mode-split) services
    for label in aosLegacyServiceLabels {
        if stopLaunchAgent(label: label) {
            stoppedServices.append(label)
        }
    }

    for runtimeMode in targetModes {
        let stateDir = aosStateDir(for: runtimeMode)
        if FileManager.default.fileExists(atPath: stateDir) {
            try? FileManager.default.removeItem(atPath: stateDir)
            removedPaths.append(stateDir)
        }
    }

    let legacyDir = aosLegacyStateDir()
    if let legacyItems = try? FileManager.default.contentsOfDirectory(atPath: legacyDir) {
        let modeNames = Set(AOSRuntimeMode.allCases.map(\.rawValue))
        for item in legacyItems where !modeNames.contains(item) {
            let path = (legacyDir as NSString).appendingPathComponent(item)
            if FileManager.default.fileExists(atPath: path) {
                try? FileManager.default.removeItem(atPath: path)
                removedPaths.append(path)
            }
        }
    }

    // Remove legacy side-eye config directory
    let sideEyeDir = NSString("~/.config/side-eye").expandingTildeInPath
    if FileManager.default.fileExists(atPath: sideEyeDir) {
        try? FileManager.default.removeItem(atPath: sideEyeDir)
        removedPaths.append(sideEyeDir)
    }

    if targetModes.contains(.repo), let repoRoot = aosCurrentRepoRoot() {
        for path in [
            "\(repoRoot)/aos",
            "\(repoRoot)/dist",
            "\(repoRoot)/tools/dogfood/__pycache__"
        ] {
            if FileManager.default.fileExists(atPath: path) {
                try? FileManager.default.removeItem(atPath: path)
                removedPaths.append(path)
            }
        }
    }

    let allPlistPaths = AOSRuntimeMode.allCases.map { aosServicePlistPath(for: $0) }
        + aosLegacyServiceLabels.map { "\(aosHomeDir())/Library/LaunchAgents/\($0).plist" }
    let remainingPaths = ([aosInstallAppPath()] + allPlistPaths)
        .filter { FileManager.default.fileExists(atPath: $0) }

    if !FileManager.default.fileExists(atPath: aosInstallAppPath()) {
        notes.append("Installed runtime app is not present.")
    } else {
        notes.append("Installed runtime app was left in place.")
    }
    if stoppedServices.isEmpty {
        notes.append("No matching launch agents were running for the selected reset mode.")
    }

    return ResetResponse(
        status: "ok",
        reset_mode: mode.rawValue,
        stopped_services: stoppedServices.sorted(),
        removed_paths: removedPaths.sorted(),
        remaining_paths: remainingPaths.sorted(),
        notes: notes
    )
}

private func stopLaunchAgent(label: String) -> Bool {
    let domain = "gui/\(getuid())"
    guard runProcess("/bin/launchctl", arguments: ["print", "\(domain)/\(label)"]).exitCode == 0 else {
        return false
    }
    let plistPath = "\(aosHomeDir())/Library/LaunchAgents/\(label).plist"
    let output = runProcess("/bin/launchctl", arguments: ["bootout", domain, plistPath])
    return output.exitCode == 0 ||
        output.stderr.contains("No such process") ||
        output.stderr.contains("service could not be found")
}
