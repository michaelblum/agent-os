import Foundation

final class AOSSceneExtensionSchemeTaskState {
    private enum State {
        case active
        case stopped
        case finished
    }

    private let queue = DispatchQueue(label: "io.agent-os.scene-extension-task-state")
    private let queueKey = DispatchSpecificKey<UInt8>()
    private var states: [ObjectIdentifier: State] = [:]

    init() {
        queue.setSpecific(key: queueKey, value: 1)
    }

    private func serialized<T>(_ body: () -> T) -> T {
        if DispatchQueue.getSpecific(key: queueKey) != nil {
            return body()
        }
        return queue.sync(execute: body)
    }

    func start(_ taskID: ObjectIdentifier) -> Bool {
        serialized {
            guard states[taskID] == nil else { return false }
            states[taskID] = .active
            return true
        }
    }

    func stop(_ taskID: ObjectIdentifier) {
        serialized {
            guard states[taskID] == .active else { return }
            states[taskID] = .stopped
            states.removeValue(forKey: taskID)
        }
    }

    @discardableResult
    func finish(_ taskID: ObjectIdentifier, callbacks: () -> Void) -> Bool {
        serialized {
            guard states[taskID] == .active else { return false }
            states[taskID] = .finished
            callbacks()
            states.removeValue(forKey: taskID)
            return true
        }
    }

    var trackedTaskCount: Int {
        serialized { states.count }
    }
}
