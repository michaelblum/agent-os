// avatar-ipc.swift -- Socket/IPC helpers for communicating with heads-up daemon.
//
// Extracted from avatar-follower.swift.
// All communication goes through a Unix domain socket at ~/.config/heads-up/sock.

import Foundation

// -- Well-known IDs and paths --
let socketPath = NSString(string: "~/.config/heads-up/sock").expandingTildeInPath
let avatarID   = "avatar"
let chatID     = "agent-chat"
let telemetryID = "telemetry"

// -- Socket connection --
func connectSock() -> Int32 {
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else { return -1 }
    var addr = sockaddr_un()
    addr.sun_family = sa_family_t(AF_UNIX)
    let pathBytes = socketPath.utf8CString
    let maxLen = MemoryLayout.size(ofValue: addr.sun_path)
    withUnsafeMutablePointer(to: &addr.sun_path) { ptr in
        pathBytes.withUnsafeBufferPointer { src in
            UnsafeMutableRawPointer(ptr).copyMemory(
                from: src.baseAddress!, byteCount: min(pathBytes.count, maxLen))
        }
    }
    let r = withUnsafePointer(to: &addr) { p in
        p.withMemoryRebound(to: sockaddr.self, capacity: 1) {
            connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
        }
    }
    guard r == 0 else { close(fd); return -1 }
    return fd
}

// -- Send JSON + read response on an open fd --
func sendJSON(_ fd: Int32, _ json: String) {
    let line = json + "\n"
    line.withCString { ptr in _ = write(fd, ptr, strlen(ptr)) }
    var buf = [UInt8](repeating: 0, count: 4096)
    _ = read(fd, &buf, buf.count)
}

// -- Fire-and-forget: connect, send, close --
func sendOneShot(_ json: String) {
    let fd = connectSock()
    guard fd >= 0 else { return }
    sendJSON(fd, json)
    close(fd)
}

// -- Query all canvases --
func getCanvasList() -> String {
    let fd = connectSock()
    guard fd >= 0 else { return "" }
    let req = "{\"action\":\"list\"}\n"
    req.withCString { ptr in _ = write(fd, ptr, strlen(ptr)) }
    var buf = [UInt8](repeating: 0, count: 8192)
    let n = read(fd, &buf, buf.count)
    close(fd)
    guard n > 0 else { return "" }
    return String(bytes: buf[0..<n], encoding: .utf8) ?? ""
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
    let fd = connectSock()
    guard fd >= 0 else { return (dotCX, dotCY) }
    let js = "var r=document.getElementById('dot').getBoundingClientRect();r.left+r.width/2+','+(r.top+r.height/2)"
    let req = "{\"action\":\"eval\",\"id\":\"\(chatID)\",\"js\":\"\(js)\"}\n"
    req.withCString { ptr in _ = write(fd, ptr, strlen(ptr)) }
    var buf = [UInt8](repeating: 0, count: 4096)
    let n = read(fd, &buf, buf.count)
    close(fd)
    if n > 0, let str = String(bytes: buf[0..<n], encoding: .utf8) {
        if let rRange = str.range(of: "\"result\":\""),
           let rEnd = str[rRange.upperBound...].firstIndex(of: "\"") {
            let coords = String(str[rRange.upperBound..<rEnd])
            let parts = coords.split(separator: ",")
            if parts.count == 2, let x = Double(parts[0]), let y = Double(parts[1]) {
                dotCX = x; dotCY = y
            }
        }
    }
    return (dotCX, dotCY)
}

// -- Z-ordering --
func bringToFront(_ canvasID: String) {
    sendOneShot("{\"action\":\"to-front\",\"id\":\"\(canvasID)\"}")
}

// -- Telemetry --
func pushTelemetry(channel: String, data: [String: Any]) {
    guard let jsonData = try? JSONSerialization.data(withJSONObject: ["channel": channel, "data": data]),
          let jsonStr = String(data: jsonData, encoding: .utf8) else { return }
    let b64 = Data(jsonStr.utf8).base64EncodedString()
    let escaped = b64.replacingOccurrences(of: "'", with: "\\'")
    sendOneShot("{\"action\":\"eval\",\"id\":\"\(telemetryID)\",\"js\":\"headsup.receive('\(escaped)')\"}")
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
    sendOneShot("{\"action\":\"eval\",\"id\":\"\(avatarID)\",\"js\":\"headsup.receive('\(b64)')\"}")
}
