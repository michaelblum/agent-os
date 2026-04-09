// focus-commands.swift — CLI commands for focus channels and graph navigation
//
// These commands talk to the aos unified daemon via daemonOneShot().

import Foundation

// MARK: - Subtree Arg Parsing

/// Parse --subtree-role, --subtree-title, --subtree-identifier from args.
func parseSubtreeArgs(_ args: [String]) -> ChannelSubtree? {
    let role = getArg(args, "--subtree-role")
    let title = getArg(args, "--subtree-title")
    let ident = getArg(args, "--subtree-identifier")
    guard role != nil || title != nil || ident != nil else { return nil }
    return ChannelSubtree(role: role, title: title, identifier: ident)
}

// MARK: - Focus Commands

func focusCreateCommand(args: [String]) {
    guard let id = getArg(args, "--id") else {
        exitError("--id is required", code: "MISSING_ARG")
    }
    guard let widStr = getArg(args, "--window"), let wid = Int(widStr) else {
        exitError("--window <id> is required", code: "MISSING_ARG")
    }
    let subtree = parseSubtreeArgs(args)
    let depth = getArg(args, "--depth").flatMap(Int.init)
    let pid = getArg(args, "--pid").flatMap(Int.init)

    var req: [String: Any] = ["action": "focus-create", "id": id, "window_id": wid]
    if let pid = pid { req["pid"] = pid }
    if let depth = depth { req["depth"] = depth }
    if let sub = subtree {
        var subDict: [String: Any] = [:]
        if let r = sub.role { subDict["role"] = r }
        if let t = sub.title { subDict["title"] = t }
        if let i = sub.identifier { subDict["identifier"] = i }
        req["subtree"] = subDict
    }

    printDaemonResult(daemonOneShot(req, autoStartBinary: aosExecutablePath()))
}

func focusUpdateCommand(args: [String]) {
    guard let id = getArg(args, "--id") else {
        exitError("--id is required", code: "MISSING_ARG")
    }
    let subtree = parseSubtreeArgs(args)
    let depth = getArg(args, "--depth").flatMap(Int.init)

    var req: [String: Any] = ["action": "focus-update", "id": id]
    if let depth = depth { req["depth"] = depth }
    if let sub = subtree {
        var subDict: [String: Any] = [:]
        if let r = sub.role { subDict["role"] = r }
        if let t = sub.title { subDict["title"] = t }
        if let i = sub.identifier { subDict["identifier"] = i }
        req["subtree"] = subDict
    }

    printDaemonResult(daemonOneShot(req, autoStartBinary: aosExecutablePath()))
}

func focusListCommand() {
    let req: [String: Any] = ["action": "focus-list"]
    printDaemonResult(daemonOneShot(req, autoStartBinary: aosExecutablePath()))
}

func focusRemoveCommand(args: [String]) {
    guard let id = getArg(args, "--id") else {
        exitError("--id is required", code: "MISSING_ARG")
    }
    let req: [String: Any] = ["action": "focus-remove", "id": id]
    printDaemonResult(daemonOneShot(req, autoStartBinary: aosExecutablePath()))
}

// MARK: - Graph Commands

func graphDisplaysCommand() {
    let req: [String: Any] = ["action": "graph-displays"]
    printDaemonResult(daemonOneShot(req, autoStartBinary: aosExecutablePath()))
}

func graphWindowsCommand(args: [String]) {
    var req: [String: Any] = ["action": "graph-windows"]
    if let displayStr = getArg(args, "--display"), let d = Int(displayStr) {
        req["display"] = d
    }
    printDaemonResult(daemonOneShot(req, autoStartBinary: aosExecutablePath()))
}

func graphDeepenCommand(args: [String]) {
    guard let id = getArg(args, "--id") else {
        exitError("--id is required", code: "MISSING_ARG")
    }
    let subtree = parseSubtreeArgs(args)
    let depth = getArg(args, "--depth").flatMap(Int.init)

    var req: [String: Any] = ["action": "graph-deepen", "id": id]
    if let depth = depth { req["depth"] = depth }
    if let sub = subtree {
        var subDict: [String: Any] = [:]
        if let r = sub.role { subDict["role"] = r }
        if let t = sub.title { subDict["title"] = t }
        if let i = sub.identifier { subDict["identifier"] = i }
        req["subtree"] = subDict
    }

    printDaemonResult(daemonOneShot(req, autoStartBinary: aosExecutablePath()))
}

func graphCollapseCommand(args: [String]) {
    guard let id = getArg(args, "--id") else {
        exitError("--id is required", code: "MISSING_ARG")
    }
    let depth = getArg(args, "--depth").flatMap(Int.init)

    var req: [String: Any] = ["action": "graph-collapse", "id": id]
    if let depth = depth { req["depth"] = depth }

    printDaemonResult(daemonOneShot(req, autoStartBinary: aosExecutablePath()))
}

func daemonSnapshotCommand() {
    let req: [String: Any] = ["action": "snapshot"]
    printDaemonResult(daemonOneShot(req, autoStartBinary: aosExecutablePath()))
}

// MARK: - Response Output

/// Print a daemon response dictionary as pretty JSON.
/// Errors (responses with "error" key) go to stderr and exit 1.
private func printDaemonResult(_ response: [String: Any]?) {
    guard let response = response else {
        exitError("Could not connect to daemon", code: "DAEMON_UNAVAILABLE")
    }
    guard let data = try? JSONSerialization.data(withJSONObject: response, options: [.prettyPrinted, .sortedKeys]),
          let s = String(data: data, encoding: .utf8) else {
        exitError("Failed to serialize response", code: "SERIALIZE_ERROR")
    }
    if response["error"] != nil {
        FileHandle.standardError.write((s + "\n").data(using: .utf8)!)
        exit(1)
    } else {
        print(s)
    }
}
