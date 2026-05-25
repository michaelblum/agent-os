// dev.swift - repo development workflow fallback.

import Foundation

func devCommand(args: [String]) {
    guard let sub = args.first else {
        printCommandHelp(["dev"], json: false)
        exit(0)
    }

    if sub == "--help" || sub == "-h" {
        printCommandHelp(["dev"], json: args.contains("--json"))
        exit(0)
    }

    let subArgs = Array(args.dropFirst())
    if subArgs.contains("--help") || subArgs.contains("-h") {
        printCommandHelp(["dev", sub], json: subArgs.contains("--json"))
        exit(0)
    }

    exitError("Unknown dev subcommand: \(sub)", code: "UNKNOWN_SUBCOMMAND")
}
