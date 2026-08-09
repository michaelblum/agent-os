import AppKit
import CoreMedia
import CoreVideo
import Foundation
import ScreenCaptureKit

func aosDesktopFrameCaptureFailure(for error: Error) -> AOSDesktopFrameCaptureFailure {
    if let failure = error as? AOSDesktopFrameCaptureFailure {
        return failure
    }
    let native = error as NSError
    if native.domain == SCStreamErrorDomain,
       native.code == SCStreamError.Code.userDeclined.rawValue {
        return .permissionDenied
    }
    if native.domain == SCStreamErrorDomain,
       native.code == SCStreamError.Code.failedApplicationConnectionInterrupted.rawValue {
        return .connectionInterrupted
    }
    if !CGPreflightScreenCaptureAccess() {
        return .permissionDenied
    }
    return .captureFailed
}

func aosDesktopPixelNativeTraceCode(for error: Error) -> String {
    let native = error as NSError
    guard native.domain == SCStreamErrorDomain else { return "native_other" }
    return "scstream_\(native.code)"
}

private func aosLogDesktopPixelWarmOpenFailure(
    phase: String,
    elapsedSince startedAt: Date,
    code: String
) {
    let elapsedMilliseconds = max(
        0,
        Int(Date().timeIntervalSince(startedAt) * 1_000)
    )
    fputs(
        "[desktop-pixel] warm-open failed phase=\(phase) "
            + "elapsed_ms=\(elapsedMilliseconds) code=\(code)\n",
        stderr
    )
}

private func aosDesktopPixelNativeError(
    _ result: Result<Void, Error>
) -> Error? {
    if case .failure(let error) = result { return error }
    return nil
}

struct AOSDesktopPixelStillDisplayOutcome {
    var displayFailure: AOSDesktopFrameCaptureFailure?
    var displayFrame: AOSDesktopPixelFrame?
    let windowTarget: AOSDesktopPixelWindowTarget?
    var windowFailure: AOSDesktopFrameCaptureFailure?
    var windowFrame: AOSDesktopPixelFrame?
}

func aosResolveDesktopPixelStillOutcomes(
    displayIDs: [UInt32],
    outcomes: [UInt32: AOSDesktopPixelStillDisplayOutcome]
) -> Result<[AOSDesktopPixelFrame], AOSDesktopFrameCaptureFailure> {
    if outcomes.values.contains(where: {
        $0.displayFailure == .retirementUncertain
            || $0.windowFailure == .retirementUncertain
    }) {
        return .failure(.retirementUncertain)
    }
    var frames: [AOSDesktopPixelFrame] = []
    var failures: [AOSDesktopFrameCaptureFailure] = []
    for displayID in displayIDs {
        guard let outcome = outcomes[displayID] else {
            failures.append(.captureFailed)
            continue
        }
        if outcome.windowTarget != nil,
           let windowFrame = outcome.windowFrame {
            frames.append(windowFrame)
        } else if outcome.windowTarget.map(\.fallback) == .some(.none) {
            failures.append(outcome.windowFailure ?? .captureFailed)
        } else if let displayFrame = outcome.displayFrame,
                  let image = displayFrame.image {
            frames.append(AOSDesktopPixelFrame(
                capturedAt: displayFrame.capturedAt,
                displayID: displayID,
                image: image,
                source: .display,
                usedWindowFallback: outcome.windowTarget != nil
            ))
        } else {
            failures.append(
                outcome.windowFailure
                    ?? outcome.displayFailure
                    ?? .captureFailed
            )
        }
    }
    if let failure = failures.first { return .failure(failure) }
    return .success(frames)
}

private func aosDesktopPixelWindowMatchesTarget(
    _ window: SCWindow,
    target: AOSDesktopPixelWindowTarget,
    displayBounds: CGRect
) -> Bool {
    guard Int(window.windowID) == target.windowID,
          Int(window.owningApplication?.processID ?? 0) == target.ownerPID,
          window.frame.integral == target.expectedBounds.integral else {
        return false
    }
    switch target.fallback {
    case .display:
        return displayBounds.contains(CGPoint(
            x: window.frame.midX,
            y: window.frame.midY
        ))
    case .none:
        return displayBounds.contains(window.frame.integral)
    }
}

private final class AOSDesktopPixelNativeTrace: @unchecked Sendable {
    private let startedAt = Date()

    func emit(
        _ event: String,
        slot: Int,
        code: String? = nil,
        nativeCode: String? = nil
    ) {
        var fields = [
            "event=\(event)",
            "slot=\(slot)",
            "elapsed_ms=\(max(0, Int(Date().timeIntervalSince(startedAt) * 1_000)))",
        ]
        if let code { fields.append("code=\(code)") }
        if let nativeCode { fields.append("native=\(nativeCode)") }
        fputs("[desktop-pixel] \(fields.joined(separator: " "))\n", stderr)
    }
}

private final class AOSDesktopPixelSourceFailureState: @unchecked Sendable {
    private var failure: Error?
    private let lock = NSLock()
    private var observer: ((Error) -> Void)?
    private var terminalDelivered = false

    func record(_ error: Error) {
        let delivery: ((Error) -> Void)?
        lock.lock()
        if failure == nil { failure = error }
        if terminalDelivered {
            delivery = nil
        } else {
            terminalDelivered = observer != nil
            delivery = observer
        }
        lock.unlock()
        delivery?(error)
    }

    func current() -> Error? {
        lock.lock()
        defer { lock.unlock() }
        return failure
    }

    func observe(_ observer: @escaping (Error) -> Void) {
        let delivery: Error?
        lock.lock()
        self.observer = observer
        if terminalDelivered {
            delivery = nil
        } else {
            delivery = failure
            terminalDelivered = delivery != nil
        }
        lock.unlock()
        if let delivery { observer(delivery) }
    }
}

struct AOSDesktopPixelWarmStreamProfile: Equatable {
    static let queueDepth = 3

    let height: Int
    let width: Int

    init?(
        sourceWidth: Int,
        sourceHeight: Int,
        maximumPixels: Int,
        sizingPolicy: AOSDesktopPixelSizingPolicy = .fitWithinBudget
    ) {
        guard sourceWidth >= 2,
              sourceHeight >= 2,
              maximumPixels >= 4 else {
            return nil
        }
        let width = sourceWidth
        let height = sourceHeight
        let multiplied = width.multipliedReportingOverflow(by: height)
        let sourcePixels = multiplied.overflow ? Int.max : multiplied.partialValue
        if sizingPolicy == .exactWithinBudget, sourcePixels > maximumPixels {
            return nil
        }
        let scale = sizingPolicy == .fitWithinBudget && sourcePixels > maximumPixels
            ? sqrt(Double(maximumPixels) / Double(sourcePixels))
            : 1
        let scaledWidth = sizingPolicy == .exactWithinBudget
            ? width
            : Int((Double(width) * scale).rounded(.down))
        let scaledHeight = sizingPolicy == .exactWithinBudget
            ? height
            : Int((Double(height) * scale).rounded(.down))
        guard scaledWidth >= 2, scaledHeight >= 2 else { return nil }
        self.width = sizingPolicy == .exactWithinBudget
            ? scaledWidth
            : Self.alignedDimension(scaledWidth)
        self.height = sizingPolicy == .exactWithinBudget
            ? scaledHeight
            : Self.alignedDimension(scaledHeight)
        let outputPixels = self.width.multipliedReportingOverflow(by: self.height)
        guard !outputPixels.overflow,
              outputPixels.partialValue <= maximumPixels else {
            return nil
        }
    }

    private static func alignedDimension(_ value: Int) -> Int {
        value - (value % 2)
    }
}

@available(macOS 14.0, *)
private func aosDesktopPixelSourceDimensions(
    display: SCDisplay,
    filter: SCContentFilter,
    request: AOSDesktopPixelSnapshotRequest
) throws -> AOSDesktopPixelDimensions {
    if let geometry = request.displayLayout?.geometry(displayID: display.displayID) {
        guard geometry.acceptsCaptureSource(
            pointWidth: display.width,
            pointHeight: display.height,
            pointPixelScale: filter.pointPixelScale
        ) else {
            throw AOSDesktopFrameCaptureFailure.topologyMismatch
        }
        return geometry.pixelDimensions
    }
    guard request.sizingPolicy != .exactWithinBudget,
          let dimensions = AOSDesktopPixelDimensions(
            pointWidth: Double(display.width),
            pointHeight: Double(display.height),
            pointPixelScale: Double(filter.pointPixelScale)
          ) else {
        throw AOSDesktopFrameCaptureFailure.topologyMismatch
    }
    return dimensions
}

func aosValidateDesktopPixelPublicCaptureAdmission(
    request: AOSDesktopPixelSnapshotRequest,
    providerFacts: [AOSDisplayCaptureProviderFact]
) throws -> [AOSDisplayCaptureAlignment] {
    guard request.capturePolicy == .publicExplicitExclusions,
          let topology = request.publicCaptureTopology,
          request.publicCaptureSelections.map(\.runtimeDisplayID)
            == request.displayIDs else {
        throw AOSDesktopFrameCaptureFailure.topologyMismatch
    }
    do {
        return try validateAOSDisplayCaptureAlignment(
            topology: topology,
            providerFacts: providerFacts,
            selectedDisplays: request.publicCaptureSelections
        )
    } catch {
        throw AOSDesktopFrameCaptureFailure.topologyMismatch
    }
}

@available(macOS 14.0, *)
private func aosDesktopPixelPublicCaptureProviderFact(
    display: SCDisplay,
    filter: SCContentFilter,
    selection: AOSDisplayCaptureSelection
) throws -> AOSDisplayCaptureProviderFact {
    let displayUUID: String? = {
        guard let unmanaged = CGDisplayCreateUUIDFromDisplayID(
            display.displayID
        ) else {
            return nil
        }
        return CFUUIDCreateString(nil, unmanaged.takeRetainedValue()) as String
    }()
    let memberIdentity: AOSDisplayTopologyMemberIdentity
    do {
        memberIdentity = try aosDisplayCaptureProviderMemberIdentity(
            runtimeDisplayID: display.displayID,
            displayUUID: displayUUID,
            expectedMemberIdentity: selection.memberIdentity
        )
    } catch {
        throw AOSDesktopFrameCaptureFailure.topologyMismatch
    }
    let nativeFrame = CGDisplayBounds(display.displayID)
    return AOSDisplayCaptureProviderFact(
        runtimeDisplayID: display.displayID,
        memberIdentity: memberIdentity,
        nativeFrame: AOSDisplayTopologyBounds(
            x: nativeFrame.origin.x,
            y: nativeFrame.origin.y,
            width: nativeFrame.width,
            height: nativeFrame.height
        ),
        pointWidth: display.width,
        pointHeight: display.height,
        scaleFactor: Double(filter.pointPixelScale)
    )
}

private final class AOSNativeDesktopPixelStillOperation:
    AOSDesktopFrameRetirementAwaiting,
    @unchecked Sendable
{
    @available(macOS 14.0, *)
    private struct PreparedDisplayCapture {
        enum Source {
            case display
            case window(Int)
        }

        let displayID: UInt32
        let filter: SCContentFilter
        let height: Int
        let source: Source
        let width: Int
    }

    private static let callbackDeadline: TimeInterval = 5

    private let completion: (Result<AOSDesktopPixelFrameSet, Error>) -> Void
    private var canceled = false
    private var contentPending = true
    private var displayOutcomes: [UInt32: AOSDesktopPixelStillDisplayOutcome] = [:]
    private var finished = false
    private let lock = NSLock()
    private var outstandingNativeCallbacks = 0
    private var pendingCaptureCallbacks = 0
    private let request: AOSDesktopPixelSnapshotRequest
    private var retirementWaiters: [(Result<Void, Error>) -> Void] = []
    private let startedAt = Date()

    init(
        request: AOSDesktopPixelSnapshotRequest,
        completion: @escaping (Result<AOSDesktopPixelFrameSet, Error>) -> Void
    ) {
        self.request = request
        self.completion = completion
    }

    func start() {
        guard #available(macOS 14.0, *) else {
            finish(.failure(AOSDesktopFrameCaptureFailure.unsupported))
            return
        }
        guard CGPreflightScreenCaptureAccess() else {
            finish(.failure(AOSDesktopFrameCaptureFailure.permissionDenied))
            return
        }
        guard aosDesktopPixelRequestIsValid(request) else {
            finish(.failure(AOSDesktopFrameCaptureFailure.captureFailed))
            return
        }
        let token = AOSDesktopPixelRetainedCallbackToken<SCShareableContent>()
        registerNativeCallback()
        token.start(
            deadline: Self.callbackDeadline,
            nativeStart: { callback in
                SCShareableContent.getExcludingDesktopWindows(
                    false,
                    onScreenWindowsOnly: true,
                    completionHandler: callback
                )
            },
            authoritativeSettlement: { [weak self] in
                self?.nativeCallbackSettled()
            },
            completion: { [weak self] result in
                guard let self else { return }
                switch result {
                case .success(let content):
                    DispatchQueue.main.async { self.contentReady(content) }
                case .failure(let error):
                    self.finish(.failure(aosDesktopFrameCaptureFailure(for: error)))
                }
            }
        )
    }

    func cancel() {
        lock.lock()
        canceled = true
        let canFinish = !contentPending && pendingCaptureCallbacks == 0
        lock.unlock()
        if canFinish {
            finish(.failure(AOSDesktopFrameCaptureFailure.unauthorized))
        }
    }

    func cancelAndAwaitRetirement(
        _ completion: @escaping (Result<Void, Error>) -> Void
    ) {
        lock.lock()
        if finished && outstandingNativeCallbacks == 0 {
            lock.unlock()
            completion(.success(()))
            return
        }
        retirementWaiters.append(completion)
        lock.unlock()
        cancel()
    }

    @available(macOS 14.0, *)
    private func contentReady(_ content: SCShareableContent) {
        lock.lock()
        contentPending = false
        let isCanceled = canceled
        lock.unlock()
        guard !isCanceled else {
            finish(.failure(AOSDesktopFrameCaptureFailure.unauthorized))
            return
        }
        var displayByID: [UInt32: SCDisplay] = [:]
        for display in content.displays {
            guard displayByID.updateValue(
                display,
                forKey: display.displayID
            ) == nil else {
                finish(.failure(AOSDesktopFrameCaptureFailure.topologyMismatch))
                return
            }
        }
        guard request.displayIDs.allSatisfy({ displayByID[$0] != nil }) else {
            finish(.failure(AOSDesktopFrameCaptureFailure.topologyMismatch))
            return
        }
        do {
            var displayFilters: [UInt32: SCContentFilter] = [:]
            var providerFacts: [AOSDisplayCaptureProviderFact] = []
            let selectionByDisplayID = Dictionary(
                uniqueKeysWithValues: request.publicCaptureSelections.map {
                    ($0.runtimeDisplayID, $0)
                }
            )
            for displayID in request.displayIDs {
                guard let display = displayByID[displayID] else {
                    throw AOSDesktopFrameCaptureFailure.topologyMismatch
                }
                let displayFilter = try aosDesktopPixelCaptureFilter(
                    content: content,
                    display: display,
                    excludingWindowIDs: request.excludingWindowIDs,
                    policy: request.capturePolicy
                )
                displayFilters[displayID] = displayFilter
                if request.capturePolicy == .publicExplicitExclusions {
                    guard let selection = selectionByDisplayID[displayID] else {
                        throw AOSDesktopFrameCaptureFailure.topologyMismatch
                    }
                    providerFacts.append(
                        try aosDesktopPixelPublicCaptureProviderFact(
                            display: display,
                            filter: displayFilter,
                            selection: selection
                        )
                    )
                }
            }
            let publicAlignments = request.capturePolicy == .publicExplicitExclusions
                ? try aosValidateDesktopPixelPublicCaptureAdmission(
                    request: request,
                    providerFacts: providerFacts
                )
                : []
            let publicAlignmentByDisplayID = Dictionary(
                uniqueKeysWithValues: publicAlignments.map {
                    ($0.runtimeDisplayID, $0)
                }
            )
            var prepared: [PreparedDisplayCapture] = []
            var outcomes: [UInt32: AOSDesktopPixelStillDisplayOutcome] = [:]
            for displayID in request.displayIDs {
                guard let display = displayByID[displayID],
                      let displayFilter = displayFilters[displayID] else {
                    throw AOSDesktopFrameCaptureFailure.topologyMismatch
                }
                let sourceWidth: Int
                let sourceHeight: Int
                if request.capturePolicy == .publicExplicitExclusions {
                    guard let alignment = publicAlignmentByDisplayID[displayID] else {
                        throw AOSDesktopFrameCaptureFailure.topologyMismatch
                    }
                    sourceWidth = alignment.expectedPixelWidth
                    sourceHeight = alignment.expectedPixelHeight
                } else {
                    let source = try aosDesktopPixelSourceDimensions(
                        display: display,
                        filter: displayFilter,
                        request: request
                    )
                    sourceWidth = source.width
                    sourceHeight = source.height
                }
                guard let profile = AOSDesktopPixelWarmStreamProfile(
                    sourceWidth: sourceWidth,
                    sourceHeight: sourceHeight,
                    maximumPixels: request.maximumPixelsPerDisplay,
                    sizingPolicy: request.sizingPolicy
                ) else {
                    throw AOSDesktopFrameCaptureFailure.captureFailed
                }
                let windowTarget = request.windowTargetsByDisplay[display.displayID]
                outcomes[display.displayID] = AOSDesktopPixelStillDisplayOutcome(
                    displayFailure: nil,
                    displayFrame: nil,
                    windowTarget: windowTarget,
                    windowFailure: nil,
                    windowFrame: nil
                )
                if windowTarget.map(\.fallback) != .some(.none) {
                    prepared.append(PreparedDisplayCapture(
                        displayID: display.displayID,
                        filter: displayFilter,
                        height: profile.height,
                        source: .display,
                        width: profile.width
                    ))
                }
                let matchingWindows = windowTarget.map { target in
                    content.windows.filter {
                        Int($0.windowID) == target.windowID
                    }
                } ?? []
                if let windowTarget,
                   !request.excludingWindowIDs.contains(windowTarget.windowID),
                   matchingWindows.count == 1,
                   let window = matchingWindows.first,
                   let geometry = request.displayLayout?.geometry(
                       displayID: display.displayID
                   ),
                   aosDesktopPixelWindowMatchesTarget(
                       window,
                       target: windowTarget,
                       displayBounds: geometry.nativePointBounds
                   ),
                   let dimensions = AOSDesktopPixelDimensions(
                       pointWidth: windowTarget.expectedBounds.width,
                       pointHeight: windowTarget.expectedBounds.height,
                       pointPixelScale: geometry.pointPixelScale
                   ),
                   dimensions.pixelCount.map({
                       $0 <= request.maximumPixelsPerDisplay
                   }) == true {
                    prepared.append(PreparedDisplayCapture(
                        displayID: display.displayID,
                        filter: SCContentFilter(desktopIndependentWindow: window),
                        height: dimensions.height,
                        source: .window(windowTarget.windowID),
                        width: dimensions.width
                    ))
                } else if windowTarget.map(\.fallback) == .some(.none) {
                    throw AOSDesktopFrameCaptureFailure.topologyMismatch
                }
            }
            lock.lock()
            guard !finished, !canceled else {
                lock.unlock()
                finish(.failure(AOSDesktopFrameCaptureFailure.unauthorized))
                return
            }
            displayOutcomes = outcomes
            pendingCaptureCallbacks = prepared.count
            lock.unlock()
            for entry in prepared {
                let configuration = SCStreamConfiguration()
                configuration.width = entry.width
                configuration.height = entry.height
                configuration.showsCursor = request.showsCursor
                configuration.captureResolution = .best
                configuration.ignoreShadowsSingleWindow = true
                let token = AOSDesktopPixelRetainedCallbackToken<CGImage>()
                registerNativeCallback()
                token.start(
                    deadline: Self.callbackDeadline,
                    nativeStart: { callback in
                        SCScreenshotManager.captureImage(
                            contentFilter: entry.filter,
                            configuration: configuration,
                            completionHandler: callback
                        )
                    },
                    authoritativeSettlement: { [weak self] in
                        self?.nativeCallbackSettled()
                    },
                    completion: { [weak self] result in
                        self?.imageSettled(
                            result,
                            capture: entry,
                            expectedWidth: entry.width,
                            expectedHeight: entry.height
                        )
                    }
                )
            }
        } catch {
            finish(.failure(aosDesktopFrameCaptureFailure(for: error)))
        }
    }

    private func imageSettled(
        _ result: Result<CGImage, Error>,
        capture: PreparedDisplayCapture,
        expectedWidth: Int,
        expectedHeight: Int
    ) {
        let frame: AOSDesktopPixelFrame?
        let failure: AOSDesktopFrameCaptureFailure?
        switch result {
        case .failure(let error):
            frame = nil
            failure = aosDesktopFrameCaptureFailure(for: error)
        case .success(let image):
            if image.width == expectedWidth, image.height == expectedHeight {
                frame = AOSDesktopPixelFrame(
                    capturedAt: Date(),
                    displayID: capture.displayID,
                    image: image,
                    source: {
                        switch capture.source {
                        case .display: return .display
                        case .window(let windowID): return .window(windowID)
                        }
                    }()
                )
                failure = nil
            } else {
                frame = nil
                failure = .captureFailed
            }
        }
        lock.lock()
        guard !finished,
              pendingCaptureCallbacks > 0,
              var outcome = displayOutcomes[capture.displayID] else {
            lock.unlock()
            return
        }
        switch capture.source {
        case .display:
            outcome.displayFrame = frame
            outcome.displayFailure = failure
        case .window:
            outcome.windowFrame = frame
            outcome.windowFailure = failure
        }
        displayOutcomes[capture.displayID] = outcome
        pendingCaptureCallbacks -= 1
        let complete = pendingCaptureCallbacks == 0
        let canceled = self.canceled
        let outcomes = displayOutcomes
        lock.unlock()
        guard complete else { return }
        if canceled {
            finish(.failure(AOSDesktopFrameCaptureFailure.unauthorized))
        } else {
            switch aosResolveDesktopPixelStillOutcomes(
                displayIDs: request.displayIDs,
                outcomes: outcomes
            ) {
            case .failure(let failure):
                finish(.failure(failure))
            case .success(let frames):
                finish(.success(AOSDesktopPixelFrameSet(
                    capturedAt: startedAt,
                    durationMilliseconds: max(
                        0,
                        Int(Date().timeIntervalSince(startedAt) * 1_000)
                    ),
                    frames: frames
                )))
            }
        }
    }

    private func registerNativeCallback() {
        lock.lock()
        outstandingNativeCallbacks += 1
        lock.unlock()
    }

    private func nativeCallbackSettled() {
        lock.lock()
        precondition(outstandingNativeCallbacks > 0)
        outstandingNativeCallbacks -= 1
        let waiters: [(Result<Void, Error>) -> Void]
        if finished && outstandingNativeCallbacks == 0 {
            waiters = retirementWaiters
            retirementWaiters = []
        } else {
            waiters = []
        }
        lock.unlock()
        waiters.forEach { $0(.success(())) }
    }

    private func finish(_ result: Result<AOSDesktopPixelFrameSet, Error>) {
        lock.lock()
        guard !finished else {
            lock.unlock()
            return
        }
        finished = true
        pendingCaptureCallbacks = 0
        displayOutcomes.removeAll()
        let waiters: [(Result<Void, Error>) -> Void]
        if outstandingNativeCallbacks == 0 {
            waiters = retirementWaiters
            retirementWaiters = []
        } else {
            waiters = []
        }
        lock.unlock()
        completion(result)
        waiters.forEach { $0(.success(())) }
    }
}

private struct AOSDesktopPixelLatestSample: @unchecked Sendable {
    let capturedAt: Date
    let sampleBuffer: CMSampleBuffer
}

private final class AOSDesktopPixelStreamOutput: NSObject,
    AOSDesktopPixelStreamLifecycle,
    SCStreamOutput,
    SCStreamDelegate
{
    let displayID: UInt32
    private var acceptingSamples = true
    private var failure: Error?
    private var frameAdvancement = AOSDesktopPixelFrameAdvancement()
    private var latestSample: AOSDesktopPixelLatestSample?
    private let lock = NSLock()
    private let nativeStopped: @Sendable (Error) -> Void
    private let retirementLatch = AOSDesktopPixelRetirementLatch()
    private let slot: Int
    private let startupSignal: AOSDesktopPixelStartupSignal
    private let trace: AOSDesktopPixelNativeTrace

    init(
        displayID: UInt32,
        slot: Int,
        nativeStopped: @escaping @Sendable (Error) -> Void,
        startupSignal: AOSDesktopPixelStartupSignal,
        trace: AOSDesktopPixelNativeTrace
    ) {
        self.displayID = displayID
        self.slot = slot
        self.nativeStopped = nativeStopped
        self.startupSignal = startupSignal
        self.trace = trace
    }

    func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of outputType: SCStreamOutputType
    ) {
        guard outputType == .screen,
              CMSampleBufferIsValid(sampleBuffer) else {
            return
        }
        guard let attachments = CMSampleBufferGetSampleAttachmentsArray(
            sampleBuffer,
            createIfNecessary: false
        ) as? [[SCStreamFrameInfo: Any]],
              let statusValue = attachments.first?[.status] as? NSNumber else {
            return
        }
        let presentationTime = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        let admission = aosDesktopPixelSampleAdmission(
            statusRawValue: statusValue.intValue,
            presentationTime: presentationTime,
            hasImageBuffer: CMSampleBufferGetImageBuffer(sampleBuffer) != nil
        )
        guard let admission else { return }

        var firstFrame = false
        lock.lock()
        if acceptingSamples,
           frameAdvancement.observe(presentationTime: presentationTime) {
            if admission == .frame {
                firstFrame = latestSample == nil
                latestSample = AOSDesktopPixelLatestSample(
                    capturedAt: Date(),
                    sampleBuffer: sampleBuffer
                )
            }
        }
        lock.unlock()
        if firstFrame {
            trace.emit("first_sample", slot: slot)
            startupSignal.succeed()
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        lock.lock()
        acceptingSamples = false
        failure = error
        frameAdvancement = AOSDesktopPixelFrameAdvancement()
        latestSample = nil
        lock.unlock()
        trace.emit(
            "delegate_stopped",
            slot: slot,
            code: aosDesktopFrameCaptureFailure(for: error).code,
            nativeCode: aosDesktopPixelNativeTraceCode(for: error)
        )
        retirementLatch.observe()
        nativeStopped(error)
        startupSignal.fail(error)
    }

    func startSettled(_ error: Error?) {
        if let error {
            lock.lock()
            acceptingSamples = false
            failure = error
            lock.unlock()
        }
        trace.emit(
            "start_settled",
            slot: slot,
            code: error.map { aosDesktopFrameCaptureFailure(for: $0).code },
            nativeCode: error.map(aosDesktopPixelNativeTraceCode)
        )
    }

    func stopInvoked() {
        trace.emit("stop_invoked", slot: slot)
    }

    func stopSettled(_ error: Error?) {
        trace.emit(
            "stop_settled",
            slot: slot,
            code: error.map { aosDesktopFrameCaptureFailure(for: $0).code },
            nativeCode: error.map(aosDesktopPixelNativeTraceCode)
        )
    }

    func retirementWasObserved() -> Bool {
        retirementLatch.snapshot()
    }

    func admitExplicitStop() -> AOSDesktopPixelStopAdmission {
        retirementLatch.admitExplicitStop()
    }

    func confirmRetirement() {
        retirementLatch.observe()
    }

    func waitForRetirement(timeout: TimeInterval) async -> Bool {
        await retirementLatch.wait(timeout: timeout)
    }

    func sampleIsReady() throws -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if let failure {
            throw aosDesktopFrameCaptureFailure(for: failure)
        }
        return latestSample != nil && frameAdvancement.isReady
    }

    func snapshot() throws -> AOSDesktopPixelLatestSample {
        lock.lock()
        defer { lock.unlock() }
        if let failure {
            throw aosDesktopFrameCaptureFailure(for: failure)
        }
        guard let latestSample else {
            throw AOSDesktopFrameCaptureFailure.frameNotReady
        }
        return latestSample
    }

    func quiesce() {
        lock.lock()
        acceptingSamples = false
        frameAdvancement = AOSDesktopPixelFrameAdvancement()
        latestSample = nil
        lock.unlock()
    }
}

@available(macOS 14.0, *)
private final class AOSNativeDesktopPixelWarmSource: AOSDesktopPixelWarmSource,
    @unchecked Sendable
{
    private struct Entry: @unchecked Sendable {
        let output: AOSDesktopPixelStreamOutput
        let sampleQueue: DispatchQueue
        let startOperation: AOSDesktopPixelRetainedNativeOperation
        let startupSignal: AOSDesktopPixelStartupSignal
        let stopOperation: AOSDesktopPixelRetainedNativeOperation
        let stream: SCStream
    }

    private var entries: [Entry]
    private let failureState: AOSDesktopPixelSourceFailureState
    private let lock = NSLock()
    private var stopFinished = false
    private var stopResult: Result<Void, Error>?
    private var stopStarted = false
    private var stopWaiters: [(Result<Void, Error>) -> Void] = []
    private var stopped = false
    private var startupOwner: AOSDesktopPixelStartupOwner?

    private init(
        entries: [Entry],
        failureState: AOSDesktopPixelSourceFailureState,
        startupOwner: AOSDesktopPixelStartupOwner
    ) {
        self.entries = entries
        self.failureState = failureState
        self.startupOwner = startupOwner
    }

    @MainActor
    static func open(
        request: AOSDesktopPixelSnapshotRequest,
        cancellation: AOSDesktopPixelStartupCancellation
    ) async throws -> AOSNativeDesktopPixelWarmSource {
        guard CGPreflightScreenCaptureAccess() else {
            throw AOSDesktopFrameCaptureFailure.permissionDenied
        }
        guard aosDesktopPixelRequestIsValid(request) else {
            throw AOSDesktopFrameCaptureFailure.captureFailed
        }
        try Task.checkCancellation()

        let content: SCShareableContent
        do {
            content = try await SCShareableContent.excludingDesktopWindows(
                false,
                onScreenWindowsOnly: false
            )
        } catch {
            throw aosDesktopFrameCaptureFailure(for: error)
        }
        let requested = Set(request.displayIDs)
        let displays = content.displays.filter { requested.contains($0.displayID) }
        guard displays.count == requested.count else {
            throw AOSDesktopFrameCaptureFailure.displayNotFound
        }
        var entries: [Entry] = []
        var phase = "configure"
        var startupCompleted = false
        var startupOwner: AOSDesktopPixelStartupOwner?
        let openedAt = Date()
        let sourceFailure = AOSDesktopPixelSourceFailureState()
        let trace = AOSDesktopPixelNativeTrace()

        do {
            for (slot, display) in displays.sorted(
                by: { $0.displayID < $1.displayID }
            ).enumerated() {
                try Task.checkCancellation()
                let filter = try aosDesktopPixelCaptureFilter(
                    content: content,
                    display: display,
                    excludingWindowIDs: request.excludingWindowIDs
                )
                let source = try aosDesktopPixelSourceDimensions(
                    display: display,
                    filter: filter,
                    request: request
                )
                guard let profile = AOSDesktopPixelWarmStreamProfile(
                        sourceWidth: source.width,
                        sourceHeight: source.height,
                        maximumPixels: request.maximumPixelsPerDisplay,
                        sizingPolicy: request.sizingPolicy
                      ) else {
                    throw AOSDesktopFrameCaptureFailure.captureFailed
                }
                let configuration = SCStreamConfiguration()
                configuration.width = profile.width
                configuration.height = profile.height
                configuration.showsCursor = false
                configuration.capturesAudio = false
                configuration.minimumFrameInterval = CMTime(value: 1, timescale: 30)
                // Retaining the latest IOSurface occupies one producer slot.
                // Two additional slots permit ScreenCaptureKit to advance.
                configuration.queueDepth = AOSDesktopPixelWarmStreamProfile.queueDepth
                configuration.pixelFormat = kCVPixelFormatType_32BGRA
                let startupSignal = AOSDesktopPixelStartupSignal()
                let startOperation = AOSDesktopPixelRetainedNativeOperation(
                    executionQueue: DispatchQueue.global(qos: .userInitiated)
                )
                let stopOperation = AOSDesktopPixelRetainedNativeOperation(
                    executionQueue: DispatchQueue.global(qos: .utility)
                )
                let output = AOSDesktopPixelStreamOutput(
                    displayID: display.displayID,
                    slot: slot,
                    nativeStopped: { [weak startOperation, weak stopOperation, weak sourceFailure] error in
                        sourceFailure?.record(error)
                        startOperation?.settle(.failure(error))
                        stopOperation?.settle(.failure(error))
                    },
                    startupSignal: startupSignal,
                    trace: trace
                )
                let stream = SCStream(
                    filter: filter,
                    configuration: configuration,
                    delegate: output
                )
                let sampleQueue = DispatchQueue(
                    label: "io.agent-os.desktop-pixel.\(display.displayID)",
                    qos: .userInteractive
                )
                try stream.addStreamOutput(
                    output,
                    type: .screen,
                    sampleHandlerQueue: sampleQueue
                )
                entries.append(Entry(
                    output: output,
                    sampleQueue: sampleQueue,
                    startOperation: startOperation,
                    startupSignal: startupSignal,
                    stopOperation: stopOperation,
                    stream: stream
                ))
                trace.emit("configured", slot: slot)
            }
            phase = "start"
            let configuredEntries = entries
            startupOwner = try await aosStartDesktopPixelStreams(
                signals: configuredEntries.map(\.startupSignal),
                lifecycles: configuredEntries.map(\.output),
                settlementTimeout: aosDesktopPixelStreamRetirementTimeout,
                cancellation: cancellation,
                lateFailure: { error in sourceFailure.record(error) }
            ) { index, completion in
                let entry = configuredEntries[index]
                let output = entry.output
                let stream = entry.stream
                let started = entry.startOperation.start(operation: {
                    nativeCompletion in
                    trace.emit(
                        "start_invoked",
                        slot: index
                    )
                    stream.startCapture(completionHandler: nativeCompletion)
                }, completion: { result in
                    output.startSettled(aosDesktopPixelNativeError(result))
                    completion(result)
                })
                if !started {
                    completion(.failure(AOSDesktopFrameCaptureFailure.busy))
                }
            } stop: { index, completion in
                let entry = configuredEntries[index]
                let output = entry.output
                let stream = entry.stream
                output.quiesce()
                let started = entry.stopOperation.start(operation: {
                    nativeCompletion in
                    output.stopInvoked()
                    stream.stopCapture(completionHandler: nativeCompletion)
                }, completion: { result in
                    output.stopSettled(aosDesktopPixelNativeError(result))
                    completion(result)
                })
                if !started {
                    completion(.failure(AOSDesktopFrameCaptureFailure.busy))
                }
            }
            startupCompleted = true
            guard let startupOwner else {
                throw AOSDesktopFrameCaptureFailure.captureFailed
            }
            let source = AOSNativeDesktopPixelWarmSource(
                entries: entries,
                failureState: sourceFailure,
                startupOwner: startupOwner
            )
            // The browser-side request expires at 1.5 seconds. Leave the
            // remaining budget for freeze, encoding, decode, and presentation.
            phase = "sample"
            try await source.waitUntilReady(timeout: 0.75)
            return source
        } catch {
            entries.forEach { $0.output.quiesce() }
            if startupCompleted {
                if !(await startupOwner?.retire(
                    timeout: aosDesktopPixelStreamRetirementTimeout
                ) ?? false) {
                    aosLogDesktopPixelWarmOpenFailure(
                        phase: phase,
                        elapsedSince: openedAt,
                        code: AOSDesktopFrameCaptureFailure.retirementUncertain.code
                    )
                    throw AOSDesktopFrameCaptureFailure.retirementUncertain
                }
            }
            if error is CancellationError {
                throw error
            }
            let failure = aosDesktopFrameCaptureFailure(for: error)
            aosLogDesktopPixelWarmOpenFailure(
                phase: phase,
                elapsedSince: openedAt,
                code: failure.code
            )
            throw failure
        }
    }

    func freeze(maximumAge: TimeInterval) throws -> AOSDesktopPixelFrameSet {
        guard maximumAge > 0, maximumAge <= 5 else {
            throw AOSDesktopFrameCaptureFailure.captureFailed
        }
        if let failure = failureState.current() {
            throw aosDesktopFrameCaptureFailure(for: failure)
        }
        lock.lock()
        guard !stopped else {
            lock.unlock()
            throw AOSDesktopFrameCaptureFailure.leaseNotFound
        }
        let currentEntries = entries
        lock.unlock()

        let startedAt = Date()
        let samples = try currentEntries.map { entry in
            (entry.output.displayID, try entry.output.snapshot())
        }
        guard !samples.isEmpty else {
            throw AOSDesktopFrameCaptureFailure.frameNotReady
        }
        guard samples.allSatisfy({
            startedAt.timeIntervalSince($0.1.capturedAt) <= maximumAge
        }) else {
            throw AOSDesktopFrameCaptureFailure.staleFrame
        }
        let frames = try samples.map { displayID, latest in
            guard let pixelBuffer = CMSampleBufferGetImageBuffer(
                latest.sampleBuffer
            ) else {
                throw AOSDesktopFrameCaptureFailure.frameNotReady
            }
            return AOSDesktopPixelFrame(
                capturedAt: latest.capturedAt,
                displayID: displayID,
                pixelBuffer: pixelBuffer
            )
        }
        return AOSDesktopPixelFrameSet(
            capturedAt: samples.map(\.1.capturedAt).min() ?? startedAt,
            durationMilliseconds: max(
                0,
                Int(Date().timeIntervalSince(startedAt) * 1_000)
            ),
            frames: frames.sorted { $0.displayID < $1.displayID }
        )
    }

    func setTerminalObserver(_ observer: @escaping (Error) -> Void) {
        failureState.observe(observer)
    }

    func cancel(completion: @escaping (Result<Void, Error>) -> Void) {
        lock.lock()
        if stopFinished, let stopResult {
            lock.unlock()
            completion(stopResult)
            return
        }
        stopWaiters.append(completion)
        guard !stopStarted else {
            lock.unlock()
            return
        }
        stopStarted = true
        stopped = true
        let currentEntries = entries
        let currentStartupOwner = startupOwner
        entries = []
        startupOwner = nil
        lock.unlock()
        currentEntries.forEach { $0.output.quiesce() }
        Task.detached(priority: .utility) { [self] in
            if await currentStartupOwner?.retire(
                timeout: aosDesktopPixelStreamRetirementTimeout
            ) ?? currentEntries.isEmpty {
                finishStop(.success(()))
            } else {
                finishStop(.failure(
                    AOSDesktopFrameCaptureFailure.retirementUncertain
                ))
            }
        }
    }

    private func finishStop(_ result: Result<Void, Error>) {
        lock.lock()
        guard !stopFinished else {
            lock.unlock()
            return
        }
        stopFinished = true
        stopResult = result
        let waiters = stopWaiters
        stopWaiters = []
        lock.unlock()
        waiters.forEach { $0(result) }
    }

    private func waitUntilReady(timeout: TimeInterval) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            try Task.checkCancellation()
            if let failure = failureState.current() {
                throw aosDesktopFrameCaptureFailure(for: failure)
            }
            if try aosDesktopPixelStreamsAreReady(entries.map(\.output)) { return }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        throw AOSDesktopFrameCaptureFailure.frameNotReady
    }
}

final class AOSNativeDesktopPixelAcquirer: AOSDesktopPixelAcquiring,
    AOSDesktopPixelWarmAcquiring
{
    @discardableResult
    func snapshot(
        _ request: AOSDesktopPixelSnapshotRequest,
        completion: @escaping (Result<AOSDesktopPixelFrameSet, Error>) -> Void
    ) -> AOSDesktopFrameCancelling {
        let operation = AOSNativeDesktopPixelStillOperation(
            request: request,
            completion: completion
        )
        operation.start()
        return operation
    }

    @discardableResult
    func openWarm(
        _ request: AOSDesktopPixelSnapshotRequest,
        completion: @escaping (Result<AOSDesktopPixelWarmSource, Error>) -> Void
    ) -> AOSDesktopFrameCancelling {
        guard #available(macOS 14.0, *) else {
            completion(.failure(AOSDesktopFrameCaptureFailure.unsupported))
            return AOSDesktopFrameCancellation()
        }
        let operation = AOSDesktopPixelWarmOpenOperation(
            open: { cancellation in
                try await AOSNativeDesktopPixelWarmSource.open(
                    request: request,
                    cancellation: cancellation
                )
            },
            completion: completion
        )
        operation.start()
        return operation
    }
}
