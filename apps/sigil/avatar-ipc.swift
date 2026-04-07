// avatar-ipc.swift -- IPC helpers for communicating with the aos daemon.
//
// Uses shared/swift/ipc/ for transport. Sigil-specific helpers
// (canvas queries, telemetry, behavior messaging) are layered on top.

import Foundation

// -- Well-known IDs --
let avatarID   = "avatar"
let avatarHitTargetID = "avatar-hit-target"
let chatID     = "agent-chat"
let telemetryID = "telemetry"

// -- Path resolution --

private func sigilExecutableDir() -> String {
    URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL.deletingLastPathComponent().path
}

private let sigilSentinels = [
    "apps/sigil/celestial/live/index.html",
    "apps/sigil/avatar.html"
]

private func sigilBundledRoot() -> String? {
    let environment = ProcessInfo.processInfo.environment
    let candidates = [
        environment["AOS_SIGIL_ROOT"],
        Bundle.main.resourceURL?.appendingPathComponent("agent-os").path,
        NSString(string: (sigilExecutableDir() as NSString).appendingPathComponent("../Resources/agent-os")).standardizingPath,
        NSString(string: (sigilExecutableDir() as NSString).appendingPathComponent("../../Resources/agent-os")).standardizingPath
    ]

    for candidate in candidates.compactMap({ $0 }) {
        for sentinel in sigilSentinels {
            let sentinelPath = (candidate as NSString).appendingPathComponent(sentinel)
            if FileManager.default.fileExists(atPath: sentinelPath) {
                return candidate
            }
        }
    }

    return nil
}

private func sigilRepoRoot() -> String {
    if let bundledRoot = sigilBundledRoot() {
        return bundledRoot
    }

    let bases = [
        sigilExecutableDir(),
        FileManager.default.currentDirectoryPath
    ]
    let suffixes = ["", "..", "../..", "../../.."]

    for base in bases {
        for suffix in suffixes {
            let candidate = NSString(string: (base as NSString).appendingPathComponent(suffix)).standardizingPath
            for sentinel in sigilSentinels {
                let sentinelPath = (candidate as NSString).appendingPathComponent(sentinel)
                if FileManager.default.fileExists(atPath: sentinelPath) {
                    return candidate
                }
            }
        }
    }

    return NSString(string: (sigilExecutableDir() as NSString).appendingPathComponent("../..")).standardizingPath
}

func sigilRepoPath(_ relativePath: String) -> String {
    NSString(string: (sigilRepoRoot() as NSString).appendingPathComponent(relativePath)).standardizingPath
}

func sigilFileURL(_ relativePath: String) -> String {
    URL(fileURLWithPath: sigilRepoPath(relativePath)).absoluteString
}

func setSigilRuntimeInputMode(_ mode: String) {
    _ = daemonOneShot(["action": "sigil_input_mode", "mode": mode])
}

// -- Fire-and-forget: connect, send, read response, close --
func sendOneShot(_ json: String) {
    daemonOneShotRaw(json)
}

// -- Query all canvases --
func getCanvasList() -> String {
    let session = DaemonSession()
    guard session.connect() else { return "" }
    defer { session.disconnect() }
    guard let response = session.sendAndReceive(["action": "list"]) else { return "" }
    guard let data = try? JSONSerialization.data(withJSONObject: response),
          let str = String(data: data, encoding: .utf8) else { return "" }
    return str
}

// -- Extract position from list JSON for a given canvas ID --
func parseCanvasPosition(_ listStr: String, _ canvasID: String) -> (Double, Double, Double, Double)? {
    guard let idRange = listStr.range(of: "\"id\":\"\(canvasID)\"") else { return nil }
    let before = listStr[listStr.startIndex..<idRange.lowerBound]
    guard let atRange = before.range(of: "\"at\":[", options: .backwards) else { return nil }
    let nums = listStr[atRange.upperBound...]
    guard let endBracket = nums.firstIndex(of: "]") else { return nil }
    let parts = String(nums[..<endBracket]).split(separator: ",").compactMap {
        Double($0.trimmingCharacters(in: .whitespaces))
    }
    guard parts.count >= 4 else { return nil }
    return (parts[0], parts[1], parts[2], parts[3])
}

// -- Query chat DOM for pip (dot) position --
func queryDotPosition() -> (Double, Double) {
    var dotCX = 25.0, dotCY = 21.5  // fallback
    let session = DaemonSession()
    guard session.connect() else { return (dotCX, dotCY) }
    defer { session.disconnect() }
    let js = "var r=document.getElementById('dot').getBoundingClientRect();r.left+r.width/2+','+(r.top+r.height/2)"
    guard let response = session.sendAndReceive([
        "action": "eval", "id": chatID, "js": js
    ]) else { return (dotCX, dotCY) }
    if let result = response["result"] as? String {
        let parts = result.split(separator: ",")
        if parts.count == 2, let x = Double(parts[0]), let y = Double(parts[1]) {
            dotCX = x; dotCY = y
        }
    }
    return (dotCX, dotCY)
}

// -- Z-ordering --
func bringToFront(_ canvasID: String) {
    daemonOneShot(["action": "to-front", "id": canvasID])
}

// -- Telemetry --
func pushTelemetry(channel: String, data: [String: Any]) {
    guard let jsonData = try? JSONSerialization.data(withJSONObject: ["channel": channel, "data": data]),
          let jsonStr = String(data: jsonData, encoding: .utf8) else { return }
    let b64 = Data(jsonStr.utf8).base64EncodedString()
    let escaped = b64.replacingOccurrences(of: "'", with: "\\'")
    daemonOneShot(["action": "eval", "id": telemetryID, "js": "headsup.receive('\(escaped)')"])
}

func pushEvent(_ text: String, level: String = "") {
    pushTelemetry(channel: "_event", data: ["text": text, "level": level])
}

func pushAvatarState() {
    pushTelemetry(channel: "avatar", data: [
        "state": "active",
        "position": "(\(Int(curX)), \(Int(curY)))",
        "size": Int(curSize),
    ])
}

// -- Send behavior slot message to avatar skin --
func sendBehavior(_ slot: String, data: [String: Any] = [:]) {
    let msg: [String: Any] = ["type": "behavior", "slot": slot, "data": data]
    guard let jsonData = try? JSONSerialization.data(withJSONObject: msg),
          let jsonStr = String(data: jsonData, encoding: .utf8) else { return }
    let b64 = Data(jsonStr.utf8).base64EncodedString()
    daemonOneShot(["action": "eval", "id": avatarID, "js": "headsup.receive('\(b64)')"])
}

// -- Canvas IDs for multi-display --
func avatarCanvasID(_ displayIndex: Int) -> String {
    displayIndex == 0 ? avatarID : "avatar-display-\(displayIndex)"
}

var activeDisplayIndex: Int = 0

// -- Send scene position to the active display's canvas --
func sendScenePosition(_ session: DaemonSession, x: Double, y: Double) {
    let msg: [String: Any] = ["type": "scene_position", "position": [x, y]]
    guard let jsonData = try? JSONSerialization.data(withJSONObject: msg),
          let jsonStr = String(data: jsonData, encoding: .utf8) else { return }
    let b64 = Data(jsonStr.utf8).base64EncodedString()
    session.sendOnly(["action": "eval", "id": avatarCanvasID(activeDisplayIndex), "js": "headsup.receive('\(b64)')"])
}

// -- Send a message to a specific display's canvas --
func sendToCanvas(_ displayIndex: Int, _ msg: [String: Any]) {
    guard let jsonData = try? JSONSerialization.data(withJSONObject: msg),
          let jsonStr = String(data: jsonData, encoding: .utf8) else { return }
    let b64 = Data(jsonStr.utf8).base64EncodedString()
    daemonOneShot(["action": "eval", "id": avatarCanvasID(displayIndex), "js": "headsup.receive('\(b64)')"])
}

// -- Load avatar config from disk --
func loadAvatarConfig() -> [String: Any]? {
    let path = "\(aosStateDir())/avatar-config.json"
    guard let data = FileManager.default.contents(atPath: path),
          let config = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
    return config
}

// -- Save avatar config to disk --
func saveAvatarConfig(_ config: [String: Any]) {
    let path = "\(aosStateDir())/avatar-config.json"
    guard let data = try? JSONSerialization.data(withJSONObject: config, options: .prettyPrinted) else { return }
    FileManager.default.createFile(atPath: path, contents: data)
}
