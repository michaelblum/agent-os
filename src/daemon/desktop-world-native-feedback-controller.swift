import Foundation

private let aosDesktopWorldNativeFeedbackDeadlineQueue = DispatchQueue(
    label: "io.agent-os.desktop-world.native-feedback.deadline",
    qos: .userInitiated
)

final class AOSDesktopWorldNativeFeedbackController {
    typealias Active = AOSDesktopWorldNativeFeedbackAdmission.Active

    private enum PreparationCompletion {
        case failed
        case ready
        case retry([AOSDesktopWorldNativeEffectProgram])
        case stale
    }

    private static let captureTimeout: TimeInterval = 0.75
    private static let effectCleanupGrace: TimeInterval = 0.25
    private static let gestureEffectWatchdog: TimeInterval = 300
    private static let retirementRetryDelay: TimeInterval = 0.05
    private static let maximumDiagnosticCount = 1_000_000_000

    let admission = AOSDesktopWorldNativeFeedbackAdmission()
    private var activeInstanceCount = 0
    private var activeSheetCount = 0
    private var acceptedCount = 0
    let authorize: (AOSDesktopWorldNativeEffectRequest) -> Bool
    private var attemptedCount = 0
    private let capturer: AOSDesktopPixelFrameSetCapturing
    private var completedCount = 0
    private var disposedCount = 0
    private var desiredPrograms: [AOSDesktopWorldNativeEffectProgram] = []
    private var failedCount = 0
    let host: AOSDesktopWorldNativeFeedbackHosting
    private var lastErrorCode: String?
    private var lastOwnerID: String?
    private var lastPresentationLatencyMilliseconds: Int?
    private var lastRenderBackingPixelCount: Int?
    private var lastRenderBackingPixelPercentage: Double?
    private var lastRenderTriangleCount: Int?
    private var lastProgramDigest: String?
    private var lastProgramID: String?
    private var lastProgramRevision: Int?
    private var lastResourceID: String?
    private var lastResourceRevision: Int?
    let lock = NSLock()
    private var availabilityGeneration: UInt64 = 0
    var available = false
    var prepared = false
    private var preparedProgramDigests = Set<String>()
    private let preparationTransitionLock = NSLock()
    private var preparing = false
    private var presentedCount = 0
    private var rejectedCount = 0
    private var retainedBufferCount = 0
    private var retainedTextureCount = 0
    private var retainedViewCount = 0
    private let scheduleDeadline: (TimeInterval, DispatchWorkItem) -> Void
    var stopped = false
    @MainActor var runtime: AOSDesktopWorldNativeFeedbackRuntime?
    @MainActor private var runtimeIdentity: (
        canvasGeneration: UInt64,
        topologyGeneration: UInt64,
        sheet: AOSDesktopWorldResourceIdentity
    )?
    @MainActor private var retirementAttemptCount = 0
    @MainActor private var retirementRetryDeadline: DispatchWorkItem?
    @MainActor private var retirementTerminal = false

    init(
        host: AOSDesktopWorldNativeFeedbackHosting,
        capturer: AOSDesktopPixelFrameSetCapturing,
        scheduleDeadline: @escaping (TimeInterval, DispatchWorkItem) -> Void = {
            delay, timeout in
            aosDesktopWorldNativeFeedbackDeadlineQueue.asyncAfter(
                deadline: .now() + delay,
                execute: timeout
            )
        },
        authorize: @escaping (AOSDesktopWorldNativeEffectRequest) -> Bool
    ) {
        self.authorize = authorize
        self.capturer = capturer
        self.host = host
        self.scheduleDeadline = scheduleDeadline
    }

    func recordAcceptance(_ request: AOSDesktopWorldNativeEffectRequest) {
        lock.lock()
        acceptedCount = Self.increment(acceptedCount)
        lastOwnerID = request.ownerID
        lastPresentationLatencyMilliseconds = nil
        lastRenderBackingPixelCount = nil
        lastRenderBackingPixelPercentage = nil
        lastRenderTriangleCount = nil
        lastProgramDigest = request.binding.program?.digest
        lastProgramID = request.binding.program?.id
        lastProgramRevision = request.binding.program?.revision
        lastResourceID = request.resourceID
        lastResourceRevision = request.resourceRevision
        lastErrorCode = nil
        lock.unlock()
    }

    func recordAttempt() {
        lock.lock()
        attemptedCount = Self.increment(attemptedCount)
        lock.unlock()
    }

    func startCapture(
        request _: AOSDesktopWorldNativeEffectRequest,
        configuration: AOSDesktopFrameWarmConfiguration,
        generation: UInt64
    ) {
        let capture = capturer.capturePrewarmedFrames(configuration) {
            [weak self] result in
            self?.captureCompleted(
                generation: generation,
                result: result
            )
        }
        installCapture(capture, generation: generation)
        let timeout = DispatchWorkItem { [weak self] in
            self?.captureTimedOut(generation: generation)
        }
        installDeadline(timeout, generation: generation)
        scheduleDeadline(Self.captureTimeout, timeout)
    }

    func snapshot() -> AOSDesktopWorldNativeFeedbackSnapshot {
        lock.lock()
        defer { lock.unlock() }
        return AOSDesktopWorldNativeFeedbackSnapshot(
            activeInstanceCount: activeInstanceCount,
            activeSheetCount: activeSheetCount,
            acceptedCount: acceptedCount,
            attemptedCount: attemptedCount,
            completedCount: completedCount,
            disposedCount: disposedCount,
            failedCount: failedCount,
            lastErrorCode: lastErrorCode,
            lastOwnerID: lastOwnerID,
            lastPresentationLatencyMilliseconds:
                lastPresentationLatencyMilliseconds,
            lastRenderBackingPixelCount: lastRenderBackingPixelCount,
            lastRenderBackingPixelPercentage: lastRenderBackingPixelPercentage,
            lastRenderTriangleCount: lastRenderTriangleCount,
            lastProgramDigest: lastProgramDigest,
            lastProgramID: lastProgramID,
            lastProgramRevision: lastProgramRevision,
            lastResourceID: lastResourceID,
            lastResourceRevision: lastResourceRevision,
            presentedCount: presentedCount,
            rejectedCount: rejectedCount,
            retainedBufferCount: retainedBufferCount,
            retainedTextureCount: retainedTextureCount,
            retainedViewCount: retainedViewCount,
            state: stateLocked()
        )
    }

    func reconcileAuthorization() {
        let requests = admission.requests()
        if requests.contains(where: { !authorize($0) }) { cancelAll() }
    }

    func reconcileAvailability(
        _ nextAvailable: Bool,
        programs: [AOSDesktopWorldNativeEffectProgram] = []
    ) {
        preparationTransitionLock.lock()
        defer { preparationTransitionLock.unlock() }
        lock.lock()
        guard !stopped else {
            lock.unlock()
            return
        }
        if !nextAvailable {
            availabilityGeneration &+= 1
            if availabilityGeneration == 0 { availabilityGeneration = 1 }
            available = false
            prepared = false
            admission.setGate(available: false, prepared: false)
            desiredPrograms = []
            preparedProgramDigests.removeAll(keepingCapacity: false)
            preparing = false
            lock.unlock()
            cancelAll(releasePreparedResources: true)
            return
        }
        available = true
        admission.setGate(available: true, prepared: prepared)
        desiredPrograms = programs
        let requestedDigests = Set(programs.map(\.digest))
        guard !preparing,
              !prepared || requestedDigests != preparedProgramDigests else {
            lock.unlock()
            return
        }
        availabilityGeneration &+= 1
        if availabilityGeneration == 0 { availabilityGeneration = 1 }
        let generation = availabilityGeneration
        prepared = false
        admission.setGate(available: true, prepared: false)
        preparing = true
        lock.unlock()

        host.prepare(programs: programs) { [weak self] result in
            Task { @MainActor [weak self] in
                self?.preparationCompleted(
                    generation: generation,
                    programs: programs,
                    result: result
                )
            }
        }
    }

    func cancelAll(releasePreparedResources: Bool = false) {
        lock.lock()
        guard !stopped else {
            lock.unlock()
            return
        }
        let resourceReleaseGeneration = releasePreparedResources
            ? availabilityGeneration
            : nil
        lock.unlock()
        let cancellation = admission.cancelAll()
        let retired = cancellation.retired
        let shouldRetireRuntime = cancellation.shouldRetireRuntime
        retired?.capture.cancel()
        retired?.deadline.cancel()
        guard shouldRetireRuntime || releasePreparedResources else { return }
        Task { @MainActor [weak self] in
            guard let self else { return }
            guard !self.retirementTerminal else { return }
            self.requestRuntimeRetirement()
            if let resourceReleaseGeneration,
               self.shouldReleasePreparedResources(
                generation: resourceReleaseGeneration
               ) {
                self.host.releasePreparedResources()
            }
        }
    }

    func shutdown() {
        preparationTransitionLock.lock()
        lock.lock()
        guard !stopped else {
            lock.unlock()
            preparationTransitionLock.unlock()
            return
        }
        stopped = true
        available = false
        prepared = false
        desiredPrograms = []
        preparedProgramDigests.removeAll(keepingCapacity: false)
        preparing = false
        availabilityGeneration &+= 1
        let retired = admission.stop()
        lock.unlock()
        preparationTransitionLock.unlock()
        retired?.capture.cancel()
        retired?.deadline.cancel()
        if Thread.isMainThread {
            MainActor.assumeIsolated { shutdownOnMain() }
        } else {
            DispatchQueue.main.sync {
                MainActor.assumeIsolated { shutdownOnMain() }
            }
        }
    }

    @MainActor
    private func shutdownOnMain() {
        guard !retirementTerminal else { return }
        retirementTerminal = true
        retirementRetryDeadline?.cancel()
        retirementRetryDeadline = nil
        if retirementAttemptCount < 2 {
            retirementAttemptCount += 1
            _ = disposeRuntime()
        }
        host.shutdown()
    }

    private func installCapture(
        _ capture: AOSDesktopFrameCancelling,
        generation: UInt64
    ) {
        guard admission.installCapture(capture, generation: generation) else {
            capture.cancel()
            return
        }
    }

    private func installDeadline(
        _ deadline: DispatchWorkItem,
        generation: UInt64
    ) {
        guard let previous = admission.installDeadline(
            deadline,
            generation: generation
        ) else {
            deadline.cancel()
            return
        }
        previous.cancel()
    }

    private func captureTimedOut(generation: UInt64) {
        guard let retired = retireActive(
            generation: generation,
            allowedPhases: [.capturing, .installing],
            requiresRuntimeDisposal: true
        ) else { return }
        recordFailure("NATIVE_EFFECT_CAPTURE_TIMEOUT")
        retired.capture.cancel()
        Task { @MainActor [weak self] in
            self?.requestRuntimeRetirement()
        }
    }

    private func captureCompleted(
        generation: UInt64,
        result: Result<AOSDesktopPixelFrameSet, Error>
    ) {
        guard let request = admission.request(generation: generation) else { return }
        guard case .success(let frames) = result else {
            if case .failure(let error) = result {
                recordFailure(Self.failureCode(
                    error,
                    fallback: "NATIVE_EFFECT_CAPTURE_FAILED"
                ))
            }
            _ = retireActive(
                generation: generation,
                allowedPhases: [.capturing],
                requiresRuntimeDisposal: false
            )
            return
        }
        guard authorize(request) else {
            recordFailure("NATIVE_EFFECT_UNAUTHORIZED")
            _ = retireActive(
                generation: generation,
                allowedPhases: [.capturing],
                requiresRuntimeDisposal: false
            )
            return
        }
        Task { @MainActor [weak self] in
            self?.present(
                generation: generation,
                frames: frames
            )
        }
    }

    @MainActor
    private func present(
        generation: UInt64,
        frames: AOSDesktopPixelFrameSet
    ) {
        guard let request = activeRequest(generation: generation),
              authorize(request),
              let captureContext = host.captureContext(),
              captureContext.canvasGeneration == request.canvasGeneration,
              captureContext.topologyGeneration == request.topologyGeneration,
              captureContext.displayIDs.count == frames.frames.count,
              Set(captureContext.displayIDs) == Set(frames.frames.map(\.displayID)) else {
            recordFailure("NATIVE_EFFECT_FRAME_SET_MISMATCH")
            _ = retireActive(
                generation: generation,
                allowedPhases: [.capturing],
                requiresRuntimeDisposal: false
            )
            return
        }
        guard transitionActive(
            generation: generation,
            from: .capturing,
            to: .installing
        ) else { return }
        do {
            let outcome = try host.install(
                request: request,
                frames: frames
            )
            retirementAttemptCount = 0
            retirementRetryDeadline?.cancel()
            retirementRetryDeadline = nil
            let installation: AOSDesktopWorldNativeFeedbackInstallation
            switch outcome {
            case .installed(let value):
                installation = value
            case .rollbackRequired(let identity, let error):
                runtimeIdentity = (
                    request.canvasGeneration,
                    request.topologyGeneration,
                    identity
                )
                lock.lock()
                activeInstanceCount = 0
                activeSheetCount = 1
                retainedBufferCount = 0
                retainedTextureCount = 0
                retainedViewCount = 0
                lock.unlock()
                recordFailure(Self.failureCode(
                    error,
                    fallback: "NATIVE_EFFECT_INSTALL_FAILED"
                ))
                if retireActive(
                    generation: generation,
                    allowedPhases: [.installing],
                    requiresRuntimeDisposal: true
                ) != nil {
                    requestRuntimeRetirement()
                }
                return
            }
            runtimeIdentity = (
                request.canvasGeneration,
                request.topologyGeneration,
                installation.identity
            )
            runtime = installation.runtime
            if let latest = activeRequest(generation: generation) {
                installation.runtime.update(inputs: latest.inputs)
            }
            lock.lock()
            activeInstanceCount = 1
            activeSheetCount = 1
            retainedBufferCount = min(
                max(installation.runtime.retainedBufferCount, 0),
                Self.maximumDiagnosticCount
            )
            retainedTextureCount = min(
                max(installation.runtime.retainedTextureCount, 0),
                Self.maximumDiagnosticCount
            )
            retainedViewCount = min(
                max(installation.runtime.retainedViewCount, 0),
                Self.maximumDiagnosticCount
            )
            lastRenderBackingPixelCount = min(
                max(installation.runtime.renderBackingPixelCount, 0),
                Self.maximumDiagnosticCount
            )
            lastRenderBackingPixelPercentage = min(
                100,
                max(0, installation.runtime.renderBackingPixelPercentage)
            )
            lastRenderTriangleCount = min(
                max(installation.runtime.renderTriangleCount, 0),
                Self.maximumDiagnosticCount
            )
            lock.unlock()
            guard transitionActive(
                generation: generation,
                from: .installing,
                to: .presenting
            ) else {
                requestRuntimeRetirement()
                return
            }
            installation.runtime.present(
                onPresented: { [weak self] in
                    self?.effectPresented(generation: generation)
                },
                onFailure: { [weak self] code in
                    self?.effectFailed(generation: generation, code: code)
                },
                onComplete: { [weak self] in
                    self?.effectCompleted(generation: generation)
                }
            )
            let cleanup = DispatchWorkItem { [weak self] in
                self?.effectTimedOut(generation: generation)
            }
            installDeadline(cleanup, generation: generation)
            let lifetime = request.binding.lifecycle == .gesture
                ? Self.gestureEffectWatchdog
                : Double(request.binding.durationMilliseconds) / 1_000
                    + Self.effectCleanupGrace
            scheduleDeadline(lifetime, cleanup)
        } catch {
            recordFailure(Self.failureCode(
                error,
                fallback: "NATIVE_EFFECT_INSTALL_FAILED"
            ))
            if retireActive(
                generation: generation,
                allowedPhases: [.installing],
                requiresRuntimeDisposal: true
            ) != nil {
                requestRuntimeRetirement()
            }
        }
    }

    @MainActor
    private func effectPresented(generation: UInt64) {
        let presentation = admission.presentation(
            generation: generation,
            markPresented: true
        )
        guard presentation.didPresent,
              let triggeredAt = presentation.triggeredAt else { return }
        lock.lock()
        presentedCount = Self.increment(presentedCount)
        lastPresentationLatencyMilliseconds = min(
            max(Int(
                (ProcessInfo.processInfo.systemUptime - triggeredAt) * 1_000
            ), 0),
            Self.maximumDiagnosticCount
        )
        lock.unlock()
    }

    @MainActor
    private func effectFailed(generation: UInt64, code: String) {
        guard retireActive(
            generation: generation,
            allowedPhases: [.presenting],
            requiresRuntimeDisposal: true
        ) != nil else { return }
        recordFailure(code)
        requestRuntimeRetirement()
    }

    @MainActor
    private func effectCompleted(generation: UInt64) {
        guard admission.presentation(
            generation: generation,
            markPresented: false
        ).didPresent else {
            effectFailed(
                generation: generation,
                code: "NATIVE_EFFECT_COMPLETED_WITHOUT_PRESENTATION"
            )
            return
        }
        guard retireActive(
            generation: generation,
            allowedPhases: [.presenting],
            requiresRuntimeDisposal: true
        ) != nil else { return }
        lock.lock()
        completedCount = Self.increment(completedCount)
        lastErrorCode = nil
        lock.unlock()
        requestRuntimeRetirement()
    }

    private func effectTimedOut(generation: UInt64) {
        guard let retired = retireActive(
            generation: generation,
            allowedPhases: [.presenting],
            requiresRuntimeDisposal: true
        ) else { return }
        recordFailure(
            retired.request.binding.lifecycle == .gesture
                ? "NATIVE_EFFECT_GESTURE_TIMEOUT"
                : "NATIVE_EFFECT_PRESENT_TIMEOUT"
        )
        retired.capture.cancel()
        Task { @MainActor [weak self] in
            self?.requestRuntimeRetirement()
        }
    }

    @MainActor
    private func disposeRuntime() -> Bool {
        let retiredRuntime = runtime
        retiredRuntime?.dispose()
        let retiredIdentity = runtimeIdentity
        var sheetRemoved = true
        if let identity = retiredIdentity {
            sheetRemoved = host.remove(
                canvasGeneration: identity.canvasGeneration,
                topologyGeneration: identity.topologyGeneration,
                identity: identity.sheet
            )
        }
        if sheetRemoved { runtimeIdentity = nil }
        let retainedBuffers = min(
            max(retiredRuntime?.retainedBufferCount ?? 0, 0),
            Self.maximumDiagnosticCount
        )
        let retainedTextures = min(
            max(retiredRuntime?.retainedTextureCount ?? 0, 0),
            Self.maximumDiagnosticCount
        )
        let retainedViews = min(
            max(retiredRuntime?.retainedViewCount ?? 0, 0),
            Self.maximumDiagnosticCount
        )
        lock.lock()
        activeInstanceCount = 0
        activeSheetCount = retiredIdentity != nil && !sheetRemoved ? 1 : 0
        retainedBufferCount = retainedBuffers
        retainedTextureCount = retainedTextures
        retainedViewCount = retainedViews
        let cleanupOwned = retiredRuntime != nil || retiredIdentity != nil
        let cleanupComplete = retainedBuffers == 0
            && retainedTextures == 0
            && retainedViews == 0
            && sheetRemoved
        if cleanupOwned && cleanupComplete {
            if retiredRuntime != nil {
                disposedCount = Self.increment(disposedCount)
            }
            runtime = nil
        } else if cleanupOwned {
            recordFailureLocked(
                !sheetRemoved
                    ? "NATIVE_EFFECT_SHEET_REMOVE_FAILED"
                    : "NATIVE_EFFECT_RESOURCE_DISPOSAL_FAILED"
            )
        }
        lock.unlock()
        return !cleanupOwned || cleanupComplete
    }

    @MainActor
    func requestRuntimeRetirement() {
        guard !retirementTerminal,
              retirementRetryDeadline == nil,
              retirementAttemptCount < 2 else {
            return
        }
        retirementAttemptCount += 1
        guard disposeRuntime() else {
            if retirementAttemptCount == 1 {
                scheduleRuntimeRetirementRetry()
            }
            return
        }
        retirementRetryDeadline?.cancel()
        retirementRetryDeadline = nil
        retirementAttemptCount = 0
        finishRuntimeRetirement()
    }

    @MainActor
    private func scheduleRuntimeRetirementRetry() {
        guard !retirementTerminal,
              retirementAttemptCount == 1,
              retirementRetryDeadline == nil else { return }
        let retry = DispatchWorkItem { [weak self] in
            Task { @MainActor [weak self] in
                guard let self else { return }
                guard !self.retirementTerminal,
                      self.retirementRetryDeadline != nil,
                      self.retirementAttemptCount == 1 else { return }
                self.retirementRetryDeadline = nil
                self.requestRuntimeRetirement()
            }
        }
        retirementRetryDeadline = retry
        scheduleDeadline(Self.retirementRetryDelay, retry)
    }

    private func activeRequest(
        generation: UInt64
    ) -> AOSDesktopWorldNativeEffectRequest? {
        admission.request(generation: generation)
    }

    private func finishPreparation(
        generation: UInt64,
        preparedPrograms: [AOSDesktopWorldNativeEffectProgram],
        errorCode: String?
    ) -> PreparationCompletion {
        lock.lock()
        defer { lock.unlock() }
        guard !stopped, available,
              availabilityGeneration == generation,
              preparing else {
            return .stale
        }
        preparing = false
        if let errorCode {
            prepared = false
            admission.setGate(available: available, prepared: false)
            preparedProgramDigests.removeAll(keepingCapacity: false)
            recordFailureLocked(errorCode)
            return .failed
        }
        preparedProgramDigests = Set(preparedPrograms.map(\.digest))
        let desiredDigests = Set(desiredPrograms.map(\.digest))
        prepared = desiredDigests == preparedProgramDigests
        admission.setGate(available: available, prepared: prepared)
        return prepared ? .ready : .retry(desiredPrograms)
    }

    @MainActor
    private func preparationCompleted(
        generation: UInt64,
        programs: [AOSDesktopWorldNativeEffectProgram],
        result: Result<AOSDesktopWorldNativeEffectPreparation, Error>
    ) {
        preparationTransitionLock.lock()
        guard isCurrentPreparation(generation: generation) else {
            preparationTransitionLock.unlock()
            return
        }
        let errorCode: String?
        switch result {
        case .success(let preparation):
            do {
                try host.activate(preparation: preparation)
                errorCode = nil
            } catch {
                errorCode = Self.failureCode(
                    error,
                    fallback: "NATIVE_EFFECT_PREPARATION_FAILED"
                )
            }
        case .failure(let error):
            errorCode = Self.failureCode(
                error,
                fallback: "NATIVE_EFFECT_PREPARATION_FAILED"
            )
        }
        let completion = finishPreparation(
            generation: generation,
            preparedPrograms: programs,
            errorCode: errorCode
        )
        preparationTransitionLock.unlock()
        switch completion {
        case .ready:
            startPendingReplacement()
        case .failed, .stale:
            break
        case .retry(let followUp):
            reconcileAvailability(true, programs: followUp)
        }
    }

    private func isCurrentPreparation(generation: UInt64) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return !stopped
            && available
            && availabilityGeneration == generation
            && preparing
    }

    private func shouldReleasePreparedResources(generation: UInt64) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return availabilityGeneration == generation && (!available || stopped)
    }

    private func transitionActive(
        generation: UInt64,
        from expected: Active.Phase,
        to next: Active.Phase
    ) -> Bool {
        admission.transition(
            generation: generation,
            from: expected,
            to: next
        )
    }

    private func retireActive(
        generation: UInt64,
        allowedPhases: Set<Active.Phase>? = nil,
        requiresRuntimeDisposal: Bool
    ) -> Active? {
        admission.retire(
            generation: generation,
            allowedPhases: allowedPhases,
            requiresRuntimeDisposal: requiresRuntimeDisposal
        )
    }

    static func increment(_ value: Int) -> Int {
        min(value + 1, maximumDiagnosticCount)
    }

    private static func failureCode(_ error: Error, fallback: String) -> String {
        if let failure = error as? AOSDesktopFrameCaptureFailure {
            return failure.code
        }
        if let failure = error as? DesktopWorldNativeSheetFailure {
            switch failure {
            case .frameSetIncomplete: return "NATIVE_EFFECT_FRAME_SET_INCOMPLETE"
            case .geometryAllocationFailed:
                return "NATIVE_EFFECT_GEOMETRY_ALLOCATION_FAILED"
            case .geometryBudgetExceeded:
                return "NATIVE_EFFECT_GEOMETRY_BUDGET_EXCEEDED"
            case .invalidGeometry: return "NATIVE_EFFECT_GEOMETRY_INVALID"
            case .rendererUnavailable: return "NATIVE_EFFECT_RENDERER_UNAVAILABLE"
            case .textureUnavailable: return "NATIVE_EFFECT_TEXTURE_UNAVAILABLE"
            }
        }
        return fallback
    }

    func recordFailure(_ code: String) {
        lock.lock()
        recordFailureLocked(code)
        lock.unlock()
    }

    func recordFailureLocked(_ code: String) {
        failedCount = Self.increment(failedCount)
        lastErrorCode = code
    }

    func recordRejection(_ code: String) {
        lock.lock()
        recordRejectionLocked(code)
        lock.unlock()
    }

    func recordRejectionLocked(_ code: String) {
        rejectedCount = Self.increment(rejectedCount)
        lastErrorCode = code
    }

    private func stateLocked() -> String {
        admission.state(preparing: preparing)
    }
}
