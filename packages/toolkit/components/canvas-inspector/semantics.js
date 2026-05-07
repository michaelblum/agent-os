import { semanticTargetAttrString } from '../../runtime/semantic-targets.js'

const SURFACE = 'canvas-inspector'

export function canvasInspectorAosRef(...parts) {
  return [SURFACE, ...parts]
    .map((part) => String(part || 'unknown').replace(/\s+/g, '-'))
    .join(':')
}

export function semanticAttrString(target = {}, options = {}) {
  return semanticTargetAttrString({
    ...target,
    surface: SURFACE,
  }, {
    nativeRole: options.nativeButton ? 'button' : options.nativeRole,
  })
}

export function canvasActionAttrs(canvasId, action, options = {}) {
  const labels = {
    stats: `Stats for canvas ${canvasId}`,
    tint: `Tint canvas ${canvasId}`,
    remove: `Remove canvas ${canvasId}`,
  }
  const actions = {
    stats: 'toggle_stats',
    tint: 'toggle_tint',
    remove: 'remove_canvas',
  }
  return semanticAttrString({
    id: `${action}-${canvasId}`,
    role: 'AXButton',
    name: options.name || labels[action] || `${action} ${canvasId}`,
    action: options.action || actions[action] || action,
    aosRef: canvasInspectorAosRef('canvas', canvasId, action),
    pressed: options.pressed ?? null,
  }, { nativeButton: true })
}

export function inspectorControlAttrs(id, options = {}) {
  return semanticAttrString({
    id,
    role: 'AXButton',
    name: options.name || id,
    action: options.action || id,
    aosRef: options.aosRef || canvasInspectorAosRef('control', id),
    pressed: options.pressed ?? null,
    expanded: options.expanded ?? null,
  }, { nativeButton: true })
}
