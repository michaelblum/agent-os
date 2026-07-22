import {
  cloneRadialMenuConfig,
  radialMenuGeometryConfig,
  resolveRadialMenuConfig,
} from '../runtime/radial-menu-config.js'
import { isSceneRecord } from './scene-contract-primitives.js'
import {
  SCENE_RADIAL_MENU_LIMITS,
  normalizeSceneRadialMenuParameters,
  validateSceneRadialMenuParameters,
} from './scene-radial-menu.js'

export const SCENE_RADIAL_MENU_AUTHORING_CONTRACT_ID = 'aos.scene.radial-menu-authoring.v1'
export const SCENE_RADIAL_MENU_AUTHORING_LIMITS = Object.freeze({
  maxDefinitionBytes: 256 * 1024,
  maxDepth: 32,
  maxItems: SCENE_RADIAL_MENU_LIMITS.maxItems,
  maxNodes: 4096,
})

const UTF8_ENCODER = new TextEncoder()

const SCENE_PROJECTION_KEYS = new Set([
  'closeOnSelect',
  'radius',
  'spreadDegrees',
  'startAngle',
  'style',
])

const VISUAL_ITEM_OMISSIONS = new Set([
  'action',
  'action_payload',
  'close_on_select',
  'logical',
  'role',
  'shortcut',
  'submenu_ref',
  'target_surface',
  'typeahead',
])

const VISUAL_DEFINITION_OMISSIONS = new Set([
  'close_on_select',
  'extends',
  'logical_items',
  'preferred_initial_item',
  'role',
  'typeahead',
  'validation',
])

function error(code, path, message) {
  return Object.freeze({ code, path, message })
}

function projectionErrors(value) {
  if (value === undefined) return []
  if (!isSceneRecord(value)) {
    return [error(
      'invalid_scene_projection',
      'definition.scene',
      'Radial-menu scene projection must be an object.',
    )]
  }
  return Object.keys(value).flatMap((key) => (
    SCENE_PROJECTION_KEYS.has(key)
      ? []
      : [error(
          'unknown_scene_projection_field',
          `definition.scene.${key}`,
          `Unknown radial-menu scene projection field ${key}.`,
        )]
  ))
}

function itemLimitErrors(items, path = 'definition.items') {
  if (!Array.isArray(items)) return []
  if (items.length > SCENE_RADIAL_MENU_AUTHORING_LIMITS.maxItems) {
    return [error(
      'radial_menu_item_limit',
      path,
      'Radial-menu definition exceeds its item limit.',
    )]
  }
  for (let index = 0; index < items.length; index += 1) {
    const nested = itemLimitErrors(items[index]?.children, `${path}.${index}.children`)
    if (nested.length > 0) return nested
  }
  return []
}

function definitionErrors(value) {
  if (!isSceneRecord(value)) {
    return [error(
      'invalid_radial_menu_definition',
      'definition',
      'Radial-menu definition must be an object.',
    )]
  }
  const itemErrors = itemLimitErrors(value.items)
  if (itemErrors.length > 0) return itemErrors

  const seen = new WeakSet()
  const pending = [{ depth: 0, value }]
  let nodes = 0
  try {
    while (pending.length > 0) {
      const current = pending.pop()
      if (current.value === null || typeof current.value === 'string' || typeof current.value === 'boolean') continue
      if (typeof current.value === 'number') {
        if (Number.isFinite(current.value)) continue
        return [error(
          'invalid_radial_menu_definition',
          'definition',
          'Radial-menu definition must contain only finite JSON values.',
        )]
      }
      if (typeof current.value !== 'object') {
        return [error(
          'invalid_radial_menu_definition',
          'definition',
          'Radial-menu definition must contain only inert JSON values.',
        )]
      }
      if (!Array.isArray(current.value) && !isSceneRecord(current.value)) {
        return [error(
          'invalid_radial_menu_definition',
          'definition',
          'Radial-menu definition must contain only JSON objects and arrays.',
        )]
      }
      if (seen.has(current.value)) {
        return [error(
          'radial_menu_definition_cycle',
          'definition',
          'Radial-menu definition must be acyclic JSON data.',
        )]
      }
      seen.add(current.value)
      nodes += 1
      if (nodes > SCENE_RADIAL_MENU_AUTHORING_LIMITS.maxNodes) {
        return [error(
          'radial_menu_node_limit',
          'definition',
          'Radial-menu definition exceeds its node limit.',
        )]
      }
      if (current.depth > SCENE_RADIAL_MENU_AUTHORING_LIMITS.maxDepth) {
        return [error(
          'radial_menu_depth_limit',
          'definition',
          'Radial-menu definition exceeds its depth limit.',
        )]
      }
      const descriptors = Object.getOwnPropertyDescriptors(current.value)
      const symbolKeys = Object.getOwnPropertySymbols(current.value)
      if (symbolKeys.length > 0 || Object.values(descriptors).some((descriptor) => (
        typeof descriptor.get === 'function' || typeof descriptor.set === 'function'
      ))) {
        return [error(
          'invalid_radial_menu_definition',
          'definition',
          'Radial-menu definition must not contain accessors or symbol keys.',
        )]
      }
      const values = Object.entries(descriptors)
        .filter(([key, descriptor]) => key !== 'length' && descriptor.enumerable)
        .map(([, descriptor]) => descriptor.value)
      for (const entry of values) pending.push({ depth: current.depth + 1, value: entry })
    }

    const bytes = UTF8_ENCODER.encode(JSON.stringify(value)).byteLength
    if (bytes > SCENE_RADIAL_MENU_AUTHORING_LIMITS.maxDefinitionBytes) {
      return [error(
        'radial_menu_byte_limit',
        'definition',
        'Radial-menu definition exceeds its byte limit.',
      )]
    }
  } catch {
    return [error(
      'invalid_radial_menu_definition',
      'definition',
      'Radial-menu definition must be inert JSON data.',
    )]
  }
  return []
}

function deepFreezeJson(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const entry of Array.isArray(value) ? value : Object.values(value)) deepFreezeJson(entry)
  return Object.freeze(value)
}

function visualItem(item) {
  const next = {}
  for (const [key, value] of Object.entries(item)) {
    if (VISUAL_ITEM_OMISSIONS.has(key) || value === undefined) continue
    next[key] = key === 'children' && Array.isArray(value)
      ? value.map(visualItem)
      : cloneRadialMenuConfig(value)
  }
  return next
}

function visualDefinition(definition) {
  const next = cloneRadialMenuConfig(definition)
  for (const key of VISUAL_DEFINITION_OMISSIONS) delete next[key]
  if (isSceneRecord(next.defaults?.item)) next.defaults.item = visualItem(next.defaults.item)
  next.items = definition.items.map(visualItem)
  return next
}

function visibleItems(definition) {
  return definition.items
    .filter((item) => item.hidden !== true)
    .map((item) => Object.freeze({
      id: item.id,
      label: item.label,
      ...(typeof item.color === 'string' ? { color: item.color } : {}),
      disabled: item.disabled === true,
    }))
}

function sceneParameters(definition) {
  const projection = isSceneRecord(definition.scene) ? definition.scene : {}
  const geometry = isSceneRecord(definition.geometry) ? definition.geometry : {}
  return {
    menuId: definition.id,
    items: visibleItems(definition),
    closeOnSelect: projection.closeOnSelect ?? definition.close_on_select !== false,
    radius: projection.radius ?? 108,
    spreadDegrees: projection.spreadDegrees ?? geometry.spreadDegrees ?? 360,
    startAngle: projection.startAngle ?? geometry.startAngle ?? -90,
    ...(projection.style === undefined ? {} : { style: projection.style }),
  }
}

function prepare(definition, options) {
  const preflight = definitionErrors(definition)
  if (preflight.length > 0) {
    return { errors: preflight, parameters: null, resolved: null }
  }
  const inherited = options?.base
    ?? (typeof definition.extends === 'string'
      && Object.hasOwn(options?.allowExtends ?? {}, definition.extends)
      ? options.allowExtends[definition.extends]
      : null)
  if (definition.extends !== undefined && typeof definition.extends !== 'string') {
    return {
      errors: [error(
        'invalid_radial_menu_base',
        'definition.extends',
        'Radial-menu base references must be strings.',
      )],
      parameters: null,
      resolved: null,
    }
  }
  if (typeof definition.extends === 'string' && inherited === null) {
    return {
      errors: [error(
        'unknown_radial_menu_base',
        'definition.extends',
        `Unknown radial-menu base ${definition.extends}.`,
      )],
      parameters: null,
      resolved: null,
    }
  }
  if (inherited !== null && inherited !== undefined) {
    const inheritedErrors = definitionErrors(inherited)
    if (inheritedErrors.length > 0) {
      return {
        errors: inheritedErrors.map((entry) => error(
          entry.code,
          entry.path.replace(/^definition/u, 'options.base'),
          entry.message,
        )),
        parameters: null,
        resolved: null,
      }
    }
  }
  let resolved
  try {
    resolved = resolveRadialMenuConfig(definition, options)
  } catch (cause) {
    return {
      errors: [error(
        'invalid_radial_menu_definition',
        'definition',
        cause instanceof Error ? cause.message : 'Radial-menu definition is invalid.',
      )],
      parameters: null,
      resolved: null,
    }
  }

  let resolvedJson
  try {
    resolvedJson = JSON.parse(JSON.stringify(resolved))
  } catch {
    return {
      errors: [error(
        'invalid_radial_menu_definition',
        'definition',
        'Resolved radial-menu definition must remain inert JSON data.',
      )],
      parameters: null,
      resolved: null,
    }
  }
  const resolvedErrors = definitionErrors(resolvedJson)
  if (resolvedErrors.length > 0) {
    return { errors: resolvedErrors, parameters: null, resolved: null }
  }

  const parameters = sceneParameters(resolvedJson)
  const errors = [
    ...projectionErrors(resolvedJson.scene),
    ...validateSceneRadialMenuParameters(parameters, 'definition.scene'),
  ]
  return { errors, parameters, resolved: resolvedJson }
}

export function validateSceneRadialMenuAuthoringDefinition(definition, options = {}) {
  const prepared = prepare(definition, options)
  return Object.freeze({
    ok: prepared.errors.length === 0,
    errors: Object.freeze(prepared.errors),
  })
}

export function compileSceneRadialMenuDefinition(definition, options = {}) {
  const prepared = prepare(definition, options)
  if (prepared.errors.length > 0) {
    const failure = new TypeError(prepared.errors[0].message)
    Object.defineProperties(failure, {
      code: { enumerable: true, value: 'SCENE_RADIAL_MENU_AUTHORING_INVALID' },
      errors: { enumerable: true, value: Object.freeze(prepared.errors) },
    })
    throw failure
  }

  const parameters = Object.freeze({
    ...prepared.parameters,
    items: Object.freeze(prepared.parameters.items),
    ...(prepared.parameters.style === undefined
      ? {}
      : { style: Object.freeze({ ...prepared.parameters.style }) }),
  })
  return Object.freeze({
    contract: SCENE_RADIAL_MENU_AUTHORING_CONTRACT_ID,
    parameters,
    runtimeProjection: normalizeSceneRadialMenuParameters(parameters),
    gestureProjection: deepFreezeJson(radialMenuGeometryConfig(prepared.resolved)),
    logicalItems: deepFreezeJson(prepared.resolved.logical_items.map(cloneRadialMenuConfig)),
    visualDefinition: deepFreezeJson(visualDefinition(prepared.resolved)),
  })
}
