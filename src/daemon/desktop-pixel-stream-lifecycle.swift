import Foundation
import ScreenCaptureKit

enum AOSDesktopPixelStreamLifecycleFailure: Error, Equatable {
    case startupDeadlineExceeded
}

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
    func admitExplicitStop() -> AOSDesktopPixelStopAdmission
    func confirmRetirement()
    func sampleIsReady() throws -> Bool
    func retirementWasObserved() -> Bool
    func waitForRetirement(timeout: TimeInterval) async -> Bool
}

typealias AOSDesktopPixelNativeCompletion = @Sendable (
    Result<Void, Error>
) -> Void
typealias AOSDesktopPixelNativeOperation = @Sendable (
    @escaping AOSDesktopPixelNativeCompletion
) -> Void

let aosDesktopPixelStreamRetirementTimeout: TimeInterval =
    AOSDesktopPixelBroker.defaultRetirementTimeout - 1

func aosDesktopPixelStreamsAreReady(
    _ lifecycles: [AOSDesktopPixelStreamLifecycle]
) throws -> Bool {
    var allReady = true
    for lifecycle in lifecycles {
        if try !lifecycle.sampleIsReady() { allReady = false }
    }
    return allReady
}

final class AOSDesktopPixelFrameAdmissionGate: @unchecked Sendable {
    final class Token: @unchecked Sendable {
        private var completed = false
        private let lock = NSLock()
        private weak var owner: AOSDesktopPixelFrameAdmissionGate?

        fileprivate init(owner: AOSDesktopPixelFrameAdmissionGate) {
            self.owner = owner
        }

        func complete() {
            lock.lock()
            guard !completed else {
                lock.unlock()
                return
            }
            completed = true
            let owner = self.owner
            self.owner = nil
            lock.unlock()
            owner?.completeAdmission()
        }

        deinit { complete() }
    }

    private var accepting = true
    private var inFlight = 0
    private let lock = NSLock()
    private var waiters: [UUID: AOSDesktopPixelRetirementDecision] = [:]

    func admit() -> Token? {
        lock.lock()
        guard accepting else {
            lock.unlock()
            return nil
        }
        inFlight += 1
        lock.unlock()
        return Token(owner: self)
    }

    @discardableResult
    func close() -> Int {
        lock.lock()
        accepting = false
        let pendingCount = inFlight
        let settled = pendingCount == 0 ? Array(waiters.values) : []
        if pendingCount == 0 { waiters.removeAll() }
        lock.unlock()
        settled.forEach { $0.resolve(true) }
        return pendingCount
    }

    func waitForDrain(timeout: TimeInterval) async -> Bool {
        let id = UUID()
        let waiter = AOSDesktopPixelRetirementDecision()
        if drainCompleteOrRegister(id: id, waiter: waiter) { return true }
        DispatchQueue.global(qos: .utility).asyncAfter(
            deadline: .now() + max(0.01, min(timeout, 5))
        ) { [weak self] in
            self?.settleWaiter(id: id, result: false)
        }
        return await waiter.value()
    }

    private func drainCompleteOrRegister(
        id: UUID,
        waiter: AOSDesktopPixelRetirementDecision
    ) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if !accepting, inFlight == 0 {
            return true
        }
        waiters[id] = waiter
        return false
    }

    var isOpen: Bool {
        lock.lock()
        defer { lock.unlock() }
        return accepting
    }

    private func completeAdmission() {
        lock.lock()
        precondition(inFlight > 0)
        inFlight -= 1
        let settled = !accepting && inFlight == 0 ? Array(waiters.values) : []
        if !settled.isEmpty { waiters.removeAll() }
        lock.unlock()
        settled.forEach { $0.resolve(true) }
    }

    private func settleWaiter(id: UUID, result: Bool) {
        lock.lock()
        let waiter = waiters.removeValue(forKey: id)
        lock.unlock()
        waiter?.resolve(result)
    }
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

    func deadlineExpired() {
        settle(.failure(AOSDesktopPixelStreamLifecycleFailure.startupDeadlineExceeded))
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

final class AOSDesktopPixelStartupSignal: @unchecked Sendable {
    private let lock = NSLock()
    private var failure: Error?
    private var failureObservers: [UUID: @Sendable (Error) -> Void] = [:]
    private var startupObservers: [AOSDesktopPixelNativeCompletion] = []
    private var startupResult: Result<Void, Error>?

    @discardableResult
    func observeStartup(
        _ observer: @escaping AOSDesktopPixelNativeCompletion
    ) -> Bool {
        lock.lock()
        if let startupResult {
            lock.unlock()
            observer(startupResult)
            return false
        }
        startupObservers.append(observer)
        lock.unlock()
        return true
    }

    func observeFailure(
        _ observer: @escaping @Sendable (Error) -> Void
    ) -> UUID {
        let id = UUID()
        lock.lock()
        if let failure {
            lock.unlock()
            observer(failure)
            return id
        }
        failureObservers[id] = observer
        lock.unlock()
        return id
    }

    func removeFailureObserver(_ id: UUID) {
        lock.lock()
        failureObservers.removeValue(forKey: id)
        lock.unlock()
    }

    func complete(_ result: Result<Void, Error>) {
        switch result {
        case .success:
            succeed()
        case .failure(let error):
            fail(error)
        }
    }

    func succeed() {
        lock.lock()
        guard startupResult == nil else {
            lock.unlock()
            return
        }
        startupResult = .success(())
        let pending = startupObservers
        startupObservers.removeAll()
        lock.unlock()
        pending.forEach { $0(.success(())) }
    }

    func fail(_ error: Error) {
        lock.lock()
        guard failure == nil else {
            lock.unlock()
            return
        }
        failure = error
        let startupPending: [AOSDesktopPixelNativeCompletion]
        if startupResult == nil {
            startupResult = .failure(error)
            startupPending = startupObservers
            startupObservers.removeAll()
        } else {
            startupPending = []
        }
        let failurePending = Array(failureObservers.values)
        failureObservers.removeAll()
        lock.unlock()
        startupPending.forEach { $0(.failure(error)) }
        failurePending.forEach { $0(error) }
    }
}

final class AOSDesktopPixelStartupCancellation: @unchecked Sendable {
    private var action: (@Sendable () -> Void)?
    private var canceled = false
    private let lock = NSLock()

    func register(_ action: @escaping @Sendable () -> Void) -> Bool {
        lock.lock()
        guard !canceled, self.action == nil else {
            lock.unlock()
            return false
        }
        self.action = action
        lock.unlock()
        return true
    }

    func cancel() {
        lock.lock()
        guard !canceled else {
            lock.unlock()
            return
        }
        canceled = true
        let action = self.action
        self.action = nil
        lock.unlock()
        action?()
    }

    func clear() {
        lock.lock()
        action = nil
        lock.unlock()
    }

    var isCancelled: Bool {
        lock.lock()
        defer { lock.unlock() }
        return canceled
    }
}

final class AOSDesktopPixelWarmOpenOperation: AOSDesktopFrameCancelling,
    @unchecked Sendable
{
    typealias Open = @Sendable (
        _ cancellation: AOSDesktopPixelStartupCancellation
    ) async throws -> AOSDesktopPixelWarmSource

    private var cancellationRequested = false
    private let completion: (Result<AOSDesktopPixelWarmSource, Error>) -> Void
    private var completionSettled = false
    private let lock = NSLock()
    private let open: Open
    private var openSettled = false
    private var started = false
    private let startupCancellation = AOSDesktopPixelStartupCancellation()
    private var task: Task<Void, Never>?

    init(
        open: @escaping Open,
        completion: @escaping (Result<AOSDesktopPixelWarmSource, Error>) -> Void
    ) {
        self.open = open
        self.completion = completion
    }

    func start() {
        lock.lock()
        guard !started else {
            lock.unlock()
            return
        }
        started = true
        let task = Task.detached(priority: .userInitiated) { [self] in
            let result: Result<AOSDesktopPixelWarmSource, Error>
            do {
                result = .success(try await open(startupCancellation))
            } catch {
                result = .failure(error)
            }
            openCompleted(result)
        }
        self.task = task
        lock.unlock()
    }

    func cancel() {
        lock.lock()
        guard !completionSettled else {
            lock.unlock()
            return
        }
        cancellationRequested = true
        lock.unlock()
        startupCancellation.cancel()
    }

    private func openCompleted(
        _ result: Result<AOSDesktopPixelWarmSource, Error>
    ) {
        lock.lock()
        guard !openSettled else {
            lock.unlock()
            return
        }
        openSettled = true
        task = nil
        let shouldRetire = cancellationRequested
        if !shouldRetire { completionSettled = true }
        lock.unlock()

        guard shouldRetire else {
            completion(result)
            return
        }
        switch result {
        case .failure:
            finish(result)
        case .success(let source):
            source.cancel { [self] retirement in
                switch retirement {
                case .success:
                    finish(.failure(CancellationError()))
                case .failure(let error):
                    finish(.failure(error))
                }
            }
        }
    }

    private func finish(
        _ result: Result<AOSDesktopPixelWarmSource, Error>
    ) {
        lock.lock()
        guard !completionSettled else {
            lock.unlock()
            return
        }
        completionSettled = true
        lock.unlock()
        completion(result)
    }
}

private final class AOSDesktopPixelStopAttempt: @unchecked Sendable {}

private final class AOSDesktopPixelStartupStreamCoordinator: @unchecked Sendable {
    private enum RetirementAction {
        case confirmInactive
        case none
        case stop(AOSDesktopPixelStopAttempt)
    }

    private enum StartState {
        case failed
        case pending
        case succeeded
    }

    private let lifecycle: AOSDesktopPixelStreamLifecycle
    private let lock = NSLock()
    private let retirement = AOSDesktopPixelRetirementLatch()
    private var retirementRequested = false
    private var retired = false
    private let signal: AOSDesktopPixelStartupSignal
    private let start: AOSDesktopPixelNativeOperation
    private var startState: StartState = .pending
    private var startupWasPublished = false
    private let stop: AOSDesktopPixelNativeOperation
    private var stopAttempt: AOSDesktopPixelStopAttempt?
    private var stopInFlight = false
    private var failureObservation: UUID?
    private let lateFailure: @Sendable (Error) -> Void

    init(
        lifecycle: AOSDesktopPixelStreamLifecycle,
        signal: AOSDesktopPixelStartupSignal,
        start: @escaping AOSDesktopPixelNativeOperation,
        stop: @escaping AOSDesktopPixelNativeOperation,
        lateFailure: @escaping @Sendable (Error) -> Void
    ) {
        self.lifecycle = lifecycle
        self.signal = signal
        self.start = start
        self.stop = stop
        self.lateFailure = lateFailure
        failureObservation = signal.observeFailure { [self] error in
            startupFailed(error)
        }
    }

    func begin(
        completion: @escaping @Sendable (Result<Void, Error>) -> Void
    ) {
        let shouldStart = signal.observeStartup { [self] result in
            startupEvidenceCompleted(result)
            completion(result)
        }
        if shouldStart {
            start { [weak self, signal] result in
                signal.complete(result)
                self?.nativeStartSettled(result)
            }
        }
    }

    func requestRetirement() {
        lock.lock()
        retirementRequested = true
        lock.unlock()
        retireIfNeeded()
    }

    func waitForRetirement(timeout: TimeInterval) async -> Bool {
        let observation = Task.detached(priority: .utility) { [self] in
            if await lifecycle.waitForRetirement(timeout: timeout) {
                nativeRetirementObserved()
            }
        }
        let result = await retirement.wait(timeout: timeout)
        observation.cancel()
        return result
    }

    private func startupEvidenceCompleted(_ result: Result<Void, Error>) {
        guard result.isSuccess else { return }
        lock.lock()
        startupWasPublished = true
        lock.unlock()
    }

    private func nativeStartSettled(_ result: Result<Void, Error>) {
        lock.lock()
        guard startState != .failed else {
            lock.unlock()
            return
        }
        startState = result.isSuccess ? .succeeded : .failed
        lock.unlock()
        retireIfNeeded()
    }

    private func startupFailed(_ error: Error) {
        lock.lock()
        let isLate = startupWasPublished
            && !retirementRequested
            && !retired
        lock.unlock()
        if isLate { lateFailure(error) }
        retireIfNeeded()
    }

    private func retireIfNeeded() {
        let nativeAlreadyRetired = lifecycle.retirementWasObserved()
        lock.lock()
        guard retirementRequested, !retired, !stopInFlight else {
            lock.unlock()
            return
        }
        let action: RetirementAction
        switch startState {
        case .pending:
            if nativeAlreadyRetired {
                retired = true
                action = .confirmInactive
            } else {
                action = .none
            }
        case .failed:
            retired = true
            action = .confirmInactive
        case .succeeded:
            if nativeAlreadyRetired {
                retired = true
                action = .confirmInactive
            } else {
                let attempt = AOSDesktopPixelStopAttempt()
                stopAttempt = attempt
                stopInFlight = true
                action = .stop(attempt)
            }
        }
        lock.unlock()

        switch action {
        case .none:
            return
        case .confirmInactive:
            clearFailureObservation()
            lifecycle.confirmRetirement()
            retirement.observe()
        case .stop(let attempt):
            startStop(attempt)
        }
    }

    private func startStop(_ attempt: AOSDesktopPixelStopAttempt) {
        switch lifecycle.admitExplicitStop() {
        case .retired:
            lock.lock()
            guard stopAttempt === attempt else {
                lock.unlock()
                return
            }
            stopAttempt = nil
            stopInFlight = false
            retired = true
            lock.unlock()
            clearFailureObservation()
            retirement.observe()
            return
        case .unavailable:
            lock.lock()
            guard stopAttempt === attempt else {
                lock.unlock()
                return
            }
            stopAttempt = nil
            stopInFlight = false
            lock.unlock()
            return
        case .admitted:
            break
        }
        stop { [self, attempt] result in
            stopCompleted(
                result,
                attempt: attempt
            )
        }
    }

    private func stopCompleted(
        _ result: Result<Void, Error>,
        attempt: AOSDesktopPixelStopAttempt
    ) {
        lock.lock()
        guard stopAttempt === attempt else {
            lock.unlock()
            return
        }
        stopAttempt = nil
        stopInFlight = false
        let confirmsRetirement: Bool
        switch result {
        case .success:
            confirmsRetirement = true
        case .failure(let error):
            confirmsRetirement = lifecycle.retirementWasObserved()
                || aosDesktopPixelStopErrorConfirmsRetirement(error)
        }
        let canRetire = startState != .pending && confirmsRetirement
        if canRetire {
            retired = true
        }
        lock.unlock()

        if canRetire {
            clearFailureObservation()
            lifecycle.confirmRetirement()
            retirement.observe()
        }
    }

    private func nativeRetirementObserved() {
        lock.lock()
        let canRetire = retirementRequested
            && !retired
        if canRetire {
            retired = true
            stopAttempt = nil
            stopInFlight = false
        }
        lock.unlock()
        if canRetire {
            clearFailureObservation()
            retirement.observe()
        }
    }

    fileprivate func clearFailureObservation() {
        lock.lock()
        let observation = failureObservation
        failureObservation = nil
        lock.unlock()
        if let observation { signal.removeFailureObserver(observation) }
    }
}

final class AOSDesktopPixelStartupOwner: @unchecked Sendable {
    private var coordinators: [AOSDesktopPixelStartupStreamCoordinator]
    let generation: UInt64
    private let lock = NSLock()

    fileprivate init(
        generation: UInt64,
        coordinators: [AOSDesktopPixelStartupStreamCoordinator]
    ) {
        self.generation = generation
        self.coordinators = coordinators
    }

    var retainsAuthority: Bool {
        lock.lock()
        defer { lock.unlock() }
        return !coordinators.isEmpty
    }

    func release() {
        lock.lock()
        let current = coordinators
        coordinators = []
        lock.unlock()
        current.forEach { $0.clearFailureObservation() }
    }

    func retire(timeout: TimeInterval) async -> Bool {
        let current = snapshot()
        guard !current.isEmpty else { return true }
        current.forEach { $0.requestRetirement() }
        let settlement = AOSDesktopPixelAggregateSettlement(
            count: current.count
        )
        let tasks = current.map { coordinator in
            Task.detached(priority: .utility) {
                settlement.complete(
                    success: await coordinator.waitForRetirement(
                        timeout: timeout
                    )
                )
            }
        }
        let retired = await settlement.wait(timeout: timeout)
        if retired {
            release()
        } else {
            tasks.forEach { $0.cancel() }
        }
        return retired
    }

    private func snapshot() -> [AOSDesktopPixelStartupStreamCoordinator] {
        lock.lock()
        defer { lock.unlock() }
        let current = coordinators
        return current
    }
}

private final class AOSDesktopPixelStartupCoordinatorReference:
    @unchecked Sendable
{
    weak var value: AOSDesktopPixelStartupStreamCoordinator?

    init(_ value: AOSDesktopPixelStartupStreamCoordinator) {
        self.value = value
    }
}

private final class AOSDesktopPixelLateStartupFailure: @unchecked Sendable {
    private var failed = false
    private let handler: @Sendable (Error) -> Void
    private let lock = NSLock()
    private var streams: [AOSDesktopPixelStartupCoordinatorReference] = []

    init(handler: @escaping @Sendable (Error) -> Void) {
        self.handler = handler
    }

    func install(_ coordinators: [AOSDesktopPixelStartupStreamCoordinator]) {
        lock.lock()
        streams = coordinators.map(AOSDesktopPixelStartupCoordinatorReference.init)
        lock.unlock()
    }

    func fail(_ error: Error) {
        lock.lock()
        guard !failed else {
            lock.unlock()
            return
        }
        failed = true
        let coordinators = streams.compactMap(\.value)
        lock.unlock()
        handler(error)
        coordinators.forEach { $0.requestRetirement() }
    }
}

private extension Result where Success == Void, Failure == Error {
    var isSuccess: Bool {
        if case .success = self { return true }
        return false
    }
}

@discardableResult
func aosStartDesktopPixelStreams(
    signals: [AOSDesktopPixelStartupSignal],
    lifecycles: [AOSDesktopPixelStreamLifecycle],
    settlementTimeout: TimeInterval,
    ownerGeneration: UInt64 = 1,
    ownerReady: @escaping @Sendable (AOSDesktopPixelStartupOwner) -> Void = { _ in },
    cancellation: AOSDesktopPixelStartupCancellation? = nil,
    lateFailure: @escaping @Sendable (Error) -> Void = { _ in },
    start: @escaping @Sendable (
        _ index: Int,
        _ completion: @escaping AOSDesktopPixelNativeCompletion
    ) -> Void,
    stop: @escaping @Sendable (
        _ index: Int,
        _ completion: @escaping AOSDesktopPixelNativeCompletion
    ) -> Void
) async throws -> AOSDesktopPixelStartupOwner {
    guard !lifecycles.isEmpty,
          signals.count == lifecycles.count,
          settlementTimeout > 0,
          ownerGeneration > 0 else {
        throw AOSDesktopFrameCaptureFailure.captureFailed
    }
    let count = lifecycles.count
    let decision = AOSDesktopPixelStartupDecision(count: count)
    let startupSettlement = AOSDesktopPixelAggregateSettlement(count: count)
    if let cancellation,
       !cancellation.register({ decision.cancel() }) {
        throw CancellationError()
    }
    defer { cancellation?.clear() }
    let lateFailureOwner = AOSDesktopPixelLateStartupFailure(
        handler: lateFailure
    )
    let coordinators = lifecycles.enumerated().map { index, lifecycle in
        AOSDesktopPixelStartupStreamCoordinator(
            lifecycle: lifecycle,
            signal: signals[index],
            start: { completion in start(index, completion) },
            stop: { completion in stop(index, completion) },
            lateFailure: { error in lateFailureOwner.fail(error) }
        )
    }
    lateFailureOwner.install(coordinators)
    let owner = AOSDesktopPixelStartupOwner(
        generation: ownerGeneration,
        coordinators: coordinators
    )
    ownerReady(owner)
    coordinators.forEach { coordinator in
        coordinator.begin { completion in
            decision.complete(completion)
            startupSettlement.complete(success: true)
        }
    }
    DispatchQueue.global(qos: .utility).asyncAfter(
        deadline: .now() + max(0.01, min(settlementTimeout, 5))
    ) {
        decision.deadlineExpired()
    }
    do {
        try await withTaskCancellationHandler {
            try await decision.value()
        } onCancel: {
            decision.cancel()
        }
    } catch {
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
    return owner
}

func aosSettleDesktopPixelStreamRetirement(
    lifecycle: AOSDesktopPixelStreamLifecycle,
    timeout: TimeInterval,
    stop: @escaping AOSDesktopPixelNativeOperation
) async -> Bool {
    switch lifecycle.admitExplicitStop() {
    case .retired:
        return true
    case .unavailable:
        return false
    case .admitted:
        break
    }
    let decision = AOSDesktopPixelRetirementDecision()
    stop { result in
        switch result {
        case .success:
            lifecycle.confirmRetirement()
            decision.resolve(true)
        case .failure(let error):
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
    observationTask.cancel()
    return result
}

func aosSettleDesktopPixelStreamRetirements(
    lifecycles: [AOSDesktopPixelStreamLifecycle],
    timeout: TimeInterval,
    stop: @escaping @Sendable (
        _ index: Int,
        _ completion: @escaping AOSDesktopPixelNativeCompletion
    ) -> Void
) async -> Bool {
    await withTaskGroup(of: Bool.self) { group in
        for (index, lifecycle) in lifecycles.enumerated() {
            group.addTask {
                await aosSettleDesktopPixelStreamRetirement(
                    lifecycle: lifecycle,
                    timeout: timeout
                ) { completion in
                    stop(index, completion)
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
