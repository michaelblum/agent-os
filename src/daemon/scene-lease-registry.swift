import Foundation

enum AOSSceneLeaseAcquireResult: Equatable {
    case acquired(AOSSceneLeaseToken, isNew: Bool)
    case busy
}

struct AOSSceneLeaseRoute: Equatable {
    let connectionID: UUID
    let ref: String?
}

struct AOSSceneLeaseToken: Equatable {
    let key: String
    let generation: UInt64
    let route: AOSSceneLeaseRoute
}

struct AOSSceneLeaseInvalidation: Equatable {
    let key: String
    let route: AOSSceneLeaseRoute
}

final class AOSSceneLeaseRegistry {
    private let lock = NSLock()
    private var owners: [String: UUID] = [:]
    private var keysByConnection: [UUID: Set<String>] = [:]
    private var refs: [String: String] = [:]
    private var generations: [String: UInt64] = [:]
    private var operationTokens: [String: AOSSceneLeaseToken] = [:]
    private var closing: Set<String> = []
    private var subscriptions: [String: Set<String>] = [:]
    private var nextGeneration: UInt64 = 0

    func acquire(key: String, connectionID: UUID, ref: String?) -> AOSSceneLeaseAcquireResult {
        lock.lock()
        defer { lock.unlock() }
        if let owner = owners[key], owner != connectionID { return .busy }
        guard operationTokens[key] == nil, !closing.contains(key) else { return .busy }
        let isNew = owners[key] == nil
        nextGeneration &+= 1
        if nextGeneration == 0 { nextGeneration = 1 }
        owners[key] = connectionID
        generations[key] = nextGeneration
        if let ref { refs[key] = ref } else { refs.removeValue(forKey: key) }
        keysByConnection[connectionID, default: []].insert(key)
        return .acquired(
            AOSSceneLeaseToken(
                key: key,
                generation: nextGeneration,
                route: AOSSceneLeaseRoute(connectionID: connectionID, ref: ref)
            ),
            isNew: isNew
        )
    }

    /// Pins the exact lease generation and response ref to one in-flight
    /// operation. Admission remains closed until that operation settles.
    @discardableResult
    func beginOperation(_ token: AOSSceneLeaseToken, allowingClosing: Bool = false) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard operationTokens[token.key] == nil,
              currentToken(for: token.key) == token,
              allowingClosing || !closing.contains(token.key) else { return false }
        operationTokens[token.key] = token
        return true
    }

    /// Completes only the operation generation captured at admission. The
    /// returned route is immutable even if a later same-owner request exists.
    func operationToken(key: String) -> AOSSceneLeaseToken? {
        lock.lock()
        defer { lock.unlock() }
        return operationTokens[key]
    }

    @discardableResult
    func completeOperation(_ token: AOSSceneLeaseToken, releaseLease: Bool) -> AOSSceneLeaseRoute? {
        lock.lock()
        defer { lock.unlock() }
        guard operationTokens[token.key] == token else { return nil }
        operationTokens.removeValue(forKey: token.key)
        if releaseLease {
            removeLease(ifCurrent: token)
        }
        return token.route
    }

    /// Closes admission synchronously for every lease owned by a disconnecting
    /// connection. Existing operation tokens remain authoritative until their
    /// all-segment cleanup barrier completes.
    func beginDisconnect(connectionID: UUID) -> [AOSSceneLeaseToken] {
        lock.lock()
        defer { lock.unlock() }
        return (keysByConnection[connectionID] ?? []).sorted().compactMap { key in
            guard owners[key] == connectionID,
                  let token = operationTokens[key] ?? currentToken(for: key) else { return nil }
            closing.insert(key)
            return token
        }
    }

    @discardableResult
    func release(_ token: AOSSceneLeaseToken) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard operationTokens[token.key] == nil,
              currentToken(for: token.key) == token else { return false }
        removeLease(ifCurrent: token)
        return true
    }

    /// Invalidates the complete shared DesktopWorld lease set in one registry
    /// mutation. Callers retain the returned routes only to deliver bounded
    /// terminal failures after ownership has been revoked.
    func invalidateAll() -> [AOSSceneLeaseInvalidation] {
        lock.lock()
        defer { lock.unlock() }
        let invalidated = owners.compactMap { key, connectionID -> AOSSceneLeaseInvalidation? in
            guard let ref = refs[key] else {
                return AOSSceneLeaseInvalidation(
                    key: key,
                    route: AOSSceneLeaseRoute(connectionID: connectionID, ref: nil)
                )
            }
            return AOSSceneLeaseInvalidation(
                key: key,
                route: AOSSceneLeaseRoute(connectionID: connectionID, ref: ref)
            )
        }.sorted { $0.key < $1.key }
        owners.removeAll(keepingCapacity: false)
        keysByConnection.removeAll(keepingCapacity: false)
        refs.removeAll(keepingCapacity: false)
        generations.removeAll(keepingCapacity: false)
        operationTokens.removeAll(keepingCapacity: false)
        closing.removeAll(keepingCapacity: false)
        subscriptions.removeAll(keepingCapacity: false)
        return invalidated
    }

    var isEmpty: Bool {
        lock.lock()
        defer { lock.unlock() }
        return owners.isEmpty
    }

    func updateSubscriptions(
        token: AOSSceneLeaseToken,
        adding: Set<String> = [],
        removing: Set<String> = [],
        removeAll: Bool = false
    ) -> Set<String>? {
        lock.lock()
        defer { lock.unlock() }
        guard currentToken(for: token.key) == token,
              operationTokens[token.key] == nil,
              !closing.contains(token.key) else { return nil }
        var events = subscriptions[token.key] ?? []
        if removeAll { events.removeAll() }
        events.formUnion(adding)
        events.subtract(removing)
        subscriptions[token.key] = events
        return events
    }

    func routeEvent(key: String, event: String) -> AOSSceneLeaseRoute? {
        lock.lock()
        defer { lock.unlock() }
        guard !closing.contains(key),
              subscriptions[key]?.contains(event) == true,
              let connectionID = owners[key] else { return nil }
        return AOSSceneLeaseRoute(connectionID: connectionID, ref: refs[key])
    }

    func snapshot() -> [String: Any] {
        lock.lock()
        defer { lock.unlock() }
        return [
            "leases": owners.keys.sorted(),
            "closing": closing.sorted(),
            "operations": operationTokens.keys.sorted(),
            "subscriptions": subscriptions
                .filter { !$0.value.isEmpty }
                .mapValues { $0.sorted() },
        ]
    }

    private func currentToken(for key: String) -> AOSSceneLeaseToken? {
        guard let connectionID = owners[key], let generation = generations[key] else { return nil }
        return AOSSceneLeaseToken(
            key: key,
            generation: generation,
            route: AOSSceneLeaseRoute(connectionID: connectionID, ref: refs[key])
        )
    }

    private func removeLease(ifCurrent token: AOSSceneLeaseToken) {
        guard currentToken(for: token.key) == token else { return }
        owners.removeValue(forKey: token.key)
        refs.removeValue(forKey: token.key)
        generations.removeValue(forKey: token.key)
        operationTokens.removeValue(forKey: token.key)
        closing.remove(token.key)
        subscriptions.removeValue(forKey: token.key)
        keysByConnection[token.route.connectionID]?.remove(token.key)
        if keysByConnection[token.route.connectionID]?.isEmpty == true {
            keysByConnection.removeValue(forKey: token.route.connectionID)
        }
    }
}
