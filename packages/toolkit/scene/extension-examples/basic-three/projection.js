const { THREE, document } = context
const root = new THREE.Group()
root.name = document.id
const geometry = new THREE.IcosahedronGeometry(1, 1)
const material = new THREE.MeshStandardMaterial({
  color: 0x5f6fff,
  emissive: 0x141b66,
  emissiveIntensity: 0.45,
  metalness: 0.55,
  roughness: 0.3,
})
const mesh = new THREE.Mesh(geometry, material)
root.add(mesh)
let disposed = false
let suspended = false

return Object.freeze({
  object: root,
  activate() {
    if (!disposed) root.visible = true
  },
  applySignal(binding, value) {
    if (disposed || binding?.target !== 'material.emissiveIntensity' || !Number.isFinite(value)) return false
    material.emissiveIntensity = Math.max(0, Math.min(2, value))
    return true
  },
  applyAnimation(binding, value) {
    if (disposed || binding?.target !== 'rotation.y' || !Number.isFinite(value)) return false
    mesh.rotation.y = value
    return true
  },
  tick(elapsedMs) {
    if (!disposed && !suspended && Number.isFinite(elapsedMs)) mesh.rotation.y = elapsedMs * 0.00025
  },
  suspend() {
    suspended = true
    root.visible = false
  },
  resume() {
    if (disposed) return
    suspended = false
    root.visible = true
  },
  contextLost() {
    root.visible = false
  },
  contextRestored() {
    if (!disposed && !suspended) root.visible = true
  },
  dispose() {
    if (disposed) return
    disposed = true
    root.remove(mesh)
    geometry.dispose()
    material.dispose()
    root.clear()
  },
})
