import {
  isCanonicalSceneId as validId,
  isSceneRecord as isRecord,
  sceneFinite as finite,
} from './scene-contract-primitives.js'

export const SCENE_RADIAL_MENU_LIMITS = Object.freeze({
  maxItems: 32,
  maxRadius: 2048,
  maxItemRadius: 128,
})

const SAFE_COLOR = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/iu

function error(code, path, message) {
  return { code, path, message }
}

function exactKeys(value, allowed, path, errors) {
  if (!isRecord(value)) return
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(error('unknown_field', `${path}.${key}`, `Unknown scene radial-menu field ${key}.`))
  }
}

function normalizeItems(value) {
  const source = Array.isArray(value) ? value : []
  return Object.freeze(source.slice(0, SCENE_RADIAL_MENU_LIMITS.maxItems).map((item) => Object.freeze({
    id: item.id,
    color: typeof item.color === 'string' ? item.color : '#9b7cff',
    disabled: item.disabled === true,
  })))
}

export function normalizeSceneRadialMenuParameters(parameters = {}) {
  const style = isRecord(parameters.style) ? parameters.style : {}
  return Object.freeze({
    closeOnSelect: parameters.closeOnSelect !== false,
    items: normalizeItems(parameters.items),
    menuId: validId(parameters.menuId) ? parameters.menuId : 'radial-menu',
    radius: finite(parameters.radius, 108, 1, SCENE_RADIAL_MENU_LIMITS.maxRadius),
    spreadDegrees: finite(parameters.spreadDegrees, 360, 1, 360),
    startAngle: finite(parameters.startAngle, -90, -3600, 3600),
    style: Object.freeze({
      activeColor: SAFE_COLOR.test(style.activeColor ?? '') ? style.activeColor : '#ffffff',
      fillColor: SAFE_COLOR.test(style.fillColor ?? '') ? style.fillColor : '#201b2f',
      itemRadius: finite(style.itemRadius, 20, 2, SCENE_RADIAL_MENU_LIMITS.maxItemRadius),
      opacity: finite(style.opacity, 0.94, 0, 1),
    }),
  })
}

export function validateSceneRadialMenuParameters(parameters, path = 'response.parameters') {
  const errors = []
  if (!isRecord(parameters)) return [error('invalid_parameters', path, 'Scene radial-menu parameters must be an object.')]
  exactKeys(parameters, new Set(['closeOnSelect', 'items', 'menuId', 'radius', 'spreadDegrees', 'startAngle', 'style']), path, errors)
  if (!validId(parameters.menuId)) errors.push(error('invalid_radial_menu_id', `${path}.menuId`, 'Scene radial-menu IDs must be canonical.'))
  if (!Array.isArray(parameters.items) || parameters.items.length < 1 || parameters.items.length > SCENE_RADIAL_MENU_LIMITS.maxItems) {
    errors.push(error('invalid_radial_items', `${path}.items`, 'Scene radial menus require a bounded item descriptor list.'))
  } else {
    const ids = new Set()
    parameters.items.forEach((item, index) => {
      const itemPath = `${path}.items.${index}`
      if (!isRecord(item)) {
        errors.push(error('invalid_radial_item', itemPath, 'Scene radial-menu items must be declarative objects.'))
        return
      }
      exactKeys(item, new Set(['color', 'disabled', 'id']), itemPath, errors)
      if (!validId(item.id) || ids.has(item.id)) errors.push(error('invalid_radial_item', `${itemPath}.id`, 'Scene radial-menu item IDs must be canonical and unique.'))
      ids.add(item.id)
      if (item.color !== undefined && !SAFE_COLOR.test(item.color)) errors.push(error('invalid_color', `${itemPath}.color`, 'Scene colors must use bounded hexadecimal notation.'))
      if (item.disabled !== undefined && typeof item.disabled !== 'boolean') errors.push(error('invalid_radial_item', `${itemPath}.disabled`, 'Scene radial-menu disabled state must be boolean.'))
    })
  }
  for (const [key, min, max] of [['radius', 1, SCENE_RADIAL_MENU_LIMITS.maxRadius], ['spreadDegrees', 1, 360], ['startAngle', -3600, 3600]]) {
    if (parameters[key] !== undefined && (!Number.isFinite(parameters[key]) || parameters[key] < min || parameters[key] > max)) {
      errors.push(error('invalid_radial_geometry', `${path}.${key}`, 'Scene radial-menu geometry must be finite and bounded.'))
    }
  }
  if (parameters.closeOnSelect !== undefined && typeof parameters.closeOnSelect !== 'boolean') {
    errors.push(error('invalid_radial_menu_policy', `${path}.closeOnSelect`, 'Scene radial-menu close policy must be boolean.'))
  }
  if (parameters.style !== undefined && !isRecord(parameters.style)) errors.push(error('invalid_visual_style', `${path}.style`, 'Scene radial-menu style must be an object.'))
  else if (parameters.style !== undefined) {
    exactKeys(parameters.style, new Set(['activeColor', 'fillColor', 'itemRadius', 'opacity']), `${path}.style`, errors)
    for (const key of ['activeColor', 'fillColor']) {
      if (parameters.style[key] !== undefined && !SAFE_COLOR.test(parameters.style[key])) errors.push(error('invalid_color', `${path}.style.${key}`, 'Scene colors must use bounded hexadecimal notation.'))
    }
    if (parameters.style.itemRadius !== undefined && (!Number.isFinite(parameters.style.itemRadius) || parameters.style.itemRadius < 2 || parameters.style.itemRadius > SCENE_RADIAL_MENU_LIMITS.maxItemRadius)) errors.push(error('invalid_visual_style', `${path}.style.itemRadius`, 'Scene radial-menu item radius must be bounded.'))
    if (parameters.style.opacity !== undefined && (!Number.isFinite(parameters.style.opacity) || parameters.style.opacity < 0 || parameters.style.opacity > 1)) errors.push(error('invalid_visual_style', `${path}.style.opacity`, 'Scene radial-menu opacity must be bounded.'))
  }
  return errors
}

function displayBounds(topology, origin) {
  const displays = Array.isArray(topology?.displays) ? topology.displays : []
  const normalized = displays.flatMap((display) => {
    const bounds = display?.bounds
    if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite) || bounds[2] <= 0 || bounds[3] <= 0) return []
    return [{ x: bounds[0], y: bounds[1], width: bounds[2], height: bounds[3] }]
  })
  return normalized.find((bounds) => (
    origin.x >= bounds.x && origin.x <= bounds.x + bounds.width
    && origin.y >= bounds.y && origin.y <= bounds.y + bounds.height
  )) ?? normalized[0] ?? null
}

function radialOffsets(parameters) {
  const count = parameters.items.length
  const fullCircle = parameters.spreadDegrees >= 360
  const step = count <= 1 ? 0 : fullCircle ? 360 / count : parameters.spreadDegrees / (count - 1)
  return parameters.items.map((_, index) => {
    const angle = (parameters.startAngle + index * step) * Math.PI / 180
    return { x: Math.cos(angle) * parameters.radius, y: Math.sin(angle) * parameters.radius }
  })
}

export function resolveSceneRadialMenuLayout(response, topology = null) {
  const parameters = normalizeSceneRadialMenuParameters(response)
  const origin = response?.origin && Number.isFinite(response.origin.x) && Number.isFinite(response.origin.y)
    ? response.origin
    : { x: 0, y: 0 }
  const offsets = radialOffsets(parameters)
  const bounds = displayBounds(topology, origin)
  let centerX = origin.x
  let centerY = origin.y
  if (bounds && offsets.length > 0) {
    const margin = parameters.style.itemRadius + 4
    const minX = Math.min(...offsets.map((point) => point.x)) - margin
    const maxX = Math.max(...offsets.map((point) => point.x)) + margin
    const minY = Math.min(...offsets.map((point) => point.y)) - margin
    const maxY = Math.max(...offsets.map((point) => point.y)) + margin
    centerX = Math.min(bounds.x + bounds.width - maxX, Math.max(bounds.x - minX, centerX))
    centerY = Math.min(bounds.y + bounds.height - maxY, Math.max(bounds.y - minY, centerY))
  }
  return Object.freeze({
    center: Object.freeze({ x: centerX, y: centerY }),
    items: Object.freeze(parameters.items.map((item, index) => Object.freeze({
      ...item,
      index,
      center: Object.freeze({ x: centerX + offsets[index].x, y: centerY + offsets[index].y }),
      hitRadius: parameters.style.itemRadius,
    }))),
    parameters,
  })
}

export function resolveSceneRadialMenuResponse({ frame, interaction } = {}) {
  const parameters = normalizeSceneRadialMenuParameters(interaction?.response?.parameters)
  return Object.freeze({
    kind: 'radial_menu',
    action: 'open',
    menuId: parameters.menuId,
    origin: frame?.origin ?? frame?.current ?? null,
    items: parameters.items,
    radius: parameters.radius,
    spreadDegrees: parameters.spreadDegrees,
    startAngle: parameters.startAngle,
    style: parameters.style,
    closeOnSelect: parameters.closeOnSelect,
  })
}

export function withSceneRadialSelection(frame, interaction) {
  const parameters = interaction?.recognizer?.parameters ?? {}
  const items = parameters.items ?? 4
  const count = Array.isArray(items) ? items.length : finite(items, 4, 1, 32)
  const total = frame.total_delta ?? { x: 0, y: 0 }
  const radialDistance = Math.hypot(total.x ?? 0, total.y ?? 0)
  const radialAngle = Math.atan2(total.y ?? 0, total.x ?? 0)
  const deadZone = finite(parameters.deadZone, 24, 0, 512)
  const sector = (Math.PI * 2) / count
  const normalized = (radialAngle + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2)
  let selectionIndex = radialDistance < deadZone ? null : Math.floor((normalized + sector / 2) / sector) % count
  if (selectionIndex !== null && Array.isArray(items) && items[selectionIndex]?.disabled === true) selectionIndex = null
  return {
    ...frame,
    radial: Object.freeze({ angle: radialAngle, distance: radialDistance, itemCount: count, selectionIndex }),
  }
}
