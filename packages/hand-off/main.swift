// main.swift — Entry point for hand-off v2.
// Dispatches to session mode or standalone CLI commands.

import Foundation

@available(macOS 14.0, *)
struct HandOff {
    static func main() {
        let args = Array(CommandLine.arguments.dropFirst())

        // No args or help request
        if args.isEmpty {
            printUsage()
            return
        }

        let command = args[0]
        let rest = Array(args.dropFirst())

        switch command {
        // Help
        case "help", "--help", "-h":
            printUsage()

        // Session mode
        case "session":
            let profileName = getArg(rest, "--profile") ?? "natural"
            runSession(profileName: profileName)

        // Profile management
        case "profiles":
            if rest.first == "show" {
                guard rest.count >= 2 else {
                    exitWithError("Usage: hand-off profiles show <name>", code: "MISSING_PARAM")
                }
                profilesShowCommand(name: rest[1])
            } else {
                profilesListCommand()
            }

        // CGEvent commands
        case "click":   cliClick(args: rest)
        case "hover":   cliHover(args: rest)
        case "drag":    cliDrag(args: rest)
        case "scroll":  cliScroll(args: rest)
        case "type":    cliType(args: rest)
        case "key":     cliKey(args: rest)

        // AX commands
        case "press":      cliPress(args: rest)
        case "set-value":  cliSetValue(args: rest)
        case "focus":      cliFocusElement(args: rest)
        case "raise":      cliRaise(args: rest)
        case "move":       cliMove(args: rest)
        case "resize":     cliResize(args: rest)

        // AppleScript
        case "tell":    cliTell(args: rest)

        default:
            exitWithError("Unknown command: \(command). Run 'hand-off help' for usage.", code: "UNKNOWN_COMMAND")
        }
    }
}

@_cdecl("main")
func entryPoint(_ argc: Int32, _ argv: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>) -> Int32 {
    if #available(macOS 14.0, *) {
        HandOff.main()
    } else {
        FileHandle.standardError.write("hand-off requires macOS 14.0 or later\n".data(using: .utf8)!)
        return 1
    }
    return 0
}
