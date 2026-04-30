import { applySemanticTargetAttributes } from '../runtime/semantic-targets.js'

const SURFACE = 'run-puck'

export function runPuckAosRef(sessionId, id) {
  return `${SURFACE}:${sessionId || 'unknown'}:${id}`
}

export function applyRunPuckSemanticTarget(element, target = {}, options = {}) {
  return applySemanticTargetAttributes(element, {
    id: target.id,
    role: target.role || 'AXButton',
    name: target.name,
    action: target.action,
    aosRef: target.aosRef || runPuckAosRef(target.sessionId, target.id),
    surface: SURFACE,
    enabled: target.enabled,
    pressed: target.pressed,
    current: target.current,
    expanded: target.expanded,
  }, {
    idPrefix: 'run-puck',
    visibleLabel: options.visibleLabel,
  })
}
