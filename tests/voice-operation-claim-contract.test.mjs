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
let registry = try AOSOperationRegistry(
    store: store,
    daemonGeneration: 7,
    adapterRegistry: adapterRegistry,
    clock: { 99 },
    idFactory: {
        struct Counter { static var value = 0 }
        Counter.value += 1
        return "id-\(Counter.value)"
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

let first = try adapter.prepareCapture(owner: owner)
var state = registry.snapshot()
precondition(state.operations.count == 1)
precondition(state.operations[0].state == .starting)
precondition(state.operations[0].capabilityID == "microphone-capture-adapter")
precondition(state.resourceTransactions.count == 1)
precondition(state.resourceTransactions[0].state == .terminal)
precondition(state.resourceClaims.count == 1)
precondition(state.resourceClaims[0].state == .active)
precondition(state.resourceClaims[0].admissionMode == .exclusive)
precondition(state.resourceClaims[0].operation == state.operations[0].identity)
let firstOperation = state.operations[0].identity

let operationPreparedSave = store.savedStates.firstIndex {
    $0.operations.contains { $0.identity == firstOperation && $0.state == .prepared }
}!
let claimCommittedSave = store.savedStates.firstIndex {
    $0.resourceClaims.contains { $0.operation == firstOperation && $0.state == .active }
}!
precondition(operationPreparedSave < claimCommittedSave)

expectCoreError(.resourceBusy) {
    _ = try adapter.prepareCapture(owner: owner)
}
state = registry.snapshot()
precondition(state.resourceClaims.filter { $0.state == .active }.count == 1)
precondition(state.operations.filter { $0.state == .terminal && $0.outcome == .rejected }.count == 1)

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
precondition(secondClaim.resourceGeneration == 2)
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

test('voice transport uses an atomic legacy-output sentinel and has no implicit preemption path', async () => {
  const [transport, segmented, playback, adapter] = await Promise.all([
    source('src/daemon/voice-transport.swift'),
    source('src/daemon/segmented-microphone-capture.swift'),
    source('src/daemon/audio-playback.swift'),
    source('src/daemon/microphone-operation-adapter.swift'),
  ])

  assert.doesNotMatch(transport, /barge_in/)
  assert.match(transport, /private var output: \(any AOSLegacyVoiceOutputSentinel\)\?/)
  assert.match(transport, /guard capture == nil, pendingCaptureAdmission == nil/)
  assert.match(transport, /guard output == nil else[\s\S]*code: "OPERATION_RESOURCE_BUSY"/)
  assert.match(playback, /protocol AOSLegacyVoiceOutputSentinel: AOSVoiceOutputLease/)
  assert.match(playback, /AOSAudioPlaybackSession: AOSLegacyVoiceOutputSentinel/)
  assert.match(transport, /AOSStreamingSpeechSession: AOSLegacyVoiceOutputSentinel/)
  assert.doesNotMatch(playback, /AOSOperationControlAdapter/)

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
  assert.match(adapter, /to: \.terminal,[\s\S]*outcome:/)
})
