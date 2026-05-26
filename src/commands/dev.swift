// dev.swift - repo development workflow fallback.

import Foundation

func devCommand(args: [String]) {
    guard let sub = args.first else {
        printCommandHelp(["dev"], json: false)
        exit(0)
    }

    exitError("Unknown dev subcommand: \(sub)", code: "UNKNOWN_SUBCOMMAND")
}
