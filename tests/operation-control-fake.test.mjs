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
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-operation-control-fake-'))
  const main = path.join(root, 'main.swift')
  const executable = path.join(root, 'operation-control-fake')
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

test('ordinary controls are owner-root bounded and persist intent before adapter action', async () => {
  await compileAndRunHarness(String.raw`
import Foundation

func expect(_ expected: AOSOperationCoreError, _ body: () throws -> Void) {
    do { try body(); preconditionFailure("expected \(expected)") }
    catch let actual as AOSOperationCoreError { precondition(actual == expected) }
    catch { preconditionFailure("unexpected \(error)") }
}

final class FakeAdapter: AOSOperationControlAdapter {
    let registration: AOSOperationAdapterRegistration
    var calls: [(AOSOperationIdentity, Bool)] = []
    var result = AOSAdapterStopResult(disposition: .absent, residualDigest: nil)

    init(_ registration: AOSOperationAdapterRegistration) { self.registration = registration }
    func requestStop(operation: AOSOperationIdentity, force: Bool) -> AOSAdapterStopResult {
        calls.append((operation, force)); return result
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
var nextID = 0
let registry = try AOSOperationRegistry(
    store: store, daemonGeneration: 7, adapterRegistry: adapterRegistry, adapters: [adapter],
    clock: { 5_000_000_000 }, idFactory: { nextID += 1; return "id-\(nextID)" }
)
let control = AOSOperationControlPlane(registry: registry, daemonEffectiveUID: 501)
let opened = try control.completeBootReconciliation(.open)
precondition(opened.state == .open)

let ownerA = AOSMechanicalOwnerRoot(
    ownerID: "owner-a", effectiveUID: 501, pid: 100, pidGeneration: 3,
    executableIdentityDigest: String(repeating: "a", count: 64)
)
let ownerB = AOSMechanicalOwnerRoot(
    ownerID: "owner-b", effectiveUID: 501, pid: 200, pidGeneration: 4,
    executableIdentityDigest: String(repeating: "b", count: 64)
)
func liveContext(_ owner: AOSMechanicalOwnerRoot, daemon: UInt64 = 7) -> AOSOrdinaryControlContext {
    AOSOrdinaryControlContext(
        expectedDaemonGeneration: daemon, connectionEpoch: 9,
        caller: .liveTransportPeer(AOSLiveTransportPeerEvidence(
            auditTokenDigest: String(repeating: "c", count: 64), effectiveUID: 501,
            pid: owner.pid, pidGeneration: owner.pidGeneration
        )), authenticatedOwnerRoot: owner
    )
}

let operationA = try registry.prepareOperation(
    ownerRoot: ownerA,
    attribution: AOSOperationAttribution(projectID: "shared", taskID: "task-a"),
    capabilityID: "listen", adapterRegistrationID: registration.id,
    adapterRegistrationRevision: registration.revision
)
_ = try registry.transitionOperation(operationA.identity, to: .starting)
_ = try registry.transitionOperation(operationA.identity, to: .active)
let operationB = try registry.prepareOperation(
    ownerRoot: ownerB,
    attribution: AOSOperationAttribution(projectID: "shared", taskID: "task-b"),
    capabilityID: "listen", adapterRegistrationID: registration.id,
    adapterRegistrationRevision: registration.revision
)
_ = try registry.transitionOperation(operationB.identity, to: .starting)
_ = try registry.transitionOperation(operationB.identity, to: .active)

let ownerAList = try control.list(context: liveContext(ownerA))
precondition(ownerAList.map(\.identity) == [operationA.identity])
let assertedNarrowing = try control.list(
    context: liveContext(ownerA), filter: AOSOperationFilter(taskID: "task-b")
)
precondition(assertedNarrowing.isEmpty)
expect(.ownerMismatch) { _ = try control.kill(context: liveContext(ownerA), operation: operationB.identity) }
expect(.generationConflict) {
    _ = try control.cancel(context: liveContext(ownerA, daemon: 6), operation: operationA.identity)
}

let cancelReceipt = try control.cancel(context: liveContext(ownerA), operation: operationA.identity)
precondition(cancelReceipt.selectedOperations == [operationA.identity])
precondition(cancelReceipt.stopIntent == .cancel)
precondition(adapter.calls.count == 1 && adapter.calls[0].1 == false)
let cancelled = try registry.inspect(operationA.identity)
precondition(cancelled.state == .terminal && cancelled.outcome == .cancelled)

let callsBeforeFailedSave = adapter.calls.count
store.failNextSave = true
expect(.storeUnavailable) {
    _ = try control.kill(context: liveContext(ownerB), operation: operationB.identity)
}
precondition(adapter.calls.count == callsBeforeFailedSave)
let operationBAfterFailedSave = try registry.inspect(operationB.identity)
precondition(operationBAfterFailedSave.state == .active)

let canvasContext = AOSOrdinaryControlContext(
    expectedDaemonGeneration: 7, connectionEpoch: 9,
    caller: .ordinaryCanvasCapturedPeer(AOSOrdinaryCanvasPeerEvidence(
        canvasInstanceID: "canvas", canvasGeneration: 2, captureID: "capture",
        capturedConnectionEpoch: 9, auditTokenDigest: String(repeating: "d", count: 64),
        effectiveUID: 501, pid: 200, pidGeneration: 4, captureIsLive: true
    )), authenticatedOwnerRoot: ownerB
)
let canvasInspection = try control.inspect(context: canvasContext, operation: operationB.identity)
precondition(canvasInspection.identity == operationB.identity)
let staleCanvas = AOSOrdinaryControlContext(
    expectedDaemonGeneration: 7, connectionEpoch: 10, caller: canvasContext.caller,
    authenticatedOwnerRoot: ownerB
)
expect(.callerNotAuthenticated) { _ = try control.list(context: staleCanvas) }

let statusOrdinary = AOSOrdinaryControlContext(
    expectedDaemonGeneration: 7, connectionEpoch: 9,
    caller: .statusItemHost(AOSStatusItemHostEvidence(
        statusHostID: "status", statusHostGeneration: 1, daemonGeneration: 7, effectiveUID: 501
    )), authenticatedOwnerRoot: ownerB
)
expect(.unsupportedControlOrigin) { _ = try control.list(context: statusOrdinary) }
`)
})
