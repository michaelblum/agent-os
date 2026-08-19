import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..')
const ownerSource = path.join(repoRoot, 'src/daemon/operation-owner-root.swift')
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
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-operation-owner-root-'))
  const main = path.join(root, 'main.swift')
  const executable = path.join(root, 'owner-root-proof')
  try {
    await writeFile(main, source)
    execFileSync('swiftc', [
      '-warnings-as-errors',
      '-module-cache-path', path.join(root, 'module-cache'),
      '-lsqlite3',
      ...await productionSources(),
      main,
      '-o', executable,
    ], { cwd: repoRoot, stdio: 'pipe' })
    execFileSync(executable, [], { cwd: repoRoot, stdio: 'pipe' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('owner-root primitive binds peer, stable ancestry, closed skips, and action-time identity', async () => {
  await compileAndRunHarness(String.raw`
import Foundation

func digest(_ scalar: Character) -> AOSSHA256Digest {
    try! AOSSHA256Digest(String(repeating: String(scalar), count: 64))
}

func token(pid: pid_t, version: UInt32, uid: uid_t = 501) -> AOSAuditTokenIdentity {
    var words = Array(repeating: UInt32(0), count: 8)
    words[1] = uid
    words[5] = UInt32(bitPattern: pid)
    words[7] = version
    return try! AOSAuditTokenIdentity(words: words)
}

func observation(
    pid: pid_t,
    parent: pid_t,
    start: UInt64,
    identity: Character,
    executable: Character,
    uid: uid_t = 501
) -> AOSProcessObservation {
    AOSProcessObservation(
        generation: AOSProcessGenerationIdentity(
            pid: pid,
            effectiveUID: uid,
            parentPID: parent,
            startTimeSeconds: start,
            startTimeMicroseconds: 17
        ),
        image: AOSProcessImageEvidence(
            executableIdentityDigest: digest(identity),
            executableDigest: digest(executable)
        )
    )
}

final class FakeObserver: AOSOwnerRootObserving {
    var peer: AOSSocketPeerIdentity
    var observations: [pid_t: [AOSProcessObservation]]
    private var indexes: [pid_t: Int] = [:]

    init(peer: AOSSocketPeerIdentity, observations: [pid_t: [AOSProcessObservation]]) {
        self.peer = peer
        self.observations = observations
    }

    func immediatePeer(socketFD: Int32) throws -> AOSSocketPeerIdentity {
        precondition(socketFD == 9)
        return peer
    }

    func processObservation(pid: pid_t) throws -> AOSProcessObservation {
        guard let values = observations[pid], !values.isEmpty else {
            throw AOSOwnerRootError.processUnavailable(pid)
        }
        let index = indexes[pid, default: 0]
        indexes[pid] = index + 1
        return values[min(index, values.count - 1)]
    }

    func replace(_ observations: [pid_t: [AOSProcessObservation]]) {
        self.observations = observations
        indexes.removeAll()
    }
}

final class FakeClassifier: AOSOwnerRootClassifying {
    var values: [pid_t: AOSOwnerRootNodeClassification]

    init(_ values: [pid_t: AOSOwnerRootNodeClassification]) {
        self.values = values
    }

    func classification(
        for observation: AOSProcessObservation
    ) throws -> AOSOwnerRootNodeClassification {
        values[observation.generation.pid] ?? .unverifiedAOSAdapter
    }
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

let rootProcess = observation(pid: 1, parent: 1, start: 1, identity: "1", executable: "2", uid: 0)

do {
    let peerToken = token(pid: 100, version: 7)
    let peer = AOSSocketPeerIdentity(auditToken: peerToken)
    let child = observation(pid: 100, parent: 1, start: 10, identity: "a", executable: "b")
    let observer = FakeObserver(peer: peer, observations: [100: [child], 1: [rootProcess]])
    let resolver = AOSOwnerRootResolver(
        observer: observer,
        classifier: FakeClassifier([100: .nonAOS])
    )
    let binding = try resolver.resolve(socketFD: 9)
    precondition(binding.outcome == .directNonAOSPeer)
    precondition(binding.ownerRoot == child)
    precondition(binding.skippedNodes.isEmpty)
    let revalidated = try resolver.revalidate(binding, socketFD: 9, for: .signal)
    precondition(revalidated == binding)

    let replaced = observation(pid: 100, parent: 1, start: 11, identity: "a", executable: "b")
    observer.replace([100: [replaced], 1: [rootProcess]])
    expectError(AOSOwnerRootError.actionIdentityStale) {
        _ = try resolver.revalidate(binding, socketFD: 9, for: .cleanup)
    }
}

do {
    let peerToken = token(pid: 200, version: 12)
    let peer = AOSSocketPeerIdentity(auditToken: peerToken)
    let immediate = observation(pid: 200, parent: 201, start: 20, identity: "a", executable: "b")
    let helper = observation(pid: 201, parent: 202, start: 21, identity: "c", executable: "d")
    let owner = observation(pid: 202, parent: 1, start: 22, identity: "e", executable: "f")
    let firstReceipt = AOSParentEdgeReceipt.make(child: immediate.generation, parent: helper.generation)
    let secondReceipt = AOSParentEdgeReceipt.make(child: helper.generation, parent: owner.generation)
    let imageProof = AOSExactImageSkipProof(
        child: immediate.generation,
        parent: helper.generation,
        parentEdgeReceipt: firstReceipt,
        adapterRegistrationID: "native-dispatch",
        adapterRegistrationRevision: 3,
        image: immediate.image,
        immediatePeerAuditToken: peerToken
    )
    let spawnProof = AOSGenerationBoundSpawnRecord(
        spawnRecordID: "spawn-1",
        evidenceScope: .verifiedAncestor,
        child: helper.generation,
        parent: owner.generation,
        parentEdgeReceipt: secondReceipt,
        operationID: "operation-1",
        operationGeneration: 4,
        adapterID: "microphone-capture-adapter",
        adapterRegistrationRevision: 9,
        executableIdentityDigest: helper.image.executableIdentityDigest,
        executableDigest: helper.image.executableDigest,
        reviewedDependencySetDigest: digest("9"),
        childAuditToken: nil
    )
    let observer = FakeObserver(peer: peer, observations: [
        200: [immediate], 201: [helper], 202: [owner], 1: [rootProcess],
    ])
    let classifier = FakeClassifier([
        200: .exactAOSImage(imageProof),
        201: .generationBoundSpawnRecord(spawnProof),
        202: .nonAOS,
    ])
    let resolver = AOSOwnerRootResolver(observer: observer, classifier: classifier)
    let binding = try resolver.resolve(socketFD: 9)
    precondition(binding.outcome == .verifiedNonAOSAncestor)
    precondition(binding.ownerRoot == owner)
    precondition(binding.skippedNodes.map(\.kind) == [
        .exactAOSImage, .generationBoundDaemonSpawnRecord,
    ])

    let invalidAncestorToken = AOSGenerationBoundSpawnRecord(
        spawnRecordID: spawnProof.spawnRecordID,
        evidenceScope: .verifiedAncestor,
        child: spawnProof.child,
        parent: spawnProof.parent,
        parentEdgeReceipt: spawnProof.parentEdgeReceipt,
        operationID: spawnProof.operationID,
        operationGeneration: spawnProof.operationGeneration,
        adapterID: spawnProof.adapterID,
        adapterRegistrationRevision: spawnProof.adapterRegistrationRevision,
        executableIdentityDigest: spawnProof.executableIdentityDigest,
        executableDigest: spawnProof.executableDigest,
        reviewedDependencySetDigest: spawnProof.reviewedDependencySetDigest,
        childAuditToken: peerToken
    )
    classifier.values[201] = .generationBoundSpawnRecord(invalidAncestorToken)
    observer.replace([200: [immediate], 201: [helper], 202: [owner], 1: [rootProcess]])
    expectError(AOSOwnerRootError.invalidSkipProof) {
        _ = try resolver.resolve(socketFD: 9)
    }
}

do {
    let peerToken = token(pid: 300, version: 1)
    let peer = AOSSocketPeerIdentity(auditToken: peerToken)
    let child = observation(pid: 300, parent: 1, start: 30, identity: "a", executable: "b")
    let observer = FakeObserver(peer: peer, observations: [300: [child], 1: [rootProcess]])
    let classifier = FakeClassifier([300: .unverifiedAOSAdapter])
    let conservative = AOSOwnerRootResolver(
        observer: observer,
        classifier: classifier,
        unverifiedAdapterDisposition: .conservativeImmediatePeerBoundary
    )
    let conservativeBinding = try conservative.resolve(socketFD: 9)
    precondition(conservativeBinding.outcome == .conservativeImmediatePeerBoundary)
    let rejecting = AOSOwnerRootResolver(observer: observer, classifier: classifier)
    expectError(AOSOwnerRootError.unverifiedAdapter(300)) {
        _ = try rejecting.resolve(socketFD: 9)
    }
}

do {
    let peerToken = token(pid: 400, version: 1)
    let peer = AOSSocketPeerIdentity(auditToken: peerToken)
    let first = observation(pid: 400, parent: 1, start: 40, identity: "a", executable: "b")
    let reused = observation(pid: 400, parent: 1, start: 41, identity: "a", executable: "b")
    let observer = FakeObserver(peer: peer, observations: [400: [first, reused], 1: [rootProcess]])
    let resolver = AOSOwnerRootResolver(
        observer: observer,
        classifier: FakeClassifier([400: .nonAOS])
    )
    expectError(AOSOwnerRootError.staleAncestry(400)) {
        _ = try resolver.resolve(socketFD: 9)
    }
}

do {
    let peerToken = token(pid: 500, version: 1)
    let peer = AOSSocketPeerIdentity(auditToken: peerToken)
    let child = observation(pid: 500, parent: 1, start: 50, identity: "a", executable: "b")
    let wrongImage = AOSProcessImageEvidence(
        executableIdentityDigest: digest("c"),
        executableDigest: child.image.executableDigest
    )
    let proof = AOSExactImageSkipProof(
        child: child.generation,
        parent: rootProcess.generation,
        parentEdgeReceipt: .make(child: child.generation, parent: rootProcess.generation),
        adapterRegistrationID: "adapter",
        adapterRegistrationRevision: 1,
        image: wrongImage,
        immediatePeerAuditToken: peerToken
    )
    let observer = FakeObserver(peer: peer, observations: [500: [child], 1: [rootProcess]])
    let resolver = AOSOwnerRootResolver(
        observer: observer,
        classifier: FakeClassifier([500: .exactAOSImage(proof)])
    )
    expectError(AOSOwnerRootError.invalidSkipProof) {
        _ = try resolver.resolve(socketFD: 9)
    }
}
`)
})

test('owner-root production seam uses Darwin peer token and proc generation sources', async () => {
  const source = await readFile(ownerSource, 'utf8')
  assert.match(source, /getsockopt\([\s\S]*LOCAL_PEERTOKEN/u)
  assert.match(source, /proc_pidinfo\([\s\S]*PROC_PIDTBSDINFO/u)
  assert.match(source, /child1 == child2[\s\S]*parent1 == parent2/u)
  assert.match(source, /immediatePeerAuditToken == peer\.auditToken/u)
  assert.match(source, /func revalidate\(/u)
  assert.doesNotMatch(source, /AOS_EXTERNAL_DISPATCH_PARENT_PID/u)
})
