// clean.swift — session-boundary cleanup for stale daemons and orphaned canvases.
//
// Intended to run at the start of each consumer session (e.g. Claude Code).
// Detects stale daemon processes and lingering canvases from previous sessions.
//   --dry-run   Report without acting
//   --json      JSON output for hook consumption

import Foundation

struct CleanReport: Encodable {
    let status: String
    let stale_daemons: [StaleDaemonInfo]
    let canvases: [CleanCanvasEntry]
    let actions_taken: [String]
    let notes: [String]
}

struct StaleDaemonInfo: Encodable {
    let pid: Int
    let args: String
}

struct CleanCanvasEntry: Encodable {
    let id: String
    let mode: String
}

func cleanCommand(args: [String]) {
    if args.contains("--help") || args.contains("-h") {
        printCommandHelp(["clean"], json: args.contains("--json"))
        exit(0)
    }
    var dryRun = false
    var asJSON = false

    for arg in args {
        switch arg {
        case "--dry-run": dryRun = true
        case "--json": asJSON = true
        default:
            exitError("Unknown flag: \(arg)", code: "UNKNOWN_FLAG")
        }
    }

    let report = runClean(dryRun: dryRun)

    if asJSON {
        print(jsonString(report))
    } else {
        if report.stale_daemons.isEmpty && report.canvases.isEmpty {
            print("clean: nothing to clean")
        } else {
            for d in report.stale_daemons {
                let verb = dryRun ? "found" : "killed"
                print("clean: \(verb) stale daemon pid=\(d.pid) (\(d.args))")
            }
            if !report.canvases.isEmpty {
                let ids = report.canvases.map(\.id).joined(separator: ", ")
                let verb = dryRun ? "found" : "removed"
                print("clean: \(verb) \(report.canvases.count) canvas(es): \(ids)")
            }
        }
        for note in report.notes {
            print("clean: \(note)")
        }
    }
}

func runClean(dryRun: Bool) -> CleanReport {
    var actions: [String] = []
    var notes: [String] = []
    let mode = aosCurrentRuntimeMode()

    // 1. Find all aos serve PIDs, identify launchd-managed one
    let allPIDs = findAllDaemonPIDs()
    let launchdPID = launchdManagedPID(label: aosServiceLabel())

    // Also check other-mode launchd PID so we don't kill it
    let otherLaunchdPID = launchdManagedPID(label: aosServiceLabel(for: mode.other))
    let protectedPIDs = Set([launchdPID, otherLaunchdPID].compactMap { $0 })

    // 2. Stale = all minus protected (launchd-managed)
    let stalePIDs = allPIDs.filter { !protectedPIDs.contains($0) }
    var staleDaemons: [StaleDaemonInfo] = []

    for pid in stalePIDs {
        let args = processArgs(pid: pid)
        staleDaemons.append(StaleDaemonInfo(pid: pid, args: args))
        if !dryRun {
            kill(Int32(pid), SIGTERM)
            actions.append("killed stale daemon pid=\(pid)")
        }
    }

    // 3. List canvases on current-mode daemon
    var canvases: [CleanCanvasEntry] = []
    let socketPath = aosSocketPath()
    if socketIsReachable(socketPath) {
        canvases.append(contentsOf: listCanvases(socketPath: socketPath, mode: mode.rawValue))
    }

    // 4. Also check other-mode daemon
    let otherSocketPath = aosSocketPath(for: mode.other)
    if socketIsReachable(otherSocketPath) {
        let otherCanvases = listCanvases(socketPath: otherSocketPath, mode: mode.other.rawValue)
        if !otherCanvases.isEmpty {
            notes.append("\(otherCanvases.count) canvas(es) on \(mode.other.rawValue)-mode daemon")
        }
        canvases.append(contentsOf: otherCanvases)
    }

    // 5. Remove canvases
    if !dryRun && !canvases.isEmpty {
        if socketIsReachable(socketPath) {
            sendEnvelopeRequest(service: "show", action: "remove_all", data: [:], socketPath: socketPath)
            actions.append("removed all canvases on \(mode.rawValue) daemon")
        }
        if socketIsReachable(otherSocketPath) {
            sendEnvelopeRequest(service: "show", action: "remove_all", data: [:], socketPath: otherSocketPath)
            actions.append("removed all canvases on \(mode.other.rawValue) daemon")
        }
    }

    let status: String
    if staleDaemons.isEmpty && canvases.isEmpty {
        status = "clean"
    } else {
        status = dryRun ? "dirty" : "cleaned"
    }

    return CleanReport(
        status: status,
        stale_daemons: staleDaemons,
        canvases: canvases,
        actions_taken: actions,
        notes: notes
    )
}

// MARK: - Helpers

private func findAllDaemonPIDs() -> [Int] {
    let output = runProcess("/usr/bin/pgrep", arguments: ["-f", "aos serve"])
    guard output.exitCode == 0 else { return [] }
    return output.stdout
        .split(whereSeparator: \.isNewline)
        .compactMap { Int($0.trimmingCharacters(in: .whitespaces)) }
}

private func launchdManagedPID(label: String) -> Int? {
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

private func processArgs(pid: Int) -> String {
    let output = runProcess("/bin/ps", arguments: ["-p", "\(pid)", "-o", "args="])
    guard output.exitCode == 0 else { return "unknown" }
    return output.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
}

private func listCanvases(socketPath: String, mode: String) -> [CleanCanvasEntry] {
    guard let response = sendEnvelopeRequest(service: "show", action: "list", data: [:], socketPath: socketPath),
          let canvases = response["canvases"] as? [[String: Any]] else {
        return []
    }
    return canvases.compactMap { c in
        guard let id = c["id"] as? String else { return nil }
        return CleanCanvasEntry(id: id, mode: mode)
    }
}
