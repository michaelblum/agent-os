import CoreFoundation
import Foundation

private let aosDesktopWorldFramebufferProofRequestContract =
    "aos.desktop-world.framebuffer-proof.request.v1"
private let aosDesktopWorldFramebufferProofResultContract =
    "aos.desktop-world.framebuffer-proof.result.v1"

private struct AOSDesktopWorldFramebufferProofRequest {
    let dictionary: [String: Any]
    let sampleCount: Int
}

private struct AOSDesktopWorldFramebufferProofSegmentKey: Hashable {
    let displayID: UInt32
    let index: Int
}

private struct AOSDesktopWorldFramebufferProofSegmentResult {
    let index: Int
    let sampleCount: Int
    let matchedCount: Int
    let passed: Bool
    let renderDurationMS: Double

    var publicDictionary: [String: Any] {
        [
            "segment_index": index,
            "sample_count": sampleCount,
            "matched_count": matchedCount,
            "passed": passed,
            "render_duration_ms": renderDurationMS,
            "error_code": NSNull(),
        ]
    }
}

private final class AOSDesktopWorldFramebufferProofPending {
    let requestID: String
    let connectionID: UUID
    let owner: String
    let resource: String
    let topology: DesktopWorldSceneBarrierTopology
    let request: AOSDesktopWorldFramebufferProofRequest
    let completion: ([String: Any]) -> Void
    var results: [
        AOSDesktopWorldFramebufferProofSegmentKey:
            AOSDesktopWorldFramebufferProofSegmentResult
    ] = [:]
    var timeout: DispatchWorkItem?

    init(
        requestID: String,
        connectionID: UUID,
        owner: String,
        resource: String,
        topology: DesktopWorldSceneBarrierTopology,
        request: AOSDesktopWorldFramebufferProofRequest,
        completion: @escaping ([String: Any]) -> Void
    ) {
        self.requestID = requestID
        self.connectionID = connectionID
        self.owner = owner
        self.resource = resource
        self.topology = topology
        self.request = request
        self.completion = completion
    }
}

/// Coordinates one content-free framebuffer assertion across the exact active
/// DesktopWorld topology. The browser segments compare pixels locally; this
/// aggregate never receives or persists framebuffer bytes.
final class AOSDesktopWorldFramebufferProofController {
    static let maxSegments = 16
    static let maxSamples = 8
    static let timeoutSeconds: TimeInterval = 1.5

    private let lock = NSLock()
    private let canvasManager: CanvasManager
    private let stageCanvasID: String
    private let authorize: (String, String) -> DesktopWorldSceneBarrierTopology?
    private var pending: AOSDesktopWorldFramebufferProofPending?

    init(
        canvasManager: CanvasManager,
        stageCanvasID: String,
        authorize: @escaping (String, String) -> DesktopWorldSceneBarrierTopology?
    ) {
        self.canvasManager = canvasManager
        self.stageCanvasID = stageCanvasID
        self.authorize = authorize
    }

    func start(
        payload: [String: Any],
        connectionID: UUID,
        completion: @escaping ([String: Any]) -> Void
    ) {
        guard let owner = payload["owner"] as? String,
              let resource = payload["resource"] as? String,
              let proof = payload["proof"] as? [String: Any],
              let request = Self.parseRequest(proof) else {
            completion(Self.failure(
                code: "INVALID_SCENE_FRAMEBUFFER_PROOF",
                message: "DesktopWorld framebuffer proof request is invalid"
            ))
            return
        }
        guard let topology = authorize(owner, resource),
              !topology.segments.isEmpty,
              topology.segments.count <= Self.maxSegments else {
            completion(Self.failure(
                code: "SCENE_FRAMEBUFFER_PROOF_UNAVAILABLE",
                message: "DesktopWorld scene resource is unavailable for framebuffer proof"
            ))
            return
        }

        let requestID = UUID().uuidString.lowercased()
        let entry = AOSDesktopWorldFramebufferProofPending(
            requestID: requestID,
            connectionID: connectionID,
            owner: owner,
            resource: resource,
            topology: topology,
            request: request,
            completion: completion
        )
        let timeout = DispatchWorkItem { [weak self] in
            self?.fail(
                requestID: requestID,
                code: "SCENE_FRAMEBUFFER_PROOF_TIMEOUT",
                message: "DesktopWorld framebuffer proof timed out"
            )
        }
        entry.timeout = timeout
        lock.lock()
        guard pending == nil else {
            lock.unlock()
            completion(Self.failure(
                code: "SCENE_FRAMEBUFFER_PROOF_BUSY",
                message: "Another DesktopWorld framebuffer proof is active"
            ))
            return
        }
        pending = entry
        lock.unlock()

        DispatchQueue.global(qos: .utility).asyncAfter(
            deadline: .now() + Self.timeoutSeconds,
            execute: timeout
        )

        let message: [String: Any] = [
            "type": "desktop_world_stage.framebuffer_proof.request",
            "payload": [
                "request_id": requestID,
                "owner": owner,
                "resource": resource,
                "proof": request.dictionary,
            ],
        ]
        guard canvasManager.postMessageToDesktopWorldSceneStage(
            topology,
            canvasID: stageCanvasID,
            payload: message
        ) else {
            fail(
                requestID: requestID,
                code: "SCENE_FRAMEBUFFER_PROOF_UNAVAILABLE",
                message: "DesktopWorld framebuffer proof could not reach the active stage"
            )
            return
        }
    }

    func handleResult(target: CanvasLifecycleGeneration, payload: [String: Any]) {
        lock.lock()
        guard let entry = pending,
              target.canvasID == stageCanvasID,
              target.value == entry.topology.canvasGeneration,
              payload["request_id"] as? String == entry.requestID,
              payload["owner"] as? String == entry.owner,
              payload["resource"] as? String == entry.resource,
              Self.uint64(payload["canvas_generation"]) == entry.topology.canvasGeneration,
              Self.uint64(payload["topology_generation"]) == entry.topology.generation,
              let displayIDValue = Self.uint64(payload["segment_display_id"]),
              displayIDValue <= UInt64(UInt32.max),
              let index = Self.integer(payload["segment_index"]),
              entry.topology.segments.contains(where: {
                  $0.displayID == UInt32(displayIDValue) && $0.index == index
              }) else {
            lock.unlock()
            return
        }
        let requestID = entry.requestID
        if payload["status"] as? String == "error" {
            let code = Self.errorCode(
                payload["code"],
                fallback: "SCENE_FRAMEBUFFER_PROOF_FAILED"
            )
            lock.unlock()
            fail(
                requestID: requestID,
                code: code,
                message: "DesktopWorld framebuffer proof segment failed"
            )
            return
        }
        guard let result = Self.parseSegmentResult(
            payload,
            expectedSampleCount: entry.request.sampleCount,
            index: index
        ) else {
            lock.unlock()
            fail(
                requestID: requestID,
                code: "INVALID_SCENE_FRAMEBUFFER_PROOF_RESULT",
                message: "DesktopWorld framebuffer proof returned an invalid result"
            )
            return
        }
        let key = AOSDesktopWorldFramebufferProofSegmentKey(
            displayID: UInt32(displayIDValue),
            index: index
        )
        guard entry.results[key] == nil else {
            lock.unlock()
            return
        }
        entry.results[key] = result
        guard entry.results.count == entry.topology.segments.count else {
            lock.unlock()
            return
        }
        pending = nil
        entry.timeout?.cancel()
        let ordered = entry.results.values.sorted { $0.index < $1.index }
        lock.unlock()
        let sampleCount = ordered.reduce(0) { $0 + $1.sampleCount }
        let matchedCount = ordered.reduce(0) { $0 + $1.matchedCount }
        completion(entry, payload: [
            "contract": aosDesktopWorldFramebufferProofResultContract,
            "status": "ok",
            "passed": ordered.allSatisfy(\.passed),
            "segment_count": ordered.count,
            "sample_count": sampleCount,
            "matched_count": matchedCount,
            "max_render_duration_ms": ordered.map(\.renderDurationMS).max() ?? 0,
            "segments": ordered.map(\.publicDictionary),
            "pixels_returned": false,
            "pixels_persisted": false,
            "error_code": NSNull(),
        ])
    }

    func connectionClosed(_ connectionID: UUID) {
        lock.lock()
        guard let entry = pending, entry.connectionID == connectionID else {
            lock.unlock()
            return
        }
        pending = nil
        entry.timeout?.cancel()
        lock.unlock()
    }

    func stageInvalidated(code: String = "SCENE_STAGE_UNAVAILABLE") {
        failCurrent(code: code, message: "DesktopWorld scene stage changed during framebuffer proof")
    }

    private func failCurrent(code: String, message: String) {
        lock.lock()
        guard let entry = pending else {
            lock.unlock()
            return
        }
        pending = nil
        entry.timeout?.cancel()
        lock.unlock()
        completion(entry, payload: Self.failure(code: code, message: message))
    }

    private func fail(requestID: String, code: String, message: String) {
        lock.lock()
        guard let entry = pending, entry.requestID == requestID else {
            lock.unlock()
            return
        }
        pending = nil
        entry.timeout?.cancel()
        lock.unlock()
        completion(entry, payload: Self.failure(code: code, message: message))
    }

    private func completion(
        _ entry: AOSDesktopWorldFramebufferProofPending,
        payload: [String: Any]
    ) {
        entry.completion(payload)
    }

    private static func parseRequest(
        _ value: [String: Any]
    ) -> AOSDesktopWorldFramebufferProofRequest? {
        guard Set(value.keys) == Set([
            "contract", "minimum_matches", "maximum_matches", "samples",
        ]),
              value["contract"] as? String == aosDesktopWorldFramebufferProofRequestContract,
              let samples = value["samples"] as? [Any],
              !samples.isEmpty,
              samples.count <= maxSamples,
              let minimumMatches = integer(value["minimum_matches"]),
              minimumMatches >= 0,
              minimumMatches <= samples.count,
              let maximumMatches = integer(value["maximum_matches"]),
              maximumMatches >= minimumMatches,
              maximumMatches <= samples.count else { return nil }
        var normalizedSamples: [[String: Any]] = []
        for rawSample in samples {
            guard let sample = rawSample as? [String: Any],
                  Set(sample.keys) == Set(["uv", "rgba_min", "rgba_max"]),
                  let uv = sample["uv"] as? [Any],
                  uv.count == 2,
                  let u = finiteDouble(uv[0]), u >= 0, u <= 1,
                  let v = finiteDouble(uv[1]), v >= 0, v <= 1,
                  let rgbaMin = byteVector(sample["rgba_min"]),
                  let rgbaMax = byteVector(sample["rgba_max"]),
                  zip(rgbaMin, rgbaMax).allSatisfy({ pair in pair.0 <= pair.1 }) else {
                return nil
            }
            normalizedSamples.append([
                "uv": [u, v],
                "rgba_min": rgbaMin,
                "rgba_max": rgbaMax,
            ])
        }
        return AOSDesktopWorldFramebufferProofRequest(
            dictionary: [
                "contract": aosDesktopWorldFramebufferProofRequestContract,
                "minimum_matches": minimumMatches,
                "maximum_matches": maximumMatches,
                "samples": normalizedSamples,
            ],
            sampleCount: samples.count
        )
    }

    private static func parseSegmentResult(
        _ value: [String: Any],
        expectedSampleCount: Int,
        index: Int
    ) -> AOSDesktopWorldFramebufferProofSegmentResult? {
        guard value["status"] as? String == "ok",
              integer(value["sample_count"]) == expectedSampleCount,
              let matchedCount = integer(value["matched_count"]),
              matchedCount >= 0,
              matchedCount <= expectedSampleCount,
              let passed = value["passed"] as? Bool,
              let duration = finiteDouble(value["render_duration_ms"]),
              duration >= 0,
              duration <= 1_000,
              value["pixels_returned"] as? Bool == false,
              value["pixels_persisted"] as? Bool == false,
              value["error_code"] is NSNull else { return nil }
        return AOSDesktopWorldFramebufferProofSegmentResult(
            index: index,
            sampleCount: expectedSampleCount,
            matchedCount: matchedCount,
            passed: passed,
            renderDurationMS: duration
        )
    }

    private static func byteVector(_ value: Any?) -> [Int]? {
        guard let entries = value as? [Any], entries.count == 4 else { return nil }
        let values = entries.compactMap(integer)
        guard values.count == 4, values.allSatisfy({ $0 >= 0 && $0 <= 255 }) else {
            return nil
        }
        return values
    }

    private static func integer(_ value: Any?) -> Int? {
        guard let number = value as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        let double = number.doubleValue
        guard double.isFinite,
              double.rounded(.towardZero) == double,
              double >= Double(Int.min),
              double <= Double(Int.max) else { return nil }
        return Int(double)
    }

    private static func uint64(_ value: Any?) -> UInt64? {
        guard let integer = integer(value), integer >= 0 else { return nil }
        return UInt64(integer)
    }

    private static func finiteDouble(_ value: Any?) -> Double? {
        guard let number = value as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue.isFinite else { return nil }
        return number.doubleValue
    }

    private static func errorCode(_ value: Any?, fallback: String) -> String {
        guard let code = value as? String,
              code.range(of: "^[A-Z][A-Z0-9_]{0,127}$", options: .regularExpression) != nil else {
            return fallback
        }
        return code
    }

    private static func failure(code: String, message: String) -> [String: Any] {
        ["error": message, "code": code]
    }
}
