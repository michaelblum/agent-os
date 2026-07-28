import CoreMedia
import CoreVideo
import Foundation
@preconcurrency import ScreenCaptureKit

final class AOSDesktopPixelNativeBaselineFailureState: @unchecked Sendable {
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

func aosDesktopPixelNativeBaselineExclusionsAreComplete(
    endpointCount: Int,
    windowIDs: [Int]
) -> Bool {
    guard endpointCount > 0,
          windowIDs.count == endpointCount,
          windowIDs.allSatisfy({ $0 > 0 }) else {
        return false
    }
    return Set(windowIDs).count == endpointCount
}

func aosRecordDesktopPixelNativeBaselineStartSettlement(
    _ result: Result<Void, Error>,
    failureState: AOSDesktopPixelNativeBaselineFailureState
) {
    guard case .failure(let error) = result else { return }
    failureState.record(error)
}

struct AOSDesktopPixelNativeBaselineFrame {
    let displayID: CGDirectDisplayID
    let frameCount: UInt64
    let pixelBuffer: CVPixelBuffer
    let receivedAtNanoseconds: UInt64
}

final class AOSDesktopPixelNativeBaselineStreamOutput: NSObject,
    AOSDesktopPixelStreamLifecycle,
    SCStreamOutput,
    SCStreamDelegate
{
    let displayID: CGDirectDisplayID

    private var acceptingFrames = true
    private var frameAdvancement = AOSDesktopPixelFrameAdvancement()
    private var frameCount: UInt64 = 0
    private var latestAtNanoseconds: UInt64 = 0
    private var latestBuffer: CVPixelBuffer?
    private let lock = NSLock()
    private let nativeStopped: @Sendable (Error) -> Void
    private let retirementLatch = AOSDesktopPixelRetirementLatch()
    private let startupSignal: AOSDesktopPixelStartupSignal
    private var terminalError: Error?

    init(
        displayID: CGDirectDisplayID,
        nativeStopped: @escaping @Sendable (Error) -> Void,
        startupSignal: AOSDesktopPixelStartupSignal
    ) {
        self.displayID = displayID
        self.nativeStopped = nativeStopped
        self.startupSignal = startupSignal
    }

    func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of outputType: SCStreamOutputType
    ) {
        guard outputType == .screen,
              sampleBuffer.isValid,
              let attachments = CMSampleBufferGetSampleAttachmentsArray(
                  sampleBuffer,
                  createIfNecessary: false
              ) as? [[SCStreamFrameInfo: Any]],
              let statusValue = attachments.first?[.status] as? NSNumber else {
            return
        }
        let presentationTime = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        let imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer)
        guard let admission = aosDesktopPixelSampleAdmission(
            statusRawValue: statusValue.intValue,
            presentationTime: presentationTime,
            hasImageBuffer: imageBuffer != nil
        ) else { return }

        var firstFrame = false
        lock.lock()
        if acceptingFrames,
           frameAdvancement.observe(presentationTime: presentationTime),
           admission == .frame,
           let imageBuffer {
            firstFrame = latestBuffer == nil
            frameCount &+= 1
            latestBuffer = imageBuffer
            latestAtNanoseconds = DispatchTime.now().uptimeNanoseconds
        }
        lock.unlock()
        if firstFrame { startupSignal.succeed() }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        lock.lock()
        acceptingFrames = false
        frameAdvancement = AOSDesktopPixelFrameAdvancement()
        latestBuffer = nil
        terminalError = error
        lock.unlock()
        retirementLatch.observe()
        nativeStopped(error)
        startupSignal.fail(error)
    }

    func startSettled(_ result: Result<Void, Error>) {
        guard case .failure(let error) = result else { return }
        lock.lock()
        acceptingFrames = false
        terminalError = error
        lock.unlock()
    }

    func snapshot() -> AOSDesktopPixelNativeBaselineFrame? {
        lock.lock()
        defer { lock.unlock() }
        guard terminalError == nil,
              frameAdvancement.isReady,
              let latestBuffer else { return nil }
        return AOSDesktopPixelNativeBaselineFrame(
            displayID: displayID,
            frameCount: frameCount,
            pixelBuffer: latestBuffer,
            receivedAtNanoseconds: latestAtNanoseconds
        )
    }

    func failureCode() -> Int? {
        lock.lock()
        defer { lock.unlock() }
        return terminalError.map { ($0 as NSError).code }
    }

    func clear() {
        lock.lock()
        frameAdvancement = AOSDesktopPixelFrameAdvancement()
        latestBuffer = nil
        lock.unlock()
    }

    func quiesce() {
        lock.lock()
        acceptingFrames = false
        frameAdvancement = AOSDesktopPixelFrameAdvancement()
        latestBuffer = nil
        lock.unlock()
    }

    func admitExplicitStop() -> AOSDesktopPixelStopAdmission {
        retirementLatch.admitExplicitStop()
    }

    func confirmRetirement() {
        retirementLatch.observe()
    }

    func retirementWasObserved() -> Bool {
        retirementLatch.snapshot()
    }

    func waitForRetirement(timeout: TimeInterval) async -> Bool {
        await retirementLatch.wait(timeout: timeout)
    }

    func sampleIsReady() throws -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if let terminalError { throw terminalError }
        return latestBuffer != nil && frameAdvancement.isReady
    }

    var retainedFrameCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return latestBuffer == nil ? 0 : 1
    }
}

struct AOSDesktopPixelNativeBaselineCaptureCleanup {
    let nativeCode: Int?
    let retainedFrames: Int
    let unsettledStreams: Int

    var complete: Bool {
        nativeCode == nil && retainedFrames == 0 && unsettledStreams == 0
    }
}

@MainActor
final class AOSDesktopPixelNativeBaselineCapture {
    nonisolated static let maximumDisplays = 8
    nonisolated static let maximumPixelsPerDisplay = 33_554_432
    nonisolated static let maximumAggregatePixels = 67_108_864
    nonisolated static let queueDepth = 3
    nonisolated static let stopTimeoutMilliseconds = 2_000

    private struct Entry {
        let output: AOSDesktopPixelNativeBaselineStreamOutput
        let sampleQueue: DispatchQueue
        let startOperation: AOSDesktopPixelRetainedNativeOperation
        let startupSignal: AOSDesktopPixelStartupSignal
        let stopOperation: AOSDesktopPixelRetainedNativeOperation
        let stream: SCStream
    }

    private var entries: [Entry] = []
    private var failureState: AOSDesktopPixelNativeBaselineFailureState?
    private var startupOwner: AOSDesktopPixelStartupOwner?

    func start(
        displayIDs: [CGDirectDisplayID],
        excludingWindowIDs: [Int]
    ) async throws {
        guard entries.isEmpty, startupOwner == nil else {
            throw AOSDesktopPixelNativeBaselineFailure(
                code: "DESKTOP_PIXEL_BASELINE_CAPTURE_BUSY"
            )
        }
        guard !displayIDs.isEmpty, displayIDs.count <= Self.maximumDisplays else {
            throw AOSDesktopPixelNativeBaselineFailure(code: "DESKTOP_PIXEL_BASELINE_DISPLAY_LIMIT")
        }
        guard aosDesktopPixelNativeBaselineExclusionsAreComplete(
            endpointCount: displayIDs.count,
            windowIDs: excludingWindowIDs
        ) else {
            throw AOSDesktopPixelNativeBaselineFailure(
                code: "DESKTOP_PIXEL_BASELINE_EXCLUSION_UNAVAILABLE"
            )
        }

        let content = try await SCShareableContent.excludingDesktopWindows(
            false,
            onScreenWindowsOnly: false
        )
        try Task.checkCancellation()
        let requested = Set(displayIDs)
        let displays = content.displays
            .filter { requested.contains($0.displayID) }
            .sorted { $0.displayID < $1.displayID }
        guard displays.count == requested.count else {
            throw AOSDesktopPixelNativeBaselineFailure(code: "DESKTOP_PIXEL_BASELINE_TOPOLOGY_MISMATCH")
        }

        var aggregatePixels = 0
        for display in displays {
            let pixels = try checkedPixels(width: display.width, height: display.height)
            guard pixels <= Self.maximumPixelsPerDisplay,
                  aggregatePixels <= Self.maximumAggregatePixels - pixels else {
                throw AOSDesktopPixelNativeBaselineFailure(code: "DESKTOP_PIXEL_BASELINE_PIXEL_BUDGET_EXCEEDED")
            }
            aggregatePixels += pixels
        }

        var configured: [Entry] = []
        var startupAttempted = false
        let failureState = AOSDesktopPixelNativeBaselineFailureState()
        self.failureState = failureState
        do {
            for display in displays {
                try Task.checkCancellation()
                let configuration = SCStreamConfiguration()
                configuration.width = display.width
                configuration.height = display.height
                configuration.showsCursor = false
                configuration.capturesAudio = false
                configuration.minimumFrameInterval = CMTime(value: 1, timescale: 30)
                configuration.queueDepth = Self.queueDepth
                configuration.pixelFormat = kCVPixelFormatType_32BGRA
                let filter = try aosDesktopPixelCaptureFilter(
                    content: content,
                    display: display,
                    excludingWindowIDs: excludingWindowIDs
                )
                let startupSignal = AOSDesktopPixelStartupSignal()
                let startOperation = AOSDesktopPixelRetainedNativeOperation(
                    executionQueue: DispatchQueue.global(qos: .userInitiated)
                )
                let stopOperation = AOSDesktopPixelRetainedNativeOperation(
                    executionQueue: DispatchQueue.global(qos: .utility)
                )
                let output = AOSDesktopPixelNativeBaselineStreamOutput(
                    displayID: display.displayID,
                    nativeStopped: { [weak startOperation, weak stopOperation] error in
                        startOperation?.settle(.failure(error))
                        stopOperation?.settle(.failure(error))
                    },
                    startupSignal: startupSignal
                )
                let stream = SCStream(
                    filter: filter,
                    configuration: configuration,
                    delegate: output
                )
                let queue = DispatchQueue(
                    label: "io.agent-os.desktop-pixel-native-baseline.\(display.displayID)",
                    qos: .userInteractive
                )
                try stream.addStreamOutput(output, type: .screen, sampleHandlerQueue: queue)
                configured.append(Entry(
                    output: output,
                    sampleQueue: queue,
                    startOperation: startOperation,
                    startupSignal: startupSignal,
                    stopOperation: stopOperation,
                    stream: stream
                ))
            }
            entries = configured
            startupAttempted = true
            let configuredEntries = configured
            let owner = try await aosStartDesktopPixelStreams(
                signals: configuredEntries.map(\.startupSignal),
                lifecycles: configuredEntries.map(\.output),
                settlementTimeout: Self.stopTimeoutSeconds,
                lateFailure: { error in failureState.record(error) },
                start: { index, completion in
                    let entry = configuredEntries[index]
                    let started = entry.startOperation.start(operation: {
                        entry.stream.startCapture(completionHandler: $0)
                    }, completion: { result in
                        aosRecordDesktopPixelNativeBaselineStartSettlement(
                            result,
                            failureState: failureState
                        )
                        entry.output.startSettled(result)
                        completion(result)
                    })
                    if !started {
                        completion(.failure(AOSDesktopPixelNativeBaselineFailure(
                            code: "DESKTOP_PIXEL_BASELINE_NATIVE_START_BUSY"
                        )))
                    }
                },
                stop: { index, completion in
                    let entry = configuredEntries[index]
                    entry.output.quiesce()
                    let started = entry.stopOperation.start(operation: {
                        entry.stream.stopCapture(completionHandler: $0)
                    }, completion: completion)
                    if !started {
                        completion(.failure(AOSDesktopPixelNativeBaselineFailure(
                            code: "DESKTOP_PIXEL_BASELINE_NATIVE_STOP_BUSY"
                        )))
                    }
                }
            )
            startupOwner = owner
            try await waitUntilReady()
        } catch {
            let cleanup = startupAttempted
                ? await stop()
                : discardConfiguredEntries(configured)
            guard cleanup.complete else {
                throw AOSDesktopPixelNativeBaselineFailure(
                    code: "DESKTOP_PIXEL_BASELINE_CAPTURE_START_CLEANUP_FAILED",
                    nativeCode: cleanup.nativeCode
                )
            }
            throw nativeFailure(error, fallback: "DESKTOP_PIXEL_BASELINE_CAPTURE_START_FAILED")
        }
    }

    func snapshots() -> [AOSDesktopPixelNativeBaselineFrame] {
        entries.compactMap { $0.output.snapshot() }.sorted { $0.displayID < $1.displayID }
    }

    func runtimeFailure() -> AOSDesktopPixelNativeBaselineFailure? {
        guard let error = failureState?.current() else { return nil }
        return nativeFailure(
            error,
            fallback: "DESKTOP_PIXEL_BASELINE_CAPTURE_STREAM_FAILED"
        )
    }

    func stop() async -> AOSDesktopPixelNativeBaselineCaptureCleanup {
        let stopping = entries
        stopping.forEach { $0.output.quiesce() }
        let retired: Bool
        if let startupOwner {
            retired = await startupOwner.retire(timeout: Self.stopTimeoutSeconds)
            if retired { self.startupOwner = nil }
        } else {
            retired = stopping.allSatisfy { $0.output.retirementWasObserved() }
        }
        guard retired else { return cleanupSnapshot() }

        var retained: [Entry] = []
        var nativeCode: Int?
        for entry in stopping {
            do {
                try entry.stream.removeStreamOutput(entry.output, type: .screen)
                entry.sampleQueue.sync {}
                entry.output.clear()
            } catch {
                nativeCode = nativeCode ?? (error as NSError).code
                retained.append(entry)
            }
        }
        entries = retained
        if !retained.isEmpty {
            return AOSDesktopPixelNativeBaselineCaptureCleanup(
                nativeCode: nativeCode,
                retainedFrames: retained.reduce(0) { $0 + $1.output.retainedFrameCount },
                unsettledStreams: retained.count
            )
        }
        return AOSDesktopPixelNativeBaselineCaptureCleanup(
            nativeCode: nil,
            retainedFrames: 0,
            unsettledStreams: 0
        )
    }

    private static var stopTimeoutSeconds: TimeInterval {
        TimeInterval(stopTimeoutMilliseconds) / 1_000
    }

    private func waitUntilReady() async throws {
        let deadline = DispatchTime.now().uptimeNanoseconds + 5_000_000_000
        while DispatchTime.now().uptimeNanoseconds < deadline {
            try Task.checkCancellation()
            if try aosDesktopPixelStreamsAreReady(entries.map(\.output)) { return }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        throw AOSDesktopPixelNativeBaselineFailure(code: "DESKTOP_PIXEL_BASELINE_FRAME_TIMEOUT")
    }

    private func cleanupSnapshot() -> AOSDesktopPixelNativeBaselineCaptureCleanup {
        AOSDesktopPixelNativeBaselineCaptureCleanup(
            nativeCode: entries.compactMap { $0.output.failureCode() }.first,
            retainedFrames: entries.reduce(0) { $0 + $1.output.retainedFrameCount },
            unsettledStreams: entries.count
        )
    }

    private func discardConfiguredEntries(
        _ configured: [Entry]
    ) -> AOSDesktopPixelNativeBaselineCaptureCleanup {
        var retained: [Entry] = []
        var nativeCode: Int?
        for entry in configured {
            do {
                try entry.stream.removeStreamOutput(entry.output, type: .screen)
                entry.sampleQueue.sync {}
                entry.output.clear()
            } catch {
                nativeCode = nativeCode ?? (error as NSError).code
                retained.append(entry)
            }
        }
        entries = retained
        return AOSDesktopPixelNativeBaselineCaptureCleanup(
            nativeCode: nativeCode,
            retainedFrames: retained.reduce(0) { $0 + $1.output.retainedFrameCount },
            unsettledStreams: retained.count
        )
    }

    private func checkedPixels(width: Int, height: Int) throws -> Int {
        guard width > 0, height > 0, width <= Int.max / height else {
            throw AOSDesktopPixelNativeBaselineFailure(code: "DESKTOP_PIXEL_BASELINE_INVALID_DIMENSIONS")
        }
        return width * height
    }

    private func nativeFailure(_ error: Error, fallback: String) -> AOSDesktopPixelNativeBaselineFailure {
        if let failure = error as? AOSDesktopPixelNativeBaselineFailure { return failure }
        return AOSDesktopPixelNativeBaselineFailure(
            code: fallback,
            nativeCode: (error as NSError).code
        )
    }
}
