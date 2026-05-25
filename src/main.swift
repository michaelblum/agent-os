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

        if runExternalCommandIfMatched(args: args) {
            exit(0)
        }

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
            let tellArgs = Array(args.dropFirst())
            if tellArgs.contains("--help") || tellArgs.contains("-h") {
                printCommandHelp(["tell"], json: tellArgs.contains("--json"))
                exit(0)
            }
            exitError("Unknown tell invocation", code: "UNKNOWN_COMMAND")
        case "listen":
            let listenArgs = Array(args.dropFirst())
            if listenArgs.contains("--help") || listenArgs.contains("-h") {
                printCommandHelp(["listen"], json: listenArgs.contains("--json"))
                exit(0)
            }
            exitError("Unknown listen invocation", code: "UNKNOWN_COMMAND")
        case "gate":
            let gateArgs = Array(args.dropFirst())
            if gateArgs.isEmpty || gateArgs.contains("--help") || gateArgs.contains("-h") {
                printCommandHelp(["gate"], json: gateArgs.contains("--json"))
                exit(0)
            }
            exitError("Unknown gate subcommand: \(gateArgs[0])", code: "UNKNOWN_SUBCOMMAND")
        case "voice":
            voiceCommand(args: Array(args.dropFirst()))
        case "config":
            let configArgs = Array(args.dropFirst())
            if configArgs.contains("--help") || configArgs.contains("-h") {
                if let subcommand = configArgs.first(where: { !$0.hasPrefix("-") }) {
                    printCommandHelp(["config", subcommand], json: configArgs.contains("--json"))
                } else {
                    printCommandHelp(["config"], json: configArgs.contains("--json"))
                }
                exit(0)
            }
            exitError("Unknown config invocation", code: "UNKNOWN_COMMAND")
        case "set":
            let setArgs = Array(args.dropFirst())
            if setArgs.contains("--help") || setArgs.contains("-h") {
                printCommandHelp(["set"], json: setArgs.contains("--json"))
                exit(0)
            }
            exitError("Unknown set invocation", code: "UNKNOWN_COMMAND")
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
            exitError("Unknown content command: \(contentArgs[0])", code: "UNKNOWN_COMMAND")
        case "service":
            serviceCommand(args: Array(args.dropFirst()))
        case "runtime":
            runtimeCommand(args: Array(args.dropFirst()))
        case "dev":
            devCommand(args: Array(args.dropFirst()))
        case "status":
            statusCommand(args: Array(args.dropFirst()))
        case "ready":
            readyCommand(args: Array(args.dropFirst()))
        case "doctor":
            doctorCommand(args: Array(args.dropFirst()))
        case "reset":
            let resetArgs = Array(args.dropFirst())
            if resetArgs.contains("--help") || resetArgs.contains("-h") {
                printCommandHelp(["reset"], json: resetArgs.contains("--json"))
                exit(0)
            }
            exitError("Unknown reset invocation", code: "UNKNOWN_COMMAND")
        case "permissions":
            permissionsCommand(args: Array(args.dropFirst()))
        case "focus":
            let focusArgs = Array(args.dropFirst())
            if focusArgs.contains("--help") || focusArgs.contains("-h") {
                printCommandHelp(["focus"], json: focusArgs.contains("--json"))
                exit(0)
            }
            exitError("Unknown focus invocation", code: "UNKNOWN_COMMAND")
        case "graph":
            let graphArgs = Array(args.dropFirst())
            if graphArgs.contains("--help") || graphArgs.contains("-h") {
                printCommandHelp(["graph"], json: graphArgs.contains("--json"))
                exit(0)
            }
            exitError("Unknown graph invocation", code: "UNKNOWN_COMMAND")
        case "daemon-snapshot":
            let dsArgs = Array(args.dropFirst())
            if dsArgs.contains("--help") || dsArgs.contains("-h") {
                printCommandHelp(["daemon-snapshot"], json: dsArgs.contains("--json"))
                exit(0)
            }
            exitError("Unknown daemon-snapshot invocation", code: "UNKNOWN_COMMAND")
        case "inspect":
            inspectCommand(args: Array(args.dropFirst()))
        case "log":
            logCommand(args: Array(args.dropFirst()))
        case "introspect":
            let introspectArgs = Array(args.dropFirst())
            if introspectArgs.isEmpty || introspectArgs.contains("--help") || introspectArgs.contains("-h") {
                printCommandHelp(["introspect"], json: introspectArgs.contains("--json"))
                exit(0)
            }
            exitError("Unknown introspect subcommand: \(introspectArgs[0])", code: "UNKNOWN_SUBCOMMAND")
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

func handleServe(args: [String]) {
    if args.contains("--help") || args.contains("-h") {
        printCommandHelp(["serve"], json: args.contains("--json"))
        exit(0)
    }
    serveCommand(args: args)
}
