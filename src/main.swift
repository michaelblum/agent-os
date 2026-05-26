// main.swift — AOS unified binary entry point

import Foundation
import AppKit

@main
struct AOS {
    static func main() {
        let args = Array(CommandLine.arguments.dropFirst())

        guard let command = args.first else {
            if runExternalCommandIfMatched(args: ["help"]) {
                exit(0)
            }
            exitError("External help route is unavailable.", code: "COMMAND_ROUTE_UNAVAILABLE")
        }

        if let helpArgs = externalHelpArgs(args) {
            if runExternalCommandIfMatched(args: helpArgs) {
                exit(0)
            }
            exitError("External help route is unavailable.", code: "COMMAND_ROUTE_UNAVAILABLE")
        }

        if runExternalCommandIfMatched(args: args) {
            exit(0)
        }

        switch command {
        case "__serve":
            handleServe(args: Array(args.dropFirst()))
        case "__status":
            statusCommand(args: Array(args.dropFirst()))
        case "__ready":
            readyCommand(args: Array(args.dropFirst()))
        case "__doctor":
            doctorCommand(args: Array(args.dropFirst()))
        case "__permissions":
            permissionsCommand(args: Array(args.dropFirst()))
        case "__render":
            renderCommand(args: Array(args.dropFirst()))
        case "__see":
            handleSeePrimitive(args: Array(args.dropFirst()))
        case "__say":
            sayCommand(args: Array(args.dropFirst()))
        case "__do":
            handleDoPrimitive(args: Array(args.dropFirst()))
        default:
            exitError("Unknown command: \(command). Run '\(aosInvocationDisplayName()) --help' for usage.", code: "UNKNOWN_COMMAND")
        }
    }
}

private func externalHelpArgs(_ args: [String]) -> [String]? {
    guard args.contains("--help") || args.contains("-h") else {
        return nil
    }
    return ["help"] + args.filter { $0 != "--help" && $0 != "-h" }
}

// Browser capture targets (`browser:<session>[/<ref>]`) route through
// @playwright/cli and do not touch macOS Accessibility or Screen Recording APIs.
// Skip the interactive preflight when the first positional arg is a browser
// target; the adapter does its own version/availability gating.
private func hasBrowserTarget(_ args: [String]) -> Bool {
    return args.first(where: { !$0.hasPrefix("--") })?.hasPrefix("browser:") == true
}

private func handleDoPrimitive(args: [String]) {
    guard let sub = args.first else {
        exitError("__do requires a primitive", code: "MISSING_ARG")
    }

    let subArgs = Array(args.dropFirst())
    switch sub {
    case "click":
        ensureInteractivePreflight(command: "aos do click", requiresInputTap: true)
        cliClick(args: subArgs)
    case "hover":
        ensureInteractivePreflight(command: "aos do hover", requiresInputTap: true)
        cliHover(args: subArgs)
    case "drag":
        ensureInteractivePreflight(command: "aos do drag", requiresInputTap: true)
        cliDrag(args: subArgs)
    case "scroll":
        ensureInteractivePreflight(command: "aos do scroll", requiresInputTap: true)
        cliScroll(args: subArgs)
    case "type":
        ensureInteractivePreflight(command: "aos do type", requiresInputTap: true)
        cliType(args: subArgs)
    case "key":
        ensureInteractivePreflight(command: "aos do key", requiresInputTap: true)
        cliKey(args: subArgs)
    case "press":
        ensureInteractivePreflight(command: "aos do press", requiresInputTap: true)
        cliPress(args: subArgs)
    case "set-value":
        ensureInteractivePreflight(command: "aos do set-value", requiresInputTap: true)
        cliSetValue(args: subArgs)
    case "focus":
        ensureInteractivePreflight(command: "aos do focus", requiresInputTap: true)
        cliFocusElement(args: subArgs)
    case "raise":
        ensureInteractivePreflight(command: "aos do raise", requiresInputTap: true)
        cliRaise(args: subArgs)
    case "move":
        ensureInteractivePreflight(command: "aos do move", requiresInputTap: true)
        cliMove(args: subArgs)
    case "resize":
        ensureInteractivePreflight(command: "aos do resize", requiresInputTap: true)
        cliResize(args: subArgs)
    case "tell":
        ensureInteractivePreflight(command: "aos do tell", requiresInputTap: true)
        cliTell(args: subArgs)
    case "session":
        ensureInteractivePreflight(command: "aos do session", requiresInputTap: true)
        runSession(profileName: getArg(subArgs, "--profile") ?? "natural")
    default:
        exitError("Unknown __do primitive: \(sub)", code: "UNKNOWN_SUBCOMMAND")
    }
}

private func handleSeePrimitive(args: [String]) {
    guard let sub = args.first else {
        exitError("__see requires a primitive", code: "MISSING_ARG")
    }
    switch sub {
    case "capture":
        let subArgs = Array(args.dropFirst())
        if !hasBrowserTarget(subArgs) { ensureInteractivePreflight(command: "aos see capture") }
        runCaptureAsync(args: subArgs)
    case "cursor":
        ensureInteractivePreflight(command: "aos see cursor")
        cursorCommand()
    case "list":
        ensureInteractivePreflight(command: "aos see list")
        seeListCommand()
    case "selection":
        ensureInteractivePreflight(command: "aos see selection")
        selectionCommand()
    default:
        exitError("Unknown __see primitive: \(sub)", code: "UNKNOWN_SUBCOMMAND")
    }
}

/// Bridge from synchronous main thread to async captureCommand.
/// The main thread must stay free for AppKit (NSWindow, NSEvent monitors, RunLoop pumping).
/// Async work (ScreenCaptureKit) runs on a detached Task.
private func runCaptureAsync(args: [String]) {
    let done = DispatchSemaphore(value: 0)
    Task.detached {
        await captureCommand(args: args)
        done.signal()
    }
    // Keep main thread alive for AppKit work while async task runs
    while done.wait(timeout: .now()) == .timedOut {
        RunLoop.main.run(mode: .default, before: Date(timeIntervalSinceNow: 0.1))
    }
}

func handleServe(args: [String]) {
    serveCommand(args: args)
}
