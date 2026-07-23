import Foundation

let inputTapPermissionSnapshotValidityNanoseconds: UInt64 = 3_000_000_000

struct InputTapPermissionSnapshot: Equatable {
    let accessibility: Bool
    let listen: Bool
    let post: Bool

    static let unavailable = InputTapPermissionSnapshot(
        accessibility: false,
        listen: false,
        post: false
    )

    var available: Bool {
        accessibility && listen && post
    }
}

struct InputTapPermissionState {
    private(set) var lossDetected = false
    private(set) var snapshot = InputTapPermissionSnapshot.unavailable
    private(set) var validUntilUptimeNanoseconds: UInt64 = 0
    private(set) var lastErrorAt: Date?

    func disposition(at uptimeNanoseconds: UInt64) -> InputTapPermissionDisposition {
        if lossDetected || !snapshot.available { return .lost }
        if uptimeNanoseconds > validUntilUptimeNanoseconds { return .stale }
        return .authorized
    }

    mutating func publish(
        _ next: InputTapPermissionSnapshot,
        observedAtUptimeNanoseconds: UInt64,
        validForNanoseconds: UInt64 = inputTapPermissionSnapshotValidityNanoseconds
    ) {
        guard !lossDetected else { return }
        snapshot = next
        if next.available {
            validUntilUptimeNanoseconds = observedAtUptimeNanoseconds.addingWithoutOverflow(
                validForNanoseconds
            )
        } else {
            validUntilUptimeNanoseconds = 0
        }
    }

    mutating func recordError(at date: Date) {
        lastErrorAt = date
    }

    mutating func latchLoss(at date: Date) -> Bool {
        guard !lossDetected else { return false }
        lossDetected = true
        snapshot = .unavailable
        validUntilUptimeNanoseconds = 0
        lastErrorAt = date
        return true
    }
}

enum InputTapPermissionDisposition: Equatable {
    case authorized
    case stale
    case lost
}

struct InputTapTimeoutRecoveryState {
    private(set) var generation: UInt64 = 0
    private(set) var pendingGeneration: UInt64?

    mutating func installed() {
        generation &+= 1
        pendingGeneration = nil
    }

    mutating func requireRecovery() {
        pendingGeneration = generation
    }

    mutating func consumeIfCurrent(authorized: Bool) -> Bool {
        guard authorized, pendingGeneration == generation else { return false }
        pendingGeneration = nil
        return true
    }

    mutating func invalidate() {
        generation &+= 1
        pendingGeneration = nil
    }
}

final class InputTapPermissionGate {
    private let lock = NSLock()
    private var state = InputTapPermissionState()

    func publish(
        _ snapshot: InputTapPermissionSnapshot,
        observedAtUptimeNanoseconds: UInt64,
        validForNanoseconds: UInt64 = inputTapPermissionSnapshotValidityNanoseconds
    ) {
        lock.lock()
        state.publish(
            snapshot,
            observedAtUptimeNanoseconds: observedAtUptimeNanoseconds,
            validForNanoseconds: validForNanoseconds
        )
        lock.unlock()
    }

    func disposition(at uptimeNanoseconds: UInt64) -> InputTapPermissionDisposition {
        lock.lock()
        defer { lock.unlock() }
        return state.disposition(at: uptimeNanoseconds)
    }

    var lossDetected: Bool {
        lock.lock()
        defer { lock.unlock() }
        return state.lossDetected
    }

    var lastErrorAt: Date? {
        lock.lock()
        defer { lock.unlock() }
        return state.lastErrorAt
    }

    func recordError(at date: Date) {
        lock.lock()
        state.recordError(at: date)
        lock.unlock()
    }

    func latchLoss(at date: Date) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return state.latchLoss(at: date)
    }
}

private extension UInt64 {
    func addingWithoutOverflow(_ other: UInt64) -> UInt64 {
        let (value, overflow) = addingReportingOverflow(other)
        return overflow ? .max : value
    }
}

final class InputTapPermissionMonitor {
    typealias Clock = () -> UInt64
    typealias Observer = (InputTapPermissionSnapshot, UInt64) -> Void
    typealias Resolver = () -> InputTapPermissionSnapshot

    private let clock: Clock
    private let initialDelay: DispatchTimeInterval
    private let interval: DispatchTimeInterval
    private let lock = NSLock()
    private let observer: Observer
    private let queue: DispatchQueue
    private let resolver: Resolver
    private let schedulesTimer: Bool
    private var generation: UInt64 = 0
    private var refreshRequested = false
    private var running = false
    private var timer: DispatchSourceTimer?

    deinit {
        timer?.cancel()
    }

    init(
        queue: DispatchQueue,
        initialDelay: DispatchTimeInterval = .seconds(1),
        interval: DispatchTimeInterval = .seconds(1),
        schedulesTimer: Bool = true,
        clock: @escaping Clock = { DispatchTime.now().uptimeNanoseconds },
        resolver: @escaping Resolver,
        observer: @escaping Observer
    ) {
        self.queue = queue
        self.initialDelay = initialDelay
        self.interval = interval
        self.schedulesTimer = schedulesTimer
        self.clock = clock
        self.resolver = resolver
        self.observer = observer
    }

    func start() {
        lock.lock()
        guard !running else {
            lock.unlock()
            return
        }
        running = true
        generation &+= 1
        let activeGeneration = generation
        guard schedulesTimer else {
            lock.unlock()
            return
        }
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + initialDelay, repeating: interval)
        timer.setEventHandler { [weak self] in
            self?.probe(generation: activeGeneration)
        }
        self.timer = timer
        timer.resume()
        lock.unlock()
    }

    func stop() {
        lock.lock()
        guard running else {
            lock.unlock()
            return
        }
        running = false
        generation &+= 1
        refreshRequested = false
        let timer = self.timer
        self.timer = nil
        lock.unlock()
        timer?.cancel()
    }

    func probeNow() {
        lock.lock()
        let activeGeneration = generation
        let shouldProbe = running
        lock.unlock()
        guard shouldProbe else { return }
        probe(generation: activeGeneration)
    }

    func requestProbe() {
        lock.lock()
        guard running, !refreshRequested else {
            lock.unlock()
            return
        }
        refreshRequested = true
        let activeGeneration = generation
        lock.unlock()
        queue.async { [weak self] in
            guard let self else { return }
            self.probe(generation: activeGeneration)
            self.lock.lock()
            if self.generation == activeGeneration {
                self.refreshRequested = false
            }
            self.lock.unlock()
        }
    }

    var isRunning: Bool {
        lock.lock()
        defer { lock.unlock() }
        return running
    }

    private func probe(generation expectedGeneration: UInt64) {
        lock.lock()
        let shouldResolve = running && generation == expectedGeneration
        lock.unlock()
        guard shouldResolve else { return }

        let snapshot = resolver()
        let observedAt = clock()

        lock.lock()
        guard running && generation == expectedGeneration else {
            lock.unlock()
            return
        }
        observer(snapshot, observedAt)
        lock.unlock()
    }
}
