import { canonicalizeSceneDocument, validateSceneDocument } from './scene-document.js'

export const SCENE_SIGNAL_BINDING_IMPLEMENTATION_ID = 'aos.scene.signal.bind'

const SAFE_SIGNAL_ID = /^[a-z][a-z0-9]*(?:[._/-][a-z0-9]+)*$/u
const SAFE_TARGET = /^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*){0,7}$/u
const BINDING_KEYS = new Set([
  'clamp',
  'inputMax',
  'inputMin',
  'outputMax',
  'outputMin',
  'signalId',
  'smoothingMs',
  'target',
])

function addError(errors, code, path, message) {
  errors.push({ code, path, message })
}

function finiteOrDefault(value, fallback) {
  return value === undefined ? fallback : value
}

function parseBinding(component, objectId, path, errors) {
  const parameters = component.parameters
  for (const key of Object.keys(parameters)) {
    if (!BINDING_KEYS.has(key)) {
      addError(errors, 'signal_unknown_field', `${path}.parameters.${key}`, 'Unknown signal binding field.')
    }
  }
  const signalId = parameters.signalId
  const target = parameters.target
  const inputMin = finiteOrDefault(parameters.inputMin, 0)
  const inputMax = finiteOrDefault(parameters.inputMax, 1)
  const outputMin = finiteOrDefault(parameters.outputMin, 0)
  const outputMax = finiteOrDefault(parameters.outputMax, 1)
  const smoothingMs = finiteOrDefault(parameters.smoothingMs, 0)
  const clamp = parameters.clamp === undefined ? true : parameters.clamp
  if (typeof signalId !== 'string' || !SAFE_SIGNAL_ID.test(signalId)) {
    addError(errors, 'signal_id', `${path}.parameters.signalId`, 'Signal binding requires a bounded signal ID.')
  }
  if (typeof target !== 'string' || !SAFE_TARGET.test(target)) {
    addError(errors, 'signal_target', `${path}.parameters.target`, 'Signal binding target is invalid.')
  }
  for (const [key, value] of Object.entries({ inputMin, inputMax, outputMin, outputMax, smoothingMs })) {
    if (!Number.isFinite(value)) {
      addError(errors, 'signal_number', `${path}.parameters.${key}`, 'Signal binding values must be finite.')
    }
  }
  if (Number.isFinite(inputMin) && Number.isFinite(inputMax) && inputMax <= inputMin) {
    addError(errors, 'signal_input_range', `${path}.parameters.inputMax`, 'Signal inputMax must exceed inputMin.')
  }
  if (Number.isFinite(smoothingMs) && (smoothingMs < 0 || smoothingMs > 60_000)) {
    addError(errors, 'signal_smoothing', `${path}.parameters.smoothingMs`, 'Signal smoothing must be between 0 and 60000 ms.')
  }
  if (typeof clamp !== 'boolean') {
    addError(errors, 'signal_clamp', `${path}.parameters.clamp`, 'Signal clamp must be boolean.')
  }
  if (errors.some((error) => error.path.startsWith(path))) return null
  return Object.freeze({
    id: `${objectId}/${component.id}`,
    objectId,
    componentId: component.id,
    signalId,
    target,
    inputMin,
    inputMax,
    outputMin,
    outputMax,
    smoothingMs,
    clamp,
  })
}

export function compileSceneSignalBindings(documentInput, options = {}) {
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
      if (!component.enabled || component.implementation !== SCENE_SIGNAL_BINDING_IMPLEMENTATION_ID) continue
      if (bindings.length >= maxBindings) {
        addError(errors, 'signal_binding_count', 'objects', 'Scene signal bindings exceed the host budget.')
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

function mapSignalValue(binding, input) {
  const ratio = (input - binding.inputMin) / (binding.inputMax - binding.inputMin)
  const boundedRatio = binding.clamp ? Math.min(1, Math.max(0, ratio)) : ratio
  return binding.outputMin + boundedRatio * (binding.outputMax - binding.outputMin)
}

export function createSceneSignalController(documentInput, options = {}) {
  if (typeof options.apply !== 'function') {
    throw new TypeError('Scene signal controllers require an apply callback.')
  }
  const compiled = compileSceneSignalBindings(documentInput, options)
  if (!compiled.ok) throw new TypeError(compiled.errors[0]?.message || 'Invalid scene signal bindings.')
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const previous = new Map()
  let disposed = false
  let failures = 0
  let publications = 0
  return Object.freeze({
    publish(signalId, input, at = now()) {
      if (disposed || typeof signalId !== 'string' || !SAFE_SIGNAL_ID.test(signalId)) return 0
      if (!Number.isFinite(input) || !Number.isFinite(at)) return 0
      let applied = 0
      for (const binding of compiled.bindings) {
        if (binding.signalId !== signalId) continue
        const mapped = mapSignalValue(binding, input)
        const prior = previous.get(binding.id)
        const effectiveAt = prior ? Math.max(at, prior.at) : at
        const elapsed = prior ? effectiveAt - prior.at : binding.smoothingMs
        const alpha = binding.smoothingMs > 0
          ? 1 - Math.exp(-elapsed / binding.smoothingMs)
          : 1
        const value = prior ? prior.value + (mapped - prior.value) * alpha : mapped
        try {
          options.apply(binding, value, input, effectiveAt)
          previous.set(binding.id, { at: effectiveAt, value })
          applied += 1
        } catch {
          failures += 1
        }
      }
      if (applied > 0) publications += 1
      return applied
    },
    snapshot() {
      return {
        bindings: compiled.bindings.map(({ id, objectId, componentId, signalId, target }) => ({
          id,
          objectId,
          componentId,
          signalId,
          target,
        })),
        disposed,
        failures,
        publications,
      }
    },
    dispose() {
      if (disposed) return false
      disposed = true
      previous.clear()
      return true
    },
  })
}
