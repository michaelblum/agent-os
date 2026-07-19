import { SCENE_AFFORDANCE_LIMITS } from './scene-interaction-contract.js'
import { sceneFinite as finite } from './scene-contract-primitives.js'

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

export function sceneObjectTransform(document, objectId) {
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

export function transformPoint(matrix, value) {
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

export function parentLocalDelta(document, object, value) {
  if (!object?.parentId) return value
  return inverseLinearPoint(sceneObjectTransform(document, object.parentId), value)
}

export function parentLocalPoint(document, object, value) {
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
