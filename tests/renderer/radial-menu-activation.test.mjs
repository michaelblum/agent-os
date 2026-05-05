import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createSigilRadialActivationRequest,
  sigilRadialTargetSurfaceForItem,
  sigilRadialTransitionForItem,
} from '../../apps/sigil/renderer/live-modules/radial-menu-activation.js'

const snapshot = {
  phase: 'committed',
  activeItemId: 'wiki-graph',
  origin: { x: 100, y: 120 },
  committed: {
    type: 'item',
    itemId: 'wiki-graph',
  },
}

test('Sigil radial activation maps wiki item to generic menu activation request', () => {
  const request = createSigilRadialActivationRequest({
    item: {
      id: 'wiki-graph',
      label: 'Wiki Graph',
      action: 'wikiGraph',
      center: { x: 160, y: 120 },
    },
    snapshot,
    input: {
      kind: 'gesture',
      source: 'sigil.avatar',
      pointer: { x: 160, y: 120 },
    },
    wikiWorkbenchCanvasId: 'wiki-canvas',
    wikiPath: 'aos/concepts/example.md',
  })

  assert.equal(request.type, 'aos.menu.activation')
  assert.equal(request.menu_id, 'sigil.radial')
  assert.equal(request.action, 'wikiGraph')
  assert.equal(request.input_source.kind, 'gesture')
  assert.equal(request.input_source.source, 'sigil.avatar')
  assert.deepEqual(request.input_source.pointer, { x: 160, y: 120 })
  assert.equal(request.target_surface.kind, 'markdown-workbench')
  assert.equal(request.target_surface.canvas_id, 'wiki-canvas')
  assert.equal(request.target_surface.subject.id, 'wiki:aos/concepts/example.md')
  assert.equal(request.transition.preset, 'wiki-brain-zoom-dissolve')
  assert.deepEqual(request.metadata.radial, {
    phase: 'committed',
    active_item_id: 'wiki-graph',
    committed_type: 'item',
    committed_item_id: 'wiki-graph',
    origin: { x: 100, y: 120 },
    release_point: { x: 160, y: 120 },
    item_center: { x: 160, y: 120 },
  })
})

test('Sigil radial activation preserves target-surface click input metadata', () => {
  const request = createSigilRadialActivationRequest({
    item: {
      id: 'context-menu',
      label: 'Context Menu',
      action: 'contextMenu',
      center: { x: 80, y: 96 },
    },
    snapshot: {
      ...snapshot,
      activeItemId: 'context-menu',
      committed: { type: 'item', itemId: 'context-menu' },
    },
    input: {
      kind: 'click',
      source: 'sigil.radial-target-surface',
      pointer: { x: 80, y: 96 },
      canvas_id: 'sigil-radial-menu-avatar-main',
    },
  })

  assert.equal(request.input, 'click')
  assert.equal(request.source, 'sigil.radial-target-surface')
  assert.equal(request.input_source.canvas_id, 'sigil-radial-menu-avatar-main')
  assert.equal(request.target_surface.kind, 'sigil-context-menu')
  assert.equal(request.transition, null)
})

test('Sigil radial target and transition helpers keep item behavior declarative', () => {
  assert.deepEqual(sigilRadialTargetSurfaceForItem({
    id: 'agent-terminal',
    action: 'agentTerminal',
  }, {
    agentTerminalCanvasId: 'agent-canvas',
  }), {
    kind: 'agent-terminal',
    canvas_id: 'agent-canvas',
  })

  assert.equal(sigilRadialTransitionForItem({ id: 'agent-terminal', action: 'agentTerminal' }), null)
  assert.equal(sigilRadialTransitionForItem({ id: 'wiki-graph', action: 'wikiGraph' }).preset, 'wiki-brain-zoom-dissolve')
})
