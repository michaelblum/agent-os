// listen.swift — aos listen: inbound communication command
//
// Usage:
//   aos listen <channel>                      Read recent messages from channel
//   aos listen --session-id <id>             Read direct session messages
//   aos listen <channel> --follow            Stream messages in real-time
//   aos listen --session-id <id> --follow    Stream direct session messages
//   aos listen --channels                    List known channels
//
// Messages are output as newline-delimited JSON.

import Foundation

func listenCommand_coord(args: [String]) {
    // List channels subcommand
    if args.contains("--channels") {
        listenChannels()
        return
    }

    var channel: String? = nil
    var explicitSessionID: String? = nil
    var follow = false
    var since: String? = nil
    var limit = 50

    var i = 0
    while i < args.count {
        switch args[i] {
        case "--follow", "-f":
            follow = true
        case "--since":
            i += 1
            guard i < args.count else { exitError("--since requires a value", code: "MISSING_ARG") }
            since = args[i]
        case "--limit":
            i += 1
            guard i < args.count else { exitError("--limit requires a value", code: "MISSING_ARG") }
            guard let parsed = Int(args[i]) else { exitError("Invalid --limit: \(args[i])", code: "INVALID_ARG") }
            limit = parsed
        case "--session-id":
            i += 1
            guard i < args.count else { exitError("--session-id requires a value", code: "MISSING_ARG") }
            explicitSessionID = args[i]
        default:
            if !args[i].hasPrefix("--") && channel == nil {
                channel = args[i]
            }
        }
        i += 1
    }

    let resolvedChannel = explicitSessionID ?? channel
    guard let resolvedChannel, !resolvedChannel.isEmpty else {
        exitError("listen requires a channel. Usage: aos listen <channel>|--session-id <id> [--follow|--since|--limit]",
                  code: "MISSING_ARG")
    }

    if follow {
        listenFollow(channel: resolvedChannel, since: since)
    } else {
        listenRead(channel: resolvedChannel, since: since, limit: limit)
    }
}

// MARK: - One-shot read

private func listenRead(channel: String, since: String?, limit: Int) {
    var data: [String: Any] = ["channel": channel, "limit": limit]
    if let s = since { data["since"] = s }

    guard let response = sendEnvelopeRequest(service: "listen", action: "read", data: data, autoStartBinary: CommandLine.arguments[0]) else {
        exitError("Cannot connect to daemon", code: "DAEMON_UNREACHABLE")
    }
    if let responseData = try? JSONSerialization.data(withJSONObject: response, options: [.sortedKeys]),
       let s = String(data: responseData, encoding: .utf8) {
        if response["error"] != nil {
            FileHandle.standardError.write(s.data(using: .utf8)!)
            FileHandle.standardError.write("\n".data(using: .utf8)!)
            exit(1)
        } else {
            print(s)
        }
    }
}

// MARK: - Streaming follow

private func listenFollow(channel: String, since: String?) {
    let session = DaemonSession()
    guard session.connectWithAutoStart(binaryPath: CommandLine.arguments[0]) else {
        exitError("Cannot connect to daemon", code: "DAEMON_UNREACHABLE")
    }

    // Subscribe to events
    session.sendOnly(["action": "subscribe"])
    // Read and discard the subscribe response
    _ = session.readOneJSON(timeoutMs: 2000)

    // If since is set, first dump history
    if since != nil {
        var readData: [String: Any] = ["channel": channel, "limit": 100]
        if let s = since { readData["since"] = s }
        let readReq: [String: Any] = ["v": 1, "service": "listen", "action": "read", "data": readData]
        session.sendOnly(readReq)
        if let response = session.readOneJSON(timeoutMs: 2000) {
            let body = (response["data"] as? [String: Any]) ?? response
            let msgs = body["messages"] as? [[String: Any]] ?? []
            for msg in msgs {
                if let data = try? JSONSerialization.data(withJSONObject: msg, options: [.sortedKeys]),
                   let s = String(data: data, encoding: .utf8) {
                    print(s)
                    fflush(stdout)
                }
            }
        }
    }

    // Set up clean exit
    signal(SIGINT, SIG_IGN)
    signal(SIGTERM, SIG_IGN)
    let sigint = DispatchSource.makeSignalSource(signal: SIGINT, queue: .global())
    sigint.setEventHandler { session.disconnect(); exit(0) }
    sigint.resume()
    let sigterm = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .global())
    sigterm.setEventHandler { session.disconnect(); exit(0) }
    sigterm.resume()

    // Stream events, filter for our channel
    var buffer = Data()
    var chunk = [UInt8](repeating: 0, count: 4096)
    while true {
        let n = read(session.fd, &chunk, chunk.count)
        guard n > 0 else { break }
        buffer.append(contentsOf: chunk[0..<n])
        while let nl = buffer.firstIndex(of: UInt8(ascii: "\n")) {
            let line = Data(buffer[buffer.startIndex..<nl])
            buffer = Data(buffer[(buffer.index(after: nl))...])
            guard let json = try? JSONSerialization.jsonObject(with: line) as? [String: Any] else { continue }

            // Filter: only coordination/message events for our channel
            guard json["v"] as? Int == 1,
                  json["service"] as? String == "coordination",
                  json["event"] as? String == "message",
                  let data = json["data"] as? [String: Any],
                  data["channel"] as? String == channel else { continue }

            // Output the message data (not the envelope)
            if let outData = try? JSONSerialization.data(withJSONObject: data, options: [.sortedKeys]),
               let s = String(data: outData, encoding: .utf8) {
                print(s)
                fflush(stdout)
            }
        }
    }
    exit(0)
}

// MARK: - List channels

private func listenChannels() {
    guard let response = sendEnvelopeRequest(service: "listen", action: "channels", data: [:], autoStartBinary: CommandLine.arguments[0]) else {
        exitError("Cannot connect to daemon", code: "DAEMON_UNREACHABLE")
    }
    if let data = try? JSONSerialization.data(withJSONObject: response, options: [.sortedKeys]),
       let s = String(data: data, encoding: .utf8) {
        print(s)
    }
}
