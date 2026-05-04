import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createSigilRadialGestureMenu,
  DEFAULT_SIGIL_RADIAL_ITEMS,
} from '../../apps/sigil/renderer/live-modules/radial-gesture-menu.js'
import { normalizeSigilRadialGestureMenu } from '../../apps/sigil/renderer/radial-menu-defaults.js'

function createMenu(options = {}) {
  const commits = []
  const menu = createSigilRadialGestureMenu({
    state: {
      avatarHitRadius: 100,
      radialGestureMenu: {
        startAngle: -90,
        spreadDegrees: 90,
        itemRadius: 1,
        itemHitRadius: 0.25,
        itemVisualRadius: 0.2,
        menuRadius: 1.2,
        handoffRadius: 1.8,
        reentryRadius: 1.45,
        deadZoneRadius: 0.3,
        items: DEFAULT_SIGIL_RADIAL_ITEMS,
      },
      ...options.state,
    },
    onCommitItem(item, snapshot) {
      commits.push({ item, snapshot })
    },
  })
  return { menu, commits }
}

test('Sigil radial menu commits configured context item on release', () => {
  const { menu, commits } = createMenu()
  const started = menu.start({ x: 200, y: 200, valid: true })
  const contextItem = started.items.find((item) => item.id === 'context-menu')

  const moved = menu.move({ ...contextItem.center, valid: true })
  assert.equal(moved.snapshot.phase, 'radial')
  assert.equal(moved.snapshot.activeItemId, 'context-menu')

  const released = menu.release({ ...contextItem.center, valid: true })
  assert.equal(released.phase, 'committed')
  assert.equal(released.committed.type, 'item')
  assert.equal(commits.length, 1)
  assert.equal(commits[0].item.action, 'contextMenu')
  assert.equal(menu.snapshot(), null)
})

test('Sigil radial menu config carries native wiki model geometry', () => {
  const contextItem = DEFAULT_SIGIL_RADIAL_ITEMS.find((item) => item.id === 'context-menu')
  const agentTerminalItem = DEFAULT_SIGIL_RADIAL_ITEMS.find((item) => item.id === 'agent-terminal')
  const wikiItem = DEFAULT_SIGIL_RADIAL_ITEMS.find((item) => item.id === 'wiki-graph')

  assert.equal(contextItem.action, 'contextMenu')
  assert.equal(contextItem.geometry.type, 'gltf')
  assert.equal(contextItem.geometry.modelUid, '158a1e27214841589dce6d7361f1a422')
  assert.match(contextItem.geometry.src, /cog\/scene\.gltf$/)
  assert.deepEqual(contextItem.geometry.rotationDegrees, { x: 90, y: 0, z: 0 })
  assert.equal(contextItem.geometry.attribution.author, 'Jiri Kuba')

  assert.equal(agentTerminalItem.label, 'Agent Terminal')
  assert.equal(agentTerminalItem.action, 'agentTerminal')
  assert.equal(agentTerminalItem.geometry.type, 'gltf')
  assert.match(agentTerminalItem.geometry.src, /low-poly-sci-fi-tablet\/scene\.gltf$/)

  assert.equal(wikiItem.action, 'wikiGraph')
  assert.equal(wikiItem.geometry.type, 'gltf')
  assert.equal(wikiItem.geometry.modelUid, '49bcdf19c1904c76a456b31838b0d7ac')
  assert.match(wikiItem.geometry.src, /human-brain\/scene\.gltf$/)
  assert.equal(wikiItem.geometry.material, 'translucent-brain-shell')
  assert.equal(wikiItem.geometry.radiusScale, 1.1502)
  assert.equal(wikiItem.geometry.normalizedRadius, 0.28)
  assert.equal(wikiItem.geometry.hoverSpinSpeed, undefined)
  assert.equal(wikiItem.geometry.hoverYawDegrees, undefined)
  assert.deepEqual(wikiItem.geometry.radialEffect, {
    kind: 'nested-neural-tree',
    holdExitDirection: 'outward',
    shellOpacity: {
      rest: 0.75,
      active: 0.26,
      held: 0.75,
    },
    fractalPulse: {
      intensity: 1,
    },
  })
  assert.equal(wikiItem.geometry.attribution.author, 'Versal')
  assert.equal(wikiItem.geometry.attribution.license, 'CC-BY-4.0')
})

test('Sigil radial menu normalizes stale wiki brain item geometry from saved config', () => {
  const staleMenu = {
    items: [
      {
        id: 'wiki-graph',
        label: 'Wiki Graph',
        action: 'wikiGraph',
        geometry: {
          type: 'gltf',
          src: '../assets/models/human-brain/scene.gltf',
          modelUid: '49bcdf19c1904c76a456b31838b0d7ac',
          title: 'Human Brain',
          radiusScale: 1.42,
          normalizedRadius: 0.28,
          material: 'translucent-brain',
        },
      },
    ],
  }

  const normalized = normalizeSigilRadialGestureMenu(staleMenu)
  const wikiItem = normalized.items.find((item) => item.id === 'wiki-graph')

  assert.equal(wikiItem.geometry.material, 'translucent-brain-shell')
  assert.equal(wikiItem.geometry.radiusScale, 1.1502)
  assert.equal(wikiItem.geometry.hoverSpinSpeed, undefined)
  assert.equal(wikiItem.geometry.hoverYawDegrees, undefined)
  assert.deepEqual(wikiItem.geometry.radialEffect, {
    kind: 'nested-neural-tree',
    holdExitDirection: 'outward',
    shellOpacity: {
      rest: 0.75,
      active: 0.26,
      held: 0.75,
    },
    fractalPulse: {
      intensity: 1,
    },
  })
  assert.equal(staleMenu.items[0].geometry.material, 'translucent-brain')
  assert.equal(staleMenu.items[0].geometry.radialEffect, undefined)
})

test('Sigil radial menu start applies normalized stale item geometry', () => {
  const { menu } = createMenu({
    state: {
      radialGestureMenu: {
        items: [
          {
            id: 'wiki-graph',
            label: 'Wiki Graph',
            action: 'wikiGraph',
            geometry: {
              type: 'gltf',
              src: '../assets/models/human-brain/scene.gltf',
              material: 'translucent-brain',
            },
          },
        ],
      },
    },
  })

  const started = menu.start({ x: 200, y: 200, valid: true })
  const wikiItem = started.items.find((item) => item.id === 'wiki-graph')

  assert.equal(wikiItem.geometry.material, 'translucent-brain-shell')
  assert.equal(wikiItem.geometry.radialEffect.kind, 'nested-neural-tree')
})

test('Sigil radial menu carries visual motion config into snapshots', () => {
  const { menu } = createMenu({
    state: {
      radialGestureMenu: {
        visuals: {
          itemMotion: {
            modelHoverSpinSpeed: 0,
          },
        },
      },
    },
  })

  const started = menu.start({ x: 200, y: 200, valid: true })

  assert.deepEqual(started.visuals, {
    itemMotion: {
      modelHoverSpinSpeed: 0,
    },
  })
})

test('Sigil radial menu reports fast-travel handoff and reentry', () => {
  const { menu } = createMenu()
  menu.start({ x: 0, y: 0, valid: true })

  const handoff = menu.move({ x: 190, y: 0, valid: true })
  assert.equal(handoff.enteredFastTravel, true)
  assert.equal(handoff.snapshot.phase, 'fastTravel')

  const stillFast = menu.move({ x: 160, y: 0, valid: true })
  assert.equal(stillFast.enteredFastTravel, false)
  assert.equal(stillFast.reenteredRadial, false)
  assert.equal(stillFast.snapshot.phase, 'fastTravel')

  const reentered = menu.move({ x: 140, y: 0, valid: true })
  assert.equal(reentered.reenteredRadial, true)
  assert.equal(reentered.snapshot.phase, 'radial')
})

test('Sigil radial menu commits fast travel only outside the handoff radius', () => {
  const { menu, commits } = createMenu()
  menu.start({ x: 0, y: 0, valid: true })
  menu.move({ x: 190, y: 0, valid: true })

  const released = menu.release({ x: 220, y: 25, valid: true })
  assert.equal(released.phase, 'committed')
  assert.deepEqual(released.committed, {
    type: 'fastTravel',
    origin: { x: 0, y: 0 },
    destination: { x: 220, y: 25 },
  })
  assert.equal(commits.length, 0)
})
