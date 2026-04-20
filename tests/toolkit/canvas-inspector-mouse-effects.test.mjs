import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeMinimapLayout } from '../../packages/toolkit/components/canvas-inspector/index.js'
import {
  applyMouseEffectsInput,
  createMouseEffectsState,
  mouseEffectsNeedAnimationFrame,
  renderMinimapCursor,
  renderMouseEffectsOverlay,
  sweepMouseEffectsState,
} from '../../packages/toolkit/components/canvas-inspector/mouse-effects.js'

const displays = [
  {
    id: 2,
    cgID: 3,
    width: 1920,
    height: 1080,
    is_main: false,
    bounds: { x: -207, y: 982, w: 1920, h: 1080 },
  },
  {
    id: 1,
    cgID: 1,
    width: 1512,
    height: 982,
    is_main: true,
    bounds: { x: 0, y: 0, w: 1512, h: 982 },
  },
]

function minimapLayout() {
  return computeMinimapLayout(displays, [
    { id: 'canvas-inspector', at: [1172, 442, 320, 480] },
  ], 300, { selfId: 'canvas-inspector' })
}

test('left drag release collapses the line tail toward the mouse-up point', () => {
  const state = createMouseEffectsState()
  const layout = minimapLayout()

  assert.equal(applyMouseEffectsInput(state, { type: 'left_mouse_down' }, { x: 1200, y: 260 }, 1000), true)
  assert.equal(applyMouseEffectsInput(state, { type: 'left_mouse_dragged' }, { x: 1380, y: 360 }, 1120), true)
  assert.equal(mouseEffectsNeedAnimationFrame(state, 1050), true)

  const activeHtml = renderMouseEffectsOverlay(state, layout, 1160)
  assert.match(activeHtml, /mouse-events active/)
  assert.match(activeHtml, /minimap-pointer-line/)
  assert.match(activeHtml, /--line-origin:0%/)

  assert.equal(applyMouseEffectsInput(state, { type: 'left_mouse_up' }, { x: 1420, y: 380 }, 1200), true)
  const releaseHtml = renderMouseEffectsOverlay(state, layout, 1240)
  assert.match(releaseHtml, /mouse-events release/)
  assert.match(releaseHtml, /--line-origin:100%/)
  assert.equal(mouseEffectsNeedAnimationFrame(state, 1240), true)
  assert.equal(sweepMouseEffectsState(state, 1400), true)
  assert.equal(renderMouseEffectsOverlay(state, layout, 1400), '')
})

test('left click adds a separate expanding click pulse on top of the release effect', () => {
  const state = createMouseEffectsState()
  const layout = minimapLayout()

  assert.equal(applyMouseEffectsInput(state, { type: 'left_mouse_down' }, { x: 1260, y: 290 }, 4000), true)
  assert.equal(applyMouseEffectsInput(state, { type: 'left_mouse_up' }, { x: 1260.5, y: 290.5 }, 4060), true)

  const html = renderMouseEffectsOverlay(state, layout, 4150)
  assert.match(html, /mouse-events release/)
  assert.match(html, /mouse-events pulse/)
  assert.match(html, /minimap-pointer-ring circle/)
  assert.match(html, /--ring-scale:1\.5/)
  assert.doesNotMatch(html, /minimap-pointer-line/)
})

test('escape cancels an active drag back toward the origin', () => {
  const state = createMouseEffectsState()
  const layout = minimapLayout()

  applyMouseEffectsInput(state, { type: 'left_mouse_down' }, { x: 1210, y: 270 }, 2000)
  applyMouseEffectsInput(state, { type: 'left_mouse_dragged' }, { x: 1450, y: 410 }, 2100)
  assert.equal(applyMouseEffectsInput(state, { type: 'key_down', keyCode: 53 }, null, 2140), true)

  const cancelHtml = renderMouseEffectsOverlay(state, layout, 2160)
  assert.match(cancelHtml, /mouse-events cancel/)
  assert.match(cancelHtml, /--line-origin:0%/)
  assert.equal(sweepMouseEffectsState(state, 2250), true)
})

test('right click renders a square pulse without a drag line', () => {
  const state = createMouseEffectsState()
  const layout = minimapLayout()

  assert.equal(applyMouseEffectsInput(state, { type: 'right_mouse_up' }, { x: 1320, y: 300 }, 3000), true)
  const html = renderMouseEffectsOverlay(state, layout, 3090)
  assert.match(html, /mouse-events pulse/)
  assert.match(html, /minimap-pointer-ring square/)
  assert.match(html, /--ring-scale:1\.5/)
  assert.doesNotMatch(html, /minimap-pointer-line/)
  assert.doesNotMatch(html, /minimap-pointer-center/)
})

test('renderMinimapCursor uses the shared pointer center and ring primitives', () => {
  const html = renderMinimapCursor({ x: 44, y: 55 })
  assert.match(html, /minimap-pointer-center/)
  assert.match(html, /minimap-pointer-ring cursor circle/)
})
