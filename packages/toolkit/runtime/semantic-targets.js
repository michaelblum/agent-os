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
  AXRadioButton: 'radio',
  AXSlider: 'slider',
  AXTextField: 'textbox',
  AXTextArea: 'textbox',
  AXSearchField: 'searchbox',
  AXGroup: 'group',
  AXStaticText: 'text',
  AXImage: 'img',
  AXTab: 'tab',
  AXTabGroup: 'tablist',
  AXLink: 'link',
}

const NATIVE_BUTTON_ROLES = new Set(['button'])

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

export function aosRefForTarget(target = {}, options = {}) {
  if (target.aosRef) return text(target.aosRef)
  const surface = text(target.surface ?? target.surfaceId ?? options.surface ?? options.surfaceId, '')
  const id = safeId(target.id ?? target.name)
  return surface ? `${surface}:${id}` : id
}

export function normalizeSemanticTarget(target = {}, options = {}) {
  if (!target || typeof target !== 'object') throw new Error('semantic target must be an object')
  const id = text(target.id ?? target.ref ?? target.name, '')
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
    enabled: target.enabled === undefined ? true : !!target.enabled,
    current: target.current ?? target.active ?? null,
    pressed: target.pressed ?? null,
    selected: target.selected ?? null,
    checked: target.checked ?? null,
    expanded: target.expanded ?? null,
    value: target.value ?? null,
    surface,
    parentCanvasId: text(target.parentCanvasId ?? options.parentCanvasId, ''),
    aosRef: aosRefForTarget({ ...target, id, surface }, options),
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
  setDataset(element, 'aosRef', normalized.aosRef)
  setDataset(element, 'aosAction', normalized.action)
  setDataset(element, 'aosSurface', normalized.surface)
  setDataset(element, 'semanticTargetId', normalized.id)
  setDataset(element, 'aosParentCanvas', normalized.parentCanvasId)

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
