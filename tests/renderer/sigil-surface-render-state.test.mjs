import { test } from 'node:test'
import assert from 'node:assert/strict'

const {
  applyOmegaRenderStateSnapshot,
  desktopWorldToSegmentLocalPoint,
  omegaRenderStateSnapshot,
} = await import('../../apps/sigil/renderer/live-modules/surface-render-state.js')

test('DesktopWorld points project through non-zero segment origins', () => {
  const mainSegment = {
    dw_bounds: [1440, 120, 1728, 1117],
  }
  const extendedSegment = {
    dw_bounds: [-1280, 0, 1280, 1024],
  }

  assert.deepEqual(
    desktopWorldToSegmentLocalPoint({ x: 1500, y: 200, valid: true }, { segment: mainSegment }),
    { x: 60, y: 80, valid: true }
  )
  assert.deepEqual(
    desktopWorldToSegmentLocalPoint({ x: -1200, y: 96, valid: true }, { segment: extendedSegment }),
    { x: 80, y: 96, valid: true }
  )
})

test('DesktopWorld points fall back to union-local projection without a segment', () => {
  assert.deepEqual(
    desktopWorldToSegmentLocalPoint(
      { x: 1500, y: 200, valid: false },
      { globalBounds: { x: 1440, y: 120, w: 1728, h: 1117 } }
    ),
    { x: 60, y: 80, valid: false }
  )
})

test('Omega render snapshots carry full line-trail state to follower segments', () => {
  const primaryState = {
    isOmegaEnabled: true,
    omegaInterDimensional: true,
    omegaGhostCount: 23,
    omegaGhostDuration: 1.7,
    omegaGhostMode: 'vertexDissolve',
    omegaLagFactor: 0.12,
    omegaScale: 2.2,
  }

  assert.deepEqual(omegaRenderStateSnapshot(primaryState), {
    enabled: true,
    interDimensional: true,
    ghostCount: 23,
    ghostDuration: 1.7,
    ghostMode: 'vertexDissolve',
    lagFactor: 0.12,
    scale: 2.2,
  })
})

test('Omega render snapshots apply full line-trail state on follower segments', () => {
  const followerState = {
    isOmegaEnabled: false,
    omegaInterDimensional: false,
    omegaGhostCount: 10,
    omegaGhostDuration: 2,
    omegaGhostMode: 'fade',
    omegaLagFactor: 0.05,
    omegaScale: 1.5,
  }

  const applied = applyOmegaRenderStateSnapshot(followerState, {
    enabled: true,
    interDimensional: true,
    ghostCount: 23,
    ghostDuration: 1.7,
    ghostMode: 'vertexDissolve',
    lagFactor: 0.12,
    scale: 2.2,
  })

  assert.equal(applied, true)
  assert.deepEqual(followerState, {
    isOmegaEnabled: true,
    omegaInterDimensional: true,
    omegaGhostCount: 23,
    omegaGhostDuration: 1.7,
    omegaGhostMode: 'vertexDissolve',
    omegaLagFactor: 0.12,
    omegaScale: 2.2,
  })
})
