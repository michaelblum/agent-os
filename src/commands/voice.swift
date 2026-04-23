import Foundation

func voiceCommand(args: [String]) {
    if args.contains("--help") || args.contains("-h") {
        if let subcommand = args.first, !subcommand.hasPrefix("--") {
            printCommandHelp(["voice", subcommand], json: args.contains("--json"))
            exit(0)
        }
        printCommandHelp(["voice"], json: args.contains("--json"))
        exit(0)
    }

    guard let subcommand = args.first else {
        printCommandHelp(["voice"], json: false)
        exit(0)
    }

    let response: [String: Any]?
    switch subcommand {
    case "_internal-id-roundtrip":
        voiceInternalIDRoundtrip(args: Array(args.dropFirst())); return
    case "_internal-canonicalize":
        voiceInternalCanonicalize(args: Array(args.dropFirst())); return
    case "_internal-registry-snapshot":
        let policyLoader: () -> VoicePolicy? = { nil }
        let reg = VoiceRegistry(policyLoader: policyLoader)
        let snap = reg.snapshot().map { $0.dictionary() }
        let data = try! JSONSerialization.data(withJSONObject: snap, options: [.sortedKeys, .prettyPrinted])
        print(String(data: data, encoding: .utf8)!)
        exit(0)
    case "_internal-migrate-policy":
        let store = VoicePolicyStore()
        let migrated = store.migrateLegacyAssignmentsIfNeeded()
        let result = ["migrated": migrated, "policy_path": store.filePath] as [String: Any]
        print(String(data: try! JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), encoding: .utf8)!)
        exit(0)
    case "_internal-allocator-test":
        voiceInternalAllocatorTest(args: Array(args.dropFirst())); return
    case "list":
        response = voiceListEnvelope(args: Array(args.dropFirst()))
    case "assignments":
        response = sendEnvelopeRequest(service: "voice", action: "assignments", data: [:], autoStartBinary: CommandLine.arguments[0])
    case "refresh":
        response = sendEnvelopeRequest(service: "voice", action: "refresh", data: [:], autoStartBinary: CommandLine.arguments[0])
    case "leases":
        FileHandle.standardError.write("Deprecation: aos voice leases is now aos voice assignments\n".data(using: .utf8)!)
        response = sendEnvelopeRequest(service: "voice", action: "assignments", data: [:], autoStartBinary: CommandLine.arguments[0])
    case "bind":
        response = voiceBindEnvelope(args: Array(args.dropFirst()))
    case "final-response":
        response = voiceFinalResponseEnvelope(args: Array(args.dropFirst()))
    default:
        exitError("Unknown voice command: \(subcommand)", code: "UNKNOWN_COMMAND")
    }

    guard let response else {
        exitError("Cannot connect to daemon", code: "DAEMON_UNREACHABLE")
    }

    if let data = try? JSONSerialization.data(withJSONObject: response, options: [.sortedKeys]),
       let s = String(data: data, encoding: .utf8) {
        if response["error"] != nil {
            FileHandle.standardError.write(s.data(using: .utf8)!)
            FileHandle.standardError.write("\n".data(using: .utf8)!)
            exit(1)
        } else {
            print(s)
        }
    }
}

private func voiceListEnvelope(args: [String]) -> [String: Any]? {
    var data: [String: Any] = [:]
    var i = 0
    while i < args.count {
        switch args[i] {
        case "--provider":
            i += 1
            guard i < args.count else { exitError("--provider requires a value", code: "MISSING_ARG") }
            data["provider"] = args[i]
        case "--speakable-only":
            data["speakable_only"] = true
        case "--json":
            break
        default:
            exitError("Unknown argument: \(args[i])", code: "UNKNOWN_ARG")
        }
        i += 1
    }
    return sendEnvelopeRequest(service: "voice", action: "list", data: data, autoStartBinary: CommandLine.arguments[0])
}

private func voiceBindEnvelope(args: [String]) -> [String: Any]? {
    var sessionID: String?
    var voiceID: String?

    var i = 0
    while i < args.count {
        switch args[i] {
        case "--session-id":
            i += 1
            guard i < args.count else { exitError("--session-id requires a value", code: "MISSING_ARG") }
            sessionID = args[i]
        case "--voice":
            i += 1
            guard i < args.count else { exitError("--voice requires a value", code: "MISSING_ARG") }
            voiceID = args[i]
        default:
            exitError("Unknown argument: \(args[i])", code: "UNKNOWN_ARG")
        }
        i += 1
    }

    guard let sessionID, !sessionID.isEmpty else {
        exitError("bind requires --session-id <id>", code: "MISSING_ARG")
    }
    guard let voiceID, !voiceID.isEmpty else {
        exitError("bind requires --voice <id>", code: "MISSING_ARG")
    }
    return sendEnvelopeRequest(service: "voice", action: "bind", data: [
        "session_id": sessionID,
        "voice_id": voiceID
    ], autoStartBinary: CommandLine.arguments[0])
}

private func voiceInternalIDRoundtrip(args: [String]) {
    var provider: String?
    var suffix: String?
    var raw: String?
    var i = 0
    while i < args.count {
        switch args[i] {
        case "--provider": i += 1; provider = i < args.count ? args[i] : nil
        case "--suffix": i += 1; suffix = i < args.count ? args[i] : nil
        case "--raw": i += 1; raw = i < args.count ? args[i] : nil
        default: break
        }
        i += 1
    }
    if let raw {
        if let parsed = VoiceID.parse(raw) {
            print("\(raw)|\(parsed.provider)|\(parsed.providerVoiceID)"); exit(0)
        }
        FileHandle.standardError.write("VOICE_ID_INVALID\n".data(using: .utf8)!)
        exit(2)
    }
    guard let provider, let suffix else { exitError("missing --provider/--suffix", code: "MISSING_ARG") }
    let uri = VoiceID.make(provider: provider, providerVoiceID: suffix)
    guard let parsed = VoiceID.parse(uri) else { exitError("VOICE_ID_INVALID", code: "VOICE_ID_INVALID") }
    print("\(uri)|\(parsed.provider)|\(parsed.providerVoiceID)")
    exit(0)
}

private func voiceInternalCanonicalize(args: [String]) {
    var id: String?
    var i = 0
    while i < args.count {
        if args[i] == "--id" { i += 1; id = i < args.count ? args[i] : nil }
        i += 1
    }
    guard let id else { exitError("missing --id", code: "MISSING_ARG") }
    print(VoiceID.canonicalize(id))
    exit(0)
}

private func voiceInternalAllocatorTest(args: [String]) {
    // args is a sequence: seed:A,B,C  next  next  used:B  reseed:B,C,D  next ...
    let alloc = VoiceAllocator()
    var output: [Any] = []
    for cmd in args {
        if cmd.hasPrefix("seed:") {
            alloc.seed(uris: String(cmd.dropFirst(5)).split(separator: ",").map(String.init))
            output.append(["op": "seed", "deque": alloc.currentDeque()])
        } else if cmd.hasPrefix("reseed:") {
            alloc.reseed(uris: String(cmd.dropFirst(7)).split(separator: ",").map(String.init))
            output.append(["op": "reseed", "deque": alloc.currentDeque()])
        } else if cmd.hasPrefix("used:") {
            alloc.markUsed(String(cmd.dropFirst(5)))
            output.append(["op": "used", "deque": alloc.currentDeque()])
        } else if cmd == "next" {
            let n = alloc.next() ?? ""
            output.append(["op": "next", "value": n, "deque": alloc.currentDeque()])
        }
    }
    let data = try! JSONSerialization.data(withJSONObject: output, options: [.sortedKeys, .prettyPrinted])
    print(String(data: data, encoding: .utf8)!)
    exit(0)
}

private func voiceFinalResponseEnvelope(args: [String]) -> [String: Any]? {
    var sessionID: String?
    var harness: String?

    var i = 0
    while i < args.count {
        switch args[i] {
        case "--session-id":
            i += 1
            guard i < args.count else { exitError("--session-id requires a value", code: "MISSING_ARG") }
            sessionID = args[i]
        case "--harness":
            i += 1
            guard i < args.count else { exitError("--harness requires a value", code: "MISSING_ARG") }
            harness = args[i]
        default:
            exitError("Unknown argument: \(args[i])", code: "UNKNOWN_ARG")
        }
        i += 1
    }

    var hookPayload: Any = [String: Any]()
    if let stdinData = try? FileHandle.standardInput.availableData,
       !stdinData.isEmpty {
        guard let stdinText = String(data: stdinData, encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines),
              !stdinText.isEmpty else {
            // empty stdin — keep empty dict
            hookPayload = [String: Any]()
            return buildFinalResponseEnvelope(hookPayload: hookPayload, sessionID: sessionID, harness: harness)
        }
        guard let payloadData = stdinText.data(using: .utf8),
              let parsed = try? JSONSerialization.jsonObject(with: payloadData) else {
            exitError("voice final-response requires JSON hook payload on stdin", code: "INVALID_JSON")
        }
        hookPayload = parsed
    }

    return buildFinalResponseEnvelope(hookPayload: hookPayload, sessionID: sessionID, harness: harness)
}

private func buildFinalResponseEnvelope(hookPayload: Any, sessionID: String?, harness: String?) -> [String: Any]? {
    var data: [String: Any] = ["hook_payload": hookPayload]
    if let sid = sessionID, !sid.isEmpty { data["session_id"] = sid }
    if let h = harness, !h.isEmpty { data["harness"] = h }
    return sendEnvelopeRequest(service: "voice", action: "final_response", data: data, autoStartBinary: CommandLine.arguments[0])
}
