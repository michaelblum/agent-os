import Foundation

private let aosDesktopWorldNativeFeedbackDeadlineQueue = DispatchQueue(
    label: "io.agent-os.desktop-world.native-feedback.deadline",
    qos: .userInitiated
)

struct AOSDesktopWorldNativeFeedbackCaptureContext: Equatable {
    let canvasGeneration: UInt64
    let displayIDs: [UInt32]
    let excludingWindowIDs: [Int]
    let topologyGeneration: UInt64
}

@MainActor
protocol AOSDesktopWorldNativeFeedbackRuntime: AnyObject {
    func dispose()
    func present(
        onPresented: @escaping () -> Void,
        onFailure: @escaping (String) -> Void,
        onComplete: @escaping () -> Void
    )
}

protocol AOSDesktopWorldNativeEffectPreparation: AnyObject, Sendable {}

struct AOSDesktopWorldNativeFeedbackInstallation {
    let identity: AOSDesktopWorldResourceIdentity
    let runtime: AOSDesktopWorldNativeFeedbackRuntime
}

struct AOSDesktopWorldNativeFeedbackSnapshot: Equatable {
    let acceptedCount: Int
    let attemptedCount: Int
    let completedCount: Int
    let failedCount: Int
    let lastErrorCode: String?
    let presentedCount: Int
    let rejectedCount: Int
    let state: String

    static let idle = AOSDesktopWorldNativeFeedbackSnapshot(
        acceptedCount: 0,
        attemptedCount: 0,
        completedCount: 0,
        failedCount: 0,
        lastErrorCode: nil,
        presentedCount: 0,
        rejectedCount: 0,
        state: "unavailable"
    )
}

protocol AOSDesktopWorldNativeFeedbackHosting: AnyObject {
    func captureContext() -> AOSDesktopWorldNativeFeedbackCaptureContext?

    func prepare(
        programs: [AOSDesktopWorldNativeEffectProgram],
        completion: @escaping @Sendable (
            Result<AOSDesktopWorldNativeEffectPreparation, Error>
        ) -> Void
    )

    /// Publishes one already-prepared context with a bounded, nonblocking
    /// pointer swap. Implementations must not reenter this controller.
    @MainActor
    func activate(
        preparation: AOSDesktopWorldNativeEffectPreparation
    ) throws

    @MainActor
    func install(
        request: AOSDesktopWorldNativeEffectRequest,
        frames: AOSDesktopPixelFrameSet
    ) throws -> AOSDesktopWorldNativeFeedbackInstallation

    @MainActor
    func remove(
        canvasGeneration: UInt64,
        topologyGeneration: UInt64,
        identity: AOSDesktopWorldResourceIdentity
    )

    @MainActor
    func releasePreparedResources()

    @MainActor
    func shutdown()
}

final class AOSDesktopWorldNativeFeedbackController {
    private enum PreparationCompletion {
        case failed
        case ready
        case retry([AOSDesktopWorldNativeEffectProgram])
        case stale
    }

    private struct Active {
        enum Phase: Hashable {
            case capturing
            case installing
            case presenting
        }

        var capture: AOSDesktopFrameCancelling
        var deadline: DispatchWorkItem
        let generation: UInt64
        var phase: Phase
        var presented: Bool
        let request: AOSDesktopWorldNativeEffectRequest
    }

    private static let captureTimeout: TimeInterval = 0.75
    private static let effectCleanupGrace: TimeInterval = 0.25
    private static let maximumDiagnosticCount = 1_000_000_000

    private var active: Active?
    private var acceptedCount = 0
    private let authorize: (AOSDesktopWorldNativeEffectRequest) -> Bool
    private var attemptedCount = 0
    private let capturer: AOSDesktopPixelFrameSetCapturing
    private var completedCount = 0
    private var desiredPrograms: [AOSDesktopWorldNativeEffectProgram] = []
    private var failedCount = 0
    private let host: AOSDesktopWorldNativeFeedbackHosting
    private var lastErrorCode: String?
    private let lock = NSLock()
    private var availabilityGeneration: UInt64 = 0
    private var available = false
    private var nextGeneration: UInt64 = 0
    private var prepared = false
    private var preparedProgramDigests = Set<String>()
    private let preparationTransitionLock = NSLock()
    private var preparing = false
    private var presentedCount = 0
    private var rejectedCount = 0
    private var retirementPending = false
    private let scheduleDeadline: (TimeInterval, DispatchWorkItem) -> Void
    private var stopped = false
    @MainActor private var runtime: AOSDesktopWorldNativeFeedbackRuntime?
    @MainActor private var runtimeIdentity: (
        canvasGeneration: UInt64,
        topologyGeneration: UInt64,
        sheet: AOSDesktopWorldResourceIdentity
    )?

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

    @discardableResult
    func trigger(_ request: AOSDesktopWorldNativeEffectRequest) -> Bool {
        lock.lock()
        attemptedCount = Self.increment(attemptedCount)
        let admissionError: String?
        if stopped {
            admissionError = "NATIVE_EFFECT_STOPPED"
        } else if !available {
            admissionError = "NATIVE_EFFECT_UNAVAILABLE"
        } else if !prepared {
            admissionError = "NATIVE_EFFECT_NOT_PREPARED"
        } else if active != nil || retirementPending {
            admissionError = "NATIVE_EFFECT_BUSY"
        } else {
            admissionError = nil
        }
        if let admissionError {
            recordRejectionLocked(admissionError)
        }
        lock.unlock()
        guard admissionError == nil else { return false }
        guard authorize(request) else {
            recordRejection("NATIVE_EFFECT_UNAUTHORIZED")
            return false
        }
        guard let captureContext = host.captureContext() else {
            recordRejection("NATIVE_EFFECT_CAPTURE_CONTEXT_UNAVAILABLE")
            return false
        }
        guard captureContext.canvasGeneration == request.canvasGeneration,
              captureContext.topologyGeneration == request.topologyGeneration else {
            recordRejection("NATIVE_EFFECT_GENERATION_MISMATCH")
            return false
        }
        let configuration = AOSDesktopFrameWarmConfiguration(
            canvasGeneration: captureContext.canvasGeneration,
            displayIDs: captureContext.displayIDs,
            excludingWindowIDs: captureContext.excludingWindowIDs,
            maximumPixelsPerDisplay:
                AOSDesktopPixelLimits.interactiveMaximumPixelsPerDisplay,
            topologyGeneration: captureContext.topologyGeneration
        )
        let deadline = DispatchWorkItem(block: {})
        lock.lock()
        guard !stopped, available, prepared, active == nil,
              !retirementPending else {
            recordRejectionLocked("NATIVE_EFFECT_ADMISSION_RACE")
            lock.unlock()
            return false
        }
        nextGeneration &+= 1
        if nextGeneration == 0 { nextGeneration = 1 }
        let generation = nextGeneration
        active = Active(
            capture: AOSDesktopFrameCancellation(),
            deadline: deadline,
            generation: generation,
            phase: .capturing,
            presented: false,
            request: request
        )
        acceptedCount = Self.increment(acceptedCount)
        lastErrorCode = nil
        lock.unlock()

        let capture = capturer.capturePrewarmedFrames(configuration) {
            [weak self] result in
            self?.captureCompleted(
                generation: generation,
                request: request,
                result: result
            )
        }
        installCapture(capture, generation: generation)
        let timeout = DispatchWorkItem { [weak self] in
            self?.captureTimedOut(generation: generation)
        }
        installDeadline(timeout, generation: generation)
        scheduleDeadline(Self.captureTimeout, timeout)
        return true
    }

    func snapshot() -> AOSDesktopWorldNativeFeedbackSnapshot {
        lock.lock()
        defer { lock.unlock() }
        return AOSDesktopWorldNativeFeedbackSnapshot(
            acceptedCount: acceptedCount,
            attemptedCount: attemptedCount,
            completedCount: completedCount,
            failedCount: failedCount,
            lastErrorCode: lastErrorCode,
            presentedCount: presentedCount,
            rejectedCount: rejectedCount,
            state: stateLocked()
        )
    }

    func reconcileAuthorization() {
        lock.lock()
        let request = active?.request
        lock.unlock()
        if let request, !authorize(request) { cancelAll() }
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
            desiredPrograms = []
            preparedProgramDigests.removeAll(keepingCapacity: false)
            preparing = false
            lock.unlock()
            cancelAll(releasePreparedResources: true)
            return
        }
        available = true
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
        nextGeneration &+= 1
        let retired = active
        active = nil
        if retired != nil { retirementPending = true }
        let resourceReleaseGeneration = releasePreparedResources
            ? availabilityGeneration
            : nil
        lock.unlock()
        retired?.capture.cancel()
        retired?.deadline.cancel()
        guard retired != nil || releasePreparedResources else { return }
        Task { @MainActor [weak self] in
            guard let self else { return }
            self.disposeRuntime()
            self.finishRuntimeRetirement()
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
        stopped = true
        available = false
        prepared = false
        desiredPrograms = []
        preparedProgramDigests.removeAll(keepingCapacity: false)
        preparing = false
        availabilityGeneration &+= 1
        lock.unlock()
        preparationTransitionLock.unlock()
        cancelAll()
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
        disposeRuntime()
        host.shutdown()
    }

    private func installCapture(
        _ capture: AOSDesktopFrameCancelling,
        generation: UInt64
    ) {
        lock.lock()
        guard var current = active, current.generation == generation else {
            lock.unlock()
            capture.cancel()
            return
        }
        current.capture = capture
        active = current
        lock.unlock()
    }

    private func installDeadline(
        _ deadline: DispatchWorkItem,
        generation: UInt64
    ) {
        lock.lock()
        guard var current = active, current.generation == generation else {
            lock.unlock()
            deadline.cancel()
            return
        }
        current.deadline.cancel()
        current.deadline = deadline
        active = current
        lock.unlock()
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
            self?.disposeRuntime()
            self?.finishRuntimeRetirement()
        }
    }

    private func captureCompleted(
        generation: UInt64,
        request: AOSDesktopWorldNativeEffectRequest,
        result: Result<AOSDesktopPixelFrameSet, Error>
    ) {
        lock.lock()
        guard let current = active, current.generation == generation else {
            lock.unlock()
            return
        }
        lock.unlock()
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
                request: request,
                frames: frames
            )
        }
    }

    @MainActor
    private func present(
        generation: UInt64,
        request: AOSDesktopWorldNativeEffectRequest,
        frames: AOSDesktopPixelFrameSet
    ) {
        guard isActive(generation: generation), authorize(request),
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
            let installation = try host.install(
                request: request,
                frames: frames
            )
            guard transitionActive(
                generation: generation,
                from: .installing,
                to: .presenting
            ) else {
                installation.runtime.dispose()
                host.remove(
                    canvasGeneration: request.canvasGeneration,
                    topologyGeneration: request.topologyGeneration,
                    identity: installation.identity
                )
                return
            }
            runtimeIdentity = (
                request.canvasGeneration,
                request.topologyGeneration,
                installation.identity
            )
            runtime = installation.runtime
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
            scheduleDeadline(
                Double(request.binding.durationMilliseconds) / 1_000
                    + Self.effectCleanupGrace,
                cleanup
            )
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
                disposeRuntime()
                finishRuntimeRetirement()
            }
        }
    }

    @MainActor
    private func effectPresented(generation: UInt64) {
        lock.lock()
        guard var current = active,
              current.generation == generation,
              current.phase == .presenting,
              !current.presented else {
            lock.unlock()
            return
        }
        current.presented = true
        active = current
        presentedCount = Self.increment(presentedCount)
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
        disposeRuntime()
        finishRuntimeRetirement()
    }

    @MainActor
    private func effectCompleted(generation: UInt64) {
        lock.lock()
        let didPresent = active?.generation == generation
            && active?.phase == .presenting
            && active?.presented == true
        lock.unlock()
        guard didPresent else {
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
        disposeRuntime()
        finishRuntimeRetirement()
    }

    private func effectTimedOut(generation: UInt64) {
        guard let retired = retireActive(
            generation: generation,
            allowedPhases: [.presenting],
            requiresRuntimeDisposal: true
        ) else { return }
        recordFailure("NATIVE_EFFECT_PRESENT_TIMEOUT")
        retired.capture.cancel()
        Task { @MainActor [weak self] in
            self?.disposeRuntime()
            self?.finishRuntimeRetirement()
        }
    }

    @MainActor
    private func disposeRuntime() {
        runtime?.dispose()
        runtime = nil
        if let identity = runtimeIdentity {
            host.remove(
                canvasGeneration: identity.canvasGeneration,
                topologyGeneration: identity.topologyGeneration,
                identity: identity.sheet
            )
        }
        runtimeIdentity = nil
    }

    private func isActive(generation: UInt64) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return active?.generation == generation
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
            preparedProgramDigests.removeAll(keepingCapacity: false)
            recordFailureLocked(errorCode)
            return .failed
        }
        preparedProgramDigests = Set(preparedPrograms.map(\.digest))
        let desiredDigests = Set(desiredPrograms.map(\.digest))
        prepared = desiredDigests == preparedProgramDigests
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
        case .failed, .ready, .stale:
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

    private func finishRuntimeRetirement() {
        lock.lock()
        retirementPending = false
        lock.unlock()
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
        lock.lock()
        defer { lock.unlock() }
        guard var current = active,
              current.generation == generation,
              current.phase == expected else {
            return false
        }
        current.phase = next
        active = current
        return true
    }

    private func retireActive(
        generation: UInt64,
        allowedPhases: Set<Active.Phase>? = nil,
        requiresRuntimeDisposal: Bool
    ) -> Active? {
        lock.lock()
        guard let current = active,
              current.generation == generation,
              allowedPhases?.contains(current.phase) ?? true else {
            lock.unlock()
            return nil
        }
        active = nil
        if requiresRuntimeDisposal { retirementPending = true }
        lock.unlock()
        current.deadline.cancel()
        return current
    }

    private static func increment(_ value: Int) -> Int {
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
            case .projectionOccupied: return "NATIVE_EFFECT_PROJECTION_OCCUPIED"
            case .rendererUnavailable: return "NATIVE_EFFECT_RENDERER_UNAVAILABLE"
            case .textureUnavailable: return "NATIVE_EFFECT_TEXTURE_UNAVAILABLE"
            }
        }
        return fallback
    }

    private func recordFailure(_ code: String) {
        lock.lock()
        recordFailureLocked(code)
        lock.unlock()
    }

    private func recordFailureLocked(_ code: String) {
        failedCount = Self.increment(failedCount)
        lastErrorCode = code
    }

    private func recordRejection(_ code: String) {
        lock.lock()
        recordRejectionLocked(code)
        lock.unlock()
    }

    private func recordRejectionLocked(_ code: String) {
        rejectedCount = Self.increment(rejectedCount)
        lastErrorCode = code
    }

    private func stateLocked() -> String {
        if stopped { return "stopped" }
        if let phase = active?.phase {
            switch phase {
            case .capturing: return "capturing"
            case .installing: return "installing"
            case .presenting: return "presenting"
            }
        }
        if retirementPending { return "retiring" }
        if preparing { return "preparing" }
        if available && prepared { return "ready" }
        return "unavailable"
    }
}
