import { checkActionGate, consumeActionBudget } from './action-gate.js'
import { applyRunCommand, createRunState, finishStep } from './state-machine.js'
import { createTimeline } from './timeline.js'

export {
  RUN_COMMANDS,
  RUN_STATES,
  applyRunCommand,
  consumeStepBudget,
  createRunState,
  finishStep,
  isActionState,
} from './state-machine.js'
export { checkActionGate, consumeActionBudget } from './action-gate.js'
export { SAFETY_GATES, classifySafetyGate, evaluateSafetyGate, safetyGateReason } from './safety-gates.js'
export { createTimeline } from './timeline.js'

export function createRunControl(options = {}) {
  let snapshot = createRunState(options)
  const timeline = options.timeline ?? createTimeline(options.timelineOptions)
  const setTimer = options.setTimeout ?? globalThis.setTimeout?.bind(globalThis)
  const clearTimer = options.clearTimeout ?? globalThis.clearTimeout?.bind(globalThis)
  let stepTimer = null

  function clearStepTimer() {
    if (stepTimer && clearTimer) clearTimer(stepTimer)
    stepTimer = null
  }

  function scheduleStepTail() {
    clearStepTimer()
    if (!setTimer || snapshot.state !== 'stepping') return
    stepTimer = setTimer(() => {
      snapshot = finishStep(snapshot, 'step_tail_timeout')
      timeline.append({
        type: 'run.control',
        event_id: `run-control-step-tail-${Date.now()}`,
        session_id: options.session_id ?? 'unknown',
        command: 'pause',
        source: 'safety_gate',
        at: new Date().toISOString(),
        from_state: 'stepping',
        to_state: 'paused',
        reason: 'step_tail_timeout',
      }, 'run-control')
    }, snapshot.step_tail_ms)
  }

  return {
    snapshot() {
      return { ...snapshot }
    },
    command(command, commandOptions = {}) {
      const before = snapshot
      snapshot = applyRunCommand(snapshot, command, commandOptions)
      if (snapshot.state === 'stepping') scheduleStepTail()
      else clearStepTimer()
      return { before, after: { ...snapshot } }
    },
    append(event, source) {
      return timeline.append(event, source)
    },
    records() {
      return timeline.records()
    },
    events() {
      return timeline.events()
    },
    check(action, context) {
      return checkActionGate(snapshot, action, context)
    },
    consumeAction(action) {
      const gate = checkActionGate(snapshot, action)
      if (gate.decision !== 'allowed') return { gate, snapshot: { ...snapshot } }
      snapshot = consumeActionBudget(snapshot)
      return { gate, snapshot: { ...snapshot } }
    },
    finishStep(reason) {
      clearStepTimer()
      snapshot = finishStep(snapshot, reason)
      return { ...snapshot }
    },
  }
}
