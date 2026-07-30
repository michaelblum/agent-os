import { isSceneRecord } from './scene-contract-primitives.js'

export const SCENE_RENDER_PASS_KINDS = Object.freeze([
  'orthographic_overlay',
  'perspective_resource',
])

export const DEFAULT_SCENE_RENDER_PASS = Object.freeze({
  kind: 'orthographic_overlay',
})

const PERSPECTIVE_CAMERA_KEYS = new Set([
  'far',
  'fovYDegrees',
  'near',
  'targetZ',
])
const RENDER_PASS_KEYS = new Set(['camera', 'kind'])

function error(code, path, message) {
  return { code, path, message }
}

function exactKeys(value, allowed, path, errors) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      errors.push(error('unknown_field', `${path}.${key}`, `Unknown scene render-pass field ${key}.`))
    }
  }
}

function boundedNumber(value, minimum, maximum, path, errors) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    errors.push(error(
      'invalid_render_camera',
      path,
      `Scene perspective camera values must be finite and between ${minimum} and ${maximum}.`,
    ))
    return false
  }
  return true
}

export function sceneRenderPassValidationErrors(value, path = 'renderPass') {
  const errors = []
  if (!isSceneRecord(value)) {
    return [error('invalid_render_pass', path, 'Scene render pass must be an object.')]
  }
  exactKeys(value, RENDER_PASS_KEYS, path, errors)
  if (!SCENE_RENDER_PASS_KINDS.includes(value.kind)) {
    errors.push(error('invalid_render_pass', `${path}.kind`, 'Scene render-pass kind is not supported.'))
    return errors
  }
  if (value.kind === 'orthographic_overlay') {
    if (Object.hasOwn(value, 'camera')) {
      errors.push(error(
        'invalid_render_camera',
        `${path}.camera`,
        'Orthographic overlay passes do not declare a perspective camera.',
      ))
    }
    return errors
  }
  if (!isSceneRecord(value.camera)) {
    errors.push(error(
      'invalid_render_camera',
      `${path}.camera`,
      'Perspective resource passes require a bounded camera profile.',
    ))
    return errors
  }
  exactKeys(value.camera, PERSPECTIVE_CAMERA_KEYS, `${path}.camera`, errors)
  boundedNumber(value.camera.fovYDegrees, 10, 120, `${path}.camera.fovYDegrees`, errors)
  const nearValid = boundedNumber(value.camera.near, 0.01, 10_000, `${path}.camera.near`, errors)
  const farValid = boundedNumber(value.camera.far, 1, 1_000_000, `${path}.camera.far`, errors)
  boundedNumber(value.camera.targetZ, -100_000, 100_000, `${path}.camera.targetZ`, errors)
  if (nearValid && farValid && value.camera.far <= value.camera.near) {
    errors.push(error(
      'invalid_render_camera',
      `${path}.camera.far`,
      'Scene perspective camera far must exceed near.',
    ))
  }
  return errors
}

export function validateSceneRenderPass(value) {
  const errors = sceneRenderPassValidationErrors(value)
  return { ok: errors.length === 0, errors }
}

export function resolveSceneRenderPass(document) {
  const value = document?.renderPass ?? DEFAULT_SCENE_RENDER_PASS
  const validation = validateSceneRenderPass(value)
  if (!validation.ok) throw new TypeError(validation.errors[0]?.message || 'Invalid scene render pass.')
  if (value.kind === 'orthographic_overlay') return DEFAULT_SCENE_RENDER_PASS
  return Object.freeze({
    kind: value.kind,
    camera: Object.freeze({ ...value.camera }),
  })
}

function finiteBounds(value) {
  if (!Array.isArray(value) || value.length < 4) return null
  const bounds = value.slice(0, 4).map(Number)
  if (!bounds.every(Number.isFinite) || bounds[2] <= 0 || bounds[3] <= 0) return null
  return bounds
}

function segmentBounds(segment) {
  return finiteBounds(segment?.dw_bounds ?? segment?.dwBounds ?? segment)
}

function segmentIdentity(segment) {
  if (!isSceneRecord(segment)) return null
  for (const key of ['display_id', 'displayId', 'id']) {
    const value = segment[key]
    if (typeof value === 'string' || typeof value === 'number') {
      return `${typeof value}:${value}`
    }
  }
  return null
}

function sameBounds(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export function derivePerspectiveResourceCamera(topology, segment, profile) {
  const renderPass = resolveSceneRenderPass({ renderPass: {
    kind: 'perspective_resource',
    camera: profile,
  } })
  if (!Array.isArray(topology) || topology.length === 0) return null
  const segments = topology.map(segmentBounds)
  const active = segmentBounds(segment)
  if (!active || segments.some((bounds) => bounds === null)) return null
  const activeIdentity = segmentIdentity(segment)
  const activeMembers = topology.filter((candidate, index) => {
    const bounds = segments[index]
    if (!bounds || !sameBounds(bounds, active)) return false
    const candidateIdentity = segmentIdentity(candidate)
    return activeIdentity === null
      ? candidateIdentity === null
      : candidateIdentity === activeIdentity
  })
  if (activeMembers.length !== 1) return null
  const left = Math.min(...segments.map((bounds) => bounds[0]))
  const top = Math.min(...segments.map((bounds) => bounds[1]))
  const right = Math.max(...segments.map((bounds) => bounds[0] + bounds[2]))
  const bottom = Math.max(...segments.map((bounds) => bounds[1] + bounds[3]))
  const width = right - left
  const height = bottom - top
  if (!(width > 0) || !(height > 0)) return null
  const fovRadians = renderPass.camera.fovYDegrees * Math.PI / 180
  const distance = height / (2 * Math.tan(fovRadians / 2))
  if (distance <= renderPass.camera.near || distance >= renderPass.camera.far) return null
  const centerX = left + width / 2
  const centerY = top + height / 2
  return Object.freeze({
    aspect: width / height,
    far: renderPass.camera.far,
    fovYDegrees: renderPass.camera.fovYDegrees,
    near: renderPass.camera.near,
    // Looking toward +Z with a -Y up vector preserves DesktopWorld's native
    // rightward/downward axes without reflecting either screen coordinate.
    position: Object.freeze([centerX, centerY, renderPass.camera.targetZ - distance]),
    target: Object.freeze([centerX, centerY, renderPass.camera.targetZ]),
    up: Object.freeze([0, -1, 0]),
    viewOffset: Object.freeze({
      fullWidth: width,
      fullHeight: height,
      offsetX: active[0] - left,
      offsetY: active[1] - top,
      width: active[2],
      height: active[3],
    }),
    worldBounds: Object.freeze([left, top, width, height]),
  })
}
