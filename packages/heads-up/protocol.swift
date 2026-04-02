// heads-up — JSON protocol types for daemon IPC
// Newline-delimited JSON over Unix socket.

import Foundation

// MARK: - Control Surface Patterns
//
// The combination of interactive canvases, eval (host->content), and
// messageHandler relay (content->host) provides full-duplex communication
// for building control surfaces. Below are the standard patterns.
//
// JS helper for all control surfaces:
//   function headsup(action) {
//     window.webkit.messageHandlers.headsup.postMessage({action: action});
//   }
//
// --- Approval Dialog ---
// A blocking confirmation dialog. Agent creates an interactive canvas with
// accept/reject buttons. The messageHandler fires "approved" or "rejected"
// back to the orchestrator, which reads the response and removes the canvas.
//
//   heads-up create --id approval --at 400,300,300,150 --interactive --html '
//     <button onclick="headsup({action:\"approved\"})">Approve</button>
//     <button onclick="headsup({action:\"rejected\"})">Reject</button>'
//
// --- Action Menu ---
// A list of actions the user can click. Each button sends a different action
// string. The orchestrator receives the chosen action via messageHandler.
//
//   heads-up create --id menu --at 500,200,200,300 --interactive --html '
//     <div class="menu">
//       <div onclick="headsup({action:\"copy\"})">Copy</div>
//       <div onclick="headsup({action:\"paste\"})">Paste</div>
//       <div onclick="headsup({action:\"delete\"})">Delete</div>
//     </div>'
//
// --- Stop Button ---
// A single button that signals the agent to halt the current operation.
// Typically placed in a corner with a TTL as a safety net.
//
//   heads-up create --id stop --at 50,50,80,40 --interactive --ttl 30s --html '
//     <button onclick="headsup({action:\"stop\"})">Stop</button>'
//
// --- Status Dashboard (non-interactive) ---
// A read-only display updated via eval. The agent pushes state updates
// from the host side. No messageHandler needed.
//
//   heads-up create --id status --at 100,100,400,200 --html '
//     <div id="state">Initializing...</div>
//     <script>function setState(s){document.getElementById("state").textContent=s;}</script>'
//   heads-up eval --id status --js "setState('Processing step 3 of 5')"
//   heads-up eval --id status --js "setState('Complete')"
//

// MARK: - Request (CLI → Daemon)

struct CanvasRequest: Codable {
    let action: String          // "create", "update", "remove", "remove-all", "list", "ping", "eval", "subscribe"
    var id: String?             // canvas ID (required for create/update/remove)
    var at: [CGFloat]?          // [x, y, w, h] in global CG coords (Y-down)
    var anchorWindow: Int?      // CGWindowID to track
    var anchorChannel: String?  // focus channel ID — reads channel file, sets anchorWindow from target.window_id
    var offset: [CGFloat]?      // [x, y, w, h] relative to anchored window (LCS)
    var html: String?           // HTML content (resolved by client)
    var url: String?            // URL for WKWebView to load directly
    var interactive: Bool?      // override click-through (default: false)
    var ttl: Double?            // seconds until auto-remove (nil = no expiry)
    var js: String?             // JavaScript to evaluate (for "eval" action)
    var scope: String?          // "connection" or "global" (default: global)
    var autoProject: String?    // auto-projection mode: "cursor_trail", "highlight_focused", "label_elements"
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
    var anchorChannel: String?
    var offset: [CGFloat]?
    var interactive: Bool
    var ttl: Double?            // remaining seconds until expiry (nil = no expiry)
    var scope: String?          // "connection" or "global"
    var autoProject: String?
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
