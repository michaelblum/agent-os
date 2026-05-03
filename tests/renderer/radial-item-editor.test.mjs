import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_SIGIL_RADIAL_ITEMS } from '../../apps/sigil/renderer/radial-menu-defaults.js'
import {
  AGENT_TERMINAL_MODEL_OBJECT_ID,
  WIKI_BRAIN_FIBER_BLOOM_OBJECT_ID,
  WIKI_BRAIN_FIBER_STEM_OBJECT_ID,
  WIKI_BRAIN_FRACTAL_TREE_OBJECT_ID,
  WIKI_BRAIN_SHELL_OBJECT_ID,
} from '../../apps/sigil/renderer/live-modules/radial-object-control.js'
import {
  applyEditorObjectPatch,
  buildEditorObjectRegistry,
  buildEditorRadialSnapshot,
  createRadialItemEditorState,
  editableRadialItems,
  selectRadialItem,
  selectedRadialItem,
  setSelectedItemHoverSpin,
} from '../../apps/sigil/radial-item-editor/model.js'

test('editableRadialItems exposes the current glTF radial item subjects', () => {
  assert.deepEqual(editableRadialItems(DEFAULT_SIGIL_RADIAL_ITEMS).map((item) => item.id), [
    'context-menu',
    'agent-terminal',
    'wiki-graph',
  ])
})

test('radial item editor defaults to the wiki brain subject and advertises its object graph', () => {
  const state = createRadialItemEditorState({ canvasId: 'preview' })
  const registry = buildEditorObjectRegistry(state)

  assert.equal(selectedRadialItem(state).id, 'wiki-graph')
  assert.equal(registry.canvas_id, 'preview')
  assert.deepEqual(registry.objects.map((object) => object.object_id), [
    WIKI_BRAIN_SHELL_OBJECT_ID,
    WIKI_BRAIN_FIBER_STEM_OBJECT_ID,
    WIKI_BRAIN_FIBER_BLOOM_OBJECT_ID,
    WIKI_BRAIN_FRACTAL_TREE_OBJECT_ID,
  ])
})

test('radial item editor can select and patch the agent terminal model host', () => {
  const state = createRadialItemEditorState({
    itemId: 'agent-terminal',
    canvasId: 'preview',
  })

  assert.equal(selectedRadialItem(state).id, 'agent-terminal')
  assert.deepEqual(buildEditorObjectRegistry(state).objects.map((object) => object.object_id), [
    AGENT_TERMINAL_MODEL_OBJECT_ID,
  ])

  const result = applyEditorObjectPatch(state, {
    type: 'canvas_object.transform.patch',
    schema_version: '2026-05-03',
    request_id: 'req-terminal-editor',
    target: {
      canvas_id: 'preview',
      object_id: AGENT_TERMINAL_MODEL_OBJECT_ID,
    },
    patch: {
      position: { x: 0.03 },
      scale: { y: 1.18 },
      visible: false,
    },
  })

  assert.equal(result.status, 'applied')
  assert.deepEqual(result.transform.position, { x: 0.03, y: 0, z: 0 })
  assert.deepEqual(result.transform.scale, { x: 1, y: 1.18, z: 1 })
  assert.equal(result.visible, false)

  const terminal = selectedRadialItem(state)
  assert.deepEqual(terminal.geometry.modelTransform.position, { x: 0.03, y: 0, z: 0 })
  assert.deepEqual(terminal.geometry.visibility, { model: false })
})

test('radial item editor preview snapshot isolates the selected item', () => {
  const state = createRadialItemEditorState({ itemId: 'agent-terminal' })
  const snapshot = buildEditorRadialSnapshot(state, { width: 1000, height: 700 })

  assert.equal(snapshot.phase, 'radial')
  assert.equal(snapshot.activeItemId, 'agent-terminal')
  assert.equal(snapshot.items.length, 1)
  assert.equal(snapshot.items[0].id, 'agent-terminal')
  assert.deepEqual(snapshot.items[0].center, { x: 500, y: 350, valid: true })
  assert.deepEqual(snapshot.origin, { x: 500, y: 520, valid: true })
})

test('radial item editor preserves per-item edits when switching subjects', () => {
  const state = createRadialItemEditorState({ itemId: 'agent-terminal', canvasId: 'preview' })
  setSelectedItemHoverSpin(state, true, 2.5)
  assert.equal(selectedRadialItem(state).geometry.hoverSpinSpeed, 2.5)

  selectRadialItem(state, 'wiki-graph')
  assert.equal(selectedRadialItem(state).id, 'wiki-graph')

  selectRadialItem(state, 'agent-terminal')
  assert.equal(selectedRadialItem(state).geometry.hoverSpinSpeed, 2.5)
})
