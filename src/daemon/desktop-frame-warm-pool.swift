import Foundation

private struct AOSDesktopFrameWarmSourceIdentity: Equatable {
    let canvasGeneration: UInt64
    let displayIDs: [UInt32]
    let displayLayout: AOSDesktopWorldDisplayLayout?
    let excludingWindowIDs: [Int]
    let maximumPixelsPerDisplay: Int
    let sizingPolicy: AOSDesktopPixelSizingPolicy
    let topologyGeneration: UInt64
}

struct AOSDesktopFrameWarmConfiguration: Equatable {
    let canvasGeneration: UInt64
    let displayIDs: [UInt32]
    let displayLayout: AOSDesktopWorldDisplayLayout?
    let excludingWindowIDs: [Int]
    let maximumPixelsPerDisplay: Int
    let sizingPolicy: AOSDesktopPixelSizingPolicy
    let topologyGeneration: UInt64

    init(
        canvasGeneration: UInt64,
        displayIDs: [UInt32],
        displayLayout: AOSDesktopWorldDisplayLayout? = nil,
        excludingWindowIDs: [Int],
        maximumPixelsPerDisplay: Int,
        sizingPolicy: AOSDesktopPixelSizingPolicy = .fitWithinBudget,
        topologyGeneration: UInt64
    ) {
        self.canvasGeneration = canvasGeneration
        self.displayIDs = displayIDs
        self.displayLayout = displayLayout
        self.excludingWindowIDs = excludingWindowIDs
        self.maximumPixelsPerDisplay = maximumPixelsPerDisplay
        self.sizingPolicy = sizingPolicy
        self.topologyGeneration = topologyGeneration
    }

    fileprivate var sourceIdentity: AOSDesktopFrameWarmSourceIdentity {
        AOSDesktopFrameWarmSourceIdentity(
            canvasGeneration: canvasGeneration,
            displayIDs: displayIDs,
            displayLayout: displayLayout,
            excludingWindowIDs: Array(Set(excludingWindowIDs)).sorted(),
            maximumPixelsPerDisplay: maximumPixelsPerDisplay,
            sizingPolicy: sizingPolicy,
            topologyGeneration: topologyGeneration
        )
    }

    var request: AOSDesktopPixelSnapshotRequest {
        AOSDesktopPixelSnapshotRequest(
            displayIDs: displayIDs,
            displayLayout: displayLayout,
            excludingWindowIDs: excludingWindowIDs,
            maximumPixelsPerDisplay: maximumPixelsPerDisplay,
            sizingPolicy: sizingPolicy
        )
    }
}

enum AOSDesktopFrameWarmState: String {
    case failed
    case idle
    case ready
    case retiring
    case warming
}

struct AOSDesktopFrameWarmStatus: Equatable {
    let displayCount: Int
    let errorCode: String?
    let generation: UInt64
    let state: AOSDesktopFrameWarmState
}

protocol AOSDesktopFrameWarmPreparing: AnyObject {
    func reconcileWarm(_ configuration: AOSDesktopFrameWarmConfiguration?)
    func setWarmStatusObserver(
        _ observer: ((AOSDesktopFrameWarmStatus) -> Void)?
    )
    func warmStatus() -> AOSDesktopFrameWarmStatus
}

extension AOSDesktopFrameWarmPreparing {
    func setWarmStatusObserver(
        _ observer: ((AOSDesktopFrameWarmStatus) -> Void)?
    ) {}
}

protocol AOSDesktopFrameRuntimeCapturing: AOSDesktopFrameWarmPreparing {
    @discardableResult
    func capturePrewarmed(
        _ configuration: AOSDesktopFrameWarmConfiguration,
        completion: @escaping (Result<AOSDesktopFrameCaptureSetResult, Error>) -> Void
    ) -> AOSDesktopFrameCancelling
}

protocol AOSDesktopPixelFrameSetCapturing: AnyObject {
    @discardableResult
    func capturePrewarmedFrames(
        _ configuration: AOSDesktopFrameWarmConfiguration,
        completion: @escaping (Result<AOSDesktopPixelFrameSet, Error>) -> Void
    ) -> AOSDesktopFrameCancelling
}

enum AOSDesktopFrameWarmCaptureAdmission {
    case admitted(AOSDesktopFrameCancelling)
    case notConfigured
    case unavailable(AOSDesktopFrameCaptureFailure)
}

final class AOSDesktopFrameWarmPool: AOSDesktopFrameWarmPreparing {
    private enum ExclusiveStillPhase {
        case quiescing
        case capturing
        case restoring
    }

    private struct ExclusiveStill {
        var cancelWaiters: [(Result<Void, Error>) -> Void]
        let completion: (Result<AOSDesktopPixelFrameSet, Error>) -> Void
        var canceled: Bool
        let frozenPriorIdentity: AOSDesktopFrameWarmSourceIdentity?
        let id: UUID
        var operation: AOSDesktopFrameCancelling?
        var phase: ExclusiveStillPhase
        let request: AOSDesktopPixelSnapshotRequest
        var snapshotResult: Result<AOSDesktopPixelFrameSet, Error>?
    }

    private let broker: AOSDesktopPixelBroker
    private var desired: AOSDesktopFrameWarmConfiguration?
    private var failure: AOSDesktopFrameCaptureFailure?
    private var generation: UInt64 = 0
    private var lease: AOSDesktopPixelWarmLease?
    private let ownerID: String
    private let queue = DispatchQueue(label: "io.agent-os.desktop-frame-warm-pool")
    private var retiring = false
    private var sourceRecoveryAttempts = 0
    private var sourceRecoveryBlockedGeneration: UInt64?
    private var startup: AOSDesktopFrameCancelling?
    private var state: AOSDesktopFrameWarmState = .idle
    private var statusObserver: ((AOSDesktopFrameWarmStatus) -> Void)?
    private var lastNotifiedStatus: AOSDesktopFrameWarmStatus?
    private var terminalFailure = false
    private var exclusiveStill: ExclusiveStill?

    init(
        broker: AOSDesktopPixelBroker,
        ownerID: String = "desktop-frame-warm-pool"
    ) {
        self.broker = broker
        self.ownerID = ownerID
    }

    func reconcileWarm(_ configuration: AOSDesktopFrameWarmConfiguration?) {
        queue.async { [weak self] in
            self?.reconcileOnQueue(configuration)
        }
    }

    func warmStatus() -> AOSDesktopFrameWarmStatus {
        queue.sync { statusOnQueue() }
    }

    func setWarmStatusObserver(
        _ observer: ((AOSDesktopFrameWarmStatus) -> Void)?
    ) {
        queue.async { [weak self] in
            guard let self else { return }
            statusObserver = observer
            lastNotifiedStatus = nil
            notifyStatusIfChangedOnQueue()
        }
    }

    func freeze(
        _ configuration: AOSDesktopFrameWarmConfiguration,
        completion: @escaping (Result<AOSDesktopPixelFrameSet, Error>) -> Void
    ) -> AOSDesktopFrameWarmCaptureAdmission {
        let admitted: (lease: AOSDesktopPixelWarmLease, generation: UInt64)? = queue.sync {
            guard !retiring,
                  state == .ready,
                  desired == configuration,
                  let lease else { return nil }
            return (lease, generation)
        }
        if let admitted {
            return .admitted(broker.freezeWarm(
                leaseID: admitted.lease.id,
                ownerID: ownerID,
                maximumAge: 0.5,
                completion: { [weak self] result in
                    guard let self else {
                        completion(.failure(
                            AOSDesktopFrameCaptureFailure.unauthorized
                        ))
                        return
                    }
                    let delivery = queue.sync {
                        self.freezeResultOnQueue(
                            configuration: configuration,
                            generation: admitted.generation,
                            leaseID: admitted.lease.id,
                            result: result
                        )
                    }
                    completion(delivery)
                }
            ))
        }
        return queue.sync {
            guard desired != nil else { return .notConfigured }
            return .unavailable(failure ?? .frameNotReady)
        }
    }

    /// Retires every authoritative warm owner before admitting one broker still,
    /// then restores the exact still-current desired configuration. The caller
    /// receives the still only after restoration is ready (or a stable failure).
    @discardableResult
    func captureExclusiveStill(
        _ request: AOSDesktopPixelSnapshotRequest,
        completion: @escaping (Result<AOSDesktopPixelFrameSet, Error>) -> Void
    ) -> AOSDesktopFrameCancelling {
        let id = UUID()
        queue.async { [weak self] in
            self?.beginExclusiveStillOnQueue(
                id: id,
                request: request,
                completion: completion
            )
        }
        return AOSDesktopFrameRetirementCancellation { [weak self] settled in
            guard let self else {
                settled(.failure(AOSDesktopFrameCaptureFailure.unauthorized))
                return
            }
            self.queue.async {
                self.cancelExclusiveStillOnQueue(id: id, settled: settled)
            }
        }
    }

    private func reconcileOnQueue(
        _ configuration: AOSDesktopFrameWarmConfiguration?
    ) {
        defer { notifyStatusIfChangedOnQueue() }
        if desired?.sourceIdentity == configuration?.sourceIdentity {
            desired = configuration
            if state == .failed, !retiring, !terminalFailure {
                beginDesiredOnQueue()
            }
            return
        }
        desired = configuration
        if terminalFailure { return }
        failure = nil
        generation &+= 1
        if generation == 0 { generation = 1 }
        sourceRecoveryAttempts = 0
        sourceRecoveryBlockedGeneration = nil
        if retiring { return }
        if let exclusiveStill {
            if exclusiveStill.phase == .restoring {
                if lease != nil || startup != nil {
                    retireCurrentOnQueue()
                } else {
                    beginDesiredOnQueue()
                }
            }
            return
        }
        if lease != nil || startup != nil {
            retireCurrentOnQueue()
            return
        }
        beginDesiredOnQueue()
    }

    private func beginDesiredOnQueue() {
        defer { notifyStatusIfChangedOnQueue() }
        guard !retiring else { return }
        guard let configuration = desired else {
            state = .idle
            failure = nil
            return
        }
        guard sourceRecoveryBlockedGeneration != generation else {
            state = .failed
            return
        }
        guard configuration.canvasGeneration > 0,
              configuration.topologyGeneration > 0,
              aosDesktopPixelRequestIsValid(configuration.request) else {
            state = .failed
            failure = .captureFailed
            return
        }
        let startGeneration = generation
        state = .warming
        failure = nil
        let operation = broker.prepareWarm(
            configuration.request,
            ownerID: ownerID,
            terminalObserver: { [weak self] lease, error in
                self?.queue.async {
                    self?.warmSourceTerminatedOnQueue(
                        generation: startGeneration,
                        configuration: configuration,
                        leaseID: lease.id,
                        error: error
                    )
                }
            }
        ) { [weak self] result in
            self?.queue.async {
                self?.preparedOnQueue(
                    generation: startGeneration,
                    configuration: configuration,
                    result: result
                )
            }
        }
        if generation == startGeneration,
           desired == configuration,
           state == .warming,
           lease == nil,
           !retiring {
            startup = operation
        } else if lease == nil {
            operation.cancel()
        }
    }

    private func preparedOnQueue(
        generation: UInt64,
        configuration: AOSDesktopFrameWarmConfiguration,
        result: Result<AOSDesktopPixelWarmLease, Error>
    ) {
        defer { notifyStatusIfChangedOnQueue() }
        guard self.generation == generation,
              desired?.sourceIdentity == configuration.sourceIdentity,
              !retiring else { return }
        startup = nil
        switch result {
        case .success(let lease):
            self.lease = lease
            state = .ready
            failure = nil
            if exclusiveStill?.phase == .restoring {
                finishExclusiveStillOnQueue()
            }
        case .failure(let error):
            lease = nil
            state = .failed
            let observed = (error as? AOSDesktopFrameCaptureFailure)
                ?? .captureFailed
            failure = observed
            terminalFailure = observed == .retirementUncertain
            if !terminalFailure,
               sourceFailureAllowsSingleRecovery(observed),
               sourceRecoveryAttempts == 0 {
                sourceRecoveryAttempts = 1
                beginDesiredOnQueue()
            } else {
                sourceRecoveryBlockedGeneration = generation
            }
            if exclusiveStill?.phase == .restoring,
               state == .failed {
                finishExclusiveStillOnQueue(restoreFailure: observed)
            }
        }
    }

    private func warmSourceTerminatedOnQueue(
        generation: UInt64,
        configuration: AOSDesktopFrameWarmConfiguration,
        leaseID: UUID,
        error: Error
    ) {
        defer { notifyStatusIfChangedOnQueue() }
        guard self.generation == generation,
              desired?.sourceIdentity == configuration.sourceIdentity,
              lease?.id == leaseID,
              state == .ready,
              !retiring,
              exclusiveStill == nil else { return }
        let observed = aosDesktopFrameCaptureFailure(for: error)
        failure = observed
        if observed == .connectionInterrupted, sourceRecoveryAttempts == 0 {
            sourceRecoveryAttempts = 1
        } else {
            sourceRecoveryBlockedGeneration = generation
        }
        retireCurrentOnQueue()
    }

    private func freezeFailedOnQueue(
        configuration: AOSDesktopFrameWarmConfiguration,
        generation: UInt64,
        leaseID: UUID,
        error: Error
    ) {
        defer { notifyStatusIfChangedOnQueue() }
        guard self.generation == generation,
              desired == configuration,
              lease?.id == leaseID,
              !retiring else { return }
        let observed = (error as? AOSDesktopFrameCaptureFailure) ?? .captureFailed
        guard sourceFailureRequiresRetirement(observed) else { return }
        failure = observed
        if sourceFailureAllowsSingleRecovery(observed), sourceRecoveryAttempts == 0 {
            sourceRecoveryAttempts = 1
        } else {
            sourceRecoveryBlockedGeneration = generation
        }
        retireCurrentOnQueue()
    }

    private func freezeResultOnQueue(
        configuration: AOSDesktopFrameWarmConfiguration,
        generation: UInt64,
        leaseID: UUID,
        result: Result<AOSDesktopPixelFrameSet, Error>
    ) -> Result<AOSDesktopPixelFrameSet, Error> {
        guard self.generation == generation,
              desired == configuration,
              lease?.id == leaseID,
              !retiring else {
            return .failure(AOSDesktopFrameCaptureFailure.frameNotReady)
        }
        if case .failure(let error) = result {
            freezeFailedOnQueue(
                configuration: configuration,
                generation: generation,
                leaseID: leaseID,
                error: error
            )
        }
        return result
    }

    private func sourceFailureRequiresRetirement(
        _ failure: AOSDesktopFrameCaptureFailure
    ) -> Bool {
        switch failure {
        case .captureFailed, .connectionInterrupted, .displayNotFound, .leaseNotFound,
             .permissionDenied, .retirementUncertain, .unauthorized, .unsupported:
            return true
        case .busy, .consentRequired, .frameNotReady, .staleFrame:
            return false
        }
    }

    private func sourceFailureAllowsSingleRecovery(
        _ failure: AOSDesktopFrameCaptureFailure
    ) -> Bool {
        switch failure {
        case .captureFailed, .connectionInterrupted, .displayNotFound, .leaseNotFound:
            return true
        default:
            return false
        }
    }

    private func retireCurrentOnQueue() {
        defer { notifyStatusIfChangedOnQueue() }
        guard !retiring else { return }
        retiring = true
        state = .retiring
        let lease = self.lease
        let startup = self.startup
        self.lease = nil
        self.startup = nil

        if let lease {
            let released = broker.releaseWarm(
                leaseID: lease.id,
                ownerID: ownerID
            ) { [weak self] result in
                self?.queue.async { self?.retirementSettledOnQueue(result) }
            }
            if !released {
                retirementSettledOnQueue(
                    .failure(AOSDesktopFrameCaptureFailure.leaseNotFound)
                )
            }
            return
        }
        if let retiringStartup = startup as? AOSDesktopFrameRetirementAwaiting {
            retiringStartup.cancelAndAwaitRetirement { [weak self] result in
                self?.queue.async { self?.retirementSettledOnQueue(result) }
            }
            return
        }
        startup?.cancel()
        retirementSettledOnQueue(.success(()))
    }

    private func retirementSettledOnQueue(_ result: Result<Void, Error>) {
        defer { notifyStatusIfChangedOnQueue() }
        guard retiring else { return }
        retiring = false
        if case .failure(let error) = result {
            state = .failed
            terminalFailure = true
            failure = (error as? AOSDesktopFrameCaptureFailure)
                ?? .retirementUncertain
            if exclusiveStill != nil {
                finishExclusiveStillOnQueue(restoreFailure: failure)
            }
            return
        }
        if let exclusiveStill {
            switch exclusiveStill.phase {
            case .quiescing:
                startExclusiveSnapshotOnQueue()
            case .capturing:
                break
            case .restoring:
                beginDesiredOnQueue()
            }
            return
        }
        beginDesiredOnQueue()
    }

    private func beginExclusiveStillOnQueue(
        id: UUID,
        request: AOSDesktopPixelSnapshotRequest,
        completion: @escaping (Result<AOSDesktopPixelFrameSet, Error>) -> Void
    ) {
        defer { notifyStatusIfChangedOnQueue() }
        guard exclusiveStill == nil, !terminalFailure else {
            deliverExclusiveStillCompletion(completion, result: .failure(
                terminalFailure
                    ? AOSDesktopFrameCaptureFailure.retirementUncertain
                    : AOSDesktopFrameCaptureFailure.busy
            ))
            return
        }
        guard request.capturePolicy == .publicExplicitExclusions,
              aosDesktopPixelRequestIsValid(request) else {
            deliverExclusiveStillCompletion(
                completion,
                result: .failure(AOSDesktopFrameCaptureFailure.captureFailed)
            )
            return
        }
        exclusiveStill = ExclusiveStill(
            cancelWaiters: [],
            completion: completion,
            canceled: false,
            frozenPriorIdentity: desired?.sourceIdentity,
            id: id,
            operation: nil,
            phase: .quiescing,
            request: request,
            snapshotResult: nil
        )
        if retiring { return }
        if lease != nil || startup != nil {
            retireCurrentOnQueue()
        } else {
            startExclusiveSnapshotOnQueue()
        }
    }

    private func startExclusiveSnapshotOnQueue() {
        guard var transaction = exclusiveStill,
              transaction.phase == .quiescing else { return }
        if transaction.canceled {
            transaction.phase = .restoring
            transaction.snapshotResult = .failure(
                AOSDesktopFrameCaptureFailure.unauthorized
            )
            exclusiveStill = transaction
            beginExclusiveRestoreOnQueue()
            return
        }
        transaction.phase = .capturing
        state = .retiring
        exclusiveStill = transaction
        let id = transaction.id
        let operation = broker.snapshot(transaction.request) { [weak self] result in
            self?.queue.async {
                self?.exclusiveSnapshotSettledOnQueue(id: id, result: result)
            }
        }
        guard var current = exclusiveStill, current.id == id else {
            operation.cancel()
            return
        }
        current.operation = operation
        exclusiveStill = current
    }

    private func exclusiveSnapshotSettledOnQueue(
        id: UUID,
        result: Result<AOSDesktopPixelFrameSet, Error>
    ) {
        guard var transaction = exclusiveStill,
              transaction.id == id,
              transaction.phase == .capturing else { return }
        transaction.operation = nil
        transaction.snapshotResult = transaction.canceled
            ? .failure(AOSDesktopFrameCaptureFailure.unauthorized)
            : result
        transaction.phase = .restoring
        exclusiveStill = transaction
        if case .failure(let error) = result,
           error as? AOSDesktopFrameCaptureFailure == .retirementUncertain {
            terminalFailure = true
            state = .failed
            failure = .retirementUncertain
            finishExclusiveStillOnQueue(restoreFailure: .retirementUncertain)
            return
        }
        beginExclusiveRestoreOnQueue()
    }

    private func beginExclusiveRestoreOnQueue() {
        guard exclusiveStill?.phase == .restoring else { return }
        if terminalFailure {
            finishExclusiveStillOnQueue(restoreFailure: .retirementUncertain)
            return
        }
        guard desired != nil else {
            state = .idle
            failure = nil
            finishExclusiveStillOnQueue()
            return
        }
        beginDesiredOnQueue()
        if state == .failed {
            finishExclusiveStillOnQueue(
                restoreFailure: failure ?? .captureFailed
            )
        }
    }

    private func cancelExclusiveStillOnQueue(
        id: UUID,
        settled: @escaping (Result<Void, Error>) -> Void
    ) {
        guard var transaction = exclusiveStill, transaction.id == id else {
            settled(.success(()))
            return
        }
        transaction.cancelWaiters.append(settled)
        transaction.canceled = true
        transaction.snapshotResult = .failure(
            AOSDesktopFrameCaptureFailure.unauthorized
        )
        exclusiveStill = transaction
        guard transaction.phase == .capturing,
              let operation = transaction.operation else { return }
        if let retiring = operation as? AOSDesktopFrameRetirementAwaiting {
            retiring.cancelAndAwaitRetirement { [weak self] result in
                self?.queue.async {
                    guard var current = self?.exclusiveStill,
                          current.id == id else {
                        return
                    }
                    current.operation = nil
                    current.phase = .restoring
                    current.snapshotResult = .failure(
                        AOSDesktopFrameCaptureFailure.unauthorized
                    )
                    self?.exclusiveStill = current
                    if case .failure = result {
                        self?.terminalFailure = true
                        self?.failure = .retirementUncertain
                        self?.state = .failed
                    }
                    self?.beginExclusiveRestoreOnQueue()
                }
            }
        } else {
            operation.cancel()
        }
    }

    private func finishExclusiveStillOnQueue(
        restoreFailure: AOSDesktopFrameCaptureFailure? = nil
    ) {
        guard let transaction = exclusiveStill else { return }
        exclusiveStill = nil
        let result: Result<AOSDesktopPixelFrameSet, Error>
        let retirement: Result<Void, Error>
        if let restoreFailure {
            result = .failure(restoreFailure)
            retirement = .failure(restoreFailure)
        } else {
            result = transaction.snapshotResult
                ?? .failure(AOSDesktopFrameCaptureFailure.captureFailed)
            retirement = .success(())
        }
        deliverExclusiveStillCompletion(transaction.completion, result: result)
        transaction.cancelWaiters.forEach { waiter in
            DispatchQueue.global(qos: .userInitiated).async {
                waiter(retirement)
            }
        }
    }

    private func deliverExclusiveStillCompletion(
        _ completion: @escaping (Result<AOSDesktopPixelFrameSet, Error>) -> Void,
        result: Result<AOSDesktopPixelFrameSet, Error>
    ) {
        DispatchQueue.global(qos: .userInitiated).async {
            completion(result)
        }
    }

    private func statusOnQueue() -> AOSDesktopFrameWarmStatus {
        AOSDesktopFrameWarmStatus(
            displayCount: desired?.displayIDs.count ?? 0,
            errorCode: failure?.code,
            generation: generation,
            state: state
        )
    }

    private func notifyStatusIfChangedOnQueue() {
        let current = statusOnQueue()
        guard current != lastNotifiedStatus else { return }
        lastNotifiedStatus = current
        statusObserver?(current)
    }
}
