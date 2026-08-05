import CoreGraphics
import Foundation

private final class FakePublicCaptureCapturer:
    AOSDesktopPixelExclusiveStillCapturing
{
    var captureCount = 0
    var lastRequest: AOSDesktopPixelSnapshotRequest?
    var result: Result<AOSDesktopPixelFrameSet, Error> = .failure(
        AOSDesktopFrameCaptureFailure.captureFailed
    )

    @discardableResult
    func captureExclusiveStill(
        _ request: AOSDesktopPixelSnapshotRequest,
        completion: @escaping (Result<AOSDesktopPixelFrameSet, Error>) -> Void
    ) -> AOSDesktopFrameCancelling {
        captureCount += 1
        lastRequest = request
        completion(result)
        return AOSDesktopFrameCancellation()
    }
}

private func publicCaptureTopology() throws -> AOSDisplayTopologySnapshot {
    try buildAOSDisplayTopologySnapshot(
        observation: [AOSDisplayTopologyObservationMember(
            runtimeDisplayID: 42,
            displayUUID: "11111111-1111-4111-8111-111111111111",
            label: "fixture",
            isMain: true,
            isMirrored: false,
            nativeBounds: AOSDisplayTopologyBounds(
                x: 0, y: 0, width: 100, height: 80
            ),
            nativeVisibleBounds: AOSDisplayTopologyBounds(
                x: 0, y: 0, width: 100, height: 80
            ),
            scaleFactor: 1,
            rotation: 0
        )],
        screensHaveSeparateSpaces: true
    )
}

private func publicCapturePayload() throws -> [String: Any] {
    let topology = try publicCaptureTopology()
    return [
        "capture_id": "11111111-1111-4111-8111-111111111111",
        "display_topology": try aosDisplayTopologyWireValue(topology),
        "displays": [[
            "display_id": 42,
            "index": 0,
            "topology_ordinal": 1,
        ]],
        "display_ids": [42],
        "excluded_window_ids": [900],
        "window_targets": [],
        "maximum_pixels_per_display": 8_000,
        "shows_cursor": false,
    ]
}

private func publicCaptureResponse(
    controller: AOSPublicCaptureController,
    payload: [String: Any]
) -> [String: Any] {
    let settled = DispatchSemaphore(value: 0)
    var response: [String: Any] = [:]
    _ = controller.capture(
        payload: payload,
        emitChunk: { _ in true },
        completion: {
            response = $0
            settled.signal()
        }
    )
    require(
        settled.wait(timeout: .now() + 1) == .success,
        "public capture controller did not settle"
    )
    return response
}

private func requireRejectedBeforeCapture(
    _ payload: [String: Any],
    _ message: String,
    expectedCode: String = "INVALID_ARG"
) {
    let capturer = FakePublicCaptureCapturer()
    let response = publicCaptureResponse(
        controller: AOSPublicCaptureController(capturer: capturer),
        payload: payload
    )
    require(capturer.captureCount == 0, message)
    require(response["code"] as? String == expectedCode, message)
}

private func publicCaptureImage() -> CGImage {
    let context = CGContext(
        data: nil,
        width: 2,
        height: 2,
        bitsPerComponent: 8,
        bytesPerRow: 8,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    )!
    return context.makeImage()!
}

private func successfulPublicCapture(
    source: AOSDesktopPixelFrame.Source,
    usedWindowFallback: Bool
) throws -> [String: Any] {
    let capturer = FakePublicCaptureCapturer()
    capturer.result = .success(AOSDesktopPixelFrameSet(
        capturedAt: Date(),
        durationMilliseconds: 1,
        frames: [AOSDesktopPixelFrame(
            capturedAt: Date(),
            displayID: 42,
            image: publicCaptureImage(),
            source: source,
            usedWindowFallback: usedWindowFallback
        )]
    ))
    var payload = try publicCapturePayload()
    payload["window_targets"] = [["display_id": 42, "window_id": 901]]
    return publicCaptureResponse(
        controller: AOSPublicCaptureController(capturer: capturer),
        payload: payload
    )
}

func runPublicCaptureControllerTests() throws {
    let admittedCapturer = FakePublicCaptureCapturer()
    let admitted = publicCaptureResponse(
        controller: AOSPublicCaptureController(capturer: admittedCapturer),
        payload: try publicCapturePayload()
    )
    require(
        admittedCapturer.captureCount == 1
            && admitted["code"] as? String == "DESKTOP_FRAME_CAPTURE_FAILED",
        "valid public capture did not reach the production controller"
    )
    let expectedTopology = try publicCaptureTopology()
    require(
        admittedCapturer.lastRequest?.publicCaptureTopology?.identity
            == expectedTopology.identity
            && admittedCapturer.lastRequest?.publicCaptureSelections.first?
                .memberIdentity == expectedTopology.displays[0].memberIdentity,
        "public capture dropped its frozen topology binding before native admission"
    )

    let fallback = try successfulPublicCapture(
        source: .display,
        usedWindowFallback: true
    )
    let fallbackFrame = (fallback["frames"] as? [[String: Any]])?.first
    require(
        fallbackFrame?["capture_source"] as? String == "display"
            && fallbackFrame?["window_fallback"] as? Bool == true
            && fallbackFrame?["window_id"] == nil,
        "display fallback metadata drifted"
    )
    let window = try successfulPublicCapture(
        source: .window(901),
        usedWindowFallback: false
    )
    let windowFrame = (window["frames"] as? [[String: Any]])?.first
    require(
        windowFrame?["capture_source"] as? String == "window"
            && windowFrame?["window_fallback"] as? Bool == false
            && windowFrame?["window_id"] as? Int == 901,
        "window metadata drifted"
    )
    let impossible = try successfulPublicCapture(
        source: .window(901),
        usedWindowFallback: true
    )
    require(
        impossible["code"] as? String == "DESKTOP_FRAME_CAPTURE_FAILED",
        "impossible window fallback metadata failed open"
    )

    var extra = try publicCapturePayload()
    extra["path"] = "/private/capture.png"
    requireRejectedBeforeCapture(extra, "extra request key reached capture")

    var missing = try publicCapturePayload()
    missing.removeValue(forKey: "shows_cursor")
    requireRejectedBeforeCapture(missing, "missing request key reached capture")

    var tooManyExclusions = try publicCapturePayload()
    tooManyExclusions["excluded_window_ids"] = Array(1...257)
    requireRejectedBeforeCapture(
        tooManyExclusions,
        "oversized exclusion set reached capture"
    )
    var duplicateExclusions = try publicCapturePayload()
    duplicateExclusions["excluded_window_ids"] = [900, 900]
    requireRejectedBeforeCapture(
        duplicateExclusions,
        "duplicate exclusion reached capture"
    )
    var negativeExclusion = try publicCapturePayload()
    negativeExclusion["excluded_window_ids"] = [-1]
    requireRejectedBeforeCapture(
        negativeExclusion,
        "negative exclusion reached capture"
    )
    var booleanExclusion = try publicCapturePayload()
    booleanExclusion["excluded_window_ids"] = [true]
    requireRejectedBeforeCapture(
        booleanExclusion,
        "boolean exclusion reached capture"
    )
    var floatingExclusion = try publicCapturePayload()
    floatingExclusion["excluded_window_ids"] = [NSNumber(value: 42.0)]
    requireRejectedBeforeCapture(
        floatingExclusion,
        "floating-token exclusion reached capture"
    )
    var overflowExclusion = try publicCapturePayload()
    overflowExclusion["excluded_window_ids"] = [
        NSNumber(value: UInt64(UInt32.max) + 1),
    ]
    requireRejectedBeforeCapture(
        overflowExclusion,
        "overflowing exclusion reached capture"
    )
    var fractionalMaximum = try publicCapturePayload()
    fractionalMaximum["maximum_pixels_per_display"] = 8_000.5
    requireRejectedBeforeCapture(
        fractionalMaximum,
        "fractional pixel limit reached capture"
    )
    var unsafeMaximum = try publicCapturePayload()
    unsafeMaximum["maximum_pixels_per_display"] = NSNumber(
        value: Int64(9_007_199_254_740_993)
    )
    requireRejectedBeforeCapture(
        unsafeMaximum,
        "lossy JSON integer pixel limit reached capture"
    )
    var unsignedMaximum = try publicCapturePayload()
    unsignedMaximum["maximum_pixels_per_display"] = NSNumber(value: UInt64.max)
    requireRejectedBeforeCapture(
        unsignedMaximum,
        "overflowing unsigned pixel limit reached capture"
    )
    var duplicateSelection = try publicCapturePayload()
    duplicateSelection["display_ids"] = [42, 42]
    requireRejectedBeforeCapture(
        duplicateSelection,
        "duplicate display selection reached capture"
    )
    var negativeDisplay = try publicCapturePayload()
    negativeDisplay["display_ids"] = [-42]
    requireRejectedBeforeCapture(
        negativeDisplay,
        "negative display selection reached capture"
    )
    var floatingDisplay = try publicCapturePayload()
    floatingDisplay["display_ids"] = [NSNumber(value: 42.0)]
    requireRejectedBeforeCapture(
        floatingDisplay,
        "floating-token display selection reached capture"
    )
    var overflowingDisplay = try publicCapturePayload()
    overflowingDisplay["display_ids"] = [
        NSNumber(value: UInt64(UInt32.max) + 1),
    ]
    requireRejectedBeforeCapture(
        overflowingDisplay,
        "overflowing display selection reached capture"
    )
    var duplicateOrdinal = try publicCapturePayload()
    duplicateOrdinal["displays"] = [
        ["display_id": 42, "index": 0, "topology_ordinal": 1],
        ["display_id": 43, "index": 1, "topology_ordinal": 1],
    ]
    duplicateOrdinal["display_ids"] = [42, 43]
    requireRejectedBeforeCapture(
        duplicateOrdinal,
        "duplicate topology ordinal reached capture"
    )
    var mismatchedWindow = try publicCapturePayload()
    mismatchedWindow["window_targets"] = [[
        "display_id": 43,
        "window_id": 901,
    ]]
    requireRejectedBeforeCapture(
        mismatchedWindow,
        "window/display mismatch reached capture"
    )
    var floatingWindow = try publicCapturePayload()
    floatingWindow["window_targets"] = [[
        "display_id": 42,
        "window_id": NSNumber(value: 42.0),
    ]]
    requireRejectedBeforeCapture(
        floatingWindow,
        "floating-token window id reached capture"
    )
    var overflowingWindow = try publicCapturePayload()
    overflowingWindow["window_targets"] = [[
        "display_id": 42,
        "window_id": NSNumber(value: UInt64(UInt32.max) + 1),
    ]]
    requireRejectedBeforeCapture(
        overflowingWindow,
        "overflowing window id reached capture"
    )

    var displayExtra = try publicCapturePayload()
    var displayMappings = displayExtra["displays"] as! [[String: Any]]
    displayMappings[0]["scale_factor"] = 1
    displayExtra["displays"] = displayMappings
    requireRejectedBeforeCapture(
        displayExtra,
        "nested display key reached capture"
    )
    var windowExtra = try publicCapturePayload()
    windowExtra["window_targets"] = [[
        "display_id": 42,
        "window_id": 901,
        "extra": true,
    ]]
    requireRejectedBeforeCapture(
        windowExtra,
        "nested window key reached capture"
    )

    var hashTamper = try publicCapturePayload()
    var hashTopology = hashTamper["display_topology"] as! [String: Any]
    hashTopology["identity"] = "sha256:" + String(repeating: "0", count: 64)
    hashTamper["display_topology"] = hashTopology
    requireRejectedBeforeCapture(
        hashTamper,
        "topology hash tamper reached capture",
        expectedCode: "DESKTOP_FRAME_TOPOLOGY_MISMATCH"
    )

    var factTamper = try publicCapturePayload()
    var factTopology = factTamper["display_topology"] as! [String: Any]
    var factDisplays = factTopology["displays"] as! [[String: Any]]
    var factBounds = factDisplays[0]["native_bounds"] as! [String: Any]
    factBounds["width"] = 101
    factDisplays[0]["native_bounds"] = factBounds
    factTopology["displays"] = factDisplays
    factTamper["display_topology"] = factTopology
    requireRejectedBeforeCapture(
        factTamper,
        "topology fact tamper reached capture",
        expectedCode: "DESKTOP_FRAME_TOPOLOGY_MISMATCH"
    )

    var topologyExtra = try publicCapturePayload()
    var nestedTopology = topologyExtra["display_topology"] as! [String: Any]
    nestedTopology["extra"] = true
    topologyExtra["display_topology"] = nestedTopology
    requireRejectedBeforeCapture(
        topologyExtra,
        "nested topology key reached capture",
        expectedCode: "DESKTOP_FRAME_TOPOLOGY_MISMATCH"
    )

    var topologyDisplayExtra = try publicCapturePayload()
    var displayTopology = topologyDisplayExtra["display_topology"] as! [String: Any]
    var topologyDisplays = displayTopology["displays"] as! [[String: Any]]
    topologyDisplays[0]["extra"] = true
    displayTopology["displays"] = topologyDisplays
    topologyDisplayExtra["display_topology"] = displayTopology
    requireRejectedBeforeCapture(
        topologyDisplayExtra,
        "topology display key reached capture",
        expectedCode: "DESKTOP_FRAME_TOPOLOGY_MISMATCH"
    )

    var memberExtra = try publicCapturePayload()
    var memberTopology = memberExtra["display_topology"] as! [String: Any]
    var memberDisplays = memberTopology["displays"] as! [[String: Any]]
    var member = memberDisplays[0]["member_identity"] as! [String: Any]
    member["extra"] = true
    memberDisplays[0]["member_identity"] = member
    memberTopology["displays"] = memberDisplays
    memberExtra["display_topology"] = memberTopology
    requireRejectedBeforeCapture(
        memberExtra,
        "member identity key reached capture",
        expectedCode: "DESKTOP_FRAME_TOPOLOGY_MISMATCH"
    )

    var boundsExtra = try publicCapturePayload()
    var boundsTopology = boundsExtra["display_topology"] as! [String: Any]
    var boundsDisplays = boundsTopology["displays"] as! [[String: Any]]
    var bounds = boundsDisplays[0]["native_bounds"] as! [String: Any]
    bounds["extra"] = true
    boundsDisplays[0]["native_bounds"] = bounds
    boundsTopology["displays"] = boundsDisplays
    boundsExtra["display_topology"] = boundsTopology
    requireRejectedBeforeCapture(
        boundsExtra,
        "topology bounds key reached capture",
        expectedCode: "DESKTOP_FRAME_TOPOLOGY_MISMATCH"
    )

    var pointExtra = try publicCapturePayload()
    var pointTopology = pointExtra["display_topology"] as! [String: Any]
    var point = pointTopology["desktop_world_origin_native"] as! [String: Any]
    point["extra"] = true
    pointTopology["desktop_world_origin_native"] = point
    pointExtra["display_topology"] = pointTopology
    requireRejectedBeforeCapture(
        pointExtra,
        "topology point key reached capture",
        expectedCode: "DESKTOP_FRAME_TOPOLOGY_MISMATCH"
    )

    var nonFiniteScale = try publicCapturePayload()
    var scaleTopology = nonFiniteScale["display_topology"] as! [String: Any]
    var scaleDisplays = scaleTopology["displays"] as! [[String: Any]]
    scaleDisplays[0]["scale_factor"] = Double.infinity
    scaleTopology["displays"] = scaleDisplays
    nonFiniteScale["display_topology"] = scaleTopology
    requireRejectedBeforeCapture(
        nonFiniteScale,
        "non-finite topology scale reached capture",
        expectedCode: "DESKTOP_FRAME_TOPOLOGY_MISMATCH"
    )
}
