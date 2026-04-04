// heads-up — Display server for agent-os
// Render mode: HTML/CSS/SVG → transparent PNG bitmap
// Serve mode: persistent transparent canvases on screen

import AppKit

// MARK: - Usage

func printUsage() {
    let text = """
    heads-up — Display server for agent-os

    COMMANDS:
      render                  Render HTML/CSS/SVG to a transparent PNG bitmap
      create                  Create a canvas on screen (starts daemon if needed)
      update                  Update an existing canvas
      remove                  Remove a canvas
      remove-all              Remove all canvases
      list                    List active canvases
      ping                    Ping the running daemon (returns uptime)
      eval                    Evaluate JavaScript in a canvas WKWebView
      listen                  Persistent connection: subscribe to events, forward stdin commands
      serve                   Start the daemon (normally auto-started by create)

    Run 'heads-up <command> --help' for command-specific options.
    """
    print(text)
}

// MARK: - Entry Point

@main
struct HeadsUp {
    static func main() {
        _ = NSApplication.shared

        let args = Array(CommandLine.arguments.dropFirst())
        guard !args.isEmpty else { printUsage(); exit(0) }

        switch args[0] {
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
        case "serve":
            serveCommand(args: Array(args.dropFirst()))
        case "ping":
            pingCommand(args: Array(args.dropFirst()))
        case "eval":
            evalCommand(args: Array(args.dropFirst()))
        case "post":
            postCommand(args: Array(args.dropFirst()))
        case "to-front":
            toFrontCommand(args: Array(args.dropFirst()))
        case "listen":
            listenCommand(args: Array(args.dropFirst()))
        case "--help", "-h", "help":
            printUsage()
        default:
            exitError("Unknown command: \(args[0]). Run 'heads-up --help' for usage.", code: "UNKNOWN_COMMAND")
        }
    }
}
