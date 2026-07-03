import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const spatialPath = new URL('../../src/perceive/spatial.swift', import.meta.url)

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

test('spatial channel refresh drops stale AX traversal results', () => {
  const source = fs.readFileSync(spatialPath, 'utf8')
  const pollBody = swiftFunctionBody(source, 'private func poll()')
  const updateBody = swiftFunctionBody(source, 'func updateChannel(id: String, subtree: ChannelSubtree?, depth: Int?)')
  const deepenBody = swiftFunctionBody(source, 'func deepenChannel(id: String, subtree: ChannelSubtree?, depth: Int?)')
  const collapseBody = swiftFunctionBody(source, 'func collapseChannel(id: String, depth: Int?)')
  const refreshBody = swiftFunctionBody(source, 'func refreshChannel(id: String)')

  assert.match(source, /struct ChannelState[\s\S]*var revision: UInt64 = 0/)
  assert.match(pollBody, /current\.revision \+= 1/)
  assert.match(updateBody, /state\.revision \+= 1/)
  assert.match(deepenBody, /state\.revision \+= 1/)
  assert.match(collapseBody, /state\.revision \+= 1/)

  const snapshotIndex = refreshBody.indexOf('let refreshRevision = state.revision')
  const traversalIndex = refreshBody.indexOf('let elements = traverseForChannel(')
  const staleGuardIndex = refreshBody.indexOf('current.revision == refreshRevision')
  const publishIndex = refreshBody.indexOf('channels[id] = current')
  const fileIndex = refreshBody.indexOf('let file = ChannelData(')

  assert.ok(snapshotIndex !== -1, 'refresh should capture the channel revision before AX traversal')
  assert.ok(traversalIndex > snapshotIndex, 'refresh should traverse after taking the revision snapshot')
  assert.ok(staleGuardIndex > traversalIndex, 'refresh should re-check revision after AX traversal')
  assert.ok(publishIndex > staleGuardIndex, 'refresh should publish memory state only after stale guard')
  assert.ok(fileIndex > publishIndex, 'refresh should write the channel file only after guarded memory publish')
  assert.doesNotMatch(refreshBody, /channels\[id\] = state/)
})
