import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  applyOperationControlMessage,
  createOperationControlModel,
  operationControlCounts,
} from '../packages/toolkit/components/operation-control/model.js'

const repoRoot = path.resolve(import.meta.dirname, '..')
const daemonRoot = path.join(repoRoot, 'src/daemon')
const sources = [
  path.join(repoRoot, 'src/perceive/display-topology.swift'),
  path.join(daemonRoot, 'public-capture-transfer.swift'),
  path.join(daemonRoot, 'screen-recording-geometry.swift'),
  path.join(daemonRoot, 'screen-recording-follow-geometry.swift'),
  ...[
  'operation-owner-root.swift',
  'operation-spawn-record.swift',
  'operation-state.swift',
  'operation-store.swift',
  'operation-registry.swift',
  'operation-resource-broker.swift',
  'operation-resource-transaction.swift',
  'operation-resource-claim.swift',
  'operation-control.swift',
  'operation-recovery.swift',
  'operation-status-item-projection.swift',
  'operation-canvas-projection.swift',
  ].map((name) => path.join(daemonRoot, name)),
]

async function compileAndRunHarness(source) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-operation-projections-'))
  const support = path.join(root, 'Support.swift')
  const main = path.join(root, 'main.swift')
  const executable = path.join(root, 'operation-projections')
  try {
    await Promise.all([
      writeFile(support, String.raw`
import CoreGraphics
import Foundation
struct CaptureApplicationFact { let applicationName: String; let processID: pid_t }
struct CaptureWindowFact {
  let frame: CGRect; let owningApplication: CaptureApplicationFact?
  let title: String?; let windowID: Int; let windowLayer: Int
}
`),
      writeFile(main, source),
    ])
    execFileSync('swiftc', [
      '-warnings-as-errors',
      '-module-cache-path', path.join(root, 'module-cache'),
      ...sources,
      support,
      main,
      '-o', executable,
    ], { cwd: repoRoot, stdio: 'pipe' })
    execFileSync(executable, [], { cwd: repoRoot, stdio: 'pipe' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('native status and Canvas projections preserve authenticated origin boundaries', async () => {
  await compileAndRunHarness(String.raw`
import Foundation

final class FakeAdapter: AOSOperationControlAdapter {
    let registration: AOSOperationAdapterRegistration
    init(_ registration: AOSOperationAdapterRegistration) { self.registration = registration }
    func requestStop(operation: AOSOperationIdentity, force: Bool) -> AOSAdapterStopResult {
        AOSAdapterStopResult(disposition: .absent, residualDigest: nil)
    }
    func residualDigest(operation: AOSOperationIdentity) -> String? { nil }
}

final class ThreadRecordingStore: AOSOperationStateStore {
    private let backing = AOSInMemoryOperationStateStore()
    private let lock = NSLock()
    private var observe = false
    private var blockNextObservedSave = false
    private var observedSaveIsBlocked = false
    private var observedSaveCount = 0
    private var observedMainThreadSave = false
    private let blockedSaveEntered = DispatchSemaphore(value: 0)
    private let blockedSaveRelease = DispatchSemaphore(value: 0)

    func load() throws -> AOSOperationDurableState? { try backing.load() }

    func save(_ state: AOSOperationDurableState) throws {
        lock.lock()
        let shouldBlock = observe && blockNextObservedSave
        if observe {
            observedSaveCount += 1
            observedMainThreadSave = observedMainThreadSave || Thread.isMainThread
        }
        if shouldBlock { blockNextObservedSave = false }
        lock.unlock()
        if shouldBlock {
            lock.lock()
            observedSaveIsBlocked = true
            lock.unlock()
            blockedSaveEntered.signal()
            blockedSaveRelease.wait()
            lock.lock()
            observedSaveIsBlocked = false
            lock.unlock()
        }
        try backing.save(state)
    }

    func beginObservation(blockFirstSave: Bool = false) {
        lock.lock()
        observe = true
        blockNextObservedSave = blockFirstSave
        observedSaveCount = 0
        observedMainThreadSave = false
        lock.unlock()
    }

    func waitForBlockedSave() -> Bool {
        blockedSaveEntered.wait(timeout: .now() + 5) == .success
    }

    func releaseBlockedSave() { blockedSaveRelease.signal() }

    func isObservedSaveBlocked() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return observedSaveIsBlocked
    }

    func observation() -> (saveCount: Int, includedMainThread: Bool) {
        lock.lock()
        defer { lock.unlock() }
        return (observedSaveCount, observedMainThreadSave)
    }

    func endObservation() -> (saveCount: Int, includedMainThread: Bool) {
        lock.lock()
        defer { lock.unlock() }
        observe = false
        return (observedSaveCount, observedMainThreadSave)
    }
}

final class FakeStatusItemHost: AOSOperationInternalStatusItemHosting {
    private let lock = NSLock()
    private var storedItemGeneration: UInt64 = 0
    private var storedDescriptorRevision: UInt64 = 0
    private var handler: ((AOSOperationInternalStatusItemActionEvidence) -> Void)?
    private var storedSnapshot: AOSOperationStatusItemSnapshot?
    private var storedFailureCode: String?
    private var storedControlFailureCode: String?
    private var storedPublicationEvents: [(String, UInt64)] = []
    private var blockNextSnapshotUpdate = false
    private let blockedSnapshotUpdateEntered = DispatchSemaphore(value: 0)
    private let blockedSnapshotUpdateRelease = DispatchSemaphore(value: 0)

    var itemGeneration: UInt64 {
        lock.lock(); defer { lock.unlock() }
        return storedItemGeneration
    }
    var descriptorRevision: UInt64 {
        lock.lock(); defer { lock.unlock() }
        return storedDescriptorRevision
    }
    var snapshot: AOSOperationStatusItemSnapshot? {
        lock.lock(); defer { lock.unlock() }
        return storedSnapshot
    }
    var failureCode: String? {
        lock.lock(); defer { lock.unlock() }
        return storedFailureCode
    }
    var controlFailureCode: String? {
        lock.lock(); defer { lock.unlock() }
        return storedControlFailureCode
    }
    var publicationEvents: [(String, UInt64)] {
        lock.lock(); defer { lock.unlock() }
        return storedPublicationEvents
    }

    func install(
        itemGeneration: UInt64,
        descriptorRevision: UInt64,
        onAction: @escaping (AOSOperationInternalStatusItemActionEvidence) -> Void
    ) {
        lock.lock()
        storedItemGeneration = itemGeneration
        storedDescriptorRevision = descriptorRevision
        handler = onAction
        lock.unlock()
    }

    func update(snapshot: AOSOperationStatusItemSnapshot, descriptorRevision: UInt64) {
        lock.lock()
        let shouldBlock = blockNextSnapshotUpdate
        blockNextSnapshotUpdate = false
        lock.unlock()
        if shouldBlock {
            blockedSnapshotUpdateEntered.signal()
            blockedSnapshotUpdateRelease.wait()
        }
        lock.lock()
        storedSnapshot = snapshot
        storedDescriptorRevision = descriptorRevision
        storedFailureCode = nil
        storedControlFailureCode = nil
        storedPublicationEvents.append(("snapshot", descriptorRevision))
        lock.unlock()
    }

    func updateFailure(code: String, descriptorRevision: UInt64) {
        lock.lock()
        storedSnapshot = nil
        storedFailureCode = code
        storedDescriptorRevision = descriptorRevision
        storedPublicationEvents.append(("failure", descriptorRevision))
        lock.unlock()
    }

    func updateControlFailure(code: String, descriptorRevision: UInt64) {
        lock.lock()
        storedControlFailureCode = code
        storedDescriptorRevision = descriptorRevision
        storedPublicationEvents.append(("control_failure", descriptorRevision))
        lock.unlock()
    }

    func teardown() {
        lock.lock()
        handler = nil
        lock.unlock()
    }

    func emit(
        _ action: AOSOperationInternalStatusItemAction,
        sequence: UInt64,
        revision: UInt64? = nil,
        generation: UInt64? = nil,
        barrierGeneration: UInt64? = nil
    ) {
        lock.lock()
        let callback = handler
        let evidence = AOSOperationInternalStatusItemActionEvidence(
            action: action,
            itemGeneration: generation ?? storedItemGeneration,
            descriptorRevision: revision ?? storedDescriptorRevision,
            actionSequence: sequence,
            expectedBarrierGeneration: barrierGeneration ?? storedSnapshot?.barrierGeneration ?? 0
        )
        lock.unlock()
        callback?(evidence)
    }

    func blockNextSnapshotPublication() {
        lock.lock()
        blockNextSnapshotUpdate = true
        lock.unlock()
    }

    func waitForBlockedSnapshotPublication() -> Bool {
        blockedSnapshotUpdateEntered.wait(timeout: .now() + 5) == .success
    }

    func releaseBlockedSnapshotPublication() {
        blockedSnapshotUpdateRelease.signal()
    }
}

final class FakeCanvasHost: AOSOperationCanvasHosting {
    var nextCanvas = AOSOperationCanvasIdentity(id: "status-canvas", generation: 21)
    var posted: [(AOSOperationCanvasIdentity, [String: Any])] = []

    func openOperationControlCanvas() throws -> AOSOperationCanvasIdentity { nextCanvas }
    func postOperationControlMessage(
        to canvas: AOSOperationCanvasIdentity,
        payload: [String: Any]
    ) -> Bool {
        posted.append((canvas, payload))
        return true
    }

    func last(for canvas: AOSOperationCanvasIdentity) -> [String: Any] {
        posted.last(where: { $0.0 == canvas })!.1
    }
}

func expectProjectionError(
    _ expected: AOSOperationProjectionError,
    _ body: () throws -> Void
) {
    do {
        try body()
        preconditionFailure("expected \(expected)")
    } catch let actual as AOSOperationProjectionError {
        precondition(actual == expected)
    } catch {
        preconditionFailure("unexpected \(error)")
    }
}

func waitUntil(_ message: String, _ body: () -> Bool) {
    let deadline = Date().addingTimeInterval(5)
    while !body() && Date() < deadline {
        Thread.sleep(forTimeInterval: 0.01)
    }
    precondition(body(), message)
}

let recordingRegistration = AOSOperationAdapterRegistration(
    id: "recording-adapter",
    revision: 4,
    operationClass: "capture",
    capabilityIDs: ["recording-capability"],
    resourceDeclarations: []
)
let neutralRegistration = AOSOperationAdapterRegistration(
    id: "neutral-adapter",
    revision: 2,
    operationClass: "tool",
    capabilityIDs: ["neutral-capability"],
    resourceDeclarations: []
)
let adapterRegistry = try AOSAdapterRegistrySnapshot.make(
    revision: 9,
    registrations: [recordingRegistration, neutralRegistration]
)
let indicators = try AOSOperationStatusIndicatorRegistry(bindings: [
    try AOSOperationStatusIndicatorBinding(
        registration: recordingRegistration,
        capabilityID: "recording-capability",
        indicatorClass: .recording
    ),
    try AOSOperationStatusIndicatorBinding(
        registration: neutralRegistration,
        capabilityID: "neutral-capability",
        indicatorClass: .neutral
    ),
])
expectProjectionError(.indicatorRegistryConflict) {
    _ = try AOSOperationStatusIndicatorRegistry(bindings: [
        AOSOperationStatusIndicatorBinding(
            adapterRegistrationID: recordingRegistration.id,
            adapterRegistrationRevision: recordingRegistration.revision,
            capabilityID: "recording-capability",
            indicatorClass: .recording
        ),
        AOSOperationStatusIndicatorBinding(
            adapterRegistrationID: recordingRegistration.id,
            adapterRegistrationRevision: recordingRegistration.revision,
            capabilityID: "recording-capability",
            indicatorClass: .neutral
        ),
    ])
}

let store = ThreadRecordingStore()
let recordingAdapter = FakeAdapter(recordingRegistration)
let neutralAdapter = FakeAdapter(neutralRegistration)
var nextID = 0
let registry = try AOSOperationRegistry(
    store: store,
    daemonGeneration: 7,
    adapterRegistry: adapterRegistry,
    adapters: [recordingAdapter, neutralAdapter],
    clock: { 5_000_000_000 },
    idFactory: { nextID += 1; return "id-\(nextID)" }
)
let control = AOSOperationControlPlane(registry: registry, daemonEffectiveUID: 501)
_ = try control.completeBootReconciliation(.open)

let ownerA = AOSMechanicalOwnerRoot(
    ownerID: String(repeating: "a", count: 64),
    effectiveUID: 501,
    pid: 100,
    pidGeneration: 3,
    executableIdentityDigest: String(repeating: "b", count: 64)
)
let ownerB = AOSMechanicalOwnerRoot(
    ownerID: String(repeating: "c", count: 64),
    effectiveUID: 501,
    pid: 200,
    pidGeneration: 4,
    executableIdentityDigest: String(repeating: "d", count: 64)
)
let geometryBounds = AOSDisplayTopologyBounds(x: 0, y: 0, width: 100, height: 80)
let geometryTopology = try buildAOSDisplayTopologySnapshot(
    observation: [AOSDisplayTopologyObservationMember(
        runtimeDisplayID: 1, displayUUID: nil, label: "", isMain: true,
        isMirrored: false, nativeBounds: geometryBounds,
        nativeVisibleBounds: geometryBounds, scaleFactor: 2, rotation: 0
    )],
    screensHaveSeparateSpaces: true
)
let fixedGeometry = AOSScreenRecordingGeometry(
    mode: .fixed,
    geometryGeneration: 1,
    admittedTopology: geometryTopology,
    target: AOSScreenRecordingTarget(
        kind: .display, displayOrdinal: 1,
        displayMemberIdentity: geometryTopology.displays[0].memberIdentity,
        windowID: nil, ownerPID: nil, globalBounds: nil
    ),
    sourceRect: geometryBounds,
    pixelWidth: 200,
    pixelHeight: 160,
    pixelCount: 32_000,
    bindingDigest: String(repeating: "f", count: 64),
    followBinding: nil,
    updateIntervalMilliseconds: nil,
    updateDeadlineMilliseconds: nil
)
let recording = try registry.prepareOperation(
    ownerRoot: ownerA,
    attribution: AOSOperationAttribution(taskID: "asserted-task-a"),
    capabilityID: "recording-capability",
    adapterRegistrationID: recordingRegistration.id,
    adapterRegistrationRevision: recordingRegistration.revision,
    screenRecordingGeometry: .initial(fixedGeometry)
)
_ = try registry.transitionOperation(recording.identity, to: .starting)
_ = try registry.transitionOperation(recording.identity, to: .active)
let neutral = try registry.prepareOperation(
    ownerRoot: ownerB,
    attribution: AOSOperationAttribution(taskID: "asserted-task-b"),
    capabilityID: "neutral-capability",
    adapterRegistrationID: neutralRegistration.id,
    adapterRegistrationRevision: neutralRegistration.revision
)
_ = try registry.transitionOperation(neutral.identity, to: .starting)
_ = try registry.transitionOperation(neutral.identity, to: .active)

var canvasState = registry.snapshot()
canvasState.resourceClaims = [AOSResourceClaimRecord(
    claimID: "claim-microphone",
    transactionID: "transaction-microphone",
    operation: recording.identity,
    daemonGeneration: 7,
    resourceKey: "microphone.input",
    resourceGeneration: 11,
    admissionMode: .exclusive,
    adapterRegistrationID: recordingRegistration.id,
    adapterRegistrationRevision: recordingRegistration.revision,
    resourceDeclarationDigest: String(repeating: "1", count: 64),
    adapterRegistryRevision: adapterRegistry.revision,
    resourceDeclarationSetCount: adapterRegistry.resourceDeclarationSetCount,
    resourceDeclarationSetDigest: adapterRegistry.resourceDeclarationSetDigest,
    committedClaimSetDigest: String(repeating: "2", count: 64),
    brokerID: nil,
    brokerGeneration: nil,
    subscriberID: nil,
    reattachTokenDigest: String(repeating: "3", count: 64),
    state: .active
)]
canvasState.artifacts = [
    AOSArtifactRecord(
        identity: AOSOperationIdentity(id: "artifact-recording", generation: 31),
        parentOperation: recording.identity,
        daemonGeneration: 7,
        state: .offered,
        recoveryOriginState: nil,
        recoveryDisposition: nil,
        custodyDigest: String(repeating: "4", count: 64)
    ),
    AOSArtifactRecord(
        identity: AOSOperationIdentity(id: "artifact-retention", generation: 32),
        parentOperation: recording.identity,
        daemonGeneration: 7,
        state: .recovering,
        recoveryOriginState: .retained,
        recoveryDisposition: .retentionVerification,
        custodyDigest: String(repeating: "5", count: 64)
    ),
]

let activeSnapshot = try AOSOperationStatusItemSnapshot.make(
    state: registry.snapshot(),
    indicatorRegistry: indicators
)
precondition(activeSnapshot.recordingIndicatorIsRed)
precondition(activeSnapshot.counts.recording == 1)
precondition(activeSnapshot.counts.active == 2)
var preparedState = registry.snapshot()
preparedState.operations[0].state = .prepared
let preparedSnapshot = try AOSOperationStatusItemSnapshot.make(
    state: preparedState,
    indicatorRegistry: indicators
)
precondition(!preparedSnapshot.recordingIndicatorIsRed)
preparedState.operations[0].state = .cleanupRequired
let cleanupSnapshot = try AOSOperationStatusItemSnapshot.make(
    state: preparedState,
    indicatorRegistry: indicators
)
precondition(!cleanupSnapshot.recordingIndicatorIsRed)
precondition(cleanupSnapshot.counts.residual == 1)

let statusHostBinding = AOSOperationStatusHostBinding(
    daemonGeneration: 7,
    effectiveUID: 501,
    statusHostID: "internal-operation-status-host",
    statusHostGeneration: 12,
    connectionEpoch: 13
)
let statusHostLease = AOSOperationStatusHostLease(statusHostBinding)
let canvasHost = FakeCanvasHost()
let canvasProjection = try AOSOperationCanvasProjection(
    controlPlane: control,
    readState: { canvasState },
    indicatorRegistry: indicators,
    canvasHost: canvasHost,
    statusHostLease: statusHostLease,
    checkedAt: { "checked" }
)

let ordinaryCanvas = AOSOperationCanvasIdentity(id: "ordinary-canvas", generation: 20)
var ordinaryCaptureIsLive = true
func ordinaryContext() -> AOSOrdinaryControlContext? {
    guard ordinaryCaptureIsLive else { return nil }
    return AOSOrdinaryControlContext(
        expectedDaemonGeneration: 7,
        connectionEpoch: 31,
        caller: .ordinaryCanvasCapturedPeer(AOSOrdinaryCanvasPeerEvidence(
            canvasInstanceID: ordinaryCanvas.id,
            canvasGeneration: ordinaryCanvas.generation,
            captureID: "capture-31",
            capturedConnectionEpoch: 31,
            auditTokenDigest: String(repeating: "e", count: 64),
            effectiveUID: 501,
            pid: ownerA.pid,
            pidGeneration: ownerA.pidGeneration,
            captureIsLive: true
        )),
        authenticatedOwnerRoot: ownerA
    )
}
try canvasProjection.attachOrdinaryCanvas(ordinaryCanvas, resolveContext: ordinaryContext)

func request(_ id: String, _ action: String, _ payload: [String: Any]) -> [String: Any] {
    [
        "schema_version": "aos.canvas-operation-control.request.v1",
        "request_id": id,
        "action": action,
        "payload": payload,
    ]
}

let listResult = canvasProjection.routeMessage(
    canvasID: ordinaryCanvas.id,
    canvasGeneration: ordinaryCanvas.generation,
    message: request("ordinary-list", "list", [
        "filters": ["capability_id": "recording-capability"],
    ])
)
precondition(listResult == .handled)
let ordinaryList = canvasHost.last(for: ordinaryCanvas)
let ordinaryOperations = ordinaryList["operations"] as! [[String: Any]]
precondition(ordinaryOperations.count == 1)
precondition(ordinaryOperations[0]["operation_id"] as? String == recording.identity.id)
precondition(ordinaryOperations[0]["capability_label"] as? String == "")
precondition(ordinaryOperations[0]["status_indicator_class"] as? String == "recording")
let publicRecording = AOSOperationPublicProjection.snapshot(recording, state: canvasState)
let projectedGeometry = publicRecording["geometry"] as! [String: Any]
precondition(projectedGeometry["mode"] as? String == "fixed")
precondition(projectedGeometry["geometry_generation"] as? UInt64 == 1)
precondition(projectedGeometry["pending_update"] as? Bool == false)
let resourceClaims = ordinaryOperations[0]["resource_claims"] as! [[String: Any]]
precondition(resourceClaims.count == 1)
precondition(resourceClaims[0]["claim_id"] as? String == "claim-microphone")
precondition(resourceClaims[0]["resource_key"] as? String == "microphone.input")
precondition(resourceClaims[0]["resource_generation"] as? UInt64 == 11)
precondition(resourceClaims[0]["state"] as? String == "active")
precondition(resourceClaims[0]["broker_id"] is NSNull)
let artifacts = ordinaryOperations[0]["artifacts"] as! [[String: Any]]
precondition(artifacts.count == 2)
precondition(artifacts[0]["artifact_id"] as? String == "artifact-recording")
precondition(artifacts[0]["state"] as? String == "offered")
precondition(artifacts[0]["custody_digest"] as? String == String(repeating: "4", count: 64))
precondition(artifacts[1]["recovery_origin_state"] as? String == "retained")
precondition(artifacts[1]["recovery_disposition"] as? String == "retention_verification")

let crossOwner = canvasProjection.routeMessage(
    canvasID: ordinaryCanvas.id,
    canvasGeneration: ordinaryCanvas.generation,
    message: request("cross-owner", "inspect", [
        "operation_id": neutral.identity.id,
        "operation_generation": neutral.identity.generation,
    ])
)
precondition(crossOwner == .rejected(AOSOperationCoreError.ownerMismatch.code))
let ordinaryHostStop = canvasProjection.routeMessage(
    canvasID: ordinaryCanvas.id,
    canvasGeneration: ordinaryCanvas.generation,
    message: request("ordinary-stop", "stop_all", [
        "expected_barrier_generation": registry.snapshot().barrier.generation,
    ])
)
precondition(ordinaryHostStop == .rejected(AOSOperationProjectionError.unsupportedAction.code))
precondition(registry.snapshot().barrier.state == .open)
let assertedOrigin = canvasProjection.routeMessage(
    canvasID: ordinaryCanvas.id,
    canvasGeneration: ordinaryCanvas.generation,
    message: request("asserted-origin", "list", [
        "filters": [:],
        "caller_origin": "status_item_host",
    ])
)
precondition(assertedOrigin == .rejected(AOSOperationProjectionError.authorityClaimRejected.code))

ordinaryCaptureIsLive = false
let staleOrdinary = canvasProjection.routeMessage(
    canvasID: ordinaryCanvas.id,
    canvasGeneration: ordinaryCanvas.generation,
    message: request("stale", "list", ["filters": [:]])
)
precondition(staleOrdinary == .rejected(AOSOperationProjectionError.capturedPeerUnavailable.code))
ordinaryCaptureIsLive = true

var statusHostLeaseIdentity = statusHostLease.identity()!
var statusCanvas = try canvasProjection.openStatusCanvas(
    statusHostLeaseIdentity: statusHostLeaseIdentity
)
let statusInitial = canvasHost.last(for: statusCanvas)
precondition((statusInitial["operations"] as! [[String: Any]]).count == 2)
let statusCancel = canvasProjection.routeMessage(
    canvasID: statusCanvas.id,
    canvasGeneration: statusCanvas.generation,
    message: request("status-cancel", "cancel", [
        "operation_id": recording.identity.id,
        "operation_generation": recording.identity.generation,
    ])
)
precondition(statusCancel == .rejected(AOSOperationProjectionError.unsupportedAction.code))
statusHostLease.clear()
let staleStatusStop = canvasProjection.routeMessage(
    canvasID: statusCanvas.id,
    canvasGeneration: statusCanvas.generation,
    message: request("stale-status-stop", "stop_all", [
        "expected_barrier_generation": registry.snapshot().barrier.generation,
    ])
)
precondition(staleStatusStop == .rejected(AOSOperationProjectionError.invalidStatusHostBinding.code))
precondition(registry.snapshot().barrier.state == .open)
statusHostLeaseIdentity = try statusHostLease.install(statusHostBinding)
let abaStatusStop = canvasProjection.routeMessage(
    canvasID: statusCanvas.id,
    canvasGeneration: statusCanvas.generation,
    message: request("aba-status-stop", "stop_all", [
        "expected_barrier_generation": registry.snapshot().barrier.generation,
    ])
)
precondition(abaStatusStop == .rejected(AOSOperationProjectionError.invalidStatusHostBinding.code))
canvasProjection.detachCanvas(statusCanvas)
expectProjectionError(.invalidStatusHostBinding) {
    _ = try canvasProjection.openStatusCanvas(
        statusHostLeaseIdentity: AOSOperationStatusHostLeaseIdentity(
            binding: statusHostBinding,
            epoch: statusHostLeaseIdentity.epoch - 2
        )
    )
}
statusCanvas = try canvasProjection.openStatusCanvas(
    statusHostLeaseIdentity: statusHostLeaseIdentity
)
let statusStop = canvasProjection.routeMessage(
    canvasID: statusCanvas.id,
    canvasGeneration: statusCanvas.generation,
    message: request("status-stop", "stop_all", [
        "expected_barrier_generation": registry.snapshot().barrier.generation,
    ])
)
precondition(statusStop == .handled)
precondition(registry.snapshot().barrier.state == .closed)
if case let .stopAll(receipt) = registry.snapshot().retainedHostReceipts.last!.receipt {
    precondition(receipt.callerOrigin == .statusOpenedCanvasHost)
} else {
    preconditionFailure("expected stop-all receipt")
}

let fakeStatusItem = FakeStatusItemHost()
var openedBindings: [AOSOperationStatusHostLeaseIdentity] = []
var statusRequestCounter = 0
let statusControlQueue = DispatchQueue(label: "test.operation-status-control")
func makeStatusProjection() throws -> AOSOperationStatusItemProjection {
    try AOSOperationStatusItemProjection(
        controlPlane: control,
        readState: { registry.snapshot() },
        indicatorRegistry: indicators,
        statusHost: statusHostBinding,
        itemGeneration: 44,
        itemHost: fakeStatusItem,
        requestIDFactory: {
            statusRequestCounter += 1
            return "status-item-\(statusRequestCounter)"
        },
        statusHostLease: statusHostLease,
        controlQueue: statusControlQueue,
        openCanvas: { openedBindings.append($0) }
    )
}
let firstStatusProjection = try makeStatusProjection()
firstStatusProjection.start()
store.beginObservation(blockFirstSave: true)
precondition(fakeStatusItem.snapshot?.recordingIndicatorIsRed == false)
let closedPresentation = AOSOperationStatusMenuPresentation.make(snapshot: fakeStatusItem.snapshot!)
precondition(closedPresentation.barrierTitle.contains("Closed"))
precondition(closedPresentation.reopenEnabled)
precondition(closedPresentation.stopAllConfirmationTitle.contains("Generation"))
precondition(closedPresentation.stopAllConfirmationTitle.contains(String(fakeStatusItem.snapshot!.barrierGeneration)))
precondition(closedPresentation.reopenConfirmationTitle.contains(String(fakeStatusItem.snapshot!.barrierGeneration)))
fakeStatusItem.emit(.openCanvas, sequence: 1, revision: fakeStatusItem.descriptorRevision - 1)
precondition(openedBindings.isEmpty)
fakeStatusItem.emit(.openCanvas, sequence: 1)
precondition(openedBindings == [statusHostLease.identity()!])
fakeStatusItem.emit(.stopAll, sequence: 2)
precondition(store.waitForBlockedSave())
precondition(Thread.isMainThread)
let deadlockBreaker = DispatchWorkItem { store.releaseBlockedSave() }
DispatchQueue.global().asyncAfter(deadline: .now() + 2, execute: deadlockBreaker)
statusHostLease.clear()
let leaseRetiredBeforeBlockedControlFinished = store.isObservedSaveBlocked()
deadlockBreaker.cancel()
precondition(leaseRetiredBeforeBlockedControlFinished)
store.releaseBlockedSave()
waitUntil("status-item stop must complete off-main") {
    registry.snapshot().retainedHostReceipts.count == 2
}
statusControlQueue.sync {}
if case let .stopAll(receipt) = registry.snapshot().retainedHostReceipts.last!.receipt {
    precondition(receipt.callerOrigin == .statusItemHost)
    precondition(receipt.outcome == .alreadyClosed)
} else {
    preconditionFailure("expected status-item stop-all receipt")
}
let saveObservation = store.endObservation()
precondition(saveObservation.saveCount > 0)
precondition(!saveObservation.includedMainThread)

let receiptCountBeforeLeaseRetirement = registry.snapshot().retainedHostReceipts.count
fakeStatusItem.emit(.reopen, sequence: 3)
statusControlQueue.sync {}
precondition(fakeStatusItem.controlFailureCode == AOSOperationProjectionError.invalidStatusHostBinding.code)
precondition(
    registry.snapshot().retainedHostReceipts.count == receiptCountBeforeLeaseRetirement,
    "retired lease changed receipt count from \(receiptCountBeforeLeaseRetirement) to \(registry.snapshot().retainedHostReceipts.count)"
)
let replacementLeaseIdentity = try statusHostLease.install(statusHostBinding)
fakeStatusItem.emit(.reopen, sequence: 4)
statusControlQueue.sync {}
precondition(fakeStatusItem.controlFailureCode == AOSOperationProjectionError.invalidStatusHostBinding.code)
precondition(registry.snapshot().retainedHostReceipts.count == receiptCountBeforeLeaseRetirement)
firstStatusProjection.teardown()
precondition(statusHostLease.identity() == replacementLeaseIdentity)
let statusProjection = try makeStatusProjection()
statusProjection.start()
canvasProjection.detachCanvas(statusCanvas)
statusCanvas = try canvasProjection.openStatusCanvas(
    statusHostLeaseIdentity: statusHostLease.identity()!
)

store.beginObservation()
fakeStatusItem.emit(.reopen, sequence: 1)
waitUntil("status-item reopen must complete off-main") {
    registry.snapshot().barrier.state == .open
}
statusControlQueue.sync {}
let reopenSaveObservation = store.endObservation()
precondition(reopenSaveObservation.saveCount > 0)
precondition(!reopenSaveObservation.includedMainThread)
if case let .reopen(receipt) = registry.snapshot().retainedHostReceipts.last!.receipt {
    precondition(receipt.callerOrigin == .statusItemHost)
    precondition(receipt.outcome == .reopened)
} else {
    preconditionFailure("expected status-item reopen receipt")
}
let openPresentation = AOSOperationStatusMenuPresentation.make(snapshot: fakeStatusItem.snapshot!)
precondition(openPresentation.barrierTitle.contains("Open"))
precondition(!openPresentation.reopenEnabled)

let openBarrierGeneration = registry.snapshot().barrier.generation
let receiptCountBeforeStaleStop = registry.snapshot().retainedHostReceipts.count
statusControlQueue.suspend()
fakeStatusItem.emit(.stopAll, sequence: 2)
fakeStatusItem.emit(.stopAll, sequence: 3)
let racedStatusStop = canvasProjection.routeMessage(
    canvasID: statusCanvas.id,
    canvasGeneration: statusCanvas.generation,
    message: request("raced-status-stop", "stop_all", [
        "expected_barrier_generation": openBarrierGeneration,
    ])
)
precondition(racedStatusStop == .handled)
precondition(registry.snapshot().barrier.generation != openBarrierGeneration)
statusControlQueue.resume()
waitUntil("click-bound stale generation must fail without retargeting") {
    fakeStatusItem.controlFailureCode == AOSOperationCoreError.barrierGenerationConflict.code
}
precondition(registry.snapshot().retainedHostReceipts.count == receiptCountBeforeStaleStop + 1)
precondition(fakeStatusItem.snapshot?.barrierGeneration == registry.snapshot().barrier.generation)

fakeStatusItem.emit(.reopen, sequence: 4)
waitUntil("status item must reopen the exact refreshed closed generation") {
    registry.snapshot().barrier.state == .open
}

let receiptCountBeforeQueuedRevocation = registry.snapshot().retainedHostReceipts.count
let publicationEventStart = fakeStatusItem.publicationEvents.count
fakeStatusItem.blockNextSnapshotPublication()
statusControlQueue.suspend()
fakeStatusItem.emit(.stopAll, sequence: 5)
statusHostLease.clear()
statusControlQueue.resume()
precondition(fakeStatusItem.waitForBlockedSnapshotPublication())
let concurrentRefreshStarted = DispatchSemaphore(value: 0)
let concurrentRefreshDone = DispatchSemaphore(value: 0)
DispatchQueue.global().async {
    concurrentRefreshStarted.signal()
    _ = statusProjection.refresh()
    concurrentRefreshDone.signal()
}
precondition(concurrentRefreshStarted.wait(timeout: .now() + 5) == .success)
precondition(concurrentRefreshDone.wait(timeout: .now() + 0.1) == .timedOut)
fakeStatusItem.releaseBlockedSnapshotPublication()
precondition(concurrentRefreshDone.wait(timeout: .now() + 5) == .success)
statusControlQueue.sync {}
precondition(registry.snapshot().retainedHostReceipts.count == receiptCountBeforeQueuedRevocation)
precondition(fakeStatusItem.snapshot != nil)
let publicationTail = Array(fakeStatusItem.publicationEvents.dropFirst(publicationEventStart))
precondition(publicationTail.count == 3)
precondition(publicationTail[0].0 == "snapshot")
precondition(publicationTail[1].0 == "control_failure")
precondition(publicationTail[1].1 == publicationTail[0].1)
precondition(publicationTail[2].0 == "snapshot")
precondition(publicationTail[2].1 > publicationTail[1].1)

let stopDigest = try AOSOperationProjectionRequestDigest.hostAction(
    .stopAll,
    expectedBarrierGeneration: 7
)
let reopenDigest = try AOSOperationProjectionRequestDigest.hostAction(
    .reopen,
    expectedBarrierGeneration: 7
)
precondition(stopDigest.count == 64 && reopenDigest.count == 64)
precondition(stopDigest != reopenDigest)
`)
})

test('toolkit recording count follows the adapter-owned red-state set', () => {
  const projection = {
    schema_version: 'aos.canvas-operation-control.projection.v1',
    revision: 1,
    checked_at: 'checked',
    barrier: { generation: 1, state: 'open', admission_open: true },
    operations: [
      {
        operation_id: 'prepared', operation_generation: 1,
        capability_id: 'record', owner_root_id: 'owner', state: 'prepared',
        status_indicator_class: 'recording',
      },
      {
        operation_id: 'cleanup', operation_generation: 2,
        capability_id: 'record', owner_root_id: 'owner', state: 'cleanup_required',
        status_indicator_class: 'recording',
      },
      {
        operation_id: 'neutral', operation_generation: 3,
        capability_id: 'tool', owner_root_id: 'owner', state: 'active',
        status_indicator_class: 'neutral',
      },
      {
        operation_id: 'terminal', operation_generation: 4,
        capability_id: 'record', owner_root_id: 'owner', state: 'terminal',
        status_indicator_class: 'recording',
      },
    ],
  }
  const model = applyOperationControlMessage(createOperationControlModel(), projection)
  assert.deepEqual(operationControlCounts(model), {
    total: 4,
    active: 1,
    recording: 0,
    residual: 1,
  })
})

test('operation status menu requires an explicit generation-bound confirmation selection', async () => {
  const source = await readFile(
    path.join(daemonRoot, 'operation-status-item-projection.swift'),
    'utf8',
  )
  assert.match(source, /@objc private func handleClick\([^)]*\) \{\s*showMenu\(\)\s*\}/u)
  assert.match(source, /sendAction\(on: \[\.leftMouseUp, \.rightMouseUp\]\)/u)
  assert.match(
    source,
    /let item = NSMenuItem\(title: title, action: nil, keyEquivalent: ""\)[\s\S]*?item\.submenu = confirmation/u,
  )
  assert.match(
    source,
    /confirmation\.addItem\(makeBoundActionItem\([\s\S]*?binding: binding/u,
  )
  assert.match(source, /makeConfirmedActionItem\([\s\S]*?binding: binding\(for: \.stopAll,/u)
  assert.match(source, /makeConfirmedActionItem\([\s\S]*?binding: binding\(for: \.reopen,/u)
  assert.match(source, /expectedBarrierGeneration: snapshot\.barrierGeneration/u)
  assert.match(source, /controlQueue\.async/u)
})
