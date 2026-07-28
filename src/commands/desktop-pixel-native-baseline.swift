import AppKit
import Darwin
import Foundation
import Metal

struct AOSDesktopPixelNativeBaselineFailure: Error {
    let code: String
    let nativeCode: Int?

    init(code: String, nativeCode: Int? = nil) {
        self.code = code
        self.nativeCode = nativeCode
    }
}

private struct AOSDesktopPixelNativeBaselineOptions {
    let holdMilliseconds: UInt64
    let presentation: AOSDesktopPixelNativeBaselinePresentation

    static func parse(_ args: [String]) throws -> Self {
        var holdMilliseconds: UInt64 = 750
        var presentation: AOSDesktopPixelNativeBaselinePresentation = .identity
        var sawJSON = false
        var index = 0
        while index < args.count {
            switch args[index] {
            case "--hold-ms":
                index += 1
                guard args.indices.contains(index),
                      let value = UInt64(args[index]),
                      (50...5_000).contains(value) else {
                    throw AOSDesktopPixelNativeBaselineFailure(code: "DESKTOP_PIXEL_BASELINE_INVALID_HOLD")
                }
                holdMilliseconds = value
            case "--presentation":
                index += 1
                guard args.indices.contains(index),
                      let value = AOSDesktopPixelNativeBaselinePresentation(rawValue: args[index]) else {
                    throw AOSDesktopPixelNativeBaselineFailure(code: "DESKTOP_PIXEL_BASELINE_INVALID_PRESENTATION")
                }
                presentation = value
            case "--json":
                sawJSON = true
            default:
                throw AOSDesktopPixelNativeBaselineFailure(code: "DESKTOP_PIXEL_BASELINE_UNKNOWN_ARGUMENT")
            }
            index += 1
        }
        guard sawJSON else {
            throw AOSDesktopPixelNativeBaselineFailure(code: "DESKTOP_PIXEL_BASELINE_JSON_REQUIRED")
        }
        return Self(holdMilliseconds: holdMilliseconds, presentation: presentation)
    }
}

private struct AOSDesktopPixelNativeBaselineSummary: Encodable {
    let schemaVersion = "aos.desktop-pixel-native-baseline.v1"
    let status: String
    let errorCode: String?
    let nativeCode: Int?
    let displayCount: Int
    let queueDepth = AOSDesktopPixelNativeBaselineCapture.queueDepth
    let presentation: AOSDesktopPixelNativeBaselinePresentation
    let warmupMilliseconds: Double?
    let triggerToVisibleMilliseconds: Double?
    let presentationSkewMilliseconds: Double?
    let oldestFrameAgeMilliseconds: Double?
    let capturedPixelsPersisted = false
    let publicPixelsExposed = false
    let daemonUsed = false
    let brokerUsed = false
    let sceneProtocolUsed = false
    var retainedFramesAfterCleanup: Int
    var retainedTexturesAfterCleanup: Int
    var windowsAfterCleanup: Int

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case status
        case errorCode = "error_code"
        case nativeCode = "native_code"
        case displayCount = "display_count"
        case queueDepth = "queue_depth"
        case presentation
        case warmupMilliseconds = "warmup_ms"
        case triggerToVisibleMilliseconds = "trigger_to_visible_ms"
        case presentationSkewMilliseconds = "presentation_skew_ms"
        case oldestFrameAgeMilliseconds = "oldest_frame_age_ms"
        case capturedPixelsPersisted = "captured_pixels_persisted"
        case publicPixelsExposed = "public_pixels_exposed"
        case daemonUsed = "daemon_used"
        case brokerUsed = "broker_used"
        case sceneProtocolUsed = "scene_protocol_used"
        case retainedFramesAfterCleanup = "retained_frames_after_cleanup"
        case retainedTexturesAfterCleanup = "retained_textures_after_cleanup"
        case windowsAfterCleanup = "windows_after_cleanup"
    }
}

private final class AOSDesktopPixelNativeBaselinePresentationBarrier: @unchecked Sendable {
    private let expected: Int
    private let lock = NSLock()
    private var continuation: CheckedContinuation<[UInt64]?, Never>?
    private var completed: [UInt64] = []
    private var terminal = false

    init(expected: Int) {
        self.expected = expected
    }

    func markPresented() {
        lock.lock()
        guard !terminal else {
            lock.unlock()
            return
        }
        completed.append(DispatchTime.now().uptimeNanoseconds)
        guard completed.count == expected else {
            lock.unlock()
            return
        }
        terminal = true
        let result = completed
        let waiting = continuation
        continuation = nil
        lock.unlock()
        waiting?.resume(returning: result)
    }

    func wait(timeoutMilliseconds: UInt64) async -> [UInt64]? {
        await withCheckedContinuation { continuation in
            lock.lock()
            if terminal {
                let result = completed.count == expected ? completed : nil
                lock.unlock()
                continuation.resume(returning: result)
                return
            }
            self.continuation = continuation
            lock.unlock()
            DispatchQueue.global(qos: .userInitiated).asyncAfter(
                deadline: .now() + .milliseconds(Int(timeoutMilliseconds))
            ) { [weak self] in
                self?.timeout()
            }
        }
    }

    private func timeout() {
        lock.lock()
        guard !terminal else {
            lock.unlock()
            return
        }
        terminal = true
        let waiting = continuation
        continuation = nil
        lock.unlock()
        waiting?.resume(returning: nil)
    }
}

@MainActor
private final class AOSDesktopPixelNativeBaselineController: NSObject, NSApplicationDelegate {
    private let capture = AOSDesktopPixelNativeBaselineCapture()
    private let options: AOSDesktopPixelNativeBaselineOptions
    private var finishing = false
    private var signalSources: [DispatchSourceSignal] = []
    private var surfaces: [AOSDesktopPixelNativeBaselineSurface] = []
    private(set) var exitCode: Int32 = 1

    init(options: AOSDesktopPixelNativeBaselineOptions) {
        self.options = options
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        installSignalHandlers()
        Task { @MainActor in
            await runProof()
        }
    }

    private func runProof() async {
        guard CGPreflightScreenCaptureAccess() else {
            await finish(failure: AOSDesktopPixelNativeBaselineFailure(
                code: "SCREEN_CAPTURE_PERMISSION_REQUIRED"
            ))
            return
        }
        guard let device = MTLCreateSystemDefaultDevice() else {
            await finish(failure: AOSDesktopPixelNativeBaselineFailure(
                code: "DESKTOP_PIXEL_BASELINE_METAL_UNAVAILABLE"
            ))
            return
        }

        do {
            let screens = NSScreen.screens
            guard !screens.isEmpty,
                  screens.count <= AOSDesktopPixelNativeBaselineCapture.maximumDisplays else {
                throw AOSDesktopPixelNativeBaselineFailure(code: "DESKTOP_PIXEL_BASELINE_DISPLAY_LIMIT")
            }
            for screen in screens {
                guard let displayID = aosDesktopPixelNativeBaselineDisplayID(screen) else {
                    throw AOSDesktopPixelNativeBaselineFailure(
                        code: "DESKTOP_PIXEL_BASELINE_DISPLAY_ID_UNAVAILABLE"
                    )
                }
                surfaces.append(try AOSDesktopPixelNativeBaselineSurface(
                    screen: screen,
                    displayID: displayID,
                    device: device
                ))
            }

            let warmupStarted = DispatchTime.now().uptimeNanoseconds
            try await capture.start(displayIDs: surfaces.map(\.displayID))
            let warmupFinished = DispatchTime.now().uptimeNanoseconds
            let frames = capture.snapshots()
            guard frames.count == surfaces.count else {
                throw AOSDesktopPixelNativeBaselineFailure(code: "DESKTOP_PIXEL_BASELINE_FRAME_SET_INCOMPLETE")
            }
            let byDisplay = Dictionary(uniqueKeysWithValues: frames.map { ($0.displayID, $0) })
            let barrier = AOSDesktopPixelNativeBaselinePresentationBarrier(expected: surfaces.count)
            for surface in surfaces {
                guard let frame = byDisplay[surface.displayID] else {
                    throw AOSDesktopPixelNativeBaselineFailure(code: "DESKTOP_PIXEL_BASELINE_FRAME_SET_INCOMPLETE")
                }
                try surface.renderer.setFrame(frame, presentation: options.presentation)
                surface.renderer.onPresented = { barrier.markPresented() }
            }

            let triggered = DispatchTime.now().uptimeNanoseconds
            surfaces.forEach { $0.show() }
            guard let presented = await barrier.wait(timeoutMilliseconds: 2_000),
                  let firstPresented = presented.min(),
                  let lastPresented = presented.max() else {
                throw AOSDesktopPixelNativeBaselineFailure(code: "DESKTOP_PIXEL_BASELINE_PRESENTATION_TIMEOUT")
            }
            try await Task.sleep(nanoseconds: options.holdMilliseconds * 1_000_000)
            let oldestFrame = frames.map(\.receivedAtNanoseconds).min() ?? triggered
            let success = AOSDesktopPixelNativeBaselineSummary(
                status: "passed",
                errorCode: nil,
                nativeCode: nil,
                displayCount: surfaces.count,
                presentation: options.presentation,
                warmupMilliseconds: milliseconds(warmupFinished - warmupStarted),
                triggerToVisibleMilliseconds: milliseconds(lastPresented - triggered),
                presentationSkewMilliseconds: milliseconds(lastPresented - firstPresented),
                oldestFrameAgeMilliseconds: milliseconds(lastPresented - oldestFrame),
                retainedFramesAfterCleanup: 0,
                retainedTexturesAfterCleanup: 0,
                windowsAfterCleanup: 0
            )
            await finish(success: success)
        } catch {
            let failure = error as? AOSDesktopPixelNativeBaselineFailure
                ?? AOSDesktopPixelNativeBaselineFailure(
                    code: "DESKTOP_PIXEL_BASELINE_FAILED",
                    nativeCode: (error as NSError).code
                )
            await finish(failure: failure)
        }
    }

    private func finish(
        success: AOSDesktopPixelNativeBaselineSummary? = nil,
        failure: AOSDesktopPixelNativeBaselineFailure? = nil
    ) async {
        guard !finishing else { return }
        finishing = true
        let displayCount = surfaces.count
        surfaces.forEach { $0.dispose() }
        let retainedTexturesAfterCleanup = surfaces.reduce(0) {
            $0 + $1.retainedTextureCount()
        }
        let windowsAfterCleanup = surfaces.reduce(0) {
            $0 + $1.retainedWindowCount()
        }
        surfaces = []
        await capture.stop()
        let retainedFramesAfterCleanup = capture.retainedFrameCount()
        signalSources.forEach { $0.cancel() }
        signalSources = []

        if var success,
           retainedFramesAfterCleanup == 0,
           retainedTexturesAfterCleanup == 0,
           windowsAfterCleanup == 0 {
            success.retainedFramesAfterCleanup = retainedFramesAfterCleanup
            success.retainedTexturesAfterCleanup = retainedTexturesAfterCleanup
            success.windowsAfterCleanup = windowsAfterCleanup
            emit(success)
            exitCode = 0
        } else {
            let observed: AOSDesktopPixelNativeBaselineFailure
            if failure == nil, success != nil {
                observed = AOSDesktopPixelNativeBaselineFailure(
                    code: "DESKTOP_PIXEL_BASELINE_CLEANUP_INCOMPLETE"
                )
            } else {
                observed = failure ?? AOSDesktopPixelNativeBaselineFailure(
                    code: "DESKTOP_PIXEL_BASELINE_CANCELED"
                )
            }
            emit(AOSDesktopPixelNativeBaselineSummary(
                status: "failed",
                errorCode: observed.code,
                nativeCode: observed.nativeCode,
                displayCount: displayCount,
                presentation: options.presentation,
                warmupMilliseconds: nil,
                triggerToVisibleMilliseconds: nil,
                presentationSkewMilliseconds: nil,
                oldestFrameAgeMilliseconds: nil,
                retainedFramesAfterCleanup: retainedFramesAfterCleanup,
                retainedTexturesAfterCleanup: retainedTexturesAfterCleanup,
                windowsAfterCleanup: windowsAfterCleanup
            ), toStandardError: true)
            exitCode = 1
        }
        stopApplicationRunLoop()
    }

    private func installSignalHandlers() {
        for value in [SIGINT, SIGTERM] {
            signal(value, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: value, queue: .main)
            source.setEventHandler { [weak self] in
                Task { @MainActor in
                    await self?.finish()
                }
            }
            source.resume()
            signalSources.append(source)
        }
    }

    private func milliseconds(_ nanoseconds: UInt64) -> Double {
        Double(nanoseconds) / 1_000_000
    }

    private func stopApplicationRunLoop() {
        NSApp.stop(nil)
        guard let wakeEvent = NSEvent.otherEvent(
            with: .applicationDefined,
            location: .zero,
            modifierFlags: [],
            timestamp: 0,
            windowNumber: 0,
            context: nil,
            subtype: 0,
            data1: 0,
            data2: 0
        ) else { return }
        NSApp.postEvent(wakeEvent, atStart: false)
    }

    private func emit(_ value: AOSDesktopPixelNativeBaselineSummary, toStandardError: Bool = false) {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        guard var data = try? encoder.encode(value) else { return }
        data.append(0x0a)
        (toStandardError ? FileHandle.standardError : FileHandle.standardOutput).write(data)
    }
}

private func aosDesktopPixelNativeBaselineDisplayID(_ screen: NSScreen) -> CGDirectDisplayID? {
    let key = NSDeviceDescriptionKey("NSScreenNumber")
    return (screen.deviceDescription[key] as? NSNumber)?.uint32Value
}

func runDesktopPixelNativeBaselineCommand(args: [String]) -> Never {
    let options: AOSDesktopPixelNativeBaselineOptions
    do {
        options = try AOSDesktopPixelNativeBaselineOptions.parse(args)
    } catch {
        let failure = error as? AOSDesktopPixelNativeBaselineFailure
            ?? AOSDesktopPixelNativeBaselineFailure(code: "DESKTOP_PIXEL_BASELINE_INVALID_ARGUMENT")
        let response = [
            "schema_version": "aos.desktop-pixel-native-baseline.v1",
            "status": "failed",
            "error_code": failure.code,
        ]
        if let data = try? JSONSerialization.data(withJSONObject: response, options: [.sortedKeys]) {
            FileHandle.standardError.write(data)
            FileHandle.standardError.write(Data("\n".utf8))
        }
        exit(1)
    }

    return MainActor.assumeIsolated {
        let application = NSApplication.shared
        application.setActivationPolicy(.accessory)
        let controller = AOSDesktopPixelNativeBaselineController(options: options)
        application.delegate = controller
        withExtendedLifetime(controller) {
            application.run()
        }
        exit(controller.exitCode)
    }
}
