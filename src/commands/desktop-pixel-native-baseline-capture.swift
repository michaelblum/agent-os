import CoreMedia
import CoreVideo
import Foundation
import ScreenCaptureKit

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
}

final class AOSDesktopPixelNativeBaselineCapture {
    static let maximumDisplays = 8
    static let maximumPixelsPerDisplay = 33_554_432
    static let maximumAggregatePixels = 67_108_864
    static let queueDepth = 3

    private struct Entry {
        let output: AOSDesktopPixelNativeBaselineStreamOutput
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
                configured.append(Entry(output: output, stream: stream))
            }
            entries = configured
            try await withThrowingTaskGroup(of: Void.self) { group in
                for entry in configured {
                    group.addTask { try await entry.stream.startCapture() }
                }
                try await group.waitForAll()
            }
        } catch {
            entries = configured
            await stop()
            throw nativeFailure(error, fallback: "DESKTOP_PIXEL_BASELINE_CAPTURE_START_FAILED")
        }

        let deadline = DispatchTime.now().uptimeNanoseconds + 5_000_000_000
        while DispatchTime.now().uptimeNanoseconds < deadline {
            if let nativeCode = entries.compactMap({ $0.output.failureCode() }).first {
                await stop()
                throw AOSDesktopPixelNativeBaselineFailure(
                    code: "DESKTOP_PIXEL_BASELINE_STREAM_STOPPED",
                    nativeCode: nativeCode
                )
            }
            if snapshots().count == entries.count { return }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        await stop()
        throw AOSDesktopPixelNativeBaselineFailure(code: "DESKTOP_PIXEL_BASELINE_FRAME_TIMEOUT")
    }

    func snapshots() -> [AOSDesktopPixelNativeBaselineFrame] {
        entries.compactMap { $0.output.snapshot() }.sorted { $0.displayID < $1.displayID }
    }

    func retainedFrameCount() -> Int {
        entries.isEmpty ? retainedFramesAfterStop : snapshots().count
    }

    func stop() async {
        let stopping = entries
        entries = []
        await withTaskGroup(of: Void.self) { group in
            for entry in stopping {
                group.addTask { try? await entry.stream.stopCapture() }
            }
        }
        stopping.forEach { $0.output.clear() }
        retainedFramesAfterStop = stopping.compactMap { $0.output.snapshot() }.count
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
