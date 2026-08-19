import CryptoKit
import Foundation

private let screenRecordingDefaults: [String: UInt64] = [
    "--frame-rate": 30,
    "--max-pixel-count": AOSScreenRecordingLimits.maximumPixelCount,
    "--max-queue-frames": 3,
    "--max-output-bytes": 268_435_456,
]

func recordCommand(args: [String]) {
    guard args.last == "--json" else {
        recordUsageError()
    }
    if args.first == "screen-follow-update" {
        recordScreenFollowUpdate(Array(args.dropFirst().dropLast()))
    }
    guard args.first == "screen" else { recordUsageError() }
    let flags = parseScreenRecordingFlags(Array(args.dropFirst().dropLast()))
    let topology = observeDisplayTopologySnapshot()
    let target = screenRecordingTarget(flags: flags, topology: topology)
    guard let duration = uint64Flag(flags, "--duration-ms"),
          (AOSScreenRecordingLimits.minimumDurationMilliseconds
            ... AOSScreenRecordingLimits.maximumDurationMilliseconds).contains(duration) else {
        recordUsageError()
    }
    let frameRate = boundedScreenRecordingFlag(
        flags,
        "--frame-rate",
        range: AOSScreenRecordingLimits.minimumFrameRate
            ... AOSScreenRecordingLimits.maximumFrameRate
    )
    let maxPixels = boundedScreenRecordingFlag(
        flags,
        "--max-pixel-count",
        range: AOSScreenRecordingLimits.minimumPixelCount
            ... AOSScreenRecordingLimits.maximumPixelCount
    )
    let queueFrames = boundedScreenRecordingFlag(
        flags,
        "--max-queue-frames",
        range: AOSScreenRecordingLimits.minimumQueueFrames
            ... AOSScreenRecordingLimits.maximumQueueFrames
    )
    let maxBytes = boundedScreenRecordingFlag(
        flags,
        "--max-output-bytes",
        range: AOSScreenRecordingLimits.minimumOutputBytes
            ... AOSScreenRecordingLimits.maximumOutputBytes
    )
    let requestID = UUID().uuidString.lowercased()
    let systemAudioSelected = flags["--system-audio"] == "true"
    let microphoneSelected = flags["--microphone"] == "true"
    let parameters: [String: Any] = [
        "schema_version": AOSScreenRecordingRequest.schemaVersion,
        "topology": (try? aosDisplayTopologyWireValue(topology)) ?? [:],
        "target": target,
        "geometry": screenRecordingGeometryValue(flags: flags),
        "duration_ms": duration,
        "frame_rate": frameRate,
        "max_pixel_count": maxPixels,
        "max_queue_frames": queueFrames,
        "max_output_bytes": maxBytes,
        "tracks": [
            "video": true,
            "system_audio": systemAudioSelected,
            "microphone": microphoneSelected,
        ],
        "codec": AOSScreenRecordingRequest.codec,
        "container": AOSScreenRecordingRequest.container,
    ]
    let data = operationRequestData(
        action: "record_screen",
        requestID: requestID,
        parameters: parameters
    )
    sendScreenRecordingRequest(
        action: "record_screen",
        data: data,
        requestID: requestID
    )
}

private func recordScreenFollowUpdate(_ args: [String]) -> Never {
    let flags = parseScreenRecordingFollowFlags(args)
    guard let selector = operationIdentityFlag(flags["--operation"]),
          let expected = uint64Flag(flags, "--expected-geometry-generation"),
          let rawRegion = flags["--region"] else {
        recordUsageError()
    }
    let topology = observeDisplayTopologySnapshot()
    let target = screenRecordingTarget(
        flags: ["--region": rawRegion, "--display": flags["--display"] ?? "main"],
        topology: topology
    )
    let requestID = UUID().uuidString.lowercased()
    let parameters: [String: Any] = [
        "selector": [
            "operation_id": selector.id,
            "operation_generation": selector.generation,
        ],
        "expected_geometry_generation": expected,
        "topology": (try? aosDisplayTopologyWireValue(topology)) ?? [:],
        "target": target,
        "binding": screenRecordingFollowBindingValue(flags: flags),
    ]
    let data = operationRequestData(
        action: "record_screen_follow_update",
        requestID: requestID,
        parameters: parameters
    )
    sendScreenRecordingRequest(
        action: "record_screen_follow_update",
        data: data,
        requestID: requestID
    )
}

private func sendScreenRecordingRequest(
    action: String,
    data: [String: Any],
    requestID: String
) -> Never {
    let socketPath = aosSocketPath(for: aosCurrentRuntimeMode())
    let session = DaemonSession(socketPath: socketPath)
    guard session.connectWithAutoStart(binaryPath: CommandLine.arguments[0], timeoutMs: 1_000) else {
        exitError("The AOS screen-recording producer is unavailable.", code: "DAEMON_UNREACHABLE")
    }
    defer { session.disconnect() }
    session.sendOnly([
        "v": 1,
        "service": "operation",
        "action": action,
        "data": data,
        "ref": requestID,
    ])
    guard let response = session.readOneJSON(timeoutMs: 5_000) else {
        exitError(
            "The screen-recording admission response was unavailable.",
            code: "OPERATION_RESPONSE_UNAVAILABLE"
        )
    }
    guard JSONSerialization.isValidJSONObject(response),
          let encoded = try? JSONSerialization.data(withJSONObject: response, options: [.sortedKeys]) else {
        exitError("The screen-recording response was invalid.", code: "OPERATION_RESPONSE_INVALID")
    }
    FileHandle.standardOutput.write(encoded)
    FileHandle.standardOutput.write(Data("\n".utf8))
    if response["status"] as? String == "error" || response["error"] != nil { exit(1) }
    exit(0)
}

private func parseScreenRecordingFlags(_ args: [String]) -> [String: String] {
    let allowed: Set<String> = [
        "--display", "--window-id", "--region", "--duration-ms", "--frame-rate",
        "--max-pixel-count", "--max-queue-frames", "--max-output-bytes",
        "--system-audio", "--microphone",
        "--geometry-mode", "--binding-target", "--binding-observation",
        "--binding-state", "--binding-session", "--binding-navigation",
        "--binding-frame", "--source-window-id", "--source-owner-pid",
        "--update-interval-ms", "--update-deadline-ms",
    ]
    var values: [String: String] = [:]
    var index = 0
    while index < args.count {
        let flag = args[index]
        guard allowed.contains(flag), values[flag] == nil else { recordUsageError() }
        if flag == "--system-audio" || flag == "--microphone" {
            values[flag] = "true"
            index += 1
            continue
        }
        guard index + 1 < args.count, !args[index + 1].hasPrefix("--") else {
            recordUsageError()
        }
        values[flag] = args[index + 1]
        index += 2
    }
    guard values["--duration-ms"] != nil,
          !(values["--window-id"] != nil && values["--region"] != nil) else {
        recordUsageError()
    }
    return values
}

private func parseScreenRecordingFollowFlags(_ args: [String]) -> [String: String] {
    let allowed: Set<String> = [
        "--operation", "--expected-geometry-generation", "--display", "--region",
        "--binding-target", "--binding-observation", "--binding-state",
        "--binding-session", "--binding-navigation", "--binding-frame",
        "--source-window-id", "--source-owner-pid",
    ]
    var values: [String: String] = [:]
    var index = 0
    while index < args.count {
        let flag = args[index]
        guard allowed.contains(flag), values[flag] == nil,
              index + 1 < args.count, !args[index + 1].hasPrefix("--") else {
            recordUsageError()
        }
        values[flag] = args[index + 1]
        index += 2
    }
    guard values["--operation"] != nil,
          values["--expected-geometry-generation"] != nil,
          values["--region"] != nil else {
        recordUsageError()
    }
    return values
}

private func screenRecordingGeometryValue(flags: [String: String]) -> [String: Any] {
    switch flags["--geometry-mode"] ?? "fixed" {
    case "fixed":
        let followFlags = flags.keys.filter {
            $0.hasPrefix("--binding-") || $0.hasPrefix("--source-")
                || $0.hasPrefix("--update-")
        }
        guard followFlags.isEmpty else { recordUsageError() }
        return ["mode": "fixed"]
    case "caller_followed":
        guard flags["--region"] != nil,
              let interval = uint64Flag(flags, "--update-interval-ms"),
              let deadline = uint64Flag(flags, "--update-deadline-ms") else {
            recordUsageError()
        }
        return [
            "mode": "caller_followed",
            "binding": screenRecordingFollowBindingValue(flags: flags),
            "update_interval_ms": interval,
            "update_deadline_ms": deadline,
        ]
    default:
        recordUsageError()
    }
}

private func screenRecordingFollowBindingValue(
    flags: [String: String]
) -> [String: Any] {
    guard let target = bindingIdentityFlag(flags["--binding-target"]),
          let observation = bindingIdentityFlag(flags["--binding-observation"]),
          let state = bindingIdentityFlag(flags["--binding-state"]),
          let session = bindingIdentityFlag(flags["--binding-session"]),
          let navigation = bindingIdentityFlag(flags["--binding-navigation"]),
          let frame = bindingIdentityFlag(flags["--binding-frame"]),
          let sourceWindow = intFlag(flags["--source-window-id"]),
          let sourceOwner = intFlag(flags["--source-owner-pid"]) else {
        recordUsageError()
    }
    return [
        "target": target,
        "observation": observation,
        "state": state,
        "session": session,
        "navigation": navigation,
        "frame": frame,
        "source_window": ["window_id": sourceWindow, "owner_pid": sourceOwner],
    ]
}

private func bindingIdentityFlag(_ raw: String?) -> [String: Any]? {
    guard let raw, let separator = raw.lastIndex(of: ":"),
          separator != raw.startIndex,
          let generation = UInt64(raw[raw.index(after: separator)...]),
          generation > 0 else {
        return nil
    }
    return ["id": String(raw[..<separator]), "generation": generation]
}

private func operationIdentityFlag(_ raw: String?) -> AOSOperationIdentity? {
    guard let value = bindingIdentityFlag(raw),
          let id = value["id"] as? String,
          let generation = value["generation"] as? UInt64 else {
        return nil
    }
    return AOSOperationIdentity(id: id, generation: generation)
}

private func intFlag(_ raw: String?) -> Int? {
    guard let raw, let value = Int(raw), value > 0, String(value) == raw else { return nil }
    return value
}

private func screenRecordingTarget(
    flags: [String: String],
    topology: AOSDisplayTopologySnapshot
) -> [String: Any] {
    if let rawWindow = flags["--window-id"], let windowID = Int(rawWindow), windowID > 0 {
        let matches = observeCaptureWindowFacts().filter { $0.windowID == windowID }
        guard matches.count == 1, let window = matches.first,
              let ownerPID = window.owningApplication?.processID,
              let display = topology.displays.first(where: {
                CGRect(
                    x: $0.nativeBounds.x,
                    y: $0.nativeBounds.y,
                    width: $0.nativeBounds.width,
                    height: $0.nativeBounds.height
                ).contains(window.frame.integral)
              }), screenRecordingDisplay(flags["--display"], topology: topology) == display else {
            recordUsageError()
        }
        return [
            "kind": "window",
            "display_ordinal": display.ordinal,
            "window_id": windowID,
            "owner_pid": ownerPID,
            "global_bounds": boundsValue(window.frame.integral),
        ]
    }
    if let rawRegion = flags["--region"] {
        let parts = rawRegion.split(separator: ",").compactMap { Double($0) }
        guard parts.count == 4, parts[2] > 0, parts[3] > 0 else { recordUsageError() }
        let region = CGRect(x: parts[0], y: parts[1], width: parts[2], height: parts[3]).integral
        let containing = topology.displays.filter {
            CGRect(
                x: $0.nativeBounds.x,
                y: $0.nativeBounds.y,
                width: $0.nativeBounds.width,
                height: $0.nativeBounds.height
            ).contains(region)
        }
        guard containing.count == 1, let display = containing.first,
              screenRecordingDisplay(flags["--display"], topology: topology) == display else {
            recordUsageError()
        }
        return [
            "kind": "region",
            "display_ordinal": display.ordinal,
            "global_bounds": boundsValue(region),
        ]
    }
    let display = screenRecordingDisplay(flags["--display"], topology: topology)
    return ["kind": "display", "display_ordinal": display.ordinal]
}

private func screenRecordingDisplay(
    _ selector: String?,
    topology: AOSDisplayTopologySnapshot
) -> AOSDisplayTopologyDisplay {
    let selected: AOSDisplayTopologyDisplay?
    switch selector ?? "main" {
    case "main": selected = topology.displays.first(where: \.isMain)
    case "external": selected = topology.displays.first(where: { !$0.isMain && !$0.runtimeIsMirrored })
    case let value where Int(value) != nil:
        selected = topology.displays.first(where: { $0.ordinal == Int(value) })
    default: selected = nil
    }
    guard let selected else { recordUsageError() }
    return selected
}

private func boundedScreenRecordingFlag(
    _ flags: [String: String],
    _ name: String,
    range: ClosedRange<UInt64>
) -> UInt64 {
    let value = uint64Flag(flags, name) ?? screenRecordingDefaults[name]
    guard let value, range.contains(value) else { recordUsageError() }
    return value
}

private func uint64Flag(_ flags: [String: String], _ name: String) -> UInt64? {
    guard let raw = flags[name], let value = UInt64(raw), String(value) == raw else { return nil }
    return value
}

private func boundsValue(_ value: CGRect) -> [String: Double] {
    ["x": value.origin.x, "y": value.origin.y, "width": value.width, "height": value.height]
}

private func operationRequestData(
    action: String,
    requestID: String,
    parameters: [String: Any]
) -> [String: Any] {
    guard JSONSerialization.isValidJSONObject(parameters),
          (try? JSONSerialization.data(withJSONObject: parameters)) != nil else {
        recordUsageError()
    }
    var material = Data("aos:operation-request:v1\n".utf8)
    let input: [String: Any] = ["action": action, "parameters": parameters]
    material.append(try! JSONSerialization.data(
        withJSONObject: input,
        options: [.sortedKeys, .withoutEscapingSlashes]
    ))
    var data = parameters
    data["request_id"] = requestID
    data["canonical_parameter_digest"] = SHA256.hash(data: material)
        .map { String(format: "%02x", $0) }.joined()
    return data
}

private func recordUsageError() -> Never {
    exitError(
        "__record screen requires bounded media flags plus closed fixed/caller_followed geometry; __record screen-follow-update requires operation, expected generation, full region/binding flags, and --json.",
        code: "INVALID_ARG"
    )
}
