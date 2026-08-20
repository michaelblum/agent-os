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
    var generations: [Int32: AOSAXProcessGeneration]
    var changeAfterFirst: Set<Int32> = []
    private var counts: [Int32: Int] = [:]

    init(_ generations: [Int32: AOSAXProcessGeneration]) {
        self.generations = generations
    }

    func observeGeneration(pid: Int32) -> AOSAXGenerationObservation {
        lock.held {
            let count = (counts[pid] ?? 0) + 1
            counts[pid] = count
            guard let generation = generations[pid] else {
                return .unavailable(.init(code: "AX_PROCESS_MISSING", detail: "fake process is absent"))
            }
            if changeAfterFirst.contains(pid), count > 1 {
                return .value(.init(
                    pid: generation.pid,
                    startTimeSeconds: generation.startTimeSeconds + 1,
                    startTimeMicroseconds: generation.startTimeMicroseconds
                ))
            }
            return .value(generation)
        }
    }
}

final class FakeProvider: @unchecked Sendable, AOSAXPlatformProvider {
    typealias Handle = Int
    private let lock = NSLock()
    let clock: FakeClock
    var advancePerCall: UInt64 = 0
    var systemUnsupported = false
    var unavailableApplications: Set<Int32> = []
    private var calls = 0
    private var retains = 0
    private var releases = 0

    init(clock: FakeClock) { self.clock = clock }

    private func called() {
        lock.held { calls += 1 }
        if advancePerCall > 0 { clock.advance(advancePerCall) }
    }

    func callCount() -> Int { lock.held { calls } }
    func retainCount() -> Int { lock.held { retains } }
    func releaseCount() -> Int { lock.held { releases } }

    func systemWideRoot(deadlineNanoseconds: UInt64) -> AOSAXPlatformResult<Int> {
        called()
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
        deadlineNanoseconds: UInt64
    ) -> AOSAXPlatformResult<[AOSAXPlatformRelationship<Int>]> {
        called()
        switch handle {
        case 1:
            return .value([
                .init(name: "ZChildren", elements: [4, 5]),
                .init(name: "AChildren", elements: [3, 5]),
            ])
        case 3:
            return .value([.init(name: "Parent", elements: [1])])
        case 6:
            return .value([.init(name: "Children", elements: [7])])
        case 7:
            return .value([.init(name: "Children", elements: [8])])
        default:
            return .value([])
        }
    }

    func attributeNames(for handle: Int, deadlineNanoseconds: UInt64) -> AOSAXPlatformResult<[String]> {
        called()
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
        case "Error": return .platformError(.init(code: "AX_FAKE_READ", detail: "fake read error"))
        default: return .unsupported
        }
    }

    func parameterizedAttributeNames(
        for handle: Int,
        deadlineNanoseconds: UInt64
    ) -> AOSAXPlatformResult<[String]> {
        called()
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
        clockStart: UInt64 = 1_000,
        invalidTokenIdentities: Bool = false
    ) {
        clock = FakeClock(clockStart)
        let gen100 = AOSAXProcessGeneration(pid: 100, startTimeSeconds: 10, startTimeMicroseconds: 1)
        let gen200 = AOSAXProcessGeneration(pid: 200, startTimeSeconds: 20, startTimeMicroseconds: 2)
        provider = FakeProvider(clock: clock)
        generations = FakeGenerationObserver([100: gen100, 200: gen200])
        retention = try! AOSAXRetentionConfiguration(
            snapshotTTLNanoseconds: ttl,
            maxSnapshots: maxSnapshots,
            maxRetainedRefs: maxRefs,
            maxRetainedValueCost: maxValueCost,
            maxPageTokens: maxTokens,
            maxTombstones: maxTombstones
        )
        store = AOSAXSnapshotStore(
            configuration: retention,
            monotonicClock: { [clock] in clock.read() },
            tokenFactory: { [ids] in
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
            retention: retention,
            monotonicClock: { [clock] in clock.read() },
            wallClock: { Date(timeIntervalSince1970: 1_700_000_000) },
            stateIDFactory: { [ids] in ids.next("state") },
            refIDFactory: { [ids] in ids.next("ref") }
        )
    }
}

func bounds(
    depth: Int = 8,
    visited: Int = 64,
    emitted: Int = 64,
    deadline: UInt64 = 1_000,
    arrayDepth: Int = 8,
    arrayItems: Int = 64,
    valueCost: Int = 100_000
) -> AOSAXObservationBounds {
    try! .init(
        maxDepth: depth,
        maxVisited: visited,
        maxEmitted: emitted,
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
    pageSize: Int = 2
) -> AOSAXObservationRequest {
    try! .init(root: root, bounds: requestBounds, filters: filters, pageSize: pageSize)
}

func emit<T: Encodable>(_ value: T) {
    let data = try! AOSAXObservationJSON.encode(value)
    print(String(decoding: data, as: UTF8.self))
}

func attribute(_ name: String, in node: AOSAXNodeProjection) -> AOSAXAttributeProjection {
    node.attributes.first(where: { $0.name == name })!
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
    precondition(base.outcome == .complete)
    precondition(base.accounting.visited == 4)
    precondition(base.accounting.emitted == 4)
    precondition(base.accounting.cycleEdges == 1)
    precondition(base.accounting.duplicateEdges == 1)
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
    emit(element)

    let gen100 = AOSAXProcessGeneration(pid: 100, startTimeSeconds: 10, startTimeMicroseconds: 1)
    let gen200 = AOSAXProcessGeneration(pid: 200, startTimeSeconds: 20, startTimeMicroseconds: 2)
    let application = try! primary.engine.observe(request(.application(gen100), pageSize: 8))
    precondition(application.outcome == .complete)
    emit(application)
    let window = try! primary.engine.observe(request(.window(generation: gen100, windowID: 10), pageSize: 8))
    precondition(window.outcome == .complete)
    emit(window)
    let composite = try! primary.engine.observe(request(.displayComposite(
        topologyIdentity: "topology-1",
        applications: [gen100, .init(pid: 999, startTimeSeconds: 99, startTimeMicroseconds: 9), gen200]
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

    let unsupportedHarness = Harness()
    unsupportedHarness.provider.systemUnsupported = true
    let unsupported = try! unsupportedHarness.engine.observe(request(.systemWide, pageSize: 8))
    precondition(unsupported.outcome == .unsupported)
    emit(unsupported)
    let unavailable = try! unsupportedHarness.engine.observe(request(
        .application(.init(pid: 999, startTimeSeconds: 99, startTimeMicroseconds: 9)),
        pageSize: 8
    ))
    precondition(unavailable.outcome == .unavailable)
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

    let depthBound = try! primary.engine.observe(request(.application(gen200), bounds: bounds(depth: 1), pageSize: 16))
    precondition(depthBound.outcome == .truncated)
    precondition(depthBound.frontier.contains(where: { $0.reason == .depthBound }))
    emit(depthBound)
    let visitBound = try! primary.engine.observe(request(.systemWide, bounds: bounds(visited: 1), pageSize: 16))
    precondition(visitBound.outcome == .truncated)
    precondition(visitBound.stopCondition.kind == .visitedBound)
    emit(visitBound)
    let emitBound = try! primary.engine.observe(request(.systemWide, bounds: bounds(emitted: 1), pageSize: 16))
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
    emit(valueBound)

    let deadlineHarness = Harness()
    deadlineHarness.provider.advancePerCall = 1
    let deadline = try! deadlineHarness.engine.observe(request(
        .systemWide,
        bounds: bounds(deadline: 4),
        pageSize: 8
    ))
    precondition(deadline.outcome == .truncated)
    precondition(deadline.stopCondition.kind == .deadline)
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

    let refCapacityHarness = Harness(maxRefs: 1)
    let refCapacity = try! refCapacityHarness.engine.observe(request(.systemWide, pageSize: 8))
    precondition(refCapacity.outcome == .unavailable)
    precondition(refCapacity.stopCondition.kind == .retentionLimit)
    emit(refCapacity)
    let valueCapacityHarness = Harness(maxValueCost: 1)
    let valueCapacity = try! valueCapacityHarness.engine.observe(request(.systemWide, pageSize: 8))
    precondition(valueCapacity.outcome == .unavailable)
    precondition(valueCapacity.stopCondition.kind == .retentionLimit)
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
    _ = unsupportedHarness.store.removeAll()
    _ = deadlineHarness.store.removeAll()
    _ = evictionHarness.store.removeAll()
    _ = expiryHarness.store.removeAll()
    _ = refCapacityHarness.store.removeAll()
    _ = valueCapacityHarness.store.removeAll()
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
  const [engine, store, schema] = await Promise.all([
    readFile(sources[2], 'utf8'),
    readFile(sources[1], 'utf8'),
    readFile(schemaPath, 'utf8'),
  ]);
  assert.match(engine, /store: AOSAXSnapshotStore<Provider\.Handle>/u);
  assert.doesNotMatch(engine, /AOSAXSnapshotStore\s*\(/u);
  assert.match(store, /one|serialized|NSLock/iu);
  assert.doesNotMatch(engine + store, /daemon-request|daemon-response|src\/main|command route/iu);
  assert.match(schema, /not a public daemon or CLI route/iu);
});
