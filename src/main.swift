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
      set <key> <value>    Configure autonomic settings
      serve                Start the unified daemon

    Perception (aos see):
      cursor               What's under the cursor (display, window, AX element)
      observe              Subscribe to perception stream (requires daemon)

    Configuration (aos set):
      voice.enabled <bool>              Enable/disable voice output
      perception.default_depth <0-3>    Default perception depth
      perception.settle_threshold_ms <ms>  Cursor settle threshold
      feedback.visual <bool>            Enable/disable visual feedback

    Examples:
      aos see cursor                    # One-shot: what's under the cursor
      aos serve                         # Start daemon
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

func handleSet(args: [String]) {
    setCommand(args: args)
}

func handleServe(args: [String]) {
    serveCommand(args: args)
}

// Temporary stubs — replaced by subsequent tasks
func cursorCommand() { print("{\"status\":\"stub\",\"command\":\"cursor\"}") }
func observeCommand(args: [String]) { print("{\"status\":\"stub\",\"command\":\"observe\"}") }
func setCommand(args: [String]) { print("{\"status\":\"stub\",\"command\":\"set\"}") }
func serveCommand(args: [String]) { print("{\"status\":\"stub\",\"command\":\"serve\"}") }
