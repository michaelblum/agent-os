export {
  OPERATOR_ANNOTATION_MENU_KIND,
  OPERATOR_ANNOTATION_START_EVENT,
  OPERATOR_ANNOTATION_MENU_QUERY_PARAM,
  OPERATOR_ANNOTATION_MENU_PROJECTION_SCHEMA_VERSION,
} from './operator-annotation-menu-contract.js'

import {
  OPERATOR_ANNOTATION_MENU_KIND,
  OPERATOR_ANNOTATION_START_EVENT,
  OPERATOR_ANNOTATION_MENU_QUERY_PARAM,
  OPERATOR_ANNOTATION_MENU_PROJECTION_SCHEMA_VERSION,
} from './operator-annotation-menu-contract.js'

function nonEmptyString(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function isOperatorAnnotationMenuItem(item) {
  return item && typeof item === 'object' && item.kind === OPERATOR_ANNOTATION_MENU_KIND
}

export function operatorAnnotationStatusMenuItems(menu = []) {
  return (Array.isArray(menu) ? menu : [])
    .filter(isOperatorAnnotationMenuItem)
    .map((item) => ({
      id: nonEmptyString(item.action_id, item.id),
      title: nonEmptyString(item.label, 'Annotate'),
      enabled: item.enabled !== false,
      checked: item.checked === true,
    }))
}

export function operatorAnnotationMenuRoutes(menu = []) {
  const routes = new Map()
  for (const item of Array.isArray(menu) ? menu : []) {
    if (!isOperatorAnnotationMenuItem(item)) continue
    const actionId = nonEmptyString(item.action_id, item.id)
    const targetSurface = nonEmptyString(item.surface)
    if (!actionId || !targetSurface) continue
    routes.set(actionId, {
      id: item.id,
      action_id: actionId,
      label: item.label,
      surface: targetSurface,
      message_type: nonEmptyString(item.message_type, OPERATOR_ANNOTATION_START_EVENT),
      source: nonEmptyString(item.source, 'status_item.menu_action'),
      mode: nonEmptyString(item.mode, 'selection_annotation'),
      create_pending_annotation: item.create_pending_annotation !== false,
    })
  }
  return routes
}

function decodeBase64Url(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/')
  const padding = normalized.length % 4 ? '='.repeat(4 - (normalized.length % 4)) : ''
  return atob(`${normalized}${padding}`)
}

function expectedSurfaceID(options = {}) {
  return nonEmptyString(options.surface_id || options.surfaceId)
    || nonEmptyString(globalThis.__aosCanvasId)
    || nonEmptyString(globalThis.__aosSurfaceCanvasId)
}

export function operatorAnnotationMenuFromProjection(projection = {}, options = {}) {
  if (!projection || typeof projection !== 'object') return []
  if (projection.schema_version !== OPERATOR_ANNOTATION_MENU_PROJECTION_SCHEMA_VERSION) return []
  const experienceID = nonEmptyString(projection.experience_id)
  const surfaceID = nonEmptyString(projection.surface_id)
  if (!experienceID || !surfaceID || !Array.isArray(projection.menu)) return []
  const expected = expectedSurfaceID(options)
  if (expected && expected !== surfaceID) return []
  return projection.menu
    .filter((item) => {
      if (!isOperatorAnnotationMenuItem(item)) return true
      return nonEmptyString(item.surface) === surfaceID
    })
    .map((item) => {
      if (!isOperatorAnnotationMenuItem(item)) return item
      return {
        ...item,
        surface: surfaceID,
      }
    })
}

export function operatorAnnotationMenuFromLocation(locationObject = globalThis.location, options = {}) {
  if (!locationObject?.search) return []
  const params = new URLSearchParams(locationObject.search)
  const encoded = params.get(OPERATOR_ANNOTATION_MENU_QUERY_PARAM)
  if (!encoded) return []
  try {
    return operatorAnnotationMenuFromProjection(JSON.parse(decodeBase64Url(encoded)), options)
  } catch {
    return []
  }
}

export function routeOperatorAnnotationMenuAction(message = {}, menu = [], host = {}) {
  if (message?.type !== 'status_item.menu_action') return { handled: false, reason: 'not_status_item_menu_action' }
  const actionId = nonEmptyString(message.id || message.action_id)
  if (!actionId) return { handled: false, reason: 'missing_action_id' }
  const route = operatorAnnotationMenuRoutes(menu).get(actionId)
  if (!route) return { handled: false, reason: 'unknown_action_id', action_id: actionId }
  if (typeof host.post !== 'function') return { handled: false, reason: 'missing_host_post', action_id: actionId }

  const routedMessage = {
    type: route.message_type,
    source: route.source,
    menu_item_id: route.id,
    action_id: actionId,
    mode: route.mode,
    create_pending_annotation: route.create_pending_annotation,
    origin_x: Number.isFinite(Number(message.origin_x)) ? Number(message.origin_x) : null,
    origin_y: Number.isFinite(Number(message.origin_y)) ? Number(message.origin_y) : null,
    modifiers: Array.isArray(message.modifiers) ? message.modifiers : [],
  }
  host.post('canvas.send', {
    target: route.surface,
    message: routedMessage,
  })
  return {
    handled: true,
    action_id: actionId,
    target: route.surface,
    message: routedMessage,
  }
}
