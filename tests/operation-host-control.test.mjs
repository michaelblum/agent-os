import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..')
const daemonRoot = path.join(repoRoot, 'src/daemon')
const sources = [
  'operation-owner-root.swift', 'operation-spawn-record.swift',
  'operation-state.swift', 'operation-store.swift', 'operation-registry.swift',
  'operation-resource-broker.swift', 'operation-resource-transaction.swift',
  'operation-resource-claim.swift', 'operation-control.swift', 'operation-recovery.swift',
].map((name) => path.join(daemonRoot, name))

async function compileAndRunHarness(source) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-operation-host-'))
  const main = path.join(root, 'main.swift')
  const executable = path.join(root, 'operation-host-proof')
  try {
    await writeFile(main, source)
    execFileSync('swiftc', [
      '-warnings-as-errors', '-module-cache-path', path.join(root, 'module-cache'),
      ...sources, main, '-o', executable,
    ], { cwd: repoRoot, stdio: 'pipe' })
    execFileSync(executable, [], { cwd: repoRoot, stdio: 'pipe' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('host stop is same-UID, immutable, replayable, and explicitly reopened', async () => {
  await compileAndRunHarness(String.raw`
import Darwin
import Foundation

func expect(_ expected: AOSOperationCoreError, _ body: () throws -> Void) {
    do { try body(); preconditionFailure("expected \(expected)") }
    catch let actual as AOSOperationCoreError { precondition(actual == expected) }
    catch { preconditionFailure("unexpected \(error)") }
}

final class FakeAdapter: AOSOperationControlAdapter {
    let registration: AOSOperationAdapterRegistration
    var calls: [AOSOperationIdentity] = []
    init(_ registration: AOSOperationAdapterRegistration) { self.registration = registration }
    func requestStop(operation: AOSOperationIdentity, force: Bool) -> AOSAdapterStopResult {
        precondition(force); calls.append(operation)
        return AOSAdapterStopResult(disposition: .absent, residualDigest: nil)
    }
    func residualDigest(operation: AOSOperationIdentity) -> String? { nil }
}

let registration = AOSOperationAdapterRegistration(
    id: "microphone-capture-adapter", revision: 1, operationClass: "microphone_capture",
    capabilityIDs: ["listen"], resourceDeclarations: []
)
let adapterRegistry = try AOSAdapterRegistrySnapshot.make(revision: 1, registrations: [registration])
let store = AOSInMemoryOperationStateStore()
let adapter = FakeAdapter(registration)
var now: UInt64 = 10_000_000_000
var nextID = 0
let registry = try AOSOperationRegistry(
    store: store, daemonGeneration: 7, adapterRegistry: adapterRegistry, adapters: [adapter],
    clock: { now }, idFactory: { nextID += 1; return "id-\(nextID)" }
)
let control = AOSOperationControlPlane(registry: registry, daemonEffectiveUID: 501)
let openBarrier = try control.completeBootReconciliation(.open)
let owner = AOSMechanicalOwnerRoot(
    ownerID: "owner", effectiveUID: 501, pid: 70, pidGeneration: 2,
    executableIdentityDigest: String(repeating: "a", count: 64)
)
for task in ["one", "two"] {
    let operation = try registry.prepareOperation(
        ownerRoot: owner, attribution: AOSOperationAttribution(taskID: task),
        capabilityID: "listen", adapterRegistrationID: registration.id,
        adapterRegistrationRevision: registration.revision
    )
    _ = try registry.transitionOperation(operation.identity, to: .starting)
    _ = try registry.transitionOperation(operation.identity, to: .active)
}

func live(_ uid: UInt32 = 501, daemon: UInt64 = 7) -> AOSHostControlContext {
    AOSHostControlContext(
        expectedDaemonGeneration: daemon, connectionEpoch: 3,
        caller: .liveTransportPeer(AOSLiveTransportPeerEvidence(
            auditTokenDigest: String(repeating: "b", count: 64), effectiveUID: uid,
            pid: 71, pidGeneration: 4
        ))
    )
}
func request(
    _ id: String, _ action: AOSHostControlAction, _ digest: String,
    _ generation: UInt64? = nil
) -> AOSHostControlRequest {
    AOSHostControlRequest(
        requestID: id, action: action, canonicalParameterDigest: digest,
        expectedBarrierGeneration: generation
    )
}

let stopRequest = request("stop-1", .stopAll, "digest-1", openBarrier.generation)
let receipt = try control.stopAll(context: live(), request: stopRequest)
precondition(receipt.outcome == .closingStarted)
precondition(receipt.scope == "registered_operation_plane_at_adapter_registry_revision")
precondition(receipt.snapshot.adapterRegistryRevision == adapterRegistry.revision)
precondition(receipt.snapshot.registeredOperationSetCount == adapterRegistry.registeredOperationSetCount)
precondition(receipt.snapshot.selectedOperationCount == 2)
precondition(adapter.calls.count == 2)
let closed = registry.snapshot().barrier
precondition(closed.state == .closed)
precondition(closed.stopSnapshot == receipt.snapshot)
precondition(closed.residualCount == 0 && closed.cleanupResult == .zeroResiduals)

let replay = try control.stopAll(context: live(501, daemon: 999), request: stopRequest)
precondition(replay == receipt)
expect(.idempotencyConflict) {
    _ = try control.stopAll(
        context: live(501, daemon: 999),
        request: request("stop-1", .stopAll, "changed", openBarrier.generation)
    )
}
expect(.barrierGenerationConflict) {
    _ = try control.stopAll(
        context: live(), request: request("stop-stale", .stopAll, "stale", openBarrier.generation)
    )
}
expect(.callerNotAuthenticated) {
    _ = try control.stopAll(
        context: live(502),
        request: request("wrong-uid", .stopAll, "wrong-uid", closed.generation)
    )
}

let status = try control.barrierStatus(
    context: live(), request: request("status", .barrierStatus, "status")
)
precondition(status.barrierState == .closed)
precondition(status.stopSnapshot == receipt.snapshot)
precondition(status.admissionOpen == false)

let statusContext = AOSHostControlContext(
    expectedDaemonGeneration: 7, connectionEpoch: 3,
    caller: .statusItemHost(AOSStatusItemHostEvidence(
        statusHostID: "status-host", statusHostGeneration: 2,
        daemonGeneration: 7, effectiveUID: 501
    ))
)
let statusStop = try control.stopAll(
    context: statusContext,
    request: request("status-stop", .stopAll, "status-stop", closed.generation)
)
precondition(statusStop.outcome == .alreadyClosed)
precondition(statusStop.snapshot == receipt.snapshot)
expect(.unsupportedControlOrigin) {
    _ = try control.barrierStatus(
        context: statusContext, request: request("status-read", .barrierStatus, "status-read")
    )
}

let ordinaryCanvas = AOSHostControlContext(
    expectedDaemonGeneration: 7, connectionEpoch: 3,
    caller: .ordinaryCanvasCapturedPeer(AOSOrdinaryCanvasPeerEvidence(
        canvasInstanceID: "canvas", canvasGeneration: 1, captureID: "capture",
        capturedConnectionEpoch: 3, auditTokenDigest: String(repeating: "c", count: 64),
        effectiveUID: 501, pid: 72, pidGeneration: 5, captureIsLive: true
    ))
)
expect(.unsupportedControlOrigin) {
    _ = try control.stopAll(
        context: ordinaryCanvas,
        request: request("canvas-stop", .stopAll, "canvas-stop", closed.generation)
    )
}
let statusCanvas = AOSHostControlContext(
    expectedDaemonGeneration: 7, connectionEpoch: 3,
    caller: .statusOpenedCanvasHost(AOSStatusOpenedCanvasHostEvidence(
        canvasInstanceID: "canvas", canvasGeneration: 2,
        parentStatusHostID: "status-host", parentStatusHostGeneration: 2,
        daemonGeneration: 7, effectiveUID: 501
    ))
)
let canvasStop = try control.stopAll(
    context: statusCanvas,
    request: request("status-canvas-stop", .stopAll, "status-canvas-stop", closed.generation)
)
precondition(canvasStop.outcome == .alreadyClosed)

expect(.unsupportedControlOrigin) {
    _ = try control.reopen(
        context: statusContext,
        request: request("status-reopen", .reopen, "status-reopen", closed.generation)
    )
}
let reopenRequest = request("reopen-1", .reopen, "reopen-1", closed.generation)
let reopened = try control.reopen(context: live(), request: reopenRequest)
precondition(reopened.outcome == .reopened)
precondition(reopened.priorSnapshot == receipt.snapshot)
precondition(reopened.resultingBarrierGeneration != closed.generation)
precondition(registry.snapshot().barrier.stopSnapshot == receipt.snapshot)
precondition(registry.snapshot().barrier.state == .open)
let reopenReplay = try control.reopen(context: live(501, daemon: 1), request: reopenRequest)
precondition(reopenReplay == reopened)
expect(.barrierNotClosed) {
    _ = try control.reopen(
        context: live(),
        request: request(
            "reopen-twice", .reopen, "reopen-twice", reopened.resultingBarrierGeneration
        )
    )
}

now += (AOSOperationControlPlane.retainedReceiptMaximumAgeSeconds + 1) * 1_000_000_000
_ = try control.stopAll(
    context: live(),
    request: request(
        "stop-after-prune", .stopAll, "stop-after-prune", reopened.resultingBarrierGeneration
    )
)
precondition(!registry.snapshot().retainedHostReceipts.contains { $0.requestID == "stop-1" })

let bootStore = AOSInMemoryOperationStateStore()
let bootRegistry = try AOSOperationRegistry(
    store: bootStore, daemonGeneration: 7, adapterRegistry: adapterRegistry,
    clock: { 1_000_000_000 }, idFactory: { "boot-stop" }
)
let bootControl = AOSOperationControlPlane(registry: bootRegistry, daemonEffectiveUID: 501)
let bootStatus = AOSHostControlContext(
    expectedDaemonGeneration: 7, connectionEpoch: 1,
    caller: .statusItemHost(AOSStatusItemHostEvidence(
        statusHostID: "boot-status", statusHostGeneration: 1,
        daemonGeneration: 7, effectiveUID: 501
    ))
)
let bootReceipt = try bootControl.stopAll(
    context: bootStatus,
    request: request("boot-request", .stopAll, "boot-request", 1)
)
precondition(bootReceipt.outcome == .recorded)
precondition(bootRegistry.snapshot().barrier.state == .bootReconciling)
precondition(bootReceipt.cleanupResult == .pending)
precondition(bootReceipt.residualDigest == AOSOperationDigest.empty(.residualSet))
`)
})

test('artifact custody, external spawn proofs, and file store survive exact recovery boundaries', async () => {
  await compileAndRunHarness(String.raw`
import Darwin
import Foundation

func expect(_ expected: AOSOperationCoreError, _ body: () throws -> Void) {
    do { try body(); preconditionFailure("expected \(expected)") }
    catch let actual as AOSOperationCoreError { precondition(actual == expected) }
    catch { preconditionFailure("unexpected \(error)") }
}
func digest(_ scalar: Character) -> AOSSHA256Digest {
    try! AOSSHA256Digest(String(repeating: String(scalar), count: 64))
}
func token(pid: pid_t, version: UInt32) -> AOSAuditTokenIdentity {
    var words = Array(repeating: UInt32(0), count: 8)
    words[1] = 501; words[5] = UInt32(bitPattern: pid); words[7] = version
    return try! AOSAuditTokenIdentity(words: words)
}

let registration = AOSOperationAdapterRegistration(
    id: "microphone-capture-adapter", revision: 1, operationClass: "microphone_capture",
    capabilityIDs: ["listen"], resourceDeclarations: []
)
let adapterRegistry = try AOSAdapterRegistrySnapshot.make(revision: 1, registrations: [registration])
let custodyStore = AOSInMemoryOperationStateStore()
let custodyRegistry = try AOSOperationRegistry(
    store: custodyStore, daemonGeneration: 1, adapterRegistry: adapterRegistry
)
let parent = AOSOperationIdentity(id: "parent", generation: 1)
try custodyRegistry.mutateDurably { state in
    state.artifacts = [
        AOSArtifactRecord(
            identity: AOSOperationIdentity(id: "released", generation: 1),
            parentOperation: parent, daemonGeneration: 1, state: .released,
            recoveryOriginState: nil, recoveryDisposition: nil, custodyDigest: "released"
        ),
        AOSArtifactRecord(
            identity: AOSOperationIdentity(id: "retained", generation: 1),
            parentOperation: parent, daemonGeneration: 1, state: .retained,
            recoveryOriginState: nil, recoveryDisposition: nil, custodyDigest: "retained"
        ),
        AOSArtifactRecord(
            identity: AOSOperationIdentity(id: "removed", generation: 1),
            parentOperation: parent, daemonGeneration: 1, state: .removed,
            recoveryOriginState: nil, recoveryDisposition: nil, custodyDigest: "removed"
        ),
    ]
}
let recovery = try AOSOperationRecovery.beginBootRecovery(
    registry: custodyRegistry, newDaemonGeneration: 2, claimTokenDigest: "recovery-token"
)
let recoveringArtifacts = custodyRegistry.snapshot().artifacts
precondition(recoveringArtifacts.allSatisfy { $0.state == .cleanupRequired })
precondition(recoveringArtifacts[0].recoveryDisposition == .releaseVerification)
precondition(recoveringArtifacts[1].recoveryDisposition == .retentionVerification)
precondition(recoveringArtifacts[2].recoveryDisposition == .removalVerification)
let recovered = try AOSOperationRecovery.reconcile(
    registry: custodyRegistry, recoveryGeneration: recovery.recoveryGeneration,
    claimTokenDigest: "recovery-token", mechanicallyAbsentOperationIDs: [],
    mechanicallyAbsentClaimIDs: [], mechanicallyAbsentBrokerIDs: [],
    mechanicallyRemovedArtifactIDs: [AOSOperationIdentity(id: "removed", generation: 1)],
    mechanicallyReleasedArtifactIDs: [AOSOperationIdentity(id: "released", generation: 1)],
    mechanicallyRetainedArtifactIDs: [AOSOperationIdentity(id: "retained", generation: 1)]
)
precondition(recovered.residualCount == 0)
precondition(custodyRegistry.snapshot().artifacts.map(\.state) == [.released, .retained, .removed])

let spawnStore = AOSInMemoryOperationStateStore()
let spawnRegistry = try AOSOperationRegistry(
    store: spawnStore, daemonGeneration: 4, adapterRegistry: adapterRegistry
)
let spawnControl = AOSOperationControlPlane(registry: spawnRegistry, daemonEffectiveUID: 501)
_ = try spawnControl.completeBootReconciliation(.open)
let owner = AOSMechanicalOwnerRoot(
    ownerID: "owner", effectiveUID: 501, pid: 80, pidGeneration: 1,
    executableIdentityDigest: String(repeating: "a", count: 64)
)
let operation = try spawnRegistry.prepareOperation(
    ownerRoot: owner, attribution: AOSOperationAttribution(), capabilityID: "listen",
    adapterRegistrationID: registration.id, adapterRegistrationRevision: registration.revision
)
_ = try spawnRegistry.transitionOperation(operation.identity, to: .starting)
let parentProcess = AOSProcessObservation(
    generation: AOSProcessGenerationIdentity(
        pid: 80, effectiveUID: 501, parentPID: 1,
        startTimeSeconds: 8, startTimeMicroseconds: 1
    ),
    image: AOSProcessImageEvidence(
        executableIdentityDigest: digest("1"), executableDigest: digest("2")
    )
)
let executableFileDigest = digest("4")
let executableCodeIdentityDigest = AOSSHA256Digest.hashing(
    domain: .executableCodeIdentity,
    data: Data(executableFileDigest.value.utf8)
)
let executableIdentityDigest = AOSSHA256Digest.hashing(
    domain: .executableIdentity,
    data: Data([
        "10", "20", executableCodeIdentityDigest.value, executableFileDigest.value,
    ].joined(separator: "\u{1f}").utf8)
)
let childProcess = AOSProcessObservation(
    generation: AOSProcessGenerationIdentity(
        pid: 81, effectiveUID: 501, parentPID: 80,
        startTimeSeconds: 9, startTimeMicroseconds: 2
    ),
    image: AOSProcessImageEvidence(
        executableIdentityDigest: executableIdentityDigest,
        executableDigest: executableFileDigest
    )
)
let edge = AOSStableProcessEdge(
    child: childProcess, parent: parentProcess,
    receipt: .make(child: childProcess.generation, parent: parentProcess.generation)
)
let executable = AOSResolvedExecutableObservation(
    resolvedPathDigest: digest("5"),
    executableIdentityDigest: childProcess.image.executableIdentityDigest,
    device: 10, inode: 20, codeIdentityDigest: executableCodeIdentityDigest,
    fileDigest: childProcess.image.executableDigest,
    platformCodeDirectoryHash: try AOSPlatformCodeDirectoryHash(
        String(repeating: "a", count: 40)
    ),
    signingIdentifier: "node", signingTeamIdentifier: "HX7739G8FX"
)
let pendingIntent = try AOSExternalDispatchSpawnBinder.makeIntent(
    spawnRecordID: "spawn-81", oneTimeBindingToken: Data("opaque".utf8),
    parent: parentProcess.generation, operationID: operation.identity.id,
    operationGeneration: operation.identity.generation, adapterID: registration.id,
    adapterRegistrationRevision: registration.revision, executable: executable,
    authoredScriptIdentity: "scripts/aos-tell-listen.mjs",
    expectedScriptDigest: digest("7"), canonicalArgvShapeDigest: digest("8"),
    reviewedDependencySetDigest: digest("9"), daemonGeneration: 4,
    createdAtMonotonicNanoseconds: 100, expiresAtMonotonicNanoseconds: 500
)
let runningExecutable = AOSExternalRunningExecutableEvidence(
    resolvedPathDigest: executable.resolvedPathDigest,
    device: executable.device, inode: executable.inode,
    platformCodeDirectoryHash: executable.platformCodeDirectoryHash!,
    signingIdentifier: "node", signingTeamIdentifier: "HX7739G8FX"
)
let intent = try AOSExternalDispatchSpawnBinder.admit(
    intent: pendingIntent, oneTimeBindingToken: Data("opaque".utf8),
    authenticatedParent: parentProcess.generation, childEdge: edge,
    runningExecutable: runningExecutable, admittedAtMonotonicNanoseconds: 200
)
let finalized = try AOSExternalDispatchSpawnBinder.finalize(
    intent: intent,
    observation: AOSExternalDispatchFinalizationObservation(
        spawnRecordID: intent.spawnRecordID,
        peer: AOSSocketPeerIdentity(auditToken: token(pid: 81, version: 3)),
        parentEdge: edge, runningExecutable: runningExecutable,
        operationID: intent.operationID,
        operationGeneration: intent.operationGeneration, adapterID: intent.adapterID,
        adapterRegistrationRevision: intent.adapterRegistrationRevision,
        canonicalArgvShapeDigest: intent.canonicalArgvShapeDigest,
        finalizedAtMonotonicNanoseconds: 300
    )
)
_ = try spawnRegistry.installPendingExternalSpawnIntent(intent)
_ = try spawnRegistry.installFinalizedExternalSpawnRecord(finalized)
_ = try spawnRegistry.installFinalizedExternalSpawnRecord(finalized)
precondition(spawnRegistry.snapshot().finalizedExternalSpawnRecords.count == 1)
expect(.idempotencyConflict) {
    _ = try spawnRegistry.abandonPendingExternalSpawnIntent(
        bindingTokenDigest: intent.oneTimeBindingTokenDigest,
        authenticatedParent: parentProcess.generation,
        closedAtMonotonicNanoseconds: 350
    )
}
let reloadedSpawnRecord = try spawnRegistry.finalizedExternalSpawnRecord(
    spawnRecordID: "spawn-81", operation: operation.identity,
    child: childProcess.generation
)
precondition(reloadedSpawnRecord == finalized)
let restartedRegistry = try AOSOperationRegistry(
    store: spawnStore, daemonGeneration: 5, adapterRegistry: adapterRegistry
)
precondition(restartedRegistry.exactExternalSpawnSkipRecord(
    child: childProcess.generation, parent: parentProcess.generation,
    parentEdgeReceipt: edge.receipt,
    executableIdentityDigest: childProcess.image.executableIdentityDigest,
    executableDigest: childProcess.image.executableDigest
) == finalized.skipRecord)
let spawnRecovery = try AOSOperationRecovery.beginBootRecovery(
    registry: restartedRegistry, newDaemonGeneration: 5, claimTokenDigest: "spawn-recovery"
)
precondition(spawnRecovery.residualCount >= 2)
let spawnRecovered = try AOSOperationRecovery.reconcile(
    registry: restartedRegistry, recoveryGeneration: spawnRecovery.recoveryGeneration,
    claimTokenDigest: "spawn-recovery",
    mechanicallyAbsentOperationIDs: [operation.identity],
    mechanicallyAbsentClaimIDs: [], mechanicallyAbsentBrokerIDs: [],
    mechanicallyAbsentSpawnRecordIDs: ["spawn-81"]
)
precondition(spawnRecovered.residualCount == 0)
precondition(restartedRegistry.snapshot().finalizedExternalSpawnRecords.isEmpty)

let lifecycleStore = AOSInMemoryOperationStateStore()
let lifecycleRegistry = try AOSOperationRegistry(
    store: lifecycleStore, daemonGeneration: 9, adapterRegistry: adapterRegistry
)
let lifecycleControl = AOSOperationControlPlane(
    registry: lifecycleRegistry, daemonEffectiveUID: 501
)
_ = try lifecycleControl.completeBootReconciliation(.open)
func pendingIntent(
    _ name: String,
    token: Data,
    created: UInt64,
    expires: UInt64
) throws -> AOSExternalDispatchSpawnIntent {
    let record = try lifecycleRegistry.prepareOperation(
        ownerRoot: owner, attribution: AOSOperationAttribution(), capabilityID: "listen",
        adapterRegistrationID: registration.id,
        adapterRegistrationRevision: registration.revision
    )
    _ = try lifecycleRegistry.transitionOperation(record.identity, to: .starting)
    return try AOSExternalDispatchSpawnBinder.makeIntent(
        spawnRecordID: name, oneTimeBindingToken: token,
        parent: parentProcess.generation, operationID: record.identity.id,
        operationGeneration: record.identity.generation, adapterID: registration.id,
        adapterRegistrationRevision: registration.revision, executable: executable,
        authoredScriptIdentity: "scripts/aos-tell-listen.mjs",
        expectedScriptDigest: digest("7"), canonicalArgvShapeDigest: digest("8"),
        reviewedDependencySetDigest: digest("9"), daemonGeneration: 9,
        createdAtMonotonicNanoseconds: created,
        expiresAtMonotonicNanoseconds: expires
    )
}
let abandonToken = Data("abandon-token".utf8)
let abandonIntent = try pendingIntent(
    "spawn-abandon", token: abandonToken, created: 400, expires: 800
)
_ = try lifecycleRegistry.installPendingExternalSpawnIntent(abandonIntent)
let abandoned = try lifecycleRegistry.abandonPendingExternalSpawnIntent(
    bindingTokenDigest: abandonIntent.oneTimeBindingTokenDigest,
    authenticatedParent: parentProcess.generation,
    closedAtMonotonicNanoseconds: 500
)
let abandonedReplay = try lifecycleRegistry.abandonPendingExternalSpawnIntent(
    bindingTokenDigest: abandonIntent.oneTimeBindingTokenDigest,
    authenticatedParent: parentProcess.generation,
    closedAtMonotonicNanoseconds: 501
)
precondition(abandoned == abandonedReplay)
precondition(abandoned.reason == .abandoned)

let expiryIntent = try pendingIntent(
    "spawn-expiry", token: Data("expiry-token".utf8), created: 600, expires: 700
)
_ = try lifecycleRegistry.installPendingExternalSpawnIntent(expiryIntent)
let expired = try lifecycleRegistry.expirePendingExternalSpawnIntents(
    daemonGeneration: 9, nowMonotonicNanoseconds: 700
)
precondition(expired == [expiryIntent])
precondition(lifecycleRegistry.snapshot().pendingExternalSpawnIntents.isEmpty)
precondition(lifecycleRegistry.snapshot().closedExternalSpawnIntents.contains {
    $0.spawnRecordID == expiryIntent.spawnRecordID && $0.reason == .expired
})

let rejectedIntent = try pendingIntent(
    "spawn-rejected", token: Data("rejected-token".utf8), created: 800, expires: 1_000
)
_ = try lifecycleRegistry.installPendingExternalSpawnIntent(rejectedIntent)
let rejected = try lifecycleRegistry.rejectPendingExternalSpawnIntent(
    spawnRecordID: rejectedIntent.spawnRecordID,
    operation: AOSOperationIdentity(
        id: rejectedIntent.operationID,
        generation: rejectedIntent.operationGeneration
    ),
    closedAtMonotonicNanoseconds: 900
)
precondition(rejected.reason == .finalizeRejected)
precondition(!lifecycleRegistry.snapshot().pendingExternalSpawnIntents.contains {
    $0.spawnRecordID == rejectedIntent.spawnRecordID
})
precondition(lifecycleRegistry.snapshot().closedExternalSpawnIntents.contains {
    $0.spawnRecordID == rejectedIntent.spawnRecordID
        && $0.reason == .finalizeRejected
})

let bootIntent = try pendingIntent(
    "spawn-boot", token: Data("boot-token".utf8), created: 800, expires: 900
)
_ = try lifecycleRegistry.installPendingExternalSpawnIntent(bootIntent)
_ = try AOSOperationRecovery.beginBootRecovery(
    registry: lifecycleRegistry, newDaemonGeneration: 10,
    claimTokenDigest: "boot-claim"
)
precondition(lifecycleRegistry.snapshot().pendingExternalSpawnIntents.isEmpty)
precondition(lifecycleRegistry.snapshot().closedExternalSpawnIntents.contains {
    $0.spawnRecordID == bootIntent.spawnRecordID && $0.reason == .bootRecovery
})

let temporaryParent = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
let root = temporaryParent.appendingPathComponent("aos-operation-store-\(UUID().uuidString)")
defer { try? FileManager.default.removeItem(at: root) }
let fileStore = try AOSFileOperationStateStore(rootURL: root)
let fileRegistry = try AOSOperationRegistry(
    store: fileStore, daemonGeneration: 1, adapterRegistry: adapterRegistry
)
precondition(fileRegistry.snapshot().schema == AOSOperationDurableState.schemaVersion)
var rootStat = stat()
precondition(lstat(root.path, &rootStat) == 0)
precondition((rootStat.st_mode & mode_t(0o777)) == mode_t(0o700))
let recordURL = root.appendingPathComponent(AOSFileOperationStateStore.recordName)
var recordStat = stat()
precondition(lstat(recordURL.path, &recordStat) == 0)
precondition((recordStat.st_mode & mode_t(0o777)) == mode_t(0o600))
expect(.storeLocked) { _ = try AOSFileOperationStateStore(rootURL: root) }
let symlink = temporaryParent.appendingPathComponent("aos-operation-store-link-\(UUID().uuidString)")
defer { try? FileManager.default.removeItem(at: symlink) }
try FileManager.default.createSymbolicLink(at: symlink, withDestinationURL: root)
expect(.storeCorrupt) { _ = try AOSFileOperationStateStore(rootURL: symlink) }
`)
})
