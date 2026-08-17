import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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
].map((name) => path.join(daemonRoot, name))

async function compileAndRunHarness(source) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-operation-projections-'))
  const main = path.join(root, 'main.swift')
  const executable = path.join(root, 'operation-projections')
  try {
    await writeFile(main, source)
    execFileSync('swiftc', [
      '-warnings-as-errors',
      '-module-cache-path', path.join(root, 'module-cache'),
      ...sources,
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

final class FakeStatusItemHost: AOSOperationInternalStatusItemHosting {
    var itemGeneration: UInt64 = 0
    var descriptorRevision: UInt64 = 0
    var handler: ((AOSOperationInternalStatusItemActionEvidence) -> Void)?
    var snapshot: AOSOperationStatusItemSnapshot?
    var failureCode: String?

    func install(
        itemGeneration: UInt64,
        descriptorRevision: UInt64,
        onAction: @escaping (AOSOperationInternalStatusItemActionEvidence) -> Void
    ) {
        self.itemGeneration = itemGeneration
        self.descriptorRevision = descriptorRevision
        handler = onAction
    }

    func update(snapshot: AOSOperationStatusItemSnapshot, descriptorRevision: UInt64) {
        self.snapshot = snapshot
        self.descriptorRevision = descriptorRevision
        failureCode = nil
    }

    func updateFailure(code: String, descriptorRevision: UInt64) {
        snapshot = nil
        failureCode = code
        self.descriptorRevision = descriptorRevision
    }

    func teardown() { handler = nil }

    func emit(
        _ action: AOSOperationInternalStatusItemAction,
        sequence: UInt64,
        revision: UInt64? = nil,
        generation: UInt64? = nil
    ) {
        handler?(AOSOperationInternalStatusItemActionEvidence(
            action: action,
            itemGeneration: generation ?? itemGeneration,
            descriptorRevision: revision ?? descriptorRevision,
            actionSequence: sequence
        ))
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

let store = AOSInMemoryOperationStateStore()
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
let recording = try registry.prepareOperation(
    ownerRoot: ownerA,
    attribution: AOSOperationAttribution(taskID: "asserted-task-a"),
    capabilityID: "recording-capability",
    adapterRegistrationID: recordingRegistration.id,
    adapterRegistrationRevision: recordingRegistration.revision
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
        state: .published,
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
var currentStatusHost: AOSOperationStatusHostBinding? = statusHostBinding
let canvasHost = FakeCanvasHost()
let canvasProjection = try AOSOperationCanvasProjection(
    controlPlane: control,
    readState: { canvasState },
    indicatorRegistry: indicators,
    canvasHost: canvasHost,
    resolveCurrentStatusHost: { currentStatusHost },
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
precondition(artifacts[0]["state"] as? String == "published")
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

let statusCanvas = try canvasProjection.openStatusCanvas(statusHost: statusHostBinding)
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
currentStatusHost = nil
let staleStatusStop = canvasProjection.routeMessage(
    canvasID: statusCanvas.id,
    canvasGeneration: statusCanvas.generation,
    message: request("stale-status-stop", "stop_all", [
        "expected_barrier_generation": registry.snapshot().barrier.generation,
    ])
)
precondition(staleStatusStop == .rejected(AOSOperationProjectionError.invalidStatusHostBinding.code))
precondition(registry.snapshot().barrier.state == .open)
currentStatusHost = statusHostBinding
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
var openedBindings: [AOSOperationStatusHostBinding] = []
var statusProjectionState = registry.snapshot()
let statusProjection = try AOSOperationStatusItemProjection(
    controlPlane: control,
    readState: { statusProjectionState },
    indicatorRegistry: indicators,
    statusHost: statusHostBinding,
    itemGeneration: 44,
    itemHost: fakeStatusItem,
    requestIDFactory: { "status-item-stop" },
    openCanvas: { openedBindings.append($0) }
)
statusProjection.start()
precondition(fakeStatusItem.snapshot?.recordingIndicatorIsRed == false)
fakeStatusItem.emit(.openCanvas, sequence: 1, revision: fakeStatusItem.descriptorRevision - 1)
precondition(openedBindings.isEmpty)
fakeStatusItem.emit(.openCanvas, sequence: 1)
precondition(openedBindings == [statusHostBinding])
fakeStatusItem.emit(.stopAll, sequence: 1)
precondition(registry.snapshot().retainedHostReceipts.count == 1)
fakeStatusItem.emit(.stopAll, sequence: 2)
precondition(registry.snapshot().retainedHostReceipts.count == 2)
if case let .stopAll(receipt) = registry.snapshot().retainedHostReceipts.last!.receipt {
    precondition(receipt.callerOrigin == .statusItemHost)
    precondition(receipt.outcome == .alreadyClosed)
} else {
    preconditionFailure("expected status-item stop-all receipt")
}

statusProjectionState.daemonGeneration = 8
if case .success = statusProjection.refresh() {
    preconditionFailure("stale status snapshot must fail")
}
precondition(fakeStatusItem.snapshot == nil)
let receiptCountBeforeUnavailableStop = registry.snapshot().retainedHostReceipts.count
fakeStatusItem.emit(.stopAll, sequence: 3)
precondition(fakeStatusItem.failureCode == AOSOperationProjectionError.invalidStatusHostBinding.code)
precondition(registry.snapshot().retainedHostReceipts.count == receiptCountBeforeUnavailableStop)

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
