import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  renderCanvasListToggleButton,
  renderCanvasRow,
  renderCursorToggleRowHTML,
  renderMouseEventsToggleRowHTML,
} from '../../packages/toolkit/components/canvas-inspector/index.js'
import {
  canvasActionAttrs,
  canvasInspectorAosRef,
  inspectorControlAttrs,
} from '../../packages/toolkit/components/canvas-inspector/semantics.js'

test('canvas action attrs expose stable AOS target metadata', () => {
  const attrs = canvasActionAttrs('avatar-main', 'stats', { pressed: true })

  assert.match(attrs, /aria-label="Stats for canvas avatar-main"/)
  assert.match(attrs, /data-aos-ref="canvas-inspector:canvas:avatar-main:stats"/)
  assert.match(attrs, /data-aos-surface="canvas-inspector"/)
  assert.match(attrs, /data-aos-action="toggle_stats"/)
  assert.match(attrs, /data-semantic-target-id="stats-avatar-main"/)
  assert.match(attrs, /aria-pressed="true"/)
})

test('renderCanvasRow stamps semantic metadata on canvas action buttons', () => {
  const html = renderCanvasRow({
    id: 'avatar-main',
    at: [0, 0, 200, 100],
  }, 0, {
    statsIds: new Set(['avatar-main']),
    tintedIds: new Set(['avatar-main']),
  })

  assert.match(html, /class="btn stats-btn active"[^>]*aria-label="Stats for canvas avatar-main"[^>]*data-aos-action="toggle_stats"[^>]*aria-pressed="true"[^>]*>stats<\/button>/)
  assert.match(html, /class="btn tint-btn active"[^>]*aria-label="Tint canvas avatar-main"[^>]*data-aos-action="toggle_tint"[^>]*aria-pressed="true"[^>]*>tint<\/button>/)
  assert.match(html, /class="btn remove-btn"[^>]*aria-label="Remove canvas avatar-main"[^>]*data-aos-action="remove_canvas"[^>]*>\u2715<\/button>/)
})

test('renderCanvasRow stamps semantic metadata on DesktopWorld surface actions', () => {
  const html = renderCanvasRow({
    id: 'desktop-world',
    at: [0, 0, 3840, 1080],
    track: 'union',
    segments: [
      { display_id: 1, index: 0, dw_bounds: [0, 0, 1920, 1080], native_bounds: [0, 0, 1920, 1080] },
    ],
  }, 0, {
    tintedIds: new Set(['desktop-world']),
  })

  assert.match(html, /desktop-world/)
  assert.match(html, /data-aos-ref="canvas-inspector:canvas:desktop-world:stats"/)
  assert.match(html, /data-aos-ref="canvas-inspector:canvas:desktop-world:tint"[^>]*aria-pressed="true"/)
  assert.match(html, /data-aos-ref="canvas-inspector:canvas:desktop-world:remove"/)
})

test('canvas action attrs escape hostile canvas identifiers', () => {
  const html = renderCanvasRow({
    id: '<avatar>',
    at: [0, 0, 200, 100],
  }, 0)

  assert.match(html, /aria-label="Stats for canvas &lt;avatar&gt;"/)
  assert.match(html, /data-aos-ref="canvas-inspector:canvas:&lt;avatar&gt;:stats"/)
  assert.match(html, /data-semantic-target-id="stats-&lt;avatar&gt;"/)
  assert.doesNotMatch(html, /aria-label="Stats for canvas <avatar>"/)
})

test('inspector control attrs expose pressed and expanded states', () => {
  const pressed = inspectorControlAttrs('minimap-cursor', {
    name: 'Minimap cursor',
    action: 'toggle_minimap_cursor',
    pressed: true,
  })
  const expanded = inspectorControlAttrs('canvas-list-toggle', {
    name: 'Hide canvas list',
    action: 'toggle_canvas_list',
    expanded: true,
  })

  assert.match(pressed, /aria-label="Minimap cursor"/)
  assert.match(pressed, /data-aos-action="toggle_minimap_cursor"/)
  assert.match(pressed, /data-aos-ref="canvas-inspector:control:minimap-cursor"/)
  assert.match(pressed, /aria-pressed="true"/)
  assert.match(expanded, /aria-label="Hide canvas list"/)
  assert.match(expanded, /data-aos-action="toggle_canvas_list"/)
  assert.match(expanded, /aria-expanded="true"/)
})

test('cursor and mouse event toggles keep visible on/off text but expose AX names', () => {
  const cursor = renderCursorToggleRowHTML({ depth: 1, enabled: true })
  const mouse = renderMouseEventsToggleRowHTML({ depth: 1, enabled: false })

  assert.match(cursor, /<button class="btn cursor-toggle-btn active"[^>]*aria-label="Minimap cursor"[^>]*aria-pressed="true"[^>]*>on<\/button>/)
  assert.match(mouse, /<button class="btn mouse-events-toggle-btn"[^>]*aria-label="Mouse events"[^>]*aria-pressed="false"[^>]*>off<\/button>/)
})

test('canvas list disclosure exposes semantic action and expanded state', () => {
  const collapsed = renderCanvasListToggleButton({ collapsed: true })
  const expanded = renderCanvasListToggleButton({ collapsed: false })

  assert.match(collapsed, /class="canvas-list-toggle"[^>]*aria-label="Show canvas list"[^>]*aria-expanded="false"/)
  assert.match(collapsed, /data-aos-action="toggle_canvas_list"/)
  assert.match(expanded, /class="canvas-list-toggle"[^>]*aria-label="Hide canvas list"[^>]*aria-expanded="true"/)
  assert.match(expanded, /class="canvas-list-caret open"/)
})

test('canvasInspectorAosRef normalizes whitespace in stable refs', () => {
  assert.equal(
    canvasInspectorAosRef('canvas', 'avatar main', 'stats'),
    'canvas-inspector:canvas:avatar-main:stats',
  )
})
