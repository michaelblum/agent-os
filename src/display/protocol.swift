// display — JSON protocol types for daemon IPC
// Newline-delimited JSON over Unix socket.

import Foundation

enum JSONValue: Codable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            self = .object(try container.decode([String: JSONValue].self))
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }

    init?(_ value: Any) {
        switch value {
        case let value as String:
            self = .string(value)
        case let value as Bool:
            self = .bool(value)
        case let value as Int:
            self = .number(Double(value))
        case let value as Double:
            guard value.isFinite else { return nil }
            self = .number(value)
        case let value as CGFloat:
            let number = Double(value)
            guard number.isFinite else { return nil }
            self = .number(number)
        case let value as [Any]:
            self = .array(value.compactMap { JSONValue($0) })
        case let value as [String: Any]:
            var object: [String: JSONValue] = [:]
            for (key, entry) in value {
                if let converted = JSONValue(entry) {
                    object[key] = converted
                }
            }
            self = .object(object)
        default:
            if value is NSNull {
                self = .null
            } else {
                return nil
            }
        }
    }

    var anyValue: Any {
        switch self {
        case .string(let value): return value
        case .number(let value): return value
        case .bool(let value): return value
        case .object(let value): return value.mapValues { $0.anyValue }
        case .array(let value): return value.map { $0.anyValue }
        case .null: return NSNull()
        }
    }

    var objectValue: [String: JSONValue]? {
        if case .object(let value) = self { return value }
        return nil
    }
}

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
//   aos show create --id approval --at 400,300,300,150 --interactive --html '
//     <button onclick="headsup({action:\"approved\"})">Approve</button>
//     <button onclick="headsup({action:\"rejected\"})">Reject</button>'
//
// --- Action Menu ---
// A list of actions the user can click. Each button sends a different action
// string. The orchestrator receives the chosen action via messageHandler.
//
//   aos show create --id menu --at 500,200,200,300 --interactive --html '
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
//   aos show create --id stop --at 50,50,80,40 --interactive --ttl 30s --html '
//     <button onclick="headsup({action:\"stop\"})">Stop</button>'
//
// --- Status Dashboard (non-interactive) ---
// A read-only display updated via eval. The agent pushes state updates
// from the host side. No messageHandler needed.
//
//   aos show create --id status --at 100,100,400,200 --html '
//     <div id="state">Initializing...</div>
//     <script>function setState(s){document.getElementById("state").textContent=s;}</script>'
//   aos show eval --id status --js "setState('Processing step 3 of 5')"
//   aos show eval --id status --js "setState('Complete')"
//

// MARK: - Request (CLI → Daemon)

struct CanvasRequest: Codable {
    let action: String          // "create", "update", "remove", "remove-all", "list", "ping", "eval", "subscribe", "post"
    var id: String?             // canvas ID (required for create/update/remove/post)
    var at: [CGFloat]?          // [x, y, w, h] in global CG coords (Y-down)
    var anchorWindow: Int?      // CGWindowID to track
    var anchorChannel: String?  // focus channel ID — reads channel file, sets anchorWindow from target.window_id
    var offset: [CGFloat]?      // [x, y, w, h] relative to anchored window (LCS)
    var html: String?           // HTML content (resolved by client)
    var url: String?            // URL for WKWebView to load directly
    var interactive: Bool?      // override click-through (default: false)
    var windowLevel: String?    // native window layer: automatic, floating, status_bar, screen_saver
    var focus: Bool?            // activate app + make window key; on create, also eval focusInput() after page ready
    var ttl: Double?            // seconds until auto-remove (nil = no expiry)
    var js: String?             // JavaScript to evaluate (for "eval" action)
    var scope: String?          // "connection" or "global" (default: global)
    var autoProject: String?    // auto-projection mode: "cursor_trail", "highlight_focused", "label_elements"
    var track: String?          // tracking target (e.g. "union") — bounds auto-resolve + auto-update
    var surface: String?        // surface target (e.g. "desktop-world") — canvas placement surface
    var parent: String?         // parent canvas ID (nil = infer from source canvas)
    var cascade: Bool?          // lifecycle cascade from parent (default true; false = survive parent suspend/remove)
    var suspended: Bool?        // create hidden/suspended without showing a window first
    var channel: String?        // channel name (legacy relay path for "post" action)
    var data: String?           // JSON string payload (for "post" action)
    var owner: CanvasOwnerInfo? = nil // optional caller/session metadata for daemon-owned resources
    var geometryChange: String? = nil // canvas_geometry change: origin, size, frame
    var geometryCause: String? = nil  // canvas_geometry cause, e.g. placement.drag
    var geometryPhase: String? = nil  // canvas_geometry phase: start, update, settled, cancelled
    var geometryTransactionID: String? = nil // stable across a geometry sequence
    var geometry: [String: JSONValue]? = nil // structured canvas_geometry metadata

    enum CodingKeys: String, CodingKey {
        case action, id, at, offset, html, url, interactive, focus, ttl, js, scope
        case windowLevel = "window_level"
        case anchorWindow = "anchor_window"
        case anchorChannel = "anchor_channel"
        case autoProject = "auto_project"
        case track, surface, parent, cascade, suspended, channel, data, owner
        case geometryChange = "geometry_change"
        case geometryCause = "geometry_cause"
        case geometryPhase = "geometry_phase"
        case geometryTransactionID = "geometry_transaction_id"
        case geometry
    }
}

// MARK: - Response (Daemon → CLI)

struct CanvasOwnerInfo: Codable, Equatable {
    let consumerID: String
    let harness: String
    let pid: Int
    let cwd: String
    let worktreeRoot: String?
    let runtimeMode: String

    enum CodingKeys: String, CodingKey {
        case consumerID = "consumer_id"
        case harness
        case pid
        case cwd
        case worktreeRoot = "worktree_root"
        case runtimeMode = "runtime_mode"
    }
}

extension CanvasOwnerInfo {
    static func currentCLI() -> CanvasOwnerInfo {
        let cwd = FileManager.default.currentDirectoryPath
        return CanvasOwnerInfo(
            consumerID: aosCurrentSessionKey(),
            harness: aosCurrentSessionHarness(),
            pid: Int(getpid()),
            cwd: cwd,
            worktreeRoot: aosRepoRootFromBases([cwd]),
            runtimeMode: aosCurrentRuntimeMode().rawValue
        )
    }

    func dictionary() -> [String: Any]? {
        guard let data = try? JSONEncoder().encode(self),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        return object
    }
}

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
    var url: String?              // URL loaded into the canvas, if URL-backed
    var at: [CGFloat]           // current [x, y, w, h] in CG coords
    var requestedFrame: [CGFloat]? // last requested/desired [x, y, w, h] in CG coords
    var placement: [String: JSONValue]? // toolkit placement contract metadata
    var anchorWindow: Int?
    var anchorChannel: String?
    var offset: [CGFloat]?
    var interactive: Bool
    var windowLevel: String?
    var ttl: Double?            // remaining seconds until expiry (nil = no expiry)
    var scope: String?          // "connection" or "global"
    var autoProject: String?
    var track: String?          // tracking target if any
    var parent: String?         // parent canvas ID (nil if root)
    var cascade: Bool?          // lifecycle cascade flag
    var suspended: Bool?        // true if canvas is suspended (hidden + paused)
    var lifecycleState: String? // "active", "warm_suspended", "suspended", or "removed"
    var windowNumbers: [Int]?   // native window numbers backing this canvas
    var segments: [DesktopWorldSurfaceSegment]?  // present for DesktopWorldSurface canvases
    var owner: CanvasOwnerInfo? // optional caller/session metadata that created the canvas
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

    /// Initialize from a parsed JSON dictionary (envelope or legacy shape).
    static func fromDict(_ dict: [String: Any]) -> CanvasResponse {
        var out = CanvasResponse()
        // Accept both legacy ({status:"ok",...}) and envelope ({v:1,status:"success",data:{...}})
        let body: [String: Any] = (dict["data"] as? [String: Any]) ?? dict
        out.status = body["status"] as? String ?? (dict["status"] as? String)
        out.error = body["error"] as? String ?? (dict["error"] as? String)
        out.code = body["code"] as? String ?? (dict["code"] as? String)
        out.result = body["result"] as? String
        out.uptime = body["uptime"] as? Double
        if let arr = body["canvases"] as? [[String: Any]] {
            // Decode via JSONSerialization round-trip
            if let data = try? JSONSerialization.data(withJSONObject: arr, options: []) {
                out.canvases = try? JSONDecoder().decode([CanvasInfo].self, from: data)
            }
        }
        return out
    }
}
