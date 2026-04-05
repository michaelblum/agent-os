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
        case "do":
            handleDo(args: Array(args.dropFirst()))
        case "say":
            handleSay(args: Array(args.dropFirst()))
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
      do <subcommand>      Action — execute mouse, keyboard, AX actions
      say <text>           Voice — speak text aloud
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

    Action (aos do):
      click <x,y>           Click at coordinates (--right, --double)
      hover <x,y>           Move cursor to coordinates
      drag <x1,y1> <x2,y2>  Drag between coordinates
      scroll <x,y>          Scroll (--dx, --dy)
      type <text>            Type text with natural cadence
      key <combo>            Key combo (e.g. cmd+s, ctrl+shift+tab)
      press                  Press AX element (--pid, --role, --title)
      set-value              Set AX element value (--pid, --role, --value)
      focus                  Focus AX element (--pid, --role)
      raise                  Activate and raise app window (--pid)
      move                   Move window (--pid, --to x,y)
      resize                 Resize window (--pid, --to w,h)
      tell <app> <script>    Execute AppleScript
      session                Interactive ndjson session mode
      profiles [name]        List or show behavior profiles

    Voice (aos say):
      <text>               Speak text aloud
      --voice <id>         Use specific voice
      --rate <wpm>         Speech rate (words per minute)
      --list-voices        List available system voices

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
      aos do click 500,300              # Click at coordinates
      aos do type "hello world"         # Type text
      aos do key "cmd+s"                # Key combo
      aos do session                    # Start interactive session
      aos see observe --depth 2         # Stream perception events
      aos say "Hello, I'm your agent"    # Speak text
      aos say --list-voices              # List available voices
      aos set voice.enabled true        # Turn on voice
    """
    print(usage)
}

func handleDo(args: [String]) {
    guard let sub = args.first else {
        exitError("Usage: aos do <click|type|key|drag|scroll|hover|press|set-value|focus|raise|move|resize|tell|session|profiles>", code: "MISSING_SUBCOMMAND")
    }
    let subArgs = Array(args.dropFirst())
    switch sub {
    // CGEvent commands
    case "click":       cliClick(args: subArgs)
    case "hover":       cliHover(args: subArgs)
    case "drag":        cliDrag(args: subArgs)
    case "scroll":      cliScroll(args: subArgs)
    case "type":        cliType(args: subArgs)
    case "key":         cliKey(args: subArgs)
    // AX commands
    case "press":       cliPress(args: subArgs)
    case "set-value":   cliSetValue(args: subArgs)
    case "focus":       cliFocusElement(args: subArgs)
    case "raise":       cliRaise(args: subArgs)
    case "move":        cliMove(args: subArgs)
    case "resize":      cliResize(args: subArgs)
    // AppleScript
    case "tell":        cliTell(args: subArgs)
    // Session mode
    case "session":     runSession(profileName: getArg(subArgs, "--profile") ?? "natural")
    // Profiles
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

func handleSay(args: [String]) {
    sayCommand(args: args)
}

func handleSet(args: [String]) {
    setCommand(args: args)
}

func handleServe(args: [String]) {
    serveCommand(args: args)
}
