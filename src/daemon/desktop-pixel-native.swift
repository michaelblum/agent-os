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

    init(displayID: UInt32) {
        self.displayID = displayID
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

        lock.lock()
        if acceptingSamples,
           frameAdvancement.observe(presentationTime: presentationTime) {
            if admission == .frame {
                latestSample = AOSDesktopPixelLatestSample(
                    capturedAt: Date(),
                    sampleBuffer: sampleBuffer
                )
            }
        }
        lock.unlock()
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        lock.lock()
        acceptingSamples = false
        failure = error
        frameAdvancement = AOSDesktopPixelFrameAdvancement()
        latestSample = nil
        lock.unlock()
        retirementLatch.observe()
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
private final class AOSNativeDesktopPixelWarmSource: AOSDesktopPixelWarmSource {
    private struct Entry: @unchecked Sendable {
        let output: AOSDesktopPixelStreamOutput
        let sampleQueue: DispatchQueue
        let stream: SCStream
    }

    private let context = CIContext(options: [.cacheIntermediates: false])
    private var entries: [Entry]
    private let lock = NSLock()
    private var stopFinished = false
    private var stopResult: Result<Void, Error>?
    private var stopStarted = false
    private var stopWaiters: [(Result<Void, Error>) -> Void] = []
    private var stopped = false

    private init(entries: [Entry]) {
        self.entries = entries
    }

    private static func stopEntries(_ entries: [Entry]) async -> Bool {
        await aosSettleDesktopPixelStreamRetirements(
            lifecycles: entries.map(\.output),
            timeout: aosDesktopPixelStreamRetirementTimeout
        ) { index in
            try await entries[index].stream.stopCapture()
        }
    }

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
        var entries: [Entry] = []
        var phase = "configure"
        var startupCompleted = false
        let openedAt = Date()

        do {
            for display in displays.sorted(by: { $0.displayID < $1.displayID }) {
                try Task.checkCancellation()
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
                let configuration = SCStreamConfiguration()
                configuration.width = max(
                    1,
                    Int((Double(sourceWidth) * scale).rounded(.down))
                )
                configuration.height = max(
                    1,
                    Int((Double(sourceHeight) * scale).rounded(.down))
                )
                configuration.showsCursor = false
                configuration.capturesAudio = false
                configuration.captureResolution = .best
                configuration.minimumFrameInterval = CMTime(value: 1, timescale: 30)
                // Retaining the latest IOSurface occupies one producer slot.
                // Two additional slots permit ScreenCaptureKit to advance.
                configuration.queueDepth = 3
                configuration.pixelFormat = kCVPixelFormatType_32BGRA
                let filter = SCContentFilter(
                    display: display,
                    excludingWindows: windows
                )
                let output = AOSDesktopPixelStreamOutput(displayID: display.displayID)
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
                    stream: stream
                ))
            }
            phase = "start"
            let configuredEntries = entries
            try await aosStartDesktopPixelStreams(
                lifecycles: configuredEntries.map(\.output),
                settlementTimeout: aosDesktopPixelStreamRetirementTimeout,
                cancellation: cancellation
            ) { index in
                try await configuredEntries[index].stream.startCapture()
            } stop: { index in
                let entry = configuredEntries[index]
                entry.output.quiesce()
                try await entry.stream.stopCapture()
            }
            startupCompleted = true
            let source = AOSNativeDesktopPixelWarmSource(entries: entries)
            // The browser-side request expires at 1.5 seconds. Leave the
            // remaining budget for freeze, encoding, decode, and presentation.
            phase = "sample"
            try await source.waitUntilReady(timeout: 0.75)
            return source
        } catch {
            entries.forEach { $0.output.quiesce() }
            if startupCompleted, !(await stopEntries(entries)) {
                aosLogDesktopPixelWarmOpenFailure(
                    phase: phase,
                    elapsedSince: openedAt,
                    code: AOSDesktopFrameCaptureFailure.retirementUncertain.code
                )
                throw AOSDesktopFrameCaptureFailure.retirementUncertain
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
        entries = []
        lock.unlock()
        currentEntries.forEach { $0.output.quiesce() }
        Task.detached(priority: .utility) { [self] in
            if await Self.stopEntries(currentEntries) {
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
