import AppKit
import Darwin
import Foundation
import Metal

struct AOSDesktopPixelNativeBaselineFailure: Error, Sendable {
    let code: String
    let nativeCode: Int?

    init(code: String, nativeCode: Int? = nil) {
        self.code = code
        self.nativeCode = nativeCode
    }
}

private struct AOSDesktopPixelNativeBaselineOptions {
    let host: AOSDesktopPixelNativeBaselineHostKind
    let holdMilliseconds: UInt64
    let presentation: AOSDesktopPixelNativeBaselinePresentation

    static func parse(_ args: [String]) throws -> Self {
        var host = AOSDesktopPixelNativeBaselineHostKind.standalone
        var holdMilliseconds: UInt64 = 750
        var presentation: AOSDesktopPixelNativeBaselinePresentation = .identity
        var sawJSON = false
        var index = 0
        while index < args.count {
            switch args[index] {
            case "--host":
                index += 1
                guard args.indices.contains(index),
                      let value = AOSDesktopPixelNativeBaselineHostKind(rawValue: args[index]) else {
                    throw AOSDesktopPixelNativeBaselineFailure(code: "DESKTOP_PIXEL_BASELINE_INVALID_HOST")
                }
                host = value
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
        return Self(
            host: host,
            holdMilliseconds: holdMilliseconds,
            presentation: presentation
        )
    }
}

private struct AOSDesktopPixelNativeBaselineSummary: Encodable, Sendable {
    let schemaVersion = "aos.desktop-pixel-native-baseline.v1"
    let status: String
    let errorCode: String?
    let nativeCode: Int?
    let displayCount: Int
    let host: AOSDesktopPixelNativeBaselineHostKind
    let canvasGeneration: UInt64?
    let topologyGeneration: UInt64?
    let sheetOwner: String?
    let sheetResource: String?
    let sheetAddressed: Bool
    let sheetGeometryBytes: Int
    let sheetTriangleCount: Int
    let sheetVertexCount: Int
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
    var retainedCaptureStreamsAfterCleanup: Int
    var retainedGeometryBuffersAfterCleanup: Int
    var retainedGPUResourcesAfterCleanup: Int
    var pendingRetirementsAfterCleanup: Int
    var sheetsAfterCleanup: Int
    var retainedTexturesAfterCleanup: Int
    var retainedViewsAfterCleanup: Int
    var windowsAfterCleanup: Int

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case status
        case errorCode = "error_code"
        case nativeCode = "native_code"
        case displayCount = "display_count"
        case host
        case canvasGeneration = "canvas_generation"
        case topologyGeneration = "topology_generation"
        case sheetOwner = "sheet_owner"
        case sheetResource = "sheet_resource"
        case sheetAddressed = "sheet_addressed"
        case sheetGeometryBytes = "sheet_geometry_bytes"
        case sheetTriangleCount = "sheet_triangle_count"
        case sheetVertexCount = "sheet_vertex_count"
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
        case retainedCaptureStreamsAfterCleanup = "retained_capture_streams_after_cleanup"
        case retainedGeometryBuffersAfterCleanup = "retained_geometry_buffers_after_cleanup"
        case retainedGPUResourcesAfterCleanup = "retained_gpu_resources_after_cleanup"
        case pendingRetirementsAfterCleanup = "pending_retirements_after_cleanup"
        case sheetsAfterCleanup = "sheets_after_cleanup"
        case retainedTexturesAfterCleanup = "retained_textures_after_cleanup"
        case retainedViewsAfterCleanup = "retained_views_after_cleanup"
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
    private var host: (any AOSDesktopPixelNativeBaselineHost)?
    private var cancellationFailureCode = "DESKTOP_PIXEL_BASELINE_CANCELED"
    private var proofTask: Task<Void, Never>?
    private var signalSources: [DispatchSourceSignal] = []
    private(set) var exitCode: Int32 = 1

    init(options: AOSDesktopPixelNativeBaselineOptions) {
        self.options = options
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        installSignalHandlers()
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(displayParametersChanged(_:)),
            name: NSApplication.didChangeScreenParametersNotification,
            object: nil
        )
        proofTask = Task { @MainActor [weak self] in
            await self?.runProof()
        }
    }

    private func runProof() async {
        guard CGPreflightScreenCaptureAccess() else {
            await conclude(failure: AOSDesktopPixelNativeBaselineFailure(
                code: "SCREEN_CAPTURE_PERMISSION_REQUIRED"
            ))
            return
        }
        guard let device = MTLCreateSystemDefaultDevice() else {
            await conclude(failure: AOSDesktopPixelNativeBaselineFailure(
                code: "DESKTOP_PIXEL_BASELINE_METAL_UNAVAILABLE"
            ))
            return
        }

        do {
            let host = try makeAOSDesktopPixelNativeBaselineHost(
                kind: options.host,
                device: device
            )
            self.host = host
            let endpoints = host.endpoints

            let warmupStarted = DispatchTime.now().uptimeNanoseconds
            try await capture.start(displayIDs: endpoints.map(\.displayID))
            try Task.checkCancellation()
            let warmupFinished = DispatchTime.now().uptimeNanoseconds
            let frames = capture.snapshots()
            guard frames.count == endpoints.count else {
                throw AOSDesktopPixelNativeBaselineFailure(code: "DESKTOP_PIXEL_BASELINE_FRAME_SET_INCOMPLETE")
            }
            let byDisplay = Dictionary(uniqueKeysWithValues: frames.map { ($0.displayID, $0) })
            let barrier = AOSDesktopPixelNativeBaselinePresentationBarrier(expected: endpoints.count)
            for endpoint in endpoints {
                guard let frame = byDisplay[endpoint.displayID] else {
                    throw AOSDesktopPixelNativeBaselineFailure(code: "DESKTOP_PIXEL_BASELINE_FRAME_SET_INCOMPLETE")
                }
                try endpoint.renderer.setFrame(frame, presentation: options.presentation)
                endpoint.renderer.onPresented = { barrier.markPresented() }
            }

            let triggered = DispatchTime.now().uptimeNanoseconds
            try host.present()
            guard let presented = await barrier.wait(timeoutMilliseconds: 2_000),
                  let firstPresented = presented.min(),
                  let lastPresented = presented.max() else {
                throw AOSDesktopPixelNativeBaselineFailure(code: "DESKTOP_PIXEL_BASELINE_PRESENTATION_TIMEOUT")
            }
            try Task.checkCancellation()
            try await Task.sleep(nanoseconds: options.holdMilliseconds * 1_000_000)
            let oldestFrame = frames.map(\.receivedAtNanoseconds).min() ?? triggered
            let success = AOSDesktopPixelNativeBaselineSummary(
                status: "passed",
                errorCode: nil,
                nativeCode: nil,
                displayCount: endpoints.count,
                host: host.kind,
                canvasGeneration: host.canvasGeneration,
                topologyGeneration: host.topologyGeneration,
                sheetOwner: host.sheetIdentity?.ownerID,
                sheetResource: host.sheetIdentity?.resourceID,
                sheetAddressed: host.sheetIdentity != nil,
                sheetGeometryBytes: host.geometryMetrics.geometryBytes,
                sheetTriangleCount: host.geometryMetrics.triangleCount,
                sheetVertexCount: host.geometryMetrics.vertexCount,
                presentation: options.presentation,
                warmupMilliseconds: milliseconds(warmupFinished - warmupStarted),
                triggerToVisibleMilliseconds: milliseconds(lastPresented - triggered),
                presentationSkewMilliseconds: milliseconds(lastPresented - firstPresented),
                oldestFrameAgeMilliseconds: milliseconds(lastPresented - oldestFrame),
                retainedFramesAfterCleanup: 0,
                retainedCaptureStreamsAfterCleanup: 0,
                retainedGeometryBuffersAfterCleanup: 0,
                retainedGPUResourcesAfterCleanup: 0,
                pendingRetirementsAfterCleanup: 0,
                sheetsAfterCleanup: 0,
                retainedTexturesAfterCleanup: 0,
                retainedViewsAfterCleanup: 0,
                windowsAfterCleanup: 0
            )
            await conclude(success: success)
        } catch {
            let failure: AOSDesktopPixelNativeBaselineFailure
            if error is CancellationError {
                failure = AOSDesktopPixelNativeBaselineFailure(
                    code: cancellationFailureCode
                )
            } else {
                failure = error as? AOSDesktopPixelNativeBaselineFailure
                    ?? AOSDesktopPixelNativeBaselineFailure(
                        code: "DESKTOP_PIXEL_BASELINE_FAILED",
                        nativeCode: (error as NSError).code
                    )
            }
            await conclude(failure: failure)
        }
    }

    private func conclude(
        success: AOSDesktopPixelNativeBaselineSummary? = nil,
        failure: AOSDesktopPixelNativeBaselineFailure? = nil
    ) async {
        guard !finishing else { return }
        finishing = true
        let teardown = Task.detached { @MainActor [weak self] in
            await self?.finish(success: success, failure: failure)
        }
        await teardown.value
    }

    private func finish(
        success: AOSDesktopPixelNativeBaselineSummary? = nil,
        failure: AOSDesktopPixelNativeBaselineFailure? = nil
    ) async {
        let activeHost = host
        let displayCount = activeHost?.endpoints.count ?? 0
        let hostKind = activeHost?.kind ?? options.host
        let canvasGeneration = activeHost?.canvasGeneration
        let topologyGeneration = activeHost?.topologyGeneration
        let geometryMetrics = activeHost?.geometryMetrics
        let captureCleanup = await capture.stop()
        let cleanup = await activeHost?.dispose() ?? AOSDesktopPixelNativeBaselineHostCleanup(
            pendingRetirements: 0,
            retainedGeometryBuffers: 0,
            retainedGPUResources: 0,
            retainedSheets: 0,
            retainedTextures: 0,
            retainedViews: 0,
            retainedWindows: 0
        )
        host = nil
        let retainedFramesAfterCleanup = captureCleanup.retainedFrames
        signalSources.forEach { $0.cancel() }
        signalSources = []
        NotificationCenter.default.removeObserver(self)
        let cleanupComplete = retainedFramesAfterCleanup == 0
            && captureCleanup.unsettledStreams == 0
            && captureCleanup.nativeCode == nil
            && cleanup.retainedGeometryBuffers == 0
            && cleanup.retainedGPUResources == 0
            && cleanup.pendingRetirements == 0
            && cleanup.retainedSheets == 0
            && cleanup.retainedTextures == 0
            && cleanup.retainedViews == 0
            && cleanup.retainedWindows == 0

        if var success, cleanupComplete {
            success.retainedFramesAfterCleanup = retainedFramesAfterCleanup
            success.retainedCaptureStreamsAfterCleanup = captureCleanup.unsettledStreams
            success.retainedGeometryBuffersAfterCleanup = cleanup.retainedGeometryBuffers
            success.retainedGPUResourcesAfterCleanup = cleanup.retainedGPUResources
            success.pendingRetirementsAfterCleanup = cleanup.pendingRetirements
            success.sheetsAfterCleanup = cleanup.retainedSheets
            success.retainedTexturesAfterCleanup = cleanup.retainedTextures
            success.retainedViewsAfterCleanup = cleanup.retainedViews
            success.windowsAfterCleanup = cleanup.retainedWindows
            emit(success)
            exitCode = 0
        } else {
            let observed: AOSDesktopPixelNativeBaselineFailure
            if !cleanupComplete {
                observed = AOSDesktopPixelNativeBaselineFailure(
                    code: "DESKTOP_PIXEL_BASELINE_CLEANUP_INCOMPLETE",
                    nativeCode: captureCleanup.nativeCode
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
                host: hostKind,
                canvasGeneration: canvasGeneration,
                topologyGeneration: topologyGeneration,
                sheetOwner: activeHost?.sheetIdentity?.ownerID,
                sheetResource: activeHost?.sheetIdentity?.resourceID,
                sheetAddressed: activeHost?.sheetIdentity != nil,
                sheetGeometryBytes: geometryMetrics?.geometryBytes ?? 0,
                sheetTriangleCount: geometryMetrics?.triangleCount ?? 0,
                sheetVertexCount: geometryMetrics?.vertexCount ?? 0,
                presentation: options.presentation,
                warmupMilliseconds: nil,
                triggerToVisibleMilliseconds: nil,
                presentationSkewMilliseconds: nil,
                oldestFrameAgeMilliseconds: nil,
                retainedFramesAfterCleanup: retainedFramesAfterCleanup,
                retainedCaptureStreamsAfterCleanup: captureCleanup.unsettledStreams,
                retainedGeometryBuffersAfterCleanup: cleanup.retainedGeometryBuffers,
                retainedGPUResourcesAfterCleanup: cleanup.retainedGPUResources,
                pendingRetirementsAfterCleanup: cleanup.pendingRetirements,
                sheetsAfterCleanup: cleanup.retainedSheets,
                retainedTexturesAfterCleanup: cleanup.retainedTextures,
                retainedViewsAfterCleanup: cleanup.retainedViews,
                windowsAfterCleanup: cleanup.retainedWindows
            ), toStandardError: true)
            exitCode = 1
        }
        proofTask = nil
        stopApplicationRunLoop()
    }

    private func installSignalHandlers() {
        for value in [SIGINT, SIGTERM] {
            signal(value, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: value, queue: .main)
            source.setEventHandler { [weak self] in
                Task { @MainActor [weak self] in
                    self?.cancelProof(code: "DESKTOP_PIXEL_BASELINE_CANCELED")
                }
            }
            source.resume()
            signalSources.append(source)
        }
    }

    @objc private func displayParametersChanged(_ notification: Notification) {
        cancelProof(code: "DESKTOP_PIXEL_BASELINE_TOPOLOGY_CHANGED")
    }

    private func cancelProof(code: String) {
        guard !finishing, let proofTask, !proofTask.isCancelled else { return }
        cancellationFailureCode = code
        proofTask.cancel()
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

func aosDesktopPixelNativeBaselineDisplayID(_ screen: NSScreen) -> CGDirectDisplayID? {
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
