import CoreMedia
import CoreVideo
import Foundation
@preconcurrency import ScreenCaptureKit

struct AOSDesktopPixelNativeBaselineFrame {
    let displayID: CGDirectDisplayID
    let frameCount: UInt64
    let pixelBuffer: CVPixelBuffer
    let receivedAtNanoseconds: UInt64
}

final class AOSDesktopPixelNativeBaselineStreamOutput: NSObject, SCStreamOutput, SCStreamDelegate {
    let displayID: CGDirectDisplayID

    private let lock = NSLock()
    private var frameCount: UInt64 = 0
    private var acceptingFrames = true
    private var latestBuffer: CVPixelBuffer?
    private var latestAtNanoseconds: UInt64 = 0
    private var terminalNativeCode: Int?

    init(displayID: CGDirectDisplayID) {
        self.displayID = displayID
    }

    func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of outputType: SCStreamOutputType
    ) {
        guard outputType == .screen,
              sampleBuffer.isValid,
              let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
            return
        }
        lock.lock()
        guard acceptingFrames else {
            lock.unlock()
            return
        }
        frameCount &+= 1
        latestBuffer = buffer
        latestAtNanoseconds = DispatchTime.now().uptimeNanoseconds
        lock.unlock()
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        lock.lock()
        terminalNativeCode = (error as NSError).code
        lock.unlock()
    }

    func snapshot() -> AOSDesktopPixelNativeBaselineFrame? {
        lock.lock()
        defer { lock.unlock() }
        guard terminalNativeCode == nil, let latestBuffer else { return nil }
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
        return terminalNativeCode
    }

    func clear() {
        lock.lock()
        latestBuffer = nil
        lock.unlock()
    }

    func quiesce() {
        lock.lock()
        acceptingFrames = false
        lock.unlock()
    }

    var retainedFrameCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return latestBuffer == nil ? 0 : 1
    }
}

enum AOSDesktopPixelNativeBaselineStopOutcome: Sendable {
    case stopped
    case failed(Int)
    case timedOut
}

final class AOSDesktopPixelNativeBaselineStopSettlement: @unchecked Sendable {
    typealias Completion = @Sendable (Error?) -> Void
    typealias Operation = @Sendable (@escaping Completion) -> Void

    private let lock = NSLock()
    private var continuations: [CheckedContinuation<AOSDesktopPixelNativeBaselineStopOutcome, Never>] = []
    private var operationStarted = false
    private var outcome: AOSDesktopPixelNativeBaselineStopOutcome?

    func wait(
        timeoutMilliseconds: Int,
        operation: @escaping Operation
    ) async -> AOSDesktopPixelNativeBaselineStopOutcome {
        await withCheckedContinuation { continuation in
            lock.lock()
            if let outcome {
                lock.unlock()
                continuation.resume(returning: outcome)
                return
            }
            continuations.append(continuation)
            guard !operationStarted else {
                lock.unlock()
                return
            }
            operationStarted = true
            lock.unlock()

            let settlement = self
            DispatchQueue.global(qos: .utility).async {
                operation { error in
                    if let error {
                        settlement.settle(.failed((error as NSError).code))
                    } else {
                        settlement.settle(.stopped)
                    }
                }
            }
            DispatchQueue.global(qos: .utility).asyncAfter(
                deadline: .now() + .milliseconds(timeoutMilliseconds)
            ) {
                settlement.settle(.timedOut)
            }
        }
    }

    private func settle(_ outcome: AOSDesktopPixelNativeBaselineStopOutcome) {
        lock.lock()
        guard self.outcome == nil else {
            lock.unlock()
            return
        }
        self.outcome = outcome
        let waiting = continuations
        continuations = []
        lock.unlock()
        waiting.forEach { $0.resume(returning: outcome) }
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
        let stopSettlement: AOSDesktopPixelNativeBaselineStopSettlement
        let stream: SCStream
    }

    private var entries: [Entry] = []
    private var retainedFramesAfterStop = 0

    func start(displayIDs: [CGDirectDisplayID]) async throws {
        retainedFramesAfterStop = 0
        guard !displayIDs.isEmpty, displayIDs.count <= Self.maximumDisplays else {
            throw AOSDesktopPixelNativeBaselineFailure(code: "DESKTOP_PIXEL_BASELINE_DISPLAY_LIMIT")
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

        let ownPID = pid_t(ProcessInfo.processInfo.processIdentifier)
        let ownApplication = content.applications.first { $0.processID == ownPID }
        var configured: [Entry] = []
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

                let filter: SCContentFilter
                if let ownApplication {
                    filter = SCContentFilter(
                        display: display,
                        excludingApplications: [ownApplication],
                        exceptingWindows: []
                    )
                } else {
                    filter = SCContentFilter(display: display, excludingWindows: [])
                }

                let output = AOSDesktopPixelNativeBaselineStreamOutput(displayID: display.displayID)
                let stream = SCStream(filter: filter, configuration: configuration, delegate: output)
                let queue = DispatchQueue(
                    label: "io.agent-os.desktop-pixel-native-baseline.\(display.displayID)",
                    qos: .userInteractive
                )
                try stream.addStreamOutput(output, type: .screen, sampleHandlerQueue: queue)
                configured.append(Entry(
                    output: output,
                    sampleQueue: queue,
                    stopSettlement: AOSDesktopPixelNativeBaselineStopSettlement(),
                    stream: stream
                ))
            }
            entries = configured
            try await withThrowingTaskGroup(of: Void.self) { group in
                for entry in configured {
                    group.addTask {
                        try Task.checkCancellation()
                        try await entry.stream.startCapture()
                    }
                }
                try await group.waitForAll()
            }
        } catch {
            entries = configured
            let cleanup = await stop()
            guard cleanup.complete else {
                throw AOSDesktopPixelNativeBaselineFailure(
                    code: "DESKTOP_PIXEL_BASELINE_CAPTURE_START_CLEANUP_FAILED",
                    nativeCode: cleanup.nativeCode
                )
            }
            throw nativeFailure(error, fallback: "DESKTOP_PIXEL_BASELINE_CAPTURE_START_FAILED")
        }

        let deadline = DispatchTime.now().uptimeNanoseconds + 5_000_000_000
        while DispatchTime.now().uptimeNanoseconds < deadline {
            if let nativeCode = entries.compactMap({ $0.output.failureCode() }).first {
                let cleanup = await stop()
                guard cleanup.complete else {
                    throw AOSDesktopPixelNativeBaselineFailure(
                        code: "DESKTOP_PIXEL_BASELINE_CAPTURE_CLEANUP_FAILED",
                        nativeCode: cleanup.nativeCode
                    )
                }
                throw AOSDesktopPixelNativeBaselineFailure(
                    code: "DESKTOP_PIXEL_BASELINE_STREAM_STOPPED",
                    nativeCode: nativeCode
                )
            }
            if snapshots().count == entries.count { return }
            try Task.checkCancellation()
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        let cleanup = await stop()
        guard cleanup.complete else {
            throw AOSDesktopPixelNativeBaselineFailure(
                code: "DESKTOP_PIXEL_BASELINE_CAPTURE_CLEANUP_FAILED",
                nativeCode: cleanup.nativeCode
            )
        }
        throw AOSDesktopPixelNativeBaselineFailure(code: "DESKTOP_PIXEL_BASELINE_FRAME_TIMEOUT")
    }

    func snapshots() -> [AOSDesktopPixelNativeBaselineFrame] {
        entries.compactMap { $0.output.snapshot() }.sorted { $0.displayID < $1.displayID }
    }

    func stop() async -> AOSDesktopPixelNativeBaselineCaptureCleanup {
        let stopping = entries
        stopping.forEach { $0.output.quiesce() }
        let outcomes = await withTaskGroup(
            of: (Int, AOSDesktopPixelNativeBaselineStopOutcome).self,
            returning: [(Int, AOSDesktopPixelNativeBaselineStopOutcome)].self
        ) { group in
            for (index, entry) in stopping.enumerated() {
                group.addTask {
                    let outcome = await entry.stopSettlement.wait(
                        timeoutMilliseconds: Self.stopTimeoutMilliseconds,
                        operation: { completion in
                            entry.stream.stopCapture(completionHandler: completion)
                        }
                    )
                    return (index, outcome)
                }
            }
            var collected: [(Int, AOSDesktopPixelNativeBaselineStopOutcome)] = []
            for await outcome in group { collected.append(outcome) }
            return collected
        }

        let byIndex = Dictionary(uniqueKeysWithValues: outcomes)
        var unsettled: [Entry] = []
        var nativeCode: Int?
        for (index, entry) in stopping.enumerated() {
            switch byIndex[index] ?? .timedOut {
            case .stopped:
                do {
                    try entry.stream.removeStreamOutput(entry.output, type: .screen)
                    entry.sampleQueue.sync {}
                    entry.output.clear()
                } catch {
                    nativeCode = nativeCode ?? (error as NSError).code
                    unsettled.append(entry)
                }
            case .failed(let code):
                nativeCode = nativeCode ?? code
                unsettled.append(entry)
            case .timedOut:
                unsettled.append(entry)
            }
        }
        entries = unsettled
        retainedFramesAfterStop = unsettled.reduce(0) { $0 + $1.output.retainedFrameCount }
        return AOSDesktopPixelNativeBaselineCaptureCleanup(
            nativeCode: nativeCode,
            retainedFrames: retainedFramesAfterStop,
            unsettledStreams: unsettled.count
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
