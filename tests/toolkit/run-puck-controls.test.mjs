import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  commandLabel,
  menuCommandsForState,
  primaryCommandForState,
  viewForRunState,
} from '../../packages/toolkit/run-puck/controls.js'

test('run puck maps visible states to primary commands', () => {
  assert.equal(primaryCommandForState('running'), 'pause')
  assert.equal(primaryCommandForState('paused'), 'resume')
  assert.equal(primaryCommandForState('stepping'), 'step')
  assert.equal(primaryCommandForState('takeover'), 'release')
  assert.equal(primaryCommandForState('blocked'), 'open_timeline')
  assert.equal(primaryCommandForState('completed'), 'open_evidence')
})

test('run puck view model keeps compact labels and tones', () => {
  assert.deepEqual(viewForRunState('running'), {
    label: 'Running',
    primary: 'pause',
    tone: 'working',
  })
  assert.equal(viewForRunState('unknown').label, 'Idle')
})

test('run puck menus are state-aware', () => {
  assert.deepEqual(menuCommandsForState('takeover'), ['release', 'abort', 'open_timeline', 'open_evidence'])
  assert.deepEqual(menuCommandsForState('completed'), ['open_timeline', 'open_evidence'])
  assert.ok(menuCommandsForState('running').includes('take_over'))
  assert.equal(commandLabel('open_evidence'), 'Open evidence')
})
