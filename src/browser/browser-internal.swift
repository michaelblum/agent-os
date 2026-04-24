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
    case "_check-version":
        do {
            let ok = try probePlaywrightVersion()
            let enc = JSONEncoder()
            enc.outputFormatting = [.sortedKeys]
            print(String(data: try enc.encode(ok), encoding: .utf8)!)
        } catch PlaywrightVersionError.notFound {
            exitError(
                "@playwright/cli is not installed. Run: npm install -g @playwright/cli@latest",
                code: "PLAYWRIGHT_CLI_NOT_FOUND"
            )
        } catch PlaywrightVersionError.tooOld(let found, let min) {
            exitError(
                "@playwright/cli \(found) is below the minimum \(min). Run: npm install -g @playwright/cli@latest.",
                code: "PLAYWRIGHT_CLI_TOO_OLD"
            )
        } catch PlaywrightVersionError.probeFailed(let msg) {
            exitError("Version probe failed: \(msg)", code: "PLAYWRIGHT_CLI_PROBE_FAILED")
        } catch {
            exitError("\(error)", code: "INTERNAL")
        }
    case "_run":
        var session = "", verb = "", withFilename = false
        for a in rest {
            if a.hasPrefix("--session=") { session = String(a.dropFirst("--session=".count)) }
            else if a.hasPrefix("--verb=") { verb = String(a.dropFirst("--verb=".count)) }
            else if a == "--with-filename" { withFilename = true }
        }
        guard !session.isEmpty, !verb.isEmpty else {
            exitError("--session=<s> and --verb=<v> are required", code: "MISSING_ARG")
        }
        do {
            let r = try runPlaywright(PlaywrightInvocation(
                session: session, verb: verb, args: [], withTempFilename: withFilename
            ))
            let enc = JSONEncoder()
            enc.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
            print(String(data: try enc.encode(r), encoding: .utf8)!)
        } catch PlaywrightInvocationError.launchFailed(let msg) {
            exitError("launch failed: \(msg)", code: "PLAYWRIGHT_CLI_LAUNCH_FAILED")
        } catch {
            exitError("\(error)", code: "INTERNAL")
        }
    case "_parse-snapshot":
        guard let path = rest.first else {
            exitError("Usage: aos browser _parse-snapshot <markdown-file>", code: "MISSING_ARG")
        }
        do {
            let contents = try readSnapshotMarkdown(atPath: path)
            let elements = parseSnapshotMarkdown(contents)
            let enc = JSONEncoder()
            enc.outputFormatting = [.sortedKeys, .prettyPrinted]
            print(String(data: try enc.encode(elements), encoding: .utf8)!)
        } catch BrowserAdapterError.subprocess(let msg, let code) {
            exitError(msg, code: code)
        } catch {
            exitError("\(error)", code: "INTERNAL")
        }
    case "_registry":
        guard let op = rest.first else {
            exitError("Usage: aos browser _registry <op> ...", code: "MISSING_ARG")
        }
        let opArgs = Array(rest.dropFirst())
        let enc = JSONEncoder()
        enc.outputFormatting = [.sortedKeys]
        do {
            switch op {
            case "list":
                let all = try readRegistry()
                print(String(data: try enc.encode(all), encoding: .utf8)!)
            case "add":
                var id = "", mode = "", attachKind: String? = nil, headless: Bool? = nil, winID: Int? = nil
                for a in opArgs {
                    if a.hasPrefix("--id=") { id = String(a.dropFirst(5)) }
                    else if a.hasPrefix("--mode=") { mode = String(a.dropFirst(7)) }
                    else if a.hasPrefix("--attach-kind=") { attachKind = String(a.dropFirst(14)) }
                    else if a.hasPrefix("--headless=") { headless = (String(a.dropFirst(11)) == "true") }
                    else if a.hasPrefix("--browser-window-id=") { winID = Int(String(a.dropFirst(20))) }
                }
                guard !id.isEmpty, !mode.isEmpty else {
                    exitError("--id and --mode required", code: "MISSING_ARG")
                }
                try addRegistryRecord(BrowserSessionRecord(
                    id: id, mode: mode, attach_kind: attachKind, headless: headless,
                    browser_window_id: winID, active_url: nil, updated_at: isoNow()
                ))
                print("{\"status\":\"ok\"}")
            case "remove":
                var id = ""
                for a in opArgs where a.hasPrefix("--id=") { id = String(a.dropFirst(5)) }
                guard !id.isEmpty else { exitError("--id required", code: "MISSING_ARG") }
                try removeRegistryRecord(id: id)
                print("{\"status\":\"ok\"}")
            case "find":
                var id = ""
                for a in opArgs where a.hasPrefix("--id=") { id = String(a.dropFirst(5)) }
                guard !id.isEmpty else { exitError("--id required", code: "MISSING_ARG") }
                if let r = try findRegistryRecord(id: id) {
                    print(String(data: try enc.encode(r), encoding: .utf8)!)
                } else {
                    exitError("not found: \(id)", code: "NOT_FOUND")
                }
            default:
                exitError("Unknown registry op: \(op)", code: "UNKNOWN_SUBCOMMAND")
            }
        } catch SessionRegistryError.duplicateID(let id) {
            exitError("session already registered: \(id)", code: "DUPLICATE_ID")
        } catch SessionRegistryError.notFound(let id) {
            exitError("session not found: \(id)", code: "NOT_FOUND")
        } catch {
            exitError("\(error)", code: "INTERNAL")
        }
    case "_resolve-anchor":
        guard let input = rest.first else {
            exitError("Usage: aos browser _resolve-anchor <target>", code: "MISSING_ARG")
        }
        do {
            let t = try parseBrowserTarget(input)
            let anchor = try resolveBrowserAnchor(target: t)
            let enc = JSONEncoder()
            enc.outputFormatting = [.sortedKeys]
            print(String(data: try enc.encode(anchor), encoding: .utf8)!)
        } catch AnchorResolveError.notFound(let id) {
            exitError("browser session '\(id)' not registered", code: "NOT_FOUND")
        } catch AnchorResolveError.headless {
            exitError("headless browser sessions cannot be anchored (no CGWindowID)",
                      code: "BROWSER_HEADLESS")
        } catch AnchorResolveError.notLocal(let msg) {
            exitError(msg, code: "BROWSER_NOT_LOCAL")
        } catch AnchorResolveError.evalFailed(let msg) {
            exitError(msg, code: "ANCHOR_EVAL_FAILED")
        } catch BrowserTargetError.invalid(let msg) {
            exitError(msg, code: "INVALID_TARGET")
        } catch BrowserTargetError.missingSession {
            exitError("PLAYWRIGHT_CLI_SESSION not set", code: "MISSING_SESSION")
        } catch {
            exitError("\(error)", code: "INTERNAL")
        }
    default:
        exitError("Unknown internal subcommand: \(sub)", code: "UNKNOWN_SUBCOMMAND")
    }
}
