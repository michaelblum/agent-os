import Foundation
import ScreenCaptureKit

func aosDesktopPixelStopErrorConfirmsRetirement(_ error: Error) -> Bool {
    let native = error as NSError
    guard native.domain == SCStreamErrorDomain else { return false }
    if native.code == SCStreamError.Code.attemptToStopStreamState.rawValue
        || native.code == SCStreamError.Code.userStopped.rawValue {
        return true
    }
    if #available(macOS 15.0, *),
       native.code == SCStreamError.Code.systemStoppedStream.rawValue {
        return true
    }
    return false
}

protocol AOSDesktopPixelStreamLifecycle: AnyObject {
    func confirmRetirement()
    func sampleIsReady() throws -> Bool
    func retirementWasObserved() -> Bool
    func waitForRetirement(timeout: TimeInterval) async -> Bool
}

let aosDesktopPixelStreamRetirementTimeout: TimeInterval =
    AOSDesktopPixelBroker.defaultRetirementTimeout - 1

final class AOSDesktopPixelRetirementLatch: @unchecked Sendable {
    private let lock = NSLock()
    private var observed = false
    private var waiters: [UUID: AOSDesktopPixelRetirementDecision] = [:]

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

func aosDesktopPixelStreamsAreReady(
    _ lifecycles: [AOSDesktopPixelStreamLifecycle]
) throws -> Bool {
    var allReady = true
    for lifecycle in lifecycles {
        if try !lifecycle.sampleIsReady() { allReady = false }
    }
    return allReady
}

final class AOSDesktopPixelStartupDecision: @unchecked Sendable {
    private let lock = NSLock()
    private var remaining: Int
    private var result: Result<Void, Error>?
    private var waiters: [(Result<Void, Error>) -> Void] = []

    init(count: Int) {
        remaining = count
    }

    func complete(_ completion: Result<Void, Error>) {
        lock.lock()
        guard remaining > 0 else {
            lock.unlock()
            return
        }
        remaining -= 1
        var settled: Result<Void, Error>?
        if result == nil {
            switch completion {
            case .failure:
                settled = completion
            case .success where remaining == 0:
                settled = .success(())
            case .success:
                break
            }
        }
        var callbacks: [(Result<Void, Error>) -> Void] = []
        if let settled {
            result = settled
            callbacks = waiters
            waiters.removeAll()
        }
        lock.unlock()
        if let settled {
            callbacks.forEach { $0(settled) }
        }
    }

    func cancel() {
        settle(.failure(CancellationError()))
    }

    func value() async throws {
        try await withCheckedThrowingContinuation { continuation in
            lock.lock()
            if let result {
                lock.unlock()
                continuation.resume(with: result)
                return
            }
            waiters.append { continuation.resume(with: $0) }
            lock.unlock()
        }
    }

    func compensationIsRequired() async -> Bool {
        do {
            try await value()
            return false
        } catch {
            return true
        }
    }

    private func settle(_ result: Result<Void, Error>) {
        lock.lock()
        guard self.result == nil else {
            lock.unlock()
            return
        }
        let callbacks = settleLocked(result)
        lock.unlock()
        callbacks.forEach { $0(result) }
    }

    private func settleLocked(
        _ result: Result<Void, Error>
    ) -> [(Result<Void, Error>) -> Void] {
        self.result = result
        let callbacks = waiters
        waiters.removeAll()
        return callbacks
    }
}

final class AOSDesktopPixelStartupSettlement: @unchecked Sendable {
    private var allRetired = true
    private let lock = NSLock()
    private var remaining: Int
    private var waiters: [UUID: AOSDesktopPixelRetirementDecision] = [:]

    init(count: Int) {
        remaining = count
    }

    func complete(retired: Bool) {
        lock.lock()
        guard remaining > 0 else {
            lock.unlock()
            return
        }
        allRetired = allRetired && retired
        remaining -= 1
        guard remaining == 0 else {
            lock.unlock()
            return
        }
        let result = allRetired
        let pending = Array(waiters.values)
        waiters.removeAll()
        lock.unlock()
        pending.forEach { $0.resolve(result) }
    }

    func wait(timeout: TimeInterval) async -> Bool {
        let id = UUID()
        let waiter = AOSDesktopPixelRetirementDecision()
        if let completed = completedResultOrRegister(id: id, waiter: waiter) {
            return completed
        }
        DispatchQueue.global(qos: .utility).asyncAfter(
            deadline: .now() + max(0.01, min(timeout, 5))
        ) { [self] in
            settleWaiter(id: id, result: false)
        }
        return await waiter.value()
    }

    private func completedResultOrRegister(
        id: UUID,
        waiter: AOSDesktopPixelRetirementDecision
    ) -> Bool? {
        lock.lock()
        defer { lock.unlock() }
        if remaining == 0 {
            return allRetired
        }
        waiters[id] = waiter
        return nil
    }

    private func settleWaiter(id: UUID, result: Bool) {
        lock.lock()
        let waiter = waiters.removeValue(forKey: id)
        lock.unlock()
        waiter?.resolve(result)
    }
}

func aosStartDesktopPixelStreams(
    count: Int,
    settlementTimeout: TimeInterval,
    start: @escaping @Sendable (_ index: Int) async throws -> Void,
    compensate: @escaping @Sendable (_ index: Int) async -> Bool
) async throws {
    guard count > 0, settlementTimeout > 0 else {
        throw AOSDesktopFrameCaptureFailure.captureFailed
    }
    let decision = AOSDesktopPixelStartupDecision(count: count)
    let settlement = AOSDesktopPixelStartupSettlement(count: count)
    let tasks = (0..<count).map { index in
        Task {
            let completion: Result<Void, Error>
            do {
                try Task.checkCancellation()
                try await start(index)
                completion = .success(())
            } catch {
                completion = .failure(error)
            }
            decision.complete(completion)
            let shouldCompensate = await decision.compensationIsRequired()
            let retired = shouldCompensate ? await compensate(index) : true
            settlement.complete(retired: retired)
        }
    }
    do {
        try await withTaskCancellationHandler {
            try await decision.value()
        } onCancel: {
            decision.cancel()
            tasks.forEach { $0.cancel() }
        }
    } catch {
        tasks.forEach { $0.cancel() }
        guard await settlement.wait(timeout: settlementTimeout) else {
            throw AOSDesktopFrameCaptureFailure.retirementUncertain
        }
        throw error
    }
}

func aosSettleDesktopPixelStreamRetirement(
    lifecycle: AOSDesktopPixelStreamLifecycle,
    timeout: TimeInterval,
    stop: @escaping () async throws -> Void
) async -> Bool {
    if lifecycle.retirementWasObserved() { return true }
    let decision = AOSDesktopPixelRetirementDecision()
    let stopTask = Task {
        do {
            try await stop()
            lifecycle.confirmRetirement()
            decision.resolve(true)
        } catch {
            if lifecycle.retirementWasObserved()
                || aosDesktopPixelStopErrorConfirmsRetirement(error) {
                lifecycle.confirmRetirement()
                decision.resolve(true)
            }
        }
    }
    let observationTask = Task {
        decision.resolve(await lifecycle.waitForRetirement(timeout: timeout))
    }
    let result = await decision.value()
    stopTask.cancel()
    observationTask.cancel()
    return result
}

func aosSettleDesktopPixelStreamRetirements(
    lifecycles: [AOSDesktopPixelStreamLifecycle],
    timeout: TimeInterval,
    stop: @escaping (_ index: Int) async throws -> Void
) async -> Bool {
    await withTaskGroup(of: Bool.self) { group in
        for (index, lifecycle) in lifecycles.enumerated() {
            group.addTask {
                await aosSettleDesktopPixelStreamRetirement(
                    lifecycle: lifecycle,
                    timeout: timeout
                ) {
                    try await stop(index)
                }
            }
        }
        var settled = true
        for await result in group {
            settled = result && settled
        }
        return settled
    }
}
