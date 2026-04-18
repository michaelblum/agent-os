// content/client.swift — CLI client for content server status

import Foundation

func runContentStatus(_ args: [String]) {
    guard let raw = sendEnvelopeRequest(service: "content", action: "status", data: [:]) else {
        exitError("Cannot connect to daemon — is 'aos serve' running?", code: "NO_DAEMON")
    }
    let response = (raw["data"] as? [String: Any]) ?? raw

    if args.contains("--json") {
        if let data = try? JSONSerialization.data(withJSONObject: response, options: [.prettyPrinted, .sortedKeys]),
           let str = String(data: data, encoding: .utf8) {
            print(str)
        }
    } else {
        let port = response["port"] as? Int ?? 0
        let roots = response["roots"] as? [String: String] ?? [:]
        if port > 0 {
            print("Content server: http://127.0.0.1:\(port)/")
            for (prefix, dir) in roots.sorted(by: { $0.key < $1.key }) {
                print("  /\(prefix)/ → \(dir)")
            }
        } else {
            print("Content server: not running (no roots configured)")
        }
    }
}

func runContentWait(_ args: [String]) {
    var requiredRoots: [String] = []
    var timeoutMs = 10000
    var autoStart = false
    var asJSON = false

    var i = 0
    while i < args.count {
        switch args[i] {
        case "--root":
            i += 1
            guard i < args.count else { exitError("--root requires a value", code: "MISSING_ARG") }
            requiredRoots.append(args[i])
        case "--timeout":
            i += 1
            guard i < args.count else { exitError("--timeout requires a duration", code: "MISSING_ARG") }
            let seconds = parseDuration(args[i])
            guard seconds.isFinite, seconds > 0 else {
                exitError("--timeout must be a positive finite duration", code: "INVALID_ARG")
            }
            timeoutMs = Int(seconds * 1000)
        case "--auto-start":
            autoStart = true
        case "--json":
            asJSON = true
        default:
            exitError("Unknown argument: \(args[i])", code: "UNKNOWN_ARG")
        }
        i += 1
    }

    let session = DaemonSession()
    let connected = autoStart
        ? session.connectWithAutoStart(binaryPath: CommandLine.arguments[0])
        : session.connect()
    guard connected else {
        exitError("Cannot connect to daemon — is 'aos serve' running?", code: autoStart ? "CONNECT_ERROR" : "NO_DAEMON")
    }
    defer { session.disconnect() }

    guard var response = waitForContentStatus(session: session, requiredRoots: requiredRoots, timeoutMs: timeoutMs) else {
        let rootsText = requiredRoots.isEmpty ? "content server" : "content roots \(requiredRoots.joined(separator: ", "))"
        exitError("\(rootsText) did not become ready before timeout", code: "CONTENT_WAIT_TIMEOUT")
    }
    response["status"] = "success"
    response["ready"] = true

    if asJSON {
        if let data = try? JSONSerialization.data(withJSONObject: response, options: [.prettyPrinted, .sortedKeys]),
           let str = String(data: data, encoding: .utf8) {
            print(str)
        }
    } else {
        let port = response["port"] as? Int ?? 0
        let url = "http://127.0.0.1:\(port)/"
        if requiredRoots.isEmpty {
            print("ready \(url)")
        } else {
            print("ready \(url) roots=\(requiredRoots.joined(separator: ","))")
        }
    }
}
