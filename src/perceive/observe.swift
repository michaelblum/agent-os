// observe.swift — aos see observe: subscribe to perception stream from daemon

import Foundation

/// aos see observe [--depth N] [--rate on-settle|on-change|continuous]
func observeCommand(args: [String]) {
    var depth = 2
    var rate = "on-settle"

    // Parse args
    var i = 0
    while i < args.count {
        switch args[i] {
        case "--depth":
            i += 1
            guard i < args.count, let d = Int(args[i]), (0...3).contains(d) else {
                exitError("--depth requires 0-3", code: "INVALID_ARG")
            }
            depth = d
        case "--rate":
            i += 1
            guard i < args.count, ["continuous", "on-change", "on-settle"].contains(args[i]) else {
                exitError("--rate requires: continuous, on-change, on-settle", code: "INVALID_ARG")
            }
            rate = args[i]
        default:
            exitError("Unknown option: \(args[i])", code: "INVALID_ARG")
        }
        i += 1
    }

    // Connect to daemon
    let session = DaemonSession()
    guard session.connectWithAutoStart(binaryPath: CommandLine.arguments[0]) else {
        exitError("Cannot connect to daemon at \(kDefaultSocketPath). Is 'aos serve' running?", code: "CONNECT_ERROR")
    }

    // Send v1 envelope see.observe request
    var data: [String: Any] = [:]
    data["depth"] = depth
    data["scope"] = "cursor"
    data["rate"] = rate
    let envelope: [String: Any] = ["v": 1, "service": "see", "action": "observe", "data": data]
    session.sendOnly(envelope)
    // Read and discard the subscription ack (channel_id response)
    _ = session.readOneJSON(timeoutMs: 3000)

    // Read and print events until interrupted
    var buffer = Data()
    var chunk = [UInt8](repeating: 0, count: 4096)

    // Disable stdout buffering for real-time output
    setbuf(stdout, nil)

    while true {
        let bytesRead = read(session.fd, &chunk, chunk.count)
        guard bytesRead > 0 else {
            fputs("Daemon connection closed.\n", stderr)
            break
        }
        buffer.append(contentsOf: chunk[0..<bytesRead])

        while let newlineIndex = buffer.firstIndex(of: UInt8(ascii: "\n")) {
            let lineData = Data(buffer[buffer.startIndex..<newlineIndex])
            buffer = Data(buffer[(buffer.index(after: newlineIndex))...])

            if let line = String(data: lineData, encoding: .utf8) {
                print(line)
            }
        }
    }

    session.disconnect()
}
