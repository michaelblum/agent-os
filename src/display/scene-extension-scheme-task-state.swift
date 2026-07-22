import Foundation

final class AOSSceneExtensionSchemeTaskState {
    private let lock = NSLock()
    private var activeTasks: Set<ObjectIdentifier> = []

    private func withLock<T>(_ body: () -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body()
    }

    func start(_ taskID: ObjectIdentifier) -> Bool {
        withLock { activeTasks.insert(taskID).inserted }
    }

    @discardableResult
    func stop(_ taskID: ObjectIdentifier) -> Bool {
        withLock { activeTasks.remove(taskID) != nil }
    }

    func complete(_ taskID: ObjectIdentifier, callbacks: @escaping () -> Void) {
        DispatchQueue.main.async { [weak self] in
            guard let self,
                  self.withLock({ self.activeTasks.remove(taskID) != nil }) else { return }
            callbacks()
        }
    }

    var trackedTaskCount: Int {
        withLock { activeTasks.count }
    }
}
