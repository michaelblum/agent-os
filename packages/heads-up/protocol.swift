// heads-up — JSON protocol types for daemon IPC
// Newline-delimited JSON over Unix socket.

import Foundation

// MARK: - Request (CLI → Daemon)

struct CanvasRequest: Codable {
    let action: String          // "create", "update", "remove", "remove-all", "list", "ping", "eval"
    var id: String?             // canvas ID (required for create/update/remove)
    var at: [CGFloat]?          // [x, y, w, h] in global CG coords (Y-down)
    var anchorWindow: Int?      // CGWindowID to track
    var offset: [CGFloat]?      // [x, y, w, h] relative to anchored window (LCS)
    var html: String?           // HTML content (resolved by client)
    var url: String?            // URL for WKWebView to load directly
    var interactive: Bool?      // override click-through (default: false)
    var ttl: Double?            // seconds until auto-remove (nil = no expiry)
    var js: String?             // JavaScript to evaluate (for "eval" action)
}

// MARK: - Response (Daemon → CLI)

struct CanvasResponse: Codable {
    var status: String?         // "success" on success
    var error: String?          // error message on failure
    var code: String?           // machine-readable error code
    var canvases: [CanvasInfo]? // populated by "list" action
    var result: String?         // JS eval return value (for "eval" action)
    var uptime: Double?         // daemon uptime in seconds (for "ping" action)
}

struct CanvasInfo: Codable {
    let id: String
    var at: [CGFloat]           // current [x, y, w, h] in CG coords
    var anchorWindow: Int?
    var offset: [CGFloat]?
    var interactive: Bool
    var ttl: Double?            // remaining seconds until expiry (nil = no expiry)
}

// MARK: - Encode/Decode Helpers

extension CanvasRequest {
    static func from(_ data: Data) -> CanvasRequest? {
        return try? JSONDecoder().decode(CanvasRequest.self, from: data)
    }

    func toData() -> Data? {
        let enc = JSONEncoder()
        enc.outputFormatting = .sortedKeys
        return try? enc.encode(self)
    }
}

extension CanvasResponse {
    static func ok() -> CanvasResponse {
        return CanvasResponse(status: "success")
    }

    static func fail(_ message: String, code: String) -> CanvasResponse {
        return CanvasResponse(error: message, code: code)
    }

    func toData() -> Data? {
        let enc = JSONEncoder()
        enc.outputFormatting = .sortedKeys
        return try? enc.encode(self)
    }

    static func from(_ data: Data) -> CanvasResponse? {
        return try? JSONDecoder().decode(CanvasResponse.self, from: data)
    }
}
