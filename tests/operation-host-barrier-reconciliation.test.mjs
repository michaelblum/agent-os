import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..')
const daemonRoot = path.join(repoRoot, 'src/daemon')
const sources = [
  'operation-owner-root.swift', 'operation-spawn-record.swift',
  'operation-state.swift', 'operation-store.swift', 'operation-registry.swift',
  'operation-resource-transaction.swift', 'operation-resource-claim.swift',
  'operation-resource-broker.swift', 'operation-control.swift',
  'operation-recovery.swift', 'microphone-operation-adapter.swift',
].map((name) => path.join(daemonRoot, name))

async function compileAndRunHarness(source) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-operation-barrier-reconciliation-'))
  const main = path.join(root, 'main.swift')
  const executable = path.join(root, 'operation-barrier-reconciliation-proof')
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

test('empty and asynchronously drained microphone stop-all barriers converge offline', async () => {
  await compileAndRunHarness(String.raw`
import Darwin
import Foundation

enum AOSMicrophoneCaptureTerminalTrigger: String, Equatable {
    case completed, cancelled, killed, ownerDisconnected, daemonShutdown, deadline
    case permissionRevoked, adapterFailed
}

struct AOSMicrophoneCaptureTermination: Equatable {
    let token: UUID
    let trigger: AOSMicrophoneCaptureTerminalTrigger
    let authorityAbsent: Bool
}

protocol AOSMicrophoneOperationClaimLease: AnyObject {
    func bindAuthority(
        stop: @escaping (_ force: Bool) -> Void,
        residualDigest: @escaping () -> String?
    ) throws
    func markAuthorityStarted() throws
    func noteStop(trigger: AOSMicrophoneCaptureTerminalTrigger) throws
    func authorityDidTerminate(_ termination: AOSMicrophoneCaptureTermination)
}

protocol AOSMicrophoneOperationClaiming: AnyObject {
    func prepareCapture(owner: UUID) throws -> any AOSMicrophoneOperationClaimLease
}

func expect(_ expected: AOSOperationCoreError, _ body: () throws -> Void) {
    do { try body(); preconditionFailure("expected \(expected)") }
    catch let actual as AOSOperationCoreError { precondition(actual == expected) }
    catch { preconditionFailure("unexpected \(error)") }
}

final class FailClosedBarrierSavesStore: AOSOperationStateStore {
    private var value: AOSOperationDurableState?
    private(set) var rejectedClosedSaveCount = 0

    func load() throws -> AOSOperationDurableState? { value }

    func save(_ state: AOSOperationDurableState) throws {
        if state.barrier.state == .closed && rejectedClosedSaveCount < 2 {
            rejectedClosedSaveCount += 1
            throw AOSOperationCoreError.storeUnavailable
        }
        value = state
    }
}

let registration = try AOSMicrophoneOperationAdapter.makeRegistration()
let adapterRegistry = try AOSAdapterRegistrySnapshot.make(
    revision: 1,
    registrations: [registration]
)
let owner = AOSMechanicalOwnerRoot(
    ownerID: "owner", effectiveUID: 501, pid: 70, pidGeneration: 2,
    executableIdentityDigest: String(repeating: "a", count: 64)
)
let declaration = registration.resourceDeclarations.first {
    $0.resourceKey == AOSMicrophoneOperationAdapter.resourceKey
}!
func host(_ daemonGeneration: UInt64) -> AOSHostControlContext {
    AOSHostControlContext(
        expectedDaemonGeneration: daemonGeneration,
        connectionEpoch: 3,
        caller: .liveTransportPeer(AOSLiveTransportPeerEvidence(
            auditTokenDigest: String(repeating: "b", count: 64),
            effectiveUID: 501,
            pid: 71,
            pidGeneration: 4
        ))
    )
}
func stopRequest(_ id: String, generation: UInt64) -> AOSHostControlRequest {
    AOSHostControlRequest(
        requestID: id,
        action: .stopAll,
        canonicalParameterDigest: "digest-\(id)",
        expectedBarrierGeneration: generation
    )
}
func ordinary(_ daemonGeneration: UInt64) -> AOSOrdinaryControlContext {
    AOSOrdinaryControlContext(
        expectedDaemonGeneration: daemonGeneration,
        connectionEpoch: 5,
        caller: .liveTransportPeer(AOSLiveTransportPeerEvidence(
            auditTokenDigest: String(repeating: "d", count: 64),
            effectiveUID: 501,
            pid: owner.pid,
            pidGeneration: owner.pidGeneration
        )),
        authenticatedOwnerRoot: owner
    )
}

func prepareTransaction(
    registry: AOSOperationRegistry,
    barrier: AOSHostBarrierRecord,
    task: String,
    commit: Bool
) throws -> (AOSOperationRecord, AOSResourceTransactionRecord) {
    let operation = try registry.prepareOperation(
        ownerRoot: owner,
        attribution: AOSOperationAttribution(taskID: task),
        capabilityID: AOSMicrophoneOperationAdapter.capabilityID,
        adapterRegistrationID: registration.id,
        adapterRegistrationRevision: registration.revision
    )
    let transaction = try AOSOperationResourceTransaction.prepare(
        registry: registry,
        operation: operation.identity,
        expectedBarrierGeneration: barrier.generation,
        expectedAdapterRegistry: adapterRegistry,
        requests: [AOSResourceClaimRequest(
            adapterRegistrationID: registration.id,
            adapterRegistrationRevision: registration.revision,
            resourceKey: declaration.resourceKey,
            admissionMode: .exclusive,
            resourceDeclarationDigest: declaration.declarationDigest,
            expectedResourceGeneration: 0,
            expectedBrokerGeneration: nil,
            expectedSubscriberSetRevision: nil,
            expectedSubscriberSetCount: nil,
            expectedSubscriberSetDigest: nil
        )]
    )
    if commit {
        _ = try AOSOperationResourceTransaction.beginReservation(
            registry: registry,
            transactionID: transaction.transactionID
        )
        _ = try AOSOperationResourceTransaction.commit(
            registry: registry,
            transactionID: transaction.transactionID
        )
        _ = try AOSOperationResourceTransaction.completeHandoff(
            registry: registry,
            transactionID: transaction.transactionID
        )
    }
    return (operation, transaction)
}

final class PreparedRaceAdapter: AOSOperationControlAdapter {
    let registration: AOSOperationAdapterRegistration
    let registry: AOSOperationRegistry
    var rejectedPreparedStart = false

    init(registration: AOSOperationAdapterRegistration, registry: AOSOperationRegistry) {
        self.registration = registration
        self.registry = registry
    }

    func requestStop(operation: AOSOperationIdentity, force: Bool) -> AOSAdapterStopResult {
        let before = try! registry.inspect(operation)
        precondition(before.state == .prepared && before.stopIntent != nil)
        if before.stopIntent == .hostStop {
            precondition(force)
            do {
                _ = try registry.transitionOperation(operation, to: .starting)
                preconditionFailure("prepared start crossed a closed host barrier")
            } catch let error as AOSOperationCoreError {
                precondition(error == .barrierClosed)
                rejectedPreparedStart = true
            } catch {
                preconditionFailure("unexpected \(error)")
            }
        }
        return AOSAdapterStopResult(disposition: .accepted, residualDigest: nil)
    }

    func residualDigest(operation: AOSOperationIdentity) -> String? {
        registry.snapshot().resourceClaims.first {
            $0.operation == operation && $0.state != .terminal
        }?.reattachTokenDigest
    }
}

final class AbsentAdapter: AOSOperationControlAdapter {
    let registration: AOSOperationAdapterRegistration

    init(registration: AOSOperationAdapterRegistration) {
        self.registration = registration
    }

    func requestStop(operation: AOSOperationIdentity, force: Bool) -> AOSAdapterStopResult {
        AOSAdapterStopResult(disposition: .absent, residualDigest: nil)
    }

    func residualDigest(operation: AOSOperationIdentity) -> String? { nil }
}

func assertNoTerminalParentHasLiveChildren(_ state: AOSOperationDurableState) {
    for operation in state.operations where operation.state == .terminal {
        precondition(operation.outcome != nil)
        precondition(operation.residualDigest == nil)
        precondition(!AOSOperationRegistry.hasNonterminalChildren(
            in: state,
            operation: operation.identity
        ))
    }
}

func microphoneFixture(
    daemonGeneration: UInt64,
    task: String,
    commitClaim: Bool
) throws -> (
    registry: AOSOperationRegistry,
    control: AOSOperationControlPlane,
    barrier: AOSHostBarrierRecord,
    operation: AOSOperationRecord,
    transaction: AOSResourceTransactionRecord
) {
    let registry = try AOSOperationRegistry(
        store: AOSInMemoryOperationStateStore(),
        daemonGeneration: daemonGeneration,
        adapterRegistry: adapterRegistry
    )
    let adapter = try AOSMicrophoneOperationAdapter(
        registry: registry,
        registration: registration,
        contextResolver: { _ in
            AOSMicrophoneOperationContext(
                ownerRoot: owner,
                attribution: AOSOperationAttribution(taskID: task)
            )
        },
        reconcileHostBarrier: {}
    )
    try registry.installRuntimeAdapters([adapter])
    let control = AOSOperationControlPlane(registry: registry, daemonEffectiveUID: 501)
    let barrier = try control.completeBootReconciliation(.open)
    let prepared = try prepareTransaction(
        registry: registry,
        barrier: barrier,
        task: task,
        commit: commitClaim
    )
    return (registry, control, barrier, prepared.0, prepared.1)
}

let emptyStore = FailClosedBarrierSavesStore()
let emptyRegistry = try AOSOperationRegistry(
    store: emptyStore,
    daemonGeneration: 7,
    adapterRegistry: adapterRegistry
)
let emptyControl = AOSOperationControlPlane(registry: emptyRegistry, daemonEffectiveUID: 501)
let emptyOpen = try emptyControl.completeBootReconciliation(.open)
let emptyReceipt = try emptyControl.stopAll(
    context: host(7),
    request: stopRequest("empty", generation: emptyOpen.generation)
)
precondition(emptyReceipt.outcome == .closingStarted)
precondition(emptyReceipt.resultingBarrierState == .closing)
precondition(emptyReceipt.snapshot.selectedOperationCount == 0)
let emptyClosed = emptyRegistry.snapshot().barrier
precondition(emptyClosed.state == .closed)
precondition(emptyClosed.residualCount == 0)
precondition(emptyClosed.residualDigest == AOSOperationDigest.empty(.residualSet))
precondition(emptyClosed.cleanupResult == .zeroResiduals)
precondition(emptyClosed.reconciliationState == "complete")
precondition(emptyStore.rejectedClosedSaveCount == 2)

func proveDirectTerminalRejectsChild(
    daemonGeneration: UInt64,
    install: (inout AOSOperationDurableState, AOSOperationIdentity) throws -> Void,
    close: (inout AOSOperationDurableState, AOSOperationIdentity) -> Void
) throws {
    let registry = try AOSOperationRegistry(
        store: AOSInMemoryOperationStateStore(),
        daemonGeneration: daemonGeneration,
        adapterRegistry: adapterRegistry
    )
    let control = AOSOperationControlPlane(registry: registry, daemonEffectiveUID: 501)
    _ = try control.completeBootReconciliation(.open)
    let operation = try registry.prepareOperation(
        ownerRoot: owner,
        attribution: AOSOperationAttribution(taskID: "terminal-child-\(daemonGeneration)"),
        capabilityID: registration.capabilityIDs[0],
        adapterRegistrationID: registration.id,
        adapterRegistrationRevision: registration.revision
    )
    try registry.mutateDurably { state in
        try install(&state, operation.identity)
    }
    expect(.residualsPresent) {
        _ = try registry.transitionOperation(
            operation.identity,
            to: .terminal,
            outcome: .rejected
        )
    }
    try registry.mutateDurably { state in close(&state, operation.identity) }
    _ = try registry.transitionOperation(
        operation.identity,
        to: .terminal,
        outcome: .rejected
    )
    assertNoTerminalParentHasLiveChildren(registry.snapshot())
}

try proveDirectTerminalRejectsChild(
    daemonGeneration: 21,
    install: { state, operation in
        state.streams.append(AOSStreamRecord(
            identity: AOSOperationIdentity(id: "stream-child", generation: state.allocateGeneration()),
            parentOperation: operation,
            daemonGeneration: state.daemonGeneration,
            state: .active,
            residualDigest: nil
        ))
    },
    close: { state, _ in state.streams[0].state = .terminal }
)
try proveDirectTerminalRejectsChild(
    daemonGeneration: 22,
    install: { state, operation in
        state.taps.append(AOSTapRecord(
            identity: AOSOperationIdentity(id: "tap-child", generation: state.allocateGeneration()),
            parentOperation: operation,
            daemonGeneration: state.daemonGeneration,
            channel: .metadata,
            bounds: try AOSTapBounds(
                rateItemsPerSecond: 1,
                sampleEvery: 1,
                maxQueueItems: 1,
                maxItems: 1,
                maxBytes: 1,
                idleTimeoutMilliseconds: 1,
                durationMilliseconds: 1
            ),
            follow: false,
            state: .active,
            counters: AOSTapCounters(),
            terminalBoundReason: nil,
            residualDigest: nil,
            preparedAtNanoseconds: 1,
            activatedAtNanoseconds: 1,
            updatedAtNanoseconds: 1
        ))
    },
    close: { state, _ in state.taps[0].state = .terminal }
)
try proveDirectTerminalRejectsChild(
    daemonGeneration: 23,
    install: { state, operation in
        state.artifacts.append(AOSArtifactRecord(
            identity: AOSOperationIdentity(id: "artifact-child", generation: state.allocateGeneration()),
            parentOperation: operation,
            daemonGeneration: state.daemonGeneration,
            state: .published,
            recoveryOriginState: nil,
            recoveryDisposition: nil,
            custodyDigest: String(repeating: "e", count: 64)
        ))
    },
    close: { state, _ in state.artifacts[0].state = .retained }
)

let absentRegistry = try AOSOperationRegistry(
    store: AOSInMemoryOperationStateStore(),
    daemonGeneration: 24,
    adapterRegistry: adapterRegistry
)
try absentRegistry.installRuntimeAdapters([AbsentAdapter(registration: registration)])
let absentControl = AOSOperationControlPlane(registry: absentRegistry, daemonEffectiveUID: 501)
_ = try absentControl.completeBootReconciliation(.open)
let absentOperation = try absentRegistry.prepareOperation(
    ownerRoot: owner,
    attribution: AOSOperationAttribution(taskID: "absent-with-child"),
    capabilityID: registration.capabilityIDs[0],
    adapterRegistrationID: registration.id,
    adapterRegistrationRevision: registration.revision
)
try absentRegistry.mutateDurably { state in
    state.streams.append(AOSStreamRecord(
        identity: AOSOperationIdentity(id: "absent-stream", generation: state.allocateGeneration()),
        parentOperation: absentOperation.identity,
        daemonGeneration: state.daemonGeneration,
        state: .active,
        residualDigest: nil
    ))
}
_ = try absentControl.cancel(context: ordinary(24), operation: absentOperation.identity)
let absentAfterControl = absentRegistry.snapshot()
precondition(absentAfterControl.operations.last?.state == .cleanupRequired)
precondition(absentAfterControl.streams.last?.state == .active)

let recoveryRegistry = try AOSOperationRegistry(
    store: AOSInMemoryOperationStateStore(),
    daemonGeneration: 25,
    adapterRegistry: adapterRegistry
)
let recoveryControl = AOSOperationControlPlane(
    registry: recoveryRegistry,
    daemonEffectiveUID: 501
)
_ = try recoveryControl.completeBootReconciliation(.open)
let recoveryParent = try recoveryRegistry.prepareOperation(
    ownerRoot: owner,
    attribution: AOSOperationAttribution(taskID: "recovery-child-closure"),
    capabilityID: registration.capabilityIDs[0],
    adapterRegistrationID: registration.id,
    adapterRegistrationRevision: registration.revision
)
let recoveryStream = AOSOperationIdentity(id: "recovery-stream", generation: 1)
try recoveryRegistry.mutateDurably { state in
    state.streams.append(AOSStreamRecord(
        identity: recoveryStream,
        parentOperation: recoveryParent.identity,
        daemonGeneration: state.daemonGeneration,
        state: .active,
        residualDigest: nil
    ))
}
let recoverySummary = try AOSOperationRecovery.beginBootRecovery(
    registry: recoveryRegistry,
    newDaemonGeneration: 26,
    claimTokenDigest: "child-closure-claim"
)
expect(.residualsPresent) {
    _ = try AOSOperationRecovery.reconcile(
        registry: recoveryRegistry,
        recoveryGeneration: recoverySummary.recoveryGeneration,
        claimTokenDigest: "child-closure-claim",
        mechanicallyAbsentOperationIDs: [recoveryParent.identity],
        mechanicallyAbsentClaimIDs: [],
        mechanicallyAbsentBrokerIDs: []
    )
}
let recoveredChildren = try AOSOperationRecovery.reconcile(
    registry: recoveryRegistry,
    recoveryGeneration: recoverySummary.recoveryGeneration,
    claimTokenDigest: "child-closure-claim",
    mechanicallyAbsentOperationIDs: [recoveryParent.identity],
    mechanicallyAbsentStreamIDs: [recoveryStream],
    mechanicallyAbsentClaimIDs: [],
    mechanicallyAbsentBrokerIDs: []
)
precondition(recoveredChildren.residualCount == 0)
assertNoTerminalParentHasLiveChildren(recoveryRegistry.snapshot())

// A finalized prior-generation external child that is still present on the
// first boot scan keeps its complete operation/resource aggregate and
// admission barrier nonterminal. A later exact-absence tick must retry a
// failed durable save, then close transaction, claim, broker, spawn record,
// and parent together before admission opens.
func digest(_ scalar: Character) -> AOSSHA256Digest {
    try! AOSSHA256Digest(String(repeating: String(scalar), count: 64))
}
func auditToken(pid: pid_t, version: UInt32) -> AOSAuditTokenIdentity {
    var words = Array(repeating: UInt32(0), count: 8)
    words[1] = 501
    words[5] = UInt32(bitPattern: pid)
    words[7] = version
    return try! AOSAuditTokenIdentity(words: words)
}

let bootDeclaration = try AOSResourceDeclaration.make(
    adapterRegistrationID: "boot-external-adapter",
    adapterRegistrationRevision: 1,
    resourceKey: "boot_external_broker",
    admissionMode: .multiplexable,
    fanoutBound: 1
)
let bootRegistration = AOSOperationAdapterRegistration(
    id: "boot-external-adapter",
    revision: 1,
    operationClass: "boot_external",
    capabilityIDs: ["listen"],
    resourceDeclarations: [bootDeclaration]
)
let bootAdapterRegistry = try AOSAdapterRegistrySnapshot.make(
    revision: 1,
    registrations: [bootRegistration]
)
let bootStore = AOSInMemoryOperationStateStore()
let bootSourceRegistry = try AOSOperationRegistry(
    store: bootStore,
    daemonGeneration: 30,
    adapterRegistry: bootAdapterRegistry
)
let bootSourceControl = AOSOperationControlPlane(
    registry: bootSourceRegistry,
    daemonEffectiveUID: 501
)
let bootOpen = try bootSourceControl.completeBootReconciliation(.open)
let bootOperation = try bootSourceRegistry.prepareOperation(
    ownerRoot: owner,
    attribution: AOSOperationAttribution(taskID: "boot-external-live"),
    capabilityID: "listen",
    adapterRegistrationID: bootRegistration.id,
    adapterRegistrationRevision: bootRegistration.revision
)
let bootTransaction = try AOSOperationResourceTransaction.prepare(
    registry: bootSourceRegistry,
    operation: bootOperation.identity,
    expectedBarrierGeneration: bootOpen.generation,
    expectedAdapterRegistry: bootAdapterRegistry,
    requests: [AOSResourceClaimRequest(
        adapterRegistrationID: bootRegistration.id,
        adapterRegistrationRevision: bootRegistration.revision,
        resourceKey: bootDeclaration.resourceKey,
        admissionMode: .multiplexable,
        resourceDeclarationDigest: bootDeclaration.declarationDigest,
        expectedResourceGeneration: 0,
        expectedBrokerGeneration: 0,
        expectedSubscriberSetRevision: 0,
        expectedSubscriberSetCount: 0,
        expectedSubscriberSetDigest: AOSOperationDigest.empty(.subscriberSet)
    )]
)
_ = try AOSOperationResourceTransaction.beginReservation(
    registry: bootSourceRegistry,
    transactionID: bootTransaction.transactionID
)
_ = try AOSOperationResourceTransaction.commit(
    registry: bootSourceRegistry,
    transactionID: bootTransaction.transactionID
)
_ = try bootSourceRegistry.transitionOperation(bootOperation.identity, to: .starting)

let bootParent = AOSProcessObservation(
    generation: AOSProcessGenerationIdentity(
        pid: owner.pid,
        effectiveUID: owner.effectiveUID,
        parentPID: 1,
        startTimeSeconds: 30,
        startTimeMicroseconds: 1
    ),
    image: AOSProcessImageEvidence(
        executableIdentityDigest: digest("1"),
        executableDigest: digest("2")
    )
)
let bootExecutableFileDigest = digest("4")
let bootExecutableCodeIdentityDigest = AOSSHA256Digest.hashing(
    domain: .executableCodeIdentity,
    data: Data(bootExecutableFileDigest.value.utf8)
)
let bootExecutableIdentityDigest = AOSSHA256Digest.hashing(
    domain: .executableIdentity,
    data: Data([
        "10", "20", bootExecutableCodeIdentityDigest.value,
        bootExecutableFileDigest.value,
    ].joined(separator: "\u{1f}").utf8)
)
let bootChild = AOSProcessObservation(
    generation: AOSProcessGenerationIdentity(
        pid: 700,
        effectiveUID: 501,
        parentPID: owner.pid,
        startTimeSeconds: 31,
        startTimeMicroseconds: 2
    ),
    image: AOSProcessImageEvidence(
        executableIdentityDigest: bootExecutableIdentityDigest,
        executableDigest: bootExecutableFileDigest
    )
)
let bootEdge = AOSStableProcessEdge(
    child: bootChild,
    parent: bootParent,
    receipt: .make(child: bootChild.generation, parent: bootParent.generation)
)
let bootExecutable = AOSResolvedExecutableObservation(
    resolvedPathDigest: digest("5"),
    executableIdentityDigest: bootChild.image.executableIdentityDigest,
    device: 10,
    inode: 20,
    codeIdentityDigest: bootExecutableCodeIdentityDigest,
    fileDigest: bootChild.image.executableDigest,
    platformCodeDirectoryHash: try AOSPlatformCodeDirectoryHash(
        String(repeating: "a", count: 40)
    ),
    signingIdentifier: "node",
    signingTeamIdentifier: "HX7739G8FX"
)
let bootRunningExecutable = AOSExternalRunningExecutableEvidence(
    resolvedPathDigest: bootExecutable.resolvedPathDigest,
    device: bootExecutable.device,
    inode: bootExecutable.inode,
    platformCodeDirectoryHash: bootExecutable.platformCodeDirectoryHash!,
    signingIdentifier: "node",
    signingTeamIdentifier: "HX7739G8FX"
)
let bootBindingToken = Data("boot-external-binding".utf8)
let bootPending = try AOSExternalDispatchSpawnBinder.makeIntent(
    spawnRecordID: "boot-spawn-700",
    oneTimeBindingToken: bootBindingToken,
    parent: bootParent.generation,
    operationID: bootOperation.identity.id,
    operationGeneration: bootOperation.identity.generation,
    adapterID: bootRegistration.id,
    adapterRegistrationRevision: bootRegistration.revision,
    executable: bootExecutable,
    authoredScriptIdentity: "scripts/aos-tell-listen.mjs",
    expectedScriptDigest: digest("7"),
    canonicalArgvShapeDigest: digest("8"),
    reviewedDependencySetDigest: digest("9"),
    daemonGeneration: 30,
    createdAtMonotonicNanoseconds: 100,
    expiresAtMonotonicNanoseconds: 500
)
let bootAdmitted = try AOSExternalDispatchSpawnBinder.admit(
    intent: bootPending,
    oneTimeBindingToken: bootBindingToken,
    authenticatedParent: bootParent.generation,
    childEdge: bootEdge,
    runningExecutable: bootRunningExecutable,
    admittedAtMonotonicNanoseconds: 200
)
let bootFinalized = try AOSExternalDispatchSpawnBinder.finalize(
    intent: bootAdmitted,
    observation: AOSExternalDispatchFinalizationObservation(
        spawnRecordID: bootAdmitted.spawnRecordID,
        peer: AOSSocketPeerIdentity(auditToken: auditToken(pid: 700, version: 3)),
        parentEdge: bootEdge,
        runningExecutable: bootRunningExecutable,
        operationID: bootAdmitted.operationID,
        operationGeneration: bootAdmitted.operationGeneration,
        adapterID: bootAdmitted.adapterID,
        adapterRegistrationRevision: bootAdmitted.adapterRegistrationRevision,
        canonicalArgvShapeDigest: bootAdmitted.canonicalArgvShapeDigest,
        finalizedAtMonotonicNanoseconds: 300
    )
)
_ = try bootSourceRegistry.installPendingExternalSpawnIntent(bootAdmitted)
_ = try bootSourceRegistry.installFinalizedExternalSpawnRecord(bootFinalized)
let bootClaimID = bootSourceRegistry.snapshot().resourceClaims.last!.claimID
let bootBrokerID = bootSourceRegistry.snapshot().resourceBrokers.last!.brokerID

let bootRecoveryRegistry = try AOSOperationRegistry(
    store: bootStore,
    daemonGeneration: 31,
    adapterRegistry: bootAdapterRegistry
)
let bootRecoveryControl = AOSOperationControlPlane(
    registry: bootRecoveryRegistry,
    daemonEffectiveUID: 501
)
let bootRecovery = try AOSOperationRecovery.beginBootRecovery(
    registry: bootRecoveryRegistry,
    newDaemonGeneration: 31,
    claimTokenDigest: "boot-live-recovery"
)
let bootLive = try AOSOperationRecovery.reconcile(
    registry: bootRecoveryRegistry,
    recoveryGeneration: bootRecovery.recoveryGeneration,
    claimTokenDigest: "boot-live-recovery",
    mechanicallyAbsentOperationIDs: [],
    mechanicallyAbsentTransactionIDs: [],
    mechanicallyAbsentClaimIDs: [],
    mechanicallyAbsentBrokerIDs: [],
    mechanicallyAbsentSpawnRecordIDs: []
)
precondition(bootLive.residualCount == 5)
let bootLiveState = bootRecoveryRegistry.snapshot()
precondition(bootLiveState.operations.last?.state == .cleanupRequired)
precondition(bootLiveState.resourceTransactions.last?.state == .cleanupRequired)
precondition(bootLiveState.resourceClaims.last?.state == .cleanupRequired)
precondition(bootLiveState.resourceBrokers.last?.state == .cleanupRequired)
precondition(bootLiveState.finalizedExternalSpawnRecords.count == 1)
precondition(bootLiveState.barrier.state == .cleanupRequired)

bootStore.failNextSave = true
expect(.storeUnavailable) {
    _ = try AOSOperationRecovery.reconcile(
        registry: bootRecoveryRegistry,
        recoveryGeneration: bootRecovery.recoveryGeneration,
        claimTokenDigest: "boot-live-recovery",
        mechanicallyAbsentOperationIDs: [bootOperation.identity],
        mechanicallyAbsentTransactionIDs: [bootTransaction.transactionID],
        mechanicallyAbsentClaimIDs: [bootClaimID],
        mechanicallyAbsentBrokerIDs: [bootBrokerID],
        mechanicallyAbsentSpawnRecordIDs: [bootFinalized.skipRecord.spawnRecordID]
    )
}
let bootAfterFailedTick = bootRecoveryRegistry.snapshot()
precondition(bootAfterFailedTick.operations.last?.state == .cleanupRequired)
precondition(bootAfterFailedTick.resourceTransactions.last?.state == .cleanupRequired)
precondition(bootAfterFailedTick.resourceClaims.last?.state == .cleanupRequired)
precondition(bootAfterFailedTick.resourceBrokers.last?.state == .cleanupRequired)
precondition(bootAfterFailedTick.finalizedExternalSpawnRecords.count == 1)
precondition(bootAfterFailedTick.barrier.state == .cleanupRequired)

let bootAbsent = try AOSOperationRecovery.reconcile(
    registry: bootRecoveryRegistry,
    recoveryGeneration: bootRecovery.recoveryGeneration,
    claimTokenDigest: "boot-live-recovery",
    mechanicallyAbsentOperationIDs: [bootOperation.identity],
    mechanicallyAbsentTransactionIDs: [bootTransaction.transactionID],
    mechanicallyAbsentClaimIDs: [bootClaimID],
    mechanicallyAbsentBrokerIDs: [bootBrokerID],
    mechanicallyAbsentSpawnRecordIDs: [bootFinalized.skipRecord.spawnRecordID]
)
precondition(bootAbsent.residualCount == 0)
precondition(bootAbsent.barrierState == .bootReconciling)
let bootReopened = try bootRecoveryControl.completeBootReconciliation(.open)
precondition(bootReopened.state == .open)
let bootAbsentState = bootRecoveryRegistry.snapshot()
precondition(bootAbsentState.operations.last?.state == .terminal)
precondition(bootAbsentState.resourceTransactions.last?.state == .terminal)
precondition(bootAbsentState.resourceClaims.last?.state == .terminal)
precondition(bootAbsentState.resourceBrokers.last?.state == .terminal)
precondition(bootAbsentState.finalizedExternalSpawnRecords.isEmpty)
assertNoTerminalParentHasLiveChildren(bootAbsentState)

let microphoneStore = FailClosedBarrierSavesStore()
let microphoneRegistry = try AOSOperationRegistry(
    store: microphoneStore,
    daemonGeneration: 8,
    adapterRegistry: adapterRegistry
)
let microphoneControl = AOSOperationControlPlane(
    registry: microphoneRegistry,
    daemonEffectiveUID: 501
)
let captureOwner = UUID()
let microphoneAdapter = try AOSMicrophoneOperationAdapter(
    registry: microphoneRegistry,
    registration: registration,
    contextResolver: { requestedOwner in
        precondition(requestedOwner == captureOwner)
        return AOSMicrophoneOperationContext(
            ownerRoot: owner,
            attribution: AOSOperationAttribution(taskID: "async-stop")
        )
    },
    reconcileHostBarrier: {
        let state = microphoneRegistry.snapshot().barrier.state
        guard [.closing, .cleanupRequired, .recovering].contains(state) else { return }
        _ = microphoneControl.reconcileHostBarrierWithBoundedRetry()
    }
)
try microphoneRegistry.installRuntimeAdapters([microphoneAdapter])
let microphoneOpen = try microphoneControl.completeBootReconciliation(.open)
let lease = try microphoneAdapter.prepareCapture(owner: captureOwner)
var stopForces: [Bool] = []
try lease.bindAuthority(stop: { stopForces.append($0) }, residualDigest: { nil })
try lease.markAuthorityStarted()

let microphoneReceipt = try microphoneControl.stopAll(
    context: host(8),
    request: stopRequest("microphone", generation: microphoneOpen.generation)
)
precondition(microphoneReceipt.snapshot.selectedOperationCount == 1)
precondition(stopForces == [true])
precondition(microphoneRegistry.snapshot().barrier.state == .closing)
precondition(microphoneRegistry.snapshot().barrier.reconciliationState == "draining")

lease.authorityDidTerminate(AOSMicrophoneCaptureTermination(
    token: UUID(),
    trigger: .killed,
    authorityAbsent: true
))
let microphoneClosed = microphoneRegistry.snapshot()
precondition(microphoneClosed.operations.last?.state == .terminal)
precondition(microphoneClosed.operations.last?.stopIntent == .hostStop)
precondition(microphoneClosed.operations.last?.outcome == .killed)
precondition(microphoneClosed.resourceClaims.last?.state == .terminal)
precondition(microphoneClosed.barrier.state == .closed)
precondition(microphoneClosed.barrier.residualCount == 0)
precondition(microphoneClosed.barrier.cleanupResult == .zeroResiduals)
precondition(microphoneStore.rejectedClosedSaveCount == 2)

// Capture the crash-visible stop mutation with a deferred adapter. The parent
// must stay nonterminal while its committed child claim is nonterminal, and a
// concurrent prepared-to-start attempt must fail after the barrier closes.
let earlyRaceRegistry = try AOSOperationRegistry(
    store: AOSInMemoryOperationStateStore(),
    daemonGeneration: 17,
    adapterRegistry: adapterRegistry
)
let earlyRaceAdapter = PreparedRaceAdapter(
    registration: registration,
    registry: earlyRaceRegistry
)
try earlyRaceRegistry.installRuntimeAdapters([earlyRaceAdapter])
let earlyRaceControl = AOSOperationControlPlane(
    registry: earlyRaceRegistry,
    daemonEffectiveUID: 501
)
let earlyRaceOpen = try earlyRaceControl.completeBootReconciliation(.open)
let earlyRacePrepared = try prepareTransaction(
    registry: earlyRaceRegistry,
    barrier: earlyRaceOpen,
    task: "early-prepared-race",
    commit: false
)
_ = try earlyRaceControl.stopAll(
    context: host(17),
    request: stopRequest("early-prepared-race", generation: earlyRaceOpen.generation)
)
let earlyCrashVisible = earlyRaceRegistry.snapshot()
precondition(earlyRaceAdapter.rejectedPreparedStart)
precondition(earlyCrashVisible.operations.last?.state == .prepared)
precondition(earlyCrashVisible.operations.last?.stopIntent == .hostStop)
precondition(earlyCrashVisible.resourceTransactions.last?.state == .prepared)
precondition(earlyCrashVisible.barrier.state == .closing)

// Ordinary stop intent wins while the host barrier remains open: neither
// reservation nor commit may advance after cancel/kill is durable.
let ordinaryPrepareRegistry = try AOSOperationRegistry(
    store: AOSInMemoryOperationStateStore(),
    daemonGeneration: 18,
    adapterRegistry: adapterRegistry
)
let ordinaryPrepareAdapter = PreparedRaceAdapter(
    registration: registration,
    registry: ordinaryPrepareRegistry
)
try ordinaryPrepareRegistry.installRuntimeAdapters([ordinaryPrepareAdapter])
let ordinaryPrepareControl = AOSOperationControlPlane(
    registry: ordinaryPrepareRegistry,
    daemonEffectiveUID: 501
)
let ordinaryPrepareOpen = try ordinaryPrepareControl.completeBootReconciliation(.open)
let ordinaryPrepared = try prepareTransaction(
    registry: ordinaryPrepareRegistry,
    barrier: ordinaryPrepareOpen,
    task: "ordinary-prepare-stop",
    commit: false
)
_ = try ordinaryPrepareControl.cancel(
    context: ordinary(18),
    operation: ordinaryPrepared.0.identity
)
expect(.invalidTransition) {
    _ = try AOSOperationResourceTransaction.beginReservation(
        registry: ordinaryPrepareRegistry,
        transactionID: ordinaryPrepared.1.transactionID
    )
}
precondition(ordinaryPrepareRegistry.snapshot().operations.last?.stopIntent == .cancel)

let ordinaryCommitRegistry = try AOSOperationRegistry(
    store: AOSInMemoryOperationStateStore(),
    daemonGeneration: 19,
    adapterRegistry: adapterRegistry
)
let ordinaryCommitAdapter = PreparedRaceAdapter(
    registration: registration,
    registry: ordinaryCommitRegistry
)
try ordinaryCommitRegistry.installRuntimeAdapters([ordinaryCommitAdapter])
let ordinaryCommitControl = AOSOperationControlPlane(
    registry: ordinaryCommitRegistry,
    daemonEffectiveUID: 501
)
let ordinaryCommitOpen = try ordinaryCommitControl.completeBootReconciliation(.open)
let ordinaryCommitting = try prepareTransaction(
    registry: ordinaryCommitRegistry,
    barrier: ordinaryCommitOpen,
    task: "ordinary-commit-stop",
    commit: false
)
_ = try AOSOperationResourceTransaction.beginReservation(
    registry: ordinaryCommitRegistry,
    transactionID: ordinaryCommitting.1.transactionID
)
_ = try ordinaryCommitControl.kill(
    context: ordinary(19),
    operation: ordinaryCommitting.0.identity
)
expect(.invalidTransition) {
    _ = try AOSOperationResourceTransaction.commit(
        registry: ordinaryCommitRegistry,
        transactionID: ordinaryCommitting.1.transactionID
    )
}
precondition(ordinaryCommitRegistry.snapshot().operations.last?.stopIntent == .kill)

let raceRegistry = try AOSOperationRegistry(
    store: AOSInMemoryOperationStateStore(),
    daemonGeneration: 12,
    adapterRegistry: adapterRegistry
)
let raceAdapter = PreparedRaceAdapter(registration: registration, registry: raceRegistry)
try raceRegistry.installRuntimeAdapters([raceAdapter])
let raceControl = AOSOperationControlPlane(registry: raceRegistry, daemonEffectiveUID: 501)
let raceOpen = try raceControl.completeBootReconciliation(.open)
let raceOperation = try raceRegistry.prepareOperation(
    ownerRoot: owner,
    attribution: AOSOperationAttribution(taskID: "prepared-race"),
    capabilityID: AOSMicrophoneOperationAdapter.capabilityID,
    adapterRegistrationID: registration.id,
    adapterRegistrationRevision: registration.revision
)
let raceTransaction = try AOSOperationResourceTransaction.prepare(
    registry: raceRegistry,
    operation: raceOperation.identity,
    expectedBarrierGeneration: raceOpen.generation,
    expectedAdapterRegistry: adapterRegistry,
    requests: [AOSResourceClaimRequest(
        adapterRegistrationID: registration.id,
        adapterRegistrationRevision: registration.revision,
        resourceKey: declaration.resourceKey,
        admissionMode: .exclusive,
        resourceDeclarationDigest: declaration.declarationDigest,
        expectedResourceGeneration: 0,
        expectedBrokerGeneration: nil,
        expectedSubscriberSetRevision: nil,
        expectedSubscriberSetCount: nil,
        expectedSubscriberSetDigest: nil
    )]
)
_ = try AOSOperationResourceTransaction.beginReservation(
    registry: raceRegistry,
    transactionID: raceTransaction.transactionID
)
_ = try AOSOperationResourceTransaction.commit(
    registry: raceRegistry,
    transactionID: raceTransaction.transactionID
)
_ = try AOSOperationResourceTransaction.completeHandoff(
    registry: raceRegistry,
    transactionID: raceTransaction.transactionID
)
_ = try raceControl.stopAll(
    context: host(12),
    request: stopRequest("prepared-race", generation: raceOpen.generation)
)
let crashVisible = raceRegistry.snapshot()
precondition(raceAdapter.rejectedPreparedStart)
precondition(crashVisible.operations.last?.state == .prepared)
precondition(crashVisible.operations.last?.stopIntent == .hostStop)
precondition(crashVisible.resourceClaims.last?.state == .active)
precondition(crashVisible.barrier.state == .closing)
precondition(crashVisible.barrier.reconciliationState == "draining")

// Reproduce the exact preparation interleaving where a claim is committed but
// the operation has not yet advanced from prepared to starting. Host stop must
// drain the claim through the adapter before publishing the parent terminal.
let preparedRegistry = try AOSOperationRegistry(
    store: AOSInMemoryOperationStateStore(),
    daemonGeneration: 11,
    adapterRegistry: adapterRegistry
)
let preparedControl = AOSOperationControlPlane(
    registry: preparedRegistry,
    daemonEffectiveUID: 501
)
let preparedAdapter = try AOSMicrophoneOperationAdapter(
    registry: preparedRegistry,
    registration: registration,
    contextResolver: { _ in
        AOSMicrophoneOperationContext(
            ownerRoot: owner,
            attribution: AOSOperationAttribution(taskID: "prepared-stop")
        )
    },
    reconcileHostBarrier: {
        let state = preparedRegistry.snapshot().barrier.state
        guard [.closing, .cleanupRequired, .recovering].contains(state) else { return }
        _ = try? preparedControl.reconcileHostBarrier()
    }
)
try preparedRegistry.installRuntimeAdapters([preparedAdapter])
let preparedOpen = try preparedControl.completeBootReconciliation(.open)
let preparedOperation = try preparedRegistry.prepareOperation(
    ownerRoot: owner,
    attribution: AOSOperationAttribution(taskID: "prepared-stop"),
    capabilityID: AOSMicrophoneOperationAdapter.capabilityID,
    adapterRegistrationID: registration.id,
    adapterRegistrationRevision: registration.revision
)
let preparedTransaction = try AOSOperationResourceTransaction.prepare(
    registry: preparedRegistry,
    operation: preparedOperation.identity,
    expectedBarrierGeneration: preparedOpen.generation,
    expectedAdapterRegistry: adapterRegistry,
    requests: [AOSResourceClaimRequest(
        adapterRegistrationID: registration.id,
        adapterRegistrationRevision: registration.revision,
        resourceKey: declaration.resourceKey,
        admissionMode: .exclusive,
        resourceDeclarationDigest: declaration.declarationDigest,
        expectedResourceGeneration: 0,
        expectedBrokerGeneration: nil,
        expectedSubscriberSetRevision: nil,
        expectedSubscriberSetCount: nil,
        expectedSubscriberSetDigest: nil
    )]
)
_ = try AOSOperationResourceTransaction.beginReservation(
    registry: preparedRegistry,
    transactionID: preparedTransaction.transactionID
)
_ = try AOSOperationResourceTransaction.commit(
    registry: preparedRegistry,
    transactionID: preparedTransaction.transactionID
)
_ = try AOSOperationResourceTransaction.completeHandoff(
    registry: preparedRegistry,
    transactionID: preparedTransaction.transactionID
)
let preparedBeforeStop = try preparedRegistry.inspect(preparedOperation.identity)
precondition(preparedBeforeStop.state == .prepared)
precondition(preparedRegistry.snapshot().resourceClaims.last?.state == .active)

let preparedReceipt = try preparedControl.stopAll(
    context: host(11),
    request: stopRequest("prepared", generation: preparedOpen.generation)
)
precondition(preparedReceipt.snapshot.selectedOperationCount == 1)
let preparedClosed = preparedRegistry.snapshot()
precondition(preparedClosed.operations.last?.state == .terminal)
precondition(preparedClosed.operations.last?.stopIntent == .hostStop)
precondition(preparedClosed.resourceClaims.last?.state == .terminal)
precondition(preparedClosed.barrier.state == .closed)
precondition(preparedClosed.barrier.residualCount == 0)

// Stop-all during the earlier prepared-transaction window must reject the
// transaction before publishing the parent terminal, and must preserve the
// host-stop intent selected by the control plane.
let early = try microphoneFixture(
    daemonGeneration: 13,
    task: "early-host-stop",
    commitClaim: false
)
_ = try early.control.stopAll(
    context: host(13),
    request: stopRequest("early-host-stop", generation: early.barrier.generation)
)
let earlyClosed = early.registry.snapshot()
precondition(earlyClosed.resourceTransactions.last?.state == .terminal)
precondition(earlyClosed.resourceTransactions.last?.outcome == .rejected)
precondition(earlyClosed.operations.last?.state == .terminal)
precondition(earlyClosed.operations.last?.stopIntent == .hostStop)
precondition(earlyClosed.operations.last?.outcome == .killed)
precondition(earlyClosed.barrier.state == .closed)
expect(.invalidTransition) {
    _ = try AOSOperationResourceTransaction.beginReservation(
        registry: early.registry,
        transactionID: early.transaction.transactionID
    )
}

// Ordinary controls use the same adapter drain for the committed-claim window;
// no receipt may be backed by a terminal parent with an active child claim.
let committedWindow = try microphoneFixture(
    daemonGeneration: 20,
    task: "committed-before-handoff",
    commitClaim: false
)
_ = try AOSOperationResourceTransaction.beginReservation(
    registry: committedWindow.registry,
    transactionID: committedWindow.transaction.transactionID
)
_ = try AOSOperationResourceTransaction.commit(
    registry: committedWindow.registry,
    transactionID: committedWindow.transaction.transactionID
)
expect(.residualsPresent) {
    _ = try committedWindow.registry.terminalizeOperationAfterVerifiedCleanup(
        committedWindow.operation.identity,
        stopIntent: .cancel,
        outcome: .cancelled
    )
}
expect(.invalidTransition) {
    try AOSOperationResourceTransaction.reject(
        registry: committedWindow.registry,
        transactionID: committedWindow.transaction.transactionID
    )
}
precondition(committedWindow.registry.snapshot().resourceClaims.last?.state == .active)
_ = try committedWindow.control.cancel(
    context: ordinary(20),
    operation: committedWindow.operation.identity
)
let committedWindowClosed = committedWindow.registry.snapshot()
precondition(committedWindowClosed.operations.last?.state == .terminal)
precondition(committedWindowClosed.operations.last?.stopIntent == .cancel)
precondition(committedWindowClosed.operations.last?.outcome == .cancelled)
precondition(committedWindowClosed.resourceTransactions.last?.state == .terminal)
precondition(committedWindowClosed.resourceTransactions.last?.outcome == .succeeded)
precondition(committedWindowClosed.resourceClaims.last?.state == .terminal)
assertNoTerminalParentHasLiveChildren(committedWindowClosed)

let cancelPrepared = try microphoneFixture(
    daemonGeneration: 14,
    task: "prepared-cancel",
    commitClaim: true
)
_ = try cancelPrepared.control.cancel(
    context: ordinary(14),
    operation: cancelPrepared.operation.identity
)
let cancelClosed = cancelPrepared.registry.snapshot()
precondition(cancelClosed.operations.last?.state == .terminal)
precondition(cancelClosed.operations.last?.stopIntent == .cancel)
precondition(cancelClosed.operations.last?.outcome == .cancelled)
precondition(cancelClosed.resourceClaims.last?.state == .terminal)
assertNoTerminalParentHasLiveChildren(cancelClosed)

let killPrepared = try microphoneFixture(
    daemonGeneration: 15,
    task: "prepared-kill",
    commitClaim: true
)
_ = try killPrepared.control.kill(
    context: ordinary(15),
    operation: killPrepared.operation.identity
)
let killClosed = killPrepared.registry.snapshot()
precondition(killClosed.operations.last?.state == .terminal)
precondition(killClosed.operations.last?.stopIntent == .kill)
precondition(killClosed.operations.last?.outcome == .killed)
precondition(killClosed.resourceClaims.last?.state == .terminal)
assertNoTerminalParentHasLiveChildren(killClosed)

let ownerKillPrepared = try microphoneFixture(
    daemonGeneration: 16,
    task: "prepared-owner-kill",
    commitClaim: true
)
_ = try ownerKillPrepared.control.killOwner(
    context: ordinary(16),
    filter: AOSOperationFilter(taskID: "prepared-owner-kill")
)
let ownerKillClosed = ownerKillPrepared.registry.snapshot()
precondition(ownerKillClosed.operations.last?.state == .terminal)
precondition(ownerKillClosed.operations.last?.stopIntent == .ownerKill)
precondition(ownerKillClosed.operations.last?.outcome == .killed)
precondition(ownerKillClosed.resourceClaims.last?.state == .terminal)
assertNoTerminalParentHasLiveChildren(ownerKillClosed)

let retry = try microphoneFixture(
    daemonGeneration: 9,
    task: "terminal-retry",
    commitClaim: false
)
_ = try retry.control.cancel(context: ordinary(9), operation: retry.operation.identity)
let terminalBeforeRetry = try retry.registry.inspect(retry.operation.identity)
let repeated = try retry.control.cancel(context: ordinary(9), operation: retry.operation.identity)
precondition(repeated.stopIntent == .cancel && repeated.terminalOutcome == .cancelled)
let terminalAfterRepeat = try retry.registry.inspect(retry.operation.identity)
precondition(terminalAfterRepeat == terminalBeforeRetry)
expect(.invalidTransition) {
    _ = try retry.control.kill(context: ordinary(9), operation: retry.operation.identity)
}
let terminalAfterConflict = try retry.registry.inspect(retry.operation.identity)
precondition(terminalAfterConflict == terminalBeforeRetry)

let externalStore = AOSInMemoryOperationStateStore()
let externalRegistry = try AOSOperationRegistry(
    store: externalStore,
    daemonGeneration: 10,
    adapterRegistry: adapterRegistry
)
let externalControl = AOSOperationControlPlane(
    registry: externalRegistry,
    daemonEffectiveUID: 501
)
let externalOpen = try externalControl.completeBootReconciliation(.open)
let externalOperation = try externalRegistry.prepareOperation(
    ownerRoot: owner,
    attribution: AOSOperationAttribution(),
    capabilityID: registration.capabilityIDs[0],
    adapterRegistrationID: registration.id,
    adapterRegistrationRevision: registration.revision
)
_ = try externalRegistry.transitionOperation(externalOperation.identity, to: .starting)
_ = try externalRegistry.transitionOperation(externalOperation.identity, to: .active)
_ = try externalControl.stopAll(
    context: host(10),
    request: stopRequest("external", generation: externalOpen.generation)
)
let externalCleanup = try externalRegistry.inspect(externalOperation.identity)
precondition(externalCleanup.state == .cleanupRequired)
precondition(externalRegistry.snapshot().barrier.state == .cleanupRequired)
externalStore.failNextSave = true
expect(.storeUnavailable) {
    _ = try externalControl.externalSpawnRetirementDidSettle(
        operation: externalOperation.identity
    )
}
let externalAfterCleanupFailure = try externalRegistry.inspect(externalOperation.identity)
precondition(externalAfterCleanupFailure.state == .cleanupRequired)

_ = try externalRegistry.transitionOperation(externalOperation.identity, to: .recovering)
externalStore.failNextSave = true
expect(.storeUnavailable) {
    _ = try externalControl.externalSpawnRetirementDidSettle(
        operation: externalOperation.identity
    )
}
let externalAfterRecoveringFailure = try externalRegistry.inspect(externalOperation.identity)
precondition(externalAfterRecoveringFailure.state == .recovering)

_ = try externalRegistry.transitionOperation(externalOperation.identity, to: .terminal)
externalStore.failNextSave = true
expect(.storeUnavailable) {
    _ = try externalControl.externalSpawnRetirementDidSettle(
        operation: externalOperation.identity
    )
}
let externalAfterTerminalFailure = try externalRegistry.inspect(externalOperation.identity)
precondition(externalAfterTerminalFailure.state == .terminal)
precondition(externalRegistry.snapshot().barrier.state != .closed)

let externalClosed = try externalControl.externalSpawnRetirementDidSettle(
    operation: externalOperation.identity
)
let externalTerminal = try externalRegistry.inspect(externalOperation.identity)
precondition(externalTerminal.state == .terminal)
precondition(externalClosed?.state == .closed)
precondition(externalClosed?.residualCount == 0)
`)
})

test('daemon retirement paths re-enter host-barrier reconciliation after durable settlement', async () => {
  const unified = await readFile(path.join(daemonRoot, 'unified.swift'), 'utf8')
  const initialization = unified.slice(
    unified.indexOf('private func initializeOperationControlPlane()'),
    unified.indexOf('private func initializeOperationProjections('),
  )
  const retirement = unified.slice(
    unified.indexOf('private func scheduleExternalSpawnRetirement('),
    unified.indexOf('private func operationContext(for owner:'),
  )

  assert.match(initialization, /reconcileHostBarrier: \{ \[weak control\][\s\S]*control\.reconcileHostBarrierWithBoundedRetry\(\)/u)
  assert.match(
    retirement,
    /retireFinalizedExternalSpawnRecord\([\s\S]*operationControlPlane\?\.externalSpawnRetirementDidSettle\([\s\S]*operation: operation/u,
  )
  assert.match(
    retirement,
    /scheduleExternalSpawnSettlement\(operation: operation, attempt: 0\)[\s\S]*catch \{[\s\S]*scheduleExternalSpawnSettlement\([\s\S]*attempt: attempt \+ 1/u,
  )
})

test('boot external-child recovery remains on the maintenance timer across ordinary activity', async () => {
  const unified = await readFile(path.join(daemonRoot, 'unified.swift'), 'utf8')
  const initialization = unified.slice(
    unified.indexOf('private func initializeOperationControlPlane()'),
    unified.indexOf('private func initializeOperationProjections('),
  )
  const recovery = unified.slice(
    unified.indexOf('private func reconcileOperationBootRecoveryExternalChildren('),
    unified.indexOf('private func initializeOperationProjections('),
  )
  const maintenance = unified.slice(
    unified.indexOf('private func startOperationExternalSpawnExpiryTimer('),
    unified.indexOf('private func operationResolvedExecutable('),
  )
  const cancelIdle = unified.slice(
    unified.indexOf('private func cancelIdleTimer()'),
    unified.indexOf('func shutdown(reason:'),
  )
  const shutdown = unified.slice(
    unified.indexOf('func shutdown(reason:'),
    unified.indexOf('private func setupSignalHandlers()'),
  )

  assert.match(
    initialization,
    /reconcileOperationBootRecoveryExternalChildren\([\s\S]*recoveryGeneration: recovery\.recoveryGeneration[\s\S]*startOperationExternalSpawnExpiryTimer\([\s\S]*bootRecoveryClaimTokenDigest: recoveryToken/u,
  )
  assert.match(
    recovery,
    /recovery\.generation == recoveryGeneration,[\s\S]*recovery\.claimTokenDigest == claimTokenDigest/u,
  )
  assert.match(
    recovery,
    /operationExternalChildIsMechanicallyAbsent\(finalized\)[\s\S]*externallyLiveOperations[\s\S]*externallyLiveBrokerIDs/u,
  )
  assert.match(
    recovery,
    /AOSOperationRecovery\.reconcile\([\s\S]*mechanicallyAbsentTransactionIDs:[\s\S]*mechanicallyAbsentClaimIDs:[\s\S]*mechanicallyAbsentBrokerIDs:[\s\S]*mechanicallyAbsentSpawnRecordIDs: absentSpawnRecords/u,
  )
  assert.match(
    recovery,
    /reconciled\.residualCount == 0, reconciled\.barrierState == \.bootReconciling[\s\S]*completeBootReconciliation\(\.open\)/u,
  )
  assert.match(
    maintenance,
    /timer\.setEventHandler[\s\S]*reapExpiredExternalSpawnIntents\(\)[\s\S]*reconcileOperationBootRecoveryExternalChildren\([\s\S]*recoveryGeneration: bootRecoveryGeneration/u,
  )
  assert.doesNotMatch(maintenance, /attempt|asyncAfter/u)
  assert.doesNotMatch(cancelIdle, /operationExternalSpawnExpiryTimer/u)
  assert.match(
    shutdown,
    /operationExternalSpawnExpiryTimer\?\.cancel\(\)[\s\S]*operationExternalSpawnExpiryTimer = nil/u,
  )
})
