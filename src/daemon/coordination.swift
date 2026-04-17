// coordination.swift — Daemon coordination bus: sessions, channels, messages

import Foundation

/// In-memory coordination bus for agent communication.
/// Sessions register presence; messages flow through channels.
/// Session presence is mirrored into the runtime state dir so repo-local
/// commands can inspect canonical session ids without inventing a new store.
class CoordinationBus {
    private let lock = NSLock()
    private let sessionsPath: String
    private let sessionExpiryInterval: TimeInterval

    // Sessions: canonical session_id → SessionInfo
    private var sessions: [String: SessionInfo] = [:]

    // Secondary lookup: human-readable name → canonical session_id
    private var sessionIDsByName: [String: String] = [:]

    // Messages: channel → [Message] (append-only, bounded)
    private var channels: [String: [ChannelMessage]] = [:]

    private let maxMessagesPerChannel = 1000

    init(sessionsPath: String = aosCoordinationSessionsPath(), sessionExpiryInterval: TimeInterval = 24 * 60 * 60) {
        self.sessionsPath = sessionsPath
        self.sessionExpiryInterval = sessionExpiryInterval
        restoreSessionsSnapshot()
        pruneExpiredSessionsLocked()
        persistSessionsLocked()
    }

    struct SessionInfo {
        let sessionID: String
        var name: String?
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

    func registerSession(sessionID: String, name: String?, role: String, harness: String) -> [String: Any] {
        lock.lock()
        defer { lock.unlock() }
        let now = Date()
        pruneExpiredSessionsLocked(now: now)
        let normalizedName = normalizeName(name)
        let registeredAt = sessions[sessionID]?.registeredAt ?? now

        if let oldName = sessions[sessionID]?.name, oldName != normalizedName {
            sessionIDsByName.removeValue(forKey: oldName)
        }

        sessions[sessionID] = SessionInfo(
            sessionID: sessionID,
            name: normalizedName,
            role: role,
            harness: harness,
            registeredAt: registeredAt,
            lastHeartbeat: now
        )

        if let normalizedName {
            sessionIDsByName[normalizedName] = sessionID
        }

        persistSessionsLocked()

        var response: [String: Any] = [
            "status": "ok",
            "session_id": sessionID,
            "registered_at": now.timeIntervalSince1970
        ]
        if let normalizedName {
            response["name"] = normalizedName
        }
        return response
    }

    func heartbeat(sessionID: String) -> [String: Any] {
        lock.lock()
        defer { lock.unlock() }
        pruneExpiredSessionsLocked()
        guard sessions[sessionID] != nil else {
            return ["error": "Session not found: \(sessionID)", "code": "SESSION_NOT_FOUND"]
        }
        sessions[sessionID]?.lastHeartbeat = Date()
        persistSessionsLocked()
        return ["status": "ok"]
    }

    func whoIsOnline() -> [[String: Any]] {
        lock.lock()
        defer { lock.unlock() }
        pruneExpiredSessionsLocked()
        return sessions.values
            .sorted { lhs, rhs in
                if lhs.registeredAt != rhs.registeredAt {
                    return lhs.registeredAt < rhs.registeredAt
                }
                return lhs.sessionID < rhs.sessionID
            }
            .map { s in
                var session: [String: Any] = [
                    "session_id": s.sessionID,
                    "channel": s.sessionID,
                    "role": s.role,
                    "harness": s.harness,
                    "registered_at": s.registeredAt.timeIntervalSince1970,
                    "last_heartbeat": s.lastHeartbeat.timeIntervalSince1970
                ]
                if let name = s.name {
                    session["name"] = name
                }
                return session
        }
    }

    func unregisterSession(sessionID: String? = nil, name: String? = nil) -> [String: Any] {
        lock.lock()
        defer { lock.unlock() }
        pruneExpiredSessionsLocked()
        guard let resolvedSessionID = resolveSessionID(sessionID: sessionID, name: name),
              let removed = sessions.removeValue(forKey: resolvedSessionID) else {
            let missingHandle = sessionID ?? name ?? "unknown"
            return ["error": "Session not found: \(missingHandle)", "code": "SESSION_NOT_FOUND"]
        }
        if let removedName = removed.name {
            sessionIDsByName.removeValue(forKey: removedName)
        }
        persistSessionsLocked()

        var response: [String: Any] = [
            "status": "ok",
            "session_id": resolvedSessionID
        ]
        if let removedName = removed.name {
            response["name"] = removedName
        }
        return response
    }

    func sessionExists(_ sessionID: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        pruneExpiredSessionsLocked()
        return sessions[sessionID] != nil
    }

    func sessionInfo(sessionID: String) -> [String: Any]? {
        lock.lock()
        defer { lock.unlock() }
        pruneExpiredSessionsLocked()
        guard let session = sessions[sessionID] else { return nil }
        var payload: [String: Any] = [
            "session_id": session.sessionID,
            "channel": session.sessionID,
            "role": session.role,
            "harness": session.harness
        ]
        if let name = session.name {
            payload["name"] = name
        }
        return payload
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

    private func resolveSessionID(sessionID: String?, name: String?) -> String? {
        if let sessionID, sessions[sessionID] != nil {
            return sessionID
        }
        if let normalizedName = normalizeName(name) {
            return sessionIDsByName[normalizedName]
        }
        return nil
    }

    private func normalizeName(_ name: String?) -> String? {
        guard let trimmed = name?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty else {
            return nil
        }
        return trimmed
    }

    private func persistSessionsLocked() {
        persistSessionsSnapshot(
            sessions.values.map { session in
                var payload: [String: Any] = [
                    "session_id": session.sessionID,
                    "channel": session.sessionID,
                    "role": session.role,
                    "harness": session.harness,
                    "registered_at": session.registeredAt.timeIntervalSince1970,
                    "last_heartbeat": session.lastHeartbeat.timeIntervalSince1970
                ]
                if let name = session.name {
                    payload["name"] = name
                }
                return payload
            }.sorted {
                let lhs = $0["session_id"] as? String ?? ""
                let rhs = $1["session_id"] as? String ?? ""
                return lhs < rhs
            }
        )
    }

    private func persistSessionsSnapshot(_ snapshot: [[String: Any]]) {
        let fm = FileManager.default
        let directory = (sessionsPath as NSString).deletingLastPathComponent
        try? fm.createDirectory(atPath: directory, withIntermediateDirectories: true, attributes: nil)

        guard let data = try? JSONSerialization.data(withJSONObject: ["sessions": snapshot], options: [.sortedKeys]) else {
            return
        }

        let tmp = sessionsPath + ".tmp"
        do {
            try data.write(to: URL(fileURLWithPath: tmp), options: .atomic)
            if fm.fileExists(atPath: sessionsPath) {
                try? fm.removeItem(atPath: sessionsPath)
            }
            try fm.moveItem(atPath: tmp, toPath: sessionsPath)
        } catch {
            try? fm.removeItem(atPath: tmp)
        }
    }

    private func restoreSessionsSnapshot() {
        guard let data = FileManager.default.contents(atPath: sessionsPath),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let snapshot = root["sessions"] as? [[String: Any]] else {
            return
        }

        var restoredSessions: [String: SessionInfo] = [:]
        var restoredIDsByName: [String: String] = [:]

        for payload in snapshot {
            guard let sessionID = normalizeSessionID(payload["session_id"] as? String) else { continue }

            let normalizedName = normalizeName(payload["name"] as? String)
            let role = normalizeName(payload["role"] as? String) ?? "worker"
            let harness = normalizeName(payload["harness"] as? String) ?? "unknown"
            let registeredAt = dateValue(payload["registered_at"]) ?? Date()
            let lastHeartbeat = dateValue(payload["last_heartbeat"]) ?? registeredAt

            restoredSessions[sessionID] = SessionInfo(
                sessionID: sessionID,
                name: normalizedName,
                role: role,
                harness: harness,
                registeredAt: registeredAt,
                lastHeartbeat: lastHeartbeat
            )

            if let normalizedName {
                restoredIDsByName[normalizedName] = sessionID
            }
        }

        sessions = restoredSessions
        sessionIDsByName = restoredIDsByName
    }

    private func pruneExpiredSessionsLocked(now: Date = Date()) {
        guard sessionExpiryInterval > 0 else { return }
        let cutoff = now.addingTimeInterval(-sessionExpiryInterval)
        let expiredIDs = sessions.values
            .filter { $0.lastHeartbeat < cutoff }
            .map(\.sessionID)

        guard !expiredIDs.isEmpty else { return }

        for sessionID in expiredIDs {
            guard let removed = sessions.removeValue(forKey: sessionID) else { continue }
            if let removedName = removed.name {
                sessionIDsByName.removeValue(forKey: removedName)
            }
        }

        persistSessionsLocked()
    }

    private func normalizeSessionID(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty else {
            return nil
        }
        return trimmed
    }

    private func dateValue(_ rawValue: Any?) -> Date? {
        if let number = rawValue as? NSNumber {
            return Date(timeIntervalSince1970: number.doubleValue)
        }
        if let string = rawValue as? String, let parsed = Double(string) {
            return Date(timeIntervalSince1970: parsed)
        }
        return nil
    }
}
