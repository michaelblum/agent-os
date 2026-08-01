import { validateSceneRadialMenuParameters } from './scene-radial-menu.js'
import {
  isCanonicalSceneId as validId,
  isSceneRecord as isRecord,
} from './scene-contract-primitives.js'
import {
  SCENE_NATIVE_EFFECT_PROGRAM_IMPLEMENTATION,
  SCENE_NATIVE_EFFECT_PROGRAM_LIMITS,
  validateSceneNativeEffectParameters,
  validateSceneNativeEffectProgram,
} from './scene-native-effect-program.js'

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

export const SCENE_NATIVE_EFFECT_IMPLEMENTATIONS = Object.freeze({
  desktopRipple: 'aos.scene.effect.desktop-ripple',
  program: SCENE_NATIVE_EFFECT_PROGRAM_IMPLEMENTATION,
})

export const SCENE_NATIVE_EFFECT_BINDING_LIMITS = Object.freeze({
  maxBindingsPerDocument: 256,
  maxBindingsPerInteraction: 5,
})

export const SCENE_NATIVE_EFFECT_LIFECYCLES = Object.freeze({
  gesture: 'gesture',
  timed: 'timed',
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

export const SCENE_AFFORDANCE_CURSOR_STYLES = Object.freeze({
  none: 'none',
})

export const SCENE_AFFORDANCE_SYSTEM_CURSOR_STYLES = Object.freeze({
  hidden: 'hidden',
  inherit: 'inherit',
})

const CONSUME_POLICIES = new Set(['always', 'captured', 'down_only', 'never'])
const CAPTURED_CURSOR_STYLES = new Set(Object.values(SCENE_AFFORDANCE_CURSOR_STYLES))
const SYSTEM_CURSOR_STYLES = new Set(Object.values(SCENE_AFFORDANCE_SYSTEM_CURSOR_STYLES))
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
function exactKeys(value, allowed, path, errors) {
  if (!isRecord(value)) return
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push({ code: 'unknown_field', path: `${path}.${key}`, message: `Unknown scene interaction field ${key}.` })
  }
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

function validateCursorPresentation(value, path, errors) {
  if (!isRecord(value)) {
    errors.push({ code: 'invalid_affordance_cursor', path, message: 'Scene cursor presentation must be an object.' })
    return
  }
  exactKeys(value, new Set(['system', 'visual']), path, errors)
  if (!SYSTEM_CURSOR_STYLES.has(value.system)) {
    errors.push({ code: 'invalid_affordance_cursor', path: `${path}.system`, message: 'Scene system cursor policy is invalid.' })
  }
  if (value.visual !== undefined && !validId(value.visual)) {
    errors.push({ code: 'invalid_affordance_cursor', path: `${path}.visual`, message: 'Scene cursor visual ID is invalid.' })
  }
  if (value.visual !== undefined && value.system !== SCENE_AFFORDANCE_SYSTEM_CURSOR_STYLES.hidden) {
    errors.push({ code: 'invalid_affordance_cursor', path, message: 'Scene cursor visuals require the system cursor to be hidden.' })
  }
}

function validateAffordanceCursor(value, path, errors) {
  if (value === undefined) return
  if (!isRecord(value)) {
    errors.push({ code: 'invalid_affordance_cursor', path, message: 'Scene affordance cursor policy must be an object.' })
    return
  }
  exactKeys(value, new Set(['captured', 'hover']), path, errors)
  if (value.hover !== undefined) validateCursorPresentation(value.hover, `${path}.hover`, errors)
  if (CAPTURED_CURSOR_STYLES.has(value.captured)) return
  if (value.captured !== undefined) validateCursorPresentation(value.captured, `${path}.captured`, errors)
  if (value.hover === undefined && value.captured === undefined) {
    errors.push({ code: 'invalid_affordance_cursor', path, message: 'Scene affordance cursor policy must define hover or captured presentation.' })
  }
}

export function resolveSceneAffordanceCursorPresentation(descriptor, phase) {
  const value = descriptor?.cursor?.[phase]
  if (phase === 'captured' && CAPTURED_CURSOR_STYLES.has(value)) {
    return Object.freeze({ system: SCENE_AFFORDANCE_SYSTEM_CURSOR_STYLES.hidden, visual: null })
  }
  if (!isRecord(value) || !SYSTEM_CURSOR_STYLES.has(value.system)) {
    return Object.freeze({ system: SCENE_AFFORDANCE_SYSTEM_CURSOR_STYLES.inherit, visual: null })
  }
  return Object.freeze({
    system: value.system,
    visual: validId(value.visual) ? value.visual : null,
  })
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

function validateNativeEffect(value, path, errors, programs) {
  if (!isRecord(value)) {
    errors.push({ code: 'invalid_native_effect', path, message: 'Scene native effects require an implementation, trigger, and parameters.' })
    return
  }
  const programEffect = value.implementation === SCENE_NATIVE_EFFECT_PROGRAM_IMPLEMENTATION
  exactKeys(value, programEffect
    ? new Set(['implementation', 'lifecycle', 'parameters', 'programId', 'trigger'])
    : new Set(['implementation', 'lifecycle', 'parameters', 'trigger']), path, errors)
  if (!Object.values(SCENE_NATIVE_EFFECT_IMPLEMENTATIONS).includes(value.implementation)) {
    errors.push({ code: 'unknown_implementation', path: `${path}.implementation`, message: 'Scene native effect implementation is not registered.' })
  }
  if (!isRecord(value.trigger)) {
    errors.push({ code: 'invalid_native_effect_trigger', path: `${path}.trigger`, message: 'Scene native effect trigger must be an object.' })
  } else {
    const keys = Object.keys(value.trigger)
    const gesturePhase = keys.length === 1 && keys[0] === 'phase'
    const pointerInput = keys.includes('input')
      && keys.every((key) => ['button', 'input'].includes(key))
      && keys.length <= 2
    if (!gesturePhase && !pointerInput) {
      errors.push({ code: 'invalid_native_effect_trigger', path: `${path}.trigger`, message: 'Scene native effect triggers require exactly one input or gesture phase.' })
    } else if (gesturePhase && !['end', 'start'].includes(value.trigger.phase)) {
      errors.push({ code: 'invalid_native_effect_trigger', path: `${path}.trigger.phase`, message: 'Scene native effects may trigger on gesture start or end.' })
    } else if (pointerInput && value.trigger.input !== 'pointer_down') {
      errors.push({ code: 'invalid_native_effect_trigger', path: `${path}.trigger.input`, message: 'Scene native input effects may trigger only on pointer down.' })
    } else if (pointerInput && value.trigger.button !== undefined
      && !['left', 'middle', 'right'].includes(value.trigger.button)) {
      errors.push({ code: 'invalid_native_effect_trigger', path: `${path}.trigger.button`, message: 'Scene native pointer effects require a supported button.' })
    }
  }
  if (value.lifecycle !== undefined) {
    if (!isRecord(value.lifecycle)) {
      errors.push({ code: 'invalid_native_effect_lifecycle', path: `${path}.lifecycle`, message: 'Scene native effect lifecycle must be an object.' })
    } else {
      exactKeys(value.lifecycle, new Set(['kind']), `${path}.lifecycle`, errors)
      if (!Object.values(SCENE_NATIVE_EFFECT_LIFECYCLES).includes(value.lifecycle.kind)) {
        errors.push({ code: 'invalid_native_effect_lifecycle', path: `${path}.lifecycle.kind`, message: 'Scene native effect lifecycle kind is unsupported.' })
      } else if (value.lifecycle.kind === SCENE_NATIVE_EFFECT_LIFECYCLES.gesture
        && value.trigger?.phase !== 'start') {
        errors.push({ code: 'invalid_native_effect_lifecycle', path: `${path}.lifecycle`, message: 'Gesture-owned native effects must trigger on gesture start.' })
      }
    }
  }
  if (!isRecord(value.parameters)) {
    errors.push({ code: 'invalid_parameters', path: `${path}.parameters`, message: 'Scene native effect parameters must be an object.' })
    return
  }
  if (programEffect) {
    if (!validId(value.programId) || !programs.has(value.programId)) {
      errors.push({ code: 'unknown_native_effect_program', path: `${path}.programId`, message: 'Scene native effect binding references an unknown program.' })
    } else {
      const parameterResult = validateSceneNativeEffectParameters(programs.get(value.programId), value.parameters, `${path}.parameters`)
      errors.push(...parameterResult.errors)
    }
    return
  }
  exactKeys(value.parameters, new Set([
    'amplitude', 'decay', 'durationMs', 'frequency', 'radius', 'speed',
  ]), `${path}.parameters`, errors)
  for (const [key, min, max] of [
    ['amplitude', 0, 96],
    ['decay', 0, 10],
    ['durationMs', 100, 3000],
    ['frequency', 0.001, 0.25],
    ['radius', 32, 5000],
    ['speed', 10, 4000],
  ]) {
    const entry = value.parameters[key]
    if (entry !== undefined && (
      !Number.isFinite(entry)
      || entry < min
      || entry > max
      || (key === 'durationMs' && !Number.isInteger(entry))
    )) {
      errors.push({ code: 'invalid_native_effect_parameter', path: `${path}.parameters.${key}`, message: 'Scene native effect parameters must be finite and bounded.' })
    }
  }
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
  exactKeys(value, new Set(['affordances', 'contract', 'interactions', 'nativeEffectPrograms', 'schemaVersion']), 'interactions', errors)
  if (value.contract !== SCENE_INTERACTIONS_CONTRACT_ID) errors.push({ code: 'contract_id', path: 'interactions.contract', message: `Interaction contract must be ${SCENE_INTERACTIONS_CONTRACT_ID}.` })
  if (value.schemaVersion !== 1) errors.push({ code: 'schema_version', path: 'interactions.schemaVersion', message: 'Interaction schema version must be 1.' })
  const objectIds = new Set(options.scene?.objects?.map((object) => object.id) ?? [])
  const programs = new Map()
  if (value.nativeEffectPrograms !== undefined) {
    if (!Array.isArray(value.nativeEffectPrograms) || value.nativeEffectPrograms.length > SCENE_NATIVE_EFFECT_PROGRAM_LIMITS.maxPrograms) {
      errors.push({ code: 'native_effect_program_count', path: 'interactions.nativeEffectPrograms', message: 'Scene native effect programs exceed the engine limit.' })
    } else {
      value.nativeEffectPrograms.forEach((program, index) => {
        const validation = validateSceneNativeEffectProgram(program)
        errors.push(...validation.errors.map((error) => ({
          ...error,
          path: `interactions.nativeEffectPrograms.${index}.${error.path.replace(/^program\.?/u, '')}`,
        })))
        if (programs.has(program?.id)) errors.push({ code: 'duplicate_native_effect_program', path: `interactions.nativeEffectPrograms.${index}.id`, message: 'Scene native effect program IDs must be unique.' })
        if (validation.ok) programs.set(program.id, program)
      })
    }
  }
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
  const nativeTriggerKeys = new Set()
  let nativeBindingCount = 0
  for (const [index, interaction] of value.interactions.entries()) {
    const path = `interactions.interactions.${index}`
    if (!isRecord(interaction)) {
      errors.push({ code: 'invalid_interaction', path, message: 'Scene interactions must be objects.' })
      continue
    }
    exactKeys(interaction, new Set(['affordanceId', 'id', 'nativeEffect', 'nativeEffects', 'recognizer', 'response']), path, errors)
    if (!validId(interaction.id)) errors.push({ code: 'invalid_id', path: `${path}.id`, message: 'Scene interaction ID is invalid.' })
    if (!validId(interaction.affordanceId)) errors.push({ code: 'invalid_id', path: `${path}.affordanceId`, message: 'Scene interaction affordance ID is invalid.' })
    if (ids.has(interaction.id)) errors.push({ code: 'duplicate_interaction', path: `${path}.id`, message: 'Scene interaction IDs must be unique.' })
    ids.add(interaction.id)
    if (value.affordances !== undefined && !affordanceIds.has(interaction.affordanceId)) errors.push({ code: 'unknown_affordance', path: `${path}.affordanceId`, message: 'Scene interaction references an unknown affordance.' })
    validateInteractionImplementation(interaction.recognizer, `${path}.recognizer`, errors, new Set(RECOGNIZER_KIND_BY_IMPLEMENTATION.keys()))
    validateInteractionImplementation(interaction.response, `${path}.response`, errors, new Set(RESPONSE_KINDS.keys()))
    validateRecognizerParameters(interaction.recognizer, `${path}.recognizer`, errors)
    validateResponseParameters(interaction.response, `${path}.response`, errors)
    if (interaction.nativeEffect !== undefined && interaction.nativeEffects !== undefined) {
      errors.push({ code: 'native_effect_binding_shape', path, message: 'Scene interactions cannot declare both nativeEffect and nativeEffects.' })
    }
    const nativeEffects = interaction.nativeEffects !== undefined
      ? interaction.nativeEffects
      : interaction.nativeEffect !== undefined
        ? [interaction.nativeEffect]
        : []
    if (!Array.isArray(nativeEffects) || nativeEffects.length > SCENE_NATIVE_EFFECT_BINDING_LIMITS.maxBindingsPerInteraction || (interaction.nativeEffects !== undefined && nativeEffects.length < 1)) {
      errors.push({ code: 'native_effect_binding_count', path: `${path}.nativeEffects`, message: 'Scene interaction native effects must be a non-empty bounded array.' })
      continue
    }
    nativeBindingCount += nativeEffects.length
    if (nativeBindingCount > SCENE_NATIVE_EFFECT_BINDING_LIMITS.maxBindingsPerDocument) {
      errors.push({ code: 'native_effect_binding_count', path: `${path}.nativeEffects`, message: 'Scene interaction document native effects exceed the engine limit.' })
    }
    for (const [effectIndex, nativeEffect] of nativeEffects.entries()) {
      const effectPath = interaction.nativeEffects !== undefined
        ? `${path}.nativeEffects.${effectIndex}`
        : `${path}.nativeEffect`
      validateNativeEffect(nativeEffect, effectPath, errors, programs)
      const trigger = nativeEffect?.trigger
      const triggerKey = trigger?.input === 'pointer_down'
        ? `${interaction.affordanceId}:input:pointer_down:${trigger.button ?? 'left'}`
        : ['end', 'start'].includes(trigger?.phase)
          ? `${interaction.affordanceId}:gesture:${trigger.phase}`
          : null
      if (triggerKey && nativeTriggerKeys.has(triggerKey)) {
        errors.push({ code: 'duplicate_native_effect_trigger', path: `${effectPath}.trigger`, message: 'An affordance may declare only one native effect for each trigger.' })
      } else if (triggerKey) nativeTriggerKeys.add(triggerKey)
    }
  }
  return { ok: errors.length === 0, errors }
}

export function validateSceneAffordanceDescriptor(value, options = {}) {
  const errors = []
  const path = options.path ?? 'affordance'
  if (!isRecord(value)) return { ok: false, errors: [{ code: 'invalid_affordance', path, message: 'Scene affordances must be objects.' }] }
  exactKeys(value, new Set(['consumePolicy', 'cursor', 'enabled', 'geometry', 'id', 'metadata', 'objectId', 'priority']), path, errors)
  if (!validId(value.id)) errors.push({ code: 'invalid_id', path: `${path}.id`, message: 'Scene affordance ID is invalid.' })
  if (!validId(value.objectId)) errors.push({ code: 'invalid_id', path: `${path}.objectId`, message: 'Scene affordance object ID is invalid.' })
  if (options.objectIds && !options.objectIds.has(value.objectId)) errors.push({ code: 'unknown_affordance_object', path: `${path}.objectId`, message: 'Scene affordance references an unknown scene object.' })
  validateAffordanceGeometry(value.geometry, `${path}.geometry`, errors)
  validateAffordanceCursor(value.cursor, `${path}.cursor`, errors)
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


export function sceneRecognizerKind(interaction) {
  return RECOGNIZER_KIND_BY_IMPLEMENTATION.get(interaction?.recognizer?.implementation) ?? null
}

export function sceneResponseKind(interaction) {
  return RESPONSE_KINDS.get(interaction?.response?.implementation) ?? null
}
