import Foundation

final class VoiceAllocator {
    private var deque: [String] = []
    private let lock = NSLock()

    func seed(uris: [String]) {
        lock.lock(); defer { lock.unlock() }
        deque = uris
    }

    func reseed(uris: [String]) {
        lock.lock(); defer { lock.unlock() }
        let newSet = Set(uris)
        let survivors = deque.filter { newSet.contains($0) }
        let added = uris.filter { !survivors.contains($0) }
        deque = survivors + added
    }

    func next() -> String? {
        lock.lock(); defer { lock.unlock() }
        guard let first = deque.first else { return nil }
        deque.removeFirst()
        deque.append(first)
        return first
    }

    func markUsed(_ uri: String) {
        lock.lock(); defer { lock.unlock() }
        if let idx = deque.firstIndex(of: uri) {
            deque.remove(at: idx)
        }
        deque.append(uri)
    }

    /// Snapshot for tests; not used in production paths.
    func currentDeque() -> [String] {
        lock.lock(); defer { lock.unlock() }
        return deque
    }
}
