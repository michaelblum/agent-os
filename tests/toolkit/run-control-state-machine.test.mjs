import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyRunCommand,
  consumeStepBudget,
  createRunState,
  finishStep,
} from '../../packages/toolkit/run-control/state-machine.js'

test('run-control state machine handles pause, resume, step, and bounded finish', () => {
  let state = createRunState({ state: 'running' })

  state = applyRunCommand(state, 'pause')
  assert.equal(state.state, 'paused')

  state = applyRunCommand(state, 'step')
  assert.equal(state.state, 'stepping')
  assert.equal(state.budget, 1)

  state = consumeStepBudget(state)
  assert.equal(state.budget, 0)
  assert.throws(() => consumeStepBudget(state), /step budget exhausted/)

  state = finishStep(state, 'next_proposal')
  assert.equal(state.state, 'paused')
  assert.equal(state.step_finished_reason, 'next_proposal')

  state = applyRunCommand(state, 'resume')
  assert.equal(state.state, 'running')
})

test('takeover denies release target drift and returns to paused by default', () => {
  let state = createRunState({ state: 'running' })
  state = applyRunCommand(state, 'take_over')
  assert.equal(state.state, 'takeover')

  state = applyRunCommand(state, 'release')
  assert.equal(state.state, 'paused')
})

test('blocked state records gate context and can resume', () => {
  let state = createRunState({ state: 'running' })
  state = applyRunCommand(state, 'block', {
    reason: 'Login secret',
    gate_kind: 'before_login_secret',
  })

  assert.equal(state.state, 'blocked')
  assert.equal(state.blocked_reason, 'Login secret')
  assert.equal(state.gate_kind, 'before_login_secret')

  state = applyRunCommand(state, 'resume')
  assert.equal(state.state, 'running')
  assert.equal(state.blocked_reason, null)
})

test('illegal transitions throw with concrete state and command', () => {
  const state = createRunState({ state: 'paused' })
  assert.throws(() => applyRunCommand(state, 'release'), /paused -> release/)
})

test('terminal states reject further control commands', () => {
  const completed = createRunState({ state: 'completed' })
  assert.throws(() => applyRunCommand(completed, 'resume'), /completed -> resume/)
})
