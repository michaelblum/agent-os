import AppKit
import Foundation

enum AOSDesktopFrameCaptureFailure: Error, Equatable {
    case busy
    case captureFailed
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
        case .captureFailed: return "DESKTOP_FRAME_CAPTURE_FAILED"
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
    static let maximumDisplayCount = 16
    static let maximumPixelsPerDisplay = 16_777_216
    static let maximumTotalPixels = 67_108_864
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

struct AOSDesktopPixelSnapshotRequest: Equatable {
    let displayIDs: [UInt32]
    let excludingWindowIDs: [Int]
    let maximumPixelsPerDisplay: Int
}

struct AOSDesktopPixelFrame: @unchecked Sendable {
    let capturedAt: Date
    let displayID: UInt32
    let image: CGImage

    var height: Int { image.height }
    var width: Int { image.width }
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
    private struct ActiveSnapshot {
        var capture: AOSDesktopFrameCancelling
        let generation: UInt64
        var retiring: Bool
    }

    private struct ActiveWarmLease {
        var freezeCanceled: Bool
        var freezeGeneration: UInt64?
        let generation: UInt64
        var lease: AOSDesktopPixelWarmLease
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
        retirementTimeout: TimeInterval = 2
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
            retiring: false
        )
        lock.unlock()

        let capture = acquirer.snapshot(request) { [weak self] result in
            self?.finish(generation: generation, result: result, completion: completion)
        }
        install(capture, generation: generation)
        return AOSDesktopFrameCancellation { [weak self] in
            self?.cancel(generation: generation)
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
            freezeGeneration: nil,
            generation: generation,
            lease: lease,
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
        return AOSDesktopFrameCancellation { [weak self] in
            self?.cancelWarm(generation: generation)
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
        activeWarmLease = active
        lock.unlock()

        let task = Task.detached(priority: .userInitiated) { [weak self] in
            let result = Result {
                try source.freeze(maximumAge: maximumAge)
            }
            self?.finishWarmFreeze(
                leaseGeneration: active.generation,
                freezeGeneration: freezeGeneration,
                result: result,
                completion: completion
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
    func releaseWarm(leaseID: UUID, ownerID: String) -> Bool {
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
        active.freezeGeneration = nil
        activeWarmLease = active
        lock.unlock()
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

    private func cancel(generation: UInt64) {
        lock.lock()
        guard var active = activeSnapshot,
              active.generation == generation,
              !active.retiring else {
            lock.unlock()
            return
        }
        active.retiring = true
        activeSnapshot = active
        lock.unlock()
        superviseSnapshotRetirement(generation: generation)
        active.capture.cancel()
    }

    private func cancelWarm(generation: UInt64) {
        lock.lock()
        guard var active = activeWarmLease,
              active.generation == generation,
              !active.retiring else {
            lock.unlock()
            return
        }
        active.retiring = true
        active.freezeCanceled = true
        active.freezeGeneration = nil
        activeWarmLease = active
        lock.unlock()
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
        lock.unlock()
        if !retiring { completion(result) }
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
        result: Result<AOSDesktopPixelFrameSet, Error>,
        completion: @escaping (Result<AOSDesktopPixelFrameSet, Error>) -> Void
    ) {
        lock.lock()
        guard var active = activeWarmLease,
              active.generation == leaseGeneration,
              active.freezeGeneration == freezeGeneration else {
            lock.unlock()
            return
        }
        let canceled = active.freezeCanceled
        active.freezeCanceled = false
        active.freezeGeneration = nil
        activeWarmLease = active
        lock.unlock()
        if !canceled { completion(result) }
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
        if case .failure = result {
            terminalFailure = .retirementUncertain
        }
        lock.unlock()
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
    }
}
