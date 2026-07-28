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
    func present(onComplete: @escaping () -> Void)
}

struct AOSDesktopWorldNativeFeedbackInstallation {
    let identity: AOSDesktopWorldResourceIdentity
    let runtime: AOSDesktopWorldNativeFeedbackRuntime
}

protocol AOSDesktopWorldNativeFeedbackHosting: AnyObject {
    func captureContext() -> AOSDesktopWorldNativeFeedbackCaptureContext?

    @MainActor
    func prepare() throws

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
        let request: AOSDesktopWorldNativeEffectRequest
    }

    private static let captureTimeout: TimeInterval = 0.75
    private static let effectCleanupGrace: TimeInterval = 0.25

    private var active: Active?
    private let authorize: (AOSDesktopWorldNativeEffectRequest) -> Bool
    private let capturer: AOSDesktopPixelFrameSetCapturing
    private let host: AOSDesktopWorldNativeFeedbackHosting
    private let lock = NSLock()
    private var availabilityGeneration: UInt64 = 0
    private var available = false
    private var nextGeneration: UInt64 = 0
    private var prepared = false
    private var preparing = false
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
        let canAttempt = !stopped && available && prepared
            && active == nil && !retirementPending
        lock.unlock()
        guard canAttempt,
              authorize(request),
              let captureContext = host.captureContext(),
              captureContext.canvasGeneration == request.canvasGeneration,
              captureContext.topologyGeneration == request.topologyGeneration else {
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
            request: request
        )
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

    func reconcileAuthorization() {
        lock.lock()
        let request = active?.request
        lock.unlock()
        if let request, !authorize(request) { cancelAll() }
    }

    func reconcileAvailability(_ nextAvailable: Bool) {
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
            preparing = false
            lock.unlock()
            cancelAll(releasePreparedResources: true)
            return
        }
        available = true
        guard !prepared, !preparing else {
            lock.unlock()
            return
        }
        availabilityGeneration &+= 1
        if availabilityGeneration == 0 { availabilityGeneration = 1 }
        let generation = availabilityGeneration
        preparing = true
        lock.unlock()

        Task { @MainActor [weak self] in
            guard let self else { return }
            let succeeded: Bool
            do {
                try self.host.prepare()
                succeeded = true
            } catch {
                succeeded = false
            }
            if !self.finishPreparation(generation: generation, succeeded: succeeded) {
                self.host.releasePreparedResources()
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
        lock.lock()
        stopped = true
        available = false
        prepared = false
        preparing = false
        availabilityGeneration &+= 1
        lock.unlock()
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
        guard case .success(let frames) = result, authorize(request) else {
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
            installation.runtime.present { [weak self] in
                self?.effectCompleted(generation: generation)
            }
            let cleanup = DispatchWorkItem { [weak self] in
                self?.effectTimedOut(generation: generation)
            }
            installDeadline(cleanup, generation: generation)
            scheduleDeadline(
                Double(request.binding.ripple.durationMilliseconds) / 1_000
                    + Self.effectCleanupGrace,
                cleanup
            )
        } catch {
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
    private func effectCompleted(generation: UInt64) {
        guard retireActive(
            generation: generation,
            allowedPhases: [.presenting],
            requiresRuntimeDisposal: true
        ) != nil else { return }
        disposeRuntime()
        finishRuntimeRetirement()
    }

    private func effectTimedOut(generation: UInt64) {
        guard let retired = retireActive(
            generation: generation,
            allowedPhases: [.presenting],
            requiresRuntimeDisposal: true
        ) else { return }
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

    private func finishPreparation(generation: UInt64, succeeded: Bool) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard !stopped, available,
              availabilityGeneration == generation,
              preparing else {
            return false
        }
        preparing = false
        prepared = succeeded
        return true
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
}
