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
  assert.match(html, /class="btn stats-btn"[^>]*>stats<\/button>/)
  assert.match(html, /canvas-status-prefix/)
  assert.match(html, /\[0\][\s\S]*display 1/)
  assert.match(html, /\[1\][\s\S]*display 2/)
  assert.match(html, /dw\(1920,0,1920,1080\)/)
})

test('renderCanvasRow uses prefix status dots instead of suffix text flags', () => {
  const html = renderCanvasRow({
    id: 'interactive-conn',
    at: [0, 0, 200, 100],
    interactive: true,
    scope: 'connection',
    ttl: 45,
  }, 0)

  assert.match(html, /canvas-status-prefix/)
  assert.match(html, /interactive canvas; connection-scoped canvas; time-to-live: 45s/)
  assert.match(html, /status-dot interaction active/)
  assert.match(html, /status-dot scope active/)
  assert.match(html, /status-dot ttl active/)
  assert.doesNotMatch(html, />int</)
  assert.doesNotMatch(html, />conn</)
  assert.doesNotMatch(html, /ttl:45s/)
})

test('renderCanvasRow emits per-canvas stats toggle state', () => {
  const inactive = renderCanvasRow({
    id: 'plain-canvas',
    at: [0, 0, 200, 100],
  }, 0)
  const active = renderCanvasRow({
    id: 'plain-canvas',
    at: [0, 0, 200, 100],
  }, 0, { statsIds: new Set(['plain-canvas']) })

  assert.match(inactive, /class="btn stats-btn"[^>]*>stats<\/button>/)
  assert.match(active, /class="btn stats-btn active"[^>]*>stats<\/button>/)
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
