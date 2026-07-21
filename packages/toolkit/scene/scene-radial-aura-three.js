const TEXTURE_SIZE = 32
const MAX_WOBBLES = 24
const HEX_COLOR = /^#[0-9a-f]{6}$/iu
const PARAMETER_KEYS = new Set([
  'intensity',
  'primaryColor',
  'pulseHz',
  'reach',
  'secondaryColor',
  'targetObjectId',
  'wobbleAmplitude',
  'wobbleCount',
  'wobbleOpacity',
  'wobbleRadius',
  'wobbleScaleX',
  'wobbleScaleY',
  'wobbleSpeed',
])

function finite(value, fallback, min, max) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

function rgb(value, fallback) {
  const source = HEX_COLOR.test(value) ? value : fallback
  return [
    Number.parseInt(source.slice(1, 3), 16),
    Number.parseInt(source.slice(3, 5), 16),
    Number.parseInt(source.slice(5, 7), 16),
  ]
}

function radialTexture(THREE, primary, secondary, core) {
  const first = rgb(primary, '#9b7cff')
  const second = rgb(secondary, '#28154f')
  const data = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4)
  for (let y = 0; y < TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < TEXTURE_SIZE; x += 1) {
      const dx = ((x + 0.5) / TEXTURE_SIZE) * 2 - 1
      const dy = ((y + 0.5) / TEXTURE_SIZE) * 2 - 1
      const distance = Math.min(1, Math.hypot(dx, dy))
      const falloff = core
        ? Math.max(0, 1 - distance ** 1.6)
        : Math.max(0, (1 - distance) ** 2.4)
      const mix = Math.min(1, distance * (core ? 1.1 : 0.72))
      const offset = (y * TEXTURE_SIZE + x) * 4
      data[offset] = Math.round(first[0] + (second[0] - first[0]) * mix)
      data[offset + 1] = Math.round(first[1] + (second[1] - first[1]) * mix)
      data[offset + 2] = Math.round(first[2] + (second[2] - first[2]) * mix)
      data[offset + 3] = Math.round(falloff * 255)
    }
  }
  const texture = new THREE.DataTexture(
    data,
    TEXTURE_SIZE,
    TEXTURE_SIZE,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  )
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}

function directionAt(index, count) {
  if (count <= 1) return [0, 1, 0]
  const y = 1 - (index / (count - 1)) * 2
  const radius = Math.sqrt(Math.max(0, 1 - y * y))
  const angle = index * Math.PI * (3 - Math.sqrt(5))
  return [Math.cos(angle) * radius, y, Math.sin(angle) * radius]
}

function boundedNumber(value, min, max) {
  return Number.isFinite(value) && value >= min && value <= max
}

export function validateRadialAuraParameters(parameters) {
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
    return 'radial_aura_parameters_invalid'
  }
  for (const key of Object.keys(parameters)) {
    if (!PARAMETER_KEYS.has(key)) return 'radial_aura_parameter_unknown'
  }
  if (parameters.targetObjectId !== undefined && (
    typeof parameters.targetObjectId !== 'string'
    || parameters.targetObjectId.length === 0
    || parameters.targetObjectId.length > 256
  )) return 'radial_aura_target_invalid'
  if (!HEX_COLOR.test(parameters.primaryColor) || !HEX_COLOR.test(parameters.secondaryColor)) {
    return 'radial_aura_color_invalid'
  }
  if (!boundedNumber(parameters.reach, 0, 8)) return 'radial_aura_reach_out_of_bounds'
  if (!boundedNumber(parameters.intensity, 0, 4)) return 'radial_aura_intensity_out_of_bounds'
  if (!boundedNumber(parameters.pulseHz, 0, 8)) return 'radial_aura_pulse_out_of_bounds'
  if (!Number.isInteger(parameters.wobbleCount) || parameters.wobbleCount < 0 || parameters.wobbleCount > MAX_WOBBLES) {
    return 'radial_aura_wobble_count_out_of_bounds'
  }
  if (!boundedNumber(parameters.wobbleRadius, 0, 8)) return 'radial_aura_wobble_radius_out_of_bounds'
  if (!boundedNumber(parameters.wobbleScaleX, 0.05, 3)) return 'radial_aura_wobble_scale_out_of_bounds'
  if (!boundedNumber(parameters.wobbleScaleY, 0.05, 3)) return 'radial_aura_wobble_scale_out_of_bounds'
  if (!boundedNumber(parameters.wobbleAmplitude, 0, 2)) return 'radial_aura_wobble_amplitude_out_of_bounds'
  if (!boundedNumber(parameters.wobbleSpeed, 0, 16)) return 'radial_aura_wobble_speed_out_of_bounds'
  if (!boundedNumber(parameters.wobbleOpacity, 0, 1)) return 'radial_aura_wobble_opacity_out_of_bounds'
  return true
}

export function createRadialAuraThreeEffect({ THREE, descriptor }) {
  const p = descriptor.parameters ?? {}
  const group = new THREE.Group()
  group.name = `${descriptor.id}/radial-aura`
  const outerTexture = radialTexture(THREE, p.primaryColor, p.secondaryColor, false)
  const coreTexture = radialTexture(THREE, p.primaryColor, p.secondaryColor, true)
  const materialOptions = {
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  }
  const outer = new THREE.Sprite(new THREE.SpriteMaterial({
    ...materialOptions,
    map: outerTexture,
    opacity: 0.62,
  }))
  outer.name = `${descriptor.id}/reach`
  outer.renderOrder = 20
  const core = new THREE.Sprite(new THREE.SpriteMaterial({
    ...materialOptions,
    map: coreTexture,
    opacity: 0.86,
  }))
  core.name = `${descriptor.id}/core`
  core.renderOrder = 21
  const wobbleGroup = new THREE.Group()
  wobbleGroup.name = `${descriptor.id}/wobbles`
  const wobbleCount = Math.round(finite(p.wobbleCount, 0, 0, MAX_WOBBLES))
  const wobbleGeometry = wobbleCount > 0 ? new THREE.IcosahedronGeometry(0.09, 1) : null
  const wobbleMaterials = wobbleCount > 0
    ? [p.primaryColor, p.secondaryColor].map((entry) => new THREE.MeshBasicMaterial({
        ...materialOptions,
        color: entry,
        opacity: finite(p.wobbleOpacity, 0.32, 0, 1),
      }))
    : []
  const wobbles = []
  for (let index = 0; index < wobbleCount; index += 1) {
    const direction = directionAt(index, wobbleCount)
    const mesh = new THREE.Mesh(wobbleGeometry, wobbleMaterials[index % 2])
    mesh.name = `${descriptor.id}/wobble/${index}`
    wobbleGroup.add(mesh)
    wobbles.push({ direction, index, mesh })
  }
  group.add(outer, core, wobbleGroup)

  let disposed = false
  return Object.freeze({
    object: group,
    tick(elapsedMs) {
      if (disposed || !Number.isFinite(elapsedMs) || elapsedMs < 0) return false
      const seconds = elapsedMs / 1_000
      const reach = finite(p.reach, 0.75, 0, 8)
      const intensity = finite(p.intensity, 1, 0, 4)
      const pulse = Math.sin(seconds * Math.PI * 2 * finite(p.pulseHz, 0.5, 0, 8))
      outer.scale.setScalar(1.6 + reach * 1.4 + pulse * 0.08)
      core.scale.setScalar(0.34 + intensity * 0.28 + pulse * 0.04)
      outer.material.opacity = Math.min(1, 0.24 + intensity * 0.24)
      core.material.opacity = Math.min(1, 0.42 + intensity * 0.32)
      const radius = finite(p.wobbleRadius, 0.62, 0, 8)
      const scaleX = finite(p.wobbleScaleX, 0.66, 0.05, 3)
      const scaleY = finite(p.wobbleScaleY, 0.66, 0.05, 3)
      const amplitude = finite(p.wobbleAmplitude, 0.14, 0, 2)
      const speed = finite(p.wobbleSpeed, 0.65, 0, 16)
      for (const entry of wobbles) {
        const phase = entry.index * 1.61803398875
        const offset = radius + Math.sin(seconds * speed + phase) * amplitude
        entry.mesh.position.set(
          entry.direction[0] * offset,
          entry.direction[1] * offset,
          entry.direction[2] * offset,
        )
        entry.mesh.rotation.set(
          seconds * speed * 0.21 + phase,
          seconds * speed * 0.27 - phase,
          Math.sin(seconds * speed + phase) * 0.22,
        )
        const pulseScale = 1 + Math.sin(seconds * speed * 1.3 + phase) * 0.18
        entry.mesh.scale.set(
          scaleX * pulseScale,
          scaleY * (2 - pulseScale),
          Math.min(scaleX, scaleY) * 0.92,
        )
      }
      return true
    },
    dispose() {
      if (disposed) return false
      disposed = true
      outerTexture.dispose()
      coreTexture.dispose()
      return true
    },
  })
}
