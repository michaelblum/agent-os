// config.swift — aos config: discoverable config dump surface

import Foundation

func configCommand(args: [String]) {
    if args.contains("--help") || args.contains("-h") {
        if let subcommand = args.first(where: { !$0.hasPrefix("-") }) {
            printCommandHelp(["config", subcommand], json: args.contains("--json"))
        } else {
            printCommandHelp(["config"], json: args.contains("--json"))
        }
        exit(0)
    }

    guard let subcommand = args.first else {
        print(jsonString(loadConfig()))
        return
    }

    switch subcommand {
    default:
        exitError("Unknown config subcommand: \(subcommand)", code: "UNKNOWN_COMMAND")
    }
}
