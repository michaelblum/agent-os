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
    var forbiddenAtOrAfter: UInt64?
    private var calls = 0
    private var retains = 0
    private var releases = 0
    private var lateCalls = 0

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
        if relationshipPlatformError {
            return .platformError(.init(code: "AX_FAKE_RELATIONSHIP", detail: "fake relationship failure"))
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
        if rollbackAttribute { return .value(["RollbackArray"]) }
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
        switch name {
        case "RollbackArray": return .value(.array([.element(99), .unknownType("late failure")]))
        case "Boolean": return .value(.boolean(true))
        case "Signed": return .value(.signedInteger(-4))
        case "Unsigned": return .value(.unsignedInteger(4))
        case "Float": return .value(.floatingPoint(1.5))
        case "String", "Title": return .value(.string("value-\(handle)"))
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

    func retain(handle: Int) { lock.held { retains += 1 } }
    func release(handle: Int) { lock.held { releases += 1 } }
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
        invalidTokenIdentities: Bool = false,
        tokenIdentity: AOSAXPageTokenIdentity? = nil
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
            maxVisited: min(64, maxRefs),
            maxEmitted: min(64, maxRefs),
            maxDeadlineNanoseconds: 1_000,
            maxArrayDepth: 8,
            maxArrayItems: 64,
            maxValueCost: min(100_000, maxValueCost),
            maxPageSize: min(64, maxRefs),
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
            refIDFactory: { [ids] in ids.next("ref") }
        )
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

final class ResponseBox: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [AOSAXObservationResponse] = []
    func append(_ value: AOSAXObservationResponse) { lock.held { values.append(value) } }
    func snapshot() -> [AOSAXObservationResponse] { lock.held { values } }
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
    if base.accounting.emitted != 4 || base.accounting.cycleEdges != 1 || base.accounting.duplicateEdges != 1 {
        fatalError("unexpected base accounting \(base.accounting)")
    }
    precondition(base.nodes.count == 2)
    precondition(base.nextPageToken != nil)
    precondition(base.retention.pageSize == 2)
    let root = base.nodes[0]
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
    precondition(secondPage.nodes.last?.referenceEdges.map(\.kind) == [.duplicate])
    precondition(primary.provider.callCount() == providerCallsBeforePages)
    emit(secondPage)
    let consumed = primary.engine.page(firstPageRequest)
    precondition(consumed.error?.kind == .tokenConsumed)
    emit(consumed)
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

    let mismatchHarness = Harness()
    mismatchHarness.generations.changeAfterFirst = [100]
    let mismatch = try! mismatchHarness.engine.observe(request(.application(gen100), pageSize: 8))
    precondition(mismatch.outcome == .unavailable)
    precondition(mismatch.stopCondition.kind == .generationMismatch)
    precondition(mismatch.nodes.isEmpty)
    precondition(mismatch.retention.retainedRefCount == 0)
    emit(mismatch)

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
        "AX_PROCESS_GENERATION_MISMATCH", "AX_FINAL_UNAVAILABLE_200", "AX_DEADLINE_EXCEEDED",
    ])
    precondition(settlement.frontier.map(\.reason) == [.generationMismatch, .platformUnavailable, .deadline])
    precondition(settlement.frontier.compactMap(\.constituentID) == [
        "application-0-pid-100", "application-1-pid-200", "application-2-pid-300",
    ])
    emit(settlement)

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
    emit(emitBound)
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
    precondition(attribute("BigArray", in: arrayBound.nodes[0]).outcome == .arrayBound)
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

    let rollbackHarness = Harness()
    rollbackHarness.provider.rollbackAttribute = true
    let attributesOnly = AOSAXProjectionSelection(
        attributes: true,
        parameterizedAttributeNames: false,
        settableFacts: false,
        supportedActionNames: false,
        relationshipNames: false
    )
    let rollback = try! rollbackHarness.engine.observe(request(
        .systemWide,
        bounds: bounds(visited: 1),
        projection: attributesOnly,
        pageSize: 1
    ))
    precondition(attribute("RollbackArray", in: rollback.nodes[0]).outcome == .unrepresentableType)
    precondition(rollback.retention.retainedRefCount == 1)
    precondition(rollbackHarness.provider.retainCount() - rollbackHarness.provider.releaseCount() == 1)

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
    emit(deadline)

    let evictionHarness = Harness(maxSnapshots: 1)
    let evictedSource = try! evictionHarness.engine.observe(request(.systemWide, pageSize: 1))
    let evictedToken = evictedSource.nextPageToken!
    _ = try! evictionHarness.engine.observe(request(.systemWide, pageSize: 8))
    let evictedPage = evictionHarness.engine.page(
        token: evictedToken,
        expectedStateID: evictedSource.stateID,
        requestDigest: evictedSource.requestDigest,
        projectionDigest: evictedSource.projectionDigest,
        pageSize: 1
    )
    precondition(evictedPage.error?.kind == .tokenEvicted)
    emit(evictedPage)
    let staleElement = try! evictionHarness.engine.observe(request(
        .element(stateID: evictedSource.stateID, ref: evictedSource.nodes[0].ref),
        pageSize: 8
    ))
    precondition(staleElement.outcome == .unavailable)
    precondition(staleElement.stopCondition.kind == .sourceSnapshotEvicted)
    emit(staleElement)

    let expiryHarness = Harness(ttl: 10)
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

    let borrowExpiryHarness = Harness(ttl: 10, maxBorrows: 1)
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
    precondition((try? decoder.decode(AOSAXObservationRequest.self, from: encodedRequest)) != nil)
    let invalidJSON = String(data: encodedRequest, encoding: .utf8)!
        .replacingOccurrences(of: "\"start_time_microseconds\":1", with: "\"start_time_microseconds\":1000000")
    precondition(invalidJSON.contains("\"start_time_microseconds\":1000000"))
    do {
        _ = try decoder.decode(AOSAXObservationRequest.self, from: Data(invalidJSON.utf8))
        preconditionFailure("decoded microsecond overflow must be rejected")
    } catch {}
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
    for providerError in [
        AOSAXPlatformError(code: "", detail: "missing code"),
        AOSAXPlatformError(code: String(repeating: "x", count: 513), detail: "oversized code"),
        AOSAXPlatformError(code: "AX_EMPTY_DETAIL", detail: ""),
        AOSAXPlatformError(code: "AX_OVERSIZED", detail: String(repeating: "x", count: 2_049)),
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
    _ = mismatchHarness.store.removeAll()
    _ = settlementHarness.store.removeAll()
    _ = unsupportedHarness.store.removeAll()
    _ = deadlineHarness.store.removeAll()
    _ = evictionHarness.store.removeAll()
    _ = expiryHarness.store.removeAll()
    _ = borrowExpiryHarness.store.removeAll()
    _ = borrowEvictionHarness.store.removeAll()
    _ = errorHarness.store.removeAll()
    _ = refCapacityHarness.store.removeAll()
    _ = valueCapacityHarness.store.removeAll()
    _ = rollbackHarness.store.removeAll()
    precondition(primary.provider.retainCount() == primary.provider.releaseCount())
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
});
