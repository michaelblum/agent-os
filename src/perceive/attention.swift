// attention.swift — Attention envelope: manages what the daemon perceives

import Foundation

// MARK: - Perception Channel (one per subscriber request)

struct PerceptionChannel {
    let id: UUID
    let depth: Int          // 0-3
    let scope: String       // "cursor" (only scope for Phase 1)
    let rate: String        // "continuous", "on-change", "on-settle"
}

// MARK: - Attention Envelope

/// Tracks all active perception channels and computes what work the daemon must do.
class AttentionEnvelope {
    private var channels: [UUID: PerceptionChannel] = [:]
    private let lock = NSLock()

    /// Add a perception channel. Returns the channel ID.
    func addChannel(depth: Int, scope: String, rate: String) -> UUID {
        let channel = PerceptionChannel(id: UUID(), depth: depth, scope: scope, rate: rate)
        lock.lock()
        channels[channel.id] = channel
        lock.unlock()
        return channel.id
    }

    /// Remove a perception channel.
    func removeChannel(_ id: UUID) {
        lock.lock()
        channels.removeValue(forKey: id)
        lock.unlock()
    }

    /// Remove all channels for a given connection (identified by a set of channel IDs).
    func removeChannels(_ ids: Set<UUID>) {
        lock.lock()
        for id in ids { channels.removeValue(forKey: id) }
        lock.unlock()
    }

    /// The maximum depth any subscriber wants. Returns -1 if no subscribers.
    var maxDepth: Int {
        lock.lock()
        let result = channels.values.map(\.depth).max() ?? -1
        lock.unlock()
        return result
    }

    /// Whether any subscriber wants continuous cursor events.
    var wantsContinuousCursor: Bool {
        lock.lock()
        let result = channels.values.contains(where: { $0.rate == "continuous" })
        lock.unlock()
        return result
    }

    /// Whether any subscriber wants on-change events.
    var wantsOnChange: Bool {
        lock.lock()
        let result = channels.values.contains(where: { $0.rate == "on-change" || $0.rate == "continuous" })
        lock.unlock()
        return result
    }

    /// Whether any subscriber wants on-settle events (including depth 2+).
    var wantsOnSettle: Bool {
        lock.lock()
        let result = channels.values.contains(where: { $0.rate == "on-settle" || $0.depth >= 2 })
        lock.unlock()
        return result
    }

    /// Whether there are any active channels at all.
    var hasSubscribers: Bool {
        lock.lock()
        let result = !channels.isEmpty
        lock.unlock()
        return result
    }

    /// Snapshot of current channels for debugging.
    var channelCount: Int {
        lock.lock()
        let result = channels.count
        lock.unlock()
        return result
    }
}
