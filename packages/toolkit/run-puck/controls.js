export const RUN_PUCK_STATES = Object.freeze([
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

const STATE_VIEW = Object.freeze({
  idle: { label: 'Idle', primary: 'resume', tone: 'neutral' },
  planning: { label: 'Planning', primary: 'pause', tone: 'working' },
  running: { label: 'Running', primary: 'pause', tone: 'working' },
  paused: { label: 'Paused', primary: 'resume', tone: 'paused' },
  stepping: { label: 'Step', primary: 'step', tone: 'paused' },
  takeover: { label: 'Takeover', primary: 'release', tone: 'takeover' },
  blocked: { label: 'Blocked', primary: 'open_timeline', tone: 'blocked' },
  aborting: { label: 'Aborting', primary: 'open_timeline', tone: 'blocked' },
  completed: { label: 'Done', primary: 'open_evidence', tone: 'done' },
  failed: { label: 'Failed', primary: 'open_timeline', tone: 'blocked' },
})

const MENU_COMMANDS = Object.freeze([
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
])

export function viewForRunState(state) {
  return STATE_VIEW[state] ?? STATE_VIEW.idle
}

export function primaryCommandForState(state) {
  return viewForRunState(state).primary
}

export function menuCommandsForState(state) {
  if (state === 'takeover') {
    return ['release', 'abort', 'open_timeline', 'open_evidence']
  }
  if (state === 'completed') {
    return ['open_timeline', 'open_evidence']
  }
  if (state === 'failed' || state === 'blocked') {
    return ['resume', 'skip', 'replan', 'take_over', 'abort', 'open_timeline', 'open_evidence']
  }
  return [...MENU_COMMANDS]
}

export function commandLabel(command) {
  return {
    pause: 'Pause',
    resume: 'Resume',
    step: 'Step',
    skip: 'Skip action',
    replan: 'Replan',
    take_over: 'Take over',
    release: 'Release',
    abort: 'Abort run',
    open_timeline: 'Open timeline',
    open_evidence: 'Open evidence',
  }[command] ?? command
}
