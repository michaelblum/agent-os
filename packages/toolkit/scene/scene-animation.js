import { canonicalizeSceneDocument, validateSceneDocument } from './scene-document.js'

export const SCENE_ANIMATION_BINDING_IMPLEMENTATION_ID = 'aos.scene.animation.bind'

const SAFE_TARGET = /^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*){0,7}$/u
const PLAYBACK_MODES = new Set(['once', 'loop', 'ping_pong'])
const EASING_MODES = new Set(['linear', 'ease_in_out'])
const BINDING_KEYS = new Set([
  'delayMs',
  'durationMs',
  'easing',
  'from',
  'playback',
  'target',
  'to',
])

function addError(errors, code, path, message) {
  errors.push({ code, path, message })
}

function parseBinding(component, objectId, path, errors) {
  const parameters = component.parameters
  for (const key of Object.keys(parameters)) {
    if (!BINDING_KEYS.has(key)) {
      addError(errors, 'animation_unknown_field', `${path}.parameters.${key}`, 'Unknown animation binding field.')
    }
  }
  const {
    target,
    from,
    to,
    durationMs,
    delayMs = 0,
    playback = 'once',
    easing = 'linear',
  } = parameters
  if (typeof target !== 'string' || !SAFE_TARGET.test(target)) {
    addError(errors, 'animation_target', `${path}.parameters.target`, 'Animation binding target is invalid.')
  }
  for (const [key, value] of Object.entries({ from, to, durationMs, delayMs })) {
    if (!Number.isFinite(value)) {
      addError(errors, 'animation_number', `${path}.parameters.${key}`, 'Animation binding values must be finite.')
    }
  }
  if (Number.isFinite(durationMs) && (durationMs <= 0 || durationMs > 600_000)) {
    addError(errors, 'animation_duration', `${path}.parameters.durationMs`, 'Animation duration must be greater than 0 and at most 600000 ms.')
  }
  if (Number.isFinite(delayMs) && (delayMs < 0 || delayMs > 600_000)) {
    addError(errors, 'animation_delay', `${path}.parameters.delayMs`, 'Animation delay must be between 0 and 600000 ms.')
  }
  if (!PLAYBACK_MODES.has(playback)) {
    addError(errors, 'animation_playback', `${path}.parameters.playback`, 'Animation playback mode is invalid.')
  }
  if (!EASING_MODES.has(easing)) {
    addError(errors, 'animation_easing', `${path}.parameters.easing`, 'Animation easing mode is invalid.')
  }
  if (errors.some((error) => error.path.startsWith(path))) return null
  return Object.freeze({
    id: `${objectId}/${component.id}`,
    objectId,
    componentId: component.id,
    target,
    from,
    to,
    durationMs,
    delayMs,
    playback,
    easing,
  })
}

export function compileSceneAnimationBindings(documentInput, options = {}) {
  const validation = validateSceneDocument(documentInput)
  if (!validation.ok) return { ok: false, bindings: [], errors: validation.errors }
  const document = canonicalizeSceneDocument(documentInput)
  const maxBindings = Number.isInteger(options.maxBindings) && options.maxBindings >= 0
    ? options.maxBindings
    : 1024
  const bindings = []
  const errors = []
  for (const [objectIndex, object] of document.objects.entries()) {
    for (const [componentIndex, component] of object.components.entries()) {
      if (!component.enabled || component.implementation !== SCENE_ANIMATION_BINDING_IMPLEMENTATION_ID) continue
      if (bindings.length >= maxBindings) {
        addError(errors, 'animation_binding_count', 'objects', 'Scene animation bindings exceed the host budget.')
        return { ok: false, bindings: [], errors }
      }
      const binding = parseBinding(
        component,
        object.id,
        `objects.${objectIndex}.components.${componentIndex}`,
        errors,
      )
      if (binding) bindings.push(binding)
    }
  }
  return { ok: errors.length === 0, bindings, errors }
}

function playbackProgress(binding, elapsedMs) {
  if (elapsedMs <= binding.delayMs) return 0
  const cycles = (elapsedMs - binding.delayMs) / binding.durationMs
  if (binding.playback === 'once') return Math.min(1, cycles)
  const cycle = Math.floor(cycles)
  const progress = cycles - cycle
  return binding.playback === 'ping_pong' && cycle % 2 === 1 ? 1 - progress : progress
}

function ease(mode, progress) {
  return mode === 'ease_in_out'
    ? progress * progress * (3 - 2 * progress)
    : progress
}

export function createSceneAnimationController(documentInput, options = {}) {
  if (typeof options.apply !== 'function') {
    throw new TypeError('Scene animation controllers require an apply callback.')
  }
  const compiled = compileSceneAnimationBindings(documentInput, options)
  if (!compiled.ok) throw new TypeError(compiled.errors[0]?.message || 'Invalid scene animation bindings.')
  let disposed = false
  let frames = 0
  let failures = 0
  const completedOnceBindings = new Set()
  return Object.freeze({
    tick(elapsedMs) {
      if (disposed || !Number.isFinite(elapsedMs) || elapsedMs < 0) return 0
      let applied = 0
      for (const binding of compiled.bindings) {
        if (binding.playback === 'once' && completedOnceBindings.has(binding.id)) continue
        const progress = ease(binding.easing, playbackProgress(binding, elapsedMs))
        const value = binding.from + (binding.to - binding.from) * progress
        try {
          if (options.apply(binding, value, elapsedMs, progress) === false) {
            failures += 1
            continue
          }
          applied += 1
          if (binding.playback === 'once' && progress >= 1 && !completedOnceBindings.has(binding.id)) {
            completedOnceBindings.add(binding.id)
            options.onComplete?.(binding, value, elapsedMs)
          }
        } catch {
          failures += 1
        }
      }
      if (applied > 0) frames += 1
      return applied
    },
    snapshot() {
      return {
        bindings: compiled.bindings.map(({ id, objectId, componentId, target, playback }) => ({
          id,
          objectId,
          componentId,
          target,
          playback,
        })),
        disposed,
        completed: completedOnceBindings.size,
        failures,
        frames,
      }
    },
    restart() {
      if (disposed) return false
      completedOnceBindings.clear()
      return true
    },
    dispose() {
      if (disposed) return false
      disposed = true
      return true
    },
  })
}
