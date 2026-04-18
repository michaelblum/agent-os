// focus-commands.swift — CLI commands for focus channels and graph navigation
//
// These commands talk to the aos unified daemon via sendEnvelopeRequest().

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

    var data: [String: Any] = ["id": id, "window_id": wid]
    if let pid = pid { data["pid"] = pid }
    if let depth = depth { data["depth"] = depth }
    if let sub = subtree {
        var subDict: [String: Any] = [:]
        if let r = sub.role { subDict["role"] = r }
        if let t = sub.title { subDict["title"] = t }
        if let i = sub.identifier { subDict["identifier"] = i }
        data["subtree"] = subDict
    }

    printDaemonResult(sendEnvelopeRequest(service: "focus", action: "create", data: data, autoStartBinary: aosExecutablePath()))
}

func focusUpdateCommand(args: [String]) {
    guard let id = getArg(args, "--id") else {
        exitError("--id is required", code: "MISSING_ARG")
    }
    let subtree = parseSubtreeArgs(args)
    let depth = getArg(args, "--depth").flatMap(Int.init)

    var data: [String: Any] = ["id": id]
    if let depth = depth { data["depth"] = depth }
    if let sub = subtree {
        var subDict: [String: Any] = [:]
        if let r = sub.role { subDict["role"] = r }
        if let t = sub.title { subDict["title"] = t }
        if let i = sub.identifier { subDict["identifier"] = i }
        data["subtree"] = subDict
    }

    printDaemonResult(sendEnvelopeRequest(service: "focus", action: "update", data: data, autoStartBinary: aosExecutablePath()))
}

func focusListCommand() {
    printDaemonResult(sendEnvelopeRequest(service: "focus", action: "list", data: [:], autoStartBinary: aosExecutablePath()))
}

func focusRemoveCommand(args: [String]) {
    guard let id = getArg(args, "--id") else {
        exitError("--id is required", code: "MISSING_ARG")
    }
    printDaemonResult(sendEnvelopeRequest(service: "focus", action: "remove", data: ["id": id], autoStartBinary: aosExecutablePath()))
}

// MARK: - Graph Commands

func graphDisplaysCommand() {
    printDaemonResult(sendEnvelopeRequest(service: "graph", action: "displays", data: [:], autoStartBinary: aosExecutablePath()))
}

func graphWindowsCommand(args: [String]) {
    var data: [String: Any] = [:]
    if let displayStr = getArg(args, "--display"), let d = Int(displayStr) {
        data["display"] = d
    }
    printDaemonResult(sendEnvelopeRequest(service: "graph", action: "windows", data: data, autoStartBinary: aosExecutablePath()))
}

func graphDeepenCommand(args: [String]) {
    guard let id = getArg(args, "--id") else {
        exitError("--id is required", code: "MISSING_ARG")
    }
    let subtree = parseSubtreeArgs(args)
    let depth = getArg(args, "--depth").flatMap(Int.init)

    var data: [String: Any] = ["id": id]
    if let depth = depth { data["depth"] = depth }
    if let sub = subtree {
        var subDict: [String: Any] = [:]
        if let r = sub.role { subDict["role"] = r }
        if let t = sub.title { subDict["title"] = t }
        if let i = sub.identifier { subDict["identifier"] = i }
        data["subtree"] = subDict
    }

    printDaemonResult(sendEnvelopeRequest(service: "graph", action: "deepen", data: data, autoStartBinary: aosExecutablePath()))
}

func graphCollapseCommand(args: [String]) {
    guard let id = getArg(args, "--id") else {
        exitError("--id is required", code: "MISSING_ARG")
    }
    let depth = getArg(args, "--depth").flatMap(Int.init)

    var data: [String: Any] = ["id": id]
    if let depth = depth { data["depth"] = depth }

    printDaemonResult(sendEnvelopeRequest(service: "graph", action: "collapse", data: data, autoStartBinary: aosExecutablePath()))
}

func daemonSnapshotCommand() {
    printDaemonResult(sendEnvelopeRequest(service: "see", action: "snapshot", data: [:], autoStartBinary: aosExecutablePath()))
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
