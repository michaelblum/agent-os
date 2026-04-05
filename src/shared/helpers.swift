// helpers.swift — Shared utilities for the aos binary

import Foundation

// MARK: - JSON Helpers

func jsonString<T: Encodable>(_ value: T, pretty: Bool = true) -> String {
    let enc = JSONEncoder()
    enc.outputFormatting = pretty ? [.prettyPrinted, .sortedKeys] : [.sortedKeys]
    guard let data = try? enc.encode(value), let s = String(data: data, encoding: .utf8) else { return "{}" }
    return s
}

func jsonCompact<T: Encodable>(_ value: T) -> String {
    jsonString(value, pretty: false)
}

// MARK: - Error Output

func exitError(_ message: String, code: String) -> Never {
    let obj: [String: String] = ["error": message, "code": code]
    if let data = try? JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted, .sortedKeys]),
       let s = String(data: data, encoding: .utf8) {
        FileHandle.standardError.write(s.data(using: .utf8)!)
        FileHandle.standardError.write("\n".data(using: .utf8)!)
    }
    exit(1)
}

// MARK: - Socket Path

let kAosSocketDir: String = {
    NSString(string: "~/.config/aos").expandingTildeInPath
}()

let kAosSocketPath: String = {
    kAosSocketDir + "/sock"
}()

// MARK: - Unix Socket Helper

func withSockAddr(_ path: String, _ body: (UnsafePointer<sockaddr>, socklen_t) -> Int32) -> Int32 {
    var addr = sockaddr_un()
    addr.sun_family = sa_family_t(AF_UNIX)
    let pathBytes = path.utf8CString
    let maxLen = MemoryLayout.size(ofValue: addr.sun_path)
    withUnsafeMutablePointer(to: &addr.sun_path) { ptr in
        pathBytes.withUnsafeBufferPointer { src in
            UnsafeMutableRawPointer(ptr).copyMemory(
                from: src.baseAddress!, byteCount: min(pathBytes.count, maxLen))
        }
    }
    return withUnsafePointer(to: &addr) { ptr in
        ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
            body(sockPtr, socklen_t(MemoryLayout<sockaddr_un>.size))
        }
    }
}

// MARK: - Duration Parser

func parseDuration(_ str: String) -> TimeInterval {
    if str == "none" { return .infinity }
    let s = str.lowercased()
    if s.hasSuffix("s"), let n = Double(s.dropLast()) { return n }
    if s.hasSuffix("m"), let n = Double(s.dropLast()) { return n * 60 }
    if s.hasSuffix("h"), let n = Double(s.dropLast()) { return n * 3600 }
    if let n = Double(s) { return n }
    exitError("Invalid duration: \(str). Use format like 5s, 10m, 1h, or 'none'.", code: "INVALID_DURATION")
}

// MARK: - ISO 8601

func iso8601Now() -> String {
    let fmt = ISO8601DateFormatter()
    fmt.formatOptions = [.withInternetDateTime]
    return fmt.string(from: Date())
}

// MARK: - Response Helpers

func sendResponse(to fd: Int32, _ data: Data) {
    var buf = data
    buf.append(contentsOf: "\n".utf8)
    buf.withUnsafeBytes { ptr in
        _ = write(fd, ptr.baseAddress!, ptr.count)
    }
}

func sendJSON(to fd: Int32, _ dict: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: dict, options: [.sortedKeys]) else { return }
    sendResponse(to: fd, data)
}
