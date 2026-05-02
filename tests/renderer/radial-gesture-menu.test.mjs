import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createSigilRadialGestureMenu,
  DEFAULT_SIGIL_RADIAL_ITEMS,
} from '../../apps/sigil/renderer/live-modules/radial-gesture-menu.js'

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
  assert.equal(wikiItem.geometry.modelUid, '09d686a1a1f745cba6b2385d0c831214')
  assert.match(wikiItem.geometry.src, /brain-hologram\/scene\.gltf$/)
  assert.equal(wikiItem.geometry.material, 'source-emissive')
  assert.equal(wikiItem.geometry.radiusScale, 1.42)
  assert.equal(wikiItem.geometry.bloomShell, undefined)
  assert.equal(wikiItem.geometry.attribution.author, 'oxterium')
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
