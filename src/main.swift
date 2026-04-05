// main.swift — AOS unified binary entry point

import Foundation
import AppKit

@main
struct AOS {
    static func main() {
        let args = Array(CommandLine.arguments.dropFirst())

        guard let command = args.first else {
            printUsage()
            exit(0)
        }

        switch command {
        case "see":
            handleSee(args: Array(args.dropFirst()))
        case "show":
            handleShow(args: Array(args.dropFirst()))
        case "set":
            handleSet(args: Array(args.dropFirst()))
        case "serve":
            handleServe(args: Array(args.dropFirst()))
        case "--help", "-h", "help":
            printUsage()
        default:
            exitError("Unknown command: \(command). Run 'aos --help' for usage.", code: "UNKNOWN_COMMAND")
        }
    }
}

func printUsage() {
    let usage = """
    aos — agent operating system

    Usage: aos <command> [options]

    Commands:
      see <subcommand>     Perception — query what's on screen
      show <subcommand>    Display — manage overlays and render
      set <key> <value>    Configure autonomic settings
      serve                Start the unified daemon

    Perception (aos see):
      cursor               What's under the cursor (display, window, AX element)
      observe              Subscribe to perception stream (requires daemon)

    Display (aos show):
      create               Create a canvas overlay
      update               Update a canvas
      remove               Remove a canvas
      remove-all           Remove all canvases
      list                 List active canvases
      render               Render HTML to PNG (no daemon needed)
      eval                 Run JavaScript in a canvas
      listen               Subscribe to events + forward commands
      ping                 Check daemon status

    Configuration (aos set):
      voice.enabled <bool>              Enable/disable voice output
      perception.default_depth <0-3>    Default perception depth
      perception.settle_threshold_ms <ms>  Cursor settle threshold
      feedback.visual <bool>            Enable/disable visual feedback

    Examples:
      aos see cursor                    # What's under the cursor
      aos serve                         # Start daemon
      aos show create --id ball --at 100,100,200,200 --html "<div>hello</div>"
      aos show render --width 800 --height 600 --html "<h1>Hi</h1>" --out /tmp/test.png
      aos see observe --depth 2         # Stream perception events
      aos set voice.enabled true        # Turn on voice
    """
    print(usage)
}

func handleSee(args: [String]) {
    guard let sub = args.first else {
        exitError("Usage: aos see <cursor|observe>", code: "MISSING_SUBCOMMAND")
    }
    switch sub {
    case "cursor":
        cursorCommand()
    case "observe":
        observeCommand(args: Array(args.dropFirst()))
    default:
        exitError("Unknown see subcommand: \(sub)", code: "UNKNOWN_SUBCOMMAND")
    }
}

func handleShow(args: [String]) {
    // Initialize NSApplication for render (needs it for WKWebView even offscreen)
    _ = NSApplication.shared

    guard let sub = args.first else {
        exitError("Usage: aos show <create|update|remove|remove-all|list|render|eval|listen|ping>", code: "MISSING_SUBCOMMAND")
    }
    switch sub {
    case "render":
        renderCommand(args: Array(args.dropFirst()))
    case "create":
        createCommand(args: Array(args.dropFirst()))
    case "update":
        updateCommand(args: Array(args.dropFirst()))
    case "remove":
        removeCommand(args: Array(args.dropFirst()))
    case "remove-all":
        removeAllCommand(args: Array(args.dropFirst()))
    case "list":
        listCommand(args: Array(args.dropFirst()))
    case "eval":
        evalCommand(args: Array(args.dropFirst()))
    case "listen":
        listenCommand(args: Array(args.dropFirst()))
    case "ping":
        pingCommand(args: Array(args.dropFirst()))
    case "to-front":
        toFrontCommand(args: Array(args.dropFirst()))
    case "post":
        postCommand(args: Array(args.dropFirst()))
    default:
        exitError("Unknown show subcommand: \(sub)", code: "UNKNOWN_SUBCOMMAND")
    }
}

func handleSet(args: [String]) {
    setCommand(args: args)
}

func handleServe(args: [String]) {
    serveCommand(args: args)
}
