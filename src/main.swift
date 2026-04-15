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
        case "tell":
            handleTell(args: Array(args.dropFirst()))
        case "set":
            handleSet(args: Array(args.dropFirst()))
        case "serve":
            handleServe(args: Array(args.dropFirst()))
        case "content":
            guard args.count > 1 else { exitError("Usage: aos content status [--json]", code: "MISSING_SUBCOMMAND") }
            switch args[1] {
            case "status":
                runContentStatus(Array(args.dropFirst(2)))
            default:
                exitError("Unknown content command: \(args[1])", code: "UNKNOWN_COMMAND")
            }
        case "service":
            serviceCommand(args: Array(args.dropFirst()))
        case "runtime":
            runtimeCommand(args: Array(args.dropFirst()))
        case "doctor":
            doctorCommand(args: Array(args.dropFirst()))
        case "reset":
            resetCommand(args: Array(args.dropFirst()))
        case "clean":
            cleanCommand(args: Array(args.dropFirst()))
        case "permissions":
            permissionsCommand(args: Array(args.dropFirst()))
        case "focus":
            guard args.count >= 2 else {
                exitError("Usage: aos focus <create|update|list|remove>", code: "MISSING_SUBCOMMAND")
            }
            switch args[1] {
            case "create":  focusCreateCommand(args: Array(args.dropFirst(2)))
            case "update":  focusUpdateCommand(args: Array(args.dropFirst(2)))
            case "list":    focusListCommand()
            case "remove":  focusRemoveCommand(args: Array(args.dropFirst(2)))
            default: exitError("Unknown focus subcommand: \(args[1])", code: "UNKNOWN_COMMAND")
            }
        case "graph":
            guard args.count >= 2 else {
                exitError("Usage: aos graph <displays|windows|deepen|collapse>", code: "MISSING_SUBCOMMAND")
            }
            switch args[1] {
            case "displays":  graphDisplaysCommand()
            case "windows":   graphWindowsCommand(args: Array(args.dropFirst(2)))
            case "deepen":    graphDeepenCommand(args: Array(args.dropFirst(2)))
            case "collapse":  graphCollapseCommand(args: Array(args.dropFirst(2)))
            default: exitError("Unknown graph subcommand: \(args[1])", code: "UNKNOWN_COMMAND")
            }
        case "daemon-snapshot":
            daemonSnapshotCommand()
        case "inspect":
            inspectCommand(args: Array(args.dropFirst()))
        case "log":
            logCommand(args: Array(args.dropFirst()))
        case "wiki":
            wikiCommand(args: Array(args.dropFirst()))
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
      focus <subcommand>   Focus channels — track window AX trees
      graph <subcommand>   Graph navigation — display/window/depth control
      daemon-snapshot      Daemon state snapshot
      serve                Start the unified daemon
      service              Manage the daemon as a launchd service
      runtime              Package/sign/install the stable AOS.app runtime
      doctor               Runtime and permission health checks
      reset                Deterministic cleanup for repo/installed runtime state
      clean                Session-boundary cleanup (stale daemons, orphaned canvases)
      permissions          Permission preflight and one-time onboarding
      inspect              Live AX element inspector overlay
      log                  Display log console panel
      wiki <subcommand>    Knowledge base — browse, search, invoke workflow plugins

    Perception (aos see):
      cursor               What's under the cursor (display, window, AX element)
      capture <target>     Screenshot capture
      <target>             Shorthand for capture (main, external, user_active, selfie, mouse, all)
      observe              Subscribe to perception stream (requires daemon)

    Capture targets:
      main                 Primary display
      external [N]         External display (optional index)
      user_active          Display with frontmost app window
      selfie               Display hosting the calling process
      mouse                Display under cursor (with --radius for area)
      all                  All connected displays
      <zone-name>          Named zone (configured via aos see zone)

    Capture options:
      --out <path>         Output file path (default: ./screenshot.png)
      --base64             Output base64 instead of file
      --window             Capture window only (not full display)
      --crop <spec>        Crop: x,y,w,h or named regions (top-half, etc.)
      --grid <CxR>         Grid overlay (e.g. 4x3)
      --xray               AX element traversal overlay
      --label              Badge annotations (implies --xray; uses `aos show render`)
      --format <fmt>       png, jpg, heic (default: png)
      --quality <q>        high, med, low (default: high)
      --show-cursor        Include cursor in capture
      --highlight-cursor   Highlight cursor position
      --radius <px>        Radius for mouse target capture
      --delay <sec>        Delay before capture
      --clipboard          Also copy to clipboard
      --draw-rect <coords> <color>  Draw rectangle overlay
      --interactive        Native selection rectangle
      --wait-for-click     Wait for click, then capture

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
      exists               Check whether a canvas exists
      get                  Get one canvas by ID

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

    Focus Channels (aos focus):
      create                 Create a channel tracking a window's AX tree
      update                 Update channel focus/depth
      list                   List active channels
      remove                 Remove a channel

    Graph Navigation (aos graph):
      displays               Enumerate connected displays
      windows                Enumerate on-screen windows
      deepen                 Increase AX traversal depth on a channel
      collapse               Decrease AX traversal depth on a channel

    Daemon:
      daemon-snapshot        Display/window/channel snapshot from daemon

    Tools:
      inspect [--at x,y,w,h]  Live AX inspector — shows element under cursor
      log [--at x,y,w,h]      Log console — scrolling output panel

    Wiki (aos wiki):
      create-plugin <name>   Scaffold a new workflow plugin
      add <type> <name>      Create an entity or concept page
      rm <path>              Remove a page (warns about broken links)
      link <from> <to>       Add a cross-reference between pages
      list                   List pages (--type, --plugin, --links-to, --links-from, --orphans)
      search <query>         Search pages (--type filter)
      show <name>            Display a page (--raw for markdown, --json for structured)
      invoke <plugin>        Bundle a plugin into a prompt payload
      reindex                Rebuild the index from filesystem
      lint                   Check for broken links, orphans, missing frontmatter
      seed                   Populate wiki with starter content
      migrate-namespaces     Move legacy entities/concepts/plugins into aos/ namespace

    Examples:
      aos see cursor                    # What's under the cursor
      aos see capture main --out /tmp/screen.png   # Screenshot main display
      aos see main --base64 --format jpg           # Base64 JPEG of main display
      aos see capture user_active --window --xray  # Window capture with AX overlay
      aos see mouse --radius 200 --out /tmp/m.png  # Area around cursor
      aos see capture all --out /tmp/all.png       # All displays
      aos see main --crop top-half --grid 4x3      # Crop + grid overlay
      aos serve                         # Start daemon
      aos service status --json        # Launchd service status
      aos runtime status --json        # Installed AOS.app runtime status
      aos runtime path                 # Installed AOS.app path
      aos runtime install              # Package + install stable runtime
      aos runtime display-union        # Bounding box of all displays (x,y,w,h)
      aos doctor --json                # Runtime + permission health
      aos reset --mode current --json  # Stop matching services + clear state/artifacts
      aos permissions preflight --json # Safe upfront readiness check before testing
      aos permissions setup --once     # Guided one-time permission onboarding
      aos show create --id ball --at 100,100,200,200 --html "<div>hello</div>"
      aos show exists --id avatar --json
      aos show get --id avatar --json
      aos show render --width 800 --height 600 --html "<h1>Hi</h1>" --out /tmp/test.png
      aos do click 500,300              # Click at coordinates
      aos do type "hello world"         # Type text
      aos do key "cmd+s"                # Key combo
      aos do session                    # Start interactive session
      aos see observe --depth 2         # Stream perception events
      aos say "Hello, I'm your agent"    # Speak text
      aos say --list-voices              # List available voices
      aos set voice.enabled true        # Turn on voice
      aos inspect                        # Live AX element inspector
      echo "hello" | aos log             # Stream to log overlay
      aos log push "test message"        # One-shot log entry
      aos wiki seed                      # Populate with starter content
      aos wiki list                      # List all wiki pages
      aos wiki list --type workflow      # List workflow plugins
      aos wiki show gateway --json       # View a page as JSON
      aos wiki search "IPC protocol"     # Search the wiki
      aos wiki create-plugin my-flow     # Create a new plugin
      aos wiki invoke self-check         # Bundle a plugin for chat injection
      aos wiki lint                      # Check wiki health
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
    case "click":
        ensureInteractivePreflight(command: "aos do click")
        cliClick(args: subArgs)
    case "hover":
        ensureInteractivePreflight(command: "aos do hover")
        cliHover(args: subArgs)
    case "drag":
        ensureInteractivePreflight(command: "aos do drag")
        cliDrag(args: subArgs)
    case "scroll":
        ensureInteractivePreflight(command: "aos do scroll")
        cliScroll(args: subArgs)
    case "type":
        ensureInteractivePreflight(command: "aos do type")
        cliType(args: subArgs)
    case "key":
        ensureInteractivePreflight(command: "aos do key")
        cliKey(args: subArgs)
    // AX commands
    case "press":
        ensureInteractivePreflight(command: "aos do press")
        cliPress(args: subArgs)
    case "set-value":
        ensureInteractivePreflight(command: "aos do set-value")
        cliSetValue(args: subArgs)
    case "focus":
        ensureInteractivePreflight(command: "aos do focus")
        cliFocusElement(args: subArgs)
    case "raise":
        ensureInteractivePreflight(command: "aos do raise")
        cliRaise(args: subArgs)
    case "move":
        ensureInteractivePreflight(command: "aos do move")
        cliMove(args: subArgs)
    case "resize":
        ensureInteractivePreflight(command: "aos do resize")
        cliResize(args: subArgs)
    // AppleScript
    case "tell":
        ensureInteractivePreflight(command: "aos do tell")
        cliTell(args: subArgs)
    // Session mode
    case "session":
        ensureInteractivePreflight(command: "aos do session")
        runSession(profileName: getArg(subArgs, "--profile") ?? "natural")
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
        exitError("Usage: aos see <cursor|capture|list|selection|observe|zone> or aos see <target>", code: "MISSING_SUBCOMMAND")
    }
    switch sub {
    case "cursor":
        ensureInteractivePreflight(command: "aos see cursor")
        cursorCommand()
    case "observe":
        ensureInteractivePreflight(command: "aos see observe")
        observeCommand(args: Array(args.dropFirst()))
    case "capture":
        ensureInteractivePreflight(command: "aos see capture")
        runCaptureAsync(args: Array(args.dropFirst()))
    case "list":
        ensureInteractivePreflight(command: "aos see list")
        seeListCommand()
    case "selection":
        ensureInteractivePreflight(command: "aos see selection")
        selectionCommand()
    case "zone":
        zoneCommand(args: Array(args.dropFirst()))
    case "--help", "-h", "help":
        printUsage()
    default:
        // Bare target shorthand: "aos see main" → "aos see capture main"
        // Also forwards zone names and "external N" directly to capture pipeline.
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
    // Initialize NSApplication for render (needs it for WKWebView even offscreen)
    _ = NSApplication.shared

    guard let sub = args.first else {
        exitError("Usage: aos show <create|update|remove|remove-all|list|render|eval|listen|ping|exists|get>", code: "MISSING_SUBCOMMAND")
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
    case "exists":
        showExistsCommand(args: Array(args.dropFirst()))
    case "get":
        showGetCommand(args: Array(args.dropFirst()))
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

func handleTell(args: [String]) {
    tellCommand(args: args)
}
