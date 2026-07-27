import AppKit
import CoreImage
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

final class AOSDesktopPixelRetainedAsyncOperation: @unchecked Sendable {
    typealias Operation = @Sendable () async throws -> Void

    private var finished = false
    private let lock = NSLock()
    private let priority: TaskPriority
    private var started = false
    private var task: Task<Void, Never>?

    init(priority: TaskPriority) {
        self.priority = priority
    }

    @discardableResult
    func start(
        operation: @escaping Operation,
        completion: @escaping AOSDesktopPixelNativeCompletion
    ) -> Bool {
        lock.lock()
        guard !started else {
            lock.unlock()
            return false
        }
        started = true
        lock.unlock()

        let task = Task.detached(priority: priority) { [self] in
            let result: Result<Void, Error>
            do {
                try await operation()
                result = .success(())
            } catch {
                result = .failure(error)
            }
            finish(result, completion: completion)
        }

        lock.lock()
        if !finished { self.task = task }
        lock.unlock()
        return true
    }

    private func finish(
        _ result: Result<Void, Error>,
        completion: AOSDesktopPixelNativeCompletion
    ) {
        lock.lock()
        guard !finished else {
            lock.unlock()
            return
        }
        finished = true
        task = nil
        lock.unlock()
        completion(result)
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

    func record(_ error: Error) {
        lock.lock()
        if failure == nil { failure = error }
        lock.unlock()
    }

    func current() -> Error? {
        lock.lock()
        defer { lock.unlock() }
        return failure
    }
}

struct AOSDesktopPixelWarmStreamProfile: Equatable {
    static let queueDepth = 3

    let height: Int
    let width: Int

    init?(
        sourceWidth: Int,
        sourceHeight: Int,
        maximumPixels: Int
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
        let scale = sourcePixels > maximumPixels
            ? sqrt(Double(maximumPixels) / Double(sourcePixels))
            : 1
        let scaledWidth = Int((Double(width) * scale).rounded(.down))
        let scaledHeight = Int((Double(height) * scale).rounded(.down))
        guard scaledWidth >= 2, scaledHeight >= 2 else { return nil }
        self.width = Self.alignedDimension(scaledWidth)
        self.height = Self.alignedDimension(scaledHeight)
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

private actor AOSNativeDesktopPixelSnapshotActor {
    func snapshot(
        _ request: AOSDesktopPixelSnapshotRequest
    ) async throws -> AOSDesktopPixelFrameSet {
        guard #available(macOS 14.0, *) else {
            throw AOSDesktopFrameCaptureFailure.unsupported
        }
        guard CGPreflightScreenCaptureAccess() else {
            throw AOSDesktopFrameCaptureFailure.permissionDenied
        }
        guard aosDesktopPixelRequestIsValid(request) else {
            throw AOSDesktopFrameCaptureFailure.captureFailed
        }
        try Task.checkCancellation()

        let startedAt = Date()
        let content: SCShareableContent
        do {
            content = try await SCShareableContent.excludingDesktopWindows(
                false,
                onScreenWindowsOnly: true
            )
        } catch {
            throw aosDesktopFrameCaptureFailure(for: error)
        }
        try Task.checkCancellation()

        let requested = Set(request.displayIDs)
        let displays = content.displays.filter { requested.contains($0.displayID) }
        guard displays.count == requested.count else {
            throw AOSDesktopFrameCaptureFailure.displayNotFound
        }
        let excluded = Set(request.excludingWindowIDs)
        let windows = content.windows.filter { excluded.contains(Int($0.windowID)) }

        let frames = try await withThrowingTaskGroup(
            of: AOSDesktopPixelFrame.self
        ) { group in
            for display in displays {
                group.addTask {
                    let sourceWidth = max(1, display.width)
                    let sourceHeight = max(1, display.height)
                    let multiplied = sourceWidth.multipliedReportingOverflow(
                        by: sourceHeight
                    )
                    guard !multiplied.overflow else {
                        throw AOSDesktopFrameCaptureFailure.captureFailed
                    }
                    let sourcePixels = multiplied.partialValue
                    let scale = sourcePixels > request.maximumPixelsPerDisplay
                        ? sqrt(
                            Double(request.maximumPixelsPerDisplay)
                                / Double(sourcePixels)
                        )
                        : 1
                    let width = max(
                        1,
                        Int((Double(sourceWidth) * scale).rounded(.down))
                    )
                    let height = max(
                        1,
                        Int((Double(sourceHeight) * scale).rounded(.down))
                    )
                    let configuration = SCStreamConfiguration()
                    configuration.width = width
                    configuration.height = height
                    configuration.showsCursor = false
                    configuration.captureResolution = .best
                    let filter = SCContentFilter(
                        display: display,
                        excludingWindows: windows
                    )
                    let image: CGImage
                    do {
                        try Task.checkCancellation()
                        image = try await SCScreenshotManager.captureImage(
                            contentFilter: filter,
                            configuration: configuration
                        )
                    } catch {
                        throw aosDesktopFrameCaptureFailure(for: error)
                    }
                    try Task.checkCancellation()
                    return AOSDesktopPixelFrame(
                        capturedAt: Date(),
                        displayID: display.displayID,
                        image: image
                    )
                }
            }
            var results: [AOSDesktopPixelFrame] = []
            for try await frame in group {
                results.append(frame)
            }
            return results.sorted { $0.displayID < $1.displayID }
        }

        return AOSDesktopPixelFrameSet(
            capturedAt: startedAt,
            durationMilliseconds: max(
                0,
                Int(Date().timeIntervalSince(startedAt) * 1_000)
            ),
            frames: frames
        )
    }
}

private struct AOSDesktopPixelLatestSample: @unchecked Sendable {
    let capturedAt: Date
    let sampleBuffer: CMSampleBuffer
}

func aosDesktopPixelPresentationTimeIsNumeric(_ presentationTime: CMTime) -> Bool {
    let nonNumericFlags: CMTimeFlags = [
        .positiveInfinity,
        .negativeInfinity,
        .indefinite,
    ]
    return presentationTime.flags.contains(.valid)
        && presentationTime.flags.intersection(nonNumericFlags).isEmpty
        && presentationTime.timescale > 0
}

struct AOSDesktopPixelFrameAdvancement {
    static let requiredDistinctFrames: UInt64 = 2

    private(set) var distinctFrameCount: UInt64 = 0
    private var lastPresentationTime: CMTime?

    mutating func observe(presentationTime: CMTime) -> Bool {
        guard aosDesktopPixelPresentationTimeIsNumeric(presentationTime) else {
            return false
        }
        if let lastPresentationTime,
           CMTimeCompare(presentationTime, lastPresentationTime) <= 0 {
            return false
        }
        lastPresentationTime = presentationTime
        if distinctFrameCount < Self.requiredDistinctFrames {
            distinctFrameCount += 1
        }
        return true
    }

    var isReady: Bool {
        distinctFrameCount >= Self.requiredDistinctFrames
    }
}

enum AOSDesktopPixelSampleAdmission: Equatable {
    case frame
    case heartbeat
}

func aosDesktopPixelSampleAdmission(
    statusRawValue: Int?,
    presentationTime: CMTime,
    hasImageBuffer: Bool
) -> AOSDesktopPixelSampleAdmission? {
    guard let statusRawValue,
          let status = SCFrameStatus(rawValue: statusRawValue),
          aosDesktopPixelPresentationTimeIsNumeric(presentationTime) else {
        return nil
    }

    switch status {
    case .complete, .started:
        return hasImageBuffer ? .frame : nil
    case .idle:
        return .heartbeat
    case .blank, .suspended, .stopped:
        return nil
    @unknown default:
        return nil
    }
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
    private let retirementLatch = AOSDesktopPixelRetirementLatch()
    private let slot: Int
    private let startupSignal: AOSDesktopPixelStartupSignal
    private let trace: AOSDesktopPixelNativeTrace

    init(
        displayID: UInt32,
        slot: Int,
        startupSignal: AOSDesktopPixelStartupSignal,
        trace: AOSDesktopPixelNativeTrace
    ) {
        self.displayID = displayID
        self.slot = slot
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
        startupSignal.fail(error)
        retirementLatch.observe()
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
        let startOperation: AOSDesktopPixelRetainedAsyncOperation
        let startupSignal: AOSDesktopPixelStartupSignal
        let stopOperation: AOSDesktopPixelRetainedAsyncOperation
        let stream: SCStream
    }

    private let context = CIContext(options: [.cacheIntermediates: false])
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
                onScreenWindowsOnly: true
            )
        } catch {
            throw aosDesktopFrameCaptureFailure(for: error)
        }
        let requested = Set(request.displayIDs)
        let displays = content.displays.filter { requested.contains($0.displayID) }
        guard displays.count == requested.count else {
            throw AOSDesktopFrameCaptureFailure.displayNotFound
        }
        let excluded = Set(request.excludingWindowIDs)
        let windows = content.windows.filter { excluded.contains(Int($0.windowID)) }
        guard windows.count == excluded.count else {
            throw AOSDesktopFrameCaptureFailure.captureFailed
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
                let sourceWidth = max(1, display.width)
                let sourceHeight = max(1, display.height)
                let multiplied = sourceWidth.multipliedReportingOverflow(
                    by: sourceHeight
                )
                guard !multiplied.overflow else {
                    throw AOSDesktopFrameCaptureFailure.captureFailed
                }
                guard let profile = AOSDesktopPixelWarmStreamProfile(
                    sourceWidth: sourceWidth,
                    sourceHeight: sourceHeight,
                    maximumPixels: request.maximumPixelsPerDisplay
                ) else {
                    throw AOSDesktopFrameCaptureFailure.captureFailed
                }
                let configuration = SCStreamConfiguration()
                configuration.width = profile.width
                configuration.height = profile.height
                configuration.showsCursor = false
                configuration.capturesAudio = false
                configuration.captureResolution = .best
                configuration.minimumFrameInterval = CMTime(value: 1, timescale: 30)
                // Retaining the latest IOSurface occupies one producer slot.
                // Two additional slots permit ScreenCaptureKit to advance.
                configuration.queueDepth = AOSDesktopPixelWarmStreamProfile.queueDepth
                configuration.pixelFormat = kCVPixelFormatType_32BGRA
                let filter = SCContentFilter(
                    display: display,
                    excludingWindows: windows
                )
                let startupSignal = AOSDesktopPixelStartupSignal()
                let output = AOSDesktopPixelStreamOutput(
                    displayID: display.displayID,
                    slot: slot,
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
                    startOperation: AOSDesktopPixelRetainedAsyncOperation(
                        priority: .userInitiated
                    ),
                    startupSignal: startupSignal,
                    stopOperation: AOSDesktopPixelRetainedAsyncOperation(
                        priority: .utility
                    ),
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
                let started = entry.startOperation.start(operation: {
                    trace.emit(
                        "start_invoked",
                        slot: index
                    )
                    try await entry.stream.startCapture()
                }, completion: { result in
                    entry.output.startSettled(aosDesktopPixelNativeError(result))
                    completion(result)
                })
                if !started {
                    completion(.failure(AOSDesktopFrameCaptureFailure.busy))
                }
            } stop: { index, completion in
                let entry = configuredEntries[index]
                entry.output.quiesce()
                let started = entry.stopOperation.start(operation: {
                    entry.output.stopInvoked()
                    try await entry.stream.stopCapture()
                }, completion: { result in
                    entry.output.stopSettled(aosDesktopPixelNativeError(result))
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
            try autoreleasepool {
                guard let pixelBuffer = CMSampleBufferGetImageBuffer(
                    latest.sampleBuffer
                ) else {
                    throw AOSDesktopFrameCaptureFailure.frameNotReady
                }
                let width = CVPixelBufferGetWidth(pixelBuffer)
                let height = CVPixelBufferGetHeight(pixelBuffer)
                let image = CIImage(cvPixelBuffer: pixelBuffer)
                guard let cgImage = context.createCGImage(
                    image,
                    from: CGRect(x: 0, y: 0, width: width, height: height)
                ) else {
                    throw AOSDesktopFrameCaptureFailure.captureFailed
                }
                return AOSDesktopPixelFrame(
                    capturedAt: latest.capturedAt,
                    displayID: displayID,
                    image: cgImage
                )
            }
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
    private let actor = AOSNativeDesktopPixelSnapshotActor()

    @discardableResult
    func snapshot(
        _ request: AOSDesktopPixelSnapshotRequest,
        completion: @escaping (Result<AOSDesktopPixelFrameSet, Error>) -> Void
    ) -> AOSDesktopFrameCancelling {
        let task = Task.detached(priority: .userInitiated) { [actor] in
            do {
                completion(.success(try await actor.snapshot(request)))
            } catch {
                completion(.failure(error))
            }
        }
        return AOSDesktopFrameCancellation { task.cancel() }
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
