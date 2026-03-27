// heads-up — Shared utilities

import Foundation

// MARK: - JSON Helpers

func jsonString<T: Encodable>(_ value: T) -> String {
    let enc = JSONEncoder()
    enc.outputFormatting = [.prettyPrinted, .sortedKeys]
    guard let data = try? enc.encode(value), let s = String(data: data, encoding: .utf8) else { return "{}" }
    return s
}

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

let kSocketDir = NSString(string: "~/.config/heads-up").expandingTildeInPath
let kSocketPath = kSocketDir + "/sock"

// MARK: - Unix Socket Helper

/// Execute a closure with a properly bound sockaddr_un. Handles the ugly C interop.
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
