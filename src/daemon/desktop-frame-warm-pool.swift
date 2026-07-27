import Foundation

private struct AOSDesktopFrameWarmSourceIdentity: Equatable {
    let canvasGeneration: UInt64
    let displayIDs: [UInt32]
    let excludingWindowIDs: [Int]
    let maximumPixelsPerDisplay: Int
    let topologyGeneration: UInt64
}

struct AOSDesktopFrameWarmConfiguration: Equatable {
    let canvasGeneration: UInt64
    let displayIDs: [UInt32]
    let excludingWindowIDs: [Int]
    let maximumPixelsPerDisplay: Int
    let topologyGeneration: UInt64

    fileprivate var sourceIdentity: AOSDesktopFrameWarmSourceIdentity {
        AOSDesktopFrameWarmSourceIdentity(
            canvasGeneration: canvasGeneration,
            displayIDs: displayIDs,
            excludingWindowIDs: Array(Set(excludingWindowIDs)).sorted(),
            maximumPixelsPerDisplay: maximumPixelsPerDisplay,
            topologyGeneration: topologyGeneration
        )
    }

    var request: AOSDesktopPixelSnapshotRequest {
        AOSDesktopPixelSnapshotRequest(
            displayIDs: displayIDs,
            excludingWindowIDs: excludingWindowIDs,
            maximumPixelsPerDisplay: maximumPixelsPerDisplay
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

enum AOSDesktopFrameWarmCaptureAdmission {
    case admitted(AOSDesktopFrameCancelling)
    case notConfigured
    case unavailable(AOSDesktopFrameCaptureFailure)
}

final class AOSDesktopFrameWarmPool: AOSDesktopFrameWarmPreparing {
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
            ownerID: ownerID
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
        }
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
            return
        }
        beginDesiredOnQueue()
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
