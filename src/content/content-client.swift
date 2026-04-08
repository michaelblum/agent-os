// content/client.swift — CLI client for content server status

import Foundation

func runContentStatus(_ args: [String]) {
    let session = DaemonSession()
    guard session.connect() else {
        exitError("Cannot connect to daemon — is 'aos serve' running?", code: "NO_DAEMON")
    }
    defer { session.disconnect() }

    guard let response = session.sendAndReceive(["action": "content_status"]) else {
        exitError("No response from daemon", code: "NO_RESPONSE")
    }

    if args.contains("--json") {
        if let data = try? JSONSerialization.data(withJSONObject: response, options: [.prettyPrinted, .sortedKeys]),
           let str = String(data: data, encoding: .utf8) {
            print(str)
        }
    } else {
        let port = response["port"] as? Int ?? 0
        let roots = response["roots"] as? [String: String] ?? [:]
        if port > 0 {
            print("Content server: http://127.0.0.1:\(port)/")
            for (prefix, dir) in roots.sorted(by: { $0.key < $1.key }) {
                print("  /\(prefix)/ → \(dir)")
            }
        } else {
            print("Content server: not running (no roots configured)")
        }
    }
}
