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
    let target = getArg(args, "--target")
    let widStr = getArg(args, "--window")

    // --target and --window are mutually exclusive. Check this before the
    // --window required-guard below, otherwise the mutex message never fires.
    if target != nil && widStr != nil {
        exitError("--target and --window are mutually exclusive", code: "INVALID_ARG")
    }

    if let t = target {
        focusCreateBrowser(id: id, targetSpec: t, rest: args)
        return
    }

    guard let widStr = widStr, let wid = Int(widStr) else {
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

// MARK: - Browser Focus Channels
//
// `aos focus create --target browser://<kind>` creates a CLI-local focus
// channel backed by the browser registry (Task 6). Two kinds:
//   - browser://attach  — attach to an existing browser (extension | CDP)
//   - browser://new     — launch an agent-owned browser (headed|headless)
//
// `focus list` merges daemon window channels (kind=window) with registry
// browser channels (kind=browser) into a typed union.
//
// `focus remove` dispatches on registry lookup first; for mode=launched it
// also runs `playwright-cli close` so the agent-launched process exits.

func focusCreateBrowser(id: String, targetSpec: String, rest: [String]) {
    guard let url = URL(string: targetSpec),
          url.scheme == "browser",
          let kind = url.host else {
        exitError("invalid --target; expected browser://attach or browser://new", code: "INVALID_ARG")
    }

    do {
        try ensureVersion()
        switch kind {
        case "attach":
            var attachKind = "extension"
            var cdp: String? = nil
            if rest.contains("--extension") { attachKind = "extension" }
            if let cdpVal = getArg(rest, "--cdp") { attachKind = "cdp"; cdp = cdpVal }
            let pwArgs: [String]
            switch attachKind {
            case "extension": pwArgs = ["--extension"]
            case "cdp":       pwArgs = cdp.map { ["--cdp=\($0)"] } ?? ["--cdp=chrome"]
            default:          pwArgs = ["--extension"]
            }
            let r = try runPlaywright(PlaywrightInvocation(
                session: id, verb: "attach", args: pwArgs, withTempFilename: false
            ))
            try requireSuccess(r, action: "playwright attach")
            let winID = resolveBrowserWindowID(session: id)
            try addRegistryRecord(BrowserSessionRecord(
                id: id, mode: "attach", attach_kind: attachKind, headless: nil,
                browser_window_id: winID, active_url: nil, updated_at: isoNow()
            ))
            print("{\"status\":\"success\",\"id\":\"\(id)\",\"mode\":\"attach\",\"attach\":\"\(attachKind)\"}")
        case "new":
            let headless = rest.contains("--headless")
            var openArgs: [String] = []
            if !headless { openArgs.append("--headed") }
            if let u = getArg(rest, "--url") { openArgs.append(u) }
            if rest.contains("--persistent") { openArgs.append("--persistent") }
            let r = try runPlaywright(PlaywrightInvocation(
                session: id, verb: "open", args: openArgs, withTempFilename: false
            ))
            try requireSuccess(r, action: "playwright open")
            let winID = resolveBrowserWindowID(session: id)
            try addRegistryRecord(BrowserSessionRecord(
                id: id, mode: "launched", attach_kind: nil, headless: headless,
                browser_window_id: winID, active_url: nil, updated_at: isoNow()
            ))
            print("{\"status\":\"success\",\"id\":\"\(id)\",\"mode\":\"launched\",\"headless\":\(headless)}")
        default:
            exitError("invalid --target kind: \(kind)", code: "INVALID_ARG")
        }
    } catch SessionRegistryError.duplicateID {
        exitError("focus channel '\(id)' already exists", code: "DUPLICATE_ID")
    } catch BrowserAdapterError.versionCheckFailed(let msg, let code) {
        exitError(msg, code: code)
    } catch BrowserAdapterError.subprocess(let msg, let code) {
        exitError(msg, code: code)
    } catch {
        exitError("\(error)", code: "INTERNAL")
    }
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
    // Merge daemon window channels (kind=window) with the browser registry
    // (kind=browser) into a typed union. We do not pass autoStartBinary: the
    // registry is always available even when the daemon is down, and
    // auto-start stderr noise would interleave with callers that grep stdout.
    // A nil or error daemon response degrades to "zero window channels".
    let daemonResp = sendEnvelopeRequest(service: "focus", action: "list", data: [:])

    var merged: [[String: Any]] = []
    if let resp = daemonResp, resp["error"] == nil,
       let chans = resp["channels"] as? [[String: Any]] {
        for var entry in chans {
            entry["kind"] = "window"
            merged.append(entry)
        }
    }

    if let registry = try? readRegistry() {
        for r in registry {
            // Emit stable keys with NSNull for absent optionals so the typed
            // browser entry shape is always the same — callers can jq
            // .browser_window_id without checking existence first.
            let dict: [String: Any] = [
                "kind": "browser",
                "id": r.id,
                "session": r.id,
                "mode": r.mode,
                "updated_at": r.updated_at,
                "attach": r.attach_kind as Any? ?? NSNull(),
                "headless": r.headless as Any? ?? NSNull(),
                "browser_window_id": r.browser_window_id as Any? ?? NSNull(),
                "active_url": r.active_url as Any? ?? NSNull()
            ]
            merged.append(dict)
        }
    }

    let payload: [String: Any] = ["status": "ok", "channels": merged]
    if let data = try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys]),
       let s = String(data: data, encoding: .utf8) {
        print(s)
    } else {
        exitError("failed to serialize focus list", code: "SERIALIZE_ERROR")
    }
}

func focusRemoveCommand(args: [String]) {
    guard let id = getArg(args, "--id") else {
        exitError("--id is required", code: "MISSING_ARG")
    }
    // Registry-first dispatch. Browser-backed channels live in the CLI-local
    // registry, not the daemon — so we resolve there before falling through
    // to the daemon's window-channel path. For mode=launched we also run
    // `playwright-cli close` so the agent-launched browser process exits.
    if let record = (try? findRegistryRecord(id: id)) ?? nil {
        do {
            if record.mode == "launched" {
                _ = try? runPlaywright(PlaywrightInvocation(
                    session: id, verb: "close", args: [], withTempFilename: false))
            }
            try removeRegistryRecord(id: id)
            print("{\"status\":\"ok\"}")
            return
        } catch {
            exitError("\(error)", code: "INTERNAL")
        }
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
