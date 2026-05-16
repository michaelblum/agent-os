import Foundation

func gateCommand(args: [String]) {
    if args.contains("--help") || args.contains("-h") || args.isEmpty {
        printCommandHelp(["gate"], json: args.contains("--json"))
        exit(0)
    }

    let subcommand = args[0]
    let subArgs = Array(args.dropFirst())
    switch subcommand {
    case "ask":
        runGateAsk(args: subArgs)
    case "records":
        runGateRecords(args: subArgs)
    default:
        exitError("Unknown gate subcommand: \(subcommand)", code: "UNKNOWN_SUBCOMMAND")
    }
}

private func runGateAsk(args: [String]) {
    runGateVerb(name: "ask", path: "packages/cli/verbs/gate-ask.js", args: args)
}

private func runGateRecords(args: [String]) {
    runGateVerb(name: "records", path: "packages/cli/verbs/gate-records.js", args: args)
}

private func runGateVerb(name: String, path: String, args: [String]) {
    let verb = aosRepoPath(path)
    guard FileManager.default.fileExists(atPath: verb) else {
        exitError("gate \(name) verb not found at \(verb)", code: "GATE_VERB_MISSING")
    }

    let task = Process()
    task.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    task.arguments = ["node", verb] + args
    task.standardInput = FileHandle.standardInput
    task.standardOutput = FileHandle.standardOutput
    task.standardError = FileHandle.standardError

    do {
        try task.run()
    } catch {
        exitError("failed to spawn gate \(name) verb: \(error.localizedDescription)", code: "SPAWN_FAILED")
    }
    task.waitUntilExit()
    exit(task.terminationStatus)
}
