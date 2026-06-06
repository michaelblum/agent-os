// semantic-targets.js — accessibility metadata and companion DOM helpers.
//
// This module keeps semantic names, AOS routing identity, and visual rendering
// separate. It is intentionally small: apps own layout/behavior, while toolkit
// normalizes the target contract and stamps standard metadata consistently.

const AX_ROLE_ALIASES = {
  AXButton: 'button',
  AXMenu: 'menu',
  AXMenuItem: 'menuitem',
  AXCheckBox: 'checkbox',
  AXCheckBoxGroup: 'group',
  AXRadioButton: 'radio',
  AXRadioGroup: 'radiogroup',
  AXSlider: 'slider',
  AXTextField: 'textbox',
  AXTextArea: 'textbox',
  AXSearchField: 'searchbox',
  AXPopUpButton: 'combobox',
  AXGroup: 'group',
  AXStaticText: 'text',
  AXImage: 'img',
  AXTab: 'tab',
  AXTabGroup: 'tablist',
  AXLink: 'link',
}

const NATIVE_BUTTON_ROLES = new Set(['button'])
const DEFAULT_SEMANTIC_TARGET_ATTRIBUTE_ORDER = Object.freeze([
  'aria-label',
  'data-aos-ref',
  'data-aos-surface',
  'data-semantic-target-id',
  'data-aos-parent-canvas',
  'role',
  'data-aos-action',
  'data-aos-actions',
  'data-aos-metadata',
  'aria-disabled',
  'aria-pressed',
  'aria-current',
  'aria-selected',
  'aria-checked',
  'aria-expanded',
  'aria-valuetext',
])

function finite(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function text(value, fallback = '') {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim()
  return s || fallback
}

function safeId(value, fallback = 'target') {
  return text(value, fallback).replace(/[^a-zA-Z0-9_-]/g, '-')
}

function pickName(target = {}) {
  return text(target.name ?? target.ariaLabel ?? target.label ?? target.title ?? target.id, 'Target')
}

function pickAction(target = {}) {
  return text(target.action ?? target.actionId ?? target.command, '')
}

function normalizeActions(target = {}) {
  const source = target.actions ?? target.primitiveActions ?? target.primitive_actions
  if (Array.isArray(source)) return [...new Set(source.map((item) => text(item)).filter(Boolean))]
  return text(source).split(/[\s,]+/).filter(Boolean)
}

function normalizeRole(role = 'button') {
  const value = text(role, 'button')
  return AX_ROLE_ALIASES[value] || value
}

function normalizeFrame(frame = null, fallback = null) {
  const source = frame ?? fallback
  if (!source) return null
  if (Array.isArray(source) && source.length >= 4) {
    const [x, y, w, h] = source
    return normalizeFrameObject({ x, y, width: w, height: h })
  }
  if (typeof source.getBoundingClientRect === 'function') {
    const rect = source.getBoundingClientRect()
    return normalizeFrameObject(rect)
  }
  if (typeof source === 'object') return normalizeFrameObject(source)
  return null
}

function normalizeFrameObject(source = {}) {
  const x = finite(source.x ?? source.left, NaN)
  const y = finite(source.y ?? source.top, NaN)
  const width = finite(source.width ?? source.w, NaN)
  const height = finite(source.height ?? source.h, NaN)
  if (![x, y, width, height].every(Number.isFinite)) return null
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  }
}

function boolAttr(value) {
  return value ? 'true' : 'false'
}

function checkedAttr(value) {
  return value === 'mixed' ? 'mixed' : boolAttr(value)
}

function escAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function setOrRemoveAttr(element, name, value) {
  if (!element?.setAttribute) return
  if (value === undefined || value === null || value === '') {
    element.removeAttribute?.(name)
    return
  }
  element.setAttribute(name, String(value))
}

function setDataset(element, name, value) {
  if (!element?.dataset) return
  if (value === undefined || value === null || value === '') {
    delete element.dataset[name]
    return
  }
  element.dataset[name] = String(value)
}

function roleTag(role) {
  if (NATIVE_BUTTON_ROLES.has(role)) return 'button'
  return 'div'
}

export function refForTarget(target = {}, options = {}) {
  if (target.ref) return text(target.ref)
  const surface = text(target.surface ?? target.surfaceId ?? options.surface ?? options.surfaceId, '')
  const id = safeId(target.id, '')
  if (!id) throw new Error('semantic target ref requires id or explicit ref')
  return surface ? `${surface}:${id}` : id
}

export function normalizeSemanticTarget(target = {}, options = {}) {
  if (!target || typeof target !== 'object') throw new Error('semantic target must be an object')
  const id = text(target.id ?? target.ref, '')
  if (!id) throw new Error('semantic target requires id')
  const role = normalizeRole(target.role ?? options.role ?? 'button')
  const name = pickName(target)
  const action = pickAction(target)
  const surface = text(target.surface ?? target.surfaceId ?? options.surface ?? options.surfaceId, '')
  const frame = normalizeFrame(target.frame ?? target.rect ?? target.bounds, options.frame)
  const normalized = {
    id,
    role,
    name,
    action,
    actions: normalizeActions(target),
    enabled: target.enabled === undefined ? true : !!target.enabled,
    current: target.current ?? target.active ?? null,
    pressed: target.pressed ?? null,
    selected: target.selected ?? null,
    checked: target.checked ?? null,
    expanded: target.expanded ?? null,
    value: target.value ?? null,
    surface,
    parent_canvas_id: text(target.parent_canvas_id ?? options.parent_canvas_id, ''),
    ref: refForTarget({ ...target, id, surface }, options),
    metadata: {
      ...(target.metadata && typeof target.metadata === 'object' ? target.metadata : {}),
    },
  }
  if (frame) normalized.frame = frame
  return normalized
}

export function normalizeSemanticTargets(targets = [], options = {}) {
  if (!Array.isArray(targets)) return []
  return targets.map((target) => normalizeSemanticTarget(target, options))
}

export function compactObject(value) {
  // Assumes JSON-safe input: drops undefined/functions and throws on cycles.
  return JSON.parse(JSON.stringify(value ?? null))
}

export function extensionSource(record = {}) {
  return {
    path: record.source_path ?? null,
    line_start: record.source_line_start ?? null,
    line_end: record.source_line_end ?? null,
  }
}

export function actionList(target = {}, options = {}) {
  if (Array.isArray(options.actions)) return [...options.actions]
  if (Array.isArray(target.actions)) return [...target.actions]
  const action = pickAction(target)
  return action ? [action] : []
}

export function normalizeAgentUiTarget(target = {}, options = {}) {
  const semantic = normalizeSemanticTarget(target, options)
  const extension = {
    ...(options.extension && typeof options.extension === 'object' ? options.extension : {}),
  }
  if (!Object.hasOwn(extension, 'source')) extension.source = extensionSource(target)

  const provenance = {
    ...(options.provenance && typeof options.provenance === 'object' ? options.provenance : {}),
  }
  if (!options.suppressSourcePayloadId && !Object.hasOwn(provenance, 'source_payload_id')) {
    provenance.source_payload_id = target.id ?? target.ref ?? semantic.ref
  }
  if (semantic.metadata !== undefined && !Object.hasOwn(provenance, 'metadata')) {
    provenance.metadata = compactObject(semantic.metadata)
  }
  if (semantic.frame !== undefined && !Object.hasOwn(provenance, 'frame')) {
    provenance.frame = compactObject(semantic.frame)
  }
  if (!Object.hasOwn(provenance, 'parent_canvas_id')) provenance.parent_canvas_id = semantic.parent_canvas_id
  if (target.selector && !Object.hasOwn(provenance, 'selector')) provenance.selector = target.selector

  return {
    ref: semantic.ref,
    surface: semantic.surface,
    role: semantic.role,
    name: semantic.name,
    kind: text(options.kind ?? target.kind, 'semantic_target'),
    enabled: semantic.enabled,
    state: {
      value: semantic.value,
      current: semantic.current,
      pressed: semantic.pressed,
      selected: semantic.selected,
      checked: semantic.checked,
      expanded: semantic.expanded,
    },
    actions: actionList(target, options),
    extension,
    provenance,
  }
}

function roleMatchesNativeElement(normalized, options = {}) {
  const nativeRole = options.nativeRole || (options.nativeButton ? 'button' : '')
  return nativeRole && normalized.role === nativeRole
}

export function semanticTargetAttributeEntries(target = {}, options = {}) {
  const normalized = normalizeSemanticTarget(target, options)
  const attrs = new Map([
    ['aria-label', normalized.name],
    ['data-aos-ref', normalized.ref],
    ['data-aos-surface', normalized.surface],
    ['data-semantic-target-id', normalized.id],
    ['data-aos-parent-canvas', options.includeParentCanvas === false ? null : normalized.parent_canvas_id],
    ['data-aos-action', normalized.action],
    ['data-aos-actions', normalized.actions.join(' ')],
    ['data-aos-metadata', Object.keys(normalized.metadata).length ? JSON.stringify(normalized.metadata) : null],
    ['aria-disabled', normalized.enabled ? null : 'true'],
    ['aria-pressed', normalized.pressed === null ? null : boolAttr(normalized.pressed)],
    ['aria-current', normalized.current === null ? null : normalized.current === true ? 'true' : normalized.current],
    ['aria-selected', normalized.selected === null ? null : boolAttr(normalized.selected)],
    ['aria-checked', normalized.checked === null ? null : checkedAttr(normalized.checked)],
    ['aria-expanded', normalized.expanded === null ? null : boolAttr(normalized.expanded)],
    ['aria-valuetext', normalized.value],
  ])
  if (normalized.role && !roleMatchesNativeElement(normalized, options)) {
    attrs.set('role', normalized.role)
  }

  const order = Array.isArray(options.attributeOrder)
    ? options.attributeOrder
    : DEFAULT_SEMANTIC_TARGET_ATTRIBUTE_ORDER
  const seen = new Set()
  const ordered = []
  for (const name of order) {
    if (!attrs.has(name)) continue
    seen.add(name)
    ordered.push([name, attrs.get(name)])
  }
  for (const [name, value] of attrs.entries()) {
    if (!seen.has(name)) ordered.push([name, value])
  }
  return ordered.filter(([, value]) => value !== undefined && value !== null && value !== '')
}

export function semanticTargetAttrString(target = {}, options = {}) {
  return semanticTargetAttributeEntries(target, options)
    .map(([name, value]) => `${name}="${escAttr(value)}"`)
    .join(' ')
}

export function applySemanticTargetAttributes(element, target = {}, options = {}) {
  if (!element) return null
  const normalized = normalizeSemanticTarget(target, options)
  const nativeTag = element.tagName?.toLowerCase?.()

  setOrRemoveAttr(element, 'id', options.idPrefix === null ? element.id : `${options.idPrefix || 'aos-semantic-target'}-${safeId(normalized.id)}`)
  if (!(nativeTag === 'button' && normalized.role === 'button')) {
    setOrRemoveAttr(element, 'role', normalized.role)
  } else {
    element.removeAttribute?.('role')
  }
  if (nativeTag === 'button') setOrRemoveAttr(element, 'type', 'button')
  setOrRemoveAttr(element, 'aria-label', normalized.name)
  setOrRemoveAttr(element, 'aria-disabled', normalized.enabled ? null : 'true')
  if (normalized.current !== null) setOrRemoveAttr(element, 'aria-current', normalized.current === true ? 'true' : normalized.current)
  else element.removeAttribute?.('aria-current')
  if (normalized.pressed !== null) setOrRemoveAttr(element, 'aria-pressed', boolAttr(normalized.pressed))
  else element.removeAttribute?.('aria-pressed')
  if (normalized.selected !== null) setOrRemoveAttr(element, 'aria-selected', boolAttr(normalized.selected))
  else element.removeAttribute?.('aria-selected')
  if (normalized.checked !== null) setOrRemoveAttr(element, 'aria-checked', boolAttr(normalized.checked))
  else element.removeAttribute?.('aria-checked')
  if (normalized.expanded !== null) setOrRemoveAttr(element, 'aria-expanded', boolAttr(normalized.expanded))
  else element.removeAttribute?.('aria-expanded')
  if (normalized.value !== null) setOrRemoveAttr(element, 'aria-valuetext', normalized.value)
  else element.removeAttribute?.('aria-valuetext')

  if ('disabled' in element) element.disabled = nativeTag === 'button' && !normalized.enabled
  setDataset(element, 'aosRef', normalized.ref)
  setDataset(element, 'aosAction', normalized.action)
  setDataset(element, 'aosActions', normalized.actions.join(' '))
  setDataset(element, 'aosSurface', normalized.surface)
  setDataset(element, 'semanticTargetId', normalized.id)
  setDataset(element, 'aosParentCanvas', normalized.parent_canvas_id)
  setDataset(element, 'aosMetadata', Object.keys(normalized.metadata).length ? JSON.stringify(normalized.metadata) : '')

  if (normalized.frame && element.style) {
    element.style.position = options.position || 'absolute'
    element.style.left = `${normalized.frame.x}px`
    element.style.top = `${normalized.frame.y}px`
    element.style.width = `${normalized.frame.width}px`
    element.style.height = `${normalized.frame.height}px`
  }
  if (options.visibleLabel) {
    element.textContent = normalized.name
  } else if (element.textContent) {
    element.textContent = ''
  }
  return normalized
}

export function createSemanticTargetElement(documentRef, target = {}, options = {}) {
  if (!documentRef?.createElement) throw new Error('document with createElement is required')
  const normalized = normalizeSemanticTarget(target, options)
  const element = documentRef.createElement(options.tagName || roleTag(normalized.role))
  applySemanticTargetAttributes(element, normalized, options)
  return element
}
