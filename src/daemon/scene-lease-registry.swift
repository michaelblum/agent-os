import Foundation

enum AOSSceneLeaseAcquireResult: Equatable {
    case acquired(isNew: Bool)
    case busy
}

struct AOSSceneLeaseRoute: Equatable {
    let connectionID: UUID
    let ref: String?
}

final class AOSSceneLeaseRegistry {
    private let lock = NSLock()
    private var owners: [String: UUID] = [:]
    private var keysByConnection: [UUID: Set<String>] = [:]
    private var refs: [String: String] = [:]
    private var subscriptions: [String: Set<String>] = [:]

    func acquire(key: String, connectionID: UUID, ref: String?) -> AOSSceneLeaseAcquireResult {
        lock.lock()
        defer { lock.unlock() }
        if let owner = owners[key], owner != connectionID { return .busy }
        let isNew = owners[key] == nil
        owners[key] = connectionID
        if let ref { refs[key] = ref }
        keysByConnection[connectionID, default: []].insert(key)
        return .acquired(isNew: isNew)
    }

    @discardableResult
    func release(key: String, connectionID: UUID) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard owners[key] == connectionID else { return false }
        owners.removeValue(forKey: key)
        refs.removeValue(forKey: key)
        subscriptions.removeValue(forKey: key)
        keysByConnection[connectionID]?.remove(key)
        if keysByConnection[connectionID]?.isEmpty == true {
            keysByConnection.removeValue(forKey: connectionID)
        }
        return true
    }

    func releaseAll(connectionID: UUID) -> [String] {
        lock.lock()
        defer { lock.unlock() }
        let keys = keysByConnection.removeValue(forKey: connectionID) ?? []
        for key in keys where owners[key] == connectionID {
            owners.removeValue(forKey: key)
            refs.removeValue(forKey: key)
            subscriptions.removeValue(forKey: key)
        }
        return keys.sorted()
    }

    func updateSubscriptions(
        key: String,
        connectionID: UUID,
        adding: Set<String> = [],
        removing: Set<String> = [],
        removeAll: Bool = false
    ) -> Set<String>? {
        lock.lock()
        defer { lock.unlock() }
        guard owners[key] == connectionID else { return nil }
        var events = subscriptions[key] ?? []
        if removeAll { events.removeAll() }
        events.formUnion(adding)
        events.subtract(removing)
        subscriptions[key] = events
        return events
    }

    func routeResult(key: String) -> AOSSceneLeaseRoute? {
        lock.lock()
        defer { lock.unlock() }
        guard let connectionID = owners[key] else { return nil }
        return AOSSceneLeaseRoute(connectionID: connectionID, ref: refs[key])
    }

    func routeEvent(key: String, event: String) -> AOSSceneLeaseRoute? {
        lock.lock()
        defer { lock.unlock() }
        guard subscriptions[key]?.contains(event) == true,
              let connectionID = owners[key] else { return nil }
        return AOSSceneLeaseRoute(connectionID: connectionID, ref: refs[key])
    }

    func snapshot() -> [String: Any] {
        lock.lock()
        defer { lock.unlock() }
        return [
            "leases": owners.keys.sorted(),
            "subscriptions": subscriptions
                .filter { !$0.value.isEmpty }
                .mapValues { $0.sorted() },
        ]
    }
}
