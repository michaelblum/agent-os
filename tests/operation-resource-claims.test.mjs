import { execFileSync } from 'node:child_process'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..')
async function swiftSources(root) {
  const result = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name)
    if (entry.isDirectory()) result.push(...await swiftSources(candidate))
    else if (entry.isFile() && entry.name.endsWith('.swift')) result.push(candidate)
  }
  return result.sort()
}

async function productionSources() {
  const excludedDaemonSources = new Set([
    'coordination.swift', 'surface-inspector-bundle.swift', 'unified.swift',
    'wiki-change-bus.swift', 'wiki-seed.swift', 'wiki-watch.swift',
  ])
  return [
    ...await swiftSources(path.join(repoRoot, 'src/browser')),
    ...await swiftSources(path.join(repoRoot, 'src/perceive')),
    ...await swiftSources(path.join(repoRoot, 'src/shared')),
    ...await swiftSources(path.join(repoRoot, 'src/display')),
    ...(await swiftSources(path.join(repoRoot, 'src/daemon')))
      .filter((candidate) => !excludedDaemonSources.has(path.basename(candidate))),
    ...await swiftSources(path.join(repoRoot, 'shared/swift/ipc')),
    ...[
      'act-helpers.swift', 'act-models.swift', 'event-posting.swift',
      'input-delivery-state.swift', 'input-receipt-tap.swift',
    ].map((name) => path.join(repoRoot, 'src/act', name)),
  ]
}

async function compileAndRunHarness(source) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-operation-resource-'))
  const main = path.join(root, 'main.swift')
  const executable = path.join(root, 'operation-resource-proof')
  try {
    await writeFile(main, source)
    execFileSync('swiftc', [
      '-warnings-as-errors', '-module-cache-path', path.join(root, 'module-cache'),
      '-lsqlite3', ...await productionSources(), main, '-o', executable,
    ], { cwd: repoRoot, stdio: 'pipe' })
    execFileSync(executable, [], { cwd: repoRoot, stdio: 'pipe' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('mixed claims are atomic and multiplex detach uses exact broker CAS', async () => {
  await compileAndRunHarness(String.raw`
import Foundation

func expect(_ expected: AOSOperationCoreError, _ body: () throws -> Void) {
    do { try body(); preconditionFailure("expected \(expected)") }
    catch let actual as AOSOperationCoreError { precondition(actual == expected) }
    catch { preconditionFailure("unexpected \(error)") }
}

let exclusive = try AOSResourceDeclaration.make(
    adapterRegistrationID: "capture", adapterRegistrationRevision: 4,
    resourceKey: "camera", admissionMode: .exclusive
)
let multiplex = try AOSResourceDeclaration.make(
    adapterRegistrationID: "capture", adapterRegistrationRevision: 4,
    resourceKey: "screen", admissionMode: .multiplexable, fanoutBound: 2
)
let registration = AOSOperationAdapterRegistration(
    id: "capture", revision: 4, operationClass: "capture", capabilityIDs: ["record"],
    resourceDeclarations: [multiplex, exclusive]
)
let adapterRegistry = try AOSAdapterRegistrySnapshot.make(revision: 9, registrations: [registration])
let store = AOSInMemoryOperationStateStore()
var nextID = 0
let registry = try AOSOperationRegistry(
    store: store, daemonGeneration: 2, adapterRegistry: adapterRegistry,
    clock: { 1_000_000_000 }, idFactory: { nextID += 1; return "id-\(nextID)" }
)
let control = AOSOperationControlPlane(registry: registry, daemonEffectiveUID: 501)
let barrier = try control.completeBootReconciliation(.open)
let owner = AOSMechanicalOwnerRoot(
    ownerID: "owner", effectiveUID: 501, pid: 40, pidGeneration: 3,
    executableIdentityDigest: String(repeating: "a", count: 64)
)
func operation(_ task: String) throws -> AOSOperationRecord {
    try registry.prepareOperation(
        ownerRoot: owner, attribution: AOSOperationAttribution(taskID: task),
        capabilityID: "record", adapterRegistrationID: registration.id,
        adapterRegistrationRevision: registration.revision
    )
}
func exclusiveRequest(_ expected: UInt64) -> AOSResourceClaimRequest {
    AOSResourceClaimRequest(
        adapterRegistrationID: registration.id,
        adapterRegistrationRevision: registration.revision,
        resourceKey: exclusive.resourceKey, admissionMode: .exclusive,
        resourceDeclarationDigest: exclusive.declarationDigest,
        expectedResourceGeneration: expected,
        expectedBrokerGeneration: nil, expectedSubscriberSetRevision: nil,
        expectedSubscriberSetCount: nil, expectedSubscriberSetDigest: nil
    )
}
func multiplexRequest(
    resource: UInt64, broker: UInt64, revision: UInt64,
    count: UInt64, digest: String
) -> AOSResourceClaimRequest {
    AOSResourceClaimRequest(
        adapterRegistrationID: registration.id,
        adapterRegistrationRevision: registration.revision,
        resourceKey: multiplex.resourceKey, admissionMode: .multiplexable,
        resourceDeclarationDigest: multiplex.declarationDigest,
        expectedResourceGeneration: resource,
        expectedBrokerGeneration: broker, expectedSubscriberSetRevision: revision,
        expectedSubscriberSetCount: count, expectedSubscriberSetDigest: digest
    )
}
func brokerCAS(_ broker: AOSResourceBrokerRecord, claim: AOSResourceClaimRecord) -> AOSResourceBrokerCAS {
    AOSResourceBrokerCAS(
        brokerID: broker.brokerID, expectedBrokerGeneration: broker.brokerGeneration,
        resourceKey: broker.resourceKey, expectedResourceGeneration: broker.resourceGeneration,
        expectedAdapterRegistrationID: broker.adapterRegistrationID,
        expectedAdapterRegistrationRevision: broker.adapterRegistrationRevision,
        expectedResourceDeclarationDigest: broker.resourceDeclarationDigest,
        expectedAdapterRegistryRevision: broker.adapterRegistryRevision,
        expectedResourceDeclarationSetCount: broker.resourceDeclarationSetCount,
        expectedResourceDeclarationSetDigest: broker.resourceDeclarationSetDigest,
        expectedSubscriberSetRevision: broker.subscriberSetRevision,
        expectedSubscriberSetCount: UInt64(broker.subscribers.count),
        expectedSubscriberSetDigest: broker.subscriberSetDigest,
        committedClaimSetTransactionID: broker.committedClaimSetTransactionID,
        committedClaimSetDigest: broker.committedClaimSetDigest,
        claimID: claim.claimID, subscriberID: claim.subscriberID!
    )
}

let first = try operation("one")
let transaction = try AOSOperationResourceTransaction.prepare(
    registry: registry, operation: first.identity,
    expectedBarrierGeneration: barrier.generation,
    expectedAdapterRegistry: adapterRegistry,
    requests: [
        multiplexRequest(
            resource: 0, broker: 0, revision: 0, count: 0,
            digest: AOSOperationDigest.empty(.subscriberSet)
        ),
        exclusiveRequest(0),
    ]
)
precondition(transaction.canonicalRequests.map(\.resourceKey) == ["camera", "screen"])
_ = try AOSOperationResourceTransaction.beginReservation(
    registry: registry, transactionID: transaction.transactionID
)
let admission = try AOSOperationResourceTransaction.commit(
    registry: registry, transactionID: transaction.transactionID
)
precondition(admission.claims.count == 2 && admission.brokerPublications.count == 1)
_ = try AOSOperationResourceTransaction.completeHandoff(
    registry: registry, transactionID: transaction.transactionID
)
var snapshot = registry.snapshot()
precondition(snapshot.resourceClaims.count == 2)
precondition(snapshot.resourceClaims.allSatisfy { $0.state == .active })
let initialBroker = snapshot.resourceBrokers[0]
precondition(initialBroker.state == .starting && initialBroker.subscribers.count == 1)
_ = try AOSOperationResourceBroker.markStarted(
    registry: registry, brokerID: initialBroker.brokerID, generation: initialBroker.brokerGeneration
)

let claimsBeforeConflict = registry.snapshot().resourceClaims
let sameOwnerConflict = try AOSOperationResourceTransaction.prepare(
    registry: registry, operation: first.identity,
    expectedBarrierGeneration: barrier.generation, expectedAdapterRegistry: adapterRegistry,
    requests: [exclusiveRequest(1)]
)
_ = try AOSOperationResourceTransaction.beginReservation(
    registry: registry, transactionID: sameOwnerConflict.transactionID
)
expect(.resourceBusy) {
    _ = try AOSOperationResourceTransaction.commit(
        registry: registry, transactionID: sameOwnerConflict.transactionID
    )
}
precondition(registry.snapshot().resourceClaims == claimsBeforeConflict)

let second = try operation("two")
var activeBroker = registry.snapshot().resourceBrokers[0]
let attach = try AOSOperationResourceTransaction.prepare(
    registry: registry, operation: second.identity,
    expectedBarrierGeneration: barrier.generation, expectedAdapterRegistry: adapterRegistry,
    requests: [multiplexRequest(
        resource: activeBroker.resourceGeneration, broker: activeBroker.brokerGeneration,
        revision: activeBroker.subscriberSetRevision,
        count: UInt64(activeBroker.subscribers.count), digest: activeBroker.subscriberSetDigest
    )]
)
_ = try AOSOperationResourceTransaction.beginReservation(registry: registry, transactionID: attach.transactionID)
_ = try AOSOperationResourceTransaction.commit(registry: registry, transactionID: attach.transactionID)
_ = try AOSOperationResourceTransaction.completeHandoff(registry: registry, transactionID: attach.transactionID)
activeBroker = registry.snapshot().resourceBrokers[0]
precondition(activeBroker.state == .active && activeBroker.subscribers.count == 2)

let third = try operation("three")
let fanout = try AOSOperationResourceTransaction.prepare(
    registry: registry, operation: third.identity,
    expectedBarrierGeneration: barrier.generation, expectedAdapterRegistry: adapterRegistry,
    requests: [multiplexRequest(
        resource: activeBroker.resourceGeneration, broker: activeBroker.brokerGeneration,
        revision: activeBroker.subscriberSetRevision,
        count: UInt64(activeBroker.subscribers.count), digest: activeBroker.subscriberSetDigest
    )]
)
_ = try AOSOperationResourceTransaction.beginReservation(registry: registry, transactionID: fanout.transactionID)
let claimCountBeforeFanout = registry.snapshot().resourceClaims.count
expect(.fanoutExhausted) {
    _ = try AOSOperationResourceTransaction.commit(registry: registry, transactionID: fanout.transactionID)
}
precondition(registry.snapshot().resourceClaims.count == claimCountBeforeFanout)

snapshot = registry.snapshot()
activeBroker = snapshot.resourceBrokers[0]
let firstMultiplexClaim = snapshot.resourceClaims.first {
    $0.operation == first.identity && $0.resourceKey == "screen"
}!
let firstCAS = brokerCAS(activeBroker, claim: firstMultiplexClaim)
let nonlast = try AOSOperationResourceClaim.detachMultiplexSubscriber(
    registry: registry, cas: firstCAS
)
precondition(nonlast.disposition == .nonlast)
precondition(nonlast.resultingClaimState == .terminal)
precondition(nonlast.resultingBrokerState == .active)
let stateAfterDetach = registry.snapshot()
expect(.resourceCASConflict) {
    _ = try AOSOperationResourceClaim.detachMultiplexSubscriber(registry: registry, cas: firstCAS)
}
precondition(registry.snapshot() == stateAfterDetach)

snapshot = registry.snapshot()
activeBroker = snapshot.resourceBrokers[0]
let secondMultiplexClaim = snapshot.resourceClaims.first {
    $0.operation == second.identity && $0.resourceKey == "screen"
}!
let last = try AOSOperationResourceClaim.detachMultiplexSubscriber(
    registry: registry, cas: brokerCAS(activeBroker, claim: secondMultiplexClaim)
)
precondition(last.disposition == .last)
precondition(last.resultingClaimState == .terminal)
precondition(last.resultingBrokerState == .stopping)
let stopped = try AOSOperationResourceBroker.completeStop(
    registry: registry, brokerID: activeBroker.brokerID,
    generation: activeBroker.brokerGeneration, absenceVerified: true
)
precondition(stopped.state == .terminal)

let malformed = AOSResourceClaimRequest(
    adapterRegistrationID: registration.id,
    adapterRegistrationRevision: registration.revision,
    resourceKey: "camera", admissionMode: .exclusive,
    resourceDeclarationDigest: String(repeating: "f", count: 64),
    expectedResourceGeneration: 1,
    expectedBrokerGeneration: nil, expectedSubscriberSetRevision: nil,
    expectedSubscriberSetCount: nil, expectedSubscriberSetDigest: nil
)
expect(.resourceDeclarationConflict) {
    _ = try AOSOperationResourceTransaction.prepare(
        registry: registry, operation: third.identity,
        expectedBarrierGeneration: barrier.generation,
        expectedAdapterRegistry: adapterRegistry, requests: [malformed]
    )
}
`)
})
