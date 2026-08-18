import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..')
const coreSources = [
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
].map((name) => path.join(repoRoot, 'src/daemon', name))

test('daemon operation integration retains secure routing and exact wire boundaries', async () => {
  const unified = await readFile(path.join(repoRoot, 'src/daemon/unified.swift'), 'utf8')
  const owner = await readFile(path.join(repoRoot, 'src/daemon/operation-owner-root.swift'), 'utf8')
  const registry = await readFile(path.join(repoRoot, 'src/daemon/operation-registry.swift'), 'utf8')
  assert.match(owner, /LOCAL_PEERTOKEN/u)
  assert.match(owner, /AOSRuntimeOwnerRootClassifier/u)
  assert.match(owner, /SecCodeCheckValidity\(guest, SecCSFlags\(\), requirement\)/u)
  assert.match(owner, /anchor apple generic and identifier \\"node\\"/u)
  assert.match(owner, /HX7739G8FX/u)
  assert.match(owner, /sha256CodeDirectoryAlgorithm: UInt32 = 2/u)
  assert.match(owner, /signingFlags\.uint32Value & 0x0001_0000/u)
  assert.match(owner, /PROC_PIDREGIONPATHINFO/u)
  assert.match(unified, /knownServices:[\s\S]*"operation"/u)
  assert.match(unified, /aos:operation-request:v1\\n/u)
  assert.match(unified, /external_spawn_intent/u)
  assert.match(unified, /external_spawn_child_admit/u)
  assert.match(unified, /external_spawn_abandon/u)
  assert.match(unified, /external_spawn_finalize/u)
  assert.match(unified, /requireExternalSpawnDispatcher/u)
  assert.match(unified, /pendingExternalSpawnIntent\(\s*admittedChild:/u)
  assert.match(unified, /bindPrepreparedCapture/u)
  assert.match(unified, /registered_operation_plane_at_adapter_registry_revision|stopAllPayload/u)
  assert.match(unified, /AOSOperationStatusItemProjection/u)
  assert.match(unified, /AOSOperationCanvasProjection/u)
  assert.match(registry, /pendingExternalSpawnIntents/u)
  assert.match(registry, /closedExternalSpawnIntents/u)
  assert.match(registry, /expirePendingExternalSpawnIntents/u)
  assert.match(registry, /finalizePendingExternalSpawnIntent/u)
})

test('source-free tap and producer-backed recording custody expose exact typed boundaries', async () => {
  const [unified, control, state, command] = await Promise.all([
    readFile(path.join(repoRoot, 'src/daemon/unified.swift'), 'utf8'),
    readFile(path.join(repoRoot, 'src/daemon/operation-control.swift'), 'utf8'),
    readFile(path.join(repoRoot, 'src/daemon/operation-state.swift'), 'utf8'),
    readFile(path.join(repoRoot, 'src/commands/operation.swift'), 'utf8'),
  ])

  assert.match(unified, /case "tap":\s*throw AOSOperationCoreError\.tapUnavailable/u)
  assert.match(unified, /case "artifact_reveal", "artifact_remove", "artifact_release", "artifact_retain":/u)
  const decode = unified.indexOf('aosDecodeArtifactActionRequest(')
  const digest = unified.indexOf('validateOperationParameterDigest(action: action, data: data)')
  const custodyEffect = unified.indexOf('adapter.revealArtifact(')
  assert.ok(decode >= 0 && decode < digest && digest < custodyEffect)
  assert.match(unified, /revealArtifact|removeArtifact|releaseArtifact|retainArtifact/u)
  assert.doesNotMatch(unified, /openOperationTap|scheduleOperationTapExpiry|operationTapSnapshot/u)
  assert.doesNotMatch(control, /AOSOperationTapBuffer|AOSOperationTapAdmission/u)
  assert.match(state, /case \.tapUnavailable: return "OPERATION_TAP_UNAVAILABLE"/u)
  assert.match(state, /case \.artifactRetainUnavailable: return "OPERATION_ARTIFACT_RETAIN_UNAVAILABLE"/u)
  assert.match(state, /AOSArtifactReleaseCoordinator/u)
  assert.match(state, /source == \.absent, destination == \.exact/u)
  assert.match(unified, /resolution == \.rolledBack[\s\S]*removeRecoveredRolledBackArtifact/u)
  assert.match(command, /case "tap":\s*guard values\.isEmpty/u)
  assert.match(command, /case "artifact":\s*guard values\.count >= 2/u)
  assert.match(command, /"--generation", "--to"/u)
  assert.doesNotMatch(command, /OPERATION_FOLLOW_INCOMPLETE|--sample-every|--max-queue-items/u)
})

test('Darwin child admission binds trusted live Node code and mapped vnode', async () => {
  const child = spawn(process.execPath, ['--input-type=module', '-', 'listen'], {
    stdio: ['pipe', 'ignore', 'pipe'],
  })
  const wrongTeam = spawn('/bin/sleep', ['30'], { stdio: 'ignore' })
  await Promise.all([child, wrongTeam].map((process) => new Promise((resolve, reject) => {
    process.once('spawn', resolve)
    process.once('error', reject)
  })))
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-operation-node-admit-'))
  const main = path.join(root, 'main.swift')
  const executable = path.join(root, 'node-admit-proof')
  try {
    await writeFile(main, String.raw`
import Foundation

let provider = AOSDarwinProcessImageProvider()
let evidence = try provider.externalChildBootstrapEvidence(
    for: ${child.pid},
    routeSourceID: "listen"
)
let staticExecutable = try provider.resolvedExecutable(for: ${child.pid})
precondition(evidence.runningExecutable.resolvedPathDigest
    == staticExecutable.resolvedPathDigest)
precondition(evidence.runningExecutable.device == staticExecutable.device)
precondition(evidence.runningExecutable.inode == staticExecutable.inode)
precondition(evidence.runningExecutable.platformCodeDirectoryHash
    == staticExecutable.platformCodeDirectoryHash)
precondition(evidence.runningExecutable.platformCodeDirectoryHash.value.count == 40)
precondition(evidence.runningExecutable.signingIdentifier == "node")
precondition(evidence.runningExecutable.signingTeamIdentifier == "HX7739G8FX")
precondition(evidence.runningExecutable.device > 0)
precondition(evidence.runningExecutable.inode > 0)
precondition(evidence.canonicalArgvShapeDigest.value
    == "1027cc88beb2d456286c299ecf6b41a200145a1cb32ca05104900e0101e1630c")
do {
    _ = try provider.runningExecutableEvidence(for: ${wrongTeam.pid})
    preconditionFailure("wrong signing identity admitted")
} catch AOSOwnerRootError.runningExecutableUnverifiable {
}
`)
    execFileSync('swiftc', [
      '-warnings-as-errors',
      '-module-cache-path', path.join(root, 'module-cache'),
      path.join(repoRoot, 'src/daemon/operation-state.swift'),
      path.join(repoRoot, 'src/daemon/operation-owner-root.swift'),
      path.join(repoRoot, 'src/daemon/operation-spawn-record.swift'),
      main,
      '-o', executable,
    ], { cwd: repoRoot, stdio: 'pipe' })
    execFileSync(executable, [], { cwd: repoRoot, stdio: 'pipe' })
  } finally {
    child.stdin.end()
    child.kill('SIGTERM')
    wrongTeam.kill('SIGTERM')
    await rm(root, { recursive: true, force: true })
  }
})

test('external child script attestation rejects relative, noncanonical, symlinked, and outside paths', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-operation-script-attestation-'))
  const repo = path.join(root, 'agent-os')
  const sibling = path.join(root, 'caller-repo')
  const main = path.join(root, 'main.swift')
  const executable = path.join(root, 'script-attestation-proof')
  await mkdir(path.join(repo, 'scripts'), { recursive: true })
  await mkdir(path.join(sibling, 'scripts'), { recursive: true })
  await writeFile(path.join(repo, 'scripts', 'listen.mjs'), 'aos')
  await writeFile(path.join(sibling, 'scripts', 'listen.mjs'), 'caller')
  await symlink(path.join(repo, 'scripts', 'listen.mjs'), path.join(repo, 'scripts', 'listen-link.mjs'))
  try {
    await writeFile(main, String.raw`
import Foundation

func expect(_ expected: AOSOwnerRootError, _ body: () throws -> Void) {
    do {
        try body()
        preconditionFailure("expected rejection")
    } catch let actual as AOSOwnerRootError {
        precondition(actual == expected)
    } catch {
        preconditionFailure("unexpected error: \(error)")
    }
}

let repo = ${JSON.stringify(repo)}
let canonical = repo + "/scripts/listen.mjs"
let verified = try AOSDarwinProcessImageProvider.verifiedExternalScript(
    argument: canonical,
    repositoryRoot: repo
)
precondition(verified.relativeIdentity == "scripts/listen.mjs")

expect(.externalScriptPathNotAbsolute) {
    _ = try AOSDarwinProcessImageProvider.verifiedExternalScript(
        argument: "scripts/listen.mjs",
        repositoryRoot: repo
    )
}
expect(.externalScriptPathNotCanonical) {
    _ = try AOSDarwinProcessImageProvider.verifiedExternalScript(
        argument: repo + "/scripts/../scripts/listen.mjs",
        repositoryRoot: repo
    )
}
expect(.externalScriptPathNotCanonical) {
    _ = try AOSDarwinProcessImageProvider.verifiedExternalScript(
        argument: repo + "/scripts/listen-link.mjs",
        repositoryRoot: repo
    )
}
expect(.externalScriptOutsideRepository) {
    _ = try AOSDarwinProcessImageProvider.verifiedExternalScript(
        argument: ${JSON.stringify(path.join(sibling, 'scripts', 'listen.mjs'))},
        repositoryRoot: repo
    )
}
`)
    execFileSync('swiftc', [
      '-warnings-as-errors',
      '-module-cache-path', path.join(root, 'module-cache'),
      ...coreSources,
      main,
      '-o', executable,
    ], { cwd: sibling, stdio: 'pipe' })
    execFileSync(executable, [], { cwd: sibling, stdio: 'pipe' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('reviewed dependency closure is exact, content-free, and rejects helper drift or symlinks', async () => {
  const identities = [
    'scripts/lib/aos-daemon-client.mjs',
    'scripts/lib/aos-voice-follow.mjs',
  ]
  const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
  const members = await Promise.all(identities.map(async (identity) => ({
    digest: digest(await readFile(path.join(repoRoot, identity))),
    identity,
  })))
  const expected = digest(Buffer.from(JSON.stringify(members), 'utf8'))
  const manifest = JSON.parse(await readFile(
    path.join(repoRoot, 'manifests/commands/aos-external-commands.json'),
    'utf8',
  ))
  const registration = manifest.commands
    .map((command) => command.spawn_registration)
    .find((value) => value?.route_source_id === 'listen')
  assert.equal(registration.reviewed_dependency_set_digest, expected)

  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-operation-dependency-set-'))
  const changedRoot = path.join(root, 'changed')
  const symlinkRoot = path.join(root, 'symlink')
  const main = path.join(root, 'main.swift')
  const executable = path.join(root, 'dependency-set-proof')
  try {
    for (const target of [changedRoot, symlinkRoot]) {
      await mkdir(path.join(target, 'scripts/lib'), { recursive: true })
    }
    await writeFile(path.join(changedRoot, identities[0]), 'changed dependency')
    await writeFile(path.join(changedRoot, identities[1]), await readFile(path.join(repoRoot, identities[1])))
    await symlink(path.join(repoRoot, identities[0]), path.join(symlinkRoot, identities[0]))
    await writeFile(path.join(symlinkRoot, identities[1]), await readFile(path.join(repoRoot, identities[1])))
    await writeFile(main, String.raw`
import Foundation

let current = try AOSDarwinProcessImageProvider.reviewedExternalDependencySetDigest(
    repositoryRoot: ${JSON.stringify(repoRoot)}
)
precondition(current.value == ${JSON.stringify(expected)})
let changed = try AOSDarwinProcessImageProvider.reviewedExternalDependencySetDigest(
    repositoryRoot: ${JSON.stringify(changedRoot)}
)
precondition(changed != current)
do {
    _ = try AOSDarwinProcessImageProvider.reviewedExternalDependencySetDigest(
        repositoryRoot: ${JSON.stringify(symlinkRoot)}
    )
    preconditionFailure("symlinked dependency admitted")
} catch AOSOwnerRootError.externalScriptPathNotCanonical {
}
`)
    execFileSync('swiftc', [
      '-warnings-as-errors',
      '-module-cache-path', path.join(root, 'module-cache'),
      ...coreSources,
      main,
      '-o', executable,
    ], { cwd: changedRoot, stdio: 'pipe' })
    execFileSync(executable, [], { cwd: changedRoot, stdio: 'pipe' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
