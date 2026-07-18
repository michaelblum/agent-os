import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const fixtureURL = new URL('../fixtures/scene/historical-fast-travel/reference.json', import.meta.url)

test('historical fast-travel reference remains pinned to immutable source bytes', async () => {
  const fixture = JSON.parse(await readFile(fixtureURL, 'utf8'))
  assert.equal(fixture.contract, 'aos.scene.historical-fast-travel-reference.v1')
  for (const source of fixture.sources) {
    const bytes = execFileSync('git', ['show', `${fixture.referenceCommit}:${source.path}`])
    assert.equal(createHash('sha256').update(bytes).digest('hex'), source.sha256)
  }
})

test('historical routes cover both axes, multiple displays, release, and Escape', async () => {
  const fixture = JSON.parse(await readFile(fixtureURL, 'utf8'))
  assert.deepEqual(fixture.scenarios.map(({ id }) => id), [
    'horizontal', 'vertical', 'diagonal', 'cross-display', 'release', 'escape-cancel',
  ])
  const crossDisplay = fixture.scenarios.find(({ id }) => id === 'cross-display')
  assert.ok(crossDisplay.origin[0] < fixture.topology.displays[1].bounds[0])
  assert.ok(crossDisplay.destination[0] >= fixture.topology.displays[1].bounds[0])
  assert.equal(fixture.scenarios.find(({ id }) => id === 'release').commitsDestination, true)
  assert.equal(fixture.scenarios.find(({ id }) => id === 'escape-cancel').commitsDestination, false)
  assert.equal(fixture.scenarios.find(({ id }) => id === 'escape-cancel').cancellationReason, 'escape')
})

test('fixed line trace matches the historical ease-out-quart clock', async () => {
  const fixture = JSON.parse(await readFile(fixtureURL, 'utf8'))
  for (const sample of fixture.fixedProgress) {
    assert.equal(sample.eased, 1 - (1 - sample.linear) ** 4)
    assert.equal(sample.atMs, sample.linear * fixture.line.durationMs)
  }
  assert.equal(fixture.visualComparison.status, 'pending_michael_signoff')
  assert.match(fixture.visualComparison.claim, /not evidence of completed visual parity/iu)
})
