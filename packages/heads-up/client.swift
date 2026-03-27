// heads-up — CLI client: auto-starts daemon, sends commands via Unix socket

import Foundation

// MARK: - Daemon Client

class DaemonClient {
    func connect() -> Int32? {
        let sock = socket(AF_UNIX, SOCK_STREAM, 0)
        guard sock >= 0 else { return nil }

        let result = withSockAddr(kSocketPath) { addr, len in
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
    var offset: String? = nil
    var htmlValue: String? = nil
    var fileValue: String? = nil
    var urlValue: String? = nil
    var interactive = false
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
        default:
            exitError("Unknown argument: \(args[i])", code: "UNKNOWN_ARG")
        }
        i += 1
    }

    guard let canvasID = id else { exitError("create requires --id <name>", code: "MISSING_ARG") }

    var request = CanvasRequest(action: "create")
    request.id = canvasID
    request.interactive = interactive

    if let ttlStr = ttlValue {
        request.ttl = parseDuration(ttlStr)
    }

    if let atStr = at {
        let parts = atStr.split(separator: ",").compactMap { CGFloat(Double($0) ?? 0) }
        guard parts.count == 4 else { exitError("--at must be x,y,w,h (comma-separated)", code: "INVALID_ARG") }
        request.at = parts
    }
    if let aw = anchorWindow { request.anchorWindow = aw }
    if let offStr = offset {
        let parts = offStr.split(separator: ",").compactMap { CGFloat(Double($0) ?? 0) }
        guard parts.count == 4 else { exitError("--offset must be x,y,w,h (comma-separated)", code: "INVALID_ARG") }
        request.offset = parts
    }

    if let url = urlValue {
        request.url = url
    } else {
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
    exitError("eval not yet implemented", code: "NOT_IMPLEMENTED")
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
