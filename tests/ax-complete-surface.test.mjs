import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const sources = [
  'src/perceive/ax-value-codec.swift',
  'src/perceive/ax-snapshot-store.swift',
  'src/perceive/ax-observation-engine.swift',
].map((relative) => path.join(repoRoot, relative));
const schemaPath = path.join(repoRoot, 'shared/schemas/aos-ax-observation-v1.schema.json');

const corpusGeneration = { pid: 100, start_time_seconds: 10, start_time_microseconds: 1 };
const corpusBounds = {
  max_depth: 1,
  max_visited: 1,
  max_emitted: 1,
  deadline_nanoseconds: 1,
  max_array_depth: 1,
  max_array_items: 1,
  max_value_cost: 1,
};
const corpusRequest = (overrides = {}) => ({
  schema_version: 'aos.ax-observation.v1',
  kind: 'request',
  root: { kind: 'system_wide' },
  bounds: corpusBounds,
  filters: [],
  projection: {
    attributes: false,
    parameterized_attribute_names: false,
    settable_facts: false,
    supported_action_names: false,
    relationship_names: false,
  },
  page_size: 1,
  ...overrides,
});
const corpusPageRequest = (overrides = {}) => ({
  schema_version: 'aos.ax-observation.v1', kind: 'page_request', token: 'token.signature',
  expected_state_id: 'state', request_digest: '0'.repeat(64), projection_digest: '1'.repeat(64),
  page_size: 1, ...overrides,
});
const requestAdmissionCorpus = [
  { definition: 'observation_request', valid: true, value: corpusRequest({ bounds: { ...corpusBounds, max_emitted: 2 } }) },
  { definition: 'observation_request', valid: true, value: corpusRequest({ filters: [
    { raw_attribute_outcomes: [{ name: 'Title', outcome: 'value' }] },
    { raw_attribute_outcomes: [{ name: 'Role', outcome: 'no_value' }] },
  ] }) },
  { definition: 'observation_request', valid: true, value: corpusRequest({ root: {
    kind: 'display_composite', topology_identity: 'topology', applications: [corpusGeneration, corpusGeneration],
  } }) },
  { definition: 'observation_request', valid: false, value: corpusRequest({ surplus: true }) },
  { definition: 'observation_request', valid: false, value: corpusRequest({ root: { kind: 'system_wide', generation: corpusGeneration } }) },
  { definition: 'observation_request', valid: false, value: corpusRequest({ root: { kind: 'application', generation: { ...corpusGeneration, surplus: true } } }) },
  { definition: 'observation_request', valid: false, value: corpusRequest({ root: { kind: 'application', generation: { ...corpusGeneration, start_time_microseconds: 1_000_000 } } }) },
  { definition: 'observation_request', valid: false, value: corpusRequest({ bounds: { ...corpusBounds, surplus: true } }) },
  { definition: 'observation_request', valid: false, value: corpusRequest({ projection: { ...corpusRequest().projection, surplus: true } }) },
  { definition: 'observation_request', valid: false, value: corpusRequest({ filters: [{ geometry: { intersects: { x: 0, y: 0, width: 1, height: 1 }, surplus: true } }] }) },
  { definition: 'observation_request', valid: false, value: corpusRequest({ filters: [{ geometry: { intersects: { x: 0, y: 0, width: 1, height: 1, surplus: true } } }] }) },
  { definition: 'observation_request', valid: false, value: corpusRequest({ filters: [{ raw_attribute_outcomes: [{ name: 'Title', outcome: 'value', surplus: true }] }] }) },
  { definition: 'observation_request', valid: false, value: corpusRequest({ filters: [{ role: 'AXButton', surplus: true }] }) },
  { definition: 'observation_request', valid: false, value: corpusRequest({ filters: [{ raw_attribute_outcomes: Array.from({ length: 4_097 }, (_, index) => ({ name: `Attr${index}`, outcome: 'value' })) }] }) },
  { definition: 'page_request', valid: false, value: corpusPageRequest({ surplus: true }) },
];
const requestAdmissionCorpusJSON = JSON.stringify(requestAdmissionCorpus.map(({ definition, valid, value }) => ({
  definition, valid,
  json: JSON.stringify(value),
})));

const harness = String.raw`
import Foundation

private extension NSLock {
    func held<T>(_ body: () -> T) -> T {
        lock()
        defer { unlock() }
        return body()
    }
}

final class FakeClock: @unchecked Sendable {
    private let lock = NSLock()
    private var value: UInt64
    init(_ value: UInt64 = 1_000) { self.value = value }
    func read() -> UInt64 { lock.held { value } }
    func advance(_ amount: UInt64) { lock.held { value &+= amount } }
}

final class IdentityFactory: @unchecked Sendable {
    private let lock = NSLock()
    private var counters: [String: Int] = [:]
    func next(_ prefix: String) -> String {
        lock.held {
            let next = (counters[prefix] ?? 0) + 1
            counters[prefix] = next
            return "\(prefix)-\(next)"
        }
    }
}

final class FakeGenerationObserver: @unchecked Sendable, AOSAXProcessGenerationObserving {
    private let lock = NSLock()
    let clock: FakeClock
    var generations: [Int32: AOSAXProcessGeneration]
    var changeAfterFirst: Set<Int32> = []
    var unavailableAfterFirst: Set<Int32> = []
    var advanceAfterFinal: [Int32: UInt64] = [:]
    private var counts: [Int32: Int] = [:]

    init(_ generations: [Int32: AOSAXProcessGeneration], clock: FakeClock) {
        self.generations = generations
        self.clock = clock
    }

    func observeGeneration(pid: Int32) -> AOSAXGenerationObservation {
        let result: (Int, AOSAXGenerationObservation) = lock.held {
            let count = (counts[pid] ?? 0) + 1
            counts[pid] = count
            guard let generation = generations[pid] else {
                return (count, .unavailable(.init(code: "AX_PROCESS_MISSING", detail: "fake process is absent")))
            }
            if unavailableAfterFirst.contains(pid), count > 1 {
                return (count, .unavailable(.init(code: "AX_FINAL_UNAVAILABLE_\(pid)", detail: "fake final generation is unavailable")))
            }
            if changeAfterFirst.contains(pid), count > 1 {
                return (count, .value(try! .init(
                    pid: generation.pid,
                    startTimeSeconds: generation.startTimeSeconds + 1,
                    startTimeMicroseconds: generation.startTimeMicroseconds
                )))
            }
            return (count, .value(generation))
        }
        if result.0 > 1, let advance = advanceAfterFinal[pid] { clock.advance(advance) }
        return result.1
    }
}

final class FakeProvider: @unchecked Sendable, AOSAXPlatformProvider {
    typealias Handle = Int
    private let lock = NSLock()
    let clock: FakeClock
    var advancePerCall: UInt64 = 0
    var systemUnsupported = false
    var unavailableApplications: Set<Int32> = []
    var attributeUnavailable = false
    var parameterizedUnsupported = false
    var actionUnavailable = false
    var relationshipPlatformError = false
    var rootError: AOSAXPlatformError?
    var rollbackAttribute = false
    var queuedValueRefAttribute = false
    var frontierStress = false
    var oversizedFacts = false
    var duplicateAttributeNames = false
    var duplicateRelationshipNames = false
    var duplicateRelationshipHandle: Int?
    var scalarDistinctRelationshipNames = false
    var titleOnlyAttributeNames = false
    var advanceAfterAttribute: [String: UInt64] = [:]
    var advanceAfterSettable: [String: UInt64] = [:]
    var onRelease: (@Sendable () -> Void)?
    var forbiddenAtOrAfter: UInt64?
    private var calls = 0
    private var retains = 0
    private var releases = 0
    private var lateCalls = 0
    private var lateRetains = 0
    private var settableCalls: [String] = []

    init(clock: FakeClock) { self.clock = clock }

    private func called() {
        let now = clock.read()
        lock.held {
            calls += 1
            if let forbiddenAtOrAfter, now >= forbiddenAtOrAfter { lateCalls += 1 }
        }
        if advancePerCall > 0 { clock.advance(advancePerCall) }
    }

    func callCount() -> Int { lock.held { calls } }
    func retainCount() -> Int { lock.held { retains } }
    func releaseCount() -> Int { lock.held { releases } }
    func lateCallCount() -> Int { lock.held { lateCalls } }
    func lateRetainCount() -> Int { lock.held { lateRetains } }
    func settableCallNames() -> [String] { lock.held { settableCalls } }

    func systemWideRoot(deadlineNanoseconds: UInt64) -> AOSAXPlatformResult<Int> {
        called()
        if let rootError { return .platformError(rootError) }
        if systemUnsupported {
            return .unsupported(.init(code: "AX_SYSTEM_UNSUPPORTED", detail: "fake unsupported root"))
        }
        return .value(1)
    }

    func applicationRoot(
        generation: AOSAXProcessGeneration,
        deadlineNanoseconds: UInt64
    ) -> AOSAXPlatformResult<Int> {
        called()
        if unavailableApplications.contains(generation.pid) {
            return .unavailable(.init(code: "AX_APPLICATION_UNAVAILABLE", detail: "fake unavailable app"))
        }
        switch generation.pid {
        case 100: return .value(2)
        case 200: return .value(6)
        case 300: return .value(9)
        default: return .unavailable(.init(code: "AX_APPLICATION_MISSING", detail: "fake missing app"))
        }
    }

    func windowRoot(
        generation: AOSAXProcessGeneration,
        windowID: UInt64,
        deadlineNanoseconds: UInt64
    ) -> AOSAXPlatformResult<Int> {
        called()
        return windowID == 10
            ? .value(3)
            : .unavailable(.init(code: "AX_WINDOW_MISSING", detail: "fake missing window"))
    }

    func facts(for handle: Int, deadlineNanoseconds: UInt64) -> AOSAXPlatformResult<AOSAXElementFacts> {
        called()
        if oversizedFacts {
            return .value(.init(role: String(repeating: "x", count: 513)))
        }
        let role: String
        switch handle {
        case 1: role = "AXSystemWide"
        case 2, 6: role = "AXApplication"
        case 3: role = "AXWindow"
        case 4: role = "AXButton"
        default: role = "AXStaticText"
        }
        return .value(.init(
            role: role,
            identifier: "id-\(handle)",
            title: "title-\(handle)",
            frame: .init(x: Double(handle), y: 1, width: 10, height: 10),
            enabled: true,
            focused: handle == 4,
            selected: false
        ))
    }

    func relationships(
        for handle: Int,
        deadlineNanoseconds: UInt64,
        maximumNames: Int,
        maximumResultItems: Int
    ) -> AOSAXPlatformResult<AOSAXPlatformRelationshipBatch<Int>> {
        called()
        if scalarDistinctRelationshipNames, handle == 1 {
            return .value(.init(relationships: [
                .init(name: "\u{00E9}", elements: [3]),
                .init(name: "e\u{0301}", elements: [4]),
            ]))
        }
        if (duplicateRelationshipNames && handle == 1) || duplicateRelationshipHandle == handle {
            return .value(.init(relationships: [
                .init(name: "Children", elements: [3]),
                .init(name: "Children", elements: [4]),
            ]))
        }
        if queuedValueRefAttribute, handle == 3 {
            return .value(.init(relationships: [], frontier: [
                .init(name: "Deferred", nextChildPosition: 0, remainingCount: 1),
            ]))
        }
        if relationshipPlatformError {
            return .platformError(.init(code: "AX_FAKE_RELATIONSHIP", detail: "fake relationship failure"))
        }
        if frontierStress, handle == 1 {
            let admittedCost = max(0, maximumResultItems - maximumNames)
            guard maximumNames >= 1, admittedCost >= 4 else {
                return .platformError(.init(code: "AX_FAKE_FRONTIER_BOUND", detail: "fake frontier stress exceeded admission"))
            }
            return .value(.init(
                relationships: [.init(name: "AChildren", elements: [3])],
                frontier: [
                    .init(name: "BChildren", nextChildPosition: 0, remainingCount: 2),
                    .init(name: "ZChildren", nextChildPosition: 0, remainingCount: 2),
                ]
            ))
        }
        let relationships: [AOSAXPlatformRelationship<Int>]
        switch handle {
        case 1:
            relationships = [
                .init(name: "ZChildren", elements: [4, 5]),
                .init(name: "AChildren", elements: [3, 5]),
            ]
        case 3:
            relationships = [.init(name: "Parent", elements: [1])]
        case 4:
            relationships = [.init(name: "VisitedSibling", elements: [5])]
        case 6:
            relationships = [.init(name: "Children", elements: [7])]
        case 7:
            relationships = [.init(name: "Children", elements: [8])]
        default:
            relationships = []
        }
        guard relationships.count <= maximumNames else {
            return .platformError(.init(code: "AX_FAKE_NAME_BOUND", detail: "fake relationship names exceeded admission"))
        }
        let admittedCost = max(0, maximumResultItems - maximumNames)
        let fullCost = relationships.count + relationships.reduce(0) { $0 + $1.elements.count }
        if fullCost <= admittedCost {
            return .value(.init(relationships: relationships))
        }
        let remainder = relationships.filter { !$0.elements.isEmpty }.map {
            AOSAXPlatformRelationshipFrontier(name: $0.name, nextChildPosition: 0, remainingCount: $0.elements.count)
        }
        return .value(.init(relationships: [], frontier: remainder))
    }

    func attributeNames(for handle: Int, deadlineNanoseconds: UInt64) -> AOSAXPlatformResult<[String]> {
        called()
        if titleOnlyAttributeNames { return .value(["Title"]) }
        if duplicateAttributeNames { return .value(["Title", "Title"]) }
        if rollbackAttribute { return .value(["RollbackArray"]) }
        if queuedValueRefAttribute {
            return .value(handle == 3 ? ["QueuedElement"] : [])
        }
        if handle != 1 { return .value(["Title", "NoValue", "Unsupported", "Error"]) }
        return .value([
            "URL", "Unsigned", "String", "Size", "Signed", "Rect", "Range", "Point",
            "Null", "Float", "Element", "Dictionary", "Date", "Data", "Boolean", "Array",
            "Unknown", "DeepArray", "BigArray", "BadDictionary", "NoValue", "Unsupported", "Error",
        ])
    }

    func attribute(
        _ name: String,
        for handle: Int,
        deadlineNanoseconds: UInt64
    ) -> AOSAXAttributeRead<Int> {
        called()
        defer {
            if let advance = advanceAfterAttribute[name] { clock.advance(advance) }
        }
        switch name {
        case "RollbackArray": return .value(.array([.element(99), .unknownType("late failure")]))
        case "QueuedElement": return .value(.element(5))
        case "Boolean": return .value(.boolean(true))
        case "Signed": return .value(.signedInteger(-4))
        case "Unsigned": return .value(.unsignedInteger(4))
        case "Float": return .value(.floatingPoint(1.5))
        case "String", "Title", "Secret", "ZuluSecret": return .value(.string("value-\(handle)"))
        case "Data": return .value(.data(Data([1, 2, 3])))
        case "Date": return .value(.date(Date(timeIntervalSince1970: 1_700_000_000)))
        case "URL": return .value(.url(URL(string: "https://example.invalid/fake")!))
        case "Point": return .value(.point(.init(x: 1, y: 2)))
        case "Size": return .value(.size(.init(width: 3, height: 4)))
        case "Rect": return .value(.rect(.init(x: 1, y: 2, width: 3, height: 4)))
        case "Range": return .value(.range(.init(location: 2, length: 3)))
        case "Element": return .value(.element(4))
        case "Array": return .value(.array([.string("first"), .signedInteger(2)]))
        case "Dictionary":
            return .value(.dictionary([
                .init(key: .string("z"), value: .signedInteger(2)),
                .init(key: .string("a"), value: .signedInteger(1)),
            ]))
        case "DeepArray": return .value(.array([.array([.array([.string("deep")])])]))
        case "BigArray": return .value(.array((0..<8).map { .signedInteger(Int64($0)) }))
        case "BadDictionary":
            return .value(.dictionary([.init(key: .unsupported("number"), value: .null)]))
        case "Null": return .value(.null)
        case "Unknown": return .value(.unknownType("FakeUnknown"))
        case "NoValue": return .noValue
        case "Unsupported": return .unsupported
        case "Error":
            return attributeUnavailable
                ? .unavailable(.init(code: "AX_FAKE_READ_UNAVAILABLE", detail: "fake unavailable read"))
                : .platformError(.init(code: "AX_FAKE_READ", detail: "fake read error"))
        default: return .unsupported
        }
    }

    func parameterizedAttributeNames(
        for handle: Int,
        deadlineNanoseconds: UInt64
    ) -> AOSAXPlatformResult<[String]> {
        called()
        if parameterizedUnsupported {
            return .unsupported(.init(code: "AX_FAKE_PARAMETERIZED_UNSUPPORTED", detail: "fake parameterized unsupported"))
        }
        return .value(["ZParameterized", "AParameterized"])
    }

    func isAttributeSettable(
        _ name: String,
        for handle: Int,
        deadlineNanoseconds: UInt64
    ) -> AOSAXPlatformSettableResult {
        called()
        lock.held { settableCalls.append(name) }
        defer {
            if let advance = advanceAfterSettable[name] { clock.advance(advance) }
        }
        if name == "Error" { return .platformError(.init(code: "AX_FAKE_SETTABLE", detail: "fake settable error")) }
        if name == "Unsupported" { return .unsupported }
        return .value(name == "Title")
    }

    func supportedActionNames(
        for handle: Int,
        deadlineNanoseconds: UInt64
    ) -> AOSAXPlatformResult<[String]> {
        called()
        if actionUnavailable {
            return .unavailable(.init(code: "AX_FAKE_ACTION_UNAVAILABLE", detail: "fake action unavailable"))
        }
        return .value(["AXRaise", "AXPress"])
    }

    func retain(handle: Int) {
        let now = clock.read()
        lock.held {
            retains += 1
            if let forbiddenAtOrAfter, now >= forbiddenAtOrAfter { lateRetains += 1 }
        }
    }
    func release(handle: Int) {
        let callback = lock.held { () -> (@Sendable () -> Void)? in
            releases += 1
            return onRelease
        }
        callback?()
    }
}

final class Harness: @unchecked Sendable {
    let clock: FakeClock
    let ids = IdentityFactory()
    let provider: FakeProvider
    let generations: FakeGenerationObserver
    let retention: AOSAXRetentionConfiguration
    let store: AOSAXSnapshotStore<Int>
    let engine: AOSAXObservationEngine<FakeProvider>

    init(
        ttl: UInt64 = 10_000,
        maxSnapshots: Int = 64,
        maxRefs: Int = 512,
        maxValueCost: Int = 100_000,
        maxTokens: Int = 128,
        maxTombstones: Int = 256,
        maxBorrows: Int = 64,
        clockStart: UInt64 = 1_000,
        limitVisited: Int = 64,
        limitEmitted: Int? = nil,
        limitPageSize: Int = 64,
        limitArrayItems: Int = 64,
        invalidTokenIdentities: Bool = false,
        tokenIdentity: AOSAXPageTokenIdentity? = nil,
        cancelAfterBorrow: Bool = false
    ) {
        clock = FakeClock(clockStart)
        let gen100 = try! AOSAXProcessGeneration(pid: 100, startTimeSeconds: 10, startTimeMicroseconds: 1)
        let gen200 = try! AOSAXProcessGeneration(pid: 200, startTimeSeconds: 20, startTimeMicroseconds: 2)
        let gen300 = try! AOSAXProcessGeneration(pid: 300, startTimeSeconds: 30, startTimeMicroseconds: 3)
        provider = FakeProvider(clock: clock)
        generations = FakeGenerationObserver([100: gen100, 200: gen200, 300: gen300], clock: clock)
        retention = try! AOSAXRetentionConfiguration(
            snapshotTTLNanoseconds: ttl,
            maxSnapshots: maxSnapshots,
            maxRetainedRefs: maxRefs,
            maxRetainedValueCost: maxValueCost,
            maxPageTokens: maxTokens,
            maxTombstones: maxTombstones,
            maxActiveBorrows: maxBorrows
        )
        let limits = try! AOSAXObservationLimits(
            maxDepth: 8,
            maxVisited: min(limitVisited, maxRefs),
            maxEmitted: min(limitEmitted ?? limitVisited, min(limitVisited, maxRefs)),
            maxDeadlineNanoseconds: 1_000,
            maxArrayDepth: 8,
            maxArrayItems: limitArrayItems,
            maxValueCost: min(100_000, maxValueCost),
            maxPageSize: min(limitPageSize, maxRefs),
            maxFilters: 64,
            maxCompositeApplications: 64
        )
        store = AOSAXSnapshotStore(
            configuration: try! .init(retention: retention, observationLimits: limits),
            monotonicClock: { [clock] in clock.read() },
            wallClock: { Date(timeIntervalSince1970: 1_700_000_000) },
            tokenFactory: { [ids] in
                if let tokenIdentity { return tokenIdentity }
                if invalidTokenIdentities {
                    return .init(lookupID: "invalid.lookup", publicToken: "invalid")
                }
                let lookup = ids.next("token")
                return .init(lookupID: lookup, publicToken: "\(lookup).\(ids.next("signature"))")
            }
        )
        engine = AOSAXObservationEngine(
            provider: provider,
            generationObserver: generations,
            store: store,
            stateIDFactory: { [ids] in ids.next("state") },
            refIDFactory: { [ids] in ids.next("ref") },
            cancellationObserver: { [store] in cancelAfterBorrow && store.activeBorrows() > 0 }
        )
    }

    func enableReleaseReentry() {
        let observedStore = store
        provider.onRelease = { [weak observedStore] in
            _ = observedStore?.retainedCounts()
        }
    }
}

func bounds(
    depth: Int = 8,
    visited: Int = 64,
    emitted: Int? = nil,
    deadline: UInt64 = 1_000,
    arrayDepth: Int = 8,
    arrayItems: Int = 64,
    valueCost: Int = 100_000
) -> AOSAXObservationBounds {
    try! .init(
        maxDepth: depth,
        maxVisited: visited,
        maxEmitted: emitted ?? visited,
        deadlineNanoseconds: deadline,
        maxArrayDepth: arrayDepth,
        maxArrayItems: arrayItems,
        maxValueCost: valueCost
    )
}

func request(
    _ root: AOSAXObservationRoot,
    bounds requestBounds: AOSAXObservationBounds = bounds(),
    filters: [AOSAXObservationFilter] = [],
    projection: AOSAXProjectionSelection = .init(),
    pageSize: Int = 2
) -> AOSAXObservationRequest {
    try! .init(root: root, bounds: requestBounds, filters: filters, projection: projection, pageSize: pageSize)
}

func emit<T: Encodable>(_ value: T) {
    let data = try! AOSAXObservationJSON.encode(value)
    print(String(decoding: data, as: UTF8.self))
}

func attribute(_ name: String, in node: AOSAXNodeProjection) -> AOSAXAttributeProjection {
    guard let value = node.attributes?.first(where: { $0.name == name }) else {
        fatalError("missing attribute \(name) in \(node.attributes?.map(\.name) ?? [])")
    }
    return value
}

func tamperedAuthenticator(_ token: String) -> String {
    let replacement = token.last == "x" ? "y" : "x"
    return String(token.dropLast()) + replacement
}

final class ResponseBox: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [AOSAXObservationResponse] = []
    func append(_ value: AOSAXObservationResponse) { lock.held { values.append(value) } }
    func snapshot() -> [AOSAXObservationResponse] { lock.held { values } }
}

struct RequestAdmissionCorpusEntry: Decodable {
    let definition: String
    let valid: Bool
    let json: String
}

func run() {
    let primary = Harness()
    let baseRequest = request(.systemWide, pageSize: 2)
    emit(baseRequest)
    let base = try! primary.engine.observe(baseRequest)
    emit(base)
    if base.outcome != .complete {
        fatalError("base outcome \(base.outcome) stop \(base.stopCondition.kind) frontier \(base.frontier)")
    }
    if base.accounting.visited != 4 {
        fatalError("base accounting \(base.accounting) nodes \(base.nodes.map(\.facts.identifier)) frontier \(base.frontier)")
    }
    if base.accounting.emitted != 4 || base.accounting.cycleEdges != 1 || base.accounting.duplicateEdges != 2 {
        fatalError("unexpected base accounting \(base.accounting)")
    }
    precondition(base.nodes.count == 2)
    precondition(base.nextPageToken != nil)
    precondition(base.retention.pageSize == 2)
    let root = base.nodes[0]
    precondition(root.referenceEdges.count == 1)
    precondition(root.referenceEdges[0].relationshipName == "ZChildren")
    precondition(root.referenceEdges[0].childPosition == 1)
    precondition(root.referenceEdges[0].kind == .duplicate)
    precondition(root.relationshipNames == ["AChildren", "ZChildren"])
    precondition(root.parameterizedAttributeNames == ["AParameterized", "ZParameterized"])
    precondition(root.supportedActionNames == ["AXPress", "AXRaise"])
    precondition(attribute("NoValue", in: root).outcome == .noValue)
    precondition(attribute("Unsupported", in: root).outcome == .unsupported)
    precondition(attribute("Error", in: root).outcome == .platformError)
    precondition(attribute("DeepArray", in: root).outcome == .value)
    precondition(attribute("BigArray", in: root).outcome == .value)
    precondition(attribute("Unknown", in: root).outcome == .unrepresentableType)
    precondition(attribute("BadDictionary", in: root).outcome == .unrepresentableType)
    if case .dictionary(let entries) = attribute("Dictionary", in: root).value! {
        precondition(entries.map(\.key) == ["a", "z"])
    } else { preconditionFailure("expected dictionary") }

    let providerCallsBeforePages = primary.provider.callCount()
    let firstToken = base.nextPageToken!
    let tampered = primary.engine.page(
        token: firstToken + "x",
        expectedStateID: base.stateID,
        requestDigest: base.requestDigest,
        projectionDigest: base.projectionDigest,
        pageSize: 2
    )
    precondition(tampered.error?.kind == .tokenTampered)
    emit(tampered)
    let digestMismatch = primary.engine.page(
        token: firstToken,
        expectedStateID: base.stateID,
        requestDigest: String(repeating: "0", count: 64),
        projectionDigest: base.projectionDigest,
        pageSize: 2
    )
    precondition(digestMismatch.error?.kind == .requestDigestMismatch)
    emit(digestMismatch)
    let stateMismatch = primary.engine.page(
        token: firstToken,
        expectedStateID: "state-other",
        requestDigest: base.requestDigest,
        projectionDigest: base.projectionDigest,
        pageSize: 2
    )
    precondition(stateMismatch.error?.kind == .stateMismatch)
    emit(stateMismatch)
    let sizeMismatch = primary.engine.page(
        token: firstToken,
        expectedStateID: base.stateID,
        requestDigest: base.requestDigest,
        projectionDigest: base.projectionDigest,
        pageSize: 1
    )
    precondition(sizeMismatch.error?.kind == .pageSizeMismatch)
    emit(sizeMismatch)
    let firstPageRequest = try! AOSAXPageRequest(
        token: firstToken,
        expectedStateID: base.stateID,
        requestDigest: base.requestDigest,
        projectionDigest: base.projectionDigest,
        pageSize: 2
    )
    emit(firstPageRequest)
    let secondPage = primary.engine.page(firstPageRequest)
    precondition(secondPage.status == "ok")
    precondition(secondPage.nodes.count == 2)
    precondition(root.referenceEdges[0].ref == secondPage.nodes[0].ref)
    precondition(secondPage.nodes.last?.referenceEdges.map(\.kind) == [.duplicate])
    precondition(primary.provider.callCount() == providerCallsBeforePages)
    emit(secondPage)
    let consumed = primary.engine.page(firstPageRequest)
    precondition(consumed.error?.kind == .tokenConsumed)
    emit(consumed)
    let consumedTamper = primary.engine.page(
        token: tamperedAuthenticator(firstToken),
        expectedStateID: base.stateID,
        requestDigest: base.requestDigest,
        projectionDigest: base.projectionDigest,
        pageSize: 2
    )
    precondition(consumedTamper.error?.kind == .tokenTampered)
    emit(consumedTamper)
    let unknown = primary.engine.page(
        token: "unknown.signature",
        expectedStateID: base.stateID,
        requestDigest: base.requestDigest,
        projectionDigest: base.projectionDigest,
        pageSize: 2
    )
    precondition(unknown.error?.kind == .unknownIdentity)
    emit(unknown)

    let rootCalls = primary.provider.callCount()
    let element = try! primary.engine.observe(request(.element(stateID: base.stateID, ref: root.ref), pageSize: 8))
    precondition(element.stateID != base.stateID)
    precondition(element.root.kind == .element)
    precondition(element.outcome == .complete)
    precondition(primary.provider.callCount() > rootCalls)
    precondition(primary.store.activeBorrows() == 0)
    emit(element)

    let gen100 = try! AOSAXProcessGeneration(pid: 100, startTimeSeconds: 10, startTimeMicroseconds: 1)
    let gen200 = try! AOSAXProcessGeneration(pid: 200, startTimeSeconds: 20, startTimeMicroseconds: 2)
    let gen300 = try! AOSAXProcessGeneration(pid: 300, startTimeSeconds: 30, startTimeMicroseconds: 3)
    let application = try! primary.engine.observe(request(.application(gen100), pageSize: 8))
    precondition(application.outcome == .complete)
    emit(application)
    let window = try! primary.engine.observe(request(.window(generation: gen100, windowID: 10), pageSize: 8))
    precondition(window.outcome == .complete)
    emit(window)
    let composite = try! primary.engine.observe(request(.displayComposite(
        topologyIdentity: "topology-1",
        applications: [gen100, try! .init(pid: 999, startTimeSeconds: 99, startTimeMicroseconds: 9), gen200]
    ), pageSize: 16))
    precondition(composite.outcome == .unavailable)
    precondition(composite.constituents.count == 3)
    precondition(composite.constituents.filter { $0.outcome == .unavailable }.count == 1)
    precondition(composite.constituents.filter { $0.outcome == .complete }.count == 2)
    precondition(!composite.nodes.isEmpty)
    emit(composite)

    let constituentBoundHarness = Harness()
    let constituentBound = try! constituentBoundHarness.engine.observe(request(
        .displayComposite(
            topologyIdentity: "topology-constituent-bound",
            applications: [gen100, gen200]
        ),
        bounds: bounds(depth: 1, visited: 1),
        pageSize: 8
    ))
    precondition(constituentBound.outcome == .truncated)
    precondition(constituentBound.constituents.map(\.outcome) == [.complete, .truncated])
    precondition(constituentBound.frontier.count == 1)
    precondition(constituentBound.frontier[0].constituentID == "application-1-pid-200")
    precondition(constituentBound.frontier[0].reason == .visitedBound)
    precondition(constituentBound.frontier[0].childPosition == 1)
    precondition(constituentBound.frontier[0].remainingCount == 1)
    precondition(constituentBoundHarness.provider.retainCount() == 1)
    emit(constituentBound)

    let mismatchHarness = Harness()
    mismatchHarness.generations.changeAfterFirst = [100]
    let mismatch = try! mismatchHarness.engine.observe(request(.application(gen100), pageSize: 8))
    precondition(mismatch.outcome == .unavailable)
    precondition(mismatch.stopCondition.kind == .generationMismatch)
    precondition(mismatch.nodes.isEmpty)
    precondition(mismatch.retention.retainedRefCount == 0)
    emit(mismatch)

    let lateFinalHarness = Harness()
    lateFinalHarness.generations.advanceAfterFinal = [100: 1_000]
    let lateFinal = try! lateFinalHarness.engine.observe(request(.application(gen100), pageSize: 8))
    precondition(lateFinal.outcome == .truncated)
    precondition(lateFinal.stopCondition.kind == .deadline)
    precondition(lateFinal.stopCondition.error?.code == "AX_DEADLINE_EXCEEDED")
    precondition(lateFinal.nodes.isEmpty && lateFinal.nextPageToken == nil)
    precondition(lateFinal.retention.retainedRefCount == 0)
    precondition(lateFinal.accounting.retainedValueCost == 0)
    precondition(lateFinalHarness.store.retainedCounts().refs == 0)
    emit(lateFinal)

    let settlementHarness = Harness()
    settlementHarness.generations.changeAfterFirst = [100]
    settlementHarness.generations.unavailableAfterFirst = [200]
    settlementHarness.generations.advanceAfterFinal = [200: 1_000]
    let settlement = try! settlementHarness.engine.observe(request(.displayComposite(
        topologyIdentity: "topology-settlement",
        applications: [gen100, gen200, gen300]
    ), pageSize: 16))
    precondition(settlement.nodes.isEmpty && settlement.accounting.retainedValueCost == 0)
    precondition(settlement.retention.retainedRefCount == 0)
    precondition(settlement.constituents.compactMap { $0.error?.code } == [
        "AX_PROCESS_GENERATION_MISMATCH", "AX_DEADLINE_EXCEEDED", "AX_DEADLINE_EXCEEDED",
    ])
    precondition(settlement.frontier.map(\.reason) == [.generationMismatch, .deadline, .deadline])
    precondition(settlement.frontier.compactMap(\.constituentID) == [
        "application-0-pid-100", "application-1-pid-200", "application-2-pid-300",
    ])
    emit(settlement)

    let admissionDeadlineHarness = Harness()
    admissionDeadlineHarness.provider.advancePerCall = 1
    let admissionDeadline = try! admissionDeadlineHarness.engine.observe(request(
        .displayComposite(
            topologyIdentity: "topology-admission-deadline",
            applications: [gen100, gen200, gen300]
        ),
        bounds: bounds(deadline: 2),
        pageSize: 8
    ))
    precondition(admissionDeadline.outcome == .truncated)
    precondition(admissionDeadline.root.constituentCount == 3)
    precondition(admissionDeadline.constituents.count == 3)
    precondition(admissionDeadline.constituents.allSatisfy {
        $0.outcome == .unavailable && $0.error?.code == "AX_DEADLINE_EXCEEDED"
    })
    precondition(admissionDeadline.frontier.compactMap(\.constituentID) == [
        "application-0-pid-100", "application-1-pid-200", "application-2-pid-300",
    ])
    precondition(admissionDeadline.frontier.allSatisfy { $0.reason == .deadline })
    emit(admissionDeadline)

    let traversalDeadlineHarness = Harness()
    traversalDeadlineHarness.provider.advancePerCall = 1
    traversalDeadlineHarness.provider.forbiddenAtOrAfter = traversalDeadlineHarness.clock.read() + 4
    let traversalDeadline = try! traversalDeadlineHarness.engine.observe(request(
        .displayComposite(
            topologyIdentity: "topology-traversal-deadline",
            applications: [gen100, gen200]
        ),
        bounds: bounds(deadline: 4),
        pageSize: 8
    ))
    precondition(traversalDeadline.outcome == .truncated)
    precondition(traversalDeadline.root.constituentCount == 2)
    precondition(traversalDeadline.constituents.count == 2)
    precondition(traversalDeadline.constituents.allSatisfy {
        $0.outcome == .unavailable && $0.error?.code == "AX_DEADLINE_EXCEEDED"
    })
    precondition(traversalDeadline.frontier.compactMap(\.constituentID) == [
        "application-0-pid-100", "application-1-pid-200",
    ])
    precondition(traversalDeadline.frontier.allSatisfy { $0.reason == .deadline })
    precondition(traversalDeadlineHarness.provider.lateCallCount() == 0)
    emit(traversalDeadline)

    let unsupportedHarness = Harness()
    unsupportedHarness.provider.systemUnsupported = true
    let unsupported = try! unsupportedHarness.engine.observe(request(.systemWide, pageSize: 8))
    precondition(unsupported.outcome == .unsupported)
    precondition(unsupported.stopCondition.error?.kind == .unsupported)
    emit(unsupported)
    let unavailable = try! unsupportedHarness.engine.observe(request(
        .application(try! .init(pid: 999, startTimeSeconds: 99, startTimeMicroseconds: 9)),
        pageSize: 8
    ))
    precondition(unavailable.outcome == .unavailable)
    precondition(unavailable.stopCondition.error?.kind == .unavailable)
    emit(unavailable)

    let filtered = try! primary.engine.observe(request(
        .systemWide,
        filters: [.init(role: "AXButton")],
        pageSize: 8
    ))
    precondition(filtered.accounting.visited == 4)
    precondition(filtered.accounting.matched == 1)
    precondition(filtered.nodes.count == 1)
    precondition(filtered.nodes[0].facts.role == "AXButton")
    emit(filtered)

    let factsOnly = AOSAXProjectionSelection(
        attributes: false,
        parameterizedAttributeNames: false,
        settableFacts: false,
        supportedActionNames: false,
        relationshipNames: false
    )
    let hiddenFilterFacts = try! primary.engine.observe(request(
        .systemWide,
        filters: [.init(role: "AXButton", rawAttributeOutcomes: [.init(name: "NoValue", outcome: .noValue)])],
        projection: factsOnly,
        pageSize: 8
    ))
    precondition(hiddenFilterFacts.nodes.count == 1)
    let hiddenNode = hiddenFilterFacts.nodes[0]
    precondition(hiddenNode.attributes == nil && hiddenNode.attributeNamesRead == nil)
    precondition(hiddenNode.parameterizedAttributeNames == nil && hiddenNode.settableFacts == nil)
    precondition(hiddenNode.supportedActionNames == nil && hiddenNode.relationshipNames == nil)
    emit(hiddenFilterFacts)

    let hiddenValueHarness = Harness(limitVisited: 1)
    let hiddenElementValue = try! hiddenValueHarness.engine.observe(request(
        .systemWide,
        bounds: bounds(visited: 1),
        filters: [.init(rawAttributeOutcomes: [.init(name: "Element", outcome: .value)])],
        projection: factsOnly,
        pageSize: 1
    ))
    precondition(hiddenElementValue.nodes.count == 1)
    precondition(hiddenElementValue.nodes[0].attributes == nil)
    precondition(hiddenElementValue.accounting.retainedValueCost == 0)
    precondition(hiddenElementValue.retention.retainedRefCount == 1)
    precondition(hiddenValueHarness.provider.retainCount() - hiddenValueHarness.provider.releaseCount() == 1)
    emit(hiddenElementValue)

    let unmatchedValueHarness = Harness(limitVisited: 1)
    let unmatchedElementValue = try! unmatchedValueHarness.engine.observe(request(
        .systemWide,
        bounds: bounds(visited: 1),
        filters: [.init(
            role: "AXMissing",
            rawAttributeOutcomes: [.init(name: "Element", outcome: .value)]
        )],
        pageSize: 1
    ))
    precondition(unmatchedElementValue.nodes.isEmpty && unmatchedElementValue.accounting.matched == 0)
    precondition(unmatchedElementValue.accounting.retainedValueCost == 0)
    precondition(unmatchedElementValue.retention.retainedRefCount == 1)
    precondition(unmatchedValueHarness.provider.retainCount() - unmatchedValueHarness.provider.releaseCount() == 1)
    emit(unmatchedElementValue)

    do {
        _ = try AOSAXObservationRequest(
            root: .systemWide,
            bounds: bounds(visited: 1),
            filters: [.init(role: String(repeating: "x", count: 513))],
            pageSize: 1
        )
        preconditionFailure("oversized filter string must be rejected")
    } catch AOSAXObservationError.invalidRoot {
    } catch {
        preconditionFailure("unexpected oversized filter error: \(error)")
    }

    let oversizedFactsHarness = Harness(limitVisited: 1)
    oversizedFactsHarness.provider.oversizedFacts = true
    let oversizedFacts = try! oversizedFactsHarness.engine.observe(request(
        .systemWide,
        bounds: bounds(visited: 1),
        projection: factsOnly,
        pageSize: 1
    ))
    precondition(oversizedFacts.outcome == .truncated && oversizedFacts.nodes.isEmpty)
    precondition(oversizedFacts.stopCondition.kind == .platformError)
    precondition(oversizedFacts.stopCondition.error?.code == "AX_PROVIDER_RESULT_BOUND_EXCEEDED")
    precondition(oversizedFacts.nextPageToken == nil && oversizedFacts.accounting.retainedValueCost == 0)
    emit(oversizedFacts)

    let duplicateNamesHarness = Harness(limitVisited: 1)
    duplicateNamesHarness.provider.duplicateAttributeNames = true
    let duplicateNames = try! duplicateNamesHarness.engine.observe(request(
        .systemWide,
        bounds: bounds(visited: 1),
        pageSize: 1
    ))
    precondition(duplicateNames.nodes[0].attributeNamesRead?.kind == .platformError)
    precondition(duplicateNames.nodes[0].attributeNamesRead?.error?.code == "AX_PROVIDER_RESULT_INVALID")
    precondition(duplicateNames.nodes[0].attributes?.isEmpty == true)
    let duplicateCounts = duplicateNamesHarness.store.retainedCounts()
    precondition(duplicateCounts.snapshots == 1 && duplicateCounts.refs == 1)
    precondition(duplicateCounts.valueCost == 0 && duplicateCounts.tokens == 0)
    duplicateNamesHarness.provider.duplicateAttributeNames = false
    duplicateNamesHarness.provider.duplicateRelationshipNames = true
    let duplicateRelationships = try! duplicateNamesHarness.engine.observe(request(
        .systemWide, bounds: bounds(visited: 1), projection: factsOnly, pageSize: 1
    ))
    precondition(duplicateRelationships.outcome == .truncated)
    precondition(duplicateRelationships.stopCondition.error?.code == "AX_PROVIDER_RESULT_INVALID")
    precondition(!duplicateRelationships.nodes.isEmpty, "AX_DIAG_EMPTY_DUPLICATE_RELATIONSHIP")
    precondition(duplicateRelationships.nodes[0].relationshipRead.error?.code == "AX_PROVIDER_RESULT_INVALID")
    precondition(duplicateRelationships.nodes[0].referenceEdges.isEmpty)
    precondition(duplicateRelationships.retention.retainedRefCount == 1)

    let queuedDuplicateHarness = Harness(limitVisited: 4)
    queuedDuplicateHarness.provider.duplicateRelationshipHandle = 3
    let queuedDuplicate = try! queuedDuplicateHarness.engine.observe(request(
        .systemWide, bounds: bounds(visited: 4), projection: factsOnly, pageSize: 4
    ))
    precondition(queuedDuplicate.outcome == .truncated)
    precondition(queuedDuplicate.stopCondition.error?.code == "AX_PROVIDER_RESULT_INVALID")
    precondition(queuedDuplicate.accounting.visited == 2)
    precondition(queuedDuplicate.accounting.matched == 2 && queuedDuplicate.accounting.emitted == 2)
    precondition(queuedDuplicate.accounting.cycleEdges == 0 && queuedDuplicate.accounting.duplicateEdges == 0)
    precondition(queuedDuplicate.frontier.count == 4)
    precondition(queuedDuplicate.frontier.allSatisfy { $0.reason == .platformError && $0.ref == nil })
    precondition(queuedDuplicate.frontier.filter { $0.relationshipName == nil }.count == 1)
    precondition(queuedDuplicate.frontier.compactMap {
        guard let name = $0.relationshipName, let position = $0.childPosition else { return nil }
        return "\(name):\(position)"
    } == ["AChildren:1", "ZChildren:0", "ZChildren:1"])
    precondition(queuedDuplicate.retention.retainedRefCount == 2)

    let scalarDistinctHarness = Harness(limitVisited: 4)
    scalarDistinctHarness.provider.scalarDistinctRelationshipNames = true
    let scalarDistinct = try! scalarDistinctHarness.engine.observe(request(
        .systemWide, bounds: bounds(visited: 4), pageSize: 4
    ))
    precondition(scalarDistinct.outcome == .complete)
    precondition(scalarDistinct.accounting.visited == 4)
    precondition(scalarDistinct.nodes[0].relationshipRead.kind == .value)
    let scalarDistinctNames = scalarDistinct.nodes[0].relationshipNames!
    precondition(scalarDistinctNames.count == 2)
    precondition(scalarDistinctNames[0].unicodeScalars.map(\.value) == [0x65, 0x301])
    precondition(scalarDistinctNames[1].unicodeScalars.map(\.value) == [0xE9])

    let cancellationHarness = Harness(limitVisited: 1, cancelAfterBorrow: true)
    let cancellationSource = try! cancellationHarness.engine.observe(request(
        .systemWide,
        bounds: bounds(visited: 1),
        projection: factsOnly,
        pageSize: 1
    ))
    let cancellationCounts = cancellationHarness.store.retainedCounts()
    let callsBeforeCancellation = cancellationHarness.provider.callCount()
    do {
        _ = try cancellationHarness.engine.observe(request(
            .element(stateID: cancellationSource.stateID, ref: cancellationSource.nodes[0].ref),
            bounds: bounds(visited: 1),
            projection: factsOnly,
            pageSize: 1
        ))
        preconditionFailure("post-borrow cancellation must terminate before publication")
    } catch { precondition(error as? AOSAXObservationError == .cancelled) }
    let cancelledCounts = cancellationHarness.store.retainedCounts()
    precondition(cancellationHarness.store.activeBorrows() == 0)
    precondition(cancellationHarness.provider.callCount() == callsBeforeCancellation)
    precondition(cancelledCounts.snapshots == cancellationCounts.snapshots)
    precondition(cancelledCounts.refs == cancellationCounts.refs && cancelledCounts.tokens == cancellationCounts.tokens)
    precondition(cancelledCounts.valueCost == cancellationCounts.valueCost)
    let reusedState = try! cancellationHarness.store.allocateStateID { "state-2" }
    precondition(reusedState == "state-2")
    cancellationHarness.store.abandonStateID(reusedState)

    let errorHarness = Harness()
    errorHarness.provider.attributeUnavailable = true
    errorHarness.provider.parameterizedUnsupported = true
    errorHarness.provider.actionUnavailable = true
    errorHarness.provider.relationshipPlatformError = true
    let exactErrors = try! errorHarness.engine.observe(request(.systemWide, pageSize: 8))
    let errorNode = exactErrors.nodes[0]
    precondition(attribute("Error", in: errorNode).error?.kind == .unavailable)
    precondition(errorNode.parameterizedAttributeNamesRead?.error?.kind == .unsupported)
    precondition(errorNode.supportedActionNamesRead?.error?.kind == .unavailable)
    precondition(errorNode.relationshipRead.error?.kind == .platformError)
    emit(exactErrors)

    let depthBound = try! primary.engine.observe(request(.application(gen200), bounds: bounds(depth: 1), pageSize: 16))
    precondition(depthBound.outcome == .truncated)
    precondition(depthBound.frontier.contains(where: { $0.reason == .depthBound }))
    emit(depthBound)
    let visitBound = try! primary.engine.observe(request(.systemWide, bounds: bounds(visited: 1), projection: factsOnly, pageSize: 1))
    precondition(visitBound.outcome == .truncated)
    precondition(visitBound.stopCondition.kind == .visitedBound)
    precondition(visitBound.frontier.map(\.relationshipName).compactMap { $0 } == ["AChildren", "ZChildren"])
    precondition(visitBound.frontier.map(\.remainingCount).compactMap { $0 } == [2, 2])
    precondition(visitBound.frontier.allSatisfy { $0.ref == nil } && visitBound.retention.retainedRefCount == 1)
    emit(visitBound)
    let emitBound = try! primary.engine.observe(request(.systemWide, bounds: bounds(emitted: 1), pageSize: 1))
    precondition(emitBound.outcome == .truncated)
    precondition(emitBound.stopCondition.kind == .emittedBound)
    precondition(emitBound.accounting.duplicateEdges == 0)
    precondition(emitBound.frontier.contains(where: {
        $0.parentRef == emitBound.nodes[0].ref &&
            $0.relationshipName == "ZChildren" &&
            $0.childPosition == 1 &&
            $0.ref == nil &&
            $0.reason == .emittedBound
    }))
    emit(emitBound)
    let independentPageHarness = Harness(limitVisited: 4, limitEmitted: 1, limitPageSize: 2)
    let independentPageRequest = request(
        .systemWide,
        bounds: bounds(visited: 4, emitted: 1),
        pageSize: 2
    )
    emit(independentPageRequest)
    let independentPage = try! independentPageHarness.engine.observe(independentPageRequest)
    precondition(independentPage.effectiveLimits.observationLimits.maxEmitted == 1)
    precondition(independentPage.effectiveLimits.observationLimits.maxPageSize == 2)
    precondition(independentPage.outcome == .truncated && independentPage.stopCondition.kind == .emittedBound)
    precondition(independentPage.accounting.visited == 2 && independentPage.accounting.matched == 2)
    precondition(independentPage.accounting.emitted == 1 && independentPage.nodes.count == 1)
    precondition(independentPage.retention.pageSize == 2 && independentPage.nextPageToken == nil)
    emit(independentPage)
    let pageBound = try! primary.engine.observe(request(.systemWide, pageSize: 1))
    precondition(pageBound.outcome == .complete)
    precondition(pageBound.accounting.emitted == 4)
    precondition(pageBound.nodes.count == 1)
    emit(pageBound)
    let recursionBound = try! primary.engine.observe(request(
        .systemWide,
        bounds: bounds(arrayDepth: 2),
        pageSize: 8
    ))
    precondition(attribute("DeepArray", in: recursionBound.nodes[0]).outcome == .recursionBound)
    emit(recursionBound)
    let arrayBound = try! primary.engine.observe(request(
        .systemWide,
        bounds: bounds(arrayItems: 2),
        filters: [.init(rawAttributeOutcomes: [.init(name: "BigArray", outcome: .arrayBound)])],
        pageSize: 8
    ))
    precondition(arrayBound.accounting.matched == 1)
    precondition(arrayBound.nodes.count == 1)
    precondition(arrayBound.nodes[0].attributes?.isEmpty == true)
    emit(arrayBound)
    let valueBound = try! primary.engine.observe(request(
        .systemWide,
        bounds: bounds(valueCost: 4),
        pageSize: 8
    ))
    precondition(valueBound.outcome == .truncated)
    precondition(valueBound.stopCondition.kind == .valueCostBound)
    precondition(valueBound.nodes[0].relationshipRead.kind == .notAttempted)
    emit(valueBound)

    let frontierBudgetHarness = Harness(maxRefs: 2, limitVisited: 2, limitArrayItems: 4)
    frontierBudgetHarness.provider.frontierStress = true
    let frontierBudget = try! frontierBudgetHarness.engine.observe(request(
        .systemWide,
        bounds: bounds(visited: 2, arrayItems: 4),
        projection: factsOnly,
        pageSize: 2
    ))
    precondition(frontierBudget.outcome == .truncated)
    precondition(frontierBudget.effectiveLimits.observationLimits.maxFrontier == 6)
    precondition(frontierBudget.frontier.count == 3)
    precondition(frontierBudget.frontier.map(\.relationshipName).compactMap { $0 } == [
        "BChildren", "ZChildren", "AChildren",
    ])
    precondition(frontierBudget.frontier.count <= frontierBudget.effectiveLimits.observationLimits.maxFrontier)
    emit(frontierBudget)

    let manualRequest = request(
        .systemWide,
        bounds: bounds(visited: 1, arrayItems: 1),
        projection: factsOnly,
        pageSize: 1
    )
    let manualAdmission = try! frontierBudgetHarness.store.beginObservation(manualRequest)
    let manualState = try! frontierBudgetHarness.store.allocateStateID { "manual-frontier-state" }
    let oversizedFrontier = (0...manualAdmission.effectiveLimits.observationLimits.maxFrontier).map {
        AOSAXFrontierEntry(
            parentRef: nil,
            relationshipName: "overflow-\($0)",
            childPosition: $0,
            depth: 0,
            ref: nil,
            constituentID: nil,
            reason: .retentionLimit
        )
    }
    let manualSnapshot = AOSAXStoredSnapshot<Int>(
        stateID: manualState,
        requestDigest: String(repeating: "a", count: 64),
        projectionDigest: String(repeating: "b", count: 64),
        root: try! .init(kind: .systemWide),
        bounds: manualRequest.bounds,
        effectiveLimits: manualAdmission.effectiveLimits,
        filters: [],
        pageSize: 1,
        createdAt: manualAdmission.createdAt,
        expiresAt: manualAdmission.expiresAt,
        createdMonotonicNanoseconds: manualAdmission.startMonotonicNanoseconds,
        expiresMonotonicNanoseconds: manualAdmission.expiresMonotonicNanoseconds,
        outcome: .truncated,
        stopCondition: .init(kind: .retentionLimit, detail: "injected oversized frontier"),
        accounting: .init(
            visited: 0,
            matched: 0,
            emitted: 0,
            cycleEdges: 0,
            duplicateEdges: 0,
            elapsedNanoseconds: 0,
            retainedValueCost: 0
        ),
        frontier: oversizedFrontier,
        constituents: [],
        nodes: [],
        handlesByRef: [:],
        retainedValueCost: 0
    )
    let rejectedFrontier = try! frontierBudgetHarness.store.publish(manualSnapshot, pageSize: 1)
    precondition(rejectedFrontier.outcome == .truncated)
    precondition(rejectedFrontier.stopCondition.kind == .retentionLimit)
    precondition(rejectedFrontier.frontier.count == manualAdmission.effectiveLimits.observationLimits.maxFrontier)
    precondition(frontierBudgetHarness.store.retainedCounts().snapshots == 1)
    emit(rejectedFrontier)

    let expiredPublishHarness = Harness(ttl: 1)
    expiredPublishHarness.enableReleaseReentry()
    let expiredRequest = request(.systemWide, pageSize: 1)
    let expiredAdmission = try! expiredPublishHarness.store.beginObservation(expiredRequest)
    let expiredState = try! expiredPublishHarness.store.allocateStateID { "expired-before-publish" }
    expiredPublishHarness.provider.retain(handle: 42)
    var expiredHandle: AOSAXRetainedHandle<Int>? = .init(
        value: 42,
        release: { expiredPublishHarness.provider.release(handle: $0) }
    )
    var expiredSnapshot: AOSAXStoredSnapshot<Int>? = .init(
        stateID: expiredState,
        requestDigest: String(repeating: "c", count: 64),
        projectionDigest: String(repeating: "d", count: 64),
        root: try! .init(kind: .systemWide),
        bounds: expiredRequest.bounds,
        effectiveLimits: expiredAdmission.effectiveLimits,
        filters: [],
        pageSize: 1,
        createdAt: expiredAdmission.createdAt,
        expiresAt: expiredAdmission.expiresAt,
        createdMonotonicNanoseconds: expiredAdmission.startMonotonicNanoseconds,
        expiresMonotonicNanoseconds: expiredAdmission.expiresMonotonicNanoseconds,
        outcome: .complete,
        stopCondition: .init(kind: .complete, detail: "injected complete snapshot"),
        accounting: .init(
            visited: 2,
            matched: 2,
            emitted: 2,
            cycleEdges: 0,
            duplicateEdges: 0,
            elapsedNanoseconds: 1,
            retainedValueCost: 7
        ),
        frontier: [],
        constituents: [],
        nodes: base.nodes,
        handlesByRef: ["expired-ref": expiredHandle!],
        retainedValueCost: 7
    )
    expiredPublishHarness.clock.advance(1)
    let expiredBeforePublish = try! expiredPublishHarness.store.publish(expiredSnapshot!, pageSize: 1)
    expiredSnapshot = nil
    expiredHandle = nil
    precondition(expiredBeforePublish.outcome == .unavailable)
    precondition(expiredBeforePublish.stopCondition.kind == .snapshotExpired)
    precondition(expiredBeforePublish.nodes.isEmpty && expiredBeforePublish.nextPageToken == nil)
    precondition(expiredBeforePublish.accounting.emitted == 0)
    precondition(expiredBeforePublish.accounting.retainedValueCost == 0)
    precondition(expiredBeforePublish.retention.retainedRefCount == 0)
    precondition(expiredBeforePublish.retention.retainedValueCost == 0)
    let expiredCounts = expiredPublishHarness.store.retainedCounts()
    precondition(expiredCounts.snapshots == 0 && expiredCounts.refs == 0)
    precondition(expiredCounts.valueCost == 0 && expiredCounts.tokens == 0)
    precondition(expiredPublishHarness.provider.retainCount() == 1)
    precondition(expiredPublishHarness.provider.releaseCount() == 1)
    if case .expired = expiredPublishHarness.store.resolveElement(stateID: expiredState, ref: "expired-ref") {
    } else {
        preconditionFailure("expired prepublication snapshot must retain only its expiry tombstone")
    }
    emit(expiredBeforePublish)

    let rollbackHarness = Harness()
    rollbackHarness.provider.rollbackAttribute = true
    let attributesOnly = AOSAXProjectionSelection(
        attributes: true,
        parameterizedAttributeNames: false,
        settableFacts: false,
        supportedActionNames: false,
        relationshipNames: false
    )
    let filterProjectionHarness = Harness(limitVisited: 1)
    filterProjectionHarness.provider.titleOnlyAttributeNames = true
    let filterProjection = try! filterProjectionHarness.engine.observe(request(
        .systemWide, bounds: bounds(visited: 1),
        filters: [.init(rawAttributeOutcomes: [.init(name: "Secret", outcome: .value)])],
        projection: attributesOnly, pageSize: 1
    ))
    precondition(filterProjection.accounting.matched == 1)
    precondition(!filterProjection.nodes.isEmpty, "AX_DIAG_EMPTY_FILTER_PROJECTION")
    precondition(filterProjection.nodes[0].attributes?.map(\.name) == ["Title"])
    let exhaustedProjectionFilter = try! filterProjectionHarness.engine.observe(request(
        .systemWide, bounds: bounds(visited: 1, valueCost: 8),
        filters: [.init(rawAttributeOutcomes: [.init(name: "ZuluSecret", outcome: .value)])],
        projection: attributesOnly, pageSize: 1
    ))
    precondition(exhaustedProjectionFilter.accounting.matched == 1)
    precondition(exhaustedProjectionFilter.nodes.count == 1)
    precondition(exhaustedProjectionFilter.nodes[0].attributes?.map(\.name) == ["Title"])
    precondition(exhaustedProjectionFilter.accounting.retainedValueCost == 8)
    precondition(exhaustedProjectionFilter.retention.retainedValueCost == 8)
    let filterProjectionMiss = try! filterProjectionHarness.engine.observe(request(
        .systemWide, bounds: bounds(visited: 1),
        filters: [.init(rawAttributeOutcomes: [.init(name: "Secret", outcome: .noValue)])],
        projection: attributesOnly, pageSize: 1
    ))
    precondition(filterProjectionMiss.accounting.matched == 0 && filterProjectionMiss.nodes.isEmpty)

    let rollback = try! rollbackHarness.engine.observe(request(
        .systemWide,
        bounds: bounds(visited: 1),
        projection: attributesOnly,
        pageSize: 1
    ))
    precondition(attribute("RollbackArray", in: rollback.nodes[0]).outcome == .unrepresentableType)
    precondition(rollback.retention.retainedRefCount == 1)
    precondition(rollbackHarness.provider.retainCount() - rollbackHarness.provider.releaseCount() == 1)

    let queuedRefHarness = Harness()
    queuedRefHarness.provider.queuedValueRefAttribute = true
    let queuedRef = try! queuedRefHarness.engine.observe(request(.systemWide, bounds: bounds(visited: 4),
        filters: [.init(role: "AXSystemWide")], projection: attributesOnly, pageSize: 2))
    precondition(queuedRef.accounting.visited == 2 && queuedRef.accounting.emitted == 1)
    precondition(queuedRef.nodes.map(\.facts.identifier) == ["id-1"])
    precondition(queuedRef.retention.retainedRefCount == 2)
    precondition(queuedRef.accounting.retainedValueCost == 0)
    precondition(queuedRefHarness.provider.retainCount() - queuedRefHarness.provider.releaseCount() == 2)
    emit(queuedRef)

    let deadlineHarness = Harness()
    deadlineHarness.provider.advancePerCall = 1
    deadlineHarness.provider.forbiddenAtOrAfter = deadlineHarness.clock.read() + 4
    let deadline = try! deadlineHarness.engine.observe(request(
        .systemWide,
        bounds: bounds(deadline: 4),
        pageSize: 8
    ))
    precondition(deadline.outcome == .truncated)
    precondition(deadline.stopCondition.kind == .deadline)
    precondition(deadlineHarness.provider.lateCallCount() == 0)
    precondition(deadlineHarness.provider.lateRetainCount() == 0)
    emit(deadline)

    let lateRootHarness = Harness()
    lateRootHarness.provider.advancePerCall = 1
    lateRootHarness.provider.forbiddenAtOrAfter = lateRootHarness.clock.read() + 1
    let lateRoot = try! lateRootHarness.engine.observe(request(
        .systemWide,
        bounds: bounds(visited: 1, deadline: 1),
        projection: factsOnly,
        pageSize: 1
    ))
    precondition(lateRoot.outcome == .truncated && lateRoot.stopCondition.kind == .deadline)
    precondition(lateRoot.retention.retainedRefCount == 0)
    precondition(lateRootHarness.provider.retainCount() == 0)
    precondition(lateRootHarness.provider.lateRetainCount() == 0)
    emit(lateRoot)

    let lateValueHarness = Harness()
    lateValueHarness.provider.advanceAfterAttribute = ["Element": 1]
    lateValueHarness.provider.forbiddenAtOrAfter = lateValueHarness.clock.read() + 1
    let lateValue = try! lateValueHarness.engine.observe(request(
        .systemWide,
        bounds: bounds(visited: 1, deadline: 1),
        projection: attributesOnly,
        pageSize: 1
    ))
    precondition(lateValue.outcome == .truncated && lateValue.stopCondition.kind == .deadline)
    precondition(!lateValue.nodes.isEmpty, "AX_DIAG_EMPTY_LATE_VALUE")
    precondition(attribute("Element", in: lateValue.nodes[0]).outcome == .deadlineExceeded)
    let lateAttributes = lateValue.nodes[0].attributes!
    precondition(lateAttributes.count == Set(lateAttributes.map(\.name)).count)
    let lateStart = lateAttributes.firstIndex { $0.name == "Element" }!
    precondition(lateAttributes[lateStart...].allSatisfy { $0.outcome == .deadlineExceeded })
    precondition(lateValue.retention.retainedRefCount == 1)
    precondition(lateValueHarness.provider.retainCount() == 1)
    precondition(lateValueHarness.provider.lateCallCount() == 0)
    precondition(lateValueHarness.provider.lateRetainCount() == 0)
    emit(lateValue)

    let settableOnly = AOSAXProjectionSelection(
        attributes: false,
        parameterizedAttributeNames: false,
        settableFacts: true,
        supportedActionNames: false,
        relationshipNames: false
    )
    let lateSettableHarness = Harness(limitVisited: 1)
    lateSettableHarness.provider.advanceAfterSettable = ["Array": 1]
    lateSettableHarness.provider.forbiddenAtOrAfter = lateSettableHarness.clock.read() + 1
    let lateSettable = try! lateSettableHarness.engine.observe(request(
        .systemWide,
        bounds: bounds(visited: 1, deadline: 1),
        projection: settableOnly,
        pageSize: 1
    ))
    precondition(lateSettable.outcome == .truncated && lateSettable.stopCondition.kind == .deadline)
    precondition(lateSettable.nodes.count == 1)
    let lateSettableFacts = lateSettable.nodes[0].settableFacts!
    precondition(lateSettableFacts.count == 23)
    precondition(Set(lateSettableFacts.map(\.name)).count == 23)
    precondition(lateSettableFacts.allSatisfy { $0.outcome == .deadlineExceeded })
    precondition(lateSettableHarness.provider.settableCallNames() == ["Array"])
    precondition(lateSettableHarness.provider.lateCallCount() == 0)
    emit(lateSettable)

    let evictionHarness = Harness(maxSnapshots: 1)
    evictionHarness.enableReleaseReentry()
    let evictedSource = try! evictionHarness.engine.observe(request(.systemWide, pageSize: 1))
    let evictedToken = evictedSource.nextPageToken!
    let releasesBeforeEviction = evictionHarness.provider.releaseCount()
    _ = try! evictionHarness.engine.observe(request(.systemWide, pageSize: 8))
    precondition(
        evictionHarness.provider.releaseCount() - releasesBeforeEviction == evictedSource.retention.retainedRefCount
    )
    let evictedPage = evictionHarness.engine.page(
        token: evictedToken,
        expectedStateID: evictedSource.stateID,
        requestDigest: evictedSource.requestDigest,
        projectionDigest: evictedSource.projectionDigest,
        pageSize: 1
    )
    precondition(evictedPage.error?.kind == .tokenEvicted)
    emit(evictedPage)
    let evictedTamper = evictionHarness.engine.page(
        token: tamperedAuthenticator(evictedToken),
        expectedStateID: evictedSource.stateID,
        requestDigest: evictedSource.requestDigest,
        projectionDigest: evictedSource.projectionDigest,
        pageSize: 1
    )
    precondition(evictedTamper.error?.kind == .tokenTampered)
    emit(evictedTamper)
    let staleElement = try! evictionHarness.engine.observe(request(
        .element(stateID: evictedSource.stateID, ref: evictedSource.nodes[0].ref),
        pageSize: 8
    ))
    precondition(staleElement.outcome == .unavailable)
    precondition(staleElement.stopCondition.kind == .sourceSnapshotEvicted)
    emit(staleElement)

    let expiryHarness = Harness(ttl: 10)
    expiryHarness.enableReleaseReentry()
    let expiring = try! expiryHarness.engine.observe(request(.systemWide, pageSize: 1))
    expiryHarness.clock.advance(11)
    let expiredPage = expiryHarness.engine.page(
        token: expiring.nextPageToken!,
        expectedStateID: expiring.stateID,
        requestDigest: expiring.requestDigest,
        projectionDigest: expiring.projectionDigest,
        pageSize: 1
    )
    precondition(expiredPage.error?.kind == .tokenExpired)
    emit(expiredPage)
    let expiredTamper = expiryHarness.engine.page(
        token: tamperedAuthenticator(expiring.nextPageToken!),
        expectedStateID: expiring.stateID,
        requestDigest: expiring.requestDigest,
        projectionDigest: expiring.projectionDigest,
        pageSize: 1
    )
    precondition(expiredTamper.error?.kind == .tokenTampered)
    emit(expiredTamper)

    let borrowExpiryHarness = Harness(ttl: 10, maxBorrows: 1)
    borrowExpiryHarness.enableReleaseReentry()
    let borrowExpirySource = try! borrowExpiryHarness.engine.observe(request(
        .systemWide,
        bounds: bounds(visited: 1),
        projection: factsOnly,
        pageSize: 1
    ))
    let expiryLease: AOSAXHandleBorrowLease<Int>
    if case .value(let lease) = borrowExpiryHarness.store.resolveElement(
        stateID: borrowExpirySource.stateID,
        ref: borrowExpirySource.nodes[0].ref
    ) { expiryLease = lease } else { preconditionFailure("expected admitted borrow") }
    precondition(borrowExpiryHarness.store.activeBorrows() == 1)
    if case .borrowLimit = borrowExpiryHarness.store.resolveElement(stateID: borrowExpirySource.stateID, ref: borrowExpirySource.nodes[0].ref) {} else {
        preconditionFailure("second borrow must respect the store-owned cap")
    }
    borrowExpiryHarness.clock.advance(11)
    if case .expired = borrowExpiryHarness.store.resolveElement(stateID: borrowExpirySource.stateID, ref: borrowExpirySource.nodes[0].ref) {} else {
        preconditionFailure("expiry must remove new lookup authority")
    }
    precondition(borrowExpiryHarness.provider.releaseCount() == 0)
    expiryLease.release()
    expiryLease.release()
    precondition(borrowExpiryHarness.store.activeBorrows() == 0)
    precondition(borrowExpiryHarness.provider.releaseCount() == 1, "expiry release count \(borrowExpiryHarness.provider.releaseCount())")

    let borrowEvictionHarness = Harness(maxSnapshots: 1)
    borrowEvictionHarness.enableReleaseReentry()
    let borrowEvictedSource = try! borrowEvictionHarness.engine.observe(request(.systemWide, bounds: bounds(visited: 1), projection: factsOnly, pageSize: 1))
    let evictionLease: AOSAXHandleBorrowLease<Int>
    if case .value(let lease) = borrowEvictionHarness.store.resolveElement(stateID: borrowEvictedSource.stateID, ref: borrowEvictedSource.nodes[0].ref) {
        evictionLease = lease
    } else { preconditionFailure("expected eviction borrow") }
    _ = try! borrowEvictionHarness.engine.observe(request(.systemWide, bounds: bounds(visited: 1), projection: factsOnly, pageSize: 1))
    if case .evicted = borrowEvictionHarness.store.resolveElement(stateID: borrowEvictedSource.stateID, ref: borrowEvictedSource.nodes[0].ref) {} else {
        preconditionFailure("eviction must remove new lookup authority")
    }
    precondition(borrowEvictionHarness.provider.releaseCount() == 0)
    evictionLease.release()
    precondition(borrowEvictionHarness.provider.releaseCount() == 1)

    let refCapacityHarness = Harness(maxRefs: 1)
    do {
        _ = try refCapacityHarness.engine.observe(request(.systemWide, pageSize: 1))
        preconditionFailure("request above effective ref admission must fail")
    } catch { precondition(error as? AOSAXObservationError == .invalidBounds) }
    let refCapacity = try! refCapacityHarness.engine.observe(request(
        .systemWide,
        bounds: bounds(visited: 1),
        pageSize: 1
    ))
    precondition(refCapacity.effectiveLimits.retention.maxRetainedRefs == 1)
    emit(refCapacity)
    let valueCapacityHarness = Harness(maxValueCost: 1)
    do {
        _ = try valueCapacityHarness.engine.observe(request(.systemWide, pageSize: 8))
        preconditionFailure("request above effective value admission must fail")
    } catch { precondition(error as? AOSAXObservationError == .invalidBounds) }
    let valueCapacity = try! valueCapacityHarness.engine.observe(request(
        .systemWide,
        bounds: bounds(valueCost: 1),
        pageSize: 8
    ))
    precondition(valueCapacity.effectiveLimits.retention.maxRetainedValueCost == 1)
    precondition(valueCapacity.accounting.retainedValueCost <= 1)
    precondition(valueCapacity.nodes[0].relationshipRead.kind == .notAttempted)
    emit(valueCapacity)

    let tokenCollisionHarness = Harness(invalidTokenIdentities: true)
    tokenCollisionHarness.enableReleaseReentry()
    do {
        _ = try tokenCollisionHarness.engine.observe(request(.systemWide, pageSize: 1))
        preconditionFailure("invalid token identities must fail closed")
    } catch let error as AOSAXObservationError {
        precondition(error == .identityExhausted)
    } catch {
        preconditionFailure("unexpected token identity failure")
    }
    precondition(tokenCollisionHarness.store.retainedCounts().snapshots == 0)
    precondition(tokenCollisionHarness.provider.retainCount() == tokenCollisionHarness.provider.releaseCount())

    for identity in [
        AOSAXPageTokenIdentity(lookupID: "token", publicToken: "token." + String(repeating: "x", count: 507)),
        AOSAXPageTokenIdentity(lookupID: "token", publicToken: "token.é"),
    ] {
        let invalidTokenHarness = Harness(tokenIdentity: identity)
        do {
            _ = try invalidTokenHarness.engine.observe(request(.systemWide, pageSize: 1))
            preconditionFailure("non-public token shape must fail closed")
        } catch { precondition(error as? AOSAXObservationError == .identityExhausted) }
        let counts = invalidTokenHarness.store.retainedCounts()
        precondition(counts.snapshots == 0 && counts.tokens == 0)
        precondition(invalidTokenHarness.provider.retainCount() == invalidTokenHarness.provider.releaseCount())
    }

    do {
        _ = try AOSAXProcessGeneration(pid: 0, startTimeSeconds: 0, startTimeMicroseconds: 0)
        preconditionFailure("zero pid must be rejected")
    } catch { precondition(error as? AOSAXObservationError == .invalidRoot) }
    let combiningIdentifier = String(repeating: "e\u{301}", count: 256) + "e"
    precondition(combiningIdentifier.count == 257 && combiningIdentifier.unicodeScalars.count == 513)
    do {
        _ = try AOSAXObservationRequest(
            root: .displayComposite(topologyIdentity: combiningIdentifier, applications: [gen100]),
            bounds: bounds(),
            pageSize: 1
        )
        preconditionFailure("513-code-point topology identity must be rejected")
    } catch { precondition(error as? AOSAXObservationError == .invalidRoot) }
    do {
        _ = try AOSAXObservationRequest(
            root: .displayComposite(topologyIdentity: String(repeating: "t", count: 513), applications: [gen100]),
            bounds: bounds(),
            pageSize: 1
        )
        preconditionFailure("oversized topology identity must be rejected")
    } catch { precondition(error as? AOSAXObservationError == .invalidRoot) }
    do {
        _ = try AOSAXObservationRequest(
            root: .element(stateID: String(repeating: "s", count: 513), ref: "ref"),
            bounds: bounds(),
            pageSize: 1
        )
        preconditionFailure("oversized Observation Ref identity must be rejected")
    } catch { precondition(error as? AOSAXObservationError == .invalidRoot) }
    let encodedRequest = try! AOSAXObservationJSON.encode(request(.application(gen100), pageSize: 1))
    let decoder = JSONDecoder()
    decoder.keyDecodingStrategy = .convertFromSnakeCase
    let requestCorpus = try! JSONDecoder().decode(
        [RequestAdmissionCorpusEntry].self,
        from: Data(#"${requestAdmissionCorpusJSON}"#.utf8)
    )
    for entry in requestCorpus {
        let accepted: Bool
        switch entry.definition {
        case "observation_request":
            accepted = (try? decoder.decode(AOSAXObservationRequest.self, from: Data(entry.json.utf8))) != nil
        case "page_request":
            accepted = (try? decoder.decode(AOSAXPageRequest.self, from: Data(entry.json.utf8))) != nil
        default:
            preconditionFailure("unknown admission-corpus definition")
        }
        precondition(accepted == entry.valid)
    }
    precondition((try? decoder.decode(AOSAXObservationRequest.self, from: encodedRequest)) != nil)
    let emptyFilterJSON = String(data: encodedRequest, encoding: .utf8)!
        .replacingOccurrences(of: "\"filters\":[]", with: "\"filters\":[{}]")
    precondition(emptyFilterJSON.contains("\"filters\":[{}]"))
    let emptyFilterRequest = try! decoder.decode(
        AOSAXObservationRequest.self,
        from: Data(emptyFilterJSON.utf8)
    )
    precondition(emptyFilterRequest.filters.count == 1)
    precondition(emptyFilterRequest.filters[0].rawAttributeOutcomes.isEmpty)
    print(emptyFilterJSON)

    let generationJSON = "\"generation\":{\"pid\":100,\"start_time_seconds\":10,\"start_time_microseconds\":1}"
    let validRootIdentities = [
        "{\"kind\":\"system_wide\"}",
        "{\"kind\":\"application\",\(generationJSON)}",
        "{\"kind\":\"window\",\(generationJSON),\"window_id\":10}",
        "{\"kind\":\"element\",\"source_state_id\":\"state\",\"source_ref\":\"ref\"}",
        "{\"kind\":\"display_composite\",\"topology_identity\":\"topology\",\"constituent_count\":2}",
    ]
    for identityJSON in validRootIdentities {
        precondition((try? decoder.decode(AOSAXRootIdentity.self, from: Data(identityJSON.utf8))) != nil)
    }
    let invalidRootIdentities = [
        "{}",
        "{\"kind\":\"system_wide\",\(generationJSON)}",
        "{\"kind\":\"application\"}",
        "{\"kind\":\"application\",\(generationJSON),\"window_id\":10}",
        "{\"kind\":\"window\",\(generationJSON)}",
        "{\"kind\":\"window\",\(generationJSON),\"window_id\":10,\"source_ref\":\"ref\"}",
        "{\"kind\":\"element\",\"source_state_id\":\"state\"}",
        "{\"kind\":\"element\",\"source_state_id\":\"state\",\"source_ref\":\"ref\",\(generationJSON)}",
        "{\"kind\":\"display_composite\",\"topology_identity\":\"topology\"}",
        "{\"kind\":\"display_composite\",\"topology_identity\":\"topology\",\"constituent_count\":2,\"source_state_id\":\"state\"}",
    ]
    for identityJSON in invalidRootIdentities {
        precondition((try? decoder.decode(AOSAXRootIdentity.self, from: Data(identityJSON.utf8))) == nil)
    }
    do {
        _ = try AOSAXPageRequest(
            token: "token.é",
            expectedStateID: "state",
            requestDigest: String(repeating: "0", count: 64),
            projectionDigest: String(repeating: "0", count: 64),
            pageSize: 1
        )
        preconditionFailure("page request token shape must be rejected")
    } catch {}
    let combiningDetail = String(repeating: "e\u{301}", count: 1_024) + "e"
    precondition(combiningDetail.count == 1_025 && combiningDetail.unicodeScalars.count == 2_049)
    for providerError in [
        AOSAXPlatformError(code: "", detail: "missing code"),
        AOSAXPlatformError(code: String(repeating: "x", count: 513), detail: "oversized code"),
        AOSAXPlatformError(code: combiningIdentifier, detail: "combining-scalar code overflow"),
        AOSAXPlatformError(code: "AX_EMPTY_DETAIL", detail: ""),
        AOSAXPlatformError(code: "AX_OVERSIZED", detail: String(repeating: "x", count: 2_049)),
        AOSAXPlatformError(code: "AX_COMBINING_DETAIL", detail: combiningDetail),
    ] {
        let invalidProviderHarness = Harness()
        invalidProviderHarness.provider.rootError = providerError
        do {
            _ = try invalidProviderHarness.engine.observe(request(.systemWide, pageSize: 1))
            preconditionFailure("invalid provider error must be rejected")
        } catch { precondition(error as? AOSAXObservationError == .invalidRoot) }
        precondition(invalidProviderHarness.store.retainedCounts().snapshots == 0)
    }

    let overflowHarness = Harness(ttl: 10, clockStart: UInt64.max - 5)
    do {
        _ = try overflowHarness.engine.observe(request(.systemWide, bounds: bounds(deadline: 1), pageSize: 8))
        preconditionFailure("overflowing monotonic expiry must fail closed")
    } catch let error as AOSAXObservationError {
        precondition(error == .invalidRetention)
    } catch {
        preconditionFailure("unexpected monotonic expiry failure")
    }
    precondition(overflowHarness.store.retainedCounts().snapshots == 0)

    let concurrent = Harness(maxSnapshots: 32)
    concurrent.enableReleaseReentry()
    let concurrentRequest = request(.systemWide, pageSize: 1)
    let box = ResponseBox()
    DispatchQueue.concurrentPerform(iterations: 8) { _ in
        box.append(try! concurrent.engine.observe(concurrentRequest))
    }
    let concurrentResponses = box.snapshot()
    precondition(concurrentResponses.count == 8)
    precondition(Set(concurrentResponses.map(\.stateID)).count == 8)
    DispatchQueue.concurrentPerform(iterations: concurrentResponses.count) { index in
        let response = concurrentResponses[index]
        let page = concurrent.engine.page(
            token: response.nextPageToken!,
            expectedStateID: response.stateID,
            requestDigest: response.requestDigest,
            projectionDigest: response.projectionDigest,
            pageSize: 1
        )
        precondition(page.status == "ok")
    }
    precondition(concurrent.store.retainedCounts().snapshots == 8)
    _ = concurrent.store.removeAll()
    precondition(concurrent.provider.retainCount() == concurrent.provider.releaseCount())

    _ = primary.store.removeAll()
    _ = constituentBoundHarness.store.removeAll()
    _ = mismatchHarness.store.removeAll()
    _ = settlementHarness.store.removeAll()
    _ = admissionDeadlineHarness.store.removeAll()
    _ = traversalDeadlineHarness.store.removeAll()
    _ = unsupportedHarness.store.removeAll()
    _ = deadlineHarness.store.removeAll()
    _ = lateRootHarness.store.removeAll()
    _ = lateValueHarness.store.removeAll()
    _ = lateSettableHarness.store.removeAll()
    _ = evictionHarness.store.removeAll()
    _ = expiryHarness.store.removeAll()
    _ = borrowExpiryHarness.store.removeAll()
    _ = borrowEvictionHarness.store.removeAll()
    _ = errorHarness.store.removeAll()
    _ = refCapacityHarness.store.removeAll()
    _ = valueCapacityHarness.store.removeAll()
    _ = rollbackHarness.store.removeAll()
    _ = filterProjectionHarness.store.removeAll()
    _ = frontierBudgetHarness.store.removeAll()
    _ = duplicateNamesHarness.store.removeAll()
    _ = queuedDuplicateHarness.store.removeAll()
    _ = scalarDistinctHarness.store.removeAll()
    _ = cancellationHarness.store.removeAll()
    precondition(primary.provider.retainCount() == primary.provider.releaseCount())
    precondition(lateRootHarness.provider.retainCount() == lateRootHarness.provider.releaseCount())
    precondition(lateValueHarness.provider.retainCount() == lateValueHarness.provider.releaseCount())
    precondition(lateSettableHarness.provider.retainCount() == lateSettableHarness.provider.releaseCount())
    precondition(filterProjectionHarness.provider.retainCount() == filterProjectionHarness.provider.releaseCount())
    precondition(duplicateNamesHarness.provider.retainCount() == duplicateNamesHarness.provider.releaseCount())
    precondition(queuedDuplicateHarness.provider.retainCount() == queuedDuplicateHarness.provider.releaseCount())
    precondition(scalarDistinctHarness.provider.retainCount() == scalarDistinctHarness.provider.releaseCount())
    precondition(cancellationHarness.provider.retainCount() == cancellationHarness.provider.releaseCount())
    for reentrantHarness in [
        evictionHarness,
        expiryHarness,
        borrowExpiryHarness,
        borrowEvictionHarness,
        tokenCollisionHarness,
        concurrent,
    ] {
        precondition(reentrantHarness.provider.retainCount() == reentrantHarness.provider.releaseCount())
    }
}

run()
`;

function validateWithSchema(instance) {
  const result = spawnSync('python3', [
    '-c',
    String.raw`
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator
schema = json.loads(Path(sys.argv[1]).read_text())
instance = json.loads(sys.stdin.read())
errors = sorted(Draft202012Validator(schema).iter_errors(instance), key=lambda error: list(error.path))
if errors:
    for error in errors:
        print(error.json_path + ': ' + error.message, file=sys.stderr)
    sys.exit(1)
`,
    schemaPath,
  ], { cwd: repoRoot, input: JSON.stringify(instance), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function validateDefinitionCases(definition, instances) {
  const result = spawnSync('python3', [
    '-c',
    String.raw`
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator
schema = json.loads(Path(sys.argv[1]).read_text())
definition = sys.argv[2]
wrapper = {"$ref": f"#/$defs/{definition}", "$defs": schema["$defs"]}
validator = Draft202012Validator(wrapper)
instances = json.loads(sys.stdin.read())
print(json.dumps([validator.is_valid(instance) for instance in instances]))
`,
    schemaPath,
    definition,
  ], { cwd: repoRoot, input: JSON.stringify(instances), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('production AX engine owns five-root traversal, values, immutable pages, retention, and cleanup', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-ax-complete-surface-'));
  const main = path.join(root, 'main.swift');
  const executable = path.join(root, 'ax-complete-surface-proof');
  try {
    await writeFile(main, harness);
    execFileSync('/usr/bin/swiftc', [
      '-warnings-as-errors',
      '-module-cache-path', path.join(root, 'module-cache'),
      ...sources,
      main,
      '-o', executable,
    ], { cwd: repoRoot, stdio: 'pipe', timeout: 25 * 60 * 1000 });
    const output = execFileSync(executable, [], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 25 * 60 * 1000,
      maxBuffer: 16 * 1024 * 1024,
    });
    const instances = output.trim().split('\n').map((line) => JSON.parse(line));
    assert.ok(instances.length >= 25);
    for (const instance of instances) validateWithSchema(instance);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('M4B source keeps the store injectable and does not claim public routing', async () => {
  const [codec, engine, store, schema] = await Promise.all([
    readFile(sources[0], 'utf8'),
    readFile(sources[2], 'utf8'),
    readFile(sources[1], 'utf8'),
    readFile(schemaPath, 'utf8'),
  ]);
  assert.match(engine, /store: AOSAXSnapshotStore<Provider\.Handle>/u);
  assert.doesNotMatch(engine, /AOSAXSnapshotStore\s*\(/u);
  assert.doesNotMatch(engine, /private let (?:monotonicClock|wallClock|retention)/u);
  assert.match(store, /beginObservation|wallClock|observationLimits/u);
  assert.match(store, /one|serialized|NSLock/iu);
  assert.doesNotMatch(engine + store, /daemon-request|daemon-response|src\/main|command route/iu);
  assert.match(schema, /not a public daemon or CLI route/iu);
  const dataCase = codec.indexOf('case .data');
  assert.ok(codec.indexOf('encodedLength', dataCase) < codec.indexOf('base64EncodedString()', dataCase));
  const contract = JSON.parse(schema);
  assert.equal(contract.$defs.bounds.properties.max_visited.maximum, 65_536);
  assert.equal(contract.$defs.observation_request.properties.page_size.maximum, 4_096);
  assert.equal(contract.$defs.observation_response.properties.nodes.maxItems, 4_096);
  assert.equal(contract.$defs.bounded_string.maxLength, 512);
  assert.ok(contract.$defs.stop_condition.properties.kind.enum.includes('snapshot_expired'));
  for (const definition of ['observation_request', 'page_request']) {
    const cases = requestAdmissionCorpus.filter((entry) => entry.definition === definition);
    assert.deepEqual(
      validateDefinitionCases(definition, cases.map(({ value }) => value)),
      cases.map(({ valid }) => valid),
    );
  }
  const generation = { pid: 100, start_time_seconds: 10, start_time_microseconds: 1 };
  const validRootIdentities = [
    { kind: 'system_wide' },
    { kind: 'application', generation },
    { kind: 'window', generation, window_id: 10 },
    { kind: 'element', source_state_id: 'state', source_ref: 'ref' },
    { kind: 'display_composite', topology_identity: 'topology', constituent_count: 2 },
  ];
  const missingRootFields = [
    {},
    { kind: 'application' },
    { kind: 'window', generation },
    { kind: 'element', source_state_id: 'state' },
    { kind: 'display_composite', topology_identity: 'topology' },
  ];
  const crossKindRootFields = [
    { kind: 'system_wide', generation },
    { kind: 'application', generation, window_id: 10 },
    { kind: 'window', generation, window_id: 10, source_ref: 'ref' },
    { kind: 'element', source_state_id: 'state', source_ref: 'ref', generation },
    { kind: 'display_composite', topology_identity: 'topology', constituent_count: 2, source_state_id: 'state' },
  ];
  assert.deepEqual(validateDefinitionCases('root_identity', validRootIdentities), Array(5).fill(true));
  assert.deepEqual(validateDefinitionCases('root_identity', missingRootFields), Array(5).fill(false));
  assert.deepEqual(validateDefinitionCases('root_identity', crossKindRootFields), Array(5).fill(false));
  assert.deepEqual(validateDefinitionCases('filter', [
    { role: 'x'.repeat(512), relationship_membership: '' },
    { role: 'x'.repeat(513) },
    { relationship_membership: 'x'.repeat(513) },
  ]), [true, false, false]);
  assert.deepEqual(validateDefinitionCases('element_facts', [
    { title: 'x'.repeat(512) },
    { title: 'x'.repeat(513) },
  ]), [true, false]);
});
