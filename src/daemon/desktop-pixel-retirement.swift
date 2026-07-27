import Foundation

enum AOSDesktopPixelStopAdmission {
    case admitted
    case retired
    case unavailable
}

final class AOSDesktopPixelRetirementLatch: @unchecked Sendable {
    private let lock = NSLock()
    private var observed = false
    private var stopAdmitted = false
    private var waiters: [UUID: AOSDesktopPixelRetirementDecision] = [:]

    func admitExplicitStop() -> AOSDesktopPixelStopAdmission {
        lock.lock()
        defer { lock.unlock() }
        if observed { return .retired }
        guard !stopAdmitted else { return .unavailable }
        stopAdmitted = true
        return .admitted
    }

    func observe() {
        lock.lock()
        guard !observed else {
            lock.unlock()
            return
        }
        observed = true
        let pending = Array(waiters.values)
        waiters.removeAll()
        lock.unlock()
        pending.forEach { $0.resolve(true) }
    }

    func snapshot() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return observed
    }

    func wait(timeout: TimeInterval) async -> Bool {
        let id = UUID()
        let waiter = AOSDesktopPixelRetirementDecision()
        guard register(id: id, waiter: waiter) else { return true }
        DispatchQueue.global(qos: .utility).asyncAfter(
            deadline: .now() + max(
                0.01,
                min(timeout, AOSDesktopPixelBroker.defaultRetirementTimeout)
            )
        ) { [self] in
            settle(id: id, result: false)
        }
        return await withTaskCancellationHandler {
            await waiter.value()
        } onCancel: { [self] in
            settle(id: id, result: false)
        }
    }

    private func register(
        id: UUID,
        waiter: AOSDesktopPixelRetirementDecision
    ) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard !observed else { return false }
        waiters[id] = waiter
        return true
    }

    private func settle(id: UUID, result: Bool) {
        lock.lock()
        let waiter = waiters.removeValue(forKey: id)
        lock.unlock()
        waiter?.resolve(result)
    }
}

final class AOSDesktopPixelRetirementDecision: @unchecked Sendable {
    private let lock = NSLock()
    private var result: Bool?
    private var waiters: [(Bool) -> Void] = []

    func resolve(_ result: Bool) {
        lock.lock()
        guard self.result == nil else {
            lock.unlock()
            return
        }
        self.result = result
        let callbacks = waiters
        waiters.removeAll()
        lock.unlock()
        callbacks.forEach { $0(result) }
    }

    func value() async -> Bool {
        await withCheckedContinuation { continuation in
            lock.lock()
            if let result {
                lock.unlock()
                continuation.resume(returning: result)
                return
            }
            waiters.append { continuation.resume(returning: $0) }
            lock.unlock()
        }
    }
}
