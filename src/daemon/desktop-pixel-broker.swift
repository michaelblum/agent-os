import AppKit
import CoreVideo
import Foundation

enum AOSDesktopFrameCaptureFailure: Error, Equatable {
    case busy
    case captureFailed
    case connectionInterrupted
    case consentRequired
    case displayNotFound
    case frameNotReady
    case leaseNotFound
    case permissionDenied
    case retirementUncertain
    case staleFrame
    case unauthorized
    case unsupported

    var code: String {
        switch self {
        case .busy: return "DESKTOP_FRAME_BUSY"
        case .captureFailed, .connectionInterrupted:
            return "DESKTOP_FRAME_CAPTURE_FAILED"
        case .consentRequired: return "DESKTOP_FRAME_CONSENT_REQUIRED"
        case .displayNotFound: return "DESKTOP_FRAME_DISPLAY_NOT_FOUND"
        case .frameNotReady: return "DESKTOP_FRAME_NOT_READY"
        case .leaseNotFound: return "DESKTOP_FRAME_LEASE_NOT_FOUND"
        case .permissionDenied: return "DESKTOP_FRAME_PERMISSION_DENIED"
        case .retirementUncertain: return "DESKTOP_FRAME_RETIREMENT_UNCERTAIN"
        case .staleFrame: return "DESKTOP_FRAME_STALE"
        case .unauthorized: return "DESKTOP_FRAME_UNAUTHORIZED"
        case .unsupported: return "DESKTOP_FRAME_UNSUPPORTED"
        }
    }
}

enum AOSDesktopPixelLimits {
    static let interactiveMaximumPixelsPerDisplay = 1_048_576
    static let maximumDisplayCount = 16
    static let maximumPixelsPerDisplay = 16_777_216
    static let maximumTotalPixels = 67_108_864
}

enum AOSDesktopPixelSizingPolicy: Equatable {
    case exactWithinBudget
    case fitWithinBudget
}

func aosDesktopPixelRequestIsValid(
    _ request: AOSDesktopPixelSnapshotRequest
) -> Bool {
    guard !request.displayIDs.isEmpty,
          request.displayIDs.count <= AOSDesktopPixelLimits.maximumDisplayCount,
          Set(request.displayIDs).count == request.displayIDs.count,
          request.maximumPixelsPerDisplay > 0,
          request.maximumPixelsPerDisplay <= AOSDesktopPixelLimits.maximumPixelsPerDisplay else {
        return false
    }
    let total = request.maximumPixelsPerDisplay.multipliedReportingOverflow(
        by: request.displayIDs.count
    )
    return !total.overflow && total.partialValue <= AOSDesktopPixelLimits.maximumTotalPixels
}

protocol AOSDesktopFrameCancelling {
    func cancel()
}

protocol AOSDesktopFrameRetirementAwaiting: AOSDesktopFrameCancelling {
    func cancelAndAwaitRetirement(
        _ completion: @escaping (Result<Void, Error>) -> Void
    )
}

final class AOSDesktopFrameCancellation: AOSDesktopFrameCancelling {
    private let action: () -> Void
    private let lock = NSLock()
    private var canceled = false

    init(_ action: @escaping () -> Void = {}) {
        self.action = action
    }

    func cancel() {
        lock.lock()
        guard !canceled else {
            lock.unlock()
            return
        }
        canceled = true
        lock.unlock()
        action()
    }
}

final class AOSDesktopFrameRetirementCancellation:
    AOSDesktopFrameRetirementAwaiting
{
    private let action: (@escaping (Result<Void, Error>) -> Void) -> Void
    private let lock = NSLock()
    private var result: Result<Void, Error>?
    private var started = false
    private var waiters: [(Result<Void, Error>) -> Void] = []

    init(
        _ action: @escaping (@escaping (Result<Void, Error>) -> Void) -> Void
    ) {
        self.action = action
    }

    func cancel() {
        cancelAndAwaitRetirement { _ in }
    }

    func cancelAndAwaitRetirement(
        _ completion: @escaping (Result<Void, Error>) -> Void
    ) {
        lock.lock()
        if let result {
            lock.unlock()
            completion(result)
            return
        }
        waiters.append(completion)
        guard !started else {
            lock.unlock()
            return
        }
        started = true
        lock.unlock()
        action { [self] result in
            finish(result)
        }
    }

    private func finish(_ result: Result<Void, Error>) {
        lock.lock()
        guard self.result == nil else {
            lock.unlock()
            return
        }
        self.result = result
        let waiters = waiters
        self.waiters = []
        lock.unlock()
        waiters.forEach { $0(result) }
    }
}

struct AOSDesktopPixelSnapshotRequest: Equatable {
    let displayIDs: [UInt32]
    let excludingWindowIDs: [Int]
    let maximumPixelsPerDisplay: Int
    let sizingPolicy: AOSDesktopPixelSizingPolicy

    init(
        displayIDs: [UInt32],
        excludingWindowIDs: [Int],
        maximumPixelsPerDisplay: Int,
        sizingPolicy: AOSDesktopPixelSizingPolicy = .fitWithinBudget
    ) {
        self.displayIDs = displayIDs
        self.excludingWindowIDs = excludingWindowIDs
        self.maximumPixelsPerDisplay = maximumPixelsPerDisplay
        self.sizingPolicy = sizingPolicy
    }
}

struct AOSDesktopPixelFrame: @unchecked Sendable {
    let capturedAt: Date
    let displayID: UInt32
    let image: CGImage?
    let pixelBuffer: CVPixelBuffer?

    init(capturedAt: Date, displayID: UInt32, image: CGImage) {
        self.capturedAt = capturedAt
        self.displayID = displayID
        self.image = image
        pixelBuffer = nil
    }

    init(capturedAt: Date, displayID: UInt32, pixelBuffer: CVPixelBuffer) {
        self.capturedAt = capturedAt
        self.displayID = displayID
        image = nil
        self.pixelBuffer = pixelBuffer
    }

    var height: Int {
        image?.height ?? pixelBuffer.map(CVPixelBufferGetHeight) ?? 0
    }

    var width: Int {
        image?.width ?? pixelBuffer.map(CVPixelBufferGetWidth) ?? 0
    }
}

struct AOSDesktopPixelFrameSet: @unchecked Sendable {
    let capturedAt: Date
    let durationMilliseconds: Int
    let frames: [AOSDesktopPixelFrame]
}

struct AOSDesktopPixelWarmLease: Equatable {
    let id: UUID
    let ownerID: String
    let preparedAt: Date
    let request: AOSDesktopPixelSnapshotRequest
}

protocol AOSDesktopPixelWarmSource: AnyObject {
    func freeze(maximumAge: TimeInterval) throws -> AOSDesktopPixelFrameSet
    func cancel(completion: @escaping (Result<Void, Error>) -> Void)
}

extension AOSDesktopPixelWarmSource {
    func cancel() {
        cancel(completion: { _ in })
    }
}

protocol AOSDesktopPixelWarmAcquiring: AnyObject {
    @discardableResult
    func openWarm(
        _ request: AOSDesktopPixelSnapshotRequest,
        completion: @escaping (Result<AOSDesktopPixelWarmSource, Error>) -> Void
    ) -> AOSDesktopFrameCancelling
}

protocol AOSDesktopPixelSnapshotting: AnyObject {
    @discardableResult
    func snapshot(
        _ request: AOSDesktopPixelSnapshotRequest,
        completion: @escaping (Result<AOSDesktopPixelFrameSet, Error>) -> Void
    ) -> AOSDesktopFrameCancelling

    func shutdown()
}

protocol AOSDesktopPixelAcquiring: AnyObject {
    @discardableResult
    func snapshot(
        _ request: AOSDesktopPixelSnapshotRequest,
        completion: @escaping (Result<AOSDesktopPixelFrameSet, Error>) -> Void
    ) -> AOSDesktopFrameCancelling
}

final class AOSDesktopPixelBroker: AOSDesktopPixelSnapshotting {
    static let defaultRetirementTimeout: TimeInterval = 5

    private typealias WarmFreezeCompletion = (
        Result<AOSDesktopPixelFrameSet, Error>
    ) -> Void

    private static func settleCanceledWarmFreeze(
        _ completion: WarmFreezeCompletion?,
        failure: AOSDesktopFrameCaptureFailure
    ) {
        guard let completion else { return }
        DispatchQueue.global(qos: .userInitiated).async {
            completion(.failure(failure))
        }
    }

    private struct ActiveSnapshot {
        var capture: AOSDesktopFrameCancelling
        let generation: UInt64
        var retirementWaiters: [(Result<Void, Error>) -> Void]
        var retiring: Bool
    }

    private struct ActiveWarmLease {
        var freezeCanceled: Bool
        var freezeCompletion: WarmFreezeCompletion?
        var freezeGeneration: UInt64?
        let generation: UInt64
        var lease: AOSDesktopPixelWarmLease
        var retirementWaiters: [(Result<Void, Error>) -> Void]
        var retiring: Bool
        var source: AOSDesktopPixelWarmSource?
        var startup: AOSDesktopFrameCancelling
    }

    private let acquirer: AOSDesktopPixelAcquiring
    private let lock = NSLock()
    private let retirementTimeout: TimeInterval
    private var activeSnapshot: ActiveSnapshot?
    private var activeWarmLease: ActiveWarmLease?
    private var nextGeneration: UInt64 = 0
    private var stopped = false
    private var terminalFailure: AOSDesktopFrameCaptureFailure?
    private let warmAcquirer: AOSDesktopPixelWarmAcquiring?

    init(
        acquirer: AOSDesktopPixelAcquiring = AOSNativeDesktopPixelAcquirer(),
        warmAcquirer: AOSDesktopPixelWarmAcquiring? = nil,
        retirementTimeout: TimeInterval = AOSDesktopPixelBroker.defaultRetirementTimeout
    ) {
        self.acquirer = acquirer
        self.retirementTimeout = max(0.01, min(retirementTimeout, 5))
        self.warmAcquirer = warmAcquirer
            ?? (acquirer as? AOSDesktopPixelWarmAcquiring)
    }

    @discardableResult
    func snapshot(
        _ request: AOSDesktopPixelSnapshotRequest,
        completion: @escaping (Result<AOSDesktopPixelFrameSet, Error>) -> Void
    ) -> AOSDesktopFrameCancelling {
        guard aosDesktopPixelRequestIsValid(request) else {
            completion(.failure(AOSDesktopFrameCaptureFailure.captureFailed))
            return AOSDesktopFrameCancellation()
        }
        lock.lock()
        if let terminalFailure {
            lock.unlock()
            completion(.failure(terminalFailure))
            return AOSDesktopFrameCancellation()
        }
        guard !stopped, activeSnapshot == nil, activeWarmLease == nil else {
            lock.unlock()
            completion(.failure(AOSDesktopFrameCaptureFailure.busy))
            return AOSDesktopFrameCancellation()
        }
        nextGeneration &+= 1
        if nextGeneration == 0 { nextGeneration = 1 }
        let generation = nextGeneration
        activeSnapshot = ActiveSnapshot(
            capture: AOSDesktopFrameCancellation(),
            generation: generation,
            retirementWaiters: [],
            retiring: false
        )
        lock.unlock()

        let capture = acquirer.snapshot(request) { [weak self] result in
            self?.finish(generation: generation, result: result, completion: completion)
        }
        install(capture, generation: generation)
        return AOSDesktopFrameRetirementCancellation { [weak self] completion in
            guard let self else {
                completion(.failure(AOSDesktopFrameCaptureFailure.unauthorized))
                return
            }
            self.cancel(generation: generation, completion: completion)
        }
    }

    func shutdown() {
        lock.lock()
        let activeSnapshot = activeSnapshot
        let activeWarmLease = activeWarmLease
        stopped = true
        self.activeSnapshot = nil
        self.activeWarmLease = nil
        lock.unlock()
        activeSnapshot?.capture.cancel()
        activeWarmLease?.startup.cancel()
        activeWarmLease?.source?.cancel()
        Self.settleCanceledWarmFreeze(
            activeWarmLease?.freezeCompletion,
            failure: .unauthorized
        )
        let shutdown: Result<Void, Error> = .failure(
            AOSDesktopFrameCaptureFailure.unauthorized
        )
        activeSnapshot?.retirementWaiters.forEach { $0(shutdown) }
        activeWarmLease?.retirementWaiters.forEach { $0(shutdown) }
    }

    @discardableResult
    func prepareWarm(
        _ request: AOSDesktopPixelSnapshotRequest,
        ownerID: String,
        completion: @escaping (Result<AOSDesktopPixelWarmLease, Error>) -> Void
    ) -> AOSDesktopFrameCancelling {
        guard !ownerID.isEmpty, ownerID.utf8.count <= 128 else {
            completion(.failure(AOSDesktopFrameCaptureFailure.unauthorized))
            return AOSDesktopFrameCancellation()
        }
        guard let warmAcquirer else {
            completion(.failure(AOSDesktopFrameCaptureFailure.unsupported))
            return AOSDesktopFrameCancellation()
        }
        guard aosDesktopPixelRequestIsValid(request) else {
            completion(.failure(AOSDesktopFrameCaptureFailure.captureFailed))
            return AOSDesktopFrameCancellation()
        }
        lock.lock()
        if let terminalFailure {
            lock.unlock()
            completion(.failure(terminalFailure))
            return AOSDesktopFrameCancellation()
        }
        guard !stopped, activeSnapshot == nil, activeWarmLease == nil else {
            lock.unlock()
            completion(.failure(AOSDesktopFrameCaptureFailure.busy))
            return AOSDesktopFrameCancellation()
        }
        nextGeneration &+= 1
        if nextGeneration == 0 { nextGeneration = 1 }
        let generation = nextGeneration
        let lease = AOSDesktopPixelWarmLease(
            id: UUID(),
            ownerID: ownerID,
            preparedAt: Date(),
            request: request
        )
        activeWarmLease = ActiveWarmLease(
            freezeCanceled: false,
            freezeCompletion: nil,
            freezeGeneration: nil,
            generation: generation,
            lease: lease,
            retirementWaiters: [],
            retiring: false,
            source: nil,
            startup: AOSDesktopFrameCancellation()
        )
        lock.unlock()

        let startup = warmAcquirer.openWarm(request) { [weak self] result in
            self?.finishWarmStart(
                generation: generation,
                result: result,
                completion: completion
            )
        }
        installWarmStartup(startup, generation: generation)
        return AOSDesktopFrameRetirementCancellation { [weak self] completion in
            guard let self else {
                completion(.failure(AOSDesktopFrameCaptureFailure.unauthorized))
                return
            }
            self.cancelWarm(generation: generation, completion: completion)
        }
    }

    @discardableResult
    func freezeWarm(
        leaseID: UUID,
        ownerID: String,
        maximumAge: TimeInterval,
        completion: @escaping (Result<AOSDesktopPixelFrameSet, Error>) -> Void
    ) -> AOSDesktopFrameCancelling {
        lock.lock()
        if let terminalFailure {
            lock.unlock()
            completion(.failure(terminalFailure))
            return AOSDesktopFrameCancellation()
        }
        guard !stopped else {
            lock.unlock()
            completion(.failure(AOSDesktopFrameCaptureFailure.unauthorized))
            return AOSDesktopFrameCancellation()
        }
        guard var active = activeWarmLease,
              active.lease.id == leaseID,
              active.lease.ownerID == ownerID else {
            lock.unlock()
            completion(.failure(AOSDesktopFrameCaptureFailure.leaseNotFound))
            return AOSDesktopFrameCancellation()
        }
        guard !active.retiring, active.freezeGeneration == nil else {
            lock.unlock()
            completion(.failure(AOSDesktopFrameCaptureFailure.busy))
            return AOSDesktopFrameCancellation()
        }
        guard let source = active.source else {
            lock.unlock()
            completion(.failure(AOSDesktopFrameCaptureFailure.frameNotReady))
            return AOSDesktopFrameCancellation()
        }
        nextGeneration &+= 1
        if nextGeneration == 0 { nextGeneration = 1 }
        let freezeGeneration = nextGeneration
        active.freezeGeneration = freezeGeneration
        active.freezeCanceled = false
        active.freezeCompletion = completion
        activeWarmLease = active
        lock.unlock()

        let task = Task.detached(priority: .userInitiated) { [weak self] in
            let result = Result {
                try source.freeze(maximumAge: maximumAge)
            }
            self?.finishWarmFreeze(
                leaseGeneration: active.generation,
                freezeGeneration: freezeGeneration,
                result: result
            )
        }
        return AOSDesktopFrameCancellation { [weak self] in
            task.cancel()
            self?.cancelWarmFreeze(
                leaseGeneration: active.generation,
                freezeGeneration: freezeGeneration
            )
        }
    }

    @discardableResult
    func releaseWarm(
        leaseID: UUID,
        ownerID: String,
        completion: ((Result<Void, Error>) -> Void)? = nil
    ) -> Bool {
        lock.lock()
        guard var active = activeWarmLease,
              active.lease.id == leaseID,
              active.lease.ownerID == ownerID,
              !active.retiring else {
            lock.unlock()
            return false
        }
        active.retiring = true
        active.freezeCanceled = true
        let freezeCompletion = active.freezeCompletion
        active.freezeCompletion = nil
        active.freezeGeneration = nil
        if let completion {
            active.retirementWaiters.append(completion)
        }
        activeWarmLease = active
        lock.unlock()
        Self.settleCanceledWarmFreeze(
            freezeCompletion,
            failure: .frameNotReady
        )
        superviseWarmRetirement(generation: active.generation)
        active.startup.cancel()
        if let source = active.source {
            source.cancel { [weak self] result in
                self?.finishWarmRetirement(
                    generation: active.generation,
                    result: result
                )
            }
        }
        return true
    }

    private func cancel(
        generation: UInt64,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        lock.lock()
        guard var active = activeSnapshot,
              active.generation == generation else {
            lock.unlock()
            completion(.success(()))
            return
        }
        active.retirementWaiters.append(completion)
        if active.retiring {
            activeSnapshot = active
            lock.unlock()
            return
        }
        active.retiring = true
        activeSnapshot = active
        lock.unlock()
        superviseSnapshotRetirement(generation: generation)
        active.capture.cancel()
    }

    private func cancelWarm(
        generation: UInt64,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        lock.lock()
        guard var active = activeWarmLease,
              active.generation == generation else {
            lock.unlock()
            completion(.success(()))
            return
        }
        active.retirementWaiters.append(completion)
        if active.retiring {
            activeWarmLease = active
            lock.unlock()
            return
        }
        active.retiring = true
        active.freezeCanceled = true
        let freezeCompletion = active.freezeCompletion
        active.freezeCompletion = nil
        active.freezeGeneration = nil
        activeWarmLease = active
        lock.unlock()
        Self.settleCanceledWarmFreeze(
            freezeCompletion,
            failure: .frameNotReady
        )
        superviseWarmRetirement(generation: generation)
        active.startup.cancel()
        if let source = active.source {
            source.cancel { [weak self] result in
                self?.finishWarmRetirement(
                    generation: generation,
                    result: result
                )
            }
        }
    }

    private func cancelWarmFreeze(
        leaseGeneration: UInt64,
        freezeGeneration: UInt64
    ) {
        lock.lock()
        guard var active = activeWarmLease,
              active.generation == leaseGeneration,
              active.freezeGeneration == freezeGeneration else {
            lock.unlock()
            return
        }
        active.freezeCanceled = true
        active.freezeCompletion = nil
        activeWarmLease = active
        lock.unlock()
    }

    private func install(
        _ capture: AOSDesktopFrameCancelling,
        generation: UInt64
    ) {
        lock.lock()
        guard var active = activeSnapshot,
              active.generation == generation else {
            lock.unlock()
            capture.cancel()
            return
        }
        active.capture = capture
        activeSnapshot = active
        let retiring = active.retiring
        lock.unlock()
        if retiring { capture.cancel() }
    }

    private func installWarmStartup(
        _ startup: AOSDesktopFrameCancelling,
        generation: UInt64
    ) {
        lock.lock()
        guard activeWarmLease?.generation == generation else {
            lock.unlock()
            startup.cancel()
            return
        }
        activeWarmLease?.startup = startup
        lock.unlock()
    }

    private func finish(
        generation: UInt64,
        result: Result<AOSDesktopPixelFrameSet, Error>,
        completion: @escaping (Result<AOSDesktopPixelFrameSet, Error>) -> Void
    ) {
        lock.lock()
        guard !stopped, let active = activeSnapshot,
              active.generation == generation else {
            lock.unlock()
            return
        }
        activeSnapshot = nil
        let retiring = active.retiring
        let retirement: Result<Void, Error>
        if case .failure(let error) = result,
           error as? AOSDesktopFrameCaptureFailure == .retirementUncertain {
            terminalFailure = .retirementUncertain
            retirement = .failure(AOSDesktopFrameCaptureFailure.retirementUncertain)
        } else {
            retirement = .success(())
        }
        lock.unlock()
        if retiring {
            active.retirementWaiters.forEach { $0(retirement) }
        } else {
            completion(result)
        }
    }

    private func finishWarmStart(
        generation: UInt64,
        result: Result<AOSDesktopPixelWarmSource, Error>,
        completion: @escaping (Result<AOSDesktopPixelWarmLease, Error>) -> Void
    ) {
        lock.lock()
        guard !stopped, var active = activeWarmLease,
              active.generation == generation else {
            lock.unlock()
            if case .success(let source) = result { source.cancel() }
            return
        }
        if active.retiring {
            lock.unlock()
            switch result {
            case .success(let source):
                source.cancel { [weak self] result in
                    self?.finishWarmRetirement(
                        generation: generation,
                        result: result
                    )
                }
            case .failure(let error):
                let result: Result<Void, Error>
                if error as? AOSDesktopFrameCaptureFailure == .retirementUncertain {
                    result = .failure(error)
                } else {
                    result = .success(())
                }
                finishWarmRetirement(generation: generation, result: result)
            }
            return
        }
        switch result {
        case .success(let source):
            active.lease = AOSDesktopPixelWarmLease(
                id: active.lease.id,
                ownerID: active.lease.ownerID,
                preparedAt: Date(),
                request: active.lease.request
            )
            active.source = source
            activeWarmLease = active
            let lease = active.lease
            lock.unlock()
            completion(.success(lease))
        case .failure(let error):
            activeWarmLease = nil
            if error as? AOSDesktopFrameCaptureFailure == .retirementUncertain {
                terminalFailure = .retirementUncertain
            }
            lock.unlock()
            active.startup.cancel()
            completion(.failure(error))
        }
    }

    private func finishWarmFreeze(
        leaseGeneration: UInt64,
        freezeGeneration: UInt64,
        result: Result<AOSDesktopPixelFrameSet, Error>
    ) {
        lock.lock()
        guard var active = activeWarmLease,
              active.generation == leaseGeneration,
              active.freezeGeneration == freezeGeneration else {
            lock.unlock()
            return
        }
        let canceled = active.freezeCanceled
        let completion = active.freezeCompletion
        active.freezeCanceled = false
        active.freezeCompletion = nil
        active.freezeGeneration = nil
        activeWarmLease = active
        lock.unlock()
        if !canceled { completion?(result) }
    }

    private func finishWarmRetirement(
        generation: UInt64,
        result: Result<Void, Error>
    ) {
        lock.lock()
        guard let active = activeWarmLease,
              active.generation == generation,
              active.retiring else {
            lock.unlock()
            return
        }
        activeWarmLease = nil
        let settled: Result<Void, Error>
        if case .failure = result {
            terminalFailure = .retirementUncertain
            settled = .failure(
                AOSDesktopFrameCaptureFailure.retirementUncertain
            )
        } else {
            settled = .success(())
        }
        lock.unlock()
        active.retirementWaiters.forEach { $0(settled) }
    }

    private func superviseSnapshotRetirement(generation: UInt64) {
        DispatchQueue.global(qos: .utility).asyncAfter(
            deadline: .now() + retirementTimeout
        ) { [weak self] in
            self?.expireSnapshotRetirement(generation: generation)
        }
    }

    private func superviseWarmRetirement(generation: UInt64) {
        DispatchQueue.global(qos: .utility).asyncAfter(
            deadline: .now() + retirementTimeout
        ) { [weak self] in
            self?.expireWarmRetirement(generation: generation)
        }
    }

    private func expireSnapshotRetirement(generation: UInt64) {
        lock.lock()
        guard let active = activeSnapshot,
              active.generation == generation,
              active.retiring else {
            lock.unlock()
            return
        }
        activeSnapshot = nil
        terminalFailure = .retirementUncertain
        lock.unlock()
        let result: Result<Void, Error> = .failure(
            AOSDesktopFrameCaptureFailure.retirementUncertain
        )
        active.retirementWaiters.forEach { $0(result) }
    }

    private func expireWarmRetirement(generation: UInt64) {
        lock.lock()
        guard let active = activeWarmLease,
              active.generation == generation,
              active.retiring else {
            lock.unlock()
            return
        }
        activeWarmLease = nil
        terminalFailure = .retirementUncertain
        lock.unlock()
        let result: Result<Void, Error> = .failure(
            AOSDesktopFrameCaptureFailure.retirementUncertain
        )
        active.retirementWaiters.forEach { $0(result) }
    }
}
