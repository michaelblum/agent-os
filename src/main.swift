// main.swift — AOS unified binary entry point

import Foundation
import AppKit

@main
struct AOS {
    static func main() {
        let args = Array(CommandLine.arguments.dropFirst())

        guard let command = args.first else {
            commandRegistry = buildCommandRegistry()
            printFullRegistryText()
            exit(0)
        }

        // Initialize command registry
        commandRegistry = buildCommandRegistry()

        switch command {
        case "see":
            handleSee(args: Array(args.dropFirst()))
        case "show":
            handleShow(args: Array(args.dropFirst()))
        case "ops":
            opsCommand(args: Array(args.dropFirst()))
        case "do":
            handleDo(args: Array(args.dropFirst()))
        case "say":
            handleSay(args: Array(args.dropFirst()))
        case "tell":
            handleTell(args: Array(args.dropFirst()))
        case "listen":
            handleListen(args: Array(args.dropFirst()))
        case "voice":
            voiceCommand(args: Array(args.dropFirst()))
        case "config":
            configCommand(args: Array(args.dropFirst()))
        case "set":
            handleSet(args: Array(args.dropFirst()))
        case "serve":
            handleServe(args: Array(args.dropFirst()))
        case "content":
            let contentArgs = Array(args.dropFirst())
            if contentArgs.contains("--help") || contentArgs.contains("-h") {
                printCommandHelp(["content"], json: contentArgs.contains("--json"))
                exit(0)
            }
            guard contentArgs.count > 0 else {
                printCommandHelp(["content"], json: false)
                exit(0)
            }
            switch contentArgs[0] {
            case "status":
                runContentStatus(Array(contentArgs.dropFirst()))
            case "wait":
                runContentWait(Array(contentArgs.dropFirst()))
            default:
                exitError("Unknown content command: \(contentArgs[0])", code: "UNKNOWN_COMMAND")
            }
        case "service":
            serviceCommand(args: Array(args.dropFirst()))
        case "runtime":
            runtimeCommand(args: Array(args.dropFirst()))
        case "status":
            statusCommand(args: Array(args.dropFirst()))
        case "ready":
            readyCommand(args: Array(args.dropFirst()))
        case "doctor":
            doctorCommand(args: Array(args.dropFirst()))
        case "reset":
            resetCommand(args: Array(args.dropFirst()))
        case "clean":
            cleanCommand(args: Array(args.dropFirst()))
        case "permissions":
            permissionsCommand(args: Array(args.dropFirst()))
        case "focus":
            let focusArgs = Array(args.dropFirst())
            if focusArgs.contains("--help") || focusArgs.contains("-h") {
                printCommandHelp(["focus"], json: focusArgs.contains("--json"))
                exit(0)
            }
            guard focusArgs.count >= 1 else {
                printCommandHelp(["focus"], json: false)
                exit(0)
            }
            switch focusArgs[0] {
            case "create":  focusCreateCommand(args: Array(focusArgs.dropFirst()))
            case "update":  focusUpdateCommand(args: Array(focusArgs.dropFirst()))
            case "list":    focusListCommand()
            case "remove":  focusRemoveCommand(args: Array(focusArgs.dropFirst()))
            default: exitError("Unknown focus subcommand: \(focusArgs[0])", code: "UNKNOWN_COMMAND")
            }
        case "graph":
            let graphArgs = Array(args.dropFirst())
            if graphArgs.contains("--help") || graphArgs.contains("-h") {
                printCommandHelp(["graph"], json: graphArgs.contains("--json"))
                exit(0)
            }
            guard graphArgs.count >= 1 else {
                printCommandHelp(["graph"], json: false)
                exit(0)
            }
            switch graphArgs[0] {
            case "displays":  graphDisplaysCommand()
            case "windows":   graphWindowsCommand(args: Array(graphArgs.dropFirst()))
            case "deepen":    graphDeepenCommand(args: Array(graphArgs.dropFirst()))
            case "collapse":  graphCollapseCommand(args: Array(graphArgs.dropFirst()))
            default: exitError("Unknown graph subcommand: \(graphArgs[0])", code: "UNKNOWN_COMMAND")
            }
        case "daemon-snapshot":
            let dsArgs = Array(args.dropFirst())
            if dsArgs.contains("--help") || dsArgs.contains("-h") {
                printCommandHelp(["daemon-snapshot"], json: dsArgs.contains("--json"))
                exit(0)
            }
            daemonSnapshotCommand()
        case "inspect":
            inspectCommand(args: Array(args.dropFirst()))
        case "log":
            logCommand(args: Array(args.dropFirst()))
        case "introspect":
            introspectCommand(args: Array(args.dropFirst()))
        case "wiki":
            wikiCommand(args: Array(args.dropFirst()))
        case "browser":
            handleBrowserInternal(args: Array(args.dropFirst()))
        case "--help", "-h", "help":
            helpCommand(args: Array(args.dropFirst()))
        default:
            exitError("Unknown command: \(command). Run '\(aosInvocationDisplayName()) --help' for usage.", code: "UNKNOWN_COMMAND")
        }
    }
}

// Browser targets (`browser:<session>[/<ref>]`) route through @playwright/cli
// and do not touch macOS Accessibility or Screen Recording APIs. Skip the
// interactive preflight for see/do verbs when the first positional arg is a
// browser target — the adapter does its own version/availability gating.
private func hasBrowserTarget(_ args: [String]) -> Bool {
    return args.first(where: { !$0.hasPrefix("--") })?.hasPrefix("browser:") == true
}

func handleDo(args: [String]) {
    guard let sub = args.first else {
        printCommandHelp(["do"], json: false)
        exit(0)
    }

    let subArgs = Array(args.dropFirst())

    switch sub {
    case "--help", "-h":
        printCommandHelp(["do"], json: args.contains("--json"))
        exit(0)
    default:
        if subArgs.contains("--help") || subArgs.contains("-h") {
            printCommandHelp(["do", sub], json: subArgs.contains("--json"))
            exit(0)
        }
    }

    switch sub {
    case "click":
        if !hasBrowserTarget(subArgs) { ensureInteractivePreflight(command: "aos do click", requiresInputTap: true) }
        cliClick(args: subArgs)
    case "hover":
        if !hasBrowserTarget(subArgs) { ensureInteractivePreflight(command: "aos do hover", requiresInputTap: true) }
        cliHover(args: subArgs)
    case "drag":
        if !hasBrowserTarget(subArgs) { ensureInteractivePreflight(command: "aos do drag", requiresInputTap: true) }
        cliDrag(args: subArgs)
    case "fill":
        // Browser-only in v1: cliFill errors with BROWSER_ONLY on non-browser
        // targets, so no interactive preflight is needed.
        cliFill(args: subArgs)
    case "scroll":
        if !hasBrowserTarget(subArgs) { ensureInteractivePreflight(command: "aos do scroll", requiresInputTap: true) }
        cliScroll(args: subArgs)
    case "type":
        if !hasBrowserTarget(subArgs) { ensureInteractivePreflight(command: "aos do type", requiresInputTap: true) }
        cliType(args: subArgs)
    case "key":
        if !hasBrowserTarget(subArgs) { ensureInteractivePreflight(command: "aos do key", requiresInputTap: true) }
        cliKey(args: subArgs)
    case "navigate":
        // Browser-only in v1 — no macOS preflight. cliNavigate owns the
        // BROWSER_ONLY rejection for non-browser targets.
        cliNavigate(args: subArgs)
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
    case "profiles":
        if let name = subArgs.first, name != "list" {
            profilesShowCommand(name: name)
        } else {
            profilesListCommand()
        }
    default:
        exitError("Unknown do subcommand: \(sub)", code: "UNKNOWN_SUBCOMMAND")
    }
}

func handleSee(args: [String]) {
    guard let sub = args.first else {
        printCommandHelp(["see"], json: false)
        exit(0)
    }
    switch sub {
    case "--help", "-h":
        printCommandHelp(["see"], json: args.contains("--json"))
        exit(0)
    case "cursor":
        ensureInteractivePreflight(command: "aos see cursor")
        cursorCommand()
    case "observe":
        ensureInteractivePreflight(command: "aos see observe")
        observeCommand(args: Array(args.dropFirst()))
    case "capture":
        let subArgs = Array(args.dropFirst())
        if subArgs.contains("--help") || subArgs.contains("-h") {
            printCommandHelp(["see"], json: subArgs.contains("--json"))
            exit(0)
        }
        if !hasBrowserTarget(subArgs) { ensureInteractivePreflight(command: "aos see capture") }
        runCaptureAsync(args: subArgs)
    case "list":
        ensureInteractivePreflight(command: "aos see list")
        seeListCommand()
    case "selection":
        ensureInteractivePreflight(command: "aos see selection")
        selectionCommand()
    case "zone":
        let subArgs = Array(args.dropFirst())
        if subArgs.contains("--help") || subArgs.contains("-h") {
            printCommandHelp(["see", "zone"], json: subArgs.contains("--json"))
            exit(0)
        }
        zoneCommand(args: subArgs)
    default:
        ensureInteractivePreflight(command: "aos see \(sub)")
        runCaptureAsync(args: args)
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

func handleShow(args: [String]) {
    _ = NSApplication.shared

    guard let sub = args.first else {
        printCommandHelp(["show"], json: false)
        exit(0)
    }

    let subArgs = Array(args.dropFirst())

    switch sub {
    case "--help", "-h":
        printCommandHelp(["show"], json: args.contains("--json"))
        exit(0)
    default:
        if subArgs.contains("--help") || subArgs.contains("-h") {
            printCommandHelp(["show", sub], json: subArgs.contains("--json"))
            exit(0)
        }
    }

    switch sub {
    case "render":   renderCommand(args: subArgs)
    case "create":   createCommand(args: subArgs)
    case "update":   updateCommand(args: subArgs)
    case "remove":   removeCommand(args: subArgs)
    case "remove-all": removeAllCommand(args: subArgs)
    case "list":     listCommand(args: subArgs)
    case "eval":     evalCommand(args: subArgs)
    case "listen":   listenCommand(args: subArgs)
    case "ping":     pingCommand(args: subArgs)
    case "wait":     showWaitCommand(args: subArgs)
    case "exists":   showExistsCommand(args: subArgs)
    case "get":      showGetCommand(args: subArgs)
    case "to-front": toFrontCommand(args: subArgs)
    case "post":     postCommand(args: subArgs)
    default:
        exitError("Unknown show subcommand: \(sub)", code: "UNKNOWN_SUBCOMMAND")
    }
}

func handleSay(args: [String]) {
    if args.contains("--help") || args.contains("-h") {
        printCommandHelp(["say"], json: args.contains("--json"))
        exit(0)
    }
    sayCommand(args: args)
}

func handleSet(args: [String]) {
    if args.contains("--help") || args.contains("-h") {
        printCommandHelp(["set"], json: args.contains("--json"))
        exit(0)
    }
    setCommand(args: args)
}

func handleServe(args: [String]) {
    if args.contains("--help") || args.contains("-h") {
        printCommandHelp(["serve"], json: args.contains("--json"))
        exit(0)
    }
    serveCommand(args: args)
}

func handleTell(args: [String]) {
    if args.contains("--help") || args.contains("-h") {
        printCommandHelp(["tell"], json: args.contains("--json"))
        exit(0)
    }
    tellCommand(args: args)
}

func handleListen(args: [String]) {
    if args.contains("--help") || args.contains("-h") {
        printCommandHelp(["listen"], json: args.contains("--json"))
        exit(0)
    }
    listenCommand_coord(args: args)
}
