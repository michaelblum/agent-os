import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const spatialPath = new URL('../../src/perceive/spatial.swift', import.meta.url)
const publicationPath = new URL('../../src/perceive/channel-publication.swift', import.meta.url)

function swiftFunctionBody(source, signature) {
  const signatureIndex = source.indexOf(signature)
  assert.notEqual(signatureIndex, -1, `${signature} should exist`)
  const openBraceIndex = source.indexOf('{', signatureIndex)
  assert.notEqual(openBraceIndex, -1, `${signature} should have a body`)

  let depth = 0
  for (let index = openBraceIndex; index < source.length; index += 1) {
    if (source[index] === '{') {
      depth += 1
    } else if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(openBraceIndex + 1, index)
    }
  }
  assert.fail(`${signature} body should close`)
}

test('channel publication serialization and observation stability are executable contracts', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'aos-channel-publication-'))
  try {
    const main = path.join(temp, 'main.swift')
    const executable = path.join(temp, 'proof')
    await writeFile(main, String.raw`
import CoreGraphics
import Dispatch
import Foundation

func require(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        fputs(message + "\n", stderr)
        exit(1)
    }
}

require(!aosChannelTraversalDepthIsValid(-1), "negative channel depth was admitted")
require(aosChannelTraversalDepthIsValid(0), "zero channel depth was rejected")
require(aosChannelTraversalDepthIsValid(15), "maximum channel depth was rejected")
require(!aosChannelTraversalDepthIsValid(16), "unbounded channel depth was admitted")

let before = AOSChannelWindowObservation(
    pid: 42,
    bounds: CGRect(x: 10.2, y: 20.1, width: 100.6, height: 80.7),
    display: 1,
    scaleFactor: 2
)
let sameIntegral = AOSChannelWindowObservation(
    pid: 42,
    bounds: before.bounds,
    display: 1,
    scaleFactor: 2
)
require(
    aosChannelWindowObservationIsStable(
        before: before,
        after: sameIntegral,
        expectedPID: 42
    ),
    "stable canonical observation was rejected"
)
for drifted in [
    AOSChannelWindowObservation(pid: 43, bounds: before.bounds, display: 1, scaleFactor: 2),
    AOSChannelWindowObservation(pid: 42, bounds: before.bounds.offsetBy(dx: 1, dy: 0), display: 1, scaleFactor: 2),
    AOSChannelWindowObservation(pid: 42, bounds: before.bounds, display: 2, scaleFactor: 2),
    AOSChannelWindowObservation(pid: 42, bounds: before.bounds, display: 1, scaleFactor: 1),
] {
    require(
        !aosChannelWindowObservationIsStable(
            before: before,
            after: drifted,
            expectedPID: 42
        ),
        "A-to-B window observation drift was admitted"
    )
}

let firstInstance = UUID()
let replacementInstance = UUID()
require(
    aosChannelPublicationIdentityIsCurrent(
        currentInstanceID: firstInstance,
        currentRevision: 7,
        expectedInstanceID: firstInstance,
        expectedRevision: 7
    ),
    "current channel publication identity was rejected"
)
require(
    !aosChannelPublicationIdentityIsCurrent(
        currentInstanceID: replacementInstance,
        currentRevision: 7,
        expectedInstanceID: firstInstance,
        expectedRevision: 7
    ),
    "replacement channel instance admitted a stale publication"
)
require(
    !aosChannelPublicationIdentityIsCurrent(
        currentInstanceID: firstInstance,
        currentRevision: 8,
        expectedInstanceID: firstInstance,
        expectedRevision: 7
    ),
    "newer channel revision admitted a stale publication"
)

let serializer = AOSChannelPublicationSerializer()
let firstEntered = DispatchSemaphore(value: 0)
let releaseFirst = DispatchSemaphore(value: 0)
let secondEntered = DispatchSemaphore(value: 0)
let finished = DispatchGroup()
finished.enter()
DispatchQueue.global().async {
    serializer.sync {
        firstEntered.signal()
        releaseFirst.wait()
    }
    finished.leave()
}
require(firstEntered.wait(timeout: .now() + .seconds(2)) == .success, "first publication did not enter")
finished.enter()
DispatchQueue.global().async {
    serializer.sync { secondEntered.signal() }
    finished.leave()
}
require(
    secondEntered.wait(timeout: .now() + .milliseconds(100)) == .timedOut,
    "concurrent publication entered before the first transaction settled"
)
releaseFirst.signal()
require(secondEntered.wait(timeout: .now() + .seconds(2)) == .success, "second publication did not resume")
require(finished.wait(timeout: .now() + .seconds(2)) == .success, "publication workers did not settle")
serializer.sync { serializer.sync {} }
`)
    const compile = spawnSync(
      'xcrun',
      ['swiftc', publicationPath.pathname, main, '-o', executable],
      { encoding: 'utf8' },
    )
    assert.equal(compile.status, 0, compile.stderr || compile.stdout)
    const run = spawnSync(executable, [], { encoding: 'utf8', timeout: 10_000 })
    assert.equal(run.status, 0, run.stderr || run.stdout)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('spatial channel refresh prepares outside serialization and commits one stable publication', () => {
  const source = fs.readFileSync(spatialPath, 'utf8')
  const pollBody = swiftFunctionBody(source, 'private func poll()')
  const updateBody = swiftFunctionBody(source, 'func updateChannel(id: String, subtree: ChannelSubtree?, depth: Int?)')
  const deepenBody = swiftFunctionBody(source, 'func deepenChannel(id: String, subtree: ChannelSubtree?, depth: Int?)')
  const collapseBody = swiftFunctionBody(source, 'func collapseChannel(id: String, depth: Int?)')
  const refreshBody = swiftFunctionBody(source, 'func refreshChannel(')
  const prepareBody = swiftFunctionBody(source, 'private func prepareChannelRefresh(')
  const publishBody = swiftFunctionBody(source, 'private func publishChannelCandidate(')
  const commitBody = swiftFunctionBody(source, 'private func commitChannelPublication(')
  const createBody = swiftFunctionBody(source, 'func createChannel(id: String, windowID: Int, pid: Int?, subtree: ChannelSubtree?, depth: Int?)')
  const removeBody = swiftFunctionBody(source, 'func removeChannel(id: String)')

  assert.match(source, /struct ChannelState[\s\S]*let instanceID: UUID[\s\S]*var revision: UInt64 = 0/)
  assert.match(
    pollBody,
    /refreshChannel\([\s\S]*id: id,[\s\S]*expectedInstanceID: state\.instanceID[\s\S]*onWindowMoved/,
  )
  assert.equal(
    (pollBody.match(/expectedInstanceID: state\.instanceID/g) ?? []).length,
    2,
    'movement and periodic refresh should bind the snapshotted channel instance',
  )
  for (const body of [pollBody, createBody, updateBody, deepenBody, collapseBody, refreshBody, prepareBody, publishBody]) {
    assert.doesNotMatch(body, /channelPublications\.sync/)
  }
  assert.match(commitBody, /channelPublications\.sync/)
  assert.match(removeBody, /channelPublications\.sync/)
  for (const body of [updateBody, deepenBody, collapseBody, refreshBody]) {
    assert.match(body, /state\.revision \+= 1/)
    assert.match(body, /publishChannelCandidate\(/)
    assert.doesNotMatch(body, /channels\[id\] = state/)
    assert.doesNotMatch(body, /channels\[id\] = previous/)
  }
  for (const body of [updateBody, deepenBody, collapseBody]) {
    assert.match(body, /case \.evidenceUnavailable:/)
    assert.match(body, /case \.conflict:/)
    assert.match(body, /case \.writeFailed:/)
    assert.match(body, /code: "INTERNAL"/)
  }
  assert.match(createBody, /pid == nil \|\| pid == winInfo\.pid/)
  assert.match(createBody, /code: "NATIVE_AX_ROOT_MISMATCH"/)
  assert.match(createBody, /aosChannelTraversalDepthIsValid\(resolvedDepth\)/)
  assert.match(createBody, /code: "DUPLICATE_ID"/)

  const createPreparationIndex = createBody.indexOf('preparedChannelPublication(state)')
  const createCommitIndex = createBody.indexOf('commitChannelPublication(publication, expectation: .absent)')
  assert.ok(createPreparationIndex !== -1, 'create should prepare exact channel evidence')
  assert.ok(createCommitIndex > createPreparationIndex, 'create should commit only prepared evidence')

  const ownerIndex = prepareBody.indexOf('winInfo.pid == state.pid')
  const prepareTraversalIndex = prepareBody.indexOf('traverseForChannel(')
  assert.ok(ownerIndex !== -1, 'preparation should verify the live window owner')
  assert.ok(prepareTraversalIndex > ownerIndex, 'AX traversal should follow owner verification')
  assert.match(prepareBody, /!elements\.isEmpty/)
  assert.match(prepareBody, /let settledWinInfo = windowInfoForID\(state\.windowID\)/)
  assert.match(prepareBody, /aosChannelWindowObservationIsStable\(/)

  const snapshotIndex = refreshBody.indexOf('let expectedRevision = state.revision')
  const revisionIndex = refreshBody.indexOf('state.revision += 1')
  const candidateIndex = refreshBody.indexOf('publishChannelCandidate(')
  assert.ok(snapshotIndex !== -1, 'refresh should snapshot the current monotonic revision')
  assert.match(refreshBody, /state\.instanceID == expectedInstanceID/)
  assert.ok(revisionIndex > snapshotIndex, 'refresh should reserve a distinct candidate revision')
  assert.ok(candidateIndex > revisionIndex, 'refresh should publish only its revised candidate')

  const publishPreparationIndex = publishBody.indexOf('preparedChannelPublication(candidate)')
  const publishCommitIndex = publishBody.indexOf('commitChannelPublication(')
  assert.ok(publishPreparationIndex !== -1, 'candidate publication should prepare exact evidence')
  assert.ok(publishCommitIndex > publishPreparationIndex, 'candidate commit should follow preparation')

  const guardIndex = commitBody.indexOf('guard admitted')
  const fileIndex = commitBody.indexOf('writeChannelFile(publication.file)')
  const memoryIndex = commitBody.indexOf('channels[publication.state.id] = publication.state')
  const callbackIndex = commitBody.indexOf('onChannelUpdated?(publication.state.id)')
  const afterCommitIndex = commitBody.indexOf('afterCommit?(publication.state)')
  assert.match(commitBody, /case \.revision\(let expectedInstanceID, let expectedRevision\):/)
  assert.match(commitBody, /aosChannelPublicationIdentityIsCurrent\(/)
  assert.ok(guardIndex !== -1, 'publication should compare the monotonic revision')
  assert.ok(fileIndex > guardIndex, 'atomic file replacement should follow the revision guard')
  assert.ok(memoryIndex > fileIndex, 'memory publication should follow successful file replacement')
  assert.ok(callbackIndex > memoryIndex, 'callback should follow the complete file/memory commit')
  assert.ok(afterCommitIndex > callbackIndex, 'movement callback should follow channel update publication')
  assert.match(commitBody, /return \.writeFailed/)
  assert.match(source, /data\.write\(to:[\s\S]*options: \.atomic\)/)
  assert.match(source, /guard matched == nil else \{ return nil \}/)
  assert.match(source, /return matched/)
})
