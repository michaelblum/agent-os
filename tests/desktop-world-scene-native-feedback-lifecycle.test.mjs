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
    'src/daemon/desktop-world-native-feedback-controller.swift',
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
struct AOSDesktopWorldNativeEffectProgram {
    let digest: String
}
struct AOSDesktopWorldNativeEffectBinding: Equatable {
    let ripple: AOSDesktopWorldNativeRippleParameters
    var durationMilliseconds: Int { ripple.durationMilliseconds }
}
struct AOSDesktopWorldNativeEffectRequest {
    let binding: AOSDesktopWorldNativeEffectBinding
    let canvasGeneration: UInt64
    let desktopWorldOrigin: CGPoint
    let ownerID: String
    let resourceID: String
    let resourceRevision: Int
    let topologyGeneration: UInt64
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
    @MainActor var activationCount = 0
    @MainActor var deferPreparations = false
    @MainActor var onActivate: (() -> Void)?
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
    @MainActor var runtimes: [Runtime] = []
    @MainActor var shutdownCount = 0
    func captureContext() -> AOSDesktopWorldNativeFeedbackCaptureContext? { context }
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
    ) throws -> AOSDesktopWorldNativeFeedbackInstallation {
        installCount += 1
        if let installFailure { throw installFailure }
        let runtime = Runtime()
        runtimes.append(runtime)
        onInstall?()
        return AOSDesktopWorldNativeFeedbackInstallation(
            identity: AOSDesktopWorldResourceIdentity(
                ownerID: "aos.desktop-world",
                resourceID: "native-sheet/main"
            ),
            runtime: runtime
        )
    }
    @MainActor func remove(
        canvasGeneration: UInt64,
        topologyGeneration: UInt64,
        identity: AOSDesktopWorldResourceIdentity
    ) { removeCount += 1 }
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
        ripple: AOSDesktopWorldNativeRippleParameters(
            amplitude: 18,
            durationMilliseconds: 900
        )
    ),
    canvasGeneration: 3,
    desktopWorldOrigin: CGPoint(x: 900, y: 600),
    ownerID: "example.consumer",
    resourceID: "companion/main",
    resourceRevision: 1,
    topologyGeneration: 4
)

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
print("PASS native feedback lifecycle")
`)
  assert.match(output, /PASS native feedback lifecycle/u)
})
