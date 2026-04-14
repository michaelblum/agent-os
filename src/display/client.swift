// display — CLI client: auto-starts daemon, sends commands via Unix socket

import Foundation

// MARK: - Daemon Client

class DaemonClient {
    func connect() -> Int32? {
        let fd = connectSocket(kDefaultSocketPath, timeoutMs: 1000)
        return fd >= 0 ? fd : nil
    }

    func ensureDaemon() -> Bool {
        // Fast path: daemon already running
        if let fd = connect() { close(fd); return true }

        let currentMode = aosCurrentRuntimeMode()
        let otherSocketPath = aosSocketPath(for: currentMode.other)
        if socketIsReachable(otherSocketPath, timeoutMs: 250) {
            return false
        }

        // Spawn child process
        let selfPath = ProcessInfo.processInfo.arguments[0]
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: selfPath)
        proc.arguments = ["serve", "--idle-timeout", "5m"]
        proc.standardInput = FileHandle.nullDevice
        proc.standardOutput = FileHandle.nullDevice

        // Log to file instead of /dev/null
        let logPath = aosDaemonLogPath()
        try? FileManager.default.createDirectory(atPath: kDefaultSocketDir, withIntermediateDirectories: true)
        FileManager.default.createFile(atPath: logPath, contents: nil)
        if let logHandle = FileHandle(forWritingAtPath: logPath) {
            logHandle.seekToEndOfFile()
            proc.standardError = logHandle
        } else {
            proc.standardError = FileHandle.nullDevice
        }

        do { try proc.run() } catch { return false }

        for _ in 0..<50 {
            usleep(100_000)
            if let fd = connect() {
                close(fd)
                return true
            }
        }
        return false
    }

    func send(_ request: CanvasRequest) -> CanvasResponse {
        guard let fd = connect() else {
            return .fail("Cannot connect to daemon", code: "CONNECTION_FAILED")
        }
        defer { close(fd) }

        guard var data = request.toData() else {
            return .fail("Failed to encode request", code: "ENCODE_ERROR")
        }
        data.append(UInt8(ascii: "\n"))
        let written = data.withUnsafeBytes { ptr in
            write(fd, ptr.baseAddress!, ptr.count)
        }
        guard written == data.count else {
            return .fail("Failed to write to socket", code: "WRITE_ERROR")
        }

        var buffer = Data()
        var chunk = [UInt8](repeating: 0, count: 4096)
        let deadline = Date().addingTimeInterval(10.0)
        while Date() < deadline {
            var pfd = pollfd(fd: fd, events: Int16(POLLIN), revents: 0)
            let remaining = Int32(deadline.timeIntervalSinceNow * 1000)
            let timeoutMs = max(remaining, 100)  // at least 100ms per poll
            let ready = poll(&pfd, 1, timeoutMs)
            if ready <= 0 { break }  // timeout or error
            let bytesRead = read(fd, &chunk, chunk.count)
            if bytesRead <= 0 { break }
            buffer.append(contentsOf: chunk[0..<bytesRead])
            if buffer.contains(UInt8(ascii: "\n")) { break }
        }

        guard let newlineIdx = buffer.firstIndex(of: UInt8(ascii: "\n")) else {
            return .fail("No response from daemon", code: "NO_RESPONSE")
        }
        let responseData = Data(buffer[buffer.startIndex..<newlineIdx])
        return CanvasResponse.from(responseData) ?? .fail("Invalid response from daemon", code: "PARSE_ERROR")
    }
}

// MARK: - Resolve HTML content from CLI args

func resolveHTML(htmlValue: String?, fileValue: String?) -> String? {
    if let html = htmlValue { return html }
    if let filePath = fileValue {
        guard let contents = try? String(contentsOfFile: filePath, encoding: .utf8) else {
            exitError("Cannot read file: \(filePath)", code: "FILE_NOT_FOUND")
        }
        return contents
    }
    if isatty(FileHandle.standardInput.fileDescriptor) == 0 {
        let data = FileHandle.standardInput.readDataToEndOfFile()
        if !data.isEmpty, let s = String(data: data, encoding: .utf8) { return s }
    }
    return nil
}

// MARK: - CLI Command: create

func createCommand(args: [String]) {
    var id: String? = nil
    var at: String? = nil
    var anchorWindow: Int? = nil
    var anchorChannel: String? = nil
    var offset: String? = nil
    var htmlValue: String? = nil
    var fileValue: String? = nil
    var urlValue: String? = nil
    var interactive = false
    var focus = false
    var ttlValue: String? = nil
    var scope: String? = nil
    var autoProject: String? = nil
    var track: String? = nil

    var i = 0
    while i < args.count {
        switch args[i] {
        case "--id":
            i += 1; guard i < args.count else { exitError("--id requires a value", code: "MISSING_ARG") }
            id = args[i]
        case "--at":
            i += 1; guard i < args.count else { exitError("--at requires x,y,w,h", code: "MISSING_ARG") }
            at = args[i]
        case "--anchor-window":
            i += 1; guard i < args.count, let w = Int(args[i]) else { exitError("--anchor-window requires an integer", code: "INVALID_ARG") }
            anchorWindow = w
        case "--anchor-channel":
            i += 1; guard i < args.count else { exitError("--anchor-channel requires a channel ID", code: "MISSING_ARG") }
            anchorChannel = args[i]
        case "--offset":
            i += 1; guard i < args.count else { exitError("--offset requires x,y,w,h", code: "MISSING_ARG") }
            offset = args[i]
        case "--html":
            i += 1; guard i < args.count else { exitError("--html requires a value", code: "MISSING_ARG") }
            htmlValue = args[i]
        case "--file":
            i += 1; guard i < args.count else { exitError("--file requires a path", code: "MISSING_ARG") }
            fileValue = args[i]
        case "--url":
            i += 1; guard i < args.count else { exitError("--url requires a value", code: "MISSING_ARG") }
            urlValue = args[i]
        case "--interactive":
            interactive = true
        case "--focus":
            focus = true
        case "--ttl":
            i += 1; guard i < args.count else { exitError("--ttl requires a duration (e.g. 5s, 10m)", code: "MISSING_ARG") }
            ttlValue = args[i]
        case "--scope":
            i += 1; guard i < args.count else { exitError("--scope requires 'connection' or 'global'", code: "MISSING_ARG") }
            scope = args[i]
            guard scope == "connection" || scope == "global" else {
                exitError("--scope must be 'connection' or 'global'", code: "INVALID_ARG")
            }
        case "--auto-project":
            i += 1; guard i < args.count else { exitError("--auto-project requires a mode (cursor_trail, highlight_focused, label_elements)", code: "MISSING_ARG") }
            autoProject = args[i]
        case "--track":
            i += 1; guard i < args.count else { exitError("--track requires a target (e.g. 'union')", code: "MISSING_ARG") }
            track = args[i]
            // v1: only 'union' is supported
            guard track == "union" else {
                exitError("Unknown --track target: \(track ?? ""). Supported: union", code: "INVALID_ARG")
            }
        default:
            exitError("Unknown argument: \(args[i])", code: "UNKNOWN_ARG")
        }
        i += 1
    }

    guard let canvasID = id else { exitError("create requires --id <name>", code: "MISSING_ARG") }

    var request = CanvasRequest(action: "create")
    request.id = canvasID
    request.interactive = interactive
    if focus { request.focus = true }
    request.scope = scope

    if let ttlStr = ttlValue {
        request.ttl = parseDuration(ttlStr)
    }

    if let atStr = at {
        let parts = atStr.split(separator: ",").compactMap { CGFloat(Double($0) ?? 0) }
        guard parts.count == 4 else { exitError("--at must be x,y,w,h (comma-separated)", code: "INVALID_ARG") }
        request.at = parts
    }
    if track != nil && at != nil {
        exitError("cannot combine --at with --track (pick one)", code: "INVALID_ARG")
    }
    if let aw = anchorWindow { request.anchorWindow = aw }
    if let ac = anchorChannel { request.anchorChannel = ac }
    if let offStr = offset {
        let parts = offStr.split(separator: ",").compactMap { CGFloat(Double($0) ?? 0) }
        guard parts.count == 4 else { exitError("--offset must be x,y,w,h (comma-separated)", code: "INVALID_ARG") }
        request.offset = parts
    }
    if let ap = autoProject { request.autoProject = ap }
    if let t = track { request.track = t }

    if let url = urlValue {
        request.url = url
    } else if autoProject == nil {
        request.html = resolveHTML(htmlValue: htmlValue, fileValue: fileValue)
    }

    let client = DaemonClient()
    if !client.ensureDaemon() {
        exitError("Failed to start aos daemon", code: "DAEMON_START_FAILED")
    }
    let response = client.send(request)
    outputResponse(response)
}

// MARK: - CLI Command: update

func updateCommand(args: [String]) {
    var id: String? = nil
    var at: String? = nil
    var anchorWindow: Int? = nil
    var anchorChannel: String? = nil
    var offset: String? = nil
    var htmlValue: String? = nil
    var fileValue: String? = nil
    var urlValue: String? = nil
    var interactive: Bool? = nil
    var focus: Bool? = nil
    var ttlValue: String? = nil
    var track: String? = nil

    var i = 0
    while i < args.count {
        switch args[i] {
        case "--id":
            i += 1; guard i < args.count else { exitError("--id requires a value", code: "MISSING_ARG") }
            id = args[i]
        case "--at":
            i += 1; guard i < args.count else { exitError("--at requires x,y,w,h", code: "MISSING_ARG") }
            at = args[i]
        case "--anchor-window":
            i += 1; guard i < args.count, let w = Int(args[i]) else { exitError("--anchor-window requires an integer", code: "INVALID_ARG") }
            anchorWindow = w
        case "--anchor-channel":
            i += 1; guard i < args.count else { exitError("--anchor-channel requires a channel ID", code: "MISSING_ARG") }
            anchorChannel = args[i]
        case "--offset":
            i += 1; guard i < args.count else { exitError("--offset requires x,y,w,h", code: "MISSING_ARG") }
            offset = args[i]
        case "--html":
            i += 1; guard i < args.count else { exitError("--html requires a value", code: "MISSING_ARG") }
            htmlValue = args[i]
        case "--file":
            i += 1; guard i < args.count else { exitError("--file requires a path", code: "MISSING_ARG") }
            fileValue = args[i]
        case "--url":
            i += 1; guard i < args.count else { exitError("--url requires a value", code: "MISSING_ARG") }
            urlValue = args[i]
        case "--interactive":
            interactive = true
        case "--no-interactive":
            interactive = false
        case "--focus":
            focus = true
        case "--no-focus":
            focus = false
        case "--ttl":
            i += 1; guard i < args.count else { exitError("--ttl requires a duration (e.g. 5s, 10m)", code: "MISSING_ARG") }
            ttlValue = args[i]
        case "--track":
            i += 1; guard i < args.count else { exitError("--track requires a target (e.g. 'union')", code: "MISSING_ARG") }
            track = args[i]
            guard track == "union" else {
                exitError("Unknown --track target: \(track ?? ""). Supported: union", code: "INVALID_ARG")
            }
        default:
            exitError("Unknown argument: \(args[i])", code: "UNKNOWN_ARG")
        }
        i += 1
    }

    guard let canvasID = id else { exitError("update requires --id <name>", code: "MISSING_ARG") }

    var request = CanvasRequest(action: "update")
    request.id = canvasID
    request.interactive = interactive
    request.focus = focus

    if let ttlStr = ttlValue {
        request.ttl = parseDuration(ttlStr)
    }

    if track != nil && at != nil {
        exitError("cannot combine --at with --track (pick one)", code: "INVALID_ARG")
    }

    if let atStr = at {
        let parts = atStr.split(separator: ",").compactMap { CGFloat(Double($0) ?? 0) }
        guard parts.count == 4 else { exitError("--at must be x,y,w,h", code: "INVALID_ARG") }
        request.at = parts
    }
    if let aw = anchorWindow { request.anchorWindow = aw }
    if let ac = anchorChannel { request.anchorChannel = ac }
    if let offStr = offset {
        let parts = offStr.split(separator: ",").compactMap { CGFloat(Double($0) ?? 0) }
        guard parts.count == 4 else { exitError("--offset must be x,y,w,h", code: "INVALID_ARG") }
        request.offset = parts
    }
    if let url = urlValue {
        request.url = url
    } else if htmlValue != nil || fileValue != nil {
        request.html = resolveHTML(htmlValue: htmlValue, fileValue: fileValue)
    }
    if let t = track { request.track = t }

    let client = DaemonClient()
    guard let fd = client.connect() else {
        exitError("Daemon not running. Create a canvas first.", code: "NO_DAEMON")
    }
    close(fd)
    let response = client.send(request)
    outputResponse(response)
}

// MARK: - CLI Command: remove

func removeCommand(args: [String]) {
    var id: String? = nil

    var i = 0
    while i < args.count {
        switch args[i] {
        case "--id":
            i += 1; guard i < args.count else { exitError("--id requires a value", code: "MISSING_ARG") }
            id = args[i]
        default:
            exitError("Unknown argument: \(args[i])", code: "UNKNOWN_ARG")
        }
        i += 1
    }

    guard let canvasID = id else { exitError("remove requires --id <name>", code: "MISSING_ARG") }

    var request = CanvasRequest(action: "remove")
    request.id = canvasID

    let client = DaemonClient()
    guard let fd = client.connect() else {
        exitError("Daemon not running. Nothing to remove.", code: "NO_DAEMON")
    }
    close(fd)
    let response = client.send(request)
    outputResponse(response)
}

// MARK: - CLI Command: remove-all

func removeAllCommand(args: [String]) {
    let request = CanvasRequest(action: "remove-all")
    let client = DaemonClient()
    guard let fd = client.connect() else {
        exitError("Daemon not running. Nothing to remove.", code: "NO_DAEMON")
    }
    close(fd)
    let response = client.send(request)
    outputResponse(response)
}

// MARK: - CLI Command: list

func listCommand(args: [String]) {
    var i = 0
    while i < args.count {
        switch args[i] {
        case "--json":
            break
        default:
            exitError("Unknown argument: \(args[i])", code: "UNKNOWN_ARG")
        }
        i += 1
    }

    let request = CanvasRequest(action: "list")
    let client = DaemonClient()
    guard let fd = client.connect() else {
        let empty = CanvasResponse(status: "success", canvases: [])
        outputResponse(empty)
        return
    }
    close(fd)
    let response = client.send(request)
    outputResponse(response)
}

// MARK: - CLI Command: ping

func pingCommand(args: [String]) {
    let request = CanvasRequest(action: "ping")
    let client = DaemonClient()
    guard let fd = client.connect() else {
        exitError("Daemon not running.", code: "NO_DAEMON")
    }
    close(fd)
    let response = client.send(request)
    outputResponse(response)
}

// MARK: - CLI Command: eval

func evalCommand(args: [String]) {
    var id: String? = nil
    var js: String? = nil

    var i = 0
    while i < args.count {
        switch args[i] {
        case "--id":
            i += 1; guard i < args.count else { exitError("--id requires a value", code: "MISSING_ARG") }
            id = args[i]
        case "--js":
            i += 1; guard i < args.count else { exitError("--js requires a value", code: "MISSING_ARG") }
            js = args[i]
        default:
            exitError("Unknown argument: \(args[i])", code: "UNKNOWN_ARG")
        }
        i += 1
    }

    guard let canvasID = id else { exitError("eval requires --id <name>", code: "MISSING_ARG") }
    guard let jsCode = js else { exitError("eval requires --js <code>", code: "MISSING_ARG") }

    var request = CanvasRequest(action: "eval")
    request.id = canvasID
    request.js = jsCode

    let client = DaemonClient()
    guard let fd = client.connect() else {
        exitError("Daemon not running.", code: "NO_DAEMON")
    }
    close(fd)
    let response = client.send(request)
    outputResponse(response)
}

// MARK: - CLI Command: post

func postCommand(args: [String]) {
    var channel: String? = nil
    var data: String? = nil
    var i = 0
    while i < args.count {
        switch args[i] {
        case "--channel":
            i += 1; guard i < args.count else { exitError("--channel requires a value", code: "MISSING_ARG") }
            channel = args[i]
        case "--data":
            i += 1; guard i < args.count else { exitError("--data requires a JSON value", code: "MISSING_ARG") }
            data = args[i]
        default:
            exitError("Unknown argument: \(args[i])", code: "UNKNOWN_ARG")
        }
        i += 1
    }
    guard let ch = channel else { exitError("post requires --channel <name>", code: "MISSING_ARG") }

    var request = CanvasRequest(action: "post")
    request.channel = ch
    request.data = data

    let client = DaemonClient()
    if !client.ensureDaemon() { exitError("Failed to start daemon", code: "DAEMON_START_FAILED") }
    let response = client.send(request)
    outputResponse(response)
}

// MARK: - CLI Command: to-front

func toFrontCommand(args: [String]) {
    var id: String? = nil
    var i = 0
    while i < args.count {
        if args[i] == "--id" && i + 1 < args.count { id = args[i + 1]; i += 2; continue }
        exitError("Unknown argument: \(args[i])", code: "UNKNOWN_ARG")
    }
    guard let canvasID = id else { exitError("to-front requires --id <name>", code: "MISSING_ARG") }

    var request = CanvasRequest(action: "to-front")
    request.id = canvasID

    let client = DaemonClient()
    if !client.ensureDaemon() { exitError("Failed to start daemon", code: "DAEMON_START_FAILED") }
    let response = client.send(request)
    outputResponse(response)
}

// MARK: - CLI Command: listen

func listenCommand(args: [String]) {
    if !args.isEmpty {
        exitError("Unknown argument: \(args[0])", code: "UNKNOWN_ARG")
    }

    let client = DaemonClient()
    if !client.ensureDaemon() {
        exitError("Failed to start aos daemon", code: "DAEMON_START_FAILED")
    }

    guard let fd = client.connect() else {
        exitError("Cannot connect to daemon", code: "CONNECTION_FAILED")
    }

    // Send subscribe to register for events
    guard var subData = CanvasRequest(action: "subscribe").toData() else {
        close(fd)
        exitError("Failed to encode subscribe", code: "ENCODE_ERROR")
    }
    subData.append(UInt8(ascii: "\n"))
    subData.withUnsafeBytes { ptr in
        _ = write(fd, ptr.baseAddress!, ptr.count)
    }

    // Set up clean exit on signals
    signal(SIGINT, SIG_IGN)
    signal(SIGTERM, SIG_IGN)
    let sigint = DispatchSource.makeSignalSource(signal: SIGINT, queue: .global())
    sigint.setEventHandler { close(fd); exit(0) }
    sigint.resume()
    let sigterm = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .global())
    sigterm.setEventHandler { close(fd); exit(0) }
    sigterm.resume()

    // Forward stdin → daemon (allows sending commands on a persistent connection)
    DispatchQueue.global(qos: .userInitiated).async {
        var stdinBuf = Data()
        var chunk = [UInt8](repeating: 0, count: 4096)
        while true {
            let n = Foundation.read(STDIN_FILENO, &chunk, chunk.count)
            guard n > 0 else { break }  // EOF on stdin — stop forwarding but keep reading events
            stdinBuf.append(contentsOf: chunk[0..<n])
            while let nl = stdinBuf.firstIndex(of: UInt8(ascii: "\n")) {
                let line = Data(stdinBuf[stdinBuf.startIndex...nl])
                stdinBuf = Data(stdinBuf[(stdinBuf.index(after: nl))...])
                line.withUnsafeBytes { ptr in
                    _ = write(fd, ptr.baseAddress!, ptr.count)
                }
            }
        }
    }

    // Read daemon → stdout (responses + events)
    var buffer = Data()
    var chunk = [UInt8](repeating: 0, count: 4096)
    while true {
        let n = read(fd, &chunk, chunk.count)
        guard n > 0 else { break }  // daemon disconnected
        buffer.append(contentsOf: chunk[0..<n])
        while let nl = buffer.firstIndex(of: UInt8(ascii: "\n")) {
            let line = Data(buffer[buffer.startIndex..<nl])
            buffer = Data(buffer[(buffer.index(after: nl))...])
            if let str = String(data: line, encoding: .utf8) {
                print(str)
                fflush(stdout)
            }
        }
    }
    exit(0)
}

// MARK: - Output

func outputResponse(_ response: CanvasResponse) {
    if response.error != nil {
        if let data = response.toData(), let s = String(data: data, encoding: .utf8) {
            FileHandle.standardError.write(s.data(using: .utf8)!)
            FileHandle.standardError.write("\n".data(using: .utf8)!)
        }
        exit(1)
    } else {
        if let data = response.toData(), let s = String(data: data, encoding: .utf8) {
            print(s)
        }
    }
}
