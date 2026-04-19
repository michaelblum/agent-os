// runtime.swift — packaged runtime install/sign/status helpers.

import Foundation

private struct RuntimeStatusResponse: Encodable {
    let status: String
    let installed: Bool
    let path: String
    let bundle_id: String?
    let version: String?
    let build_version: String?
    let signed: Bool
    let signing_identity: String?
    let team_identifier: String?
    let notes: [String]
}

func runtimeCommand(args: [String]) {
    if args.contains("--help") || args.contains("-h") {
        printCommandHelp(["runtime"], json: args.contains("--json"))
        exit(0)
    }
    guard let sub = args.first else {
        exitError("runtime requires a subcommand. Usage: aos runtime <status|path|sign|install|display-union [--native]> ...",
                  code: "MISSING_SUBCOMMAND")
    }

    switch sub {
    case "install":
        let asJSON = parseRuntimeJSONFlag(Array(args.dropFirst()), usage: "aos runtime install [--json]")
        runRuntimeScriptCommand(scriptName: "install-aos-runtime", extraArgs: [], asJSON: asJSON)
    case "status":
        runtimeStatusCommand(args: Array(args.dropFirst()))
    case "path":
        runtimePathCommand(args: Array(args.dropFirst()))
    case "sign":
        let extraArgs = Array(args.dropFirst())
        runRuntimeScriptCommand(scriptName: "sign-aos-runtime", extraArgs: extraArgs, asJSON: false)
    case "display-union":
        runtimeDisplayUnionCommand(args: Array(args.dropFirst()))
    default:
        exitError("Unknown runtime subcommand: \(sub)", code: "UNKNOWN_SUBCOMMAND")
    }
}

/// Print the union bounding box of all connected displays as `x,y,w,h`
/// (comma-separated integers). Default output is the canonical DesktopWorld
/// shape — top-left of the arranged full-display union at (0,0). Pass
/// `--native` to print the legacy native desktop compatibility shape used
/// by AppKit/CG boundary callers (matches the `display_geometry` channel's
/// `global_bounds` field).
private func runtimeDisplayUnionCommand(args: [String]) {
    if args.contains("--help") || args.contains("-h") {
        print("Usage: aos runtime display-union [--native]")
        print("")
        print("Print the bounding box of all connected displays as x,y,w,h")
        print("(integers, comma-separated). Default output is DesktopWorld")
        print("(top-left of the arranged full-display union = 0,0).")
        print("")
        print("Flags:")
        print("  --native   Print native desktop compatibility coordinates")
        print("             (top-left of the macOS main display = 0,0).")
        return
    }
    var asNative = false
    for arg in args {
        switch arg {
        case "--native":
            asNative = true
        default:
            exitError("Unknown flag: \(arg). Usage: aos runtime display-union [--native]",
                      code: "UNKNOWN_FLAG")
        }
    }
    print(runtimeDisplayUnion(native: asNative))
}

/// Compute the current display union as `x,y,w,h` comma-separated integers.
/// Reuses `snapshotDisplayGeometry()` so the output matches the
/// `display_geometry` channel payload. When `native` is true, returns the
/// native-compat `global_bounds` shape; otherwise returns the canonical
/// DesktopWorld shape (`desktop_world_bounds`, which is `0,0,w,h` by
/// construction). Returns `"0,0,0,0"` when no displays are attached.
func runtimeDisplayUnion(native: Bool = false) -> String {
    let snapshot = snapshotDisplayGeometry()
    let key = native ? "global_bounds" : "desktop_world_bounds"
    guard let rect = snapshot[key] as? [String: Double] else {
        return "0,0,0,0"
    }
    let x = Int(rect["x"] ?? 0)
    let y = Int(rect["y"] ?? 0)
    let w = Int(rect["w"] ?? 0)
    let h = Int(rect["h"] ?? 0)
    return "\(x),\(y),\(w),\(h)"
}

private func runtimeStatusCommand(args: [String]) {
    let asJSON = parseRuntimeJSONFlag(args, usage: "aos runtime status [--json]")
    let response = currentRuntimeStatus()
    if asJSON {
        print(jsonString(response))
    } else {
        let identity = response.signing_identity ?? "none"
        print("installed=\(response.installed) path=\(response.path) signed=\(response.signed) identity=\(identity)")
        if !response.notes.isEmpty {
            for note in response.notes {
                print(note)
            }
        }
    }
}

private func runtimePathCommand(args: [String]) {
    let asJSON = parseRuntimeJSONFlag(args, usage: "aos runtime path [--json]")
    let path = preferredRuntimeAppPath()
    if asJSON {
        print(jsonCompact(["path": path]))
    } else {
        print(path)
    }
}

private func currentRuntimeStatus() -> RuntimeStatusResponse {
    let targetApp = preferredRuntimeAppPath()
    let infoPlist = (targetApp as NSString).appendingPathComponent("Contents/Info.plist")
    let executable = (targetApp as NSString).appendingPathComponent("Contents/MacOS/aos")

    var installed = false
    var bundleID: String? = nil
    var version: String? = nil
    var buildVersion: String? = nil
    var signed = false
    var signingIdentity: String? = nil
    var teamIdentifier: String? = nil
    var notes: [String] = []

    if FileManager.default.fileExists(atPath: targetApp) {
        installed = true
    } else {
        notes.append("Runtime app is not installed.")
    }

    if FileManager.default.fileExists(atPath: infoPlist),
       let plistData = FileManager.default.contents(atPath: infoPlist),
       let plist = try? PropertyListSerialization.propertyList(from: plistData, format: nil) as? [String: Any] {
        bundleID = plist["CFBundleIdentifier"] as? String
        version = plist["CFBundleShortVersionString"] as? String
        buildVersion = plist["CFBundleVersion"] as? String
    } else {
        notes.append("Info.plist is missing.")
    }

    if !FileManager.default.isExecutableFile(atPath: executable) {
        notes.append("Bundled executable is missing or not executable.")
    }

    if FileManager.default.isExecutableFile(atPath: executable) {
        let meta = runProcess("/usr/bin/codesign", arguments: ["-d", "--verbose=4", targetApp])
        if meta.exitCode == 0 || !meta.stderr.isEmpty {
            let codesignMeta = meta.stderr
            signed = true
            signingIdentity = firstCodesignField("Authority", in: codesignMeta) ?? firstCodesignField("Signature", in: codesignMeta)
            teamIdentifier = firstCodesignField("TeamIdentifier", in: codesignMeta)
            if signingIdentity == "adhoc" {
                notes.append("Runtime is signed ad hoc; use a stable certificate when available.")
            }
        } else {
            notes.append("Runtime is not signed or signature is invalid.")
        }
    }

    return RuntimeStatusResponse(
        status: notes.isEmpty ? "ok" : "degraded",
        installed: installed,
        path: targetApp,
        bundle_id: bundleID,
        version: version,
        build_version: buildVersion,
        signed: signed,
        signing_identity: signingIdentity,
        team_identifier: teamIdentifier == "not set" ? nil : teamIdentifier,
        notes: notes
    )
}

private func firstCodesignField(_ key: String, in output: String) -> String? {
    for rawLine in output.split(whereSeparator: \.isNewline) {
        let line = String(rawLine)
        guard line.hasPrefix("\(key)=") else { continue }
        let value = String(line.dropFirst(key.count + 1)).trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }
    return nil
}

private func preferredRuntimeAppPath() -> String {
    aosInstallAppPath()
}

private func parseRuntimeJSONFlag(_ args: [String], usage: String) -> Bool {
    var asJSON = false
    for arg in args {
        if arg == "--json" {
            asJSON = true
        } else {
            exitError("Unknown flag: \(arg). Usage: \(usage)", code: "UNKNOWN_FLAG")
        }
    }
    return asJSON
}

private func runRuntimeScriptCommand(scriptName: String, extraArgs: [String], asJSON: Bool) {
    let scriptPath = aosRepoPath("scripts/\(scriptName)")
    guard FileManager.default.isExecutableFile(atPath: scriptPath) else {
        exitError("Runtime script is missing or not executable: \(scriptPath)", code: "FILE_NOT_FOUND")
    }

    var arguments = [scriptPath]
    arguments.append(contentsOf: extraArgs)
    let output = runProcess("/bin/bash", arguments: arguments)
    if output.exitCode != 0 {
        let message = [output.stderr, output.stdout]
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first { !$0.isEmpty } ?? "Runtime command failed."
        exitError(message, code: "RUNTIME_SCRIPT_ERROR")
    }

    let text = output.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
    if asJSON {
        let response = currentRuntimeStatus()
        print(jsonString(response))
    } else if !text.isEmpty {
        print(text)
    }
}
