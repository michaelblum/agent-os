// listen.swift — aos listen: inbound communication command
//
// Usage:
//   aos listen <channel>                Read recent messages from channel
//   aos listen <channel> --follow       Stream messages in real-time
//   aos listen --channels               List known channels
//
// Messages are output as newline-delimited JSON.

import Foundation

func listenCommand_coord(args: [String]) {
    // List channels subcommand
    if args.contains("--channels") {
        listenChannels()
        return
    }

    guard let channel = args.first, !channel.hasPrefix("--") else {
        exitError("listen requires a channel. Usage: aos listen <channel> [--follow|--since|--limit]",
                  code: "MISSING_ARG")
    }

    let follow = args.contains("--follow") || args.contains("-f")
    let since = listenGetArg(args, "--since")
    let limit = listenGetArg(args, "--limit").flatMap(Int.init) ?? 50

    if follow {
        listenFollow(channel: channel, since: since)
    } else {
        listenRead(channel: channel, since: since, limit: limit)
    }
}

// MARK: - One-shot read

private func listenRead(channel: String, since: String?, limit: Int) {
    var request: [String: Any] = [
        "action": "coord-read",
        "channel": channel,
        "limit": limit
    ]
    if let s = since { request["since"] = s }

    guard let response = daemonOneShot(request, autoStartBinary: CommandLine.arguments[0]) else {
        exitError("Cannot connect to daemon", code: "DAEMON_UNREACHABLE")
    }
    if let data = try? JSONSerialization.data(withJSONObject: response, options: [.sortedKeys]),
       let s = String(data: data, encoding: .utf8) {
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
        var readReq: [String: Any] = ["action": "coord-read", "channel": channel, "limit": 100]
        if let s = since { readReq["since"] = s }
        session.sendOnly(readReq)
        if let response = session.readOneJSON(timeoutMs: 2000),
           let msgs = response["messages"] as? [[String: Any]] {
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
    let request: [String: Any] = ["action": "coord-channels"]
    guard let response = daemonOneShot(request, autoStartBinary: CommandLine.arguments[0]) else {
        exitError("Cannot connect to daemon", code: "DAEMON_UNREACHABLE")
    }
    if let data = try? JSONSerialization.data(withJSONObject: response, options: [.sortedKeys]),
       let s = String(data: data, encoding: .utf8) {
        print(s)
    }
}

private func listenGetArg(_ args: [String], _ key: String) -> String? {
    guard let idx = args.firstIndex(of: key), idx + 1 < args.count else { return nil }
    return args[idx + 1]
}
