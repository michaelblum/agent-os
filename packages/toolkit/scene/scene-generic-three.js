import { createSceneImplementationRegistry } from './scene-registry.js'

export const GENERIC_SCENE_IMPLEMENTATIONS = Object.freeze({
  primitiveGeometry: 'aos.scene.geometry.primitive',
  nestedShellGeometry: 'aos.scene.geometry.nested-shell',
  surfaceMaterial: 'aos.scene.material.surface',
  lineMaterial: 'aos.scene.material.line',
  pointMaterial: 'aos.scene.material.point',
  transform: 'aos.scene.component.transform',
  aura: 'aos.scene.effect.aura',
  beamField: 'aos.scene.effect.beam-field',
  ringField: 'aos.scene.effect.ring-field',
  pointJet: 'aos.scene.effect.point-jet',
  swarm: 'aos.scene.effect.swarm',
  branchingLines: 'aos.scene.effect.branching-lines',
  fieldLines: 'aos.scene.effect.field-lines',
  pathTrail: 'aos.scene.effect.path-trail',
  lineTravel: 'aos.scene.effect.line-travel',
  tunnel: 'aos.scene.effect.tunnel',
  radialBurst: 'aos.scene.effect.radial-burst',
})

const EFFECT_IDS = new Set(Object.values(GENERIC_SCENE_IMPLEMENTATIONS).filter((id) => id.includes('.effect.')))
const PRIMITIVES = new Set(['box', 'sphere', 'tetrahedron', 'octahedron', 'icosahedron', 'torus', 'torus-knot'])

function finite(value, fallback = 0, min = -1e6, max = 1e6) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

function color(value, fallback = 0xffffff) {
  return typeof value === 'string' || Number.isInteger(value) ? value : fallback
}

function validatePrimitive(parameters) {
  return parameters && PRIMITIVES.has(parameters.primitive) ? true : 'unsupported_primitive'
}

function validateBoundedCount(parameters) {
  return Number.isInteger(parameters?.count) && parameters.count >= 0 && parameters.count <= 1024
    ? true
    : 'count_out_of_bounds'
}

export function createGenericSceneImplementationRegistry() {
  const registry = createSceneImplementationRegistry()
  registry.register({ id: GENERIC_SCENE_IMPLEMENTATIONS.primitiveGeometry, kind: 'geometry', create: () => null, validateParameters: validatePrimitive })
  registry.register({ id: GENERIC_SCENE_IMPLEMENTATIONS.nestedShellGeometry, kind: 'geometry', create: () => null, validateParameters: (parameters) => Number.isInteger(parameters?.shells) && parameters.shells >= 1 && parameters.shells <= 16 ? true : 'shell_count_out_of_bounds' })
  for (const id of [GENERIC_SCENE_IMPLEMENTATIONS.surfaceMaterial, GENERIC_SCENE_IMPLEMENTATIONS.lineMaterial, GENERIC_SCENE_IMPLEMENTATIONS.pointMaterial]) {
    registry.register({ id, kind: 'material', create: () => null })
  }
  registry.register({ id: GENERIC_SCENE_IMPLEMENTATIONS.transform, kind: 'component', create: () => null })
  for (const id of EFFECT_IDS) registry.register({ id, kind: 'effect', create: () => null, validateParameters: validateBoundedCount })
  return registry
}

function geometryFor(THREE, descriptor) {
  const p = descriptor.parameters ?? {}
  if (descriptor.implementation === GENERIC_SCENE_IMPLEMENTATIONS.nestedShellGeometry) {
    return new THREE.BoxGeometry(finite(p.size, 1, 0.01, 100), finite(p.size, 1, 0.01, 100), finite(p.size, 1, 0.01, 100), 1, 1, 1)
  }
  const radius = finite(p.radius, 1, 0.01, 100)
  const detail = Math.round(finite(p.detail, 1, 0, 5))
  switch (p.primitive) {
    case 'sphere': return new THREE.SphereGeometry(radius, 24, 16)
    case 'tetrahedron': return new THREE.TetrahedronGeometry(radius, detail)
    case 'octahedron': return new THREE.OctahedronGeometry(radius, detail)
    case 'icosahedron': return new THREE.IcosahedronGeometry(radius, detail)
    case 'torus': return new THREE.TorusGeometry(radius, finite(p.tube, 0.18, 0.01, radius), 12, 48)
    case 'torus-knot': return new THREE.TorusKnotGeometry(radius, finite(p.tube, 0.12, 0.01, radius), 64, 12)
    default: {
      const size = finite(p.size, radius * 2, 0.01, 100)
      return new THREE.BoxGeometry(size, size, size)
    }
  }
}

function materialFor(THREE, descriptor) {
  const p = descriptor.parameters ?? {}
  const common = {
    color: color(p.color),
    opacity: finite(p.opacity, 1, 0, 1),
    transparent: finite(p.opacity, 1, 0, 1) < 1,
  }
  if (descriptor.implementation === GENERIC_SCENE_IMPLEMENTATIONS.lineMaterial) {
    return new THREE.LineBasicMaterial(common)
  }
  if (descriptor.implementation === GENERIC_SCENE_IMPLEMENTATIONS.pointMaterial) {
    return new THREE.PointsMaterial({ ...common, size: finite(p.size, 0.035, 0.001, 2), sizeAttenuation: true })
  }
  return new THREE.MeshStandardMaterial({
    ...common,
    emissive: color(p.emissive, 0x000000),
    emissiveIntensity: finite(p.emissiveIntensity, 0, 0, 20),
    metalness: finite(p.metalness, 0.35, 0, 1),
    roughness: finite(p.roughness, 0.35, 0, 1),
    wireframe: Boolean(p.wireframe),
  })
}

function effectObject(THREE, descriptor) {
  const p = descriptor.parameters ?? {}
  const count = Math.round(finite(p.count, 64, 0, 1024))
  const positions = new Float32Array(count * 3)
  const radius = finite(p.radius, 1.4, 0.01, 100)
  for (let index = 0; index < count; index += 1) {
    const t = count <= 1 ? 0 : index / (count - 1)
    const angle = t * Math.PI * 2 * finite(p.turns, 3, 0.1, 32)
    positions[index * 3] = Math.cos(angle) * radius * (0.35 + t * 0.65)
    positions[index * 3 + 1] = (t - 0.5) * finite(p.height, 2, 0, 100)
    positions[index * 3 + 2] = Math.sin(angle) * radius * (0.35 + t * 0.65)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const material = new THREE.PointsMaterial({
    color: color(p.color, 0x9b7cff),
    opacity: finite(p.opacity, 0.8, 0, 1),
    size: finite(p.size, 0.035, 0.001, 2),
    transparent: true,
  })
  return new THREE.Points(geometry, material)
}

function applyTransform(object, transform = {}) {
  object.position?.set?.(...(transform.position ?? [0, 0, 0]))
  object.rotation?.set?.(...(transform.rotation ?? [0, 0, 0]))
  object.scale?.set?.(...(transform.scale ?? [1, 1, 1]))
  object.visible = transform.visible !== false
}

function setTarget(root, objectId, target, value) {
  const path = String(target).split('.')
  const object = root.getObjectByName?.(objectId)
  if (!object || path.length === 0) return false
  let cursor = object
  for (let index = 0; index < path.length - 1; index += 1) {
    cursor = cursor?.[path[index]]
    if (!cursor) return false
  }
  const key = path.at(-1)
  if (!key || typeof cursor[key] !== 'number') return false
  cursor[key] = value
  return true
}

export function createGenericThreeSceneProjection({ THREE, document }) {
  if (!THREE?.Group || !document) throw new TypeError('Generic Three projection requires Three.js and a scene document.')
  const root = new THREE.Group()
  root.name = document.id
  const resources = new Map(document.resources.map((resource) => [resource.id, resource]))
  const objects = new Map()
  for (const descriptor of document.objects) {
    const geometry = descriptor.geometryId ? geometryFor(THREE, resources.get(descriptor.geometryId)) : null
    const material = descriptor.materialId ? materialFor(THREE, resources.get(descriptor.materialId)) : null
    let object
    if (descriptor.kind === 'mesh' && geometry && material) object = new THREE.Mesh(geometry, material)
    else if (descriptor.kind === 'points' && geometry && material) object = new THREE.Points(geometry, material)
    else if (descriptor.kind === 'line' && geometry && material) object = new THREE.LineSegments(geometry, material)
    else object = new THREE.Group()
    object.name = descriptor.id
    applyTransform(object, { ...descriptor.transform, visible: descriptor.visible })
    for (const component of descriptor.components ?? []) {
      if (EFFECT_IDS.has(component.implementation) && component.enabled !== false) object.add(effectObject(THREE, component))
    }
    objects.set(descriptor.id, object)
  }
  for (const descriptor of document.objects) {
    const object = objects.get(descriptor.id)
    const parent = descriptor.parentId ? objects.get(descriptor.parentId) : root
    parent?.add(object)
  }
  for (const descriptor of document.resources.filter((resource) => resource.kind === 'effect')) {
    const target = objects.get(descriptor.parameters?.targetObjectId) ?? root
    target.add(effectObject(THREE, descriptor))
  }
  return {
    object: root,
    activate() {},
    applyAnimation(binding, value) { return setTarget(root, binding.objectId, binding.target, value) },
    applySignal(binding, value) { return setTarget(root, binding.objectId, binding.target, value) },
    suspend() { root.visible = false },
    resume() { root.visible = true },
    dispose() {
      root.traverse?.((object) => {
        object.geometry?.dispose?.()
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        for (const material of materials) material?.dispose?.()
      })
      root.clear?.()
    },
  }
}
