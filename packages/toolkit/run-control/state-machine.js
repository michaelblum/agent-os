export const RUN_STATES = Object.freeze([
  'idle',
  'planning',
  'running',
  'paused',
  'stepping',
  'takeover',
  'blocked',
  'aborting',
  'completed',
  'failed',
])

export const RUN_COMMANDS = Object.freeze([
  'pause',
  'resume',
  'step',
  'skip',
  'replan',
  'take_over',
  'release',
  'abort',
  'open_timeline',
  'open_evidence',
  'complete',
  'fail',
  'block',
])

const PASS_THROUGH_COMMANDS = new Set(['open_timeline', 'open_evidence'])
const TERMINAL_STATES = new Set(['completed', 'failed'])

function assertState(state) {
  if (!RUN_STATES.includes(state)) throw new Error(`unknown run state: ${state}`)
}

function assertCommand(command) {
  if (!RUN_COMMANDS.includes(command)) throw new Error(`unknown run command: ${command}`)
}

export function createRunState(options = {}) {
  const state = options.state ?? 'idle'
  assertState(state)
  return {
    state,
    previous_state: options.previous_state ?? null,
    budget: Number.isInteger(options.budget) ? options.budget : 0,
    blocked_reason: options.blocked_reason ?? null,
    gate_kind: options.gate_kind ?? null,
    step_tail_ms: Number.isFinite(options.step_tail_ms) ? options.step_tail_ms : 8000,
  }
}

function withState(snapshot, state, patch = {}) {
  assertState(state)
  return {
    ...snapshot,
    previous_state: snapshot.state,
    state,
    budget: state === 'stepping' ? (patch.budget ?? snapshot.budget) : (patch.budget ?? 0),
    blocked_reason: patch.blocked_reason ?? (state === 'blocked' ? snapshot.blocked_reason : null),
    gate_kind: patch.gate_kind ?? (state === 'blocked' ? snapshot.gate_kind : null),
    ...patch,
  }
}

function illegal(snapshot, command) {
  throw new Error(`illegal run-control transition: ${snapshot.state} -> ${command}`)
}

export function applyRunCommand(snapshot, command, options = {}) {
  const current = createRunState(snapshot)
  assertCommand(command)

  if (PASS_THROUGH_COMMANDS.has(command)) return { ...current, last_command: command }
  if (TERMINAL_STATES.has(current.state)) return illegal(current, command)

  if (command === 'abort') return withState(current, 'aborting')
  if (command === 'complete') return withState(current, 'completed')
  if (command === 'fail') return withState(current, 'failed', { blocked_reason: options.reason ?? null })
  if (command === 'block') {
    return withState(current, 'blocked', {
      blocked_reason: options.reason ?? 'blocked',
      gate_kind: options.gate_kind ?? null,
    })
  }

  switch (current.state) {
    case 'idle':
      if (command === 'resume') return withState(current, 'running')
      if (command === 'replan') return withState(current, 'planning')
      break
    case 'planning':
      if (command === 'resume') return withState(current, 'running')
      if (command === 'pause') return withState(current, 'paused')
      if (command === 'replan') return withState(current, 'planning')
      break
    case 'running':
      if (command === 'pause') return withState(current, 'paused')
      if (command === 'step') return withState(current, 'stepping', { budget: options.budget ?? 1 })
      if (command === 'take_over') return withState(current, 'takeover')
      if (command === 'replan') return withState(current, 'planning')
      if (command === 'skip') return withState(current, 'running', { last_skipped_action_id: options.action_id ?? null })
      break
    case 'paused':
      if (command === 'resume') return withState(current, 'running')
      if (command === 'step') return withState(current, 'stepping', { budget: options.budget ?? 1 })
      if (command === 'take_over') return withState(current, 'takeover')
      if (command === 'replan') return withState(current, 'planning')
      if (command === 'skip') return withState(current, 'paused', { last_skipped_action_id: options.action_id ?? null })
      break
    case 'stepping':
      if (command === 'pause') return withState(current, 'paused')
      if (command === 'take_over') return withState(current, 'takeover')
      if (command === 'replan') return withState(current, 'planning')
      if (command === 'skip') return withState(current, 'paused', { last_skipped_action_id: options.action_id ?? null })
      break
    case 'takeover':
      if (command === 'release') return withState(current, options.release_to ?? 'paused')
      break
    case 'blocked':
      if (command === 'resume') return withState(current, options.resume_to ?? 'running')
      if (command === 'skip') return withState(current, 'paused', { last_skipped_action_id: options.action_id ?? null })
      if (command === 'replan') return withState(current, 'planning')
      if (command === 'take_over') return withState(current, 'takeover')
      break
    case 'aborting':
      if (command === 'fail') return withState(current, 'failed', { blocked_reason: options.reason ?? null })
      break
    default:
      break
  }

  return illegal(current, command)
}

export function consumeStepBudget(snapshot) {
  const current = createRunState(snapshot)
  if (current.state !== 'stepping') return current
  if (current.budget <= 0) throw new Error('step budget exhausted')
  return { ...current, budget: current.budget - 1 }
}

export function finishStep(snapshot, reason = 'next_proposal') {
  const current = createRunState(snapshot)
  if (current.state !== 'stepping') return current
  return withState(current, 'paused', { step_finished_reason: reason })
}

export function isActionState(snapshot) {
  return snapshot?.state === 'running' || snapshot?.state === 'stepping'
}
