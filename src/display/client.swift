// display — CLI client: auto-starts daemon, sends commands via Unix socket

import Foundation

// MARK: - Daemon Client

class DaemonClient {
    func connect() -> Int32? {
        let fd = connectSocket(kDefaultSocketPath, timeoutMs: 1000)
        return fd >= 0 ? fd : nil
    }

    func ensureDaemon() -> Bool {
        let session = DaemonSession()
        let ok = session.connectWithAutoStart(binaryPath: ProcessInfo.processInfo.arguments[0])
        session.disconnect()
        return ok
    }

    func send(_ request: CanvasRequest) -> CanvasResponse {
        let service = "show"
        let action = envelopeAction(for: request.action)
        var dataDict: [String: Any] = [:]
        // CanvasRequest has ~18 optional fields; include only non-nil ones
        if let id = request.id { dataDict["id"] = id }
        if let at = request.at { dataDict["at"] = at.map { Double($0) } }
        if let aw = request.anchorWindow { dataDict["anchor_window"] = aw }
        if let ac = request.anchorChannel { dataDict["anchor_channel"] = ac }
        if let off = request.offset { dataDict["offset"] = off.map { Double($0) } }
        if let html = request.html { dataDict["html"] = html }
        if let url = request.url { dataDict["url"] = url }
        if let inter = request.interactive { dataDict["interactive"] = inter }
        if let level = request.windowLevel { dataDict["window_level"] = level }
        if let focus = request.focus { dataDict["focus"] = focus }
        if let ttl = request.ttl { dataDict["ttl"] = ttl }
        if let js = request.js { dataDict["js"] = js }
        if let scope = request.scope { dataDict["scope"] = scope }
        if let ap = request.autoProject { dataDict["auto_project"] = ap }
        if let track = request.track { dataDict["track"] = track }
        if let surface = request.surface { dataDict["surface"] = surface }
        if let parent = request.parent { dataDict["parent"] = parent }
        if let cas = request.cascade { dataDict["cascade"] = cas }
        if let sus = request.suspended { dataDict["suspended"] = sus }
        if let ch = request.channel { dataDict["channel"] = ch }
        if let d = request.data { dataDict["data"] = d }
        let owner = request.owner ?? (request.action == "create" ? CanvasOwnerInfo.currentCLI() : nil)
        if let ownerDict = owner?.dictionary() { dataDict["owner"] = ownerDict }

        guard let response = sendEnvelopeRequest(service: service, action: action, data: dataDict) else {
            return CanvasResponse.fail("IPC failure", code: "INTERNAL")
        }
        return CanvasResponse.fromDict(response)
    }
}

/// Map a legacy CanvasRequest.action string to the v1 (service, action) verb.
private func envelopeAction(for legacy: String) -> String {
    switch legacy {
    case "create":      return "create"
    case "update":      return "update"
    case "eval":        return "eval"
    case "remove":      return "remove"
    case "remove-all":  return "remove_all"
    case "list":        return "list"
    case "to-front":    return "to_front"
    default:            return legacy  // let the daemon reject unknown actions
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

// MARK: - Canvas Mutation Parsing

private enum CanvasMutationKind {
    case create
    case update
}

private struct CanvasMutationOptions {
    var id: String? = nil
    var at: String? = nil
    var anchorWindow: Int? = nil
    var anchorChannel: String? = nil
    var anchorBrowser: String? = nil
    var offset: String? = nil
    var htmlValue: String? = nil
    var fileValue: String? = nil
    var urlValue: String? = nil
    var interactive: Bool? = nil
    var windowLevel: String? = nil
    var focus: Bool? = nil
    var ttlValue: String? = nil
    var scope: String? = nil
    var autoProject: String? = nil
    var track: String? = nil
    var surface: String? = nil
}

private func nextCanvasArg(_ args: [String], index: inout Int, missingMessage: String, code: String = "MISSING_ARG") -> String {
    index += 1
    guard index < args.count else { exitError(missingMessage, code: code) }
    return args[index]
}

private func nextCanvasIntArg(_ args: [String], index: inout Int, invalidMessage: String) -> Int {
    let value = nextCanvasArg(args, index: &index, missingMessage: invalidMessage, code: "INVALID_ARG")
    guard let parsed = Int(value) else { exitError(invalidMessage, code: "INVALID_ARG") }
    return parsed
}

private func parseTimeoutMsArg(_ value: String, flagName: String) -> Int {
    let seconds = parseDuration(value)
    guard seconds.isFinite, seconds > 0 else {
        exitError("\(flagName) must be a positive finite duration", code: "INVALID_ARG")
    }
    return Int(seconds * 1000)
}

private func parseCanvasQuad(_ value: String, invalidMessage: String) -> [CGFloat] {
    let parts = value.split(separator: ",").compactMap { CGFloat(Double($0) ?? 0) }
    guard parts.count == 4 else { exitError(invalidMessage, code: "INVALID_ARG") }
    return parts
}

private func parseCanvasMutationOptions(_ args: [String], kind: CanvasMutationKind) -> CanvasMutationOptions {
    var options = CanvasMutationOptions()
    var i = 0

    while i < args.count {
        switch args[i] {
        case "--id":
            options.id = nextCanvasArg(args, index: &i, missingMessage: "--id requires a value")
        case "--at":
            options.at = nextCanvasArg(args, index: &i, missingMessage: "--at requires x,y,w,h")
        case "--anchor-window":
            options.anchorWindow = nextCanvasIntArg(args, index: &i, invalidMessage: "--anchor-window requires an integer")
        case "--anchor-channel":
            options.anchorChannel = nextCanvasArg(args, index: &i, missingMessage: "--anchor-channel requires a channel ID")
        case "--anchor-browser":
            options.anchorBrowser = nextCanvasArg(args, index: &i, missingMessage: "--anchor-browser requires browser:<s>[/<ref>]")
        case "--offset":
            options.offset = nextCanvasArg(args, index: &i, missingMessage: "--offset requires x,y,w,h")
        case "--html":
            options.htmlValue = nextCanvasArg(args, index: &i, missingMessage: "--html requires a value")
        case "--file":
            options.fileValue = nextCanvasArg(args, index: &i, missingMessage: "--file requires a path")
        case "--url":
            options.urlValue = nextCanvasArg(args, index: &i, missingMessage: "--url requires a value")
        case "--interactive":
            options.interactive = true
        case "--no-interactive":
            guard kind == .update else { exitError("Unknown argument: \(args[i])", code: "UNKNOWN_ARG") }
            options.interactive = false
        case "--window-level":
            options.windowLevel = nextCanvasArg(args, index: &i, missingMessage: "--window-level requires a value")
        case "--focus":
            options.focus = true
        case "--no-focus":
            guard kind == .update else { exitError("Unknown argument: \(args[i])", code: "UNKNOWN_ARG") }
            options.focus = false
        case "--ttl":
            options.ttlValue = nextCanvasArg(args, index: &i, missingMessage: "--ttl requires a duration (e.g. 5s, 10m)")
        case "--scope":
            guard kind == .create else { exitError("Unknown argument: \(args[i])", code: "UNKNOWN_ARG") }
            let scope = nextCanvasArg(args, index: &i, missingMessage: "--scope requires 'connection' or 'global'")
            guard scope == "connection" || scope == "global" else {
                exitError("--scope must be 'connection' or 'global'", code: "INVALID_ARG")
            }
            options.scope = scope
        case "--auto-project":
            guard kind == .create else { exitError("Unknown argument: \(args[i])", code: "UNKNOWN_ARG") }
            options.autoProject = nextCanvasArg(
                args,
                index: &i,
                missingMessage: "--auto-project requires a mode (cursor_trail, highlight_focused, label_elements)"
            )
        case "--track":
            let track = nextCanvasArg(args, index: &i, missingMessage: "--track requires a target (e.g. 'union')")
            guard track == "union" else {
                exitError("Unknown --track target: \(track). Supported: union", code: "INVALID_ARG")
            }
            options.track = track
        case "--surface":
            guard kind == .create else { exitError("Unknown argument: \(args[i])", code: "UNKNOWN_ARG") }
            let surface = nextCanvasArg(args, index: &i,
                                        missingMessage: "--surface requires a target (e.g. 'desktop-world')")
            guard surface == "desktop-world" else {
                exitError("Unknown --surface target: \(surface). Supported: desktop-world",
                          code: "INVALID_ARG")
            }
            options.surface = surface
        default:
            exitError("Unknown argument: \(args[i])", code: "UNKNOWN_ARG")
        }
        i += 1
    }

    return options
}

private func applyCanvasMutationOptions(_ options: CanvasMutationOptions, to request: inout CanvasRequest, kind: CanvasMutationKind) {
    var options = options

    // Resolve --anchor-browser into an (anchor_window, offset) pair before
    // the regular anchor/offset plumbing below. Mutually exclusive with
    // --anchor-window and --anchor-channel.
    if let browserSpec = options.anchorBrowser {
        if options.anchorWindow != nil || options.anchorChannel != nil {
            exitError(
                "--anchor-browser is mutually exclusive with --anchor-window and --anchor-channel",
                code: "INVALID_ARG"
            )
        }
        do {
            let t = try parseBrowserTarget(browserSpec)
            let anchor = try resolveBrowserAnchor(target: t)
            options.anchorWindow = anchor.anchor_window
            options.offset = "\(anchor.offset[0]),\(anchor.offset[1]),\(anchor.offset[2]),\(anchor.offset[3])"
        } catch AnchorResolveError.notFound(let id) {
            exitError("browser session '\(id)' not registered", code: "NOT_FOUND")
        } catch AnchorResolveError.headless {
            exitError("headless browser sessions cannot be anchored", code: "BROWSER_HEADLESS")
        } catch AnchorResolveError.notLocal(let msg) {
            exitError(msg, code: "BROWSER_NOT_LOCAL")
        } catch AnchorResolveError.evalFailed(let msg) {
            exitError(msg, code: "ANCHOR_EVAL_FAILED")
        } catch BrowserTargetError.invalid(let msg) {
            exitError(msg, code: "INVALID_TARGET")
        } catch BrowserTargetError.missingSession {
            exitError("PLAYWRIGHT_CLI_SESSION not set", code: "MISSING_SESSION")
        } catch {
            exitError("\(error)", code: "INTERNAL")
        }
    }

    if let ttlStr = options.ttlValue {
        request.ttl = parseDuration(ttlStr)
    }

    let exclusiveFlags: [(String, Bool)] = [
        ("--at", options.at != nil),
        ("--track", options.track != nil),
        ("--surface", options.surface != nil),
        ("--anchor-window", options.anchorWindow != nil),
        ("--anchor-channel", options.anchorChannel != nil),
    ]
    let activeExclusiveFlags = exclusiveFlags.filter { $0.1 }.map { $0.0 }
    if activeExclusiveFlags.count > 1 {
        exitError("cannot combine \(activeExclusiveFlags.joined(separator: ", ")) (pick one)", code: "INVALID_ARG")
    }

    if let atStr = options.at {
        let invalidMessage = kind == .create
            ? "--at must be x,y,w,h (comma-separated)"
            : "--at must be x,y,w,h"
        request.at = parseCanvasQuad(atStr, invalidMessage: invalidMessage)
    }

    if let aw = options.anchorWindow { request.anchorWindow = aw }
    if let ac = options.anchorChannel { request.anchorChannel = ac }

    if let offStr = options.offset {
        let invalidMessage = kind == .create
            ? "--offset must be x,y,w,h (comma-separated)"
            : "--offset must be x,y,w,h"
        request.offset = parseCanvasQuad(offStr, invalidMessage: invalidMessage)
    }

    if let scope = options.scope { request.scope = scope }
    if let autoProject = options.autoProject { request.autoProject = autoProject }
    if let track = options.track { request.track = track }
    if let surface = options.surface { request.surface = surface }
    if let windowLevel = options.windowLevel { request.windowLevel = windowLevel }

    if let url = options.urlValue {
        request.url = url
    } else {
        switch kind {
        case .create:
            if options.autoProject == nil {
                request.html = resolveHTML(htmlValue: options.htmlValue, fileValue: options.fileValue)
            }
        case .update:
            if options.htmlValue != nil || options.fileValue != nil {
                request.html = resolveHTML(htmlValue: options.htmlValue, fileValue: options.fileValue)
            }
        }
    }
}

// MARK: - CLI Command: create

func createCommand(args: [String]) {
    let options = parseCanvasMutationOptions(args, kind: .create)
    guard let canvasID = options.id else { exitError("create requires --id <name>", code: "MISSING_ARG") }

    var request = CanvasRequest(action: "create")
    request.id = canvasID
    request.interactive = options.interactive ?? false
    if options.focus == true { request.focus = true }
    applyCanvasMutationOptions(options, to: &request, kind: .create)

    let client = DaemonClient()
    if !client.ensureDaemon() {
        exitError("Failed to start aos daemon", code: "DAEMON_START_FAILED")
    }
    let response = client.send(request)
    outputResponse(response)
}

// MARK: - CLI Command: update

func updateCommand(args: [String]) {
    let options = parseCanvasMutationOptions(args, kind: .update)
    guard let canvasID = options.id else { exitError("update requires --id <name>", code: "MISSING_ARG") }

    var request = CanvasRequest(action: "update")
    request.id = canvasID
    request.interactive = options.interactive
    request.focus = options.focus
    applyCanvasMutationOptions(options, to: &request, kind: .update)

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

// MARK: - CLI Command: wait

func showWaitCommand(args: [String]) {
    var id: String? = nil
    var manifest: String? = nil
    var jsCondition: String? = nil
    var autoStart = false
    var asJSON = false
    var timeoutMs = 5000

    var i = 0
    while i < args.count {
        switch args[i] {
        case "--id":
            i += 1; guard i < args.count else { exitError("--id requires a value", code: "MISSING_ARG") }
            id = args[i]
        case "--manifest":
            i += 1; guard i < args.count else { exitError("--manifest requires a value", code: "MISSING_ARG") }
            manifest = args[i]
        case "--js":
            i += 1; guard i < args.count else { exitError("--js requires a value", code: "MISSING_ARG") }
            jsCondition = args[i]
        case "--timeout":
            i += 1; guard i < args.count else { exitError("--timeout requires a duration", code: "MISSING_ARG") }
            timeoutMs = parseTimeoutMsArg(args[i], flagName: "--timeout")
        case "--auto-start":
            autoStart = true
        case "--json":
            asJSON = true
        default:
            exitError("Unknown argument: \(args[i])", code: "UNKNOWN_ARG")
        }
        i += 1
    }

    guard let canvasID = id else { exitError("wait requires --id <name>", code: "MISSING_ARG") }

    let session = DaemonSession()
    let connected = autoStart
        ? session.connectWithAutoStart(binaryPath: ProcessInfo.processInfo.arguments[0])
        : session.connect()
    guard connected else {
        exitError("Cannot connect to daemon", code: autoStart ? "CONNECT_ERROR" : "NO_DAEMON")
    }
    defer { session.disconnect() }

    var condition = "window.headsup && typeof window.headsup.receive === 'function'"
    if let manifest {
        condition += " && window.headsup.manifest && window.headsup.manifest.name === \(jsStringLiteral(manifest))"
    }
    if let jsCondition {
        condition += " && (\(jsCondition))"
    }

    guard waitForCanvasCondition(session: session, canvasID: canvasID, jsCondition: condition, timeoutMs: timeoutMs) else {
        exitError("Canvas \(canvasID) did not become ready before timeout", code: "CANVAS_WAIT_TIMEOUT")
    }

    if asJSON {
        let payload: [String: Any] = [
            "status": "success",
            "ready": true,
            "id": canvasID
        ]
        if let data = try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys]),
           let str = String(data: data, encoding: .utf8) {
            print(str)
        }
    } else {
        print("ready")
    }
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
    var id: String? = nil
    var event: String? = nil
    var channel: String? = nil
    var data: String? = nil
    var i = 0
    while i < args.count {
        switch args[i] {
        case "--id":
            i += 1; guard i < args.count else { exitError("--id requires a value", code: "MISSING_ARG") }
            id = args[i]
        case "--event":
            i += 1; guard i < args.count else { exitError("--event requires a JSON value", code: "MISSING_ARG") }
            event = args[i]
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

    if event != nil && id == nil {
        exitError("post requires --id <name> when using --event", code: "MISSING_ARG")
    }
    if id != nil && event == nil {
        exitError("post requires --event <json> when targeting a canvas", code: "MISSING_ARG")
    }
    if id == nil && channel == nil {
        exitError("post requires --id <name> --event <json>", code: "MISSING_ARG")
    }
    if id != nil && channel != nil {
        exitError("post accepts either canvas delivery (--id/--event) or legacy channel relay (--channel/--data), not both", code: "INVALID_ARG")
    }

    var request = CanvasRequest(action: "post")
    if let id {
        request.id = id
        request.data = event
    } else {
        request.channel = channel
        request.data = data
    }

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
