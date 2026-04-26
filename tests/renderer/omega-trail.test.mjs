import { test } from 'node:test'
import assert from 'node:assert/strict'

class Vector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x
    this.y = y
    this.z = z
  }

  copy(other) {
    this.x = other.x
    this.y = other.y
    this.z = other.z
    return this
  }

  set(x, y, z) {
    this.x = x
    this.y = y
    this.z = z
    return this
  }

  normalize() {
    return this
  }
}

globalThis.THREE = { Vector3 }

const state = (await import('../../apps/sigil/renderer/state.js')).default
const { resetOmegaInterdimensionalTrail } = await import('../../apps/sigil/renderer/omega.js')

test('resetOmegaInterdimensionalTrail anchors omega position and clears ghosts', () => {
  const removed = []
  state.scene = { remove: (mesh) => removed.push(mesh.id) }
  state.omegaGroup = { position: new Vector3(0, 0, 0) }
  state.omegaGhostTimer = 3
  state.omegaGhosts = [
    {
      mesh: {
        id: 'ghost-1',
        geometry: { dispose() {} },
        material: { dispose() {} },
      },
    },
  ]

  resetOmegaInterdimensionalTrail(new Vector3(4, 5, 6))

  assert.deepEqual(removed, ['ghost-1'])
  assert.equal(state.omegaGhosts.length, 0)
  assert.equal(state.omegaGhostTimer, 0)
  assert.deepEqual(
    { x: state.omegaGroup.position.x, y: state.omegaGroup.position.y, z: state.omegaGroup.position.z },
    { x: 4, y: 5, z: 6 }
  )
})
