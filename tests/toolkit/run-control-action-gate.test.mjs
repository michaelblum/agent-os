import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  checkActionGate,
  consumeActionBudget,
} from '../../packages/toolkit/run-control/action-gate.js'

test('action gate allows running actions and denies paused/takeover states', () => {
  assert.deepEqual(
    checkActionGate({ state: 'running', budget: 0 }, { op: 'click' }),
    { decision: 'allowed' },
  )

  assert.deepEqual(
    checkActionGate({ state: 'paused', budget: 0 }, { op: 'click' }),
    { decision: 'blocked', reason: 'run is paused' },
  )

  assert.deepEqual(
    checkActionGate({ state: 'takeover', budget: 0 }, { op: 'click' }),
    { decision: 'blocked', reason: 'run is takeover' },
  )
})

test('step budget is exactly one', () => {
  const stepping = { state: 'stepping', budget: 1 }
  assert.deepEqual(checkActionGate(stepping, { op: 'click' }), { decision: 'allowed' })

  const consumed = consumeActionBudget(stepping)
  assert.equal(consumed.state, 'stepping')
  assert.equal(consumed.budget, 0)

  assert.deepEqual(
    checkActionGate(consumed, { op: 'click' }),
    { decision: 'blocked', reason: 'step budget exhausted' },
  )
})

test('safety gate decisions require human acknowledgement before execution', () => {
  const gate = checkActionGate(
    { state: 'running', budget: 0 },
    { op: 'fill', input: { type: 'password', name: 'password' } },
  )

  assert.equal(gate.decision, 'requires_gate')
  assert.equal(gate.gate_kind, 'before_login_secret')
  assert.match(gate.reason, /Login-secret/)
})
