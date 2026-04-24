// browser-internal.swift — Hidden debug subcommands for browser adapter
// development. Registered under `aos browser _<op>`. Not user-facing.

import Foundation

func handleBrowserInternal(args: [String]) {
    guard let sub = args.first else {
        exitError("Usage: aos browser _<op> ...", code: "MISSING_ARG")
    }
    let rest = Array(args.dropFirst())
    switch sub {
    case "_parse-target":
        guard let input = rest.first else {
            exitError("Usage: aos browser _parse-target <target>", code: "MISSING_ARG")
        }
        do {
            let t = try parseBrowserTarget(input)
            let enc = JSONEncoder()
            enc.outputFormatting = [.sortedKeys]
            let data = try enc.encode(t)
            print(String(data: data, encoding: .utf8)!)
        } catch BrowserTargetError.missingSession {
            exitError("PLAYWRIGHT_CLI_SESSION not set and no session in target",
                      code: "MISSING_SESSION")
        } catch BrowserTargetError.invalid(let msg) {
            exitError("invalid target: \(msg)", code: "INVALID_TARGET")
        } catch {
            exitError("\(error)", code: "INTERNAL")
        }
    default:
        exitError("Unknown internal subcommand: \(sub)", code: "UNKNOWN_SUBCOMMAND")
    }
}
