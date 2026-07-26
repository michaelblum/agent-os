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

final class AOSDesktopPixelAggregateSettlement: @unchecked Sendable {
    private var allSucceeded = true
    private let lock = NSLock()
    private var remaining: Int
    private var waiters: [UUID: AOSDesktopPixelRetirementDecision] = [:]

    init(count: Int) {
        remaining = count
    }

    func complete(success: Bool) {
        lock.lock()
        guard remaining > 0 else {
            lock.unlock()
            return
        }
        allSucceeded = allSucceeded && success
        remaining -= 1
        guard remaining == 0 else {
            lock.unlock()
            return
        }
        let result = allSucceeded
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
            return allSucceeded
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

private final class AOSDesktopPixelStopAttempt: @unchecked Sendable {
    private var cancellationRequested = false
    private var finished = false
    private let lock = NSLock()
    private let settlement = AOSDesktopPixelRetirementLatch()
    private var task: Task<Void, Never>?

    func install(_ task: Task<Void, Never>) {
        lock.lock()
        let cancel = cancellationRequested || finished
        if !finished { self.task = task }
        lock.unlock()
        if cancel { task.cancel() }
    }

    func finish() {
        lock.lock()
        guard !finished else {
            lock.unlock()
            return
        }
        finished = true
        task = nil
        lock.unlock()
        settlement.observe()
    }

    func cancelAndWait(timeout: TimeInterval) async -> Bool {
        let snapshot = requestCancellation()
        if snapshot.finished { return true }
        snapshot.task?.cancel()
        return await settlement.wait(timeout: timeout)
    }

    private func requestCancellation() -> (
        task: Task<Void, Never>?,
        finished: Bool
    ) {
        lock.lock()
        cancellationRequested = true
        let task = self.task
        let finished = self.finished
        lock.unlock()
        return (task, finished)
    }
}

private final class AOSDesktopPixelStartupStreamCoordinator: @unchecked Sendable {
    private enum StartState {
        case failed
        case pending
        case succeeded
    }

    private let lifecycle: AOSDesktopPixelStreamLifecycle
    private let lock = NSLock()
    private var postStartStopRequired = false
    private let retirement = AOSDesktopPixelRetirementLatch()
    private var retirementRequested = false
    private var retired = false
    private let start: @Sendable () async throws -> Void
    private var startState: StartState = .pending
    private let stop: @Sendable () async throws -> Void
    private var stopAttempt: AOSDesktopPixelStopAttempt?
    private var stopInFlight = false

    init(
        lifecycle: AOSDesktopPixelStreamLifecycle,
        start: @escaping @Sendable () async throws -> Void,
        stop: @escaping @Sendable () async throws -> Void
    ) {
        self.lifecycle = lifecycle
        self.start = start
        self.stop = stop
    }

    func begin(
        completion: @escaping @Sendable (Result<Void, Error>) -> Void
    ) -> Task<Void, Never> {
        Task { [self] in
            let result: Result<Void, Error>
            do {
                try Task.checkCancellation()
                try await start()
                result = .success(())
            } catch {
                result = .failure(error)
            }
            startCompleted(result)
            completion(result)
        }
    }

    func requestRetirement() {
        lock.lock()
        retirementRequested = true
        lock.unlock()
        startStopIfNeeded()
    }

    func waitForRetirement(timeout: TimeInterval) async -> Bool {
        let observation = Task.detached(priority: .utility) { [self] in
            if await lifecycle.waitForRetirement(timeout: timeout) {
                nativeRetirementObserved()
            }
        }
        let result = await retirement.wait(timeout: timeout)
        observation.cancel()
        let stopSettled = await cancelAndJoinActiveStop(
            timeout: max(0.01, min(timeout, 0.1))
        )
        return result && stopSettled
    }

    private func startCompleted(_ result: Result<Void, Error>) {
        lock.lock()
        startState = result.isSuccess ? .succeeded : .failed
        let shouldStop = retirementRequested && !retired && !stopInFlight
        lock.unlock()
        if shouldStop { startStopIfNeeded() }
    }

    private func startStopIfNeeded() {
        lock.lock()
        guard retirementRequested, !retired, !stopInFlight else {
            lock.unlock()
            return
        }
        let beganWhileStartPending = startState == .pending
        if beganWhileStartPending { postStartStopRequired = true }
        let attempt = AOSDesktopPixelStopAttempt()
        stopAttempt = attempt
        stopInFlight = true
        lock.unlock()

        let task = Task.detached(priority: .utility) { [self, attempt] in
            let result: Result<Void, Error>
            do {
                try await stop()
                result = .success(())
            } catch {
                result = .failure(error)
            }
            stopCompleted(
                result,
                attempt: attempt,
                beganWhileStartPending: beganWhileStartPending
            )
            attempt.finish()
        }
        attempt.install(task)
    }

    private func stopCompleted(
        _ result: Result<Void, Error>,
        attempt: AOSDesktopPixelStopAttempt,
        beganWhileStartPending: Bool
    ) {
        lock.lock()
        guard stopAttempt === attempt else {
            lock.unlock()
            return
        }
        stopAttempt = nil
        stopInFlight = false
        let startHasSettled = startState != .pending
        let confirmsRetirement: Bool
        switch result {
        case .success:
            confirmsRetirement = true
        case .failure(let error):
            confirmsRetirement = lifecycle.retirementWasObserved()
                || aosDesktopPixelStopErrorConfirmsRetirement(error)
        }
        let canRetire = !beganWhileStartPending
            && startHasSettled
            && confirmsRetirement
        if canRetire {
            retired = true
            postStartStopRequired = false
        }
        let requiresPostStartStop = beganWhileStartPending
            && startHasSettled
            && retirementRequested
            && !retired
        lock.unlock()

        if canRetire {
            lifecycle.confirmRetirement()
            retirement.observe()
        } else if requiresPostStartStop {
            startStopIfNeeded()
        }
    }

    private func cancelAndJoinActiveStop(timeout: TimeInterval) async -> Bool {
        guard let active = activeStopAttempt() else { return true }
        return await active.cancelAndWait(timeout: timeout)
    }

    private func activeStopAttempt() -> AOSDesktopPixelStopAttempt? {
        lock.lock()
        let active = stopInFlight ? stopAttempt : nil
        lock.unlock()
        return active
    }

    private func nativeRetirementObserved() {
        lock.lock()
        let canRetire = retirementRequested
            && startState != .pending
            && !postStartStopRequired
            && !retired
        if canRetire { retired = true }
        lock.unlock()
        if canRetire { retirement.observe() }
    }
}

private extension Result where Success == Void, Failure == Error {
    var isSuccess: Bool {
        if case .success = self { return true }
        return false
    }
}

func aosStartDesktopPixelStreams(
    lifecycles: [AOSDesktopPixelStreamLifecycle],
    settlementTimeout: TimeInterval,
    start: @escaping @Sendable (_ index: Int) async throws -> Void,
    stop: @escaping @Sendable (_ index: Int) async throws -> Void
) async throws {
    guard !lifecycles.isEmpty, settlementTimeout > 0 else {
        throw AOSDesktopFrameCaptureFailure.captureFailed
    }
    let count = lifecycles.count
    let decision = AOSDesktopPixelStartupDecision(count: count)
    let startupSettlement = AOSDesktopPixelAggregateSettlement(count: count)
    let coordinators = lifecycles.enumerated().map { index, lifecycle in
        AOSDesktopPixelStartupStreamCoordinator(
            lifecycle: lifecycle,
            start: { try await start(index) },
            stop: { try await stop(index) }
        )
    }
    let tasks = coordinators.map { coordinator in
        coordinator.begin { completion in
            decision.complete(completion)
            startupSettlement.complete(success: true)
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
        coordinators.forEach { $0.requestRetirement() }
        let retirementSettlement = AOSDesktopPixelAggregateSettlement(count: count)
        let compensationTasks = coordinators.map { coordinator in
            Task.detached(priority: .utility) {
                retirementSettlement.complete(
                    success: await coordinator.waitForRetirement(
                        timeout: settlementTimeout
                    )
                )
            }
        }
        async let startupFinished = startupSettlement.wait(timeout: settlementTimeout)
        async let retirementFinished = retirementSettlement.wait(timeout: settlementTimeout)
        let startupDidFinish = await startupFinished
        let retirementDidFinish = await retirementFinished
        guard startupDidFinish && retirementDidFinish else {
            compensationTasks.forEach { $0.cancel() }
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
