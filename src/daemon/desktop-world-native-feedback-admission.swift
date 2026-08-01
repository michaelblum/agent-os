import Foundation

final class AOSDesktopWorldNativeFeedbackAdmission {
    private enum RetirementPhase {
        case disposing
        case idle
        case replacementReady
    }

    struct Active {
        enum Phase: Hashable {
            case capturing
            case installing
            case presenting
        }

        var capture: AOSDesktopFrameCancelling
        let triggeredAt: TimeInterval
        var deadline: DispatchWorkItem
        let generation: UInt64
        var phase: Phase
        var presented: Bool
        var request: AOSDesktopWorldNativeEffectRequest
    }

    enum TriggerIntent {
        case queued
        case rejected(String)
        case retire(Active)
        case start(UInt64)
    }

    enum GestureIntent {
        case ignored
        case queued
        case retire(Active)
        case update(generation: UInt64)
    }

    enum PendingActivation {
        case none
        case stale
        case start(request: AOSDesktopWorldNativeEffectRequest, generation: UInt64)
    }

    struct Cancellation {
        let retired: Active?
        let shouldRetireRuntime: Bool
    }

    struct Presentation {
        let didPresent: Bool
        let triggeredAt: TimeInterval?
    }

    private var active: Active?
    private var available = false
    private let lock = NSLock()
    private var nextGeneration: UInt64 = 0
    private var pendingReplacement: AOSDesktopWorldNativeEffectRequest?
    private var prepared = false
    private var retirementPhase = RetirementPhase.idle
    private var stopped = false

    func setGate(available: Bool, prepared: Bool, stopped: Bool? = nil) {
        lock.lock()
        self.available = available
        self.prepared = prepared
        if let stopped { self.stopped = stopped }
        lock.unlock()
    }

    func requests() -> [AOSDesktopWorldNativeEffectRequest] {
        lock.lock()
        defer { lock.unlock() }
        return [active?.request, pendingReplacement].compactMap { $0 }
    }

    func trigger(_ request: AOSDesktopWorldNativeEffectRequest) -> TriggerIntent {
        lock.lock()
        defer { lock.unlock() }
        if stopped { return .rejected("NATIVE_EFFECT_STOPPED") }
        if !available { return .rejected("NATIVE_EFFECT_UNAVAILABLE") }
        if !prepared { return .rejected("NATIVE_EFFECT_NOT_PREPARED") }
        if let current = active {
            guard pendingReplacement == nil,
                  retirementPhase == .idle,
                  Self.canReplace(current.request, with: request) else {
                return .rejected("NATIVE_EFFECT_BUSY")
            }
            active = nil
            retirementPhase = .disposing
            pendingReplacement = request
            advanceGeneration()
            return .retire(current)
        }
        if retirementPhase != .idle {
            guard let pending = pendingReplacement,
                  Self.canReplace(pending, with: request) else {
                return .rejected("NATIVE_EFFECT_BUSY")
            }
            pendingReplacement = request
            return .queued
        }
        guard pendingReplacement == nil else {
            return .rejected("NATIVE_EFFECT_ADMISSION_RACE")
        }
        let generation = admit(request)
        return .start(generation)
    }

    func updateGesture(
        _ event: AOSDesktopWorldNativeEffectGestureEvent
    ) -> GestureIntent {
        lock.lock()
        defer { lock.unlock() }
        if var current = active,
           Self.matchesGesture(current.request, event.request) {
            current.request = Self.replacingEvent(
                current.request,
                with: event.request
            )
            active = current
            guard current.phase == .presenting else { return .ignored }
            return .update(generation: current.generation)
        }
        if let pending = pendingReplacement,
           Self.matchesGesture(pending, event.request) {
            pendingReplacement = Self.replacingEvent(
                pending,
                with: event.request
            )
        }
        return .ignored
    }

    func finishGesture(
        _ event: AOSDesktopWorldNativeEffectGestureEvent,
        replacement: AOSDesktopWorldNativeEffectRequest?
    ) -> GestureIntent {
        lock.lock()
        defer { lock.unlock() }
        var retired: Active?
        if let current = active,
           Self.matchesGesture(current.request, event.request) {
            active = nil
            retirementPhase = .disposing
            advanceGeneration()
            retired = current
            if let replacement,
               Self.sameEvent(replacement, event.request),
               Self.canReplace(current.request, with: replacement) {
                pendingReplacement = replacement
            }
        }
        if let pending = pendingReplacement,
           Self.matchesGesture(pending, event.request) {
            if let replacement,
               Self.sameEvent(replacement, event.request),
               Self.canReplace(pending, with: replacement) {
                pendingReplacement = replacement
                if retired == nil { return .queued }
            } else if replacement == nil {
                pendingReplacement = nil
            }
        }
        guard let retired else { return .ignored }
        return .retire(retired)
    }

    func installCapture(
        _ capture: AOSDesktopFrameCancelling,
        generation: UInt64
    ) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard var current = active, current.generation == generation else {
            return false
        }
        current.capture = capture
        active = current
        return true
    }

    func installDeadline(
        _ deadline: DispatchWorkItem,
        generation: UInt64
    ) -> DispatchWorkItem? {
        lock.lock()
        defer { lock.unlock() }
        guard var current = active, current.generation == generation else {
            return nil
        }
        let previous = current.deadline
        current.deadline = deadline
        active = current
        return previous
    }

    func transition(
        generation: UInt64,
        from expected: Active.Phase,
        to next: Active.Phase
    ) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard var current = active,
              current.generation == generation,
              current.phase == expected else { return false }
        current.phase = next
        active = current
        return true
    }

    func request(generation: UInt64) -> AOSDesktopWorldNativeEffectRequest? {
        lock.lock()
        defer { lock.unlock() }
        guard let current = active, current.generation == generation else {
            return nil
        }
        return current.request
    }

    func presentation(generation: UInt64, markPresented: Bool) -> Presentation {
        lock.lock()
        defer { lock.unlock() }
        guard var current = active,
              current.generation == generation,
              current.phase == .presenting else {
            return Presentation(didPresent: false, triggeredAt: nil)
        }
        if markPresented {
            guard !current.presented else {
                return Presentation(didPresent: false, triggeredAt: nil)
            }
            current.presented = true
            active = current
        }
        return Presentation(
            didPresent: current.presented,
            triggeredAt: current.triggeredAt
        )
    }

    func retire(
        generation: UInt64,
        allowedPhases: Set<Active.Phase>? = nil,
        requiresRuntimeDisposal: Bool
    ) -> Active? {
        lock.lock()
        defer { lock.unlock() }
        guard let current = active,
              current.generation == generation,
              allowedPhases?.contains(current.phase) ?? true else {
            return nil
        }
        active = nil
        if requiresRuntimeDisposal {
            retirementPhase = .disposing
        }
        current.deadline.cancel()
        return current
    }

    func cancelAll() -> Cancellation {
        lock.lock()
        defer { lock.unlock() }
        guard !stopped else {
            return Cancellation(retired: nil, shouldRetireRuntime: false)
        }
        advanceGeneration()
        let retired = active
        active = nil
        pendingReplacement = nil
        if retired != nil {
            retirementPhase = .disposing
        } else if retirementPhase == .replacementReady {
            retirementPhase = .idle
        }
        return Cancellation(
            retired: retired,
            shouldRetireRuntime: retired != nil || retirementPhase != .idle
        )
    }

    func stop() -> Active? {
        lock.lock()
        defer { lock.unlock() }
        guard !stopped else { return nil }
        stopped = true
        available = false
        prepared = false
        advanceGeneration()
        let retired = active
        active = nil
        pendingReplacement = nil
        if retired != nil {
            retirementPhase = .disposing
        }
        return retired
    }

    func finishRetirement() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard retirementPhase == .disposing else { return false }
        guard pendingReplacement != nil else {
            retirementPhase = .idle
            return false
        }
        retirementPhase = .replacementReady
        return !stopped && available && prepared
    }

    func pendingRequest() -> AOSDesktopWorldNativeEffectRequest? {
        lock.lock()
        defer { lock.unlock() }
        guard !stopped, available, prepared, active == nil,
              retirementPhase == .replacementReady else { return nil }
        return pendingReplacement
    }

    func activatePending(
        _ request: AOSDesktopWorldNativeEffectRequest
    ) -> PendingActivation {
        lock.lock()
        defer { lock.unlock() }
        guard !stopped, available, prepared, active == nil,
              retirementPhase == .replacementReady else {
            pendingReplacement = nil
            retirementPhase = .idle
            return .none
        }
        guard pendingReplacement == request else { return .stale }
        pendingReplacement = nil
        retirementPhase = .idle
        return .start(request: request, generation: admit(request))
    }

    func failPending(_ request: AOSDesktopWorldNativeEffectRequest) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard pendingReplacement == request else {
            return pendingReplacement != nil
                && retirementPhase == .replacementReady
        }
        pendingReplacement = nil
        retirementPhase = .idle
        return false
    }

    func state(preparing: Bool) -> String {
        lock.lock()
        defer { lock.unlock() }
        if stopped { return "stopped" }
        if let phase = active?.phase {
            switch phase {
            case .capturing: return "capturing"
            case .installing: return "installing"
            case .presenting: return "presenting"
            }
        }
        if retirementPhase != .idle { return "retiring" }
        if preparing { return "preparing" }
        if available && prepared { return "ready" }
        return "unavailable"
    }

    private func admit(_ request: AOSDesktopWorldNativeEffectRequest) -> UInt64 {
        advanceGeneration()
        active = Active(
            capture: AOSDesktopFrameCancellation(),
            triggeredAt: request.triggeredAt,
            deadline: DispatchWorkItem(block: {}),
            generation: nextGeneration,
            phase: .capturing,
            presented: false,
            request: request
        )
        return nextGeneration
    }

    private func advanceGeneration() {
        nextGeneration &+= 1
        if nextGeneration == 0 { nextGeneration = 1 }
    }

    private static func canReplace(
        _ current: AOSDesktopWorldNativeEffectRequest,
        with candidate: AOSDesktopWorldNativeEffectRequest
    ) -> Bool {
        sameGestureIdentity(current, candidate)
            && current.binding.trigger != candidate.binding.trigger
            && newer(candidate.eventSequence, than: current.eventSequence)
    }

    private static func matchesGesture(
        _ current: AOSDesktopWorldNativeEffectRequest,
        _ candidate: AOSDesktopWorldNativeEffectRequest
    ) -> Bool {
        current.binding.lifecycle == .gesture
            && sameGestureIdentity(current, candidate)
            && newer(candidate.eventSequence, than: current.eventSequence)
    }

    private static func sameEvent(
        _ lhs: AOSDesktopWorldNativeEffectRequest,
        _ rhs: AOSDesktopWorldNativeEffectRequest
    ) -> Bool {
        sameGestureIdentity(lhs, rhs)
            && lhs.eventSequence != nil
            && lhs.eventSequence == rhs.eventSequence
    }

    private static func sameGestureIdentity(
        _ lhs: AOSDesktopWorldNativeEffectRequest,
        _ rhs: AOSDesktopWorldNativeEffectRequest
    ) -> Bool {
        lhs.pointerSessionID != nil
            && lhs.pointerSessionID == rhs.pointerSessionID
            && lhs.ownerID == rhs.ownerID
            && lhs.resourceID == rhs.resourceID
            && lhs.inputGeneration == rhs.inputGeneration
            && lhs.canvasGeneration == rhs.canvasGeneration
            && lhs.topologyGeneration == rhs.topologyGeneration
            && lhs.binding.interactionID == rhs.binding.interactionID
    }

    private static func newer(_ candidate: Int?, than current: Int?) -> Bool {
        guard let candidate else { return false }
        guard let current else { return true }
        return candidate > current
    }

    private static func replacingEvent(
        _ request: AOSDesktopWorldNativeEffectRequest,
        with event: AOSDesktopWorldNativeEffectRequest
    ) -> AOSDesktopWorldNativeEffectRequest {
        AOSDesktopWorldNativeEffectRequest(
            binding: request.binding,
            canvasGeneration: request.canvasGeneration,
            eventSequence: event.eventSequence,
            inputGeneration: request.inputGeneration,
            inputs: event.inputs,
            ownerID: request.ownerID,
            pointerSessionID: request.pointerSessionID,
            resourceID: request.resourceID,
            resourceRevision: request.resourceRevision,
            topologyGeneration: request.topologyGeneration,
            triggeredAt: request.triggeredAt
        )
    }
}

extension AOSDesktopWorldNativeFeedbackController {
    @discardableResult
    func trigger(_ request: AOSDesktopWorldNativeEffectRequest) -> Bool {
        recordAttempt()
        guard authorize(request) else {
            recordRejection("NATIVE_EFFECT_UNAUTHORIZED")
            return false
        }
        return triggerAfterSceneAuthorization(request, recordAttempt: false)
    }

    @discardableResult
    func triggerAfterSceneAuthorization(
        _ request: AOSDesktopWorldNativeEffectRequest,
        recordAttempt shouldRecordAttempt: Bool = true
    ) -> Bool {
        guard let configuration = prepareTriggerAfterSceneAuthorization(
            request,
            recordAttempt: shouldRecordAttempt
        ) else {
            return false
        }
        return admitPreparedTriggerAfterSceneAuthorization(
            request,
            configuration: configuration
        )
    }

    func prepareTriggerAfterSceneAuthorization(
        _ request: AOSDesktopWorldNativeEffectRequest,
        recordAttempt shouldRecordAttempt: Bool = true
    ) -> AOSDesktopFrameWarmConfiguration? {
        if shouldRecordAttempt { recordAttempt() }
        guard let captureContext = host.captureContext() else {
            recordRejection("NATIVE_EFFECT_CAPTURE_CONTEXT_UNAVAILABLE")
            return nil
        }
        guard captureContext.canvasGeneration == request.canvasGeneration,
              captureContext.topologyGeneration == request.topologyGeneration else {
            recordRejection("NATIVE_EFFECT_GENERATION_MISMATCH")
            return nil
        }
        return AOSDesktopFrameWarmConfiguration(
            canvasGeneration: captureContext.canvasGeneration,
            displayIDs: captureContext.displayIDs,
            displayLayout: captureContext.displayLayout,
            excludingWindowIDs: captureContext.excludingWindowIDs,
            maximumPixelsPerDisplay:
                AOSDesktopPixelLimits.maximumPixelsPerDisplay,
            sizingPolicy: .exactWithinBudget,
            topologyGeneration: captureContext.topologyGeneration
        )
    }

    @discardableResult
    func admitPreparedTriggerAfterSceneAuthorization(
        _ request: AOSDesktopWorldNativeEffectRequest,
        configuration: AOSDesktopFrameWarmConfiguration
    ) -> Bool {
        switch admission.trigger(request) {
        case .rejected(let code):
            recordRejection(code)
            return false
        case .queued:
            recordAcceptance(request)
            return true
        case .retire(let retired):
            recordAcceptance(request)
            retired.capture.cancel()
            retired.deadline.cancel()
            Task { @MainActor [weak self] in
                self?.requestRuntimeRetirement()
            }
            return true
        case .start(let generation):
            recordAcceptance(request)
            startCapture(
                request: request,
                configuration: configuration,
                generation: generation
            )
            return true
        }
    }

    @discardableResult
    func handleGesture(
        _ event: AOSDesktopWorldNativeEffectGestureEvent,
        replacement: AOSDesktopWorldNativeEffectRequest?
    ) -> Bool {
        if replacement != nil { recordAttempt() }
        guard authorize(event.request), replacement.map(authorize) ?? true else {
            recordFailure("NATIVE_EFFECT_UNAUTHORIZED")
            return false
        }
        return handleGestureAfterSceneAuthorization(
            event,
            replacement: replacement,
            recordAttempt: false
        )
    }

    @discardableResult
    func handleGestureAfterSceneAuthorization(
        _ event: AOSDesktopWorldNativeEffectGestureEvent,
        replacement: AOSDesktopWorldNativeEffectRequest?,
        recordAttempt shouldRecordAttempt: Bool = true
    ) -> Bool {
        if shouldRecordAttempt, replacement != nil { recordAttempt() }
        let intent: AOSDesktopWorldNativeFeedbackAdmission.GestureIntent
        switch event.phase {
        case .update:
            intent = admission.updateGesture(event)
        case .end:
            intent = admission.finishGesture(event, replacement: replacement)
            if replacement != nil, case .retire = intent {
                recordAcceptance(replacement!)
            }
        case .cancel:
            intent = admission.finishGesture(event, replacement: nil)
        }
        switch intent {
        case .ignored:
            return false
        case .queued:
            if let replacement { recordAcceptance(replacement) }
            return true
        case .update(let generation):
            Task { @MainActor [weak self] in
                self?.updateRuntime(generation: generation)
            }
            return true
        case .retire(let retired):
            retired.capture.cancel()
            retired.deadline.cancel()
            Task { @MainActor [weak self] in
                self?.requestRuntimeRetirement()
            }
            return true
        }
    }

    @MainActor
    private func updateRuntime(generation: UInt64) {
        guard let request = admission.request(generation: generation) else { return }
        runtime?.update(inputs: request.inputs)
    }

    @MainActor
    func finishRuntimeRetirement() {
        if admission.finishRetirement() { startPendingReplacement() }
    }

    @MainActor
    func startPendingReplacement() {
        guard let request = admission.pendingRequest() else { return }
        guard authorize(request) else {
            failPendingReplacement(
                request,
                code: "NATIVE_EFFECT_UNAUTHORIZED"
            )
            return
        }
        guard let captureContext = host.captureContext() else {
            failPendingReplacement(
                request,
                code: "NATIVE_EFFECT_CAPTURE_CONTEXT_UNAVAILABLE"
            )
            return
        }
        guard captureContext.canvasGeneration == request.canvasGeneration,
              captureContext.topologyGeneration == request.topologyGeneration else {
            failPendingReplacement(
                request,
                code: "NATIVE_EFFECT_GENERATION_MISMATCH"
            )
            return
        }
        let configuration = AOSDesktopFrameWarmConfiguration(
            canvasGeneration: captureContext.canvasGeneration,
            displayIDs: captureContext.displayIDs,
            displayLayout: captureContext.displayLayout,
            excludingWindowIDs: captureContext.excludingWindowIDs,
            maximumPixelsPerDisplay:
                AOSDesktopPixelLimits.maximumPixelsPerDisplay,
            sizingPolicy: .exactWithinBudget,
            topologyGeneration: captureContext.topologyGeneration
        )
        switch admission.activatePending(request) {
        case .none:
            recordFailure("NATIVE_EFFECT_ADMISSION_RACE")
        case .stale:
            DispatchQueue.main.async { [weak self] in
                self?.startPendingReplacement()
            }
        case .start(let admittedRequest, let generation):
            startCapture(
                request: admittedRequest,
                configuration: configuration,
                generation: generation
            )
        }
    }

    @MainActor
    private func failPendingReplacement(
        _ request: AOSDesktopWorldNativeEffectRequest,
        code: String
    ) {
        let shouldRetry = admission.failPending(request)
        if shouldRetry {
            DispatchQueue.main.async { [weak self] in
                self?.startPendingReplacement()
            }
        } else {
            recordFailure(code)
        }
    }
}
