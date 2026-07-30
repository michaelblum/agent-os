import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..')

async function compileAndRun(name, sources, mainSource) {
  const root = await mkdtemp(path.join(os.tmpdir(), `aos-${name}-`))
  const main = path.join(root, 'main.swift')
  const executable = path.join(root, name)
  try {
    await writeFile(main, mainSource)
    execFileSync('swiftc', [
      '-module-cache-path', path.join(root, 'module-cache'),
      ...sources.map((source) => path.join(repoRoot, source)),
      main,
      '-o', executable,
    ], { cwd: repoRoot, stdio: 'pipe' })
    return execFileSync(executable, [], { cwd: repoRoot, encoding: 'utf8' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('native feedback lifecycle is bounded, single-flight, and fully disposable', async () => {
  const output = await compileAndRun('native-feedback-lifecycle', [
    'src/daemon/desktop-world-native-feedback-contracts.swift',
    'src/daemon/desktop-world-native-feedback-controller.swift',
    'src/daemon/desktop-world-native-feedback-admission.swift',
  ], `
import Foundation

enum AOSDesktopPixelLimits {
    static let interactiveMaximumPixelsPerDisplay = 1_048_576
}

enum AOSDesktopFrameCaptureFailure: Error {
    case captureFailed
    var code: String { "DESKTOP_FRAME_CAPTURE_FAILED" }
}

enum DesktopWorldNativeSheetFailure: Error {
    case frameSetIncomplete
    case geometryAllocationFailed
    case geometryBudgetExceeded
    case invalidGeometry
    case projectionOccupied
    case rendererUnavailable
    case textureUnavailable
}

protocol AOSDesktopFrameCancelling { func cancel() }
final class AOSDesktopFrameCancellation: AOSDesktopFrameCancelling {
    var canceled = false
    func cancel() { canceled = true }
}

struct AOSDesktopFrameWarmConfiguration {
    let canvasGeneration: UInt64
    let displayIDs: [UInt32]
    let excludingWindowIDs: [Int]
    let maximumPixelsPerDisplay: Int
    let topologyGeneration: UInt64
}
struct AOSDesktopPixelFrame { let displayID: UInt32 }
struct AOSDesktopPixelFrameSet { let frames: [AOSDesktopPixelFrame] }
protocol AOSDesktopPixelFrameSetCapturing: AnyObject {
    func capturePrewarmedFrames(
        _ configuration: AOSDesktopFrameWarmConfiguration,
        completion: @escaping (Result<AOSDesktopPixelFrameSet, Error>) -> Void
    ) -> AOSDesktopFrameCancelling
}

struct AOSDesktopWorldResourceIdentity: Equatable {
    let ownerID: String
    let resourceID: String
}
struct AOSDesktopWorldNativeRippleParameters: Equatable {
    let amplitude: Double
    let durationMilliseconds: Int
}
struct AOSDesktopWorldNativeEffectProgram: Equatable {
    let digest: String
    let id: String
    let revision: Int
    init(digest: String, id: String = "example.ripple", revision: Int = 1) {
        self.digest = digest
        self.id = id
        self.revision = revision
    }
}
struct AOSDesktopWorldNativeEffectInputs: Equatable {
    let current: CGPoint
    let delta: CGPoint
    let origin: CGPoint
    let totalDelta: CGPoint
    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.current.x == rhs.current.x
            && lhs.current.y == rhs.current.y
            && lhs.delta.x == rhs.delta.x
            && lhs.delta.y == rhs.delta.y
            && lhs.origin.x == rhs.origin.x
            && lhs.origin.y == rhs.origin.y
            && lhs.totalDelta.x == rhs.totalDelta.x
            && lhs.totalDelta.y == rhs.totalDelta.y
    }
    static func pointer(_ point: CGPoint) -> Self {
        let zero = CGPoint(x: 0, y: 0)
        return Self(current: point, delta: zero, origin: point, totalDelta: zero)
    }
}
struct AOSDesktopWorldNativeEffectBinding: Equatable {
    enum Lifecycle: Equatable { case gesture, timed }
    let interactionID: String
    let lifecycle: Lifecycle
    let program: AOSDesktopWorldNativeEffectProgram?
    let ripple: AOSDesktopWorldNativeRippleParameters
    let trigger: String
    var durationMilliseconds: Int { ripple.durationMilliseconds }
}
struct AOSDesktopWorldNativeEffectRequest: Equatable {
    let binding: AOSDesktopWorldNativeEffectBinding
    let canvasGeneration: UInt64
    let eventSequence: Int?
    let inputs: AOSDesktopWorldNativeEffectInputs
    let ownerID: String
    let pointerSessionID: String?
    let resourceID: String
    let resourceRevision: Int
    let topologyGeneration: UInt64
    let triggeredAt: TimeInterval
}
struct AOSDesktopWorldNativeEffectGestureEvent {
    enum Phase { case cancel, end, update }
    let phase: Phase
    let request: AOSDesktopWorldNativeEffectRequest
}

enum PreparationFailure: Error { case unavailable }

final class Preparation: AOSDesktopWorldNativeEffectPreparation, @unchecked Sendable {
    let digests: [String]
    init(digests: [String]) { self.digests = digests }
}

final class Capturer: AOSDesktopPixelFrameSetCapturing {
    var pending: [(Result<AOSDesktopPixelFrameSet, Error>) -> Void] = []
    var cancellations: [AOSDesktopFrameCancellation] = []
    func capturePrewarmedFrames(
        _ configuration: AOSDesktopFrameWarmConfiguration,
        completion: @escaping (Result<AOSDesktopPixelFrameSet, Error>) -> Void
    ) -> AOSDesktopFrameCancelling {
        pending.append(completion)
        let cancellation = AOSDesktopFrameCancellation()
        cancellations.append(cancellation)
        return cancellation
    }
    func completeNext() {
        pending.removeFirst()(.success(AOSDesktopPixelFrameSet(
            frames: [AOSDesktopPixelFrame(displayID: 7), AOSDesktopPixelFrame(displayID: 9)]
        )))
    }
    func failNext() {
        pending.removeFirst()(.failure(AOSDesktopFrameCaptureFailure.captureFailed))
    }
}

@MainActor
final class Runtime: AOSDesktopWorldNativeFeedbackRuntime {
    var completion: (() -> Void)?
    var disposed = false
    var failure: ((String) -> Void)?
    var presentation: (() -> Void)?
    var updates: [AOSDesktopWorldNativeEffectInputs] = []
    var retainsTexturesAfterDisposal = false
    var retainedBufferCount: Int { disposed ? 0 : 4 }
    var retainedTextureCount: Int {
        disposed && !retainsTexturesAfterDisposal ? 0 : 2
    }
    var retainedViewCount: Int { disposed ? 0 : 2 }
    func present(
        onPresented: @escaping () -> Void,
        onFailure: @escaping (String) -> Void,
        onComplete: @escaping () -> Void
    ) {
        presentation = onPresented
        failure = onFailure
        completion = onComplete
    }
    func dispose() {
        disposed = true
        completion = nil
        failure = nil
        presentation = nil
    }
    func update(inputs: AOSDesktopWorldNativeEffectInputs) {
        updates.append(inputs)
    }
    func complete() {
        let presented = presentation
        presentation = nil
        presented?()
        let value = completion
        completion = nil
        value?()
    }
    func completeWithoutPresentation() {
        let value = completion
        completion = nil
        value?()
    }
}

final class Host: AOSDesktopWorldNativeFeedbackHosting {
    typealias PreparationCompletion = @Sendable (
        Result<AOSDesktopWorldNativeEffectPreparation, Error>
    ) -> Void

    let context = AOSDesktopWorldNativeFeedbackCaptureContext(
        canvasGeneration: 3,
        displayIDs: [7, 9],
        excludingWindowIDs: [101, 102],
        topologyGeneration: 4
    )
    @MainActor var installCount = 0
    @MainActor var installFailure: DesktopWorldNativeSheetFailure?
    @MainActor var installRollbackFailure: DesktopWorldNativeSheetFailure?
    @MainActor var activationCount = 0
    @MainActor var deferPreparations = false
    @MainActor var onActivate: (() -> Void)?
    var onCaptureContext: (() -> Void)?
    @MainActor var onInstall: (() -> Void)?
    @MainActor var onPrepare: (() -> Void)?
    @MainActor var prepareCount = 0
    @MainActor var preparedProgramDigests: [String] = []
    @MainActor var pendingPreparations: [(
        digests: [String],
        completion: PreparationCompletion
    )] = []
    @MainActor var prepareFails = false
    @MainActor var releaseCount = 0
    @MainActor var removeCount = 0
    @MainActor var removeSucceeds = true
    @MainActor var runtimeRetainsTexturesAfterDisposal = false
    @MainActor var runtimes: [Runtime] = []
    @MainActor var shutdownCount = 0
    func captureContext() -> AOSDesktopWorldNativeFeedbackCaptureContext? {
        onCaptureContext?()
        return context
    }
    func prepare(
        programs: [AOSDesktopWorldNativeEffectProgram],
        completion: @escaping @Sendable (
            Result<AOSDesktopWorldNativeEffectPreparation, Error>
        ) -> Void
    ) {
        let digests = programs.map { $0.digest }
        Task { @MainActor in
            prepareCount += 1
            onPrepare?()
            if deferPreparations {
                pendingPreparations.append((digests, completion))
            } else if prepareFails {
                completion(.failure(PreparationFailure.unavailable))
            } else {
                completion(.success(Preparation(digests: digests)))
            }
        }
    }
    @MainActor func completePreparation(at index: Int) {
        let pending = pendingPreparations.remove(at: index)
        pending.completion(.success(Preparation(digests: pending.digests)))
    }
    @MainActor func activate(
        preparation: AOSDesktopWorldNativeEffectPreparation
    ) throws {
        guard let preparation = preparation as? Preparation else {
            throw PreparationFailure.unavailable
        }
        onActivate?()
        activationCount += 1
        preparedProgramDigests = preparation.digests
    }
    @MainActor func install(
        request: AOSDesktopWorldNativeEffectRequest,
        frames: AOSDesktopPixelFrameSet
    ) throws -> AOSDesktopWorldNativeFeedbackInstallationOutcome {
        installCount += 1
        if let installFailure { throw installFailure }
        let identity = AOSDesktopWorldResourceIdentity(
            ownerID: "aos.desktop-world",
            resourceID: "native-sheet/main"
        )
        if let installRollbackFailure {
            return .rollbackRequired(
                identity: identity,
                error: installRollbackFailure
            )
        }
        let runtime = Runtime()
        runtime.retainsTexturesAfterDisposal = runtimeRetainsTexturesAfterDisposal
        runtimes.append(runtime)
        onInstall?()
        return .installed(
            AOSDesktopWorldNativeFeedbackInstallation(
                identity: identity,
                runtime: runtime
            )
        )
    }
    @MainActor func remove(
        canvasGeneration: UInt64,
        topologyGeneration: UInt64,
        identity: AOSDesktopWorldResourceIdentity
    ) -> Bool {
        removeCount += 1
        return removeSucceeds
    }
    @MainActor func releasePreparedResources() { releaseCount += 1 }
    @MainActor func shutdown() { shutdownCount += 1 }
}

func pumpUntil(_ predicate: () -> Bool) {
    let deadline = Date().addingTimeInterval(1)
    while !predicate() && Date() < deadline {
        RunLoop.current.run(until: Date().addingTimeInterval(0.002))
    }
    precondition(predicate())
}

let request = AOSDesktopWorldNativeEffectRequest(
    binding: AOSDesktopWorldNativeEffectBinding(
        interactionID: "surface-drag",
        lifecycle: .timed,
        program: AOSDesktopWorldNativeEffectProgram(digest: "program-digest"),
        ripple: AOSDesktopWorldNativeRippleParameters(
            amplitude: 18,
            durationMilliseconds: 900
        ),
        trigger: "pointer_down"
    ),
    canvasGeneration: 3,
    eventSequence: nil,
    inputs: .pointer(CGPoint(x: 900, y: 600)),
    ownerID: "example.consumer",
    pointerSessionID: "pointer-session-1",
    resourceID: "surface/main",
    resourceRevision: 1,
    topologyGeneration: 4,
    triggeredAt: ProcessInfo.processInfo.systemUptime
)

let replacementRequest = AOSDesktopWorldNativeEffectRequest(
    binding: AOSDesktopWorldNativeEffectBinding(
        interactionID: request.binding.interactionID,
        lifecycle: .timed,
        program: AOSDesktopWorldNativeEffectProgram(
            digest: "replacement-digest",
            id: "example.release-transition",
            revision: 2
        ),
        ripple: AOSDesktopWorldNativeRippleParameters(
            amplitude: 24,
            durationMilliseconds: 1_500
        ),
        trigger: "end"
    ),
    canvasGeneration: request.canvasGeneration,
    eventSequence: 3,
    inputs: .pointer(CGPoint(x: 1_600, y: 900)),
    ownerID: request.ownerID,
    pointerSessionID: request.pointerSessionID,
    resourceID: request.resourceID,
    resourceRevision: request.resourceRevision,
    topologyGeneration: request.topologyGeneration,
    triggeredAt: ProcessInfo.processInfo.systemUptime
)

let gestureRequest = AOSDesktopWorldNativeEffectRequest(
    binding: AOSDesktopWorldNativeEffectBinding(
        interactionID: request.binding.interactionID,
        lifecycle: .gesture,
        program: request.binding.program,
        ripple: request.binding.ripple,
        trigger: "start"
    ),
    canvasGeneration: request.canvasGeneration,
    eventSequence: 1,
    inputs: request.inputs,
    ownerID: request.ownerID,
    pointerSessionID: request.pointerSessionID,
    resourceID: request.resourceID,
    resourceRevision: request.resourceRevision,
    topologyGeneration: request.topologyGeneration,
    triggeredAt: ProcessInfo.processInfo.systemUptime
)

let replacementHost = Host()
let replacementCapturer = Capturer()
let replacementController = AOSDesktopWorldNativeFeedbackController(
    host: replacementHost,
    capturer: replacementCapturer,
    scheduleDeadline: { _, _ in },
    authorize: { _ in true }
)
replacementController.reconcileAvailability(
    true,
    programs: [
        AOSDesktopWorldNativeEffectProgram(digest: "program-digest"),
        AOSDesktopWorldNativeEffectProgram(
            digest: "replacement-digest",
            id: "example.release-transition",
            revision: 2
        ),
    ]
)
pumpUntil { replacementController.snapshot().state == "ready" }
precondition(replacementController.trigger(gestureRequest))
replacementCapturer.completeNext()
pumpUntil { MainActor.assumeIsolated { replacementHost.installCount == 1 } }
precondition(replacementController.snapshot().state == "presenting")
let updatedInputs = AOSDesktopWorldNativeEffectInputs(
    current: CGPoint(x: 1_200, y: 700),
    delta: CGPoint(x: 300, y: 100),
    origin: gestureRequest.inputs.origin,
    totalDelta: CGPoint(x: 300, y: 100)
)
let updateEvent = AOSDesktopWorldNativeEffectGestureEvent(
    phase: .update,
    request: AOSDesktopWorldNativeEffectRequest(
        binding: gestureRequest.binding,
        canvasGeneration: gestureRequest.canvasGeneration,
        eventSequence: 2,
        inputs: updatedInputs,
        ownerID: gestureRequest.ownerID,
        pointerSessionID: gestureRequest.pointerSessionID,
        resourceID: gestureRequest.resourceID,
        resourceRevision: gestureRequest.resourceRevision,
        topologyGeneration: gestureRequest.topologyGeneration,
        triggeredAt: ProcessInfo.processInfo.systemUptime
    )
)
replacementController.handleGesture(updateEvent, replacement: nil)
pumpUntil {
    MainActor.assumeIsolated {
        replacementHost.runtimes[0].updates.last == updatedInputs
    }
}
let staleSessionEvent = AOSDesktopWorldNativeEffectGestureEvent(
    phase: .cancel,
    request: AOSDesktopWorldNativeEffectRequest(
        binding: gestureRequest.binding,
        canvasGeneration: gestureRequest.canvasGeneration,
        eventSequence: 99,
        inputs: .pointer(CGPoint(x: 40, y: 50)),
        ownerID: gestureRequest.ownerID,
        pointerSessionID: "pointer-session-stale",
        resourceID: gestureRequest.resourceID,
        resourceRevision: gestureRequest.resourceRevision,
        topologyGeneration: gestureRequest.topologyGeneration,
        triggeredAt: ProcessInfo.processInfo.systemUptime
    )
)
replacementController.handleGesture(staleSessionEvent, replacement: nil)
precondition(replacementController.snapshot().state == "presenting")
let duplicateSequenceEvent = AOSDesktopWorldNativeEffectGestureEvent(
    phase: .update,
    request: AOSDesktopWorldNativeEffectRequest(
        binding: gestureRequest.binding,
        canvasGeneration: gestureRequest.canvasGeneration,
        eventSequence: 2,
        inputs: .pointer(CGPoint(x: 70, y: 80)),
        ownerID: gestureRequest.ownerID,
        pointerSessionID: gestureRequest.pointerSessionID,
        resourceID: gestureRequest.resourceID,
        resourceRevision: gestureRequest.resourceRevision,
        topologyGeneration: gestureRequest.topologyGeneration,
        triggeredAt: ProcessInfo.processInfo.systemUptime
    )
)
replacementController.handleGesture(duplicateSequenceEvent, replacement: nil)
RunLoop.current.run(until: Date().addingTimeInterval(0.01))
precondition(MainActor.assumeIsolated {
    replacementHost.runtimes[0].updates.last == updatedInputs
})
let endEvent = AOSDesktopWorldNativeEffectGestureEvent(
    phase: .end,
    request: AOSDesktopWorldNativeEffectRequest(
        binding: gestureRequest.binding,
        canvasGeneration: gestureRequest.canvasGeneration,
        eventSequence: 3,
        inputs: updatedInputs,
        ownerID: gestureRequest.ownerID,
        pointerSessionID: gestureRequest.pointerSessionID,
        resourceID: gestureRequest.resourceID,
        resourceRevision: gestureRequest.resourceRevision,
        topologyGeneration: gestureRequest.topologyGeneration,
        triggeredAt: ProcessInfo.processInfo.systemUptime
    )
)
replacementController.handleGesture(
    endEvent,
    replacement: replacementRequest
)
pumpUntil { MainActor.assumeIsolated { replacementHost.removeCount == 1 } }
pumpUntil {
    replacementController.snapshot().state == "capturing"
        && replacementCapturer.pending.count == 1
}
precondition(MainActor.assumeIsolated {
    replacementHost.runtimes[0].disposed
})
replacementCapturer.completeNext()
pumpUntil { MainActor.assumeIsolated { replacementHost.installCount == 2 } }
MainActor.assumeIsolated { replacementHost.runtimes.last?.complete() }
pumpUntil { replacementController.snapshot().state == "ready" }
let replacementSnapshot = replacementController.snapshot()
precondition(replacementSnapshot.attemptedCount == 2)
precondition(replacementSnapshot.acceptedCount == 2)
precondition(replacementSnapshot.rejectedCount == 0)
precondition(replacementSnapshot.completedCount == 1)
precondition(replacementSnapshot.disposedCount == 2)
precondition(replacementSnapshot.lastProgramID == "example.release-transition")
replacementController.shutdown()

let deferredReplacementHost = Host()
let deferredReplacementCapturer = Capturer()
let deferredReplacementController = AOSDesktopWorldNativeFeedbackController(
    host: deferredReplacementHost,
    capturer: deferredReplacementCapturer,
    scheduleDeadline: { _, _ in },
    authorize: { _ in true }
)
let deferredPrograms = [
    AOSDesktopWorldNativeEffectProgram(digest: "program-digest"),
    AOSDesktopWorldNativeEffectProgram(
        digest: "replacement-digest",
        id: "example.release-transition",
        revision: 2
    ),
]
deferredReplacementController.reconcileAvailability(
    true,
    programs: deferredPrograms
)
pumpUntil { deferredReplacementController.snapshot().state == "ready" }
precondition(deferredReplacementController.trigger(gestureRequest))
deferredReplacementCapturer.completeNext()
pumpUntil { MainActor.assumeIsolated { deferredReplacementHost.installCount == 1 } }
precondition(deferredReplacementController.snapshot().state == "presenting")
MainActor.assumeIsolated { deferredReplacementHost.deferPreparations = true }
deferredReplacementController.reconcileAvailability(
    true,
    programs: deferredPrograms + [
        AOSDesktopWorldNativeEffectProgram(
            digest: "catalog-refresh-digest",
            id: "example.catalog-refresh",
            revision: 1
        ),
    ]
)
pumpUntil { MainActor.assumeIsolated { deferredReplacementHost.prepareCount == 2 } }
deferredReplacementController.handleGesture(
    endEvent,
    replacement: replacementRequest
)
pumpUntil { MainActor.assumeIsolated { deferredReplacementHost.removeCount == 1 } }
precondition(deferredReplacementController.snapshot().state == "retiring")
precondition(deferredReplacementCapturer.pending.isEmpty)
MainActor.assumeIsolated { deferredReplacementHost.completePreparation(at: 0) }
pumpUntil {
    deferredReplacementController.snapshot().state == "capturing"
        && deferredReplacementCapturer.pending.count == 1
}
deferredReplacementCapturer.completeNext()
pumpUntil { MainActor.assumeIsolated { deferredReplacementHost.installCount == 2 } }
MainActor.assumeIsolated { deferredReplacementHost.runtimes.last?.complete() }
pumpUntil { deferredReplacementController.snapshot().state == "ready" }
precondition(deferredReplacementController.snapshot().acceptedCount == 2)
deferredReplacementController.shutdown()

let canceledReplacementHost = Host()
let canceledReplacementCapturer = Capturer()
let canceledReplacementController = AOSDesktopWorldNativeFeedbackController(
    host: canceledReplacementHost,
    capturer: canceledReplacementCapturer,
    scheduleDeadline: { _, _ in },
    authorize: { _ in true }
)
canceledReplacementController.reconcileAvailability(
    true,
    programs: deferredPrograms
)
pumpUntil { canceledReplacementController.snapshot().state == "ready" }
precondition(canceledReplacementController.trigger(gestureRequest))
canceledReplacementCapturer.completeNext()
pumpUntil { MainActor.assumeIsolated { canceledReplacementHost.installCount == 1 } }
MainActor.assumeIsolated { canceledReplacementHost.deferPreparations = true }
canceledReplacementController.reconcileAvailability(
    true,
    programs: deferredPrograms + [
        AOSDesktopWorldNativeEffectProgram(
            digest: "canceled-refresh-digest",
            id: "example.canceled-refresh",
            revision: 1
        ),
    ]
)
pumpUntil { MainActor.assumeIsolated { canceledReplacementHost.prepareCount == 2 } }
canceledReplacementController.handleGesture(
    endEvent,
    replacement: replacementRequest
)
pumpUntil { MainActor.assumeIsolated { canceledReplacementHost.removeCount == 1 } }
precondition(canceledReplacementController.snapshot().state == "retiring")
precondition(canceledReplacementCapturer.pending.isEmpty)
canceledReplacementController.reconcileAvailability(false)
pumpUntil { canceledReplacementController.snapshot().state == "unavailable" }
pumpUntil { MainActor.assumeIsolated { canceledReplacementHost.releaseCount == 1 } }
precondition(canceledReplacementCapturer.pending.isEmpty)

MainActor.assumeIsolated { canceledReplacementHost.deferPreparations = false }
canceledReplacementController.reconcileAvailability(
    true,
    programs: deferredPrograms
)
pumpUntil { MainActor.assumeIsolated { canceledReplacementHost.prepareCount == 3 } }
pumpUntil { canceledReplacementController.snapshot().state == "ready" }
MainActor.assumeIsolated { canceledReplacementHost.completePreparation(at: 0) }
RunLoop.current.run(until: Date().addingTimeInterval(0.02))
precondition(canceledReplacementController.snapshot().state == "ready")
precondition(canceledReplacementCapturer.pending.isEmpty)
precondition(canceledReplacementController.trigger(request))
canceledReplacementCapturer.completeNext()
pumpUntil { MainActor.assumeIsolated { canceledReplacementHost.installCount == 2 } }
MainActor.assumeIsolated { canceledReplacementHost.runtimes.last?.complete() }
pumpUntil { canceledReplacementController.snapshot().state == "ready" }
canceledReplacementController.shutdown()

let retryingReplacementHost = Host()
let retryingReplacementCapturer = Capturer()
var retryingRetirementItems: [DispatchWorkItem] = []
let retryingReplacementController = AOSDesktopWorldNativeFeedbackController(
    host: retryingReplacementHost,
    capturer: retryingReplacementCapturer,
    scheduleDeadline: { delay, item in
        if abs(delay - 0.05) < 0.001 { retryingRetirementItems.append(item) }
    },
    authorize: { _ in true }
)
retryingReplacementController.reconcileAvailability(
    true,
    programs: deferredPrograms
)
pumpUntil { retryingReplacementController.snapshot().state == "ready" }
precondition(retryingReplacementController.trigger(gestureRequest))
retryingReplacementCapturer.completeNext()
pumpUntil { MainActor.assumeIsolated { retryingReplacementHost.installCount == 1 } }
MainActor.assumeIsolated {
    retryingReplacementHost.deferPreparations = true
    retryingReplacementHost.removeSucceeds = false
}
retryingReplacementController.reconcileAvailability(
    true,
    programs: deferredPrograms + [
        AOSDesktopWorldNativeEffectProgram(
            digest: "retrying-refresh-digest",
            id: "example.retrying-refresh",
            revision: 1
        ),
    ]
)
pumpUntil { MainActor.assumeIsolated { retryingReplacementHost.prepareCount == 2 } }
retryingReplacementController.handleGesture(
    endEvent,
    replacement: replacementRequest
)
pumpUntil { retryingRetirementItems.count == 1 }
MainActor.assumeIsolated { retryingReplacementHost.completePreparation(at: 0) }
RunLoop.current.run(until: Date().addingTimeInterval(0.02))
precondition(retryingReplacementController.snapshot().state == "retiring")
precondition(retryingReplacementCapturer.pending.isEmpty)
MainActor.assumeIsolated { retryingReplacementHost.removeSucceeds = true }
retryingRetirementItems[0].perform()
pumpUntil {
    retryingReplacementController.snapshot().state == "capturing"
        && retryingReplacementCapturer.pending.count == 1
}
retryingReplacementCapturer.completeNext()
pumpUntil { MainActor.assumeIsolated { retryingReplacementHost.installCount == 2 } }
MainActor.assumeIsolated { retryingReplacementHost.runtimes.last?.complete() }
pumpUntil { retryingReplacementController.snapshot().state == "ready" }
precondition(retryingReplacementController.snapshot().acceptedCount == 2)
retryingReplacementController.shutdown()

let reservedHost = Host()
let reservedCapturer = Capturer()
let reservedController = AOSDesktopWorldNativeFeedbackController(
    host: reservedHost,
    capturer: reservedCapturer,
    scheduleDeadline: { _, _ in },
    authorize: { _ in true }
)
reservedController.reconcileAvailability(
    true,
    programs: [
        AOSDesktopWorldNativeEffectProgram(digest: "program-digest"),
        AOSDesktopWorldNativeEffectProgram(
            digest: "replacement-digest",
            id: "example.release-transition",
            revision: 2
        ),
    ]
)
pumpUntil { reservedController.snapshot().state == "ready" }
precondition(reservedController.trigger(gestureRequest))
reservedCapturer.completeNext()
pumpUntil { MainActor.assumeIsolated { reservedHost.installCount == 1 } }
let unrelatedRequest = AOSDesktopWorldNativeEffectRequest(
    binding: AOSDesktopWorldNativeEffectBinding(
        interactionID: "unrelated-interaction",
        lifecycle: .timed,
        program: request.binding.program,
        ripple: request.binding.ripple,
        trigger: "pointer_down"
    ),
    canvasGeneration: request.canvasGeneration,
    eventSequence: nil,
    inputs: request.inputs,
    ownerID: request.ownerID,
    pointerSessionID: "pointer-session-2",
    resourceID: request.resourceID,
    resourceRevision: request.resourceRevision,
    topologyGeneration: request.topologyGeneration,
    triggeredAt: ProcessInfo.processInfo.systemUptime
)
var competingAdmission: Bool?
reservedHost.onCaptureContext = {
    reservedHost.onCaptureContext = nil
    competingAdmission = reservedController.trigger(unrelatedRequest)
}
reservedController.handleGesture(endEvent, replacement: replacementRequest)
pumpUntil {
    reservedController.snapshot().state == "capturing"
        && reservedCapturer.pending.count == 1
}
precondition(competingAdmission == false)
precondition(reservedController.snapshot().rejectedCount == 1)
reservedCapturer.completeNext()
pumpUntil { MainActor.assumeIsolated { reservedHost.installCount == 2 } }
MainActor.assumeIsolated { reservedHost.runtimes.last?.complete() }
pumpUntil { reservedController.snapshot().state == "ready" }
reservedController.shutdown()

let fastReleaseHost = Host()
let fastReleaseCapturer = Capturer()
let fastReleaseController = AOSDesktopWorldNativeFeedbackController(
    host: fastReleaseHost,
    capturer: fastReleaseCapturer,
    scheduleDeadline: { _, _ in },
    authorize: { _ in true }
)
fastReleaseController.reconcileAvailability(
    true,
    programs: [
        AOSDesktopWorldNativeEffectProgram(digest: "program-digest"),
        AOSDesktopWorldNativeEffectProgram(
            digest: "replacement-digest",
            id: "example.release-transition",
            revision: 2
        ),
    ]
)
pumpUntil { fastReleaseController.snapshot().state == "ready" }
precondition(fastReleaseController.trigger(request))
fastReleaseCapturer.completeNext()
pumpUntil { MainActor.assumeIsolated { fastReleaseHost.installCount == 1 } }
precondition(fastReleaseController.trigger(gestureRequest))
fastReleaseController.handleGesture(endEvent, replacement: replacementRequest)
pumpUntil {
    fastReleaseController.snapshot().state == "capturing"
        && fastReleaseCapturer.pending.count == 1
}
fastReleaseCapturer.completeNext()
pumpUntil { MainActor.assumeIsolated { fastReleaseHost.installCount == 2 } }
precondition(fastReleaseController.snapshot().lastProgramID == "example.release-transition")
MainActor.assumeIsolated { fastReleaseHost.runtimes.last?.complete() }
pumpUntil { fastReleaseController.snapshot().state == "ready" }
precondition(fastReleaseController.snapshot().acceptedCount == 3)
precondition(fastReleaseController.snapshot().attemptedCount == 3)
fastReleaseController.shutdown()

let supersededHost = Host()
MainActor.assumeIsolated { supersededHost.deferPreparations = true }
let supersededController = AOSDesktopWorldNativeFeedbackController(
    host: supersededHost,
    capturer: Capturer(),
    scheduleDeadline: { _, _ in },
    authorize: { _ in true }
)
supersededController.reconcileAvailability(
    true,
    programs: [AOSDesktopWorldNativeEffectProgram(digest: "superseded")]
)
supersededController.reconcileAvailability(false)
supersededController.reconcileAvailability(
    true,
    programs: [AOSDesktopWorldNativeEffectProgram(digest: "current")]
)
pumpUntil { MainActor.assumeIsolated { supersededHost.prepareCount == 2 } }
MainActor.assumeIsolated { supersededHost.completePreparation(at: 1) }
pumpUntil { supersededController.snapshot().state == "ready" }
MainActor.assumeIsolated { supersededHost.completePreparation(at: 0) }
RunLoop.current.run(until: Date().addingTimeInterval(0.02))
precondition(MainActor.assumeIsolated {
    supersededHost.preparedProgramDigests == ["current"]
        && supersededHost.activationCount == 1
        && supersededHost.releaseCount == 0
})
supersededController.shutdown()

let linearizedHost = Host()
MainActor.assumeIsolated { linearizedHost.deferPreparations = true }
let linearizedController = AOSDesktopWorldNativeFeedbackController(
    host: linearizedHost,
    capturer: Capturer(),
    scheduleDeadline: { _, _ in },
    authorize: { _ in true }
)
linearizedController.reconcileAvailability(
    true,
    programs: [AOSDesktopWorldNativeEffectProgram(digest: "linearized")]
)
pumpUntil { MainActor.assumeIsolated { linearizedHost.prepareCount == 1 } }
let availabilityFinished = DispatchSemaphore(value: 0)
MainActor.assumeIsolated {
    linearizedHost.onActivate = {
        DispatchQueue.global().async {
            linearizedController.reconcileAvailability(false)
            availabilityFinished.signal()
        }
        precondition(
            availabilityFinished.wait(timeout: .now() + 0.02) == .timedOut,
            "availability changed between generation validation and publication"
        )
    }
    linearizedHost.completePreparation(at: 0)
}
var availabilitySettled = false
pumpUntil {
    if availabilityFinished.wait(timeout: .now()) == .success {
        availabilitySettled = true
    }
    return availabilitySettled
}
precondition(availabilitySettled)
pumpUntil { linearizedController.snapshot().state == "unavailable" }
pumpUntil { MainActor.assumeIsolated { linearizedHost.releaseCount == 1 } }
precondition(MainActor.assumeIsolated { linearizedHost.activationCount == 1 })
linearizedController.shutdown()

var authorized = true
let host = Host()
let capturer = Capturer()
var deadlines: [(delay: TimeInterval, item: DispatchWorkItem)] = []
let controller = AOSDesktopWorldNativeFeedbackController(
    host: host,
    capturer: capturer,
    scheduleDeadline: { deadlines.append(($0, $1)) },
    authorize: { _ in authorized }
)

precondition(!controller.trigger(request))
precondition(capturer.pending.isEmpty)
var feedback = controller.snapshot()
precondition(feedback.attemptedCount == 1)
precondition(feedback.rejectedCount == 1)
precondition(feedback.lastErrorCode == "NATIVE_EFFECT_UNAVAILABLE")
precondition(feedback.state == "unavailable")
controller.reconcileAvailability(
    true,
    programs: [AOSDesktopWorldNativeEffectProgram(digest: "program-digest")]
)
pumpUntil { MainActor.assumeIsolated { host.prepareCount == 1 } }
pumpUntil { controller.snapshot().state == "ready" }
precondition(MainActor.assumeIsolated {
    host.preparedProgramDigests == ["program-digest"]
})
controller.reconcileAvailability(
    true,
    programs: [AOSDesktopWorldNativeEffectProgram(digest: "replacement-digest")]
)
precondition(controller.snapshot().state == "preparing")
precondition(!controller.trigger(request))
precondition(controller.snapshot().lastErrorCode == "NATIVE_EFFECT_NOT_PREPARED")
pumpUntil { MainActor.assumeIsolated { host.prepareCount == 2 } }
pumpUntil { controller.snapshot().state == "ready" }
precondition(MainActor.assumeIsolated {
    host.preparedProgramDigests == ["replacement-digest"]
})
controller.reconcileAvailability(
    true,
    programs: [AOSDesktopWorldNativeEffectProgram(digest: "program-digest")]
)
pumpUntil { MainActor.assumeIsolated { host.prepareCount == 3 } }
pumpUntil { controller.snapshot().state == "ready" }
precondition(MainActor.assumeIsolated {
    host.preparedProgramDigests == ["program-digest"]
})
MainActor.assumeIsolated {
    host.onPrepare = {
        host.onPrepare = nil
        controller.reconcileAvailability(true, programs: [])
    }
}
controller.reconcileAvailability(
    true,
    programs: [AOSDesktopWorldNativeEffectProgram(digest: "transient-digest")]
)
pumpUntil { controller.snapshot().state == "ready" }
precondition(MainActor.assumeIsolated { host.prepareCount == 5 })
precondition(MainActor.assumeIsolated { host.preparedProgramDigests.isEmpty })
controller.reconcileAvailability(
    true,
    programs: [AOSDesktopWorldNativeEffectProgram(digest: "program-digest")]
)
pumpUntil { MainActor.assumeIsolated { host.prepareCount == 6 } }
pumpUntil { controller.snapshot().state == "ready" }
precondition(controller.trigger(request))
precondition(!controller.trigger(request))
feedback = controller.snapshot()
precondition(feedback.acceptedCount == 1)
precondition(feedback.rejectedCount == 3)
precondition(feedback.lastErrorCode == "NATIVE_EFFECT_BUSY")
capturer.completeNext()
pumpUntil { MainActor.assumeIsolated { host.installCount == 1 } }
MainActor.assumeIsolated { host.runtimes.last?.complete() }
pumpUntil { MainActor.assumeIsolated { host.removeCount == 1 } }
feedback = controller.snapshot()
precondition(feedback.completedCount == 1)
precondition(feedback.presentedCount == 1)
precondition(feedback.disposedCount == 1)
precondition(feedback.activeInstanceCount == 0)
precondition(feedback.activeSheetCount == 0)
precondition(feedback.retainedBufferCount == 0)
precondition(feedback.retainedTextureCount == 0)
precondition(feedback.retainedViewCount == 0)
precondition(feedback.lastOwnerID == "example.consumer")
precondition(feedback.lastResourceID == "surface/main")
precondition(feedback.lastResourceRevision == 1)
precondition(feedback.lastProgramID == "example.ripple")
precondition(feedback.lastProgramRevision == 1)
precondition(feedback.lastProgramDigest == "program-digest")
precondition(feedback.lastPresentationLatencyMilliseconds != nil)
precondition(feedback.lastErrorCode == nil)
precondition(feedback.state == "ready")

precondition(controller.trigger(request))
capturer.completeNext()
pumpUntil { MainActor.assumeIsolated { host.installCount == 2 } }
MainActor.assumeIsolated { host.runtimes.last?.completeWithoutPresentation() }
pumpUntil { MainActor.assumeIsolated { host.removeCount == 2 } }
feedback = controller.snapshot()
precondition(feedback.failedCount == 1)
precondition(
    feedback.lastErrorCode == "NATIVE_EFFECT_COMPLETED_WITHOUT_PRESENTATION"
)

MainActor.assumeIsolated {
    host.onInstall = { controller.cancelAll() }
}
precondition(controller.trigger(request))
capturer.completeNext()
pumpUntil { MainActor.assumeIsolated { host.installCount == 3 } }
pumpUntil { MainActor.assumeIsolated { host.removeCount == 3 } }
precondition(MainActor.assumeIsolated { host.runtimes.last?.disposed == true })
MainActor.assumeIsolated { host.onInstall = nil }

controller.reconcileAvailability(false)
controller.reconcileAvailability(true)
pumpUntil { MainActor.assumeIsolated { host.prepareCount == 7 } }
RunLoop.current.run(until: Date().addingTimeInterval(0.02))
precondition(MainActor.assumeIsolated { host.releaseCount == 0 })

for index in 0..<100 {
    precondition(controller.trigger(request))
    capturer.completeNext()
    pumpUntil { MainActor.assumeIsolated { host.installCount == index + 4 } }
    MainActor.assumeIsolated { host.runtimes.last?.complete() }
    pumpUntil { MainActor.assumeIsolated { host.removeCount == index + 4 } }
}
precondition(MainActor.assumeIsolated {
    host.runtimes.allSatisfy(\\.disposed)
})

precondition(controller.trigger(request))
capturer.completeNext()
pumpUntil { MainActor.assumeIsolated { host.installCount == 104 } }
precondition(deadlines.last?.delay == 1.15)
deadlines.last?.item.perform()
feedback = controller.snapshot()
precondition(feedback.failedCount == 2)
precondition(feedback.lastErrorCode == "NATIVE_EFFECT_PRESENT_TIMEOUT")
precondition(!controller.trigger(request))
pumpUntil { MainActor.assumeIsolated { host.removeCount == 104 } }
pumpUntil { controller.snapshot().state == "ready" }

precondition(controller.trigger(request))
let timeoutCapture = capturer.cancellations.last!
precondition(deadlines.last?.delay == 0.75)
deadlines.last?.item.perform()
precondition(timeoutCapture.canceled)
capturer.completeNext()
RunLoop.current.run(until: Date().addingTimeInterval(0.02))
precondition(MainActor.assumeIsolated { host.installCount == 104 })
pumpUntil { controller.snapshot().state == "ready" }
feedback = controller.snapshot()
precondition(feedback.failedCount == 3)
precondition(feedback.lastErrorCode == "NATIVE_EFFECT_CAPTURE_TIMEOUT")

precondition(controller.trigger(request))
let unauthorizedCapture = capturer.cancellations.last!
authorized = false
controller.reconcileAuthorization()
precondition(unauthorizedCapture.canceled)
capturer.completeNext()
RunLoop.current.run(until: Date().addingTimeInterval(0.02))
precondition(MainActor.assumeIsolated { host.installCount == 104 })
precondition(!controller.trigger(request))

authorized = true
controller.reconcileAvailability(false)
pumpUntil { MainActor.assumeIsolated { host.releaseCount == 1 } }
precondition(!controller.trigger(request))
controller.shutdown()
precondition(MainActor.assumeIsolated { host.shutdownCount == 1 })
precondition(MainActor.assumeIsolated { host.installCount == host.removeCount })
precondition(!controller.trigger(request))

let latencyHost = Host()
let latencyCapturer = Capturer()
let latencyController = AOSDesktopWorldNativeFeedbackController(
    host: latencyHost,
    capturer: latencyCapturer,
    scheduleDeadline: { _, _ in },
    authorize: { _ in true }
)
latencyController.reconcileAvailability(true)
pumpUntil { latencyController.snapshot().state == "ready" }
let delayedRequest = AOSDesktopWorldNativeEffectRequest(
    binding: request.binding,
    canvasGeneration: request.canvasGeneration,
    eventSequence: request.eventSequence,
    inputs: request.inputs,
    ownerID: request.ownerID,
    pointerSessionID: request.pointerSessionID,
    resourceID: request.resourceID,
    resourceRevision: request.resourceRevision,
    topologyGeneration: request.topologyGeneration,
    triggeredAt: ProcessInfo.processInfo.systemUptime - 0.2
)
precondition(latencyController.trigger(delayedRequest))
latencyCapturer.completeNext()
pumpUntil { MainActor.assumeIsolated { latencyHost.installCount == 1 } }
MainActor.assumeIsolated { latencyHost.runtimes.last?.complete() }
pumpUntil { latencyController.snapshot().state == "ready" }
precondition(
    (latencyController.snapshot().lastPresentationLatencyMilliseconds ?? 0) >= 190
)
latencyController.shutdown()

let failedHost = Host()
MainActor.assumeIsolated { failedHost.prepareFails = true }
let failedCapturer = Capturer()
let failedController = AOSDesktopWorldNativeFeedbackController(
    host: failedHost,
    capturer: failedCapturer,
    scheduleDeadline: { _, _ in },
    authorize: { _ in true }
)
failedController.reconcileAvailability(true)
pumpUntil { MainActor.assumeIsolated { failedHost.prepareCount == 1 } }
precondition(!failedController.trigger(request))
precondition(failedCapturer.pending.isEmpty)
let failedSnapshot = failedController.snapshot()
precondition(failedSnapshot.failedCount == 1)
precondition(failedSnapshot.lastErrorCode == "NATIVE_EFFECT_NOT_PREPARED")
precondition(failedSnapshot.state == "unavailable")
precondition(MainActor.assumeIsolated { failedHost.releaseCount == 0 })
failedController.shutdown()

let captureFailureHost = Host()
let captureFailureCapturer = Capturer()
let captureFailureController = AOSDesktopWorldNativeFeedbackController(
    host: captureFailureHost,
    capturer: captureFailureCapturer,
    scheduleDeadline: { _, _ in },
    authorize: { _ in true }
)
captureFailureController.reconcileAvailability(true)
pumpUntil { MainActor.assumeIsolated { captureFailureHost.prepareCount == 1 } }
precondition(captureFailureController.trigger(request))
captureFailureCapturer.failNext()
pumpUntil { captureFailureController.snapshot().state == "ready" }
precondition(
    captureFailureController.snapshot().lastErrorCode ==
        "DESKTOP_FRAME_CAPTURE_FAILED"
)
captureFailureController.shutdown()

let installFailureHost = Host()
MainActor.assumeIsolated {
    installFailureHost.installFailure = .textureUnavailable
}
let installFailureCapturer = Capturer()
let installFailureController = AOSDesktopWorldNativeFeedbackController(
    host: installFailureHost,
    capturer: installFailureCapturer,
    scheduleDeadline: { _, _ in },
    authorize: { _ in true }
)
installFailureController.reconcileAvailability(true)
pumpUntil { MainActor.assumeIsolated { installFailureHost.prepareCount == 1 } }
precondition(installFailureController.trigger(request))
installFailureCapturer.completeNext()
pumpUntil { installFailureController.snapshot().state == "ready" }
precondition(
    installFailureController.snapshot().lastErrorCode ==
        "NATIVE_EFFECT_TEXTURE_UNAVAILABLE"
)
installFailureController.shutdown()

let installRollbackHost = Host()
MainActor.assumeIsolated {
    installRollbackHost.installRollbackFailure = .textureUnavailable
    installRollbackHost.removeSucceeds = false
}
let installRollbackCapturer = Capturer()
var installRollbackRetries: [DispatchWorkItem] = []
let installRollbackController = AOSDesktopWorldNativeFeedbackController(
    host: installRollbackHost,
    capturer: installRollbackCapturer,
    scheduleDeadline: { delay, deadline in
        if abs(delay - 0.05) < 0.001 { installRollbackRetries.append(deadline) }
    },
    authorize: { _ in true }
)
installRollbackController.reconcileAvailability(true)
pumpUntil { installRollbackController.snapshot().state == "ready" }
precondition(installRollbackController.trigger(request))
installRollbackCapturer.completeNext()
pumpUntil { installRollbackController.snapshot().state == "retiring" }
precondition(MainActor.assumeIsolated { installRollbackHost.removeCount == 1 })
precondition(installRollbackController.snapshot().activeSheetCount == 1)
precondition(installRollbackRetries.count == 1)
MainActor.assumeIsolated { installRollbackHost.removeSucceeds = true }
installRollbackRetries[0].perform()
pumpUntil { installRollbackController.snapshot().state == "ready" }
precondition(MainActor.assumeIsolated { installRollbackHost.removeCount == 2 })
precondition(installRollbackController.snapshot().activeSheetCount == 0)
installRollbackController.shutdown()

let removalFailureHost = Host()
MainActor.assumeIsolated { removalFailureHost.removeSucceeds = false }
let removalFailureCapturer = Capturer()
var removalRetries: [DispatchWorkItem] = []
let removalFailureController = AOSDesktopWorldNativeFeedbackController(
    host: removalFailureHost,
    capturer: removalFailureCapturer,
    scheduleDeadline: { delay, deadline in
        if abs(delay - 0.05) < 0.001 { removalRetries.append(deadline) }
    },
    authorize: { _ in true }
)
removalFailureController.reconcileAvailability(true)
pumpUntil { removalFailureController.snapshot().state == "ready" }
precondition(removalFailureController.trigger(request))
removalFailureCapturer.completeNext()
pumpUntil { MainActor.assumeIsolated { removalFailureHost.installCount == 1 } }
MainActor.assumeIsolated { removalFailureHost.runtimes.last?.complete() }
pumpUntil { removalFailureController.snapshot().state == "retiring" }
let removalFailureSnapshot = removalFailureController.snapshot()
precondition(removalFailureSnapshot.disposedCount == 0)
precondition(removalFailureSnapshot.activeInstanceCount == 0)
precondition(removalFailureSnapshot.activeSheetCount == 1)
precondition(removalFailureSnapshot.retainedBufferCount == 0)
precondition(removalFailureSnapshot.retainedTextureCount == 0)
precondition(removalFailureSnapshot.retainedViewCount == 0)
precondition(removalFailureSnapshot.lastErrorCode == "NATIVE_EFFECT_SHEET_REMOVE_FAILED")
precondition(removalRetries.count == 1)
precondition(!removalFailureController.trigger(request))
precondition(removalFailureController.snapshot().state == "retiring")
MainActor.assumeIsolated { removalFailureHost.removeSucceeds = true }
removalRetries[0].perform()
pumpUntil { removalFailureController.snapshot().state == "ready" }
let recoveredRemovalSnapshot = removalFailureController.snapshot()
precondition(recoveredRemovalSnapshot.disposedCount == 1)
precondition(recoveredRemovalSnapshot.activeSheetCount == 0)
precondition(recoveredRemovalSnapshot.retainedBufferCount == 0)
precondition(recoveredRemovalSnapshot.retainedTextureCount == 0)
precondition(recoveredRemovalSnapshot.retainedViewCount == 0)
removalFailureController.shutdown()

var rollbackController: AOSDesktopWorldNativeFeedbackController?
let rollbackHost = Host()
MainActor.assumeIsolated {
    rollbackHost.removeSucceeds = false
    rollbackHost.onInstall = { rollbackController?.cancelAll() }
}
let rollbackCapturer = Capturer()
var rollbackRetries: [DispatchWorkItem] = []
let rollback = AOSDesktopWorldNativeFeedbackController(
    host: rollbackHost,
    capturer: rollbackCapturer,
    scheduleDeadline: { delay, deadline in
        if abs(delay - 0.05) < 0.001 { rollbackRetries.append(deadline) }
    },
    authorize: { _ in true }
)
rollbackController = rollback
rollback.reconcileAvailability(true)
pumpUntil { rollback.snapshot().state == "ready" }
precondition(rollback.trigger(request))
rollbackCapturer.completeNext()
pumpUntil { rollback.snapshot().state == "retiring" }
let rollbackFailureSnapshot = rollback.snapshot()
precondition(rollbackFailureSnapshot.activeSheetCount == 1)
precondition(rollbackFailureSnapshot.disposedCount == 0)
precondition(!rollback.trigger(request))
precondition(rollbackRetries.count == 1)
let rollbackRemoveCount = MainActor.assumeIsolated { rollbackHost.removeCount }
rollback.cancelAll()
rollback.cancelAll()
precondition(MainActor.assumeIsolated { rollbackHost.removeCount == rollbackRemoveCount })
MainActor.assumeIsolated {
    rollbackHost.onInstall = nil
    rollbackHost.removeSucceeds = true
}
rollbackRetries[0].perform()
pumpUntil { rollback.snapshot().state == "ready" }
let rollbackRecoveredSnapshot = rollback.snapshot()
precondition(rollbackRecoveredSnapshot.activeSheetCount == 0)
precondition(rollbackRecoveredSnapshot.disposedCount == 1)
rollback.shutdown()

let shutdownHost = Host()
MainActor.assumeIsolated { shutdownHost.removeSucceeds = false }
let shutdownCapturer = Capturer()
var shutdownRetries: [DispatchWorkItem] = []
let shutdownController = AOSDesktopWorldNativeFeedbackController(
    host: shutdownHost,
    capturer: shutdownCapturer,
    scheduleDeadline: { delay, deadline in
        if abs(delay - 0.05) < 0.001 { shutdownRetries.append(deadline) }
    },
    authorize: { _ in true }
)
shutdownController.reconcileAvailability(true)
pumpUntil { shutdownController.snapshot().state == "ready" }
precondition(shutdownController.trigger(request))
shutdownCapturer.completeNext()
pumpUntil { MainActor.assumeIsolated { shutdownHost.installCount == 1 } }
MainActor.assumeIsolated { shutdownHost.runtimes.last?.complete() }
pumpUntil { shutdownController.snapshot().state == "retiring" }
precondition(shutdownRetries.count == 1)
precondition(MainActor.assumeIsolated { shutdownHost.removeCount == 1 })
shutdownController.shutdown()
precondition(MainActor.assumeIsolated { shutdownHost.removeCount == 2 })
precondition(MainActor.assumeIsolated { shutdownHost.shutdownCount == 1 })
shutdownRetries[0].perform()
RunLoop.current.run(until: Date().addingTimeInterval(0.02))
precondition(MainActor.assumeIsolated { shutdownHost.removeCount == 2 })
shutdownController.cancelAll()
precondition(MainActor.assumeIsolated { shutdownHost.removeCount == 2 })

let textureFailureHost = Host()
MainActor.assumeIsolated {
    textureFailureHost.runtimeRetainsTexturesAfterDisposal = true
}
let textureFailureCapturer = Capturer()
let textureFailureController = AOSDesktopWorldNativeFeedbackController(
    host: textureFailureHost,
    capturer: textureFailureCapturer,
    scheduleDeadline: { _, _ in },
    authorize: { _ in true }
)
textureFailureController.reconcileAvailability(true)
pumpUntil { textureFailureController.snapshot().state == "ready" }
precondition(textureFailureController.trigger(request))
textureFailureCapturer.completeNext()
pumpUntil { MainActor.assumeIsolated { textureFailureHost.installCount == 1 } }
MainActor.assumeIsolated { textureFailureHost.runtimes.last?.complete() }
pumpUntil { textureFailureController.snapshot().state == "retiring" }
let textureFailureSnapshot = textureFailureController.snapshot()
precondition(textureFailureSnapshot.disposedCount == 0)
precondition(textureFailureSnapshot.activeInstanceCount == 0)
precondition(textureFailureSnapshot.activeSheetCount == 0)
precondition(textureFailureSnapshot.retainedBufferCount == 0)
precondition(textureFailureSnapshot.retainedTextureCount == 2)
precondition(textureFailureSnapshot.retainedViewCount == 0)
precondition(textureFailureSnapshot.lastErrorCode == "NATIVE_EFFECT_RESOURCE_DISPOSAL_FAILED")
textureFailureController.shutdown()
print("PASS native feedback lifecycle")
`)
  assert.match(output, /PASS native feedback lifecycle/u)
})
