import Foundation

let aosDesktopWorldDevToolsStageContract = "aos.desktop-world.devtools.stage.v2"

struct AOSDesktopWorldDevToolsStageSegmentIdentity: Equatable {
    let canvasGeneration: UInt64
    let topologyGeneration: UInt64
    let displayID: UInt32
    let index: Int
    let expectedIndexes: Set<Int>
}

enum AOSDesktopWorldDevToolsStageCommitResult: Equatable {
    case rejected
    case pending
    case committed
}

@propertyWrapper
private struct AOSDesktopWorldRequiredNullable<Value: Codable>: Codable {
    var wrappedValue: Value?

    init(wrappedValue: Value?) {
        self.wrappedValue = wrappedValue
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        wrappedValue = container.decodeNil() ? nil : try container.decode(Value.self)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        if let wrappedValue {
            try container.encode(wrappedValue)
        } else {
            try container.encodeNil()
        }
    }
}

private struct AOSDesktopWorldDevToolsStageSnapshot: Codable {
    struct Display: Codable, Equatable {
        let id: String
        let index: Int
        let bounds: [Double]
        let scaleFactor: Double
        let nativeBounds: [Double]?
    }

    struct Node: Codable {
        let id: String
        let resourceId: String
        @AOSDesktopWorldRequiredNullable var parentId: String?
        let kind: String
        @AOSDesktopWorldRequiredNullable var implementation: String?
        let position: [Double]
        let visible: Bool
    }

    struct HitRegion: Codable {
        let id: String
        let resourceId: String
        let affordanceId: String
        let frame: [Double]
        let registered: Bool
    }

    struct Affordance: Codable {
        let id: String
        let resourceId: String
        let objectId: String
        let enabled: Bool
        let priority: Int
    }

    struct Gesture: Codable {
        let id: String
        let resourceId: String
        let affordanceId: String
        let interactionId: String
        let kind: String
        let phase: String
        @AOSDesktopWorldRequiredNullable var pointerSessionId: String?
    }

    struct Route: Codable {
        let resourceId: String
        let kind: String
        let active: Bool
        let progress: Double
        let origin: [Double]
        let destination: [Double]
    }

    struct World: Codable {
        let displays: [Display]
        let nodes: [Node]
        let hitRegions: [HitRegion]
        let affordances: [Affordance]
        let gestures: [Gesture]
        let routes: [Route]
    }

    struct Allocations: Codable {
        let geometries: Int
        let materials: Int
        let textures: Int
        let programs: Int
    }

    struct Resource: Codable {
        let id: String
        let owner: String
        let sceneId: String
        let revision: Int
        let suspended: Bool
        let objectCount: Int
        let descriptorCount: Int
        let animationCount: Int
        let signalCount: Int
        let interactionCount: Int
        let implementations: [String]
        let allocations: Allocations
        let lifecycle: String
        @AOSDesktopWorldRequiredNullable var errorCode: String?
    }

    struct Interaction: Codable {
        let id: String
        let resourceId: String
        let owner: String
        let active: Bool
        let suspended: Bool
        let recognizers: [String]
        let regionCount: Int
        @AOSDesktopWorldRequiredNullable var errorCode: String?
    }

    struct Performance: Codable {
        let enabled: Bool
        let recording: Bool
        let sampleCount: Int
        @AOSDesktopWorldRequiredNullable var targetFps: Double?
        @AOSDesktopWorldRequiredNullable var budgetMs: Double?
        @AOSDesktopWorldRequiredNullable var currentFps: Double?
        @AOSDesktopWorldRequiredNullable var p95FrameMs: Double?
        @AOSDesktopWorldRequiredNullable var maxFrameMs: Double?
        @AOSDesktopWorldRequiredNullable var avgFrameMs: Double?
        @AOSDesktopWorldRequiredNullable var avgRenderMs: Double?
        @AOSDesktopWorldRequiredNullable var avgUpdateMs: Double?
        @AOSDesktopWorldRequiredNullable var avgGpuMs: Double?
        @AOSDesktopWorldRequiredNullable var drawCalls: Double?
        @AOSDesktopWorldRequiredNullable var triangles: Double?
        @AOSDesktopWorldRequiredNullable var geometries: Double?
        @AOSDesktopWorldRequiredNullable var textures: Double?
        @AOSDesktopWorldRequiredNullable var programs: Double?
        @AOSDesktopWorldRequiredNullable var backingPixels: Double?
        @AOSDesktopWorldRequiredNullable var backingWidth: Double?
        @AOSDesktopWorldRequiredNullable var backingHeight: Double?
        @AOSDesktopWorldRequiredNullable var damagedPixelPercentage: Double?
        @AOSDesktopWorldRequiredNullable var avgDamagedPixelPercentage: Double?
        @AOSDesktopWorldRequiredNullable var effectiveDevicePixelRatio: Double?
        @AOSDesktopWorldRequiredNullable var estimatedBackingBytes: Double?
        @AOSDesktopWorldRequiredNullable var msaaSamples: Double?
        @AOSDesktopWorldRequiredNullable var requestedDevicePixelRatio: Double?
        let state: String
    }

    struct DisplayPerformance: Codable {
        let displayId: String
        let displayIndex: Int
        let scope: String
        let performance: Performance
    }

    struct Event: Codable {
        let sequence: Int
        let kind: String
        @AOSDesktopWorldRequiredNullable var resourceId: String?
        @AOSDesktopWorldRequiredNullable var code: String?
        let at: Double
    }

    struct LastError: Codable {
        let code: String
        let at: Double
    }

    let contract: String
    let canvasGeneration: UInt64
    let topologyGeneration: UInt64
    let sequence: Int
    let status: String
    let world: World
    let resources: [Resource]
    let interactions: [Interaction]
    var displayPerformance: [DisplayPerformance]
    let counters: [String: Int]
    let events: [Event]
    @AOSDesktopWorldRequiredNullable var lastError: LastError?

    func isValid() -> Bool {
        guard contract == aosDesktopWorldDevToolsStageContract,
              (status == "unavailable" || (canvasGeneration > 0 && topologyGeneration > 0)),
              sequence >= 0,
              ["available", "unavailable", "unknown"].contains(status),
              world.displays.count <= 16,
              world.nodes.count <= 1_024,
              world.hitRegions.count <= 256,
              world.affordances.count <= 256,
              world.gestures.count <= 256,
              world.routes.count <= 32,
              resources.count <= 32,
              interactions.count <= 256,
              events.count <= 256,
              displayPerformance.count <= 16,
              Set(counters.keys) == Self.counterKeys,
              counters.values.allSatisfy({ $0 >= 0 && $0 <= 100_000 }),
              displayPerformance.allSatisfy({ Self.performanceIsValid($0.performance) }),
              lastError == nil || (Self.validString(lastError!.code, limit: 64)
                && lastError!.at.isFinite && lastError!.at >= 0) else { return false }
        guard world.displays.allSatisfy({
            Self.validString($0.id) && $0.bounds.count == 4 && $0.bounds.allSatisfy({ $0.isFinite })
                && $0.bounds[2] > 0 && $0.bounds[3] > 0 && $0.index >= 0 && $0.index <= 31
                && $0.scaleFactor.isFinite && $0.scaleFactor > 0 && $0.scaleFactor <= 4
                && ($0.nativeBounds.map({ bounds in
                    bounds.count == 4 && bounds.allSatisfy({ $0.isFinite })
                        && bounds[2] > 0 && bounds[3] > 0
                }) ?? true)
        }), world.nodes.allSatisfy({
            Self.validString($0.id) && Self.validString($0.resourceId)
                && $0.position.count == 3 && $0.position.allSatisfy({ $0.isFinite })
                && ($0.parentId == nil || Self.validString($0.parentId!))
                && Self.validString($0.kind, limit: 64)
                && ($0.implementation == nil || Self.validString($0.implementation!))
        }), world.hitRegions.allSatisfy({
            Self.validString($0.id) && Self.validString($0.resourceId)
                && Self.validString($0.affordanceId) && $0.frame.count == 4
                && $0.frame.allSatisfy({ $0.isFinite }) && $0.frame[2] > 0 && $0.frame[3] > 0
        }), world.affordances.allSatisfy({
            Self.validString($0.id) && Self.validString($0.resourceId)
                && Self.validString($0.objectId) && $0.priority >= 0 && $0.priority <= 1_000
        }), world.gestures.allSatisfy({
            Self.validString($0.id) && Self.validString($0.resourceId)
                && Self.validString($0.affordanceId) && Self.validString($0.interactionId)
                && Self.validString($0.kind, limit: 64) && Self.validString($0.phase, limit: 64)
                && ($0.pointerSessionId == nil || Self.validString($0.pointerSessionId!))
        }), world.routes.allSatisfy({
            Self.validString($0.resourceId) && ["line", "wormhole"].contains($0.kind)
                && $0.progress.isFinite && $0.progress >= 0 && $0.progress <= 1
                && $0.origin.count == 2 && $0.destination.count == 2
                && $0.origin.allSatisfy({ $0.isFinite }) && $0.destination.allSatisfy({ $0.isFinite })
        }) else { return false }
        guard Set(world.displays.map(\.index)).count == world.displays.count,
              Set(displayPerformance.map(\.displayIndex)).count == displayPerformance.count else { return false }
        let displayByIndex = Dictionary(uniqueKeysWithValues: world.displays.map { ($0.index, $0) })
        guard displayPerformance.allSatisfy({ entry in
            guard let display = displayByIndex[entry.displayIndex],
                  display.id == entry.displayId,
                  entry.scope == "stage-segment" else { return false }
            return Self.performance(entry.performance, matches: display)
        }), resources.allSatisfy({ resource in
            Self.validString(resource.id) && Self.validString(resource.owner)
                && Self.validString(resource.sceneId) && resource.revision >= 0
                && resource.implementations.count <= 128
                && resource.implementations.allSatisfy({ Self.validString($0) })
                && Self.validString(resource.lifecycle, limit: 32)
                && (resource.errorCode == nil || Self.validString(resource.errorCode!, limit: 64))
                && [resource.allocations.geometries, resource.allocations.materials,
                    resource.allocations.textures, resource.allocations.programs].allSatisfy({
                        $0 >= 0 && $0 <= 100_000
                    })
                && [resource.objectCount, resource.descriptorCount, resource.animationCount,
                    resource.signalCount, resource.interactionCount].allSatisfy({ $0 >= 0 && $0 <= 100_000 })
        }), interactions.allSatisfy({ interaction in
            Self.validString(interaction.id) && Self.validString(interaction.resourceId)
                && Self.validString(interaction.owner) && interaction.recognizers.count <= 32
                && interaction.recognizers.allSatisfy({ Self.validString($0) })
                && interaction.regionCount >= 0 && interaction.regionCount <= 256
                && (interaction.errorCode == nil || Self.validString(interaction.errorCode!, limit: 64))
        }), events.allSatisfy({ event in
            event.sequence >= 0 && Self.validString(event.kind, limit: 64)
                && (event.resourceId == nil || Self.validString(event.resourceId!))
                && (event.code == nil || Self.validString(event.code!, limit: 64))
                && event.at.isFinite && event.at >= 0
        }) else { return false }
        return true
    }

    private static let counterKeys = Set([
        "displays", "resources", "nodes", "hitRegions", "affordances",
        "activeGestures", "activeRoutes", "errors",
    ])

    private static func validString(_ value: String, limit: Int = 256) -> Bool {
        !value.isEmpty && value.utf8.count <= limit
    }

    private static func validMetric(_ value: Double?, maximum: Double = 1_000_000_000) -> Bool {
        value == nil || (value!.isFinite && value! >= 0 && value! <= maximum)
    }

    private static func validPositiveMetric(_ value: Double?, maximum: Double) -> Bool {
        value == nil || (value!.isFinite && value! > 0 && value! <= maximum)
    }

    private static func performanceIsValid(_ performance: Performance) -> Bool {
        performance.sampleCount >= 0
            && performance.sampleCount <= 240
            && ["hot", "idle", "stable", "warn"].contains(performance.state)
            && validMetric(performance.currentFps, maximum: 1_000)
            && validMetric(performance.targetFps, maximum: 1_000)
            && validMetric(performance.budgetMs)
            && validMetric(performance.p95FrameMs)
            && validMetric(performance.maxFrameMs)
            && validMetric(performance.avgFrameMs)
            && validMetric(performance.avgRenderMs)
            && validMetric(performance.avgUpdateMs)
            && validMetric(performance.avgGpuMs)
            && validMetric(performance.drawCalls)
            && validMetric(performance.triangles)
            && validMetric(performance.geometries)
            && validMetric(performance.textures)
            && validMetric(performance.programs)
            && validMetric(performance.backingPixels)
            && validMetric(performance.backingWidth)
            && validMetric(performance.backingHeight)
            && validMetric(performance.damagedPixelPercentage, maximum: 100)
            && validMetric(performance.avgDamagedPixelPercentage, maximum: 100)
            && validPositiveMetric(performance.effectiveDevicePixelRatio, maximum: 4)
            && validMetric(performance.estimatedBackingBytes, maximum: 1_000_000_000_000)
            && validMetric(performance.msaaSamples, maximum: 64)
            && validPositiveMetric(performance.requestedDevicePixelRatio, maximum: 4)
    }

    private static func performance(_ performance: Performance, matches display: Display) -> Bool {
        guard performance.sampleCount > 0 else { return true }
        guard let backingHeight = performance.backingHeight,
              let backingPixels = performance.backingPixels,
              let backingWidth = performance.backingWidth,
              let effectiveDPR = performance.effectiveDevicePixelRatio,
              let estimatedBackingBytes = performance.estimatedBackingBytes,
              let msaaSamples = performance.msaaSamples,
              let requestedDPR = performance.requestedDevicePixelRatio else { return false }
        let expectedWidth = (display.bounds[2] * display.scaleFactor).rounded()
        let expectedHeight = (display.bounds[3] * display.scaleFactor).rounded()
        let expectedPixels = expectedWidth * expectedHeight
        let resolvedBytes = expectedPixels * 8
        let expectedBytes = resolvedBytes + (msaaSamples > 1 ? resolvedBytes * msaaSamples : 0)
        return abs(requestedDPR - display.scaleFactor) <= 0.000_001
            && abs(effectiveDPR - display.scaleFactor) <= 0.000_001
            && backingWidth == expectedWidth
            && backingHeight == expectedHeight
            && backingPixels == expectedPixels
            && estimatedBackingBytes == expectedBytes
    }
}

struct AOSDesktopWorldDevToolsStageSnapshotAggregator {
    private enum SamplingClass: Hashable {
        case unsampled
        case sampled

        init(sampleCount: Int) {
            self = sampleCount == 0 ? .unsampled : .sampled
        }
    }

    private enum ReceiptRecordResult {
        case accepted
        case rejected
        case samplingClassMismatch
    }

    private struct Receipt {
        let canvasGeneration: UInt64
        let displays: [AOSDesktopWorldDevToolsStageSnapshot.Display]
        let expectedIndexes: Set<Int>
        let topologyGeneration: UInt64
        var primary: AOSDesktopWorldDevToolsStageSnapshot?
        var performanceByIndex: [Int: AOSDesktopWorldDevToolsStageSnapshot.DisplayPerformance] = [:]
        var sequenceByIndex: [Int: Int] = [:]

        var samplingClass: SamplingClass? {
            let classes = Set(performanceByIndex.values.map {
                SamplingClass(sampleCount: $0.performance.sampleCount)
            })
            return classes.count == 1 ? classes.first : nil
        }

        var isEmpty: Bool {
            performanceByIndex.isEmpty
        }

        init(
            _ snapshot: AOSDesktopWorldDevToolsStageSnapshot,
            identity: AOSDesktopWorldDevToolsStageSegmentIdentity
        ) {
            canvasGeneration = identity.canvasGeneration
            displays = snapshot.world.displays
            expectedIndexes = identity.expectedIndexes
            topologyGeneration = identity.topologyGeneration
        }

        func matches(
            _ snapshot: AOSDesktopWorldDevToolsStageSnapshot,
            identity: AOSDesktopWorldDevToolsStageSegmentIdentity
        ) -> Bool {
            identity.canvasGeneration == canvasGeneration
                && identity.topologyGeneration == topologyGeneration
                && identity.expectedIndexes == expectedIndexes
                && snapshot.canvasGeneration == canvasGeneration
                && snapshot.topologyGeneration == topologyGeneration
                && Set(snapshot.world.displays.map(\.index)) == expectedIndexes
                && snapshot.world.displays == displays
        }

        mutating func record(
            _ snapshot: AOSDesktopWorldDevToolsStageSnapshot,
            identity: AOSDesktopWorldDevToolsStageSegmentIdentity,
            rejectDuplicate: Bool,
            allowSamplingClassTransition: Bool = false,
            rejectSequenceRegression: Bool = false
        ) -> ReceiptRecordResult {
            guard matches(snapshot, identity: identity),
                  snapshot.displayPerformance.count == 1,
                  let entry = snapshot.displayPerformance.first,
                  entry.displayIndex == identity.index,
                  entry.displayId == String(identity.displayID),
                  displays.contains(where: {
                      $0.index == identity.index && $0.id == entry.displayId
                  }),
                  !rejectDuplicate || performanceByIndex[identity.index] == nil,
                  !rejectSequenceRegression
                    || sequenceByIndex[identity.index].map({ snapshot.sequence >= $0 }) != false else {
                return .rejected
            }
            if !allowSamplingClassTransition,
               let samplingClass,
               samplingClass != SamplingClass(sampleCount: entry.performance.sampleCount) {
                return .samplingClassMismatch
            }
            performanceByIndex[identity.index] = entry
            sequenceByIndex[identity.index] = snapshot.sequence
            if identity.index == 0 { primary = snapshot }
            return .accepted
        }

        mutating func remove(index: Int) {
            performanceByIndex.removeValue(forKey: index)
            sequenceByIndex.removeValue(forKey: index)
            if index == 0 { primary = nil }
        }

        func contains(index: Int) -> Bool {
            performanceByIndex[index] != nil
        }

        func hasSameIdentity(as other: Receipt) -> Bool {
            canvasGeneration == other.canvasGeneration
                && topologyGeneration == other.topologyGeneration
                && expectedIndexes == other.expectedIndexes
                && displays == other.displays
        }

        func strictlyPostdates(_ other: Receipt) -> Bool {
            guard hasSameIdentity(as: other),
                  Set(sequenceByIndex.keys) == expectedIndexes,
                  Set(other.sequenceByIndex.keys) == expectedIndexes else { return false }
            var advanced = false
            for index in expectedIndexes {
                guard let sequence = sequenceByIndex[index],
                      let otherSequence = other.sequenceByIndex[index],
                      sequence >= otherSequence else { return false }
                advanced = advanced || sequence > otherSequence
            }
            return advanced
        }

        func aggregate() -> AOSDesktopWorldDevToolsStageSnapshot? {
            guard var result = primary,
                  expectedIndexes.count == displays.count,
                  Set(performanceByIndex.keys) == expectedIndexes,
                  Set(sequenceByIndex.keys) == expectedIndexes,
                  samplingClass != nil else { return nil }
            result.displayPerformance = performanceByIndex.values.sorted {
                $0.displayIndex < $1.displayIndex
            }
            return result
        }
    }

    private struct RequestReceipt {
        let admissionOrder: UInt64
        var receipt: Receipt
    }

    private var currentReceipt: Receipt?
    private var pendingReceipt: Receipt?
    private var convergenceReceiptsByRequest: [String: RequestReceipt] = [:]
    private var receiptsByRequest: [String: RequestReceipt] = [:]
    private var nextRequestAdmissionOrder: UInt64 = 0

    mutating func discard(requestID: String) {
        convergenceReceiptsByRequest.removeValue(forKey: requestID)
        receiptsByRequest.removeValue(forKey: requestID)
    }

    mutating func record(
        _ raw: [String: Any],
        requestID: String?,
        segment: AOSDesktopWorldDevToolsStageSegmentIdentity?,
        requestIsPending: Bool
    ) -> (
        result: AOSDesktopWorldDevToolsStageCommitResult,
        snapshot: [String: Any]?,
        completedRequestIDs: Set<String>
    ) {
        guard JSONSerialization.isValidJSONObject(raw),
              let input = try? JSONSerialization.data(withJSONObject: raw),
              input.count <= 512 * 1_024,
              let decoded = try? JSONDecoder().decode(AOSDesktopWorldDevToolsStageSnapshot.self, from: input),
              decoded.isValid() else { return (.rejected, nil, []) }
        guard requestID == nil || requestIsPending else { return (.rejected, nil, []) }

        let aggregate: AOSDesktopWorldDevToolsStageSnapshot?
        var completedRequestIDs: Set<String> = []
        if let segment {
            if let requestID {
                if var requestReceipt = convergenceReceiptsByRequest[requestID] {
                    guard !requestReceipt.receipt.contains(index: segment.index),
                          case .accepted = requestReceipt.receipt.record(
                            decoded,
                            identity: segment,
                            rejectDuplicate: true,
                            allowSamplingClassTransition: true
                          ) else { return (.rejected, nil, []) }
                    convergenceReceiptsByRequest[requestID] = requestReceipt
                    return (.pending, nil, [])
                }

                var requestReceipt: RequestReceipt
                if let existing = receiptsByRequest[requestID] {
                    requestReceipt = existing
                } else {
                    guard nextRequestAdmissionOrder < UInt64.max else {
                        return (.rejected, nil, [])
                    }
                    nextRequestAdmissionOrder += 1
                    requestReceipt = RequestReceipt(
                        admissionOrder: nextRequestAdmissionOrder,
                        receipt: Receipt(decoded, identity: segment)
                    )
                }
                switch requestReceipt.receipt.record(
                    decoded,
                    identity: segment,
                    rejectDuplicate: true
                ) {
                case .accepted:
                    break
                case .samplingClassMismatch:
                    receiptsByRequest.removeValue(forKey: requestID)
                    guard case .accepted = requestReceipt.receipt.record(
                        decoded,
                        identity: segment,
                        rejectDuplicate: true,
                        allowSamplingClassTransition: true
                    ) else { return (.rejected, nil, []) }
                    convergenceReceiptsByRequest[requestID] = requestReceipt
                    return (.pending, nil, [])
                case .rejected:
                    receiptsByRequest.removeValue(forKey: requestID)
                    return (.rejected, nil, [])
                }
                receiptsByRequest[requestID] = requestReceipt
                aggregate = requestReceipt.receipt.aggregate()
                if aggregate != nil {
                    receiptsByRequest.removeValue(forKey: requestID)
                    currentReceipt = requestReceipt.receipt
                    pendingReceipt = nil
                }
            } else {
                guard decoded.displayPerformance.count == 1,
                      let entry = decoded.displayPerformance.first else {
                    return (.rejected, nil, [])
                }
                let incomingSamplingClass = SamplingClass(
                    sampleCount: entry.performance.sampleCount
                )

                for candidateRequestID in Array(convergenceReceiptsByRequest.keys) {
                    guard var requestReceipt = convergenceReceiptsByRequest[candidateRequestID],
                          requestReceipt.receipt.contains(index: segment.index),
                          requestReceipt.receipt.matches(decoded, identity: segment) else { continue }
                    switch requestReceipt.receipt.record(
                        decoded,
                        identity: segment,
                        rejectDuplicate: false,
                        allowSamplingClassTransition: true,
                        rejectSequenceRegression: true
                    ) {
                    case .accepted:
                        convergenceReceiptsByRequest[candidateRequestID] = requestReceipt
                    case .rejected, .samplingClassMismatch:
                        continue
                    }
                }

                let convergedRequests = convergenceReceiptsByRequest.compactMap {
                    requestID, requestReceipt in
                    requestReceipt.receipt.matches(decoded, identity: segment)
                        && requestReceipt.receipt.aggregate() != nil
                        ? (requestID: requestID, requestReceipt: requestReceipt)
                        : nil
                }
                let selectedRequest = convergedRequests.max {
                    $0.requestReceipt.admissionOrder < $1.requestReceipt.admissionOrder
                }
                let selectedCanPublish = selectedRequest.map { selected in
                    guard let currentReceipt,
                          currentReceipt.hasSameIdentity(as: selected.requestReceipt.receipt) else {
                        return true
                    }
                    return selected.requestReceipt.receipt.strictlyPostdates(currentReceipt)
                } ?? false

                if let selectedRequest, selectedCanPublish {
                    completedRequestIDs.insert(selectedRequest.requestID)
                    for candidate in convergedRequests where
                        candidate.requestReceipt.admissionOrder
                            < selectedRequest.requestReceipt.admissionOrder
                        && selectedRequest.requestReceipt.receipt.strictlyPostdates(
                            candidate.requestReceipt.receipt
                        ) {
                        completedRequestIDs.insert(candidate.requestID)
                    }
                    for completedRequestID in completedRequestIDs {
                        convergenceReceiptsByRequest.removeValue(forKey: completedRequestID)
                    }
                    currentReceipt = selectedRequest.requestReceipt.receipt
                    pendingReceipt = nil
                    aggregate = selectedRequest.requestReceipt.receipt.aggregate()
                } else if var currentReceipt,
                   currentReceipt.matches(decoded, identity: segment),
                   currentReceipt.samplingClass == incomingSamplingClass {
                    guard case .accepted = currentReceipt.record(
                        decoded,
                        identity: segment,
                        rejectDuplicate: false
                    ) else { return (.rejected, nil, []) }
                    self.currentReceipt = currentReceipt
                    if var pendingReceipt,
                       pendingReceipt.matches(decoded, identity: segment) {
                        pendingReceipt.remove(index: segment.index)
                        self.pendingReceipt = pendingReceipt.isEmpty ? nil : pendingReceipt
                    }
                    aggregate = currentReceipt.aggregate()
                } else {
                    var receipt: Receipt
                    if let pendingReceipt,
                       pendingReceipt.matches(decoded, identity: segment),
                       pendingReceipt.samplingClass == incomingSamplingClass {
                        receipt = pendingReceipt
                    } else {
                        receipt = Receipt(decoded, identity: segment)
                    }
                    guard case .accepted = receipt.record(
                        decoded,
                        identity: segment,
                        rejectDuplicate: false
                    ) else {
                        return (.rejected, nil, [])
                    }
                    pendingReceipt = receipt
                    aggregate = receipt.aggregate()
                    if aggregate != nil {
                        currentReceipt = receipt
                        pendingReceipt = nil
                    }
                }
            }
        } else {
            let expected = Set(decoded.world.displays.map(\.index))
            guard decoded.displayPerformance.count == decoded.world.displays.count,
                  Set(decoded.displayPerformance.map(\.displayIndex)) == expected,
                  Set(decoded.displayPerformance.map {
                      SamplingClass(sampleCount: $0.performance.sampleCount)
                  }).count <= 1 else {
                return (.rejected, nil, [])
            }
            aggregate = decoded
            currentReceipt = nil
            pendingReceipt = nil
        }

        guard let aggregate else { return (.pending, nil, []) }
        guard let data = try? JSONEncoder().encode(aggregate),
              data.count <= 512 * 1_024,
              let canonical = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return (.rejected, nil, [])
        }
        return (.committed, canonical, completedRequestIDs)
    }
}
