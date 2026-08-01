import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..')
const taskStateSource = path.join(repoRoot, 'src/display/scene-extension-scheme-task-state.swift')
const displayGeometrySource = path.join(
  repoRoot,
  'src/shared/desktop-world-display-geometry.swift',
)
const storeSource = path.join(repoRoot, 'src/display/desktop-frame-texture.swift')
const consentContractSource = path.join(repoRoot, 'src/shared/desktop-frame-capture-consent-contract.swift')
const consentSource = path.join(repoRoot, 'src/daemon/desktop-frame-capture-consent.swift')
const brokerSource = path.join(repoRoot, 'src/daemon/desktop-pixel-broker.swift')
const streamLifecycleSource = path.join(
  repoRoot,
  'src/daemon/desktop-pixel-stream-lifecycle.swift',
)
const nativeOperationSource = path.join(
  repoRoot,
  'src/daemon/desktop-pixel-native-operation.swift',
)
const retirementSource = path.join(
  repoRoot,
  'src/daemon/desktop-pixel-retirement.swift',
)
const captureFilterSource = path.join(
  repoRoot,
  'src/daemon/desktop-pixel-capture-filter.swift',
)
const sampleAdmissionSource = path.join(
  repoRoot,
  'src/shared/desktop-pixel-sample-admission.swift',
)
const nativePixelSource = path.join(repoRoot, 'src/daemon/desktop-pixel-native.swift')
const warmPoolSource = path.join(repoRoot, 'src/daemon/desktop-frame-warm-pool.swift')
const captureAdapterSource = path.join(repoRoot, 'src/daemon/desktop-frame-capture-adapter.swift')
const controllerSource = path.join(repoRoot, 'src/daemon/desktop-frame-capture-controller.swift')
const responseEnvelopeSource = path.join(repoRoot, 'src/shared/response-envelope.swift')
const brokerTestsSource = path.join(repoRoot, 'tests/lib/desktop-pixel-broker-tests.swift')
const warmPoolTestsSource = path.join(
  repoRoot,
  'tests/lib/desktop-frame-warm-pool-tests.swift',
)
const nativeLifecycleTestsSource = path.join(
  repoRoot,
  'tests/lib/desktop-pixel-native-lifecycle-tests.swift',
)
const captureFilterTestsSource = path.join(
  repoRoot,
  'tests/lib/desktop-pixel-capture-filter-tests.swift',
)
const terminalStartupTestsSource = path.join(
  repoRoot,
  'tests/lib/desktop-pixel-terminal-startup-tests.swift',
)
const startupCallbackTestsSource = path.join(
  repoRoot,
  'tests/lib/desktop-pixel-startup-callback-tests.swift',
)
const warmOpenOperationTestsSource = path.join(
  repoRoot,
  'tests/lib/desktop-pixel-warm-open-operation-tests.swift',
)
async function compileHarness(root) {
  const main = path.join(root, 'main.swift')
  const executable = path.join(root, 'desktop-frame-proof')
  await writeFile(main, `
import Foundation
import ScreenCaptureKit

struct AOSSceneExtensionReference: Equatable {
    let ownerID: String
    let id: String
    let digest: String
    let sceneABI: String
    let threeRevision: String

    var dictionary: [String: Any] {
        [
            "ownerId": ownerID,
            "id": id,
            "digest": digest,
            "sceneAbi": sceneABI,
            "threeRevision": threeRevision,
        ]
    }
}

final class CanvasManager {
    var consumers: [AOSDesktopFrameConsumerIdentity]
    var displayLayout: AOSDesktopWorldDisplayLayout
    var windows: [Int]

    init(
        consumers: [AOSDesktopFrameConsumerIdentity],
        displayLayout: AOSDesktopWorldDisplayLayout,
        windows: [Int]
    ) {
        self.consumers = consumers
        self.displayLayout = displayLayout
        self.windows = windows
    }

    func desktopFrameCaptureContext(canvasID: String) -> AOSDesktopFrameCaptureContext? {
        AOSDesktopFrameCaptureContext(
            canvasID: canvasID,
            consumers: consumers,
            displayLayout: displayLayout,
            excludingWindowIDs: windows
        )
    }
}

final class AOSDesktopWorldSceneTransportController {
    static let stageCanvasID = "aos-desktop-world-stage"
}

final class FakeCapturer: AOSDesktopFrameCapturing, AOSDesktopFrameRuntimeCapturing {
    var canceled = 0
    var captureCount = 0
    var displayIDs: [UInt32] = []
    var excludedWindowIDs: [Int] = []
    var maximumPixels = 0
    var pending: ((Result<AOSDesktopFrameCaptureSetResult, Error>) -> Void)?
    var deferred = false
    var failure: AOSDesktopFrameCaptureFailure?
    var failures: [AOSDesktopFrameCaptureFailure] = []
    var lastWarmConfiguration: AOSDesktopFrameWarmConfiguration?
    var lastCaptureConfiguration: AOSDesktopFrameWarmConfiguration?
    var warmReconcileCount = 0

    func reconcileWarm(_ configuration: AOSDesktopFrameWarmConfiguration?) {
        warmReconcileCount += 1
        lastWarmConfiguration = configuration
    }

    func warmStatus() -> AOSDesktopFrameWarmStatus {
        AOSDesktopFrameWarmStatus(
            displayCount: lastWarmConfiguration?.displayIDs.count ?? 0,
            errorCode: nil,
            generation: UInt64(warmReconcileCount),
            state: lastWarmConfiguration == nil ? .idle : .ready
        )
    }

    @discardableResult
    func capturePrewarmed(
        _ configuration: AOSDesktopFrameWarmConfiguration,
        completion: @escaping (Result<AOSDesktopFrameCaptureSetResult, Error>) -> Void
    ) -> AOSDesktopFrameCancelling {
        lastCaptureConfiguration = configuration
        return capture(
            displayIDs: configuration.displayIDs,
            excludingWindowIDs: configuration.excludingWindowIDs,
            maximumPixelsPerDisplay: configuration.maximumPixelsPerDisplay,
            completion: completion
        )
    }

    @discardableResult
    func capture(
        displayIDs: [UInt32],
        excludingWindowIDs: [Int],
        maximumPixelsPerDisplay: Int,
        completion: @escaping (Result<AOSDesktopFrameCaptureSetResult, Error>) -> Void
    ) -> AOSDesktopFrameCancelling {
        captureCount += 1
        self.displayIDs = displayIDs
        excludedWindowIDs = excludingWindowIDs
        maximumPixels = maximumPixelsPerDisplay
        let observedFailure = failures.isEmpty ? failure : failures.removeFirst()
        if let observedFailure {
            completion(.failure(observedFailure))
        } else if deferred {
            pending = completion
        } else {
            completion(.success(result(displayIDs)))
        }
        return AOSDesktopFrameCancellation { self.canceled += 1 }
    }

    func result(_ displayIDs: [UInt32]) -> AOSDesktopFrameCaptureSetResult {
        AOSDesktopFrameCaptureSetResult(
            capturedAt: Date(timeIntervalSince1970: 10),
            durationMilliseconds: 14,
            frames: displayIDs.map {
                AOSDesktopFrameCaptureResult(
                    data: Data([0xff, 0xd8, UInt8($0 & 0xff), 0xd9]),
                    displayID: $0,
                    height: 640,
                    mimeType: "image/jpeg",
                    width: 1024
                )
            }
        )
    }
}

final class FakeRetiringCapturer: AOSDesktopFrameCapturing {
    var captureCount = 0
    var deferredCapture = true
    var failures: [AOSDesktopFrameCaptureFailure] = []
    var pendingCapture: ((Result<AOSDesktopFrameCaptureSetResult, Error>) -> Void)?
    var retirementCompletesImmediately = false
    var retirementCompletion: ((Result<Void, Error>) -> Void)?

    @discardableResult
    func capture(
        displayIDs: [UInt32],
        excludingWindowIDs: [Int],
        maximumPixelsPerDisplay: Int,
        completion: @escaping (Result<AOSDesktopFrameCaptureSetResult, Error>) -> Void
    ) -> AOSDesktopFrameCancelling {
        captureCount += 1
        let result = AOSDesktopFrameCaptureSetResult(
            capturedAt: Date(timeIntervalSince1970: 10),
            durationMilliseconds: 14,
            frames: displayIDs.map {
                AOSDesktopFrameCaptureResult(
                    data: Data([0xff, 0xd8, UInt8($0 & 0xff), 0xd9]),
                    displayID: $0,
                    height: 640,
                    mimeType: "image/jpeg",
                    width: 1024
                )
            }
        )
        let failure = failures.isEmpty ? nil : failures.removeFirst()
        if let failure {
            completion(.failure(failure))
        } else if deferredCapture {
            pendingCapture = completion
        } else {
            completion(.success(result))
        }
        return AOSDesktopFrameRetirementCancellation { [self] retirement in
            if retirementCompletesImmediately {
                retirement(.success(()))
            } else {
                retirementCompletion = retirement
            }
        }
    }
}

func grantScreenCapturePermission(
    _ completion: @escaping (Bool) -> Void
) -> AOSDesktopFrameCancelling {
    completion(true)
    return AOSDesktopFrameCancellation()
}

func require(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        fputs(message + "\\n", stderr)
        exit(1)
    }
}

func available(_ outcome: AOSDesktopFrameCaptureOutcome) -> AOSDesktopFrameCaptureDelivery? {
    if case .available(let delivery) = outcome { return delivery }
    return nil
}

func rejectedCode(_ outcome: AOSDesktopFrameCaptureOutcome) -> String? {
    if case .rejected(_, let code) = outcome { return code }
    return nil
}

@main
struct DesktopFrameProof {
    static func main() async throws {
        let owner = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
        try runDesktopPixelWarmOpenOperationTests()
        try await runDesktopPixelStartupCallbackTests()
        try await runDesktopPixelNativeLifecycleTests()
        try runDesktopPixelBrokerTests()
        try runDesktopFrameWarmPoolTests()
        require(
            AOSDesktopFrameCaptureConsentController.probeLifetime == 2,
            "direct-capture probe no longer fails within its interactive bound"
        )
        require(
            AOSDesktopFrameCaptureConsentController.probeRetirementLifetime == 6,
            "direct-capture retirement lost its separate bounded phase"
        )
        require(
            aosDesktopFrameCaptureFailure(for: NSError(
                domain: SCStreamErrorDomain,
                code: SCStreamError.Code.userDeclined.rawValue
            )) == .permissionDenied,
            "native ScreenCaptureKit denial was not classified"
        )
        require(
            aosDesktopFrameCaptureFailure(for: NSError(
                domain: SCStreamErrorDomain,
                code: SCStreamError.Code.failedApplicationConnectionInterrupted.rawValue
            )) == .connectionInterrupted,
            "transient ScreenCaptureKit connection interruption was not classified"
        )
        require(
            AOSDesktopFrameCaptureConsentController.responseLifetime
                == AOSDesktopFrameCaptureConsentController.permissionRequestLifetime
                + TimeInterval(
                    AOSDesktopFrameCaptureConsentController.maximumConnectionInterruptedRetries
                        + 1
                ) * (
                    AOSDesktopFrameCaptureConsentController.probeLifetime
                        + AOSDesktopFrameCaptureConsentController.probeRetirementLifetime
                )
                + 10,
            "prime response lifetime lost its per-attempt safety margin"
        )
        let passiveCapturer = FakeCapturer()
        let passiveConsent = AOSDesktopFrameCaptureConsentController(
            capturer: passiveCapturer,
            mainDisplayID: { 42 },
            requestPermission: { _ in
                require(false, "passive status requested permission")
                return AOSDesktopFrameCancellation()
            },
            scheduleDeadline: { _, _ in AOSDesktopFrameCancellation() }
        )
        require(
            passiveConsent.snapshot().status == .permissionRequired,
            "passive status did not begin unprimed"
        )
        require(passiveCapturer.captureCount == 0, "passive status invoked ScreenCaptureKit")
        let passiveWireBytes = responseJSONBytes(
            AOSDesktopFrameDirectCaptureWireContract.responsePayload(passiveConsent.snapshot()),
            envelopeActive: true,
            envelopeRef: "prime-1"
        )
        require(passiveWireBytes != nil, "direct-capture response did not serialize")
        let passiveWire = try JSONSerialization.jsonObject(
            with: passiveWireBytes!,
            options: []
        ) as! [String: Any]
        require(
            passiveWire["status"] as? String == "success",
            "capability status escaped into the response envelope"
        )
        let passiveWireData = passiveWire["data"] as? [String: Any]
        let passiveWireFacts = passiveWireData?["screen_capture_direct"] as? [String: Any]
        require(
            passiveWireFacts?["status"] as? String == "permission_required",
            "direct-capture status was stripped from the nested payload"
        )
        let parsedPassiveWire = AOSDesktopFrameDirectCaptureWireContract.snapshot(
            from: passiveWire
        )
        require(
            parsedPassiveWire?.status == .permissionRequired,
            "CLI wire parser rejected the daemon response envelope"
        )
        let strippedStatusEnvelope: [String: Any] = [
            "v": 1,
            "status": "permission_required",
            "data": [
                "capability": "screen_capture_direct",
                "capture_persisted": false,
                "error_code": NSNull(),
            ],
        ]
        require(
            AOSDesktopFrameDirectCaptureWireContract.snapshot(
                from: strippedStatusEnvelope
            ) == nil,
            "CLI wire parser accepted an envelope that stripped capability status"
        )
        let flatCapabilityEnvelope: [String: Any] = [
            "v": 1,
            "status": "success",
            "data": passiveConsent.snapshot().dictionary,
        ]
        require(
            AOSDesktopFrameDirectCaptureWireContract.snapshot(
                from: flatCapabilityEnvelope
            ) == nil,
            "CLI wire parser accepted noncanonical flat v1 capability facts"
        )

        let permissionDeniedCapturer = FakeCapturer()
        var permissionRequests = 0
        let permissionDeniedConsent = AOSDesktopFrameCaptureConsentController(
            capturer: permissionDeniedCapturer,
            mainDisplayID: { 42 },
            requestPermission: { completion in
                permissionRequests += 1
                completion(false)
                return AOSDesktopFrameCancellation()
            },
            scheduleDeadline: { _, _ in AOSDesktopFrameCancellation() }
        )
        var permissionDeniedCode: String?
        permissionDeniedConsent.prime(owner: owner) {
            permissionDeniedCode = $0.errorCode
        }
        require(permissionRequests == 1, "explicit prime did not request permission")
        require(permissionDeniedCode == "DESKTOP_FRAME_PERMISSION_DENIED", "permission denial was misclassified")
        require(permissionDeniedCapturer.captureCount == 0, "permission denial invoked capture")

        let preflightCapturer = FakeCapturer()
        var preflightPermissionRequests = 0
        let preflightConsent = AOSDesktopFrameCaptureConsentController(
            capturer: preflightCapturer,
            mainDisplayID: { 42 },
            preflightPermission: { true },
            requestPermission: { _ in
                preflightPermissionRequests += 1
                return AOSDesktopFrameCancellation()
            },
            scheduleDeadline: { _, _ in AOSDesktopFrameCancellation() }
        )
        var preflightStatus: String?
        preflightConsent.prime(owner: owner) {
            preflightStatus = $0.status.rawValue
        }
        require(preflightStatus == "ready", "existing permission did not proceed directly to probe")
        require(preflightPermissionRequests == 0, "existing permission was requested again")
        require(preflightCapturer.captureCount == 1, "existing permission did not probe exactly once")
        require(
            preflightCapturer.maximumPixels
                == AOSDesktopPixelLimits.interactiveMaximumPixelsPerDisplay,
            "permission prime did not retain the interactive pixel ceiling"
        )

        let permissionTimeoutCapturer = FakeCapturer()
        var permissionTimeoutActions: [() -> Void] = []
        var pendingPermission: ((Bool) -> Void)?
        var permissionRequestCanceled = 0
        var deferPermission = true
        let permissionTimeoutConsent = AOSDesktopFrameCaptureConsentController(
            capturer: permissionTimeoutCapturer,
            mainDisplayID: { 42 },
            requestPermission: { completion in
                if deferPermission {
                    pendingPermission = completion
                } else {
                    completion(true)
                }
                return AOSDesktopFrameCancellation { permissionRequestCanceled += 1 }
            },
            scheduleDeadline: { _, action in
                permissionTimeoutActions.append(action)
                return AOSDesktopFrameCancellation()
            }
        )
        var permissionTimeoutCode: String?
        permissionTimeoutConsent.prime(owner: owner) {
            permissionTimeoutCode = $0.errorCode
        }
        permissionTimeoutActions.first?()
        require(permissionTimeoutCode == "DESKTOP_FRAME_PERMISSION_REQUEST_TIMEOUT", "permission timeout was not phase-specific")
        require(permissionRequestCanceled == 1, "permission timeout did not cancel its request")
        require(permissionTimeoutCapturer.captureCount == 0, "permission timeout started capture")
        deferPermission = false
        var permissionRetryStatus: String?
        permissionTimeoutConsent.prime(owner: owner) {
            permissionRetryStatus = $0.status.rawValue
        }
        require(permissionRetryStatus == "ready", "permission timeout could not be retried without a late callback")
        require(permissionTimeoutCapturer.captureCount == 1, "permission retry did not probe once")
        pendingPermission?(true)
        require(
            permissionTimeoutConsent.snapshot().status == .ready,
            "late permission callback overwrote the successful retry"
        )
        require(permissionTimeoutCapturer.captureCount == 1, "late permission callback started capture")

        let joinedCapturer = FakeCapturer()
        joinedCapturer.deferred = true
        var joinedDeadlines: [() -> Void] = []
        let joinedConsent = AOSDesktopFrameCaptureConsentController(
            capturer: joinedCapturer,
            mainDisplayID: { 42 },
            requestPermission: grantScreenCapturePermission,
            scheduleDeadline: { _, action in
                joinedDeadlines.append(action)
                return AOSDesktopFrameCancellation()
            }
        )
        var joinedStatuses: [String] = []
        for _ in 0..<AOSDesktopFrameCaptureConsentController.maximumPrimeWaiters {
            joinedConsent.prime(owner: owner) { joinedStatuses.append($0.status.rawValue) }
        }
        var overflowCode: String?
        joinedConsent.prime(owner: owner) { overflowCode = $0.errorCode }
        require(joinedCapturer.captureCount == 1, "concurrent primes were not serialized")
        require(overflowCode == "DESKTOP_FRAME_BUSY", "prime waiter bound was not enforced")
        joinedCapturer.pending?(.success(joinedCapturer.result([42])))
        require(
            joinedStatuses == Array(repeating: "ready", count: AOSDesktopFrameCaptureConsentController.maximumPrimeWaiters),
            "joined primes did not settle together"
        )
        require(joinedConsent.snapshot().dictionary["capture_persisted"] as? Bool == false, "prime claimed persisted capture")

        let deniedCapturer = FakeCapturer()
        deniedCapturer.failure = .permissionDenied
        let retryConsent = AOSDesktopFrameCaptureConsentController(
            capturer: deniedCapturer,
            mainDisplayID: { 42 },
            requestPermission: grantScreenCapturePermission,
            scheduleDeadline: { _, _ in AOSDesktopFrameCancellation() }
        )
        var deniedStatus: String?
        retryConsent.prime(owner: owner) { deniedStatus = $0.status.rawValue }
        require(deniedStatus == "permission_required", "denial was not latched")
        if case .rejected(.consentRequired) = retryConsent.claimRuntimeCapture() {
        } else {
            require(false, "denied prime authorized capture")
        }
        deniedCapturer.failure = nil
        var retryStatus: String?
        retryConsent.prime(owner: owner) { retryStatus = $0.status.rawValue }
        require(retryStatus == "ready", "explicit retry did not clear denial")
        let retryLease: UInt64
        switch retryConsent.claimRuntimeCapture() {
        case .admitted(let generation):
            retryLease = generation
        case .rejected:
            require(false, "successful prime did not authorize runtime capture")
            return
        }
        if case .rejected(.busy) = retryConsent.claimRuntimeCapture() {
        } else {
            require(false, "concurrent runtime capture did not report busy")
        }
        retryConsent.releaseRuntimeCapture(generation: retryLease)

        let unsupportedCapturer = FakeCapturer()
        unsupportedCapturer.failure = .unsupported
        let unsupportedConsent = AOSDesktopFrameCaptureConsentController(
            capturer: unsupportedCapturer,
            mainDisplayID: { 42 },
            requestPermission: grantScreenCapturePermission,
            scheduleDeadline: { _, _ in AOSDesktopFrameCancellation() }
        )
        var unsupportedStatus: String?
        unsupportedConsent.prime(owner: owner) { unsupportedStatus = $0.status.rawValue }
        require(unsupportedStatus == "unsupported", "unsupported prime lost its status")

        let failedCapturer = FakeCapturer()
        failedCapturer.failure = .captureFailed
        let failedConsent = AOSDesktopFrameCaptureConsentController(
            capturer: failedCapturer,
            mainDisplayID: { 42 },
            requestPermission: grantScreenCapturePermission,
            scheduleDeadline: { _, _ in AOSDesktopFrameCancellation() }
        )
        var failedStatus: String?
        failedConsent.prime(owner: owner) { failedStatus = $0.status.rawValue }
        require(failedStatus == "failed", "failed prime lost its status")

        let interruptedCapturer = FakeCapturer()
        interruptedCapturer.failures = [.connectionInterrupted]
        let interruptedConsent = AOSDesktopFrameCaptureConsentController(
            capturer: interruptedCapturer,
            mainDisplayID: { 42 },
            requestPermission: grantScreenCapturePermission,
            scheduleDeadline: { _, _ in AOSDesktopFrameCancellation() }
        )
        var interruptedStatus: String?
        interruptedConsent.prime(owner: owner) { interruptedStatus = $0.status.rawValue }
        require(interruptedStatus == "ready", "transient connection interruption was not recovered")
        require(interruptedCapturer.captureCount == 2, "transient connection retry count changed")

        let retirementGatedCapturer = FakeRetiringCapturer()
        retirementGatedCapturer.deferredCapture = false
        retirementGatedCapturer.failures = [.connectionInterrupted]
        var retirementDeadlineCanceled: [Bool] = []
        var retirementDeadlineRawActions: [() -> Void] = []
        let retirementGatedConsent = AOSDesktopFrameCaptureConsentController(
            capturer: retirementGatedCapturer,
            mainDisplayID: { 42 },
            requestPermission: grantScreenCapturePermission,
            scheduleDeadline: { _, action in
                let index = retirementDeadlineCanceled.count
                retirementDeadlineCanceled.append(false)
                retirementDeadlineRawActions.append(action)
                return AOSDesktopFrameCancellation {
                    retirementDeadlineCanceled[index] = true
                }
            }
        )
        var retirementGatedStatus: String?
        retirementGatedConsent.prime(owner: owner) {
            retirementGatedStatus = $0.status.rawValue
        }
        require(retirementGatedCapturer.captureCount == 1, "retry started before retirement")
        require(retirementGatedStatus == nil, "prime settled before retirement")
        let firstRetirementDeadlineIndex = retirementDeadlineRawActions.count - 1
        let firstInterruptedRetirement = retirementGatedCapturer.retirementCompletion
        firstInterruptedRetirement?(.success(()))
        require(retirementGatedCapturer.captureCount == 2, "retry did not follow retirement")
        require(retirementGatedStatus == nil, "retry settled before its retirement")
        require(
            retirementDeadlineCanceled[firstRetirementDeadlineIndex],
            "superseded retirement deadline was not canceled"
        )
        retirementDeadlineRawActions[firstRetirementDeadlineIndex]()
        require(retirementGatedStatus == nil, "stale retirement deadline poisoned retry")
        let successfulRetryRetirement = retirementGatedCapturer.retirementCompletion
        successfulRetryRetirement?(.success(()))
        require(retirementGatedStatus == "ready", "retirement-gated retry did not settle")

        let repeatedlyInterruptedCapturer = FakeCapturer()
        repeatedlyInterruptedCapturer.failures = [.connectionInterrupted, .connectionInterrupted]
        let repeatedlyInterruptedConsent = AOSDesktopFrameCaptureConsentController(
            capturer: repeatedlyInterruptedCapturer,
            mainDisplayID: { 42 },
            requestPermission: grantScreenCapturePermission,
            scheduleDeadline: { _, _ in AOSDesktopFrameCancellation() }
        )
        var repeatedlyInterruptedStatus: String?
        repeatedlyInterruptedConsent.prime(owner: owner) {
            repeatedlyInterruptedStatus = $0.status.rawValue
        }
        require(
            repeatedlyInterruptedStatus == "failed",
            "repeated connection interruption did not fail closed"
        )
        require(
            repeatedlyInterruptedCapturer.captureCount == 2,
            "connection interruption exceeded its single retry budget"
        )

        let timeoutCapturer = FakeCapturer()
        timeoutCapturer.deferred = true
        var timeoutActions: [() -> Void] = []
        let timeoutConsent = AOSDesktopFrameCaptureConsentController(
            capturer: timeoutCapturer,
            mainDisplayID: { 42 },
            requestPermission: grantScreenCapturePermission,
            scheduleDeadline: { _, action in
                timeoutActions.append(action)
                return AOSDesktopFrameCancellation()
            }
        )
        var timeoutCode: String?
        timeoutConsent.prime(owner: owner) { timeoutCode = $0.errorCode }
        let lateTimeoutCompletion = timeoutCapturer.pending
        timeoutActions.last?()
        require(timeoutCode == "DESKTOP_FRAME_PROBE_TIMEOUT", "probe timeout was not bounded")
        require(timeoutCapturer.canceled == 1, "prime timeout did not cancel capture")
        var settlingCode: String?
        timeoutConsent.prime(owner: owner) { settlingCode = $0.errorCode }
        require(settlingCode == "DESKTOP_FRAME_PROBE_TIMEOUT", "timed-out prime did not remain quarantined")
        require(timeoutCapturer.captureCount == 1, "timed-out prime admitted overlapping capture")
        lateTimeoutCompletion?(.success(timeoutCapturer.result([42])))
        timeoutCapturer.deferred = false
        var postTimeoutStatus: String?
        timeoutConsent.prime(owner: owner) { postTimeoutStatus = $0.status.rawValue }
        require(postTimeoutStatus == "ready", "settled timeout could not be explicitly retried")
        require(timeoutCapturer.captureCount == 2, "post-timeout retry did not issue one new capture")
        require(
            timeoutConsent.snapshot().status == .ready,
            "late timed-out capture overwrote the successful retry"
        )

        let lateFrameCapturer = FakeRetiringCapturer()
        var lateFrameDeadlines: [(TimeInterval, () -> Void)] = []
        let lateFrameConsent = AOSDesktopFrameCaptureConsentController(
            capturer: lateFrameCapturer,
            mainDisplayID: { 42 },
            requestPermission: grantScreenCapturePermission,
            scheduleDeadline: { delay, action in
                lateFrameDeadlines.append((delay, action))
                return AOSDesktopFrameCancellation()
            }
        )
        var lateFrameTimeoutCode: String?
        lateFrameConsent.prime(owner: owner) {
            lateFrameTimeoutCode = $0.errorCode
        }
        lateFrameDeadlines.first(where: {
            $0.0 == AOSDesktopFrameCaptureConsentController.probeLifetime
        })?.1()
        require(
            lateFrameTimeoutCode == "DESKTOP_FRAME_PROBE_TIMEOUT",
            "retiring capture did not preserve its probe timeout"
        )
        lateFrameCapturer.pendingCapture?(.success(AOSDesktopFrameCaptureSetResult(
            capturedAt: Date(timeIntervalSince1970: 10),
            durationMilliseconds: 14,
            frames: [AOSDesktopFrameCaptureResult(
                data: Data([0xff, 0xd8, 42, 0xd9]),
                displayID: 42,
                height: 640,
                mimeType: "image/jpeg",
                width: 1024
            )]
        )))
        var lateFrameQuarantineCode: String?
        lateFrameConsent.prime(owner: owner) {
            lateFrameQuarantineCode = $0.errorCode
        }
        require(
            lateFrameQuarantineCode == "DESKTOP_FRAME_PROBE_TIMEOUT"
                && lateFrameCapturer.captureCount == 1,
            "late frame callback escaped before native retirement"
        )
        lateFrameCapturer.retirementCompletion?(.success(()))
        lateFrameCapturer.deferredCapture = false
        lateFrameCapturer.retirementCompletesImmediately = true
        var lateFrameRetryStatus: String?
        lateFrameConsent.prime(owner: owner) {
            lateFrameRetryStatus = $0.status.rawValue
        }
        require(
            lateFrameRetryStatus == "ready" && lateFrameCapturer.captureCount == 2,
            "retired late frame could not be retried"
        )

        let canceledCapturer = FakeCapturer()
        canceledCapturer.deferred = true
        let canceledConsent = AOSDesktopFrameCaptureConsentController(
            capturer: canceledCapturer,
            mainDisplayID: { 42 },
            requestPermission: grantScreenCapturePermission,
            scheduleDeadline: { _, _ in AOSDesktopFrameCancellation() }
        )
        let canceledOwner = UUID(uuidString: "22222222-2222-4222-8222-222222222222")!
        let lateCanceledCompletion = {
            canceledConsent.prime(owner: canceledOwner) { _ in
                require(false, "closed connection received a prime completion")
            }
            return canceledCapturer.pending
        }()
        canceledConsent.connectionClosed(canceledOwner)
        require(canceledCapturer.canceled == 1, "connection close did not cancel its sole prime")
        require(
            canceledConsent.snapshot().errorCode == "DESKTOP_FRAME_PRIME_CANCELED",
            "connection cancellation did not remain content-free"
        )
        canceledConsent.prime(owner: owner) {
            require($0.errorCode == "DESKTOP_FRAME_PRIME_CANCELED", "canceled prime admitted overlap")
        }
        require(canceledCapturer.captureCount == 1, "canceled prime admitted overlapping capture")
        lateCanceledCompletion?(.success(canceledCapturer.result([42])))
        canceledCapturer.deferred = false
        var canceledRetryStatus: String?
        canceledConsent.prime(owner: owner) { canceledRetryStatus = $0.status.rawValue }
        require(canceledRetryStatus == "ready", "settled cancellation could not be retried")

        let shutdownCapturer = FakeCapturer()
        shutdownCapturer.deferred = true
        let shutdownConsent = AOSDesktopFrameCaptureConsentController(
            capturer: shutdownCapturer,
            mainDisplayID: { 42 },
            requestPermission: grantScreenCapturePermission,
            scheduleDeadline: { _, _ in AOSDesktopFrameCancellation() }
        )
        var shutdownCode: String?
        shutdownConsent.prime(owner: owner) { shutdownCode = $0.errorCode }
        shutdownConsent.shutdown()
        require(shutdownCode == "DESKTOP_FRAME_DAEMON_SHUTDOWN", "shutdown did not settle prime")
        require(shutdownCapturer.canceled == 1, "shutdown did not cancel capture")

        var scheduledExpirations: [() -> Void] = []
        let store = AOSDesktopFrameStore(scheduleExpiration: { _, action in
            scheduledExpirations.append(action)
        })
        let stageA = NSObject()
        let stageB = NSObject()
        let consumerA = AOSDesktopFrameConsumerIdentity(
            canvasID: "stage",
            canvasGeneration: 7,
            topologyGeneration: 11,
            displayID: 42,
            segmentIndex: 0,
            webViewID: ObjectIdentifier(stageA)
        )
        let consumerB = AOSDesktopFrameConsumerIdentity(
            canvasID: "stage",
            canvasGeneration: 7,
            topologyGeneration: 11,
            displayID: 43,
            segmentIndex: 1,
            webViewID: ObjectIdentifier(stageB)
        )
        guard let displayLayout = AOSDesktopWorldDisplayLayout(displays: [
            AOSDesktopWorldDisplayGeometry(
                displayID: 42,
                index: 0,
                desktopWorldBounds: CGRect(x: 0, y: 0, width: 1_512, height: 982),
                nativePointBounds: CGRect(x: 0, y: 0, width: 1_512, height: 982),
                pointPixelScale: 2
            )!,
            AOSDesktopWorldDisplayGeometry(
                displayID: 43,
                index: 1,
                desktopWorldBounds: CGRect(x: 1_512, y: 0, width: 1_920, height: 1_080),
                nativePointBounds: CGRect(x: 1_512, y: 0, width: 1_920, height: 1_080),
                pointPixelScale: 1
            )!,
        ]) else {
            require(false, "display layout fixture was rejected")
            return
        }
        let reference = AOSSceneExtensionReference(
            ownerID: "io.ch-osctrl.sigil",
            id: "companion-renderer",
            digest: String(repeating: "a", count: 64),
            sceneABI: "aos.scene.projection.v1",
            threeRevision: "183"
        )
        let leaseIdentity = AOSDesktopFrameLeaseIdentity(
            canvasID: "stage",
            canvasGeneration: 7,
            extensionReference: reference,
            ownerID: "io.ch-osctrl.sigil",
            resourceID: "companion/main",
            resourceRevision: 3,
            topologyGeneration: 11
        )
        let start = Date(timeIntervalSince1970: 20)
        let epoch = "11111111-1111-4111-8111-111111111111"
        let first = try store.insert(
            data: Data([1, 2, 3]),
            mimeType: "image/jpeg",
            ownerCanvasID: "stage",
            consumer: consumerA,
            leaseIdentity: leaseIdentity,
            epochID: epoch,
            width: 64,
            height: 32,
            now: start
        )
        require(first.url.hasPrefix("aos://toolkit/.aos-desktop-frame/v1/"), "opaque URL missing")
        do {
            _ = try store.take(
                handle: first.handle,
                consumer: consumerB,
                authorize: { $0 == leaseIdentity },
                now: start
            )
            require(false, "cross-WebView frame load succeeded")
        } catch AOSDesktopFrameStoreFailure.unauthorized {
        }
        let loaded = try store.take(
            handle: first.handle,
            consumer: consumerA,
            authorize: { $0 == leaseIdentity },
            now: start
        )
        require(loaded.data == Data([1, 2, 3]), "stored bytes changed")
        do {
            _ = try store.take(
                handle: first.handle,
                consumer: consumerA,
                authorize: { $0 == leaseIdentity },
                now: start
            )
            require(false, "one-shot frame loaded twice")
        } catch AOSDesktopFrameStoreFailure.notFound {
        }

        _ = try store.insert(
            data: Data([4]),
            mimeType: "image/png",
            ownerCanvasID: "stage",
            consumer: consumerA,
            leaseIdentity: leaseIdentity,
            epochID: "22222222-2222-4222-8222-222222222222",
            width: 1,
            height: 1,
            now: start
        )
        require(store.count(now: start) == 1, "scheduled frame missing")
        scheduledExpirations.removeFirst()()
        scheduledExpirations.removeFirst()()
        require(store.count(now: start) == 0, "scheduled expiry retained pixels")

        for value in 0..<(AOSDesktopFrameStore.maximumEntries + 3) {
            _ = try store.insert(
                data: Data([UInt8(value)]),
                mimeType: "image/jpeg",
                ownerCanvasID: "stage",
                consumer: consumerA,
                leaseIdentity: leaseIdentity,
                epochID: UUID().uuidString,
                width: 1,
                height: 1,
                now: start.addingTimeInterval(Double(value))
            )
        }
        require(
            store.count(now: start.addingTimeInterval(Double(AOSDesktopFrameStore.maximumEntries + 3)))
                <= AOSDesktopFrameStore.maximumEntries,
            "frame store exceeded entry bound"
        )
        let boundedChunk = Data(
            repeating: 0x7f,
            count: (AOSDesktopFrameStore.maximumEncodedBytes / 2) + 1
        )
        let aggregateFirst = try store.insert(
            data: boundedChunk,
            mimeType: "image/jpeg",
            ownerCanvasID: "stage",
            consumer: consumerA,
            leaseIdentity: leaseIdentity,
            epochID: UUID().uuidString,
            width: 1,
            height: 1,
            now: start.addingTimeInterval(100)
        )
        let aggregateSecond = try store.insert(
            data: boundedChunk,
            mimeType: "image/jpeg",
            ownerCanvasID: "stage",
            consumer: consumerA,
            leaseIdentity: leaseIdentity,
            epochID: UUID().uuidString,
            width: 1,
            height: 1,
            now: start.addingTimeInterval(101)
        )
        do {
            _ = try store.take(
                handle: aggregateFirst.handle,
                consumer: consumerA,
                authorize: { $0 == leaseIdentity },
                now: start
            )
            require(false, "aggregate byte bound retained the oldest oversized set")
        } catch AOSDesktopFrameStoreFailure.notFound {
        }
        let loadedAggregateSecond = try store.take(
            handle: aggregateSecond.handle,
            consumer: consumerA,
            authorize: { $0 == leaseIdentity },
            now: start
        )
        require(
            loadedAggregateSecond.data.count == boundedChunk.count,
            "aggregate byte bound removed the newest frame"
        )
        _ = store.releaseAll(ownerCanvasID: "stage")

        let atomicEpoch = try store.insertEpoch(
            frames: [
                AOSDesktopFrameStoreFrame(
                    consumer: consumerA,
                    data: Data([1]),
                    height: 1,
                    mimeType: "image/jpeg",
                    width: 1
                ),
                AOSDesktopFrameStoreFrame(
                    consumer: consumerB,
                    data: Data([2]),
                    height: 1,
                    mimeType: "image/jpeg",
                    width: 1
                ),
            ],
            leaseIdentity: leaseIdentity,
            ownerCanvasID: "stage",
            epochID: "99999999-9999-4999-8999-999999999999",
            now: start
        )
        for value in 0..<(AOSDesktopFrameStore.maximumEntries - 1) {
            _ = try store.insert(
                data: Data([UInt8(value)]),
                mimeType: "image/jpeg",
                ownerCanvasID: "stage",
                consumer: consumerA,
                leaseIdentity: leaseIdentity,
                epochID: UUID().uuidString,
                width: 1,
                height: 1,
                now: start.addingTimeInterval(Double(value + 1))
            )
        }
        for lease in atomicEpoch {
            do {
                _ = try store.take(
                    handle: lease.handle,
                    consumer: lease == atomicEpoch[0] ? consumerA : consumerB,
                    authorize: { $0 == leaseIdentity },
                    now: start
                )
                require(false, "capacity eviction retained part of an old capture epoch")
            } catch AOSDesktopFrameStoreFailure.notFound {
            }
        }
        _ = store.releaseAll(ownerCanvasID: "stage")

        let authorization = AOSDesktopFrameCaptureAuthorization(
            canvasID: "stage",
            canvasGeneration: 7,
            extensionReference: reference,
            ownerID: "io.ch-osctrl.sigil",
            resourceID: "companion/main",
            resourceRevision: 3,
            topologyGeneration: 11
        )
        let payload: [String: Any] = [
            "canvas_generation": 7,
            "extension": reference.dictionary,
            "owner": "io.ch-osctrl.sigil",
            "request_id": "request-main",
            "resource": "companion/main",
            "revision": 3,
            "segment_display_id": 42,
            "segment_index": 0,
            "topology_generation": 11,
        ]
        let canvas = CanvasManager(
            consumers: [consumerB, consumerA],
            displayLayout: displayLayout,
            windows: [8, 7, 8]
        )
        let capturer = FakeCapturer()
        let unprimedCapturer = FakeCapturer()
        let unprimedConsent = AOSDesktopFrameCaptureConsentController(
            capturer: FakeCapturer(),
            mainDisplayID: { 42 },
            requestPermission: grantScreenCapturePermission,
            scheduleDeadline: { _, _ in AOSDesktopFrameCancellation() }
        )
        var capabilityEnabled = true
        var scheduledDeadlines: [() -> Void] = []
        var aborts: [AOSDesktopFrameCaptureAbort] = []
        let unprimedController = AOSDesktopFrameCaptureController(
            canvasManager: canvas,
            store: store,
            capturer: unprimedCapturer,
            consent: unprimedConsent,
            allowedCanvasID: "stage",
            reauthorize: { capabilityEnabled && $0 == leaseIdentity },
            scheduleDeadline: { _, _ in AOSDesktopFrameCancellation() },
            authorize: { _ in capabilityEnabled ? authorization : nil }
        )
        let warmAuthorization = AOSDesktopFrameWarmAuthorization(
            canvasGeneration: 7,
            topologyGeneration: 11
        )
        unprimedController.reconcileWarm(authorization: warmAuthorization)
        require(
            unprimedCapturer.warmReconcileCount == 1
                && unprimedCapturer.lastWarmConfiguration == nil,
            "unprimed controller started warm native capture"
        )
        var unprimedCode: String?
        var unprimedAdmitted = false
        unprimedController.acquire(
            callerCanvasID: "stage",
            payload: payload,
            admitted: { _ in
                unprimedAdmitted = true
                return true
            }
        ) {
            unprimedCode = rejectedCode($0)
        }
        require(!unprimedAdmitted, "unprimed request emitted a started event")
        require(unprimedCode == "DESKTOP_FRAME_CONSENT_REQUIRED", "unprimed request did not fail closed")
        require(unprimedCapturer.captureCount == 0, "unprimed request invoked ScreenCaptureKit")

        let primeCapturer = FakeCapturer()
        let consent = AOSDesktopFrameCaptureConsentController(
            capturer: primeCapturer,
            mainDisplayID: { 42 },
            requestPermission: grantScreenCapturePermission,
            scheduleDeadline: { _, _ in AOSDesktopFrameCancellation() }
        )
        var primeStatus: String?
        consent.prime(owner: owner) { primeStatus = $0.status.rawValue }
        require(primeStatus == "ready", "explicit direct-capture prime did not settle")
        require(primeCapturer.captureCount == 1, "explicit prime did not issue exactly one probe")
        require(
            primeCapturer.maximumPixels
                == AOSDesktopFrameCaptureConsentController.probeMaximumPixels,
            "consent did not retain its bounded native probe budget"
        )
        require(
            AOSDesktopFrameCaptureConsentController.probeMaximumPixels
                == AOSDesktopPixelLimits.interactiveMaximumPixelsPerDisplay,
            "consent probe diverged from the interactive pixel ceiling"
        )
        let controller = AOSDesktopFrameCaptureController(
            canvasManager: canvas,
            store: store,
            capturer: capturer,
            consent: consent,
            allowedCanvasID: "stage",
            reauthorize: { capabilityEnabled && $0 == leaseIdentity },
            handleAbort: { aborts.append($0) },
            scheduleDeadline: { _, action in
                scheduledDeadlines.append(action)
                return AOSDesktopFrameCancellation()
            },
            authorize: { _ in capabilityEnabled ? authorization : nil }
        )
        controller.reconcileWarm(authorization: AOSDesktopFrameWarmAuthorization(
            canvasGeneration: 7,
            topologyGeneration: 12
        ))
        require(
            capturer.lastWarmConfiguration == nil,
            "stale topology authorization configured warm native capture"
        )
        controller.reconcileWarm(authorization: warmAuthorization)
        require(
            capturer.lastWarmConfiguration == AOSDesktopFrameWarmConfiguration(
                canvasGeneration: 7,
                displayIDs: [42, 43],
                displayLayout: displayLayout,
                excludingWindowIDs: [7, 8],
                maximumPixelsPerDisplay:
                    AOSDesktopFrameCaptureController.maximumPixelsPerDisplay,
                topologyGeneration: 11
            ),
            "authorized controller did not configure one all-display warm pool"
        )
        controller.reconcileWarm(
            authorization: warmAuthorization,
            nativePresentation: true
        )
        require(
            capturer.lastWarmConfiguration == AOSDesktopFrameWarmConfiguration(
                canvasGeneration: 7,
                displayIDs: [42, 43],
                displayLayout: displayLayout,
                excludingWindowIDs: [7, 8],
                maximumPixelsPerDisplay:
                    AOSDesktopFrameCaptureController.nativePresentationMaximumPixelsPerDisplay,
                sizingPolicy: .exactWithinBudget,
                topologyGeneration: 11
            ),
            "native presentation did not prewarm exact-resolution display frames"
        )
        controller.reconcileWarm(authorization: warmAuthorization)
        controller.reconcileWarm(authorization: nil)
        require(
            capturer.warmReconcileCount == 5
                && capturer.lastWarmConfiguration == nil,
            "authorization removal did not retire warm capture"
        )

        capabilityEnabled = false
        var unauthorizedCode: String?
        controller.acquire(
            callerCanvasID: "stage",
            payload: payload,
            admitted: { _ in true }
        ) {
            unauthorizedCode = rejectedCode($0)
        }
        require(unauthorizedCode == "DESKTOP_FRAME_UNAUTHORIZED", "undeclared capability admitted")

        capabilityEnabled = true
        controller.reconcileWarm(authorization: warmAuthorization)
        capturer.failure = .permissionDenied
        var permissionLossCode: String?
        controller.acquire(
            callerCanvasID: "stage",
            payload: payload,
            admitted: { _ in true }
        ) {
            permissionLossCode = rejectedCode($0)
        }
        require(
            permissionLossCode == "DESKTOP_FRAME_PERMISSION_DENIED"
                && consent.snapshot().status == .permissionRequired,
            "runtime permission loss did not invalidate direct-capture consent"
        )
        require(
            capturer.lastWarmConfiguration == nil,
            "runtime permission loss retained the warm capture pool"
        )
        capturer.failure = nil
        var permissionRecoveryStatus: String?
        consent.prime(owner: owner) {
            permissionRecoveryStatus = $0.status.rawValue
        }
        require(
            permissionRecoveryStatus == "ready",
            "explicit prime did not recover runtime permission loss"
        )
        controller.reconcileWarm(authorization: warmAuthorization)

        var admittedConsumers = 0
        var delivery: AOSDesktopFrameCaptureDelivery?
        controller.acquire(
            callerCanvasID: "stage",
            payload: payload,
            admitted: {
                admittedConsumers = $0.consumers.count
                return true
            }
        ) {
            delivery = available($0)
        }
        guard let delivery else {
            require(false, "capture response missing")
            return
        }
        let response = delivery.payload
        require(admittedConsumers == 2, "capture admission omitted exact consumers")
        require(capturer.displayIDs == [42, 43], "capture epoch omitted a display")
        require(capturer.excludedWindowIDs == [7, 8], "stage windows were not excluded")
        require(
            capturer.lastCaptureConfiguration == capturer.lastWarmConfiguration,
            "interaction did not use the exact atomically prewarmed context"
        )
        require(
            capturer.maximumPixels == AOSDesktopFrameCaptureController.maximumPixelsPerDisplay,
            "pixel bound changed"
        )
        let frames = response["frames"] as? [[String: Any]] ?? []
        require(frames.count == 2, "multi-display frame set missing")
        require(Set(frames.compactMap { $0["display_id"] as? Int }) == Set([42, 43]), "display identity changed")
        require(response["capture_duration_ms"] as? Int == 14, "capture duration changed")
        require(response["data"] == nil, "raw bytes escaped")
        require(response["base64"] == nil, "base64 bytes escaped")
        require(response["path"] == nil, "local path escaped")

        let readyBase: [String: Any] = [
            "canvas_generation": 7,
            "epoch_id": delivery.epochID,
            "request_id": delivery.requestID,
            "topology_generation": 11,
        ]
        var staleReady = readyBase
        staleReady["canvas_generation"] = 8
        staleReady["segment_display_id"] = 42
        staleReady["segment_index"] = 0
        if case .rejected = controller.ready(callerCanvasID: "stage", payload: staleReady) {
        } else {
            require(false, "stale canvas generation entered the ready barrier")
        }
        var readyA = readyBase
        readyA["segment_display_id"] = 42
        readyA["segment_index"] = 0
        if case .pending = controller.ready(callerCanvasID: "stage", payload: readyA) {
        } else {
            require(false, "first display committed before the all-display barrier")
        }
        var readyB = readyBase
        readyB["segment_display_id"] = 43
        readyB["segment_index"] = 1
        if case .commit(let committed) = controller.ready(
            callerCanvasID: "stage",
            payload: readyB
        ) {
            require(committed.epochID == delivery.epochID, "committed epoch changed")
        } else {
            require(false, "all-display readiness did not commit")
        }
        var presentedA = readyBase
        presentedA["segment_display_id"] = 42
        presentedA["segment_index"] = 0
        if case .pending = controller.presented(
            callerCanvasID: "stage",
            payload: presentedA
        ) {
        } else {
            require(false, "first presented display completed before the all-display barrier")
        }
        var presentedB = readyBase
        presentedB["segment_display_id"] = 43
        presentedB["segment_index"] = 1
        if case .complete = controller.presented(
            callerCanvasID: "stage",
            payload: presentedB
        ) {
        } else {
            require(false, "all-display presentation did not settle")
        }

        capabilityEnabled = false
        let secondHandle = frames[1]["handle"] as! String
        do {
            _ = try store.take(
                handle: secondHandle,
                consumer: consumerB,
                authorize: { capabilityEnabled && $0 == leaseIdentity }
            )
            require(false, "revoked scene revision retained its frame lease")
        } catch AOSDesktopFrameStoreFailure.unauthorized {
        }
        require(store.count() == 0, "authorization revocation retained the capture epoch")
        capabilityEnabled = true

        var revocationDelivery: AOSDesktopFrameCaptureDelivery?
        controller.acquire(
            callerCanvasID: "stage",
            payload: payload,
            admitted: { _ in true }
        ) { revocationDelivery = available($0) }
        guard let revocationDelivery else {
            require(false, "revocation capture response missing")
            return
        }
        var revocationReadyA = readyBase
        revocationReadyA["epoch_id"] = revocationDelivery.epochID
        revocationReadyA["request_id"] = revocationDelivery.requestID
        revocationReadyA["segment_display_id"] = 42
        revocationReadyA["segment_index"] = 0
        if case .pending = controller.ready(
            callerCanvasID: "stage",
            payload: revocationReadyA
        ) {
        } else {
            require(false, "revocation capture first display did not stage")
        }
        var revocationReadyB = revocationReadyA
        revocationReadyB["segment_display_id"] = 43
        revocationReadyB["segment_index"] = 1
        if case .commit = controller.ready(
            callerCanvasID: "stage",
            payload: revocationReadyB
        ) {
        } else {
            require(false, "revocation capture did not enter presentation")
        }
        let abortCount = aborts.count
        capabilityEnabled = false
        require(controller.cancelUnauthorized(), "revoked authorization did not cancel capture")
        require(aborts.count == abortCount + 1, "revocation did not notify exact consumers")
        require(
            aborts.last?.requestID == revocationDelivery.requestID,
            "revocation aborted the wrong request"
        )
        capabilityEnabled = true

        capturer.deferred = true
        var lateResult: AOSDesktopFrameCaptureOutcome?
        controller.acquire(
            callerCanvasID: "stage",
            payload: payload,
            admitted: { _ in true }
        ) { lateResult = $0 }
        scheduledDeadlines.last?()
        require(capturer.canceled > 0, "hung capture deadline did not cancel native work")
        capturer.deferred = false
        var recoveryDelivery: AOSDesktopFrameCaptureDelivery?
        controller.acquire(
            callerCanvasID: "stage",
            payload: payload,
            admitted: { _ in true }
        ) { recoveryDelivery = available($0) }
        require(recoveryDelivery != nil, "capture deadline wedged the capability")
        _ = controller.releaseAll(callerCanvasID: "stage")
        capturer.pending?(.success(capturer.result([42, 43])))
        require(lateResult == nil, "late native result escaped after deadline cancellation")
        require(store.count() == 0, "late capture retained pixels")

        let output: [String: Any] = [
            "captureDurationMs": response["capture_duration_ms"] as! Int,
            "displayCount": frames.count,
            "excludedWindowCount": capturer.excludedWindowIDs.count,
            "maximumPixels": capturer.maximumPixels,
            "storeBound": AOSDesktopFrameStore.maximumEntries,
        ]
        let encoded = try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys])
        print(String(data: encoded, encoding: .utf8)!)
    }
}
`)
  const moduleCache = path.join(root, 'module-cache')
  await mkdir(moduleCache, { mode: 0o700 })
  execFileSync('swiftc', [
    '-parse-as-library',
    taskStateSource,
    displayGeometrySource,
    storeSource,
    consentContractSource,
    brokerSource,
    retirementSource,
    nativeOperationSource,
    streamLifecycleSource,
    captureFilterSource,
    sampleAdmissionSource,
    nativePixelSource,
    warmPoolSource,
    captureAdapterSource,
    consentSource,
    controllerSource,
    responseEnvelopeSource,
    captureFilterTestsSource,
    nativeLifecycleTestsSource,
    terminalStartupTestsSource,
    startupCallbackTestsSource,
    warmOpenOperationTestsSource,
    brokerTestsSource,
    warmPoolTestsSource,
    main,
    '-o',
    executable,
  ], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CLANG_MODULE_CACHE_PATH: moduleCache,
      SWIFT_MODULECACHE_PATH: moduleCache,
    },
    stdio: 'pipe',
  })
  return executable
}

test('native desktop-frame epoch is capability-bound, generation-safe, one-shot, and content-free', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-desktop-frame-native-'))
  try {
    const executable = await compileHarness(root)
    const runtimeRoot = path.join(root, 'runtime')
    await mkdir(runtimeRoot, { mode: 0o700 })
    const result = spawnSync(executable, [], { cwd: runtimeRoot, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(await readdir(runtimeRoot), [], 'direct-capture proof persisted runtime files')
    assert.deepEqual(JSON.parse(result.stdout), {
      captureDurationMs: 14,
      displayCount: 2,
      excludedWindowCount: 2,
      maximumPixels: 1_048_576,
      storeBound: 16,
    })
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test('daemon desktop-frame routing uses exact consumers and the decode-ready barrier', async () => {
  const unified = await readFile(path.join(repoRoot, 'src/daemon/unified.swift'), 'utf8')
  const surface = await readFile(
    path.join(repoRoot, 'src/display/desktop-world-surface.swift'),
    'utf8',
  )
  const route = unified.slice(
    unified.indexOf('private func handleDesktopFrameAcquire'),
    unified.indexOf('// MARK: - Connection Handling'),
  )
  assert.match(route, /desktop_frame\.started/u)
  assert.match(route, /desktop_frame\.available/u)
  assert.match(route, /desktop_frame\.commit/u)
  assert.match(route, /desktop_frame\.complete/u)
  assert.match(route, /desktop_frame\.abort/u)
  assert.match(unified, /desktop_frame\.presented/u)
  assert.match(unified, /desktopFrameCapture\.cancelUnauthorized\(\)/u)
  assert.match(unified, /desktopFrameCapture\.reconcileWarm\(/u)
  assert.match(unified, /desktopFrameTextureAuthorization\(\)/u)
  assert.equal(
    (unified.match(/AOSDesktopFrameDirectCaptureWireContract\.responsePayload/gu) ?? []).length,
    2,
    'direct-capture status and prime routes must preserve capability status in the envelope',
  )
  assert.match(route, /exactDesktopFrameConsumers/u)
  assert.doesNotMatch(route, /postMessageToCurrentCanvasAsync/u)
  assert.match(surface, /type == "desktop_frame\.ready"/u)
  assert.match(surface, /type == "desktop_frame\.presented"/u)
  assert.match(surface, /type == "desktop_frame\.cancel"/u)
  assert.match(surface, /type == "desktop_frame\.release"/u)
})
