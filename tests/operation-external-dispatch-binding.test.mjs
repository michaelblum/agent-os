import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..')
const stateSource = path.join(repoRoot, 'src/daemon/operation-state.swift')
const ownerSource = path.join(repoRoot, 'src/daemon/operation-owner-root.swift')
const spawnSource = path.join(repoRoot, 'src/daemon/operation-spawn-record.swift')
const dispatchSource = path.join(repoRoot, 'src/shared/external-command-dispatch.swift')
const unifiedSource = path.join(repoRoot, 'src/daemon/unified.swift')

async function compileAndRunHarness(source) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-operation-spawn-binding-'))
  const support = path.join(root, 'GeometryStateSupport.swift')
  const main = path.join(root, 'main.swift')
  const executable = path.join(root, 'spawn-binding-proof')
  try {
    await Promise.all([
      writeFile(support, String.raw`
import Foundation
struct AOSScreenRecordingGeometryState: Codable, Equatable {
  var eventSequence: UInt64 = 0
}
func aosScreenRecordingGeometryPublicValue(
  _ state: AOSScreenRecordingGeometryState
) -> [String: Any] { [:] }
`),
      writeFile(main, source),
    ])
    execFileSync('swiftc', [
      '-module-cache-path', path.join(root, 'module-cache'),
      stateSource,
      ownerSource,
      spawnSource,
      support,
      main,
      '-o', executable,
    ], { cwd: repoRoot, stdio: 'pipe' })
    execFileSync(executable, [], { cwd: repoRoot, stdio: 'pipe' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function compileAndRunPureSwiftHarness(source) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-external-intent-classification-'))
  const main = path.join(root, 'main.swift')
  const executable = path.join(root, 'external-intent-classification-proof')
  try {
    await writeFile(main, source)
    execFileSync('swiftc', [
      '-module-cache-path', path.join(root, 'module-cache'),
      main,
      '-o', executable,
    ], { cwd: repoRoot, stdio: 'pipe' })
    execFileSync(executable, [], { cwd: repoRoot, stdio: 'pipe' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('external dispatch publishes digest-only intent, finalization, receipt, and skip evidence', async () => {
  await compileAndRunHarness(String.raw`
import Foundation

func digest(_ scalar: Character) -> AOSSHA256Digest {
    try! AOSSHA256Digest(String(repeating: String(scalar), count: 64))
}

func token(pid: pid_t, version: UInt32) -> AOSAuditTokenIdentity {
    var words = Array(repeating: UInt32(0), count: 8)
    words[1] = 501
    words[5] = UInt32(bitPattern: pid)
    words[7] = version
    return try! AOSAuditTokenIdentity(words: words)
}

func expectError<T: Equatable>(_ expected: T, _ body: () throws -> Void) {
    do {
        try body()
        preconditionFailure("expected error")
    } catch let actual as T {
        precondition(actual == expected)
    } catch {
        preconditionFailure("unexpected error: \(error)")
    }
}

let parent = AOSProcessObservation(
    generation: AOSProcessGenerationIdentity(
        pid: 600,
        effectiveUID: 501,
        parentPID: 1,
        startTimeSeconds: 60,
        startTimeMicroseconds: 1
    ),
    image: AOSProcessImageEvidence(
        executableIdentityDigest: digest("a"),
        executableDigest: digest("b")
    )
)
let child = AOSProcessObservation(
    generation: AOSProcessGenerationIdentity(
        pid: 601,
        effectiveUID: 501,
        parentPID: 600,
        startTimeSeconds: 61,
        startTimeMicroseconds: 2
    ),
    image: AOSProcessImageEvidence(
        executableIdentityDigest: digest("c"),
        executableDigest: digest("d")
    )
)
let edge = AOSStableProcessEdge(
    child: child,
    parent: parent,
    receipt: .make(child: child.generation, parent: parent.generation)
)
let peer = AOSSocketPeerIdentity(auditToken: token(pid: 601, version: 5))
let executable = AOSResolvedExecutableObservation(
    resolvedPathDigest: digest("1"),
    executableIdentityDigest: child.image.executableIdentityDigest,
    device: 12,
    inode: 34,
    codeIdentityDigest: digest("2"),
    fileDigest: child.image.executableDigest,
    platformCodeDirectoryHash: try AOSPlatformCodeDirectoryHash(
        String(repeating: "a", count: 40)
    ),
    signingIdentifier: "node",
    signingTeamIdentifier: "HX7739G8FX"
)
let running = AOSExternalRunningExecutableEvidence(
    resolvedPathDigest: executable.resolvedPathDigest,
    device: executable.device,
    inode: executable.inode,
    platformCodeDirectoryHash: executable.platformCodeDirectoryHash!,
    signingIdentifier: executable.signingIdentifier!,
    signingTeamIdentifier: executable.signingTeamIdentifier!
)
let bindingToken = Data("opaque-binding-token".utf8)
let rawScriptIdentity = "scripts/aos-tell-listen.mjs"
let scriptDigest = digest("3")
let argvShapeDigest = digest("4")
let reviewedDependencySetDigest = digest("9")
let intent = try AOSExternalDispatchSpawnBinder.makeIntent(
    spawnRecordID: "spawn-601",
    oneTimeBindingToken: bindingToken,
    parent: parent.generation,
    operationID: "operation-601",
    operationGeneration: 8,
    adapterID: "microphone-capture-adapter",
    adapterRegistrationRevision: 11,
    executable: executable,
    authoredScriptIdentity: rawScriptIdentity,
    expectedScriptDigest: scriptDigest,
    canonicalArgvShapeDigest: argvShapeDigest,
    reviewedDependencySetDigest: reviewedDependencySetDigest,
    daemonGeneration: 7,
    createdAtMonotonicNanoseconds: 100,
    expiresAtMonotonicNanoseconds: 500
)
precondition(intent.expectedScriptIdentityDigest == .hashing(
    domain: .externalScriptIdentity,
    data: Data(rawScriptIdentity.utf8)
))
let crossDomainDigests = Set([
    AOSDigestDomain.parentEdge,
    .ownerBinding,
    .externalScriptIdentity,
    .externalBindingToken,
].map {
    AOSSHA256Digest.hashing(domain: $0, data: bindingToken)
})
precondition(crossDomainDigests.count == 4)

expectError(AOSExternalDispatchSpawnBindingError.childNotAdmitted) {
    _ = try AOSExternalDispatchSpawnBinder.finalize(
        intent: intent,
        observation: AOSExternalDispatchFinalizationObservation(
            spawnRecordID: intent.spawnRecordID,
            peer: peer,
            parentEdge: edge,
            runningExecutable: running,
            operationID: intent.operationID,
            operationGeneration: intent.operationGeneration,
            adapterID: intent.adapterID,
            adapterRegistrationRevision: intent.adapterRegistrationRevision,
            canonicalArgvShapeDigest: argvShapeDigest,
            finalizedAtMonotonicNanoseconds: 300
        )
    )
}
expectError(AOSExternalDispatchSpawnBindingError.bindingTokenMismatch) {
    _ = try AOSExternalDispatchSpawnBinder.admit(
        intent: intent,
        oneTimeBindingToken: Data("wrong".utf8),
        authenticatedParent: parent.generation,
        childEdge: edge,
        runningExecutable: running,
        admittedAtMonotonicNanoseconds: 200
    )
}
let admittedIntent = try AOSExternalDispatchSpawnBinder.admit(
    intent: intent,
    oneTimeBindingToken: bindingToken,
    authenticatedParent: parent.generation,
    childEdge: edge,
    runningExecutable: running,
    admittedAtMonotonicNanoseconds: 200
)
let observation = AOSExternalDispatchFinalizationObservation(
    spawnRecordID: admittedIntent.spawnRecordID,
    peer: peer,
    parentEdge: edge,
    runningExecutable: running,
    operationID: admittedIntent.operationID,
    operationGeneration: admittedIntent.operationGeneration,
    adapterID: admittedIntent.adapterID,
    adapterRegistrationRevision: admittedIntent.adapterRegistrationRevision,
    canonicalArgvShapeDigest: argvShapeDigest,
    finalizedAtMonotonicNanoseconds: 300
)
let finalized = try AOSExternalDispatchSpawnBinder.finalize(
    intent: admittedIntent,
    observation: observation
)
try finalized.skipRecord.verifySkip(edge: edge, immediatePeer: peer)
precondition(finalized.receipt.outcome == AOSExternalDispatchSpawnOutcome.finalized)
precondition(finalized.receipt.platformCodeDirectoryHashAlgorithm
    == "sha256_truncated_cdhash_20_bytes")

let encoder = JSONEncoder()
encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
for encoded in [
    try encoder.encode(admittedIntent),
    try encoder.encode(finalized),
    try encoder.encode(finalized.receipt),
] {
    let json = String(decoding: encoded, as: UTF8.self)
    precondition(!json.contains(rawScriptIdentity))
    precondition(!json.contains("aos-tell-listen.mjs"))
    precondition(!json.contains("opaque-binding-token"))
    precondition(!json.contains("\"scriptPath\""))
    precondition(!json.contains("\"scriptBasename\""))
    precondition(!json.contains("\"resolvedScriptPath\""))
    precondition(!json.contains("\"argv\":"))
}

let substitutedRunning = AOSExternalRunningExecutableEvidence(
    resolvedPathDigest: executable.resolvedPathDigest,
    device: executable.device,
    inode: executable.inode,
    platformCodeDirectoryHash: try AOSPlatformCodeDirectoryHash(
        String(repeating: "b", count: 40)
    ),
    signingIdentifier: running.signingIdentifier,
    signingTeamIdentifier: running.signingTeamIdentifier
)
expectError(AOSExternalDispatchSpawnBindingError.executableMismatch) {
    _ = try AOSExternalDispatchSpawnBinder.admit(
        intent: intent,
        oneTimeBindingToken: bindingToken,
        authenticatedParent: parent.generation,
        childEdge: edge,
        runningExecutable: substitutedRunning,
        admittedAtMonotonicNanoseconds: 200
    )
}

var changed = AOSExternalDispatchFinalizationObservation(
    spawnRecordID: observation.spawnRecordID,
    peer: observation.peer,
    parentEdge: observation.parentEdge,
    runningExecutable: substitutedRunning,
    operationID: observation.operationID,
    operationGeneration: observation.operationGeneration,
    adapterID: observation.adapterID,
    adapterRegistrationRevision: observation.adapterRegistrationRevision,
    canonicalArgvShapeDigest: observation.canonicalArgvShapeDigest,
    finalizedAtMonotonicNanoseconds: observation.finalizedAtMonotonicNanoseconds
)
expectError(AOSExternalDispatchSpawnBindingError.executableMismatch) {
    _ = try AOSExternalDispatchSpawnBinder.finalize(intent: admittedIntent, observation: changed)
}

changed = AOSExternalDispatchFinalizationObservation(
    spawnRecordID: observation.spawnRecordID,
    peer: observation.peer,
    parentEdge: observation.parentEdge,
    runningExecutable: observation.runningExecutable,
    operationID: observation.operationID,
    operationGeneration: observation.operationGeneration,
    adapterID: observation.adapterID,
    adapterRegistrationRevision: observation.adapterRegistrationRevision,
    canonicalArgvShapeDigest: digest("6"),
    finalizedAtMonotonicNanoseconds: observation.finalizedAtMonotonicNanoseconds
)
expectError(AOSExternalDispatchSpawnBindingError.argvShapeMismatch) {
    _ = try AOSExternalDispatchSpawnBinder.finalize(intent: admittedIntent, observation: changed)
}

changed = AOSExternalDispatchFinalizationObservation(
    spawnRecordID: observation.spawnRecordID,
    peer: observation.peer,
    parentEdge: observation.parentEdge,
    runningExecutable: observation.runningExecutable,
    operationID: observation.operationID,
    operationGeneration: observation.operationGeneration,
    adapterID: observation.adapterID,
    adapterRegistrationRevision: observation.adapterRegistrationRevision,
    canonicalArgvShapeDigest: observation.canonicalArgvShapeDigest,
    finalizedAtMonotonicNanoseconds: 500
)
expectError(AOSExternalDispatchSpawnBindingError.intentExpired) {
    _ = try AOSExternalDispatchSpawnBinder.finalize(intent: admittedIntent, observation: changed)
}

for invalid in [
    "/absolute/script.mjs", "../escape.mjs", "scripts/../escape.mjs",
    "scripts//listen.mjs", "scripts/./listen.mjs", "scripts\\listen.mjs",
] {
    expectError(AOSExternalDispatchSpawnBindingError.invalidScriptIdentity) {
        _ = try AOSExternalDispatchSpawnBinder.digestScriptIdentity(invalid)
    }
}
`)
})

test('durable external-dispatch shapes expose digest fields and no raw script carrier', async () => {
  const source = await readFile(spawnSource, 'utf8')
  const intent = source.match(/struct AOSExternalDispatchSpawnIntent[\s\S]*?\n\}/u)?.[0]
  const finalized = source.match(/struct AOSFinalizedExternalDispatchSpawnRecord[\s\S]*?\n\}/u)?.[0]
  const receipt = source.match(/struct AOSExternalDispatchSpawnReceipt[\s\S]*?\n\}/u)?.[0]
  for (const shape of [intent, finalized, receipt]) {
    assert.ok(shape)
    assert.doesNotMatch(shape, /let (?:expectedScriptIdentity|scriptIdentity|scriptPath|scriptBasename|resolvedScriptPath|argv):/u)
    assert.doesNotMatch(shape, /let (?:reviewedDependencies|reviewedDependencyIdentities|dependencyPaths):/u)
  }
  assert.match(source, /expectedScriptIdentityDigest/u)
  assert.match(source, /scriptIdentityDigest/u)
  assert.match(source, /canonicalArgvShapeDigest/u)
  assert.match(source, /reviewedDependencySetDigest/u)
})

test('registered microphone spawn classifies unavailable and daemon error responses without raw data', async () => {
  const [source, state] = await Promise.all([
    readFile(dispatchSource, 'utf8'),
    readFile(stateSource, 'utf8'),
  ])
  const intent = source.match(/private func prepareExternalSpawnIntent\([\s\S]*?\n\}/u)?.[0]
  const classifier = source.match(
    /private struct ExternalSpawnIntentFailureClassification[\s\S]*?(?=\nprivate func exitExternalSpawnIntentFailure)/u,
  )?.[0]
  const daemonCodes = [...state.matchAll(/case \.[^:]+: return "(OPERATION_[A-Z0-9_]+)"/gu)]
    .map((match) => match[1])
  assert.ok(intent)
  assert.ok(classifier)
  assert.ok(daemonCodes.length > 0)
  assert.match(intent, /exitExternalSpawnIntentFailure\(\.noResponse\)/u)
  assert.match(intent, /externalSpawnIntentDaemonFailureClassification\(response\)/u)
  assert.doesNotMatch(intent, /EXTERNAL_SPAWN_INTENT_FAILED/u)

  await compileAndRunPureSwiftHarness(`
import Foundation

${classifier}

precondition(ExternalSpawnIntentFailureClassification.noResponse
    == ExternalSpawnIntentFailureClassification(
        code: "EXTERNAL_SPAWN_INTENT_NO_RESPONSE",
        reason: nil
    ))
for code in ${JSON.stringify(daemonCodes)} {
    precondition(externalSpawnIntentDaemonFailureClassification([
        "error": code,
        "code": code,
    ]) == ExternalSpawnIntentFailureClassification(code: code, reason: nil))
}
precondition(externalSpawnIntentDaemonFailureClassification([
    "error": "OPERATION_BARRIER_CLOSED",
    "code": "OPERATION_BARRIER_CLOSED",
]) == ExternalSpawnIntentFailureClassification(
    code: "OPERATION_BARRIER_CLOSED",
    reason: nil
))
precondition(externalSpawnIntentDaemonFailureClassification([
    "error": "OPERATION_RESOURCE_BUSY",
    "code": "OPERATION_RESOURCE_BUSY",
]) == ExternalSpawnIntentFailureClassification(
    code: "OPERATION_RESOURCE_BUSY",
    reason: nil
))
precondition(externalSpawnIntentDaemonFailureClassification([
    "error": "OPERATION_CALLER_NOT_AUTHENTICATED",
    "code": "OPERATION_CALLER_NOT_AUTHENTICATED",
]) == ExternalSpawnIntentFailureClassification(
    code: "OPERATION_CALLER_NOT_AUTHENTICATED",
    reason: nil
))
precondition(externalSpawnIntentDaemonFailureClassification([
    "error": "OPERATION_RECORD_INVALID:external_spawn_intent",
    "code": "OPERATION_RECORD_INVALID",
]) == ExternalSpawnIntentFailureClassification(
    code: "OPERATION_RECORD_INVALID",
    reason: "external_spawn_intent"
))
precondition(externalSpawnIntentDaemonFailureClassification([
    "error": "OPERATION_RECORD_INVALID:/private/tmp/private.wav",
    "code": "OPERATION_RECORD_INVALID",
]) == ExternalSpawnIntentFailureClassification(
    code: "OPERATION_RECORD_INVALID",
    reason: nil
))
precondition(externalSpawnIntentDaemonFailureClassification([
    "error": "private daemon text",
    "code": "OPERATION_PRIVATE_IDENTITY_123",
    "details": ["path": "/private/tmp/private.wav"],
]) == ExternalSpawnIntentFailureClassification(
    code: "EXTERNAL_SPAWN_INTENT_DAEMON_ERROR",
    reason: nil
))
precondition(externalSpawnIntentDaemonFailureClassification([
    "v": 1,
    "status": "success",
]) == nil)
`)
})

test('registered microphone attribution is validated before spawn and never becomes connection state', async () => {
  const [dispatch, unified, state] = await Promise.all([
    readFile(dispatchSource, 'utf8'),
    readFile(unifiedSource, 'utf8'),
    readFile(stateSource, 'utf8'),
  ])
  const fields = [
    ['--client-id', 'client_id'], ['--agent-id', 'agent_id'],
    ['--project-id', 'project_id'], ['--task-id', 'task_id'],
    ['--run-id', 'run_id'], ['--skill-id', 'skill_id'],
    ['--target-id', 'target_id'], ['--capability-label', 'capability_label'],
    ['--retry-id', 'retry_id'],
  ]
  for (const [flag, wire] of fields) {
    assert.match(dispatch, new RegExp(`${flag.replaceAll('-', '\\-')}.*${wire}`, 's'))
    assert.match(state, new RegExp(`"${wire}"`))
  }
  assert.match(dispatch, /"asserted_attribution": assertedAttribution/u)
  assert.match(dispatch, /guard externalCommandActivatesSpawnRegistration\(forwardedArguments\) else/u)
  assert.match(dispatch, /Invalid registered microphone invocation/u)
  assert.match(unified, /service == "operation" && action == "external_spawn_intent"/u)
  assert.match(unified, /operationContext\(for: connectionID, attribution: attribution\)/u)
  assert.doesNotMatch(unified, /var operationAttribution:/u)
})

test('generated microphone help exposes exactly the generic asserted attribution flags', async () => {
  const registry = JSON.parse(await readFile(
    path.join(repoRoot, 'manifests/commands/aos-commands.json'),
    'utf8',
  ))
  const listen = registry.commands.find((command) => command.path.join(' ') === 'listen')
  const forms = new Map(listen.forms.map((form) => [form.id, form]))
  const expected = [
    '--client-id', '--agent-id', '--project-id', '--task-id', '--run-id',
    '--skill-id', '--target-id', '--capability-label', '--retry-id',
  ]
  for (const id of ['listen-microphone', 'listen-microphone-segmented']) {
    const tokens = forms.get(id).args.map((argument) => argument.token).filter(Boolean)
    assert.deepEqual(tokens.filter((token) => expected.includes(token)), expected)
  }
  const hotkeyTokens = forms.get('listen-hotkey').args.map((argument) => argument.token).filter(Boolean)
  assert.equal(hotkeyTokens.some((token) => expected.includes(token)), false)
})
