// coordination.swift — Daemon coordination bus: sessions, channels, messages

import Foundation

/// In-memory coordination bus for agent communication.
/// Sessions register presence; messages flow through channels.
/// All state is ephemeral — cleared on daemon restart.
class CoordinationBus {
    private let lock = NSLock()

    // Sessions: name → SessionInfo
    private var sessions: [String: SessionInfo] = [:]

    // Messages: channel → [Message] (append-only, bounded)
    private var channels: [String: [ChannelMessage]] = [:]

    private let maxMessagesPerChannel = 1000

    struct SessionInfo {
        let name: String
        let role: String
        let harness: String
        let registeredAt: Date
        var lastHeartbeat: Date
    }

    struct ChannelMessage {
        let id: String        // UUID
        let channel: String
        let from: String      // session name or "cli"
        let payload: Any      // JSON-compatible
        let createdAt: Double // timeIntervalSince1970
    }

    // MARK: - Sessions

    func registerSession(name: String, role: String, harness: String) -> [String: Any] {
        lock.lock()
        defer { lock.unlock() }
        let now = Date()
        sessions[name] = SessionInfo(
            name: name, role: role, harness: harness,
            registeredAt: now, lastHeartbeat: now
        )
        return [
            "status": "ok",
            "name": name,
            "registered_at": now.timeIntervalSince1970
        ]
    }

    func heartbeat(name: String) -> [String: Any] {
        lock.lock()
        defer { lock.unlock() }
        guard sessions[name] != nil else {
            return ["error": "Session not found: \(name)", "code": "SESSION_NOT_FOUND"]
        }
        sessions[name]?.lastHeartbeat = Date()
        return ["status": "ok"]
    }

    func whoIsOnline() -> [[String: Any]] {
        lock.lock()
        defer { lock.unlock() }
        return sessions.values.map { s in
            [
                "name": s.name,
                "role": s.role,
                "harness": s.harness,
                "registered_at": s.registeredAt.timeIntervalSince1970,
                "last_heartbeat": s.lastHeartbeat.timeIntervalSince1970
            ] as [String: Any]
        }
    }

    func unregisterSession(name: String) -> [String: Any] {
        lock.lock()
        defer { lock.unlock() }
        if sessions.removeValue(forKey: name) == nil {
            return ["error": "Session not found: \(name)", "code": "SESSION_NOT_FOUND"]
        }
        return ["status": "ok", "name": name]
    }

    func sessionExists(_ name: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return sessions[name] != nil
    }

    // MARK: - Messages

    /// Post a message to a channel. Returns the message.
    func postMessage(channel: String, from: String, payload: Any) -> ChannelMessage {
        lock.lock()
        defer { lock.unlock() }
        let msg = ChannelMessage(
            id: UUID().uuidString,
            channel: channel,
            from: from,
            payload: payload,
            createdAt: Date().timeIntervalSince1970
        )
        if channels[channel] == nil {
            channels[channel] = []
        }
        channels[channel]!.append(msg)
        // Trim to max size
        if channels[channel]!.count > maxMessagesPerChannel {
            channels[channel] = Array(channels[channel]!.suffix(maxMessagesPerChannel))
        }
        return msg
    }

    /// Read messages from a channel, optionally since a given message ID.
    func readMessages(channel: String, since: String? = nil, limit: Int = 50) -> [[String: Any]] {
        lock.lock()
        defer { lock.unlock() }
        guard let msgs = channels[channel] else { return [] }

        var filtered = msgs
        if let sinceID = since, let idx = msgs.firstIndex(where: { $0.id == sinceID }) {
            filtered = Array(msgs.suffix(from: msgs.index(after: idx)))
        }
        return filtered.suffix(limit).map { m in
            [
                "id": m.id,
                "channel": m.channel,
                "from": m.from,
                "payload": m.payload,
                "created_at": m.createdAt
            ] as [String: Any]
        }
    }

    /// List known channels with message counts.
    func listChannels() -> [[String: Any]] {
        lock.lock()
        defer { lock.unlock() }
        return channels.map { (name, msgs) in
            ["channel": name, "count": msgs.count] as [String: Any]
        }
    }
}
