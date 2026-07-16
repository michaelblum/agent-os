import { canonicalizeSceneDocument, validateSceneDocument } from './scene-document.js'
import { SCENE_ANIMATION_BINDING_IMPLEMENTATION_ID } from './scene-animation.js'
import { SCENE_SIGNAL_BINDING_IMPLEMENTATION_ID } from './scene-signal.js'

export const SCENE_IMPLEMENTATION_KINDS = Object.freeze([
  'component',
  'effect',
  'geometry',
  'material',
  'shader',
  'texture',
])

const IMPLEMENTATION_ID = /^[a-z][a-z0-9]*(?:[._/-][a-z0-9]+)*$/u
const IMPLEMENTATION_KIND_SET = new Set(SCENE_IMPLEMENTATION_KINDS)

function normalizeEntry(input, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Scene implementation entries must be objects.')
  }
  if (typeof input.id !== 'string' || !IMPLEMENTATION_ID.test(input.id)) {
    throw new TypeError('Scene implementation IDs must be bounded registry identifiers.')
  }
  if (!IMPLEMENTATION_KIND_SET.has(input.kind)) {
    throw new TypeError(`Unsupported scene implementation kind ${String(input.kind)}.`)
  }
  if (!options.builtin && typeof input.create !== 'function') {
    throw new TypeError('Scene implementations require a trusted create function.')
  }
  for (const key of ['update', 'dispose']) {
    if (input[key] !== undefined && typeof input[key] !== 'function') {
      throw new TypeError(`Scene implementation ${key} must be a function when provided.`)
    }
  }
  return Object.freeze({
    id: input.id,
    kind: input.kind,
    builtin: Boolean(options.builtin),
    create: input.create ?? null,
    update: input.update ?? null,
    dispose: input.dispose ?? null,
  })
}

function requiredEntries(document) {
  return [
    ...document.resources.map((resource) => ({
      id: resource.implementation,
      kind: resource.kind,
      sourceId: resource.id,
      sourceKind: 'resource',
    })),
    ...document.objects.flatMap((object) => object.components.map((component) => ({
      id: component.implementation,
      kind: 'component',
      sourceId: `${object.id}/${component.id}`,
      sourceKind: 'component',
    }))),
  ]
}

export function createSceneImplementationRegistry(input = {}) {
  const entries = new Map()
  entries.set(SCENE_ANIMATION_BINDING_IMPLEMENTATION_ID, normalizeEntry({
    id: SCENE_ANIMATION_BINDING_IMPLEMENTATION_ID,
    kind: 'component',
  }, { builtin: true }))
  entries.set(SCENE_SIGNAL_BINDING_IMPLEMENTATION_ID, normalizeEntry({
    id: SCENE_SIGNAL_BINDING_IMPLEMENTATION_ID,
    kind: 'component',
  }, { builtin: true }))

  const api = {
    register(entryInput) {
      const entry = normalizeEntry(entryInput)
      if (entries.has(entry.id)) {
        throw new TypeError(`Scene implementation ${entry.id} is already registered.`)
      }
      entries.set(entry.id, entry)
      return entry
    },
    unregister(id) {
      const entry = entries.get(id)
      if (!entry || entry.builtin) return false
      return entries.delete(id)
    },
    resolve(id, expectedKind = null) {
      const entry = entries.get(id) ?? null
      if (!entry || (expectedKind && entry.kind !== expectedKind)) return null
      return entry
    },
    validateDocument(documentInput) {
      const validation = validateSceneDocument(documentInput)
      if (!validation.ok) {
        return { ok: false, errors: validation.errors, missing: [], mismatched: [] }
      }
      const document = canonicalizeSceneDocument(documentInput)
      const missing = []
      const mismatched = []
      for (const required of requiredEntries(document)) {
        const entry = entries.get(required.id)
        if (!entry) missing.push(required)
        else if (entry.kind !== required.kind) {
          mismatched.push({ ...required, registeredKind: entry.kind })
        }
      }
      return {
        ok: missing.length === 0 && mismatched.length === 0,
        errors: [],
        missing,
        mismatched,
      }
    },
    required(documentInput) {
      return requiredEntries(canonicalizeSceneDocument(documentInput))
    },
    snapshot() {
      return {
        count: entries.size,
        implementations: [...entries.values()]
          .map(({ id, kind, builtin }) => ({ id, kind, builtin }))
          .sort((left, right) => left.id.localeCompare(right.id)),
      }
    },
  }
  for (const entry of input.entries ?? []) api.register(entry)
  return Object.freeze(api)
}
