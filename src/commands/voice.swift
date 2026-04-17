import Foundation

func voiceCommand(args: [String]) {
    if args.contains("--help") || args.contains("-h") {
        if let subcommand = args.first, !subcommand.hasPrefix("--") {
            printCommandHelp(["voice", subcommand], json: args.contains("--json"))
            exit(0)
        }
        printCommandHelp(["voice"], json: args.contains("--json"))
        exit(0)
    }

    guard let subcommand = args.first else {
        printCommandHelp(["voice"], json: false)
        exit(0)
    }

    let request: [String: Any]
    switch subcommand {
    case "list":
        request = ["action": "voice-list"]
    case "leases":
        request = ["action": "voice-leases"]
    default:
        exitError("Unknown voice command: \(subcommand)", code: "UNKNOWN_COMMAND")
    }

    guard let response = daemonOneShot(request, autoStartBinary: CommandLine.arguments[0]) else {
        exitError("Cannot connect to daemon", code: "DAEMON_UNREACHABLE")
    }

    if let data = try? JSONSerialization.data(withJSONObject: response, options: [.sortedKeys]),
       let s = String(data: data, encoding: .utf8) {
        print(s)
    }
}
