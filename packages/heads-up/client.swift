// heads-up — CLI client: auto-starts daemon, sends commands via Unix socket

import Foundation

// MARK: - Daemon Client

class DaemonClient {
    func connect() -> Int32? {
        let sock = socket(AF_UNIX, SOCK_STREAM, 0)
        guard sock >= 0 else { return nil }

        // Non-blocking connect with 1s timeout
        let flags = fcntl(sock, F_GETFL)
        fcntl(sock, F_SETFL, flags | O_NONBLOCK)

        let result = withSockAddr(kSocketPath) { addr, len in
            Foundation.connect(sock, addr, len)
        }

        if result != 0 {
            if errno == EINPROGRESS {
                var pfd = pollfd(fd: sock, events: Int16(POLLOUT), revents: 0)
                let ready = poll(&pfd, 1, 1000)
                if ready <= 0 { close(sock); return nil }
                var optErr: Int32 = 0
                var optLen = socklen_t(MemoryLayout<Int32>.size)
                getsockopt(sock, SOL_SOCKET, SO_ERROR, &optErr, &optLen)
                if optErr != 0 { close(sock); return nil }
            } else {
                close(sock); return nil
            }
        }

        // Restore blocking mode
        fcntl(sock, F_SETFL, flags & ~O_NONBLOCK)
        return sock
    }

    func ensureDaemon() -> Bool {
        // Fast path: daemon already running
        if let fd = connect() { close(fd); return true }

        let plistPath = launchAgentPlistPath()

        if FileManager.default.fileExists(atPath: plistPath) {
            // INSTALLED MODE: launchd manages the daemon. Never self-spawn.
            // Wait for launchd to start it (up to 10s).
            // Optionally kick launchd to hurry.
            let kickProc = Process()
            kickProc.executableURL = URL(fileURLWithPath: "/bin/launchctl")
            kickProc.arguments = ["kickstart", "gui/\(getuid())/\(kPlistLabel)"]
            kickProc.standardOutput = FileHandle.nullDevice
            kickProc.standardError = FileHandle.nullDevice
            try? kickProc.run()
            kickProc.waitUntilExit()

            for _ in 0..<100 {  // up to 10s
                usleep(100_000)
                if let fd = connect() { close(fd); return true }
            }
            // launchd failed to start daemon — surface the failure
            return false
        }

        // UNMANAGED MODE: spawn child process (legacy fallback)
        let selfPath = ProcessInfo.processInfo.arguments[0]
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: selfPath)
        proc.arguments = ["serve"]
        proc.standardInput = FileHandle.nullDevice
        proc.standardOutput = FileHandle.nullDevice

        // Log to file instead of /dev/null
        let logPath = kSocketDir + "/daemon.log"
        try? FileManager.default.createDirectory(atPath: kSocketDir, withIntermediateDirectories: true)
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
    var ttlValue: String? = nil
    var scope: String? = nil
    var autoProject: String? = nil

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
        default:
            exitError("Unknown argument: \(args[i])", code: "UNKNOWN_ARG")
        }
        i += 1
    }

    guard let canvasID = id else { exitError("create requires --id <name>", code: "MISSING_ARG") }

    var request = CanvasRequest(action: "create")
    request.id = canvasID
    request.interactive = interactive
    request.scope = scope

    if let ttlStr = ttlValue {
        request.ttl = parseDuration(ttlStr)
    }

    if let atStr = at {
        let parts = atStr.split(separator: ",").compactMap { CGFloat(Double($0) ?? 0) }
        guard parts.count == 4 else { exitError("--at must be x,y,w,h (comma-separated)", code: "INVALID_ARG") }
        request.at = parts
    }
    if let aw = anchorWindow { request.anchorWindow = aw }
    if let ac = anchorChannel { request.anchorChannel = ac }
    if let offStr = offset {
        let parts = offStr.split(separator: ",").compactMap { CGFloat(Double($0) ?? 0) }
        guard parts.count == 4 else { exitError("--offset must be x,y,w,h (comma-separated)", code: "INVALID_ARG") }
        request.offset = parts
    }
    if let ap = autoProject { request.autoProject = ap }

    if let url = urlValue {
        request.url = url
    } else if autoProject == nil {
        request.html = resolveHTML(htmlValue: htmlValue, fileValue: fileValue)
    }

    let client = DaemonClient()
    if !client.ensureDaemon() {
        exitError("Failed to start heads-up daemon", code: "DAEMON_START_FAILED")
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
    var ttlValue: String? = nil

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
        case "--ttl":
            i += 1; guard i < args.count else { exitError("--ttl requires a duration (e.g. 5s, 10m)", code: "MISSING_ARG") }
            ttlValue = args[i]
        default:
            exitError("Unknown argument: \(args[i])", code: "UNKNOWN_ARG")
        }
        i += 1
    }

    guard let canvasID = id else { exitError("update requires --id <name>", code: "MISSING_ARG") }

    var request = CanvasRequest(action: "update")
    request.id = canvasID
    request.interactive = interactive

    if let ttlStr = ttlValue {
        request.ttl = parseDuration(ttlStr)
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
        exitError("Failed to start heads-up daemon", code: "DAEMON_START_FAILED")
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

// MARK: - CLI Command: install

let kPlistLabel = "com.agent-os.heads-up"

func launchAgentPlistPath() -> String {
    let home = NSHomeDirectory()
    return home + "/Library/LaunchAgents/\(kPlistLabel).plist"
}

func installCommand(args: [String]) {
    // Resolve absolute binary path (follow symlinks)
    let rawPath = ProcessInfo.processInfo.arguments[0]
    let resolvedURL = URL(fileURLWithPath: rawPath).standardizedFileURL.resolvingSymlinksInPath()
    let binaryPath = resolvedURL.path

    // Ensure LaunchAgents directory exists
    let launchAgentsDir = NSHomeDirectory() + "/Library/LaunchAgents"
    try? FileManager.default.createDirectory(atPath: launchAgentsDir, withIntermediateDirectories: true)

    // Ensure log directory exists
    try? FileManager.default.createDirectory(atPath: kSocketDir, withIntermediateDirectories: true)
    let logPath = kSocketDir + "/daemon.log"

    // Generate plist
    let plist = """
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
      "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0">
    <dict>
        <key>Label</key>
        <string>\(kPlistLabel)</string>
        <key>ProgramArguments</key>
        <array>
            <string>\(binaryPath)</string>
            <string>serve</string>
            <string>--idle-timeout</string>
            <string>none</string>
        </array>
        <key>KeepAlive</key>
        <true/>
        <key>RunAtLoad</key>
        <true/>
        <key>StandardOutPath</key>
        <string>\(logPath)</string>
        <key>StandardErrorPath</key>
        <string>\(logPath)</string>
        <key>ProcessType</key>
        <string>Interactive</string>
    </dict>
    </plist>
    """

    let plistPath = launchAgentPlistPath()

    // If already installed, unload first
    if FileManager.default.fileExists(atPath: plistPath) {
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        proc.arguments = ["unload", plistPath]
        proc.standardOutput = FileHandle.nullDevice
        proc.standardError = FileHandle.nullDevice
        try? proc.run()
        proc.waitUntilExit()
    }

    // Stop any manually-spawned daemon so launchd takes over
    let client = DaemonClient()
    if let fd = client.connect() {
        close(fd)
        // Daemon is running outside launchd — kill it
        let killProc = Process()
        killProc.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
        killProc.arguments = ["-f", "heads-up serve"]
        killProc.standardOutput = FileHandle.nullDevice
        killProc.standardError = FileHandle.nullDevice
        try? killProc.run()
        killProc.waitUntilExit()
        usleep(500_000)  // let it die
    }

    // Write plist
    do {
        try plist.write(toFile: plistPath, atomically: true, encoding: .utf8)
    } catch {
        exitError("Failed to write plist: \(error)", code: "WRITE_FAILED")
    }

    // Load via launchctl
    let loadProc = Process()
    loadProc.executableURL = URL(fileURLWithPath: "/bin/launchctl")
    loadProc.arguments = ["load", plistPath]
    do { try loadProc.run() } catch {
        exitError("launchctl load failed: \(error)", code: "LAUNCHCTL_FAILED")
    }
    loadProc.waitUntilExit()

    if loadProc.terminationStatus != 0 {
        exitError("launchctl load exited with status \(loadProc.terminationStatus)", code: "LAUNCHCTL_FAILED")
    }

    // Wait for daemon to come up (up to 5s)
    var started = false
    for _ in 0..<50 {
        usleep(100_000)
        if let fd = client.connect() {
            close(fd)
            started = true
            break
        }
    }

    if started {
        let result: [String: Any] = [
            "status": "success",
            "message": "Installed. Daemon managed by launchd.",
            "plist": plistPath,
            "binary": binaryPath,
            "log": logPath
        ]
        if let data = try? JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]),
           let str = String(data: data, encoding: .utf8) {
            print(str)
        }
    } else {
        exitError("Daemon did not start within 5s. Check: launchctl list | grep heads-up", code: "DAEMON_START_TIMEOUT")
    }
}

// MARK: - CLI Command: uninstall

func uninstallCommand(args: [String]) {
    let plistPath = launchAgentPlistPath()

    guard FileManager.default.fileExists(atPath: plistPath) else {
        exitError("Not installed. No plist at \(plistPath)", code: "NOT_INSTALLED")
    }

    // Unload (this stops the daemon)
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/bin/launchctl")
    proc.arguments = ["unload", plistPath]
    do { try proc.run() } catch {
        exitError("launchctl unload failed: \(error)", code: "LAUNCHCTL_FAILED")
    }
    proc.waitUntilExit()

    // Remove plist
    try? FileManager.default.removeItem(atPath: plistPath)

    let result: [String: String] = [
        "status": "success",
        "message": "Uninstalled. Daemon stopped."
    ]
    if let data = try? JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]),
       let str = String(data: data, encoding: .utf8) {
        print(str)
    }
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
