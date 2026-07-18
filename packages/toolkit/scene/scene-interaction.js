import { normalizeCanvasInputMessage } from '../runtime/input-events.js'
import { createPointerGestureStream } from '../runtime/gesture-stream.js'
import {
  resolveSceneRadialMenuResponse,
  validateSceneRadialMenuParameters,
  withSceneRadialSelection,
} from './scene-radial-menu.js'

export const SCENE_EVENT_CONTRACT_ID = 'aos.scene.event.v1'
export const SCENE_INTERACTIONS_CONTRACT_ID = 'aos.scene.cartridge.interactions.v1'

export const SCENE_GESTURE_KINDS = Object.freeze({
  drag: 'drag',
  longPress: 'long_press',
  radial: 'radial',
  tap: 'tap',
})

export const SCENE_GESTURE_PHASES = Object.freeze({
  start: 'start',
  update: 'update',
  end: 'end',
  cancel: 'cancel',
})

export const SCENE_GESTURE_CANCELLATION_REASONS = Object.freeze([
  'escape',
  'owner_disconnected',
  'pointer_cancelled',
  'resource_changed',
  'resource_removed',
  'resource_suspended',
  'stage_disposed',
  'topology_changed',
])

export const SCENE_AFFORDANCE_LIMITS = Object.freeze({
  maxAffordances: 256,
  maxExtent: 4096,
  maxOffset: 1_000_000,
  maxPriority: 1000,
  maxRecognizersPerAffordance: 16,
})

const SAFE_ID = /^[a-z0-9](?:[a-z0-9._/-]{0,126}[a-z0-9])?$/u
const CONSUME_POLICIES = new Set(['always', 'captured', 'down_only', 'never'])
const RECOGNIZER_KIND_BY_IMPLEMENTATION = new Map([
  ['aos.scene.gesture.drag', SCENE_GESTURE_KINDS.drag],
  ['aos.scene.gesture.long-press', SCENE_GESTURE_KINDS.longPress],
  ['aos.scene.gesture.radial', SCENE_GESTURE_KINDS.radial],
  ['aos.scene.gesture.tap', SCENE_GESTURE_KINDS.tap],
])
const RESPONSE_KINDS = new Map([
  ['aos.scene.response.aim-commit', 'aim_commit'],
  ['aos.scene.response.drop', 'drop'],
  ['aos.scene.response.radial-menu', 'radial_menu'],
  ['aos.scene.response.signal-graph', 'signal_graph'],
  ['aos.scene.response.translate', 'translate'],
])
const REMOTE_OR_EXECUTABLE_VALUE = /^(?:data|file|https?|javascript|vbscript):/iu
const EXECUTABLE_FIELD = /^(?:callback|code|eval|function|module|script|sourceCode)$/iu
const SAFE_COLOR = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/iu
const DEFAULT_RECOGNIZER_PRIORITY = Object.freeze({
  long_press: 400,
  radial: 300,
  drag: 200,
  tap: 100,
})

function isRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function finite(value, fallback = 0, min = -Infinity, max = Infinity) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

function point(value) {
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)) return null
  return { x: value.x, y: value.y }
}

function clonePoint(value) {
  const resolved = point(value)
  return resolved ? { ...resolved } : null
}

function distance(origin, current) {
  if (!origin || !current) return 0
  return Math.hypot(current.x - origin.x, current.y - origin.y)
}

function angle(origin, current) {
  if (!origin || !current) return 0
  return Math.atan2(current.y - origin.y, current.x - origin.x)
}

function exactKeys(value, allowed, path, errors) {
  if (!isRecord(value)) return
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push({ code: 'unknown_field', path: `${path}.${key}`, message: `Unknown scene interaction field ${key}.` })
  }
}

function validId(value) {
  return typeof value === 'string'
    && SAFE_ID.test(value)
    && !value.includes('//')
    && !value.split('/').some((part) => !part || part === '.' || part === '..')
}

function validateAffordanceGeometry(value, path, errors) {
  if (!isRecord(value)) {
    errors.push({ code: 'invalid_affordance_geometry', path, message: 'Scene affordance geometry must be a bounded rectangle.' })
    return
  }
  exactKeys(value, new Set(['height', 'kind', 'offset', 'width']), path, errors)
  if (value.kind !== 'rect') errors.push({ code: 'invalid_affordance_geometry', path: `${path}.kind`, message: 'Scene affordance geometry kind must be rect.' })
  for (const key of ['width', 'height']) {
    if (!Number.isFinite(value[key]) || value[key] <= 0 || value[key] > SCENE_AFFORDANCE_LIMITS.maxExtent) {
      errors.push({ code: 'invalid_affordance_extent', path: `${path}.${key}`, message: 'Scene affordance extents must be finite and bounded.' })
    }
  }
  if (!Array.isArray(value.offset) || value.offset.length !== 2 || value.offset.some((entry) => !Number.isFinite(entry) || Math.abs(entry) > SCENE_AFFORDANCE_LIMITS.maxOffset)) {
    errors.push({ code: 'invalid_affordance_offset', path: `${path}.offset`, message: 'Scene affordance offset must contain two bounded finite numbers.' })
  }
}

function validateFiniteData(value, path, errors, depth = 0) {
  if (depth > 8) {
    errors.push({ code: 'value_depth', path, message: 'Scene interaction values exceed the maximum nesting depth.' })
    return
  }
  if (typeof value === 'string') {
    if (value.length > 4096) errors.push({ code: 'value_length', path, message: 'Scene interaction text exceeds the maximum length.' })
    if (REMOTE_OR_EXECUTABLE_VALUE.test(value.trim())) errors.push({ code: 'remote_runtime_value', path, message: 'Scene interactions cannot reference remote or executable runtime values.' })
    return
  }
  if (value === null || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) errors.push({ code: 'non_finite_number', path, message: 'Scene interaction numeric values must be finite.' })
    return
  }
  if (Array.isArray(value)) {
    if (value.length > 256) {
      errors.push({ code: 'value_array_length', path, message: 'Scene interaction arrays exceed the maximum length.' })
      return
    }
    value.forEach((entry, index) => validateFiniteData(entry, `${path}.${index}`, errors, depth + 1))
    return
  }
  if (!isRecord(value)) {
    errors.push({ code: 'executable_value', path, message: 'Scene interaction values must be plain finite JSON.' })
    return
  }
  const entries = Object.entries(value)
  if (entries.length > 64) {
    errors.push({ code: 'value_key_count', path, message: 'Scene interaction objects contain too many keys.' })
    return
  }
  for (const [key, entry] of entries) {
    if (EXECUTABLE_FIELD.test(key)) errors.push({ code: 'executable_field', path: `${path}.${key}`, message: 'Scene interactions cannot contain executable source fields.' })
    validateFiniteData(entry, `${path}.${key}`, errors, depth + 1)
  }
}

function validateInteractionImplementation(value, path, errors, allowed) {
  if (!isRecord(value)) {
    errors.push({ code: 'invalid_interaction_implementation', path, message: 'Scene interaction implementations require an ID and parameters.' })
    return
  }
  exactKeys(value, new Set(['implementation', 'parameters']), path, errors)
  if (!allowed.has(value.implementation)) errors.push({ code: 'unknown_implementation', path: `${path}.implementation`, message: 'Scene interaction implementation is not registered.' })
  if (!isRecord(value.parameters)) errors.push({ code: 'invalid_parameters', path: `${path}.parameters`, message: 'Scene interaction parameters must be an object.' })
  else validateFiniteData(value.parameters, `${path}.parameters`, errors)
}

function validateRecognizerParameters(value, path, errors) {
  if (!isRecord(value?.parameters)) return
  const kind = RECOGNIZER_KIND_BY_IMPLEMENTATION.get(value.implementation)
  const allowed = new Set(['button', 'cancelKey', 'priority', 'threshold'])
  if (kind === SCENE_GESTURE_KINDS.longPress) allowed.add('holdMs')
  if (kind === SCENE_GESTURE_KINDS.radial) {
    allowed.add('deadZone')
    allowed.add('items')
    allowed.add('radius')
    allowed.add('style')
  }
  exactKeys(value.parameters, allowed, `${path}.parameters`, errors)
  const { button, holdMs, priority, threshold } = value.parameters
  if (value.parameters.cancelKey !== undefined && value.parameters.cancelKey !== 'Escape') {
    errors.push({ code: 'invalid_cancel_key', path: `${path}.parameters.cancelKey`, message: 'Scene recognizers support Escape cancellation only.' })
  }
  if (button !== undefined && !['left', 'middle', 'right', 0, 1, 2].includes(button)) {
    errors.push({ code: 'invalid_recognizer_button', path: `${path}.parameters.button`, message: 'Scene recognizer button is invalid.' })
  }
  if (priority !== undefined && (!Number.isInteger(priority) || Math.abs(priority) > SCENE_AFFORDANCE_LIMITS.maxPriority)) {
    errors.push({ code: 'invalid_recognizer_priority', path: `${path}.parameters.priority`, message: 'Scene recognizer priority must be a bounded integer.' })
  }
  if (threshold !== undefined && (!Number.isFinite(threshold) || threshold < 0 || threshold > 256)) {
    errors.push({ code: 'invalid_recognizer_threshold', path: `${path}.parameters.threshold`, message: 'Scene recognizer threshold must be finite and bounded.' })
  }
  if (holdMs !== undefined && (!Number.isFinite(holdMs) || holdMs < 100 || holdMs > 10_000)) {
    errors.push({ code: 'invalid_recognizer_hold', path: `${path}.parameters.holdMs`, message: 'Scene long-press duration must be finite and bounded.' })
  }
  for (const [key, min, max] of [['deadZone', 0, 512], ['radius', 1, 2048]]) {
    const entry = value.parameters[key]
    if (entry !== undefined && (!Number.isFinite(entry) || entry < min || entry > max)) {
      errors.push({ code: 'invalid_radial_geometry', path: `${path}.parameters.${key}`, message: 'Scene radial geometry must be finite and bounded.' })
    }
  }
  if (value.parameters.items !== undefined) {
    if (Number.isInteger(value.parameters.items)) {
      if (value.parameters.items < 1 || value.parameters.items > 32) {
        errors.push({ code: 'invalid_radial_items', path: `${path}.parameters.items`, message: 'Scene radial item count must be bounded.' })
      }
    } else if (Array.isArray(value.parameters.items) && value.parameters.items.length >= 1 && value.parameters.items.length <= 32) {
      const ids = new Set()
      value.parameters.items.forEach((item, index) => {
        const itemPath = `${path}.parameters.items.${index}`
        if (!isRecord(item)) {
          errors.push({ code: 'invalid_radial_item', path: itemPath, message: 'Scene radial items must be declarative objects.' })
          return
        }
        exactKeys(item, new Set(['color', 'disabled', 'id']), itemPath, errors)
        if (!validId(item.id) || ids.has(item.id)) errors.push({ code: 'invalid_radial_item', path: `${itemPath}.id`, message: 'Scene radial item IDs must be canonical and unique.' })
        ids.add(item.id)
        if (item.color !== undefined && !SAFE_COLOR.test(item.color)) errors.push({ code: 'invalid_color', path: `${itemPath}.color`, message: 'Scene colors must use bounded hexadecimal notation.' })
        if (item.disabled !== undefined && typeof item.disabled !== 'boolean') errors.push({ code: 'invalid_radial_item', path: `${itemPath}.disabled`, message: 'Scene radial item disabled state must be boolean.' })
      })
    } else {
      errors.push({ code: 'invalid_radial_items', path: `${path}.parameters.items`, message: 'Scene radial items must be a bounded count or descriptor list.' })
    }
  }
  if (value.parameters.style !== undefined) {
    const stylePath = `${path}.parameters.style`
    const style = value.parameters.style
    if (!isRecord(style)) errors.push({ code: 'invalid_visual_style', path: stylePath, message: 'Scene radial style must be an object.' })
    else {
      exactKeys(style, new Set(['activeColor', 'fillColor', 'itemRadius', 'opacity']), stylePath, errors)
      for (const key of ['activeColor', 'fillColor']) {
        if (style[key] !== undefined && !SAFE_COLOR.test(style[key])) errors.push({ code: 'invalid_color', path: `${stylePath}.${key}`, message: 'Scene colors must use bounded hexadecimal notation.' })
      }
      if (style.itemRadius !== undefined && (!Number.isFinite(style.itemRadius) || style.itemRadius < 2 || style.itemRadius > 128)) errors.push({ code: 'invalid_visual_style', path: `${stylePath}.itemRadius`, message: 'Scene radial item radius must be bounded.' })
      if (style.opacity !== undefined && (!Number.isFinite(style.opacity) || style.opacity < 0 || style.opacity > 1)) errors.push({ code: 'invalid_visual_style', path: `${stylePath}.opacity`, message: 'Scene radial opacity must be bounded.' })
    }
  }
}

function validateSignalDescriptor(value, path, errors) {
  if (!isRecord(value)) {
    errors.push({ code: 'invalid_signal_response', path, message: 'Scene signal responses must contain signal descriptors.' })
    return
  }
  exactKeys(value, new Set(['offset', 'scale', 'signalId', 'source']), path, errors)
  if (!validId(value.signalId)) errors.push({ code: 'invalid_signal_id', path: `${path}.signalId`, message: 'Scene signal response ID is invalid.' })
  if (value.source !== undefined && !['constant', 'distance', 'selection_active', 'selection_index', 'x', 'y'].includes(value.source)) {
    errors.push({ code: 'invalid_signal_source', path: `${path}.source`, message: 'Scene signal response source is invalid.' })
  }
  for (const key of ['scale', 'offset']) {
    if (value[key] !== undefined && (!Number.isFinite(value[key]) || Math.abs(value[key]) > 1e6)) {
      errors.push({ code: 'invalid_signal_value', path: `${path}.${key}`, message: 'Scene signal response values must be finite and bounded.' })
    }
  }
}

function validateResponseParameters(value, path, errors) {
  if (!isRecord(value?.parameters)) return
  const parameters = value.parameters
  const kind = RESPONSE_KINDS.get(value.implementation)
  if (kind === 'translate') {
    exactKeys(parameters, new Set(['axis', 'coordinates', 'snap']), `${path}.parameters`, errors)
    if (parameters.axis !== undefined && !['both', 'x', 'y'].includes(parameters.axis)) {
      errors.push({ code: 'invalid_translate_axis', path: `${path}.parameters.axis`, message: 'Scene translation axis is invalid.' })
    }
    if (parameters.coordinates !== undefined && parameters.coordinates !== 'world') errors.push({ code: 'invalid_response_coordinates', path: `${path}.parameters.coordinates`, message: 'Scene translation coordinates must use world space.' })
    if (parameters.snap !== undefined && typeof parameters.snap !== 'boolean') errors.push({ code: 'invalid_translate_snap', path: `${path}.parameters.snap`, message: 'Scene translation snap must be boolean.' })
  } else if (kind === 'aim_commit') {
    exactKeys(parameters, new Set(['arrow', 'coordinates', 'durationMs', 'easing', 'route', 'wormhole']), `${path}.parameters`, errors)
    if (parameters.route !== undefined && !['line', 'wormhole'].includes(parameters.route)) {
      errors.push({ code: 'invalid_aim_route', path: `${path}.parameters.route`, message: 'Scene aim-and-commit route is invalid.' })
    }
    if (parameters.coordinates !== undefined && parameters.coordinates !== 'world') errors.push({ code: 'invalid_response_coordinates', path: `${path}.parameters.coordinates`, message: 'Scene aim-and-commit coordinates must use world space.' })
    if (parameters.easing !== undefined && !['ease_in_out_cubic', 'ease_out_quart', 'linear', 'smoothstep'].includes(parameters.easing)) errors.push({ code: 'invalid_route_easing', path: `${path}.parameters.easing`, message: 'Scene route easing implementation is unavailable.' })
    if (parameters.durationMs !== undefined && (!Number.isFinite(parameters.durationMs) || parameters.durationMs < 50 || parameters.durationMs > 5000)) errors.push({ code: 'invalid_route_duration', path: `${path}.parameters.durationMs`, message: 'Scene route duration must be finite and bounded.' })
    if (parameters.arrow !== undefined) {
      const arrowPath = `${path}.parameters.arrow`
      const arrow = parameters.arrow
      if (!isRecord(arrow)) errors.push({ code: 'invalid_visual_style', path: arrowPath, message: 'Scene arrow style must be an object.' })
      else {
        exactKeys(arrow, new Set([
          'accentColor', 'color', 'dashColor', 'dashGap', 'dashLength', 'dashOpacity',
          'dashSpeed', 'dashWidth', 'glowColor', 'glowOpacity', 'glowWidth', 'headLength',
          'headLengthDistanceFactor', 'headLengthMax', 'headLengthMin', 'headWidth',
          'headWingRadians', 'originInset', 'originRingColor', 'originRingOpacity',
          'originRingRadius', 'pulseHz', 'reticleColor', 'reticlePulse', 'reticleRadius',
          'shaftWidth', 'trailCount', 'trailOpacity', 'trailSpacing',
        ]), arrowPath, errors)
        for (const key of [
          'accentColor', 'color', 'dashColor', 'glowColor', 'originRingColor', 'reticleColor',
        ]) if (arrow[key] !== undefined && !SAFE_COLOR.test(arrow[key])) errors.push({ code: 'invalid_color', path: `${arrowPath}.${key}`, message: 'Scene colors must use bounded hexadecimal notation.' })
        for (const [key, min, max] of [
          ['dashGap', 1, 128], ['dashLength', 1, 128], ['dashOpacity', 0, 1],
          ['dashSpeed', -512, 512], ['dashWidth', 1, 32], ['glowOpacity', 0, 1],
          ['glowWidth', 1, 64], ['headLength', 4, 128], ['headLengthDistanceFactor', 0, 1],
          ['headLengthMax', 4, 128], ['headLengthMin', 4, 128], ['headWidth', 4, 128],
          ['headWingRadians', 0.1, Math.PI], ['originInset', 0, 512],
          ['originRingOpacity', 0, 1], ['originRingRadius', 2, 512], ['pulseHz', 0, 20],
          ['reticlePulse', 0, 64], ['reticleRadius', 2, 512], ['shaftWidth', 1, 32],
          ['trailCount', 0, 16], ['trailOpacity', 0, 1], ['trailSpacing', 0, 1],
        ]) {
          const entry = arrow[key]
          if (entry !== undefined && (!Number.isFinite(entry) || entry < min || entry > max || (key === 'trailCount' && !Number.isInteger(entry)))) errors.push({ code: 'invalid_visual_style', path: `${arrowPath}.${key}`, message: 'Scene arrow style value must be finite and bounded.' })
        }
        if (
          Number.isFinite(arrow.headLengthMin)
          && Number.isFinite(arrow.headLengthMax)
          && arrow.headLengthMin > arrow.headLengthMax
        ) errors.push({ code: 'invalid_visual_style', path: `${arrowPath}.headLengthMin`, message: 'Scene arrow minimum head length cannot exceed its maximum.' })
      }
    }
    if (parameters.wormhole !== undefined) {
      const wormholePath = `${path}.parameters.wormhole`
      const wormhole = parameters.wormhole
      if (!isRecord(wormhole)) errors.push({ code: 'invalid_visual_style', path: wormholePath, message: 'Scene wormhole style must be an object.' })
      else {
        exactKeys(wormhole, new Set(['color', 'flash', 'ringRadius', 'spin']), wormholePath, errors)
        if (wormhole.color !== undefined && !SAFE_COLOR.test(wormhole.color)) errors.push({ code: 'invalid_color', path: `${wormholePath}.color`, message: 'Scene colors must use bounded hexadecimal notation.' })
        for (const [key, min, max] of [['flash', 0, 4], ['ringRadius', 8, 512], ['spin', -20, 20]]) {
          const entry = wormhole[key]
          if (entry !== undefined && (!Number.isFinite(entry) || entry < min || entry > max)) errors.push({ code: 'invalid_visual_style', path: `${wormholePath}.${key}`, message: 'Scene wormhole style value must be finite and bounded.' })
        }
      }
    }
  } else if (kind === 'drop') {
    exactKeys(parameters, new Set(), `${path}.parameters`, errors)
  } else if (kind === 'radial_menu') {
    errors.push(...validateSceneRadialMenuParameters(parameters, `${path}.parameters`))
  } else if (kind === 'signal_graph') {
    exactKeys(parameters, new Set(['offset', 'scale', 'signalId', 'signals', 'source']), `${path}.parameters`, errors)
    if (parameters.signals !== undefined) {
      if (!Array.isArray(parameters.signals) || parameters.signals.length > 32) {
        errors.push({ code: 'signal_count', path: `${path}.parameters.signals`, message: 'Scene signal response exceeds its signal limit.' })
      } else {
        parameters.signals.forEach((entry, index) => validateSignalDescriptor(entry, `${path}.parameters.signals.${index}`, errors))
      }
    } else {
      validateSignalDescriptor(parameters, `${path}.parameters`, errors)
    }
  }
}

export function validateSceneInteractionDocument(value, options = {}) {
  const errors = []
  if (!isRecord(value)) return { ok: false, errors: [{ code: 'invalid_interactions', path: 'interactions', message: 'Scene interactions must be an object.' }] }
  exactKeys(value, new Set(['affordances', 'contract', 'interactions', 'schemaVersion']), 'interactions', errors)
  if (value.contract !== SCENE_INTERACTIONS_CONTRACT_ID) errors.push({ code: 'contract_id', path: 'interactions.contract', message: `Interaction contract must be ${SCENE_INTERACTIONS_CONTRACT_ID}.` })
  if (value.schemaVersion !== 1) errors.push({ code: 'schema_version', path: 'interactions.schemaVersion', message: 'Interaction schema version must be 1.' })
  const objectIds = new Set(options.scene?.objects?.map((object) => object.id) ?? [])
  const affordanceIds = new Set()
  if (value.affordances !== undefined) {
    if (!Array.isArray(value.affordances) || value.affordances.length > SCENE_AFFORDANCE_LIMITS.maxAffordances) {
      errors.push({ code: 'affordance_count', path: 'interactions.affordances', message: 'Scene affordances exceed the engine limit.' })
    } else {
      value.affordances.forEach((affordance, index) => {
        const path = `interactions.affordances.${index}`
        const validation = validateSceneAffordanceDescriptor(affordance, { objectIds, path })
        errors.push(...validation.errors)
        if (affordanceIds.has(affordance?.id)) errors.push({ code: 'duplicate_affordance', path: `${path}.id`, message: 'Scene affordance IDs must be unique.' })
        affordanceIds.add(affordance?.id)
      })
    }
  }
  const maxInteractions = Math.min(256, Number.isInteger(options.maxInteractions) ? options.maxInteractions : 256)
  if (!Array.isArray(value.interactions) || value.interactions.length > maxInteractions) {
    errors.push({ code: 'interaction_count', path: 'interactions.interactions', message: 'Scene interactions exceed their declared budget.' })
    return { ok: false, errors }
  }
  const ids = new Set()
  for (const [index, interaction] of value.interactions.entries()) {
    const path = `interactions.interactions.${index}`
    if (!isRecord(interaction)) {
      errors.push({ code: 'invalid_interaction', path, message: 'Scene interactions must be objects.' })
      continue
    }
    exactKeys(interaction, new Set(['affordanceId', 'id', 'recognizer', 'response']), path, errors)
    if (!validId(interaction.id)) errors.push({ code: 'invalid_id', path: `${path}.id`, message: 'Scene interaction ID is invalid.' })
    if (!validId(interaction.affordanceId)) errors.push({ code: 'invalid_id', path: `${path}.affordanceId`, message: 'Scene interaction affordance ID is invalid.' })
    if (ids.has(interaction.id)) errors.push({ code: 'duplicate_interaction', path: `${path}.id`, message: 'Scene interaction IDs must be unique.' })
    ids.add(interaction.id)
    if (value.affordances !== undefined && !affordanceIds.has(interaction.affordanceId)) errors.push({ code: 'unknown_affordance', path: `${path}.affordanceId`, message: 'Scene interaction references an unknown affordance.' })
    validateInteractionImplementation(interaction.recognizer, `${path}.recognizer`, errors, new Set(RECOGNIZER_KIND_BY_IMPLEMENTATION.keys()))
    validateInteractionImplementation(interaction.response, `${path}.response`, errors, new Set(RESPONSE_KINDS.keys()))
    validateRecognizerParameters(interaction.recognizer, `${path}.recognizer`, errors)
    validateResponseParameters(interaction.response, `${path}.response`, errors)
  }
  return { ok: errors.length === 0, errors }
}

export function validateSceneAffordanceDescriptor(value, options = {}) {
  const errors = []
  const path = options.path ?? 'affordance'
  if (!isRecord(value)) return { ok: false, errors: [{ code: 'invalid_affordance', path, message: 'Scene affordances must be objects.' }] }
  exactKeys(value, new Set(['consumePolicy', 'enabled', 'geometry', 'id', 'metadata', 'objectId', 'priority']), path, errors)
  if (!validId(value.id)) errors.push({ code: 'invalid_id', path: `${path}.id`, message: 'Scene affordance ID is invalid.' })
  if (!validId(value.objectId)) errors.push({ code: 'invalid_id', path: `${path}.objectId`, message: 'Scene affordance object ID is invalid.' })
  if (options.objectIds && !options.objectIds.has(value.objectId)) errors.push({ code: 'unknown_affordance_object', path: `${path}.objectId`, message: 'Scene affordance references an unknown scene object.' })
  validateAffordanceGeometry(value.geometry, `${path}.geometry`, errors)
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') errors.push({ code: 'invalid_affordance_enabled', path: `${path}.enabled`, message: 'Scene affordance enabled must be boolean.' })
  if (!Number.isInteger(value.priority) || Math.abs(value.priority) > SCENE_AFFORDANCE_LIMITS.maxPriority) errors.push({ code: 'invalid_affordance_priority', path: `${path}.priority`, message: 'Scene affordance priority must be a bounded integer.' })
  if (!CONSUME_POLICIES.has(value.consumePolicy)) errors.push({ code: 'invalid_consume_policy', path: `${path}.consumePolicy`, message: 'Scene affordance consume policy is invalid.' })
  if (!isRecord(value.metadata) || Object.keys(value.metadata).length > 16) {
    errors.push({ code: 'invalid_affordance_metadata', path: `${path}.metadata`, message: 'Scene affordance metadata must be a bounded object.' })
  } else {
    for (const [key, entry] of Object.entries(value.metadata)) {
      if (!validId(key) || !['string', 'number', 'boolean'].includes(typeof entry) || (typeof entry === 'string' && entry.length > 256) || (typeof entry === 'number' && !Number.isFinite(entry))) {
        errors.push({ code: 'invalid_affordance_metadata', path: `${path}.metadata.${key}`, message: 'Scene affordance metadata values must be bounded primitives.' })
      }
    }
  }
  return { ok: errors.length === 0, errors }
}

function multiplyTransform(parent, local) {
  return {
    a: parent.a * local.a + parent.c * local.b,
    b: parent.b * local.a + parent.d * local.b,
    c: parent.a * local.c + parent.c * local.d,
    d: parent.b * local.c + parent.d * local.d,
    e: parent.a * local.e + parent.c * local.f + parent.e,
    f: parent.b * local.e + parent.d * local.f + parent.f,
  }
}

function objectLocalTransform(object) {
  const transform = object?.transform ?? {}
  const position = transform.position ?? [0, 0, 0]
  const rotation = transform.rotation ?? [0, 0, 0]
  const scale = transform.scale ?? [1, 1, 1]
  const radians = finite(rotation[2])
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const scaleX = finite(scale[0], 1)
  const scaleY = finite(scale[1], 1)
  return {
    a: cosine * scaleX,
    b: sine * scaleX,
    c: -sine * scaleY,
    d: cosine * scaleY,
    e: finite(position[0]),
    f: finite(position[1]),
  }
}

function sceneObjectTransform(document, objectId) {
  const objects = new Map(document?.objects?.map((object) => [object.id, object]) ?? [])
  const chain = []
  const visited = new Set()
  let current = objects.get(objectId)
  while (current) {
    if (visited.has(current.id)) throw new TypeError('Scene affordance object hierarchy contains a cycle.')
    visited.add(current.id)
    chain.push(current)
    current = current.parentId === null ? null : objects.get(current.parentId)
    if (chain.at(-1).parentId !== null && !current) throw new TypeError('Scene affordance object hierarchy is disconnected.')
  }
  if (chain.length === 0) throw new TypeError('Scene affordance references an unknown scene object.')
  return chain.reverse().reduce(
    (matrix, object) => multiplyTransform(matrix, objectLocalTransform(object)),
    { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
  )
}

function transformPoint(matrix, value) {
  return {
    x: matrix.a * value.x + matrix.c * value.y + matrix.e,
    y: matrix.b * value.x + matrix.d * value.y + matrix.f,
  }
}

function inverseLinearPoint(matrix, value) {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-9) {
    throw new TypeError('Scene interaction target has a non-invertible parent transform.')
  }
  return {
    x: (matrix.d * value.x - matrix.c * value.y) / determinant,
    y: (-matrix.b * value.x + matrix.a * value.y) / determinant,
  }
}

function parentLocalDelta(document, object, value) {
  if (!object?.parentId) return value
  return inverseLinearPoint(sceneObjectTransform(document, object.parentId), value)
}

function parentLocalPoint(document, object, value) {
  if (!object?.parentId) return value
  const matrix = sceneObjectTransform(document, object.parentId)
  return inverseLinearPoint(matrix, { x: value.x - matrix.e, y: value.y - matrix.f })
}

export function resolveSceneAffordanceFrame(document, descriptor) {
  const object = document?.objects?.find((entry) => entry.id === descriptor?.objectId)
  if (!object) throw new TypeError('Scene affordance references an unknown scene object.')
  const geometry = descriptor.geometry
  const offset = geometry.offset ?? [0, 0]
  const width = finite(geometry.width, 1, 1, SCENE_AFFORDANCE_LIMITS.maxExtent)
  const height = finite(geometry.height, 1, 1, SCENE_AFFORDANCE_LIMITS.maxExtent)
  const matrix = sceneObjectTransform(document, descriptor.objectId)
  const corners = [
    { x: offset[0] - width / 2, y: offset[1] - height / 2 },
    { x: offset[0] + width / 2, y: offset[1] - height / 2 },
    { x: offset[0] + width / 2, y: offset[1] + height / 2 },
    { x: offset[0] - width / 2, y: offset[1] + height / 2 },
  ].map((corner) => transformPoint(matrix, corner))
  const xs = corners.map((corner) => corner.x)
  const ys = corners.map((corner) => corner.y)
  const left = Math.min(...xs)
  const top = Math.min(...ys)
  return Object.freeze([
    left,
    top,
    Math.max(...xs) - left,
    Math.max(...ys) - top,
  ])
}

function recognizerKind(interaction) {
  return RECOGNIZER_KIND_BY_IMPLEMENTATION.get(interaction?.recognizer?.implementation) ?? null
}

function recognizerPriority(interaction) {
  const kind = recognizerKind(interaction)
  const explicit = interaction?.recognizer?.parameters?.priority
  return Number.isInteger(explicit) ? explicit : DEFAULT_RECOGNIZER_PRIORITY[kind] ?? 0
}

function sortedInteractions(interactions) {
  return [...interactions].sort((left, right) => {
    const priority = recognizerPriority(right) - recognizerPriority(left)
    return priority || left.id.localeCompare(right.id)
  })
}

function thresholdFor(interaction) {
  const configured = interaction?.recognizer?.parameters?.threshold
  return finite(configured, recognizerKind(interaction) === SCENE_GESTURE_KINDS.tap ? 6 : 4, 0, 256)
}

function holdFor(interaction) {
  return finite(interaction?.recognizer?.parameters?.holdMs, 500, 100, 10_000)
}

function buttonMatches(interaction, input) {
  const expected = interaction?.recognizer?.parameters?.button
  if (expected === undefined || expected === null) return true
  if (typeof expected === 'number') {
    const button = ['left', 'middle', 'right'][expected]
    return button ? input.button === button : false
  }
  return expected === input.button
}

function candidateClaims(interaction, session, at, ending = false) {
  if (!buttonMatches(interaction, session.input)) return false
  const kind = recognizerKind(interaction)
  const moved = distance(session.origin, session.current)
  if (kind === SCENE_GESTURE_KINDS.tap) return ending && moved <= thresholdFor(interaction)
  if (kind === SCENE_GESTURE_KINDS.longPress) return moved <= thresholdFor(interaction) && at - session.startedAt >= holdFor(interaction)
  if (kind === SCENE_GESTURE_KINDS.drag || kind === SCENE_GESTURE_KINDS.radial) return moved >= thresholdFor(interaction)
  return false
}

function syntheticInput(session, type, phase, current = session.current) {
  const source = session.rawInput?.routed_input ?? session.rawInput
  return {
    ...source,
    type,
    phase,
    desktop_world: clonePoint(current),
    buttons: type === 'left_mouse_up'
      ? { left: false, right: false, middle: false, other_pressed: [] }
      : source.buttons,
  }
}

function normalizedGesturePhase(frame) {
  if (frame.phase === 'move') return SCENE_GESTURE_PHASES.update
  return frame.phase
}

export function createSceneGestureArena({
  affordance,
  interactions = [],
  now = () => Date.now(),
  scheduleFrame = (callback) => queueMicrotask(callback),
  scheduleTimer = (callback, delay) => setTimeout(callback, delay),
  cancelTimer = (timer) => clearTimeout(timer),
  onFrame = () => {},
} = {}) {
  if (!affordance?.id) throw new TypeError('Scene gesture arena requires an affordance.')
  const candidates = sortedInteractions(interactions.filter((entry) => entry.affordanceId === affordance.id))
  if (candidates.length > SCENE_AFFORDANCE_LIMITS.maxRecognizersPerAffordance) throw new RangeError('Scene affordance has too many recognizers.')
  let session = null
  let scheduled = false
  let pendingMove = null
  let generation = 0
  let holdTimer = null

  function clearHoldTimer() {
    if (holdTimer === null) return
    cancelTimer(holdTimer)
    holdTimer = null
  }

  function scheduleLongPress(at) {
    clearHoldTimer()
    if (!session) return
    const holds = candidates.filter((entry) => (
      recognizerKind(entry) === SCENE_GESTURE_KINDS.longPress
      && buttonMatches(entry, session.input)
    ))
    if (holds.length === 0) return
    const delay = Math.max(0, Math.min(...holds.map((entry) => holdFor(entry) - (at - session.startedAt))))
    const expectedGeneration = generation
    holdTimer = scheduleTimer(() => {
      holdTimer = null
      if (expectedGeneration !== generation || !session || session.winner) return
      tick(now())
    }, delay)
  }

  function publish(frame, interaction) {
    const publishedFrame = recognizerKind(interaction) === SCENE_GESTURE_KINDS.radial
      ? withSceneRadialSelection(frame, interaction)
      : frame
    onFrame({
      ...publishedFrame,
      phase: normalizedGesturePhase(publishedFrame),
      affordanceId: affordance.id,
      interactionId: interaction.id,
      cancelReason: publishedFrame.cancel_reason ?? null,
    }, interaction)
  }

  function claim(interaction, at) {
    if (!session || session.winner) return false
    clearHoldTimer()
    const kind = recognizerKind(interaction)
    const stream = createPointerGestureStream({ kind })
    stream.subscribe((frame) => publish(frame, interaction))
    session.winner = interaction
    session.stream = stream
    session.claimedAt = at
    stream.handleCanvasInput(syntheticInput(session, 'left_mouse_down', 'down', session.origin), { now: at })
    if (distance(session.origin, session.current) > 0) pendingMove = { current: clonePoint(session.current), at }
    return true
  }

  function resolveWinner(at, ending = false) {
    if (!session || session.winner) return session?.winner ?? null
    const winner = candidates.find((interaction) => candidateClaims(interaction, session, at, ending)) ?? null
    if (winner) claim(winner, at)
    return winner
  }

  function flush() {
    scheduled = false
    const pending = pendingMove
    pendingMove = null
    if (!pending || !session?.stream) return false
    session.current = pending.current
    session.stream.handleCanvasInput(syntheticInput(session, 'left_mouse_dragged', 'drag', pending.current), { now: pending.at })
    return true
  }

  function requestFlush() {
    if (scheduled) return
    scheduled = true
    const expectedGeneration = generation
    scheduleFrame(() => {
      if (expectedGeneration === generation) flush()
    })
  }

  function finish(input, at) {
    if (!session) return false
    clearHoldTimer()
    const terminalCurrent = point(input.desktop_world ?? input.desktopWorld) ?? session.current
    resolveWinner(at, true)
    flush()
    session.current = terminalCurrent
    if (session.stream) session.stream.handleCanvasInput(syntheticInput(session, 'left_mouse_up', 'up'), { now: at })
    else cancel('recognizer_rejected', at)
    session?.stream?.destroy()
    session = null
    pendingMove = null
    generation += 1
    return true
  }

  function cancel(reason = 'pointer_cancelled', at = now()) {
    if (!session) return false
    clearHoldTimer()
    pendingMove = null
    session.stream?.cancel(reason, {}, { now: at })
    session.stream?.destroy()
    session = null
    generation += 1
    return true
  }

  function handle(message, options = {}) {
    const input = normalizeCanvasInputMessage(message)
    if (!input) return false
    const at = finite(options.now, now())
    if (input.eventKind === 'key' && input.type === 'key_down' && input.key?.logical === 'Escape') return cancel('escape', at)
    const current = point(input.desktop_world ?? input.desktopWorld)
    if (input.phase === 'down') {
      if (session || !current) return false
      generation += 1
      session = {
        generation,
        input,
        rawInput: message,
        origin: current,
        current,
        startedAt: at,
        winner: null,
        stream: null,
      }
      scheduleLongPress(at)
      return true
    }
    if (!session) return false
    if (current) session.current = current
    if (input.phase === 'drag' || input.phase === 'move') {
      resolveWinner(at)
      if (session.winner) {
        pendingMove = { current: clonePoint(session.current), at }
        requestFlush()
      }
      return true
    }
    if (input.phase === 'up') return finish(input, at)
    if (input.phase === 'cancel' || input.eventKind === 'cancel') return cancel(input.cancel_reason ?? 'pointer_cancelled', at)
    return false
  }

  function tick(at = now()) {
    if (!session || session.winner) return false
    const winner = resolveWinner(at)
    if (winner) requestFlush()
    return Boolean(winner)
  }

  return Object.freeze({
    handle,
    tick,
    flush,
    cancel,
    dispose(reason = 'stage_disposed') { return cancel(reason) },
    snapshot() {
      return Object.freeze({
        affordanceId: affordance.id,
        active: Boolean(session),
        interactionId: session?.winner?.id ?? null,
        interactionKind: session?.winner ? recognizerKind(session.winner) : null,
        pendingUpdate: Boolean(pendingMove),
        pointerSessionId: session?.input?.captureId ?? session?.input?.capture_id ?? null,
      })
    },
  })
}

function signalValues(parameters, frame) {
  const list = Array.isArray(parameters?.signals)
    ? parameters.signals
    : typeof parameters?.signalId === 'string'
      ? [{ signalId: parameters.signalId, source: 'distance' }]
      : []
  const total = frame.total_delta ?? { x: 0, y: 0 }
  const sources = {
    constant: 1,
    distance: Math.hypot(total.x ?? 0, total.y ?? 0),
    selection_active: Number.isInteger(frame.radial?.selectionIndex) ? 1 : 0,
    selection_index: Number.isInteger(frame.radial?.selectionIndex) ? frame.radial.selectionIndex : -1,
    x: total.x ?? 0,
    y: total.y ?? 0,
  }
  return list.slice(0, 32).flatMap((entry) => {
    if (!entry || typeof entry.signalId !== 'string') return []
    const source = sources[entry.source ?? 'constant']
    if (!Number.isFinite(source)) return []
    return [{
      signalId: entry.signalId,
      value: source * finite(entry.scale, 1, -1e6, 1e6) + finite(entry.offset, 0, -1e6, 1e6),
    }]
  })
}

function canonicalCancellationReason(value) {
  if (!value) return null
  if (SCENE_GESTURE_CANCELLATION_REASONS.includes(value)) return value
  if (value === 'owner_disconnected') return 'owner_disconnected'
  if (value === 'surface_removed') return 'resource_removed'
  if (value === 'surface_suspended') return 'resource_suspended'
  if (value === 'topology_stale') return 'topology_changed'
  return 'pointer_cancelled'
}

function publicAppliedResponse(resolved, applied) {
  if (!isRecord(applied)) return resolved
  const result = { ...resolved }
  if (typeof applied.applied === 'boolean') result.applied = applied.applied
  if (Number.isInteger(applied.revision) && applied.revision >= 0) result.revision = applied.revision
  if (resolved.kind === 'signal_graph' && Number.isInteger(applied.appliedSignals)) {
    result.appliedSignals = finite(applied.appliedSignals, 0, 0, 32)
  }
  return Object.freeze(result)
}

export function resolveSceneGestureResponse({ document, affordance, interaction, frame } = {}) {
  const kind = RESPONSE_KINDS.get(interaction?.response?.implementation)
  if (!kind) throw new TypeError('Scene interaction response implementation is unavailable.')
  const object = document?.objects?.find((entry) => entry.id === affordance?.objectId)
  if (!object) throw new TypeError('Scene interaction response target is unavailable.')
  const originPosition = object.transform?.position ?? [0, 0, 0]
  const total = frame.total_delta ?? { x: 0, y: 0 }
  const current = frame.current ?? frame.origin ?? { x: 0, y: 0 }
  if (kind === 'translate') {
    const axis = interaction.response.parameters?.axis ?? 'both'
    const worldDelta = {
      x: axis === 'y' ? 0 : finite(total.x),
      y: axis === 'x' ? 0 : finite(total.y),
    }
    const localDelta = parentLocalDelta(document, object, worldDelta)
    return Object.freeze({
      kind,
      objectId: affordance.objectId,
      position: [originPosition[0] + localDelta.x, originPosition[1] + localDelta.y, originPosition[2] ?? 0],
    })
  }
  if (kind === 'aim_commit') {
    const routeOrigin = transformPoint(sceneObjectTransform(document, affordance.objectId), { x: 0, y: 0 })
    const targetPosition = parentLocalPoint(document, object, current)
    return Object.freeze({
      kind,
      objectId: affordance.objectId,
      origin: routeOrigin,
      pointer: clonePoint(current),
      position: [targetPosition.x, targetPosition.y, originPosition[2] ?? 0],
      angle: angle(routeOrigin, current),
      distance: distance(routeOrigin, current),
      route: interaction.response.parameters?.route ?? 'line',
    })
  }
  if (kind === 'drop') return Object.freeze({ kind, objectId: affordance.objectId, point: clonePoint(current) })
  if (kind === 'radial_menu') return resolveSceneRadialMenuResponse({ frame, interaction })
  return Object.freeze({ kind, signals: signalValues(interaction.response.parameters, frame) })
}

export function createSceneEventEnvelope({ identity, frame, response, sequence, topology = null, at = Date.now() } = {}) {
  return Object.freeze({
    contract: SCENE_EVENT_CONTRACT_ID,
    schemaVersion: 1,
    type: 'gesture',
    sequence,
    stageId: identity.stageId,
    ownerId: identity.ownerId,
    resourceId: identity.resourceId,
    affordanceId: frame.affordanceId,
    interactionId: frame.interactionId,
    gesture: Object.freeze({
      id: frame.gesture_id,
      kind: frame.gesture_type,
      phase: frame.phase,
      pointerSessionId: frame.pointer?.capture_id ?? null,
      cancellationReason: canonicalCancellationReason(frame.cancelReason),
    }),
    coordinates: Object.freeze({
      origin: clonePoint(frame.origin),
      previous: clonePoint(frame.previous),
      current: clonePoint(frame.current),
      desktopWorld: clonePoint(frame.coordinates?.desktop_world ?? frame.current),
      native: clonePoint(frame.coordinates?.native),
      delta: clonePoint(frame.delta),
      totalDelta: clonePoint(frame.total_delta),
    }),
    topology,
    response,
    at,
  })
}

export function createSceneInteractionController({
  identity,
  document,
  interactions,
  topology = () => null,
  now = () => Date.now(),
  scheduleFrame,
  scheduleTimer,
  cancelTimer,
  onResponse = () => null,
  onEvent = () => {},
} = {}) {
  if (!identity?.stageId || !identity?.ownerId || !identity?.resourceId) throw new TypeError('Scene interaction controller requires lease identity.')
  const getDocument = typeof document === 'function' ? document : () => document
  const getTopology = typeof topology === 'function' ? topology : () => topology
  const validation = validateSceneInteractionDocument(interactions, { scene: getDocument() })
  if (!validation.ok) throw new TypeError(validation.errors[0]?.message || 'Invalid scene interaction document.')
  let sequence = 0
  let disposed = false
  const affordances = new Map((interactions.affordances ?? []).map((entry) => [entry.id, entry]))
  const arenas = new Map()

  function handleFrame(frame, interaction) {
    if (disposed) return
    const affordance = affordances.get(frame.affordanceId)
    const resolved = resolveSceneGestureResponse({ document: getDocument(), affordance, interaction, frame })
    const applied = onResponse({ affordance, document: getDocument(), frame, interaction, response: resolved })
    const response = publicAppliedResponse(resolved, applied)
    sequence += 1
    onEvent(createSceneEventEnvelope({
      identity,
      frame,
      response,
      sequence,
      topology: getTopology(),
      at: frame.timing?.t ?? now(),
    }))
  }

  for (const affordance of affordances.values()) {
    if (affordance.enabled === false) continue
    arenas.set(affordance.id, createSceneGestureArena({
      affordance,
      interactions: interactions.interactions,
      now,
      scheduleFrame,
      scheduleTimer,
      cancelTimer,
      onFrame: handleFrame,
    }))
  }

  return Object.freeze({
    affordances() {
      return [...affordances.values()].filter((entry) => entry.enabled !== false).map((entry) => Object.freeze({
        descriptor: entry,
        frame: resolveSceneAffordanceFrame(getDocument(), entry),
      }))
    },
    handle(affordanceId, message, options) {
      if (disposed) return false
      return arenas.get(affordanceId)?.handle(message, options) ?? false
    },
    tick(at = now()) {
      if (disposed) return false
      return [...arenas.values()].map((arena) => arena.tick(at)).some(Boolean)
    },
    cancel(reason = 'resource_removed', at = now()) {
      return [...arenas.values()].map((arena) => arena.cancel(reason, at)).some(Boolean)
    },
    dispose(reason = 'stage_disposed') {
      if (disposed) return false
      disposed = true
      for (const arena of arenas.values()) arena.dispose(reason)
      arenas.clear()
      return true
    },
    snapshot() {
      return Object.freeze({
        affordances: [...arenas.values()].map((arena) => arena.snapshot()),
        disposed,
        identity: { ...identity },
        sequence,
      })
    },
  })
}
