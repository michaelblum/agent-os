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
    guard let sub = args.first else {
        exitError("Usage: aos runtime <install|status|path|sign>", code: "MISSING_SUBCOMMAND")
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
    default:
        exitError("Unknown runtime subcommand: \(sub)", code: "UNKNOWN_SUBCOMMAND")
    }
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
            exitError("Usage: \(usage)", code: "UNKNOWN_ARG")
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
