import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..')

async function source(relativePath) {
  return readFile(path.join(repoRoot, relativePath), 'utf8')
}

async function compileAndRunHarness(mainSource) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-voice-operation-claim-'))
  const main = path.join(root, 'main.swift')
  const executable = path.join(root, 'voice-operation-claim-proof')
  try {
    await writeFile(main, mainSource)
    execFileSync('swiftc', [
      '-warnings-as-errors',
      '-module-cache-path', path.join(root, 'module-cache'),
      path.join(repoRoot, 'src/daemon/operation-owner-root.swift'),
      path.join(repoRoot, 'src/daemon/operation-spawn-record.swift'),
      path.join(repoRoot, 'src/daemon/operation-state.swift'),
      path.join(repoRoot, 'src/daemon/operation-store.swift'),
      path.join(repoRoot, 'src/daemon/operation-registry.swift'),
      path.join(repoRoot, 'src/daemon/operation-resource-transaction.swift'),
      path.join(repoRoot, 'src/daemon/operation-resource-claim.swift'),
      path.join(repoRoot, 'src/daemon/operation-resource-broker.swift'),
      path.join(repoRoot, 'src/daemon/microphone-operation-adapter.swift'),
      main,
      '-o', executable,
    ], { cwd: repoRoot, stdio: 'pipe' })
    execFileSync(executable, [], { cwd: repoRoot, stdio: 'pipe' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('microphone adapter durably owns one exclusive claim before authority and closes it after absence proof', async () => {
  await compileAndRunHarness(String.raw`
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

func expectCoreError(_ expected: AOSOperationCoreError, _ body: () throws -> Void) {
    do {
        try body()
        preconditionFailure("expected \(expected)")
    } catch let error as AOSOperationCoreError {
        precondition(error == expected, "unexpected core error \(error)")
    } catch {
        preconditionFailure("unexpected error \(error)")
    }
}

let registration = try AOSMicrophoneOperationAdapter.makeRegistration()
precondition(registration.id == "microphone-capture-adapter")
precondition(registration.operationClass == "audio-capture")
precondition(registration.capabilityIDs == ["microphone-capture-adapter"])
precondition(registration.resourceDeclarations.count == 1)
precondition(registration.resourceDeclarations[0].resourceKey == "voice_io_native_session")
precondition(registration.resourceDeclarations[0].admissionMode == .exclusive)
precondition(registration.resourceDeclarations[0].fanoutBound == nil)

let adapterRegistry = try AOSAdapterRegistrySnapshot.make(
    revision: 1,
    registrations: [registration]
)
let store = AOSInMemoryOperationStateStore()
let idLock = NSLock()
var nextID = 0
let registry = try AOSOperationRegistry(
    store: store,
    daemonGeneration: 7,
    adapterRegistry: adapterRegistry,
    clock: { 99 },
    idFactory: {
        idLock.lock()
        defer { idLock.unlock() }
        nextID += 1
        return "id-\(nextID)"
    }
)
try registry.mutateDurably { state in
    state.barrier.state = .open
    state.barrier.openSnapshot = try AOSOpenBarrierSnapshot.make(
        barrierGeneration: state.barrier.generation,
        registry: state.adapterRegistry
    )
    state.barrier.cleanupResult = .zeroResiduals
    state.barrier.reconciliationState = "complete"
}

let ownerRoot = AOSMechanicalOwnerRoot(
    ownerID: "owner-digest",
    effectiveUID: 501,
    pid: 123,
    pidGeneration: 4,
    executableIdentityDigest: String(repeating: "a", count: 64)
)
let owner = UUID()
let adapter = try AOSMicrophoneOperationAdapter(
    registry: registry,
    registration: registration,
    contextResolver: { requestedOwner in
        precondition(requestedOwner == owner)
        return AOSMicrophoneOperationContext(
            ownerRoot: ownerRoot,
            attribution: AOSOperationAttribution(clientID: "client-label")
        )
    }
)
try registry.installRuntimeAdapters([adapter])

let omittedAttribution = try AOSOperationAttribution.validatingPublicValue(nil)
precondition(omittedAttribution == AOSOperationAttribution())
let completeAttribution = try AOSOperationAttribution.validatingPublicValue([
    "client_id": "client-1", "agent_id": "agent-1", "project_id": "project-1",
    "task_id": "task-1", "run_id": "run-1", "skill_id": "skill-1",
    "target_id": "target-1", "capability_label": "microphone", "retry_id": "retry-1",
])
precondition(completeAttribution.publicValue == [
    "client_id": "client-1", "agent_id": "agent-1", "project_id": "project-1",
    "task_id": "task-1", "run_id": "run-1", "skill_id": "skill-1",
    "target_id": "target-1", "capability_label": "microphone", "retry_id": "retry-1",
])
for malformed: Any in [
    ["task_id": "bad value"],
    ["owner_root": "forged"],
    ["effective_uid": 501],
    ["retry_id": String(repeating: "a", count: 129)],
] {
    expectCoreError(.invalidRecord("asserted_attribution")) {
        _ = try AOSOperationAttribution.validatingPublicValue(malformed)
    }
}
precondition(registry.snapshot().operations.isEmpty)
precondition(registry.snapshot().resourceClaims.isEmpty)

try registry.mutateDurably { state in
    state.barrier.state = .bootReconciling
    state.barrier.openSnapshot = nil
    state.barrier.cleanupResult = .pending
    state.barrier.reconciliationState = "pending"
}
expectCoreError(.barrierClosed) {
    _ = try adapter.prepareCapture(owner: owner)
}
var state = registry.snapshot()
precondition(state.operations.isEmpty)
precondition(state.resourceTransactions.isEmpty)
precondition(state.resourceClaims.isEmpty)
try registry.mutateDurably { state in
    state.barrier.state = .open
    state.barrier.openSnapshot = try AOSOpenBarrierSnapshot.make(
        barrierGeneration: state.barrier.generation,
        registry: state.adapterRegistry
    )
    state.barrier.cleanupResult = .zeroResiduals
    state.barrier.reconciliationState = "complete"
}

let assertedOperation = try adapter.prepareExternalCapture(context: AOSMicrophoneOperationContext(
    ownerRoot: ownerRoot,
    attribution: completeAttribution
))
state = registry.snapshot()
precondition(state.operations.first { $0.identity == assertedOperation }?.attribution == completeAttribution)
adapter.abandonPreparedCapture(operation: assertedOperation)

let omittedOperation = try adapter.prepareExternalCapture(context: AOSMicrophoneOperationContext(
    ownerRoot: ownerRoot,
    attribution: omittedAttribution
))
state = registry.snapshot()
precondition(state.operations.first { $0.identity == omittedOperation }?.attribution == omittedAttribution)
adapter.abandonPreparedCapture(operation: omittedOperation)

let concurrentAttributions = [
    AOSOperationAttribution(clientID: "client-a", taskID: "task-a", retryID: "retry-a"),
    AOSOperationAttribution(clientID: "client-b", taskID: "task-b", retryID: "retry-b"),
]
final class OperationCollector {
    private let lock = NSLock()
    private var storage: [AOSOperationIdentity] = []
    func append(_ operation: AOSOperationIdentity) {
        lock.lock()
        storage.append(operation)
        lock.unlock()
    }
    var values: [AOSOperationIdentity] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }
}
let concurrentOperations = OperationCollector()
let concurrentGroup = DispatchGroup()
for attribution in concurrentAttributions {
    concurrentGroup.enter()
    DispatchQueue.global().async {
        defer { concurrentGroup.leave() }
        if let operation = try? adapter.prepareExternalCapture(context: AOSMicrophoneOperationContext(
            ownerRoot: ownerRoot,
            attribution: attribution
        )) {
            concurrentOperations.append(operation)
        }
    }
}
concurrentGroup.wait()
precondition(concurrentOperations.values.count == 1)
state = registry.snapshot()
let concurrentRecords = state.operations.filter {
    $0.attribution.taskID == "task-a" || $0.attribution.taskID == "task-b"
}
precondition(concurrentRecords.count == 2)
precondition(Set(concurrentRecords.map {
    "\($0.attribution.clientID!):\($0.attribution.taskID!):\($0.attribution.retryID!)"
}) == Set(["client-a:task-a:retry-a", "client-b:task-b:retry-b"]))
adapter.abandonPreparedCapture(operation: concurrentOperations.values[0])

let first = try adapter.prepareCapture(owner: owner)
state = registry.snapshot()
let firstOperation = state.operations.last!.identity
precondition(state.operations.last!.state == .starting)
precondition(state.operations.last!.capabilityID == "microphone-capture-adapter")
precondition(state.resourceTransactions.last!.state == .terminal)
precondition(state.resourceClaims.last!.state == .active)
precondition(state.resourceClaims.last!.admissionMode == .exclusive)
precondition(state.resourceClaims.last!.operation == firstOperation)
let firstClaimGeneration = state.resourceClaims.last!.resourceGeneration

let operationPreparedSave = store.savedStates.firstIndex {
    $0.operations.contains { $0.identity == firstOperation && $0.state == .prepared }
}!
let claimCommittedSave = store.savedStates.firstIndex {
    $0.resourceClaims.contains { $0.operation == firstOperation && $0.state == .active }
}!
precondition(operationPreparedSave < claimCommittedSave)

let rejectedBeforeBusy = registry.snapshot().operations.filter {
    $0.state == .terminal && $0.outcome == .rejected
}.count
expectCoreError(.resourceBusy) {
    _ = try adapter.prepareCapture(owner: owner)
}
state = registry.snapshot()
precondition(state.resourceClaims.filter { $0.state == .active }.count == 1)
precondition(state.operations.filter {
    $0.state == .terminal && $0.outcome == .rejected
}.count == rejectedBeforeBusy + 1)

var stopRequests: [Bool] = []
try first.bindAuthority(
    stop: { stopRequests.append($0) },
    residualDigest: { nil }
)
try first.markAuthorityStarted()
let firstActive = try registry.inspect(firstOperation)
precondition(firstActive.state == .active)
try first.noteStop(trigger: .completed)
first.authorityDidTerminate(AOSMicrophoneCaptureTermination(
    token: UUID(),
    trigger: .completed,
    authorityAbsent: true
))
state = registry.snapshot()
precondition(state.operations.first { $0.identity == firstOperation }?.state == .terminal)
precondition(state.operations.first { $0.identity == firstOperation }?.outcome == .succeeded)
precondition(state.resourceClaims.first { $0.operation == firstOperation }?.state == .terminal)
precondition(stopRequests.isEmpty)

let second = try adapter.prepareCapture(owner: owner)
state = registry.snapshot()
let secondOperation = state.operations.last!.identity
let secondClaim = state.resourceClaims.last!
precondition(secondClaim.resourceGeneration == firstClaimGeneration + 1)
try second.bindAuthority(
    stop: { stopRequests.append($0) },
    residualDigest: { nil }
)
try second.markAuthorityStarted()
let stopReceipt = adapter.requestStop(operation: secondOperation, force: true)
precondition(stopReceipt.disposition == .accepted)
precondition(stopRequests == [true])
second.authorityDidTerminate(AOSMicrophoneCaptureTermination(
    token: UUID(),
    trigger: .killed,
    authorityAbsent: true
))
state = registry.snapshot()
precondition(state.operations.first { $0.identity == secondOperation }?.state == .terminal)
precondition(state.operations.first { $0.identity == secondOperation }?.outcome == .killed)
precondition(state.resourceClaims.first { $0.operation == secondOperation }?.state == .terminal)

let hostStopped = try adapter.prepareCapture(owner: owner)
state = registry.snapshot()
let hostStoppedOperation = state.operations.last!.identity
try hostStopped.bindAuthority(stop: { stopRequests.append($0) }, residualDigest: { nil })
try hostStopped.markAuthorityStarted()
_ = try registry.transitionOperation(
    hostStoppedOperation,
    to: .stopping,
    stopIntent: .hostStop
)
let hostStopReceipt = adapter.requestStop(operation: hostStoppedOperation, force: true)
precondition(hostStopReceipt.disposition == .alreadyStopping)
precondition(stopRequests == [true, true])
hostStopped.authorityDidTerminate(AOSMicrophoneCaptureTermination(
    token: UUID(),
    trigger: .killed,
    authorityAbsent: true
))
state = registry.snapshot()
precondition(state.operations.first { $0.identity == hostStoppedOperation }?.state == .terminal)
precondition(state.operations.first { $0.identity == hostStoppedOperation }?.outcome == .killed)

let residual = try adapter.prepareCapture(owner: owner)
state = registry.snapshot()
let residualOperation = state.operations.last!.identity
try residual.bindAuthority(stop: { _ in }, residualDigest: { nil })
try residual.markAuthorityStarted()
residual.authorityDidTerminate(AOSMicrophoneCaptureTermination(
    token: UUID(),
    trigger: .adapterFailed,
    authorityAbsent: false
))
state = registry.snapshot()
precondition(state.operations.first { $0.identity == residualOperation }?.state == .cleanupRequired)
precondition(state.resourceClaims.first { $0.operation == residualOperation }?.state == .cleanupRequired)
precondition(adapter.residualDigest(operation: residualOperation) != nil)
`)
})

test('voice transport uses an atomic legacy-output sentinel and one shared native microphone owner', async () => {
  const [transport, segmented, session, playback, adapter, state] = await Promise.all([
    source('src/daemon/voice-transport.swift'),
    source('src/daemon/segmented-microphone-capture.swift'),
    source('src/daemon/microphone-native-session.swift'),
    source('src/daemon/audio-playback.swift'),
    source('src/daemon/microphone-operation-adapter.swift'),
    source('src/daemon/operation-state.swift'),
  ])

  assert.doesNotMatch(transport, /barge_in/)
  assert.match(transport, /private var output: \(any AOSLegacyVoiceOutputSentinel\)\?/)
  assert.match(transport, /guard capture == nil, pendingCaptureAdmission == nil/)
  assert.match(transport, /guard output == nil else[\s\S]*code: "OPERATION_RESOURCE_BUSY"/)
  assert.match(playback, /protocol AOSLegacyVoiceOutputSentinel: AOSVoiceOutputLease/)
  assert.match(playback, /AOSAudioPlaybackSession: AOSLegacyVoiceOutputSentinel/)
  assert.match(transport, /AOSStreamingSpeechSession: AOSLegacyVoiceOutputSentinel/)
  assert.doesNotMatch(playback, /AOSOperationControlAdapter/)
  assert.doesNotMatch(segmented, /AVAudioEngine|installTap|removeTap/u)
  assert.doesNotMatch(segmented, /engineOwned/u)
  assert.match(segmented, /sharedOwnerStartAttempted/u)
  assert.match(
    segmented,
    /0\.\.<aosSegmentedMicrophoneAuthorityStopAttemptLimit[\s\S]*nativeSession\.stop\(\)[\s\S]*nativeSession\.authorityAbsent/u,
  )
  assert.equal((session.match(/AVAudioEngine\(\)/gu) ?? []).length, 1)
  assert.match(adapter, /AOSMicrophoneOperationResourceIdentity\.resourceKey/u)
  assert.match(state, /static let resourceKey = "voice_io_native_session"/u)

  const start = transport.slice(
    transport.indexOf('func startCapture('),
    transport.indexOf('func prepareSegmentedCapture('),
  )
  const orderedMarkers = [
    'beginCaptureAdmission(owner: owner)',
    'prepareCaptureOperation(owner: owner',
    'microphoneAuthorization.status()',
    'AOSMicrophoneCaptureSession(',
    'installCapture(',
    'bindAuthority(',
    'try session.start()',
    'markAuthorityStarted()',
  ]
  let cursor = -1
  for (const marker of orderedMarkers) {
    const index = start.indexOf(marker)
    assert.ok(index > cursor, `${marker} is out of order`)
    cursor = index
  }

  assert.match(segmented, /let authorityAbsent = stopEngine\(\)/)
  assert.match(segmented, /authorityAbsent: authorityAbsent/)
  assert.match(adapter, /finishExclusiveRelease\([\s\S]*absenceVerified: authorityAbsent/)
  assert.match(adapter, /claimIsTerminal = release\.state == \.terminal && release\.absenceVerified/)
  assert.match(adapter, /terminalizeOperationAfterVerifiedCleanup\([\s\S]*outcome:/)
})
