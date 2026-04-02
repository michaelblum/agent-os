// client.swift — CLI commands that talk to side-eye daemon
//
// Follows the heads-up client.swift pattern. Auto-starts daemon,
// sends requests via Unix socket, outputs JSON responses.

import Foundation

// MARK: - Daemon Client

class SideEyeClient {
    func connect() -> Int32? {
        let sock = socket(AF_UNIX, SOCK_STREAM, 0)
        guard sock >= 0 else { return nil }
        let result = withSockAddr(kSideEyeSocketPath) { addr, len in
            Foundation.connect(sock, addr, len)
        }
        if result == 0 { return sock }
        close(sock)
        return nil
    }

    func ensureDaemon() -> Bool {
        if let fd = connect() { close(fd); return true }

        let selfPath = ProcessInfo.processInfo.arguments[0]
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: selfPath)
        proc.arguments = ["serve"]
        proc.standardInput = FileHandle.nullDevice
        proc.standardOutput = FileHandle.nullDevice
        proc.standardError = FileHandle.nullDevice
        do { try proc.run() } catch { return false }

        for _ in 0..<50 {
            usleep(100_000)
            if let fd = connect() { close(fd); return true }
        }
        return false
    }

    func sendRequest(_ req: DaemonRequest) -> DaemonResponse {
        guard ensureDaemon() else {
            return .fail("Could not connect to daemon", code: "DAEMON_UNAVAILABLE")
        }
        guard let fd = connect() else {
            return .fail("Could not connect to daemon", code: "DAEMON_UNAVAILABLE")
        }
        defer { close(fd) }

        // Write request
        var data = req.toData()
        data.append(UInt8(ascii: "\n"))
        let written = data.withUnsafeBytes { ptr in
            write(fd, ptr.baseAddress!, ptr.count)
        }
        guard written == data.count else {
            return .fail("Failed to write to socket", code: "WRITE_ERROR")
        }

        // Read response (10s timeout)
        var buffer = Data()
        var chunk = [UInt8](repeating: 0, count: 4096)
        let deadline = Date().addingTimeInterval(10.0)
        while Date() < deadline {
            let n = read(fd, &chunk, chunk.count)
            if n <= 0 { break }
            buffer.append(contentsOf: chunk[0..<n])
            if buffer.contains(UInt8(ascii: "\n")) { break }
        }

        guard let newlineIdx = buffer.firstIndex(of: UInt8(ascii: "\n")) else {
            return .fail("No response from daemon", code: "TIMEOUT")
        }
        let responseData = Data(buffer[buffer.startIndex..<newlineIdx])
        return DaemonResponse.from(responseData) ?? .fail("Invalid response", code: "PARSE_ERROR")
    }
}

// MARK: - Arg Parsing Helper

/// Extract the value following a flag (e.g., "--id" "myval") from an arg list.
/// Returns nil if the flag is not present.
private func getArg(_ args: [String], _ flag: String) -> String? {
    guard let idx = args.firstIndex(of: flag), idx + 1 < args.count else { return nil }
    return args[idx + 1]
}

// MARK: - CLI Command: focus create

func focusCreateCommand(args: [String]) {
    guard let id = getArg(args, "--id") else {
        exitError("--id is required", code: "MISSING_ARG")
    }
    guard let widStr = getArg(args, "--window"), let wid = Int(widStr) else {
        exitError("--window <id> is required", code: "MISSING_ARG")
    }

    var subtree: ChannelSubtree? = nil
    let subRole = getArg(args, "--subtree-role")
    let subTitle = getArg(args, "--subtree-title")
    let subIdent = getArg(args, "--subtree-identifier")
    if subRole != nil || subTitle != nil || subIdent != nil {
        subtree = ChannelSubtree(role: subRole, title: subTitle, identifier: subIdent)
    }

    let depth = getArg(args, "--depth").flatMap(Int.init)
    let pid = getArg(args, "--pid").flatMap(Int.init)

    let req = DaemonRequest(action: "focus-create", id: id, window_id: wid,
                             pid: pid, subtree: subtree, depth: depth)
    let client = SideEyeClient()
    let resp = client.sendRequest(req)
    printDaemonResponse(resp)
}

// MARK: - CLI Command: focus update

func focusUpdateCommand(args: [String]) {
    guard let id = getArg(args, "--id") else {
        exitError("--id is required", code: "MISSING_ARG")
    }

    var subtree: ChannelSubtree? = nil
    let subRole = getArg(args, "--subtree-role")
    let subTitle = getArg(args, "--subtree-title")
    let subIdent = getArg(args, "--subtree-identifier")
    if subRole != nil || subTitle != nil || subIdent != nil {
        subtree = ChannelSubtree(role: subRole, title: subTitle, identifier: subIdent)
    }

    let depth = getArg(args, "--depth").flatMap(Int.init)

    let req = DaemonRequest(action: "focus-update", id: id, subtree: subtree, depth: depth)
    let client = SideEyeClient()
    let resp = client.sendRequest(req)
    printDaemonResponse(resp)
}

// MARK: - CLI Command: focus list

func focusListCommand() {
    let req = DaemonRequest(action: "focus-list")
    let client = SideEyeClient()
    let resp = client.sendRequest(req)
    printDaemonResponse(resp)
}

// MARK: - CLI Command: focus remove

func focusRemoveCommand(args: [String]) {
    guard let id = getArg(args, "--id") else {
        exitError("--id is required", code: "MISSING_ARG")
    }
    let req = DaemonRequest(action: "focus-remove", id: id)
    let client = SideEyeClient()
    let resp = client.sendRequest(req)
    printDaemonResponse(resp)
}

// MARK: - CLI Command: snapshot

func snapshotCommand() {
    let req = DaemonRequest(action: "snapshot")
    let client = SideEyeClient()
    let resp = client.sendRequest(req)
    printDaemonResponse(resp)
}

// MARK: - CLI Command: graph displays

func graphDisplaysCommand() {
    let req = DaemonRequest(action: "graph-displays")
    let client = SideEyeClient()
    let resp = client.sendRequest(req)
    printDaemonResponse(resp)
}

// MARK: - CLI Command: graph windows

func graphWindowsCommand(args: [String]) {
    let display = getArg(args, "--display").flatMap(Int.init)
    let req = DaemonRequest(action: "graph-windows", display: display)
    let client = SideEyeClient()
    let resp = client.sendRequest(req)
    printDaemonResponse(resp)
}

// MARK: - CLI Command: graph deepen

func graphDeepenCommand(args: [String]) {
    guard let id = getArg(args, "--id") else {
        exitError("--id is required", code: "MISSING_ARG")
    }

    var subtree: ChannelSubtree? = nil
    let subRole = getArg(args, "--subtree-role")
    let subTitle = getArg(args, "--subtree-title")
    let subIdent = getArg(args, "--subtree-identifier")
    if subRole != nil || subTitle != nil || subIdent != nil {
        subtree = ChannelSubtree(role: subRole, title: subTitle, identifier: subIdent)
    }

    let depth = getArg(args, "--depth").flatMap(Int.init)

    let req = DaemonRequest(action: "graph-deepen", id: id, subtree: subtree, depth: depth)
    let client = SideEyeClient()
    let resp = client.sendRequest(req)
    printDaemonResponse(resp)
}

// MARK: - CLI Command: graph collapse

func graphCollapseCommand(args: [String]) {
    guard let id = getArg(args, "--id") else {
        exitError("--id is required", code: "MISSING_ARG")
    }

    let depth = getArg(args, "--depth").flatMap(Int.init)

    let req = DaemonRequest(action: "graph-collapse", id: id, depth: depth)
    let client = SideEyeClient()
    let resp = client.sendRequest(req)
    printDaemonResponse(resp)
}

// MARK: - Response Output

private func printDaemonResponse(_ resp: DaemonResponse) {
    let enc = JSONEncoder()
    enc.outputFormatting = [.prettyPrinted, .sortedKeys]
    if let data = try? enc.encode(resp), let s = String(data: data, encoding: .utf8) {
        if resp.error != nil {
            FileHandle.standardError.write((s + "\n").data(using: .utf8)!)
            exit(1)
        } else {
            print(s)
        }
    }
}
