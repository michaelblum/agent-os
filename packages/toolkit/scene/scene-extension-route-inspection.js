const ROUTE_KEYS = new Set(['active', 'destination', 'kind', 'origin', 'progress'])
const ROUTE_KINDS = new Set(['line', 'wormhole'])
const MAX_COORDINATE = 1e9

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`)
  }
  const prototype = Object.getPrototypeOf(value)
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const actual = Object.keys(descriptors)
  if (
    (prototype !== Object.prototype && prototype !== null)
    || Object.getOwnPropertySymbols(value).length > 0
    || actual.length !== expected.size
    || actual.some((key) => !expected.has(key))
    || [...expected].some((key) => !Object.hasOwn(value, key))
    || actual.some((key) => (
      descriptors[key].enumerable !== true
      || !Object.hasOwn(descriptors[key], 'value')
    ))
  ) {
    throw new TypeError(`${label} contains invalid fields.`)
  }
}

function point2(value, label) {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new TypeError(`${label} must contain exactly two bounded finite coordinates.`)
  }
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const names = Object.keys(descriptors).sort()
  if (
    Object.getOwnPropertySymbols(value).length > 0
    || names.length !== 3
    || names[0] !== '0'
    || names[1] !== '1'
    || names[2] !== 'length'
  ) {
    throw new TypeError(`${label} must contain exactly two bounded finite coordinates.`)
  }
  for (let index = 0; index < 2; index += 1) {
    const descriptor = descriptors[String(index)]
    const entry = descriptor?.value
    if (
      descriptor?.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')
      || !Number.isFinite(entry)
      || entry < -MAX_COORDINATE
      || entry > MAX_COORDINATE
    ) {
      throw new TypeError(`${label} must contain exactly two bounded finite coordinates.`)
    }
  }
  return Object.freeze([
    descriptors['0'].value,
    descriptors['1'].value,
  ])
}

export function normalizeSceneExtensionInteractionRouteState(value) {
  if (value === null) return null
  exactKeys(value, ROUTE_KEYS, 'Scene extension interaction route')
  if (typeof value.active !== 'boolean') {
    throw new TypeError('Scene extension interaction route active must be boolean.')
  }
  if (!ROUTE_KINDS.has(value.kind)) {
    throw new TypeError('Scene extension interaction route kind must be line or wormhole.')
  }
  if (
    !Number.isFinite(value.progress)
    || value.progress < 0
    || value.progress > 1
  ) {
    throw new TypeError('Scene extension interaction route progress must be between zero and one.')
  }
  return Object.freeze({
    active: value.active,
    destination: point2(value.destination, 'Scene extension interaction route destination'),
    kind: value.kind,
    origin: point2(value.origin, 'Scene extension interaction route origin'),
    progress: value.progress,
  })
}
