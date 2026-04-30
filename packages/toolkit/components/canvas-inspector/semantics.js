import { normalizeSemanticTarget } from '../../runtime/semantic-targets.js'

const SURFACE = 'canvas-inspector'

function escAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function boolAttr(value) {
  return value ? 'true' : 'false'
}

export function canvasInspectorAosRef(...parts) {
  return [SURFACE, ...parts]
    .map((part) => String(part || 'unknown').replace(/\s+/g, '-'))
    .join(':')
}

export function semanticAttrString(target = {}, options = {}) {
  const normalized = normalizeSemanticTarget({
    ...target,
    surface: SURFACE,
  })
  const attrs = [
    ['aria-label', normalized.name],
    ['data-aos-ref', normalized.aosRef],
    ['data-aos-surface', normalized.surface],
    ['data-semantic-target-id', normalized.id],
    ['data-aos-parent-canvas', normalized.parentCanvasId],
  ]
  if (normalized.role && !(options.nativeButton && normalized.role === 'button')) attrs.push(['role', normalized.role])
  if (normalized.action) attrs.push(['data-aos-action', normalized.action])
  if (!normalized.enabled) attrs.push(['aria-disabled', 'true'])
  if (normalized.pressed !== null) attrs.push(['aria-pressed', boolAttr(normalized.pressed)])
  if (normalized.current !== null) attrs.push(['aria-current', normalized.current === true ? 'true' : normalized.current])
  if (normalized.selected !== null) attrs.push(['aria-selected', boolAttr(normalized.selected)])
  if (normalized.checked !== null) attrs.push(['aria-checked', boolAttr(normalized.checked)])
  if (normalized.expanded !== null) attrs.push(['aria-expanded', boolAttr(normalized.expanded)])
  return attrs
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([name, value]) => `${name}="${escAttr(value)}"`)
    .join(' ')
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
