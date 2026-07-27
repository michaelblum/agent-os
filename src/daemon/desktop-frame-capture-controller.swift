import Foundation

struct AOSDesktopFrameCaptureAuthorization: Equatable {
    let canvasID: String
    let canvasGeneration: UInt64
    let extensionReference: AOSSceneExtensionReference
    let ownerID: String
    let resourceID: String
    let resourceRevision: Int
    let topologyGeneration: UInt64

    var leaseIdentity: AOSDesktopFrameLeaseIdentity {
        AOSDesktopFrameLeaseIdentity(
            canvasID: canvasID,
            canvasGeneration: canvasGeneration,
            extensionReference: extensionReference,
            ownerID: ownerID,
            resourceID: resourceID,
            resourceRevision: resourceRevision,
            topologyGeneration: topologyGeneration
        )
    }
}

struct AOSDesktopFrameCaptureResult {
    let data: Data
    let displayID: UInt32
    let height: Int
    let mimeType: String
    let width: Int
}

struct AOSDesktopFrameCaptureSetResult {
    let capturedAt: Date
    let durationMilliseconds: Int
    let frames: [AOSDesktopFrameCaptureResult]
}

struct AOSDesktopFrameCaptureRequest {
    let authorization: AOSDesktopFrameCaptureAuthorization
    let consumers: [AOSDesktopFrameConsumerIdentity]
    let requestID: String
}

struct AOSDesktopFrameWarmAuthorization: Equatable {
    let canvasGeneration: UInt64
    let topologyGeneration: UInt64
}

struct AOSDesktopFrameCaptureDelivery {
    let consumers: [AOSDesktopFrameConsumerIdentity]
    let epochID: String
    let payload: [String: Any]
    let requestID: String
}

struct AOSDesktopFrameCaptureAbort {
    let consumers: [AOSDesktopFrameConsumerIdentity]
    let payload: [String: Any]
    let requestID: String
}

enum AOSDesktopFrameCaptureOutcome {
    case available(AOSDesktopFrameCaptureDelivery)
    case rejected(request: AOSDesktopFrameCaptureRequest?, code: String)
}

protocol AOSDesktopFrameCapturing {
    @discardableResult
    func capture(
        displayIDs: [UInt32],
        excludingWindowIDs: [Int],
        maximumPixelsPerDisplay: Int,
        completion: @escaping (Result<AOSDesktopFrameCaptureSetResult, Error>) -> Void
    ) -> AOSDesktopFrameCancelling
}

protocol AOSDesktopFrameCanvasProviding: AnyObject {
    func desktopFrameCaptureContext(canvasID: String) -> AOSDesktopFrameCaptureContext?
}

extension CanvasManager: AOSDesktopFrameCanvasProviding {}

final class AOSDesktopFrameCaptureController {
    static let maximumPixelsPerDisplay =
        AOSDesktopPixelLimits.interactiveMaximumPixelsPerDisplay
    static let requestLifetime: TimeInterval = 2

    typealias Authorizer = (
        _ payload: [String: Any]
    ) -> AOSDesktopFrameCaptureAuthorization?
    typealias DeadlineScheduler = (
        _ delay: TimeInterval,
        _ action: @escaping () -> Void
    ) -> AOSDesktopFrameCancelling
    typealias LeaseAuthorizer = (AOSDesktopFrameLeaseIdentity) -> Bool
    typealias AbortHandler = (AOSDesktopFrameCaptureAbort) -> Void

    enum ReadyResult {
        case rejected
        case pending
        case commit(AOSDesktopFrameCaptureDelivery)
    }

    enum PresentedResult {
        case rejected
        case pending
        case complete(AOSDesktopFrameCaptureDelivery)
    }

    private struct ActiveRequest {
        let authorization: AOSDesktopFrameCaptureAuthorization
        var capture: AOSDesktopFrameCancelling
        let context: AOSDesktopFrameCaptureContext
        let consentGeneration: UInt64
        let consumers: [AOSDesktopFrameConsumerIdentity]
        var deadline: AOSDesktopFrameCancelling
        var epochID: String?
        let generation: UInt64
        var presentationStarted: Bool
        var presentedDisplays: Set<UInt32>
        var readyDisplays: Set<UInt32>
        let requestID: String
    }

    private let allowedCanvasID: String
    private let authorize: Authorizer
    private let canvasManager: AOSDesktopFrameCanvasProviding
    private let capturer: AOSDesktopFrameRuntimeCapturing
    private let consent: AOSDesktopFrameCaptureConsentController
    private let handleAbort: AbortHandler
    private let lock = NSLock()
    private let reauthorize: LeaseAuthorizer
    private let scheduleDeadline: DeadlineScheduler
    private let store: AOSDesktopFrameStore
    private var activeRequest: ActiveRequest?
    private var nextGeneration: UInt64 = 0

    init(
        canvasManager: AOSDesktopFrameCanvasProviding,
        store: AOSDesktopFrameStore,
        capturer: AOSDesktopFrameRuntimeCapturing = AOSNativeDesktopFrameCapturer(
            strategy: .prewarmedSnapshot
        ),
        consent: AOSDesktopFrameCaptureConsentController,
        allowedCanvasID: String = AOSDesktopWorldSceneTransportController.stageCanvasID,
        reauthorize: @escaping LeaseAuthorizer,
        handleAbort: @escaping AbortHandler = { _ in },
        scheduleDeadline: @escaping DeadlineScheduler = { delay, action in
            let work = DispatchWorkItem(block: action)
            DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
            return AOSDesktopFrameCancellation { work.cancel() }
        },
        authorize: @escaping Authorizer
    ) {
        self.allowedCanvasID = allowedCanvasID
        self.authorize = authorize
        self.canvasManager = canvasManager
        self.capturer = capturer
        self.consent = consent
        self.handleAbort = handleAbort
        self.reauthorize = reauthorize
        self.scheduleDeadline = scheduleDeadline
        self.store = store
    }

    private func captureContext(
        callerCanvasID: String,
        canvasGeneration: UInt64,
        topologyGeneration: UInt64,
        payload: [String: Any]? = nil
    ) -> AOSDesktopFrameCaptureContext? {
        guard let context = canvasManager.desktopFrameCaptureContext(
            canvasID: callerCanvasID
        ),
              context.consumers.count <= AOSDesktopPixelLimits.maximumDisplayCount,
              context.canvasID == callerCanvasID,
              context.canvasGeneration == canvasGeneration,
              context.topologyGeneration == topologyGeneration else {
            return nil
        }
        if let payload {
            guard let callerDisplay = (payload["segment_display_id"] as? NSNumber)?.uint32Value,
                  let callerIndex = (payload["segment_index"] as? NSNumber)?.intValue,
                  context.consumers.contains(where: {
                      $0.displayID == callerDisplay && $0.segmentIndex == callerIndex
                  }) else {
                return nil
            }
        }
        return context
    }

    private func warmConfiguration(
        _ context: AOSDesktopFrameCaptureContext
    ) -> AOSDesktopFrameWarmConfiguration {
        AOSDesktopFrameWarmConfiguration(
            canvasGeneration: context.canvasGeneration,
            displayIDs: context.displayIDs,
            excludingWindowIDs: context.excludingWindowIDs,
            maximumPixelsPerDisplay: Self.maximumPixelsPerDisplay,
            topologyGeneration: context.topologyGeneration
        )
    }

    func reconcileWarm(
        authorization: AOSDesktopFrameWarmAuthorization?
    ) {
        guard let authorization, consent.snapshot().status == .ready else {
            capturer.reconcileWarm(nil)
            return
        }
        guard let context = captureContext(
            callerCanvasID: allowedCanvasID,
            canvasGeneration: authorization.canvasGeneration,
            topologyGeneration: authorization.topologyGeneration
        ) else {
            capturer.reconcileWarm(nil)
            return
        }
        capturer.reconcileWarm(warmConfiguration(context))
    }

    func warmStatus() -> AOSDesktopFrameWarmStatus? {
        capturer.warmStatus()
    }

    func setWarmStatusObserver(
        _ observer: ((AOSDesktopFrameWarmStatus) -> Void)?
    ) {
        capturer.setWarmStatusObserver(observer)
    }

    private func finish(
        generation: UInt64,
        releaseEpoch: Bool,
        notifyConsumers: Bool
    ) -> Bool {
        lock.lock()
        guard let active = activeRequest, active.generation == generation else {
            lock.unlock()
            return false
        }
        activeRequest = nil
        lock.unlock()
        active.capture.cancel()
        active.deadline.cancel()
        consent.releaseRuntimeCapture(generation: active.consentGeneration)
        if notifyConsumers {
            var payload: [String: Any] = [
                "extension": active.authorization.extensionReference.dictionary,
                "owner": active.authorization.ownerID,
                "resource": active.authorization.resourceID,
                "revision": active.authorization.resourceRevision,
            ]
            if let epochID = active.epochID { payload["epoch_id"] = epochID }
            handleAbort(AOSDesktopFrameCaptureAbort(
                consumers: active.consumers,
                payload: payload,
                requestID: active.requestID
            ))
        }
        if releaseEpoch, let epochID = active.epochID {
            _ = store.release(epochID: epochID, ownerCanvasID: active.authorization.canvasID)
        }
        return true
    }

    private func deadlineExpired(generation: UInt64) {
        _ = finish(
            generation: generation,
            releaseEpoch: true,
            notifyConsumers: true
        )
    }

    private func installCapture(
        _ capture: AOSDesktopFrameCancelling,
        generation: UInt64
    ) {
        lock.lock()
        guard activeRequest?.generation == generation else {
            lock.unlock()
            capture.cancel()
            return
        }
        activeRequest?.capture = capture
        lock.unlock()
    }

    private func installDeadline(
        _ deadline: AOSDesktopFrameCancelling,
        generation: UInt64
    ) {
        lock.lock()
        guard activeRequest?.generation == generation else {
            lock.unlock()
            deadline.cancel()
            return
        }
        activeRequest?.deadline = deadline
        lock.unlock()
    }

    private func remainsActive(generation: UInt64) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return activeRequest?.generation == generation
    }

    func acquire(
        callerCanvasID: String,
        payload: [String: Any],
        admitted: (AOSDesktopFrameCaptureRequest) -> Bool,
        completion: @escaping (AOSDesktopFrameCaptureOutcome) -> Void
    ) {
        guard callerCanvasID == allowedCanvasID,
              let requestID = payload["request_id"] as? String,
              !requestID.isEmpty,
              requestID.utf8.count <= 128,
              let authorization = authorize(payload),
              authorization.canvasID == callerCanvasID,
              let initialContext = captureContext(
                  callerCanvasID: callerCanvasID,
                  canvasGeneration: authorization.canvasGeneration,
                  topologyGeneration: authorization.topologyGeneration,
                  payload: payload
              ) else {
            completion(.rejected(
                request: nil,
                code: AOSDesktopFrameCaptureFailure.unauthorized.code
            ))
            return
        }

        let initialConsumers = initialContext.consumers
        let request = AOSDesktopFrameCaptureRequest(
            authorization: authorization,
            consumers: initialConsumers,
            requestID: requestID
        )
        let consentGeneration: UInt64
        switch consent.claimRuntimeCapture() {
        case .admitted(let generation):
            consentGeneration = generation
        case .rejected(let failure):
            completion(.rejected(
                request: request,
                code: failure.code
            ))
            return
        }

        lock.lock()
        guard activeRequest == nil else {
            lock.unlock()
            consent.releaseRuntimeCapture(generation: consentGeneration)
            completion(.rejected(
                request: request,
                code: AOSDesktopFrameCaptureFailure.busy.code
            ))
            return
        }
        nextGeneration &+= 1
        if nextGeneration == 0 { nextGeneration = 1 }
        let generation = nextGeneration
        activeRequest = ActiveRequest(
            authorization: authorization,
            capture: AOSDesktopFrameCancellation(),
            context: initialContext,
            consentGeneration: consentGeneration,
            consumers: initialConsumers,
            deadline: AOSDesktopFrameCancellation(),
            epochID: nil,
            generation: generation,
            presentationStarted: false,
            presentedDisplays: [],
            readyDisplays: [],
            requestID: requestID
        )
        lock.unlock()

        guard admitted(request) else {
            _ = finish(
                generation: generation,
                releaseEpoch: true,
                notifyConsumers: false
            )
            completion(.rejected(
                request: request,
                code: AOSDesktopFrameCaptureFailure.unauthorized.code
            ))
            return
        }
        installDeadline(scheduleDeadline(Self.requestLifetime) { [weak self] in
            self?.deadlineExpired(generation: generation)
        }, generation: generation)
        guard remainsActive(generation: generation) else { return }

        let captureTask = capturer.capturePrewarmed(
            warmConfiguration(initialContext)
        ) { [weak self] result in
            guard let self else { return }
            do {
                let capture = try result.get()
                guard self.authorize(payload) == authorization,
                      self.reauthorize(authorization.leaseIdentity),
                      let currentContext = self.captureContext(
                          callerCanvasID: callerCanvasID,
                          canvasGeneration: authorization.canvasGeneration,
                          topologyGeneration: authorization.topologyGeneration,
                          payload: payload
                      ),
                      currentContext == initialContext,
                      capture.frames.count == initialConsumers.count,
                      capture.frames.reduce(into: 0, { $0 += $1.data.count })
                          <= AOSDesktopFrameStore.maximumEncodedBytes,
                      Set(capture.frames.map(\.displayID)) == Set(initialConsumers.map(\.displayID)) else {
                    throw AOSDesktopFrameCaptureFailure.unauthorized
                }
                let currentConsumers = currentContext.consumers
                let epochID = UUID().uuidString.lowercased()
                let frameByDisplay = Dictionary(
                    uniqueKeysWithValues: capture.frames.map { ($0.displayID, $0) }
                )
                self.lock.lock()
                guard self.activeRequest?.generation == generation else {
                    self.lock.unlock()
                    throw AOSDesktopFrameCaptureFailure.unauthorized
                }
                do {
                    let storeFrames = try currentConsumers.map { consumer in
                        guard let frame = frameByDisplay[consumer.displayID] else {
                            throw AOSDesktopFrameCaptureFailure.displayNotFound
                        }
                        return AOSDesktopFrameStoreFrame(
                            consumer: consumer,
                            data: frame.data,
                            height: frame.height,
                            mimeType: frame.mimeType,
                            width: frame.width
                        )
                    }
                    let leases = try self.store.insertEpoch(
                        frames: storeFrames,
                        leaseIdentity: authorization.leaseIdentity,
                        ownerCanvasID: callerCanvasID,
                        epochID: epochID
                    )
                    self.activeRequest?.epochID = epochID
                    self.lock.unlock()
                    let leaseByDisplay = Dictionary(
                        uniqueKeysWithValues: zip(currentConsumers, leases).map {
                            ($0.0.displayID, ($0.0, $0.1))
                        }
                    )
                    completion(.available(AOSDesktopFrameCaptureDelivery(
                        consumers: currentConsumers,
                        epochID: epochID,
                        payload: [
                            "capture_duration_ms": capture.durationMilliseconds,
                            "captured_at_epoch_ms": Int(
                                capture.capturedAt.timeIntervalSince1970 * 1_000
                            ),
                            "epoch_id": epochID,
                            "extension": authorization.extensionReference.dictionary,
                            "frames": currentConsumers.compactMap {
                                consumer -> [String: Any]? in
                                guard let pair = leaseByDisplay[consumer.displayID] else {
                                    return nil
                                }
                                return [
                                    "display_id": Int(consumer.displayID),
                                    "segment_index": consumer.segmentIndex,
                                    "handle": pair.1.handle,
                                    "height": pair.1.height,
                                    "mime_type": pair.1.mimeType,
                                    "url": pair.1.url,
                                    "width": pair.1.width,
                                ]
                            },
                            "owner": authorization.ownerID,
                            "resource": authorization.resourceID,
                            "revision": authorization.resourceRevision,
                        ],
                        requestID: requestID
                    )))
                } catch {
                    self.lock.unlock()
                    _ = self.store.release(epochID: epochID, ownerCanvasID: callerCanvasID)
                    throw error
                }
            } catch {
                if let failure = error as? AOSDesktopFrameCaptureFailure,
                   failure == .permissionDenied {
                    self.consent.invalidatePermission()
                    self.capturer.reconcileWarm(nil)
                }
                if self.finish(
                    generation: generation,
                    releaseEpoch: true,
                    notifyConsumers: false
                ) {
                    completion(.rejected(
                        request: request,
                        code: (error as? AOSDesktopFrameCaptureFailure)?.code
                            ?? AOSDesktopFrameCaptureFailure.captureFailed.code
                    ))
                }
            }
        }
        installCapture(captureTask, generation: generation)
    }

    func ready(callerCanvasID: String, payload: [String: Any]) -> ReadyResult {
        guard callerCanvasID == allowedCanvasID,
              let requestID = payload["request_id"] as? String,
              let epochID = payload["epoch_id"] as? String,
              let displayID = (payload["segment_display_id"] as? NSNumber)?.uint32Value,
              let segmentIndex = (payload["segment_index"] as? NSNumber)?.intValue,
              let canvasGeneration = (payload["canvas_generation"] as? NSNumber)?.uint64Value,
              let topologyGeneration = (payload["topology_generation"] as? NSNumber)?.uint64Value else {
            return .rejected
        }
        lock.lock()
        guard let observed = activeRequest,
              observed.requestID == requestID,
              observed.epochID == epochID,
              observed.authorization.canvasGeneration == canvasGeneration,
              observed.authorization.topologyGeneration == topologyGeneration,
              observed.consumers.contains(where: {
                  $0.displayID == displayID && $0.segmentIndex == segmentIndex
              }) else {
            lock.unlock()
            return .rejected
        }
        guard !observed.presentationStarted,
              reauthorize(observed.authorization.leaseIdentity),
              captureContext(
                  callerCanvasID: callerCanvasID,
                  canvasGeneration: observed.authorization.canvasGeneration,
                  topologyGeneration: observed.authorization.topologyGeneration
              ) == observed.context else {
            let generation = observed.generation
            lock.unlock()
            _ = finish(
                generation: generation,
                releaseEpoch: true,
                notifyConsumers: true
            )
            return .rejected
        }
        var active = observed
        active.readyDisplays.insert(displayID)
        guard active.readyDisplays.count == active.consumers.count else {
            activeRequest = active
            lock.unlock()
            return .pending
        }
        active.presentationStarted = true
        activeRequest = active
        lock.unlock()
        return .commit(AOSDesktopFrameCaptureDelivery(
            consumers: active.consumers,
            epochID: epochID,
            payload: [
                "committed_at_epoch_ms": Int(Date().timeIntervalSince1970 * 1_000),
                "epoch_id": epochID,
                "extension": active.authorization.extensionReference.dictionary,
                "owner": active.authorization.ownerID,
                "resource": active.authorization.resourceID,
                "revision": active.authorization.resourceRevision,
            ],
            requestID: requestID
        ))
    }

    func presented(callerCanvasID: String, payload: [String: Any]) -> PresentedResult {
        guard callerCanvasID == allowedCanvasID,
              let requestID = payload["request_id"] as? String,
              let epochID = payload["epoch_id"] as? String,
              let displayID = (payload["segment_display_id"] as? NSNumber)?.uint32Value,
              let segmentIndex = (payload["segment_index"] as? NSNumber)?.intValue,
              let canvasGeneration = (payload["canvas_generation"] as? NSNumber)?.uint64Value,
              let topologyGeneration = (payload["topology_generation"] as? NSNumber)?.uint64Value else {
            return .rejected
        }
        lock.lock()
        guard var active = activeRequest,
              active.presentationStarted,
              active.requestID == requestID,
              active.epochID == epochID,
              active.authorization.canvasGeneration == canvasGeneration,
              active.authorization.topologyGeneration == topologyGeneration,
              active.consumers.contains(where: {
                  $0.displayID == displayID && $0.segmentIndex == segmentIndex
              }),
              reauthorize(active.authorization.leaseIdentity),
              captureContext(
                  callerCanvasID: callerCanvasID,
                  canvasGeneration: active.authorization.canvasGeneration,
                  topologyGeneration: active.authorization.topologyGeneration
              ) == active.context else {
            let generation = activeRequest?.generation
            lock.unlock()
            if let generation {
                _ = finish(
                    generation: generation,
                    releaseEpoch: true,
                    notifyConsumers: true
                )
            }
            return .rejected
        }
        active.presentedDisplays.insert(displayID)
        guard active.presentedDisplays.count == active.consumers.count else {
            activeRequest = active
            lock.unlock()
            return .pending
        }
        let delivery = AOSDesktopFrameCaptureDelivery(
            consumers: active.consumers,
            epochID: epochID,
            payload: [
                "epoch_id": epochID,
                "extension": active.authorization.extensionReference.dictionary,
                "owner": active.authorization.ownerID,
                "resource": active.authorization.resourceID,
                "revision": active.authorization.resourceRevision,
            ],
            requestID: requestID
        )
        activeRequest = nil
        lock.unlock()
        active.capture.cancel()
        active.deadline.cancel()
        consent.releaseRuntimeCapture(generation: active.consentGeneration)
        return .complete(delivery)
    }

    @discardableResult
    func cancelUnauthorized() -> Bool {
        lock.lock()
        guard let active = activeRequest,
              !reauthorize(active.authorization.leaseIdentity) else {
            lock.unlock()
            return false
        }
        let generation = active.generation
        lock.unlock()
        return finish(
            generation: generation,
            releaseEpoch: true,
            notifyConsumers: true
        )
    }

    @discardableResult
    func cancel(callerCanvasID: String, payload: [String: Any]) -> Bool {
        guard callerCanvasID == allowedCanvasID,
              let requestID = payload["request_id"] as? String else { return false }
        lock.lock()
        guard let generation = activeRequest?.generation,
              activeRequest?.requestID == requestID else {
            lock.unlock()
            return false
        }
        lock.unlock()
        return finish(
            generation: generation,
            releaseEpoch: true,
            notifyConsumers: true
        )
    }

    @discardableResult
    func release(_ delivery: AOSDesktopFrameCaptureDelivery) -> Int {
        store.release(epochID: delivery.epochID, ownerCanvasID: allowedCanvasID)
    }

    @discardableResult
    func release(callerCanvasID: String, payload: [String: Any]) -> Bool {
        guard callerCanvasID == allowedCanvasID,
              let handle = payload["handle"] as? String else { return false }
        return store.release(handle: handle, ownerCanvasID: callerCanvasID)
    }

    @discardableResult
    func releaseAll(callerCanvasID: String) -> Int {
        guard callerCanvasID == allowedCanvasID else { return 0 }
        lock.lock()
        let active = activeRequest
        activeRequest = nil
        lock.unlock()
        active?.capture.cancel()
        active?.deadline.cancel()
        if let active {
            consent.releaseRuntimeCapture(generation: active.consentGeneration)
        }
        if let active {
            var payload: [String: Any] = [
                "extension": active.authorization.extensionReference.dictionary,
                "owner": active.authorization.ownerID,
                "resource": active.authorization.resourceID,
                "revision": active.authorization.resourceRevision,
            ]
            if let epochID = active.epochID { payload["epoch_id"] = epochID }
            handleAbort(AOSDesktopFrameCaptureAbort(
                consumers: active.consumers,
                payload: payload,
                requestID: active.requestID
            ))
        }
        return store.releaseAll(ownerCanvasID: callerCanvasID)
    }
}
