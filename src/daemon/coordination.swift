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
    // Internal (not private) so the daemon can hand the same store instance to
    // VoicePolicyWatcher; reload() then invalidates the cache that VoiceRegistry
    // reads through. See Task 11 / Task 17 for the cross-instance constraint.
    let voicePolicyStore: VoicePolicyStore
    private let voiceRegistry: VoiceRegistry
    private let voiceAllocator: VoiceAllocator

    // Sessions: canonical session_id → SessionInfo
    private var sessions: [String: SessionInfo] = [:]

    // Secondary lookup: human-readable name → canonical session_id
    private var sessionIDsByName: [String: String] = [:]

    // Messages: channel → [Message] (append-only, bounded)
    private var channels: [String: [ChannelMessage]] = [:]

    private let maxMessagesPerChannel = 1000

    init(
        sessionsPath: String = aosCoordinationSessionsPath(),
        voicePolicyStore: VoicePolicyStore = VoicePolicyStore(),
        voiceRegistry: VoiceRegistry? = nil,
        voiceAllocator: VoiceAllocator = VoiceAllocator(),
        sessionExpiryInterval: TimeInterval = 24 * 60 * 60
    ) {
        self.sessionsPath = sessionsPath
        self.voicePolicyStore = voicePolicyStore
        self.voiceRegistry = voiceRegistry ?? VoiceRegistry(policyLoader: { voicePolicyStore.load() })
        self.voiceAllocator = voiceAllocator
        self.sessionExpiryInterval = sessionExpiryInterval
        voicePolicyStore.migrateLegacyAssignmentsIfNeeded()
        restoreSessionsSnapshot()
        seedAllocatorAfterRestore()
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
        var voice: SessionVoiceDescriptor?
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
        let existingSession = sessions[sessionID]
        let registeredAt = existingSession?.registeredAt ?? now
        let existingVoice = existingSession?.voice

        if let oldName = existingSession?.name, oldName != normalizedName {
            sessionIDsByName.removeValue(forKey: oldName)
        }

        let assignedVoice = assignVoiceLocked(existingVoice: existingVoice, excludingSessionID: sessionID)

        sessions[sessionID] = SessionInfo(
            sessionID: sessionID,
            name: normalizedName,
            role: role,
            harness: harness,
            registeredAt: registeredAt,
            lastHeartbeat: now,
            voice: assignedVoice
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
        if let voice = sessions[sessionID]?.voice {
            response["voice"] = voice.dictionary()
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
                if let voice = s.voice {
                    session["voice"] = voice.dictionary()
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
        if let voice = removed.voice {
            response["voice"] = voice.dictionary()
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
        if let voice = session.voice {
            payload["voice"] = voice.dictionary()
        }
        return payload
    }

    func sessionDisplayName(sessionID: String) -> String? {
        lock.lock()
        defer { lock.unlock() }
        pruneExpiredSessionsLocked()
        return sessions[sessionID]?.name ?? sessions[sessionID]?.sessionID
    }

    func voiceCatalog() -> [[String: Any]] {
        lock.lock()
        defer { lock.unlock() }
        pruneExpiredSessionsLocked()
        let snap = voiceRegistry.snapshot()
        let assignmentsByURI: [String: [String]] = sessions.reduce(into: [:]) { acc, kv in
            if let uri = kv.value.voice?.id {
                acc[uri, default: []].append(kv.key)
            }
        }
        return snap.map { rec in
            var dict = rec.dictionary()
            dict["current_session_ids"] = (assignmentsByURI[rec.id] ?? []).sorted()
            return dict
        }
    }

    func voiceAssignments() -> [[String: Any]] {
        lock.lock()
        defer { lock.unlock() }
        pruneExpiredSessionsLocked()
        return sessions
            .sorted { $0.value.registeredAt < $1.value.registeredAt }
            .map { (sid, info) -> [String: Any] in
                var entry: [String: Any] = [
                    "session_id": sid,
                    "role": info.role,
                    "harness": info.harness,
                    "voice": info.voice.map { v -> Any in
                        voiceRegistry.lookup(v.id)?.dictionary() ?? NSNull()
                    } ?? NSNull()
                ]
                if let name = info.name { entry["name"] = name }
                return entry
            }
    }

    func voiceLeases() -> [[String: Any]] {
        fputs("Deprecation: aos voice leases is now aos voice assignments\n", stderr)
        return voiceAssignments()
    }

    func voiceRefresh() -> [[String: Any]] {
        lock.lock()
        defer { lock.unlock() }
        let snap = voiceRegistry.refresh()
        let allocatable = snap.filter { $0.isAllocatable }.map { $0.id }
        voiceAllocator.reseed(uris: allocatable)
        return snap.map { $0.dictionary() }
    }

    func voiceProviders() -> [[String: Any]] {
        lock.lock()
        defer { lock.unlock() }
        return voiceRegistry.providersInfo().map { $0.dictionary() }
    }

    func voiceLookup(id: String) -> VoiceRecord? {
        let canonical = VoiceID.canonicalize(id)
        return voiceRegistry.lookup(canonical)
    }

    func bindVoice(sessionID: String, voiceID: String) -> [String: Any] {
        lock.lock()
        defer { lock.unlock() }
        pruneExpiredSessionsLocked()

        let canonical = VoiceID.canonicalize(voiceID)
        guard let record = voiceRegistry.lookup(canonical) else {
            return ["error": ["code": "VOICE_NOT_FOUND", "message": "voice not found in registry: \(canonical)"]]
        }
        if !record.capabilities.speak_supported {
            return ["error": ["code": "VOICE_NOT_SPEAKABLE", "message": "voice cannot synthesize in this version: \(canonical)"]]
        }
        if !record.availability.allocatable {
            return ["error": ["code": "VOICE_NOT_ALLOCATABLE", "message": "voice not allocatable (enabled/installed/reachable check failed): \(canonical)"]]
        }
        voicePolicyStore.setPreferred(sessionID: sessionID, voiceURI: canonical)
        voiceAllocator.markUsed(canonical)
        let descriptor = SessionVoiceDescriptor(record: record)
        if var info = sessions[sessionID] {
            info.voice = descriptor
            sessions[sessionID] = info
            persistSessionsLocked()
        }
        return [
            "status": "ok",
            "session_id": sessionID,
            "voice": record.dictionary()
        ]
    }

    func handlePolicyReload(_ policy: VoicePolicy) {
        lock.lock()
        defer { lock.unlock() }
        // The watcher already called `voicePolicyStore.reload()` on the same
        // instance VoiceRegistry's policyLoader uses, so allocatableSnapshot()
        // here resolves against the freshly-loaded policy. The `policy`
        // argument is provided for future hooks (e.g. emitting a diff event)
        // but is not required to drive reseed.
        _ = policy
        let allocatable = voiceRegistry.allocatableSnapshot().map { $0.id }
        voiceAllocator.reseed(uris: allocatable)
        // Do NOT auto-reassign live sessions; they keep their current descriptor
        // until they re-register or a new explicit bind happens.
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

    private func seedAllocatorAfterRestore() {
        let allocatableURIs = voiceRegistry.allocatableSnapshot().map { $0.id }
        voiceAllocator.seed(uris: allocatableURIs)
        // Spec Section 5: restore order is (registered_at ASC, session_id ASC).
        // Tiebreak on sessionID keeps reseed deterministic when two sessions
        // share a timestamp (common in fixture data + fast bulk registration).
        let restored = sessions
            .compactMap { (sid, info) -> (sessionID: String, voiceURI: String, registeredAt: Date)? in
                guard let voice = info.voice else { return nil }
                return (sessionID: sid, voiceURI: voice.id, registeredAt: info.registeredAt)
            }
            .sorted {
                if $0.registeredAt != $1.registeredAt { return $0.registeredAt < $1.registeredAt }
                return $0.sessionID < $1.sessionID
            }
        for entry in restored {
            voiceAllocator.markUsed(VoiceID.canonicalize(entry.voiceURI))
        }
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
                if let voice = session.voice {
                    payload["voice"] = voice.dictionary()
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
            let restored = restoredVoice(payload["voice"])

            restoredSessions[sessionID] = SessionInfo(
                sessionID: sessionID,
                name: normalizedName,
                role: role,
                harness: harness,
                registeredAt: registeredAt,
                lastHeartbeat: lastHeartbeat,
                voice: restored
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

    private func assignVoiceLocked(existingVoice: SessionVoiceDescriptor?, excludingSessionID sid: String) -> SessionVoiceDescriptor? {
        if let existingVoice {
            // Session is being re-registered with a known voice; reaffirm cooldown.
            voiceAllocator.markUsed(existingVoice.id)
            return existingVoice
        }

        // Apply stored preference only if record is fully allocatable.
        if let preferredURI = voicePolicyStore.preferred(sessionID: sid) {
            let canonical = VoiceID.canonicalize(preferredURI)
            if let record = voiceRegistry.lookup(canonical), record.isAllocatable {
                voiceAllocator.markUsed(canonical)
                return SessionVoiceDescriptor(record: record)
            } else {
                emitVoiceEvent([
                    "kind": "preference_skipped",
                    "session_id": sid,
                    "voice_id": canonical,
                    "reason": preferenceSkipReason(canonical)
                ])
            }
        }

        guard let chosenURI = voiceAllocator.next(),
              let record = voiceRegistry.lookup(chosenURI) else {
            return nil
        }
        return SessionVoiceDescriptor(record: record)
    }

    private func preferenceSkipReason(_ uri: String) -> String {
        guard let record = voiceRegistry.lookup(uri) else { return "voice_not_found" }
        if !record.capabilities.speak_supported { return "voice_not_speakable" }
        if !record.availability.allocatable { return "voice_not_allocatable" }
        return "unknown"
    }

    private func emitVoiceEvent(_ event: [String: Any]) {
        let path = aosVoiceEventsPath()
        let dir = (path as NSString).deletingLastPathComponent
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true, attributes: nil)
        var payload = event
        payload["timestamp"] = ISO8601DateFormatter().string(from: Date())
        if let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]),
           let line = String(data: data, encoding: .utf8) {
            if let handle = FileHandle(forWritingAtPath: path) ?? {
                _ = FileManager.default.createFile(atPath: path, contents: nil)
                return FileHandle(forWritingAtPath: path)
            }() {
                handle.seekToEndOfFile()
                handle.write((line + "\n").data(using: .utf8)!)
                try? handle.close()
            }
        }
    }

    private func restoredVoice(_ rawValue: Any?) -> SessionVoiceDescriptor? {
        guard let payload = rawValue as? [String: Any],
              let id = payload["id"] as? String,
              let record = voiceRegistry.lookup(VoiceID.canonicalize(id)) else {
            return nil
        }
        return SessionVoiceDescriptor(record: record)
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
