import { consumeStepBudget, isActionState } from './state-machine.js'
import { evaluateSafetyGate } from './safety-gates.js'

const DENIED_STATES = new Set(['idle', 'planning', 'paused', 'takeover', 'blocked', 'aborting', 'completed', 'failed'])

export function checkActionGate(snapshot, action, context = {}) {
  if (!snapshot || typeof snapshot !== 'object') {
    return { decision: 'blocked', reason: 'missing run-control state' }
  }

  if (DENIED_STATES.has(snapshot.state)) {
    return { decision: 'blocked', reason: `run is ${snapshot.state}` }
  }

  if (!isActionState(snapshot)) {
    return { decision: 'blocked', reason: `unknown run state: ${snapshot.state}` }
  }

  if (snapshot.state === 'stepping' && snapshot.budget <= 0) {
    return { decision: 'blocked', reason: 'step budget exhausted' }
  }

  const safety = evaluateSafetyGate(action, context)
  if (safety.status === 'require_human_ack') {
    return {
      decision: 'requires_gate',
      gate_kind: safety.gate_kind,
      reason: safety.reason,
    }
  }

  return { decision: 'allowed' }
}

export function consumeActionBudget(snapshot) {
  if (snapshot?.state !== 'stepping') return snapshot
  return consumeStepBudget(snapshot)
}
