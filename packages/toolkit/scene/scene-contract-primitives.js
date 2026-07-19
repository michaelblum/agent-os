const SAFE_SCENE_ID = /^[a-z0-9](?:[a-z0-9._/-]{0,126}[a-z0-9])?$/u

export function isSceneRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  try {
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  } catch {
    return false
  }
}

export function isCanonicalSceneId(value) {
  return hasCanonicalScenePathSegments(value) && matchesSceneIdSyntax(value)
}

export function matchesSceneIdSyntax(value) {
  return typeof value === 'string' && SAFE_SCENE_ID.test(value)
}

export function hasCanonicalScenePathSegments(value) {
  return typeof value === 'string'
    && !value.includes('//')
    && !value.split('/').some((part) => !part || part === '.' || part === '..')
}

export function sceneFinite(value, fallback = 0, min = -Infinity, max = Infinity) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

export function scenePoint(value) {
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)) return null
  return { x: value.x, y: value.y }
}

export function cloneScenePoint(value) {
  const resolved = scenePoint(value)
  return resolved ? { ...resolved } : null
}

export function scenePointDistance(origin, current) {
  if (!origin || !current) return 0
  return Math.hypot(current.x - origin.x, current.y - origin.y)
}

export function scenePointAngle(origin, current) {
  if (!origin || !current) return 0
  return Math.atan2(current.y - origin.y, current.x - origin.x)
}
