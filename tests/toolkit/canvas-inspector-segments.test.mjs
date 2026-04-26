import { test } from 'node:test'
import assert from 'node:assert/strict'

import { renderCanvasRow } from '../../packages/toolkit/components/canvas-inspector/index.js'

test('renderCanvasRow emits segment children for DesktopWorld surfaces', () => {
  const html = renderCanvasRow({
    id: 'avatar-main',
    at: [0, 0, 3840, 1080],
    track: 'union',
    segments: [
      { display_id: 1, index: 0, dw_bounds: [0, 0, 1920, 1080], native_bounds: [0, 0, 1920, 1080] },
      { display_id: 2, index: 1, dw_bounds: [1920, 0, 1920, 1080], native_bounds: [1920, 0, 1920, 1080] },
    ],
  }, 0)

  assert.match(html, /desktop-world/)
  assert.match(html, /2 segments/)
  assert.match(html, /\[0\][\s\S]*display 1/)
  assert.match(html, /\[1\][\s\S]*display 2/)
  assert.match(html, /dw\(1920,0,1920,1080\)/)
})

test('renderCanvasRow escapes surface and segment metadata', () => {
  const html = renderCanvasRow({
    id: '<avatar>',
    segments: [
      { display_id: '<display>', index: 0, dw_bounds: [0, 0, 10, 10], native_bounds: [0, 0, 10, 10] },
    ],
  }, 0)

  assert.match(html, /&lt;avatar&gt;/)
  assert.match(html, /display &lt;display&gt;/)
  assert.doesNotMatch(html, /<avatar>/)
})
