import AppKit
import Foundation

enum AOSDesktopFrameRuntimeCaptureAdmission {
    case admitted(generation: UInt64)
    case rejected(AOSDesktopFrameCaptureFailure)
}

private let aosDesktopFramePermissionRequestQueue = DispatchQueue(
    label: "io.agent-os.desktop-frame.permission-request",
    qos: .userInitiated
)

final class AOSDesktopFrameCaptureConsentController {
    static let maximumPrimeWaiters = 16
    static let permissionRequestLifetime: TimeInterval = 120
    // A granted capture that cannot return a tiny frame promptly is not usable
    // for interactive desktop effects. Permission requests retain their own
    // human-scale deadline above; this phase is machine work only.
    static let probeLifetime: TimeInterval = 2
    static let probeMaximumPixels = 4_096
    static let responseLifetime: TimeInterval =
        permissionRequestLifetime + probeLifetime + 10

    typealias Completion = (AOSDesktopFrameDirectCaptureSnapshot) -> Void
    typealias DeadlineScheduler = (
        _ delay: TimeInterval,
        _ action: @escaping () -> Void
    ) -> AOSDesktopFrameCancelling
    typealias PermissionRequester = (
        _ completion: @escaping (Bool) -> Void
    ) -> AOSDesktopFrameCancelling

    private enum PrimePhase: Equatable {
        case requestingPermission
        case capturingProbe
    }

    private struct ActivePrime {
        var capture: AOSDesktopFrameCancelling
        var waiters: [PrimeWaiter]
        var deadline: AOSDesktopFrameCancelling
        let generation: UInt64
        var permissionRequest: AOSDesktopFrameCancelling
        var phase: PrimePhase
        var quarantined: Bool
    }

    private struct PrimeWaiter {
        let completion: Completion
        let owner: UUID
    }

    private let capturer: AOSDesktopFrameCapturing
    private let lock = NSLock()
    private let mainDisplayID: () -> UInt32
    private let requestPermission: PermissionRequester
    private let scheduleDeadline: DeadlineScheduler
    private var activePrime: ActivePrime?
    private var activeRuntimeGeneration: UInt64?
    private var nextGeneration: UInt64 = 0
    private var state: AOSDesktopFrameDirectCaptureSnapshot
    private var stopped = false

    init(
        capturer: AOSDesktopFrameCapturing = AOSNativeDesktopFrameCapturer(),
        mainDisplayID: @escaping () -> UInt32 = { CGMainDisplayID() },
        requestPermission: @escaping PermissionRequester = { completion in
            let work = DispatchWorkItem {
                completion(CGRequestScreenCaptureAccess())
            }
            aosDesktopFramePermissionRequestQueue.async(execute: work)
            return AOSDesktopFrameCancellation { work.cancel() }
        },
        scheduleDeadline: @escaping DeadlineScheduler = { delay, action in
            let work = DispatchWorkItem(block: action)
            DispatchQueue.global(qos: .utility).asyncAfter(
                deadline: .now() + delay,
                execute: work
            )
            return AOSDesktopFrameCancellation { work.cancel() }
        }
    ) {
        self.capturer = capturer
        self.mainDisplayID = mainDisplayID
        self.requestPermission = requestPermission
        self.scheduleDeadline = scheduleDeadline
        if #available(macOS 14.0, *) {
            state = AOSDesktopFrameDirectCaptureSnapshot(
                status: .permissionRequired,
                errorCode: nil
            )
        } else {
            state = AOSDesktopFrameDirectCaptureSnapshot(
                status: .unsupported,
                errorCode: AOSDesktopFrameCaptureFailure.unsupported.code
            )
        }
    }

    func snapshot() -> AOSDesktopFrameDirectCaptureSnapshot {
        lock.lock()
        defer { lock.unlock() }
        return state
    }

    func claimRuntimeCapture() -> AOSDesktopFrameRuntimeCaptureAdmission {
        lock.lock()
        defer { lock.unlock() }
        guard !stopped else { return .rejected(.unauthorized) }
        guard state.status == .ready else { return .rejected(.consentRequired) }
        guard activePrime == nil, activeRuntimeGeneration == nil else {
            return .rejected(.busy)
        }
        nextGeneration &+= 1
        if nextGeneration == 0 { nextGeneration = 1 }
        activeRuntimeGeneration = nextGeneration
        return .admitted(generation: nextGeneration)
    }

    func releaseRuntimeCapture(generation: UInt64) {
        lock.lock()
        if activeRuntimeGeneration == generation {
            activeRuntimeGeneration = nil
        }
        lock.unlock()
    }

    func invalidatePermission() {
        lock.lock()
        state = AOSDesktopFrameDirectCaptureSnapshot(
            status: .permissionRequired,
            errorCode: AOSDesktopFrameCaptureFailure.permissionDenied.code
        )
        lock.unlock()
    }

    func prime(owner: UUID, completion: @escaping Completion) {
        lock.lock()
        if stopped {
            let result = AOSDesktopFrameDirectCaptureSnapshot(
                status: .failed,
                errorCode: "DESKTOP_FRAME_DAEMON_SHUTDOWN"
            )
            lock.unlock()
            completion(result)
            return
        }
        if state.status == .unsupported {
            let result = state
            lock.unlock()
            completion(result)
            return
        }
        if state.status == .ready {
            let result = state
            lock.unlock()
            completion(result)
            return
        }
        if let activePrime {
            if activePrime.quarantined {
                let result = state
                lock.unlock()
                completion(result)
                return
            }
            guard activePrime.waiters.count < Self.maximumPrimeWaiters else {
                lock.unlock()
                completion(AOSDesktopFrameDirectCaptureSnapshot(
                    status: .failed,
                    errorCode: AOSDesktopFrameCaptureFailure.busy.code
                ))
                return
            }
            self.activePrime?.waiters.append(PrimeWaiter(
                completion: completion,
                owner: owner
            ))
            lock.unlock()
            return
        }

        nextGeneration &+= 1
        if nextGeneration == 0 { nextGeneration = 1 }
        let generation = nextGeneration
        state = AOSDesktopFrameDirectCaptureSnapshot(
            status: .permissionRequired,
            errorCode: nil
        )
        activePrime = ActivePrime(
            capture: AOSDesktopFrameCancellation(),
            waiters: [PrimeWaiter(completion: completion, owner: owner)],
            deadline: AOSDesktopFrameCancellation(),
            generation: generation,
            permissionRequest: AOSDesktopFrameCancellation(),
            phase: .requestingPermission,
            quarantined: false
        )
        lock.unlock()

        installDeadline(scheduleDeadline(Self.permissionRequestLifetime) { [weak self] in
            self?.primeTimedOut(
                code: "DESKTOP_FRAME_PERMISSION_REQUEST_TIMEOUT",
                generation: generation,
                phase: .requestingPermission
            )
        }, generation: generation)

        let request = requestPermission { [weak self] granted in
            self?.permissionRequestCompleted(granted, generation: generation)
        }
        installPermissionRequest(request, generation: generation)
    }

    func shutdown() {
        lock.lock()
        guard !stopped else {
            lock.unlock()
            return
        }
        stopped = true
        let active = activePrime
        activePrime = nil
        activeRuntimeGeneration = nil
        let next = AOSDesktopFrameDirectCaptureSnapshot(
            status: .failed,
            errorCode: "DESKTOP_FRAME_DAEMON_SHUTDOWN"
        )
        state = next
        lock.unlock()

        active?.permissionRequest.cancel()
        active?.capture.cancel()
        active?.deadline.cancel()
        for waiter in active?.waiters ?? [] {
            waiter.completion(next)
        }
    }

    func connectionClosed(_ owner: UUID) {
        lock.lock()
        guard var active = activePrime else {
            lock.unlock()
            return
        }
        let previousCount = active.waiters.count
        active.waiters.removeAll { $0.owner == owner }
        guard active.waiters.count != previousCount else {
            lock.unlock()
            return
        }
        guard active.waiters.isEmpty, !active.quarantined else {
            activePrime = active
            lock.unlock()
            return
        }
        active.quarantined = true
        activePrime = active
        state = AOSDesktopFrameDirectCaptureSnapshot(
            status: .failed,
            errorCode: "DESKTOP_FRAME_PRIME_CANCELED"
        )
        lock.unlock()

        active.permissionRequest.cancel()
        retireQuarantinedOperation(active, generation: active.generation)
        active.deadline.cancel()
    }

    private func installCapture(
        _ capture: AOSDesktopFrameCancelling,
        generation: UInt64
    ) {
        lock.lock()
        guard var active = activePrime,
              active.generation == generation else {
            lock.unlock()
            capture.cancel()
            return
        }
        active.capture = capture
        activePrime = active
        let quarantined = active.quarantined
        lock.unlock()
        if quarantined {
            cancelQuarantinedCapture(active, generation: generation)
        }
    }

    private func installPermissionRequest(
        _ request: AOSDesktopFrameCancelling,
        generation: UInt64
    ) {
        lock.lock()
        guard activePrime?.generation == generation,
              activePrime?.phase == .requestingPermission else {
            lock.unlock()
            request.cancel()
            return
        }
        activePrime?.permissionRequest = request
        lock.unlock()
    }

    private func installDeadline(
        _ deadline: AOSDesktopFrameCancelling,
        generation: UInt64
    ) {
        lock.lock()
        guard activePrime?.generation == generation else {
            lock.unlock()
            deadline.cancel()
            return
        }
        activePrime?.deadline = deadline
        lock.unlock()
    }

    private func permissionRequestCompleted(
        _ granted: Bool,
        generation: UInt64
    ) {
        guard granted else {
            completePrime(AOSDesktopFrameDirectCaptureSnapshot(
                status: .permissionRequired,
                errorCode: AOSDesktopFrameCaptureFailure.permissionDenied.code
            ), generation: generation)
            return
        }

        lock.lock()
        guard var active = activePrime,
              active.generation == generation,
              active.phase == .requestingPermission else {
            lock.unlock()
            return
        }
        if active.quarantined {
            lock.unlock()
            completePrime(AOSDesktopFrameDirectCaptureSnapshot(
                status: .failed,
                errorCode: "DESKTOP_FRAME_PERMISSION_REQUEST_SETTLED"
            ), generation: generation)
            return
        }
        let permissionRequest = active.permissionRequest
        let permissionDeadline = active.deadline
        active.permissionRequest = AOSDesktopFrameCancellation()
        active.deadline = AOSDesktopFrameCancellation()
        active.phase = .capturingProbe
        activePrime = active
        lock.unlock()

        permissionRequest.cancel()
        permissionDeadline.cancel()

        installDeadline(scheduleDeadline(Self.probeLifetime) { [weak self] in
            self?.primeTimedOut(
                code: "DESKTOP_FRAME_PROBE_TIMEOUT",
                generation: generation,
                phase: .capturingProbe
            )
        }, generation: generation)

        let capture = capturer.capture(
            displayIDs: [mainDisplayID()],
            excludingWindowIDs: [],
            maximumPixelsPerDisplay: Self.probeMaximumPixels
        ) { [weak self] result in
            self?.finishPrime(result, generation: generation)
        }
        installCapture(capture, generation: generation)
    }

    private func finishPrime(
        _ result: Result<AOSDesktopFrameCaptureSetResult, Error>,
        generation: UInt64
    ) {
        let next: AOSDesktopFrameDirectCaptureSnapshot
        do {
            let capture = try result.get()
            guard capture.frames.count == 1,
                  capture.frames[0].displayID == mainDisplayID(),
                  !capture.frames[0].data.isEmpty else {
                throw AOSDesktopFrameCaptureFailure.captureFailed
            }
            next = AOSDesktopFrameDirectCaptureSnapshot(status: .ready, errorCode: nil)
        } catch let failure as AOSDesktopFrameCaptureFailure {
            switch failure {
            case .permissionDenied:
                next = AOSDesktopFrameDirectCaptureSnapshot(
                    status: .permissionRequired,
                    errorCode: failure.code
                )
            case .unsupported:
                next = AOSDesktopFrameDirectCaptureSnapshot(
                    status: .unsupported,
                    errorCode: failure.code
                )
            default:
                next = AOSDesktopFrameDirectCaptureSnapshot(
                    status: .failed,
                    errorCode: failure.code
                )
            }
        } catch {
            next = AOSDesktopFrameDirectCaptureSnapshot(
                status: .failed,
                errorCode: AOSDesktopFrameCaptureFailure.captureFailed.code
            )
        }
        completePrime(next, generation: generation)
    }

    private func primeTimedOut(
        code: String,
        generation: UInt64,
        phase: PrimePhase
    ) {
        let timeout = AOSDesktopFrameDirectCaptureSnapshot(
            status: .failed,
            errorCode: code
        )
        lock.lock()
        guard var active = activePrime,
              active.generation == generation,
              active.phase == phase,
              !active.quarantined else {
            lock.unlock()
            return
        }
        active.quarantined = true
        let waiters = active.waiters
        active.waiters = []
        activePrime = active
        state = timeout
        lock.unlock()

        active.permissionRequest.cancel()
        retireQuarantinedOperation(active, generation: generation)
        active.deadline.cancel()
        for waiter in waiters {
            waiter.completion(timeout)
        }
    }

    private func retireQuarantinedOperation(
        _ active: ActivePrime,
        generation: UInt64
    ) {
        if active.phase == .requestingPermission {
            retireQuarantinedPrime(generation: generation, result: .success(()))
        } else {
            cancelQuarantinedCapture(active, generation: generation)
        }
    }

    private func cancelQuarantinedCapture(
        _ active: ActivePrime,
        generation: UInt64
    ) {
        if let retiring = active.capture as? AOSDesktopFrameRetirementAwaiting {
            retiring.cancelAndAwaitRetirement { [weak self] result in
                self?.retireQuarantinedPrime(
                    generation: generation,
                    result: result
                )
            }
        } else {
            active.capture.cancel()
        }
    }

    private func retireQuarantinedPrime(
        generation: UInt64,
        result: Result<Void, Error>
    ) {
        lock.lock()
        guard let active = activePrime,
              active.generation == generation,
              active.quarantined else {
            lock.unlock()
            return
        }
        activePrime = nil
        if case .failure = result {
            state = AOSDesktopFrameDirectCaptureSnapshot(
                status: .failed,
                errorCode: AOSDesktopFrameCaptureFailure.retirementUncertain.code
            )
        }
        lock.unlock()

        active.permissionRequest.cancel()
        active.capture.cancel()
        active.deadline.cancel()
    }

    private func completePrime(
        _ next: AOSDesktopFrameDirectCaptureSnapshot,
        generation: UInt64
    ) {
        lock.lock()
        guard let active = activePrime, active.generation == generation else {
            lock.unlock()
            return
        }
        activePrime = nil
        if !active.quarantined {
            state = next
        }
        let waiters = active.quarantined ? [] : active.waiters
        lock.unlock()

        active.permissionRequest.cancel()
        active.capture.cancel()
        active.deadline.cancel()
        for waiter in waiters {
            waiter.completion(next)
        }
    }
}
