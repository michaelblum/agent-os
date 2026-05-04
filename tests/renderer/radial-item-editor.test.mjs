import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_SIGIL_RADIAL_ITEMS } from '../../apps/sigil/renderer/radial-menu-defaults.js'
import {
  AGENT_TERMINAL_MODEL_OBJECT_ID,
  AGENT_TERMINAL_SCREEN_OBJECT_ID,
  WIKI_BRAIN_FIBER_BLOOM_OBJECT_ID,
  WIKI_BRAIN_FIBER_STEM_OBJECT_ID,
  WIKI_BRAIN_FRACTAL_TREE_OBJECT_ID,
  WIKI_BRAIN_SHELL_OBJECT_ID,
} from '../../apps/sigil/renderer/live-modules/radial-object-control.js'
import {
  applyEditorObjectPatch,
  buildRadialItemWorkbenchSubject,
  buildEditorObjectRegistry,
  buildEditorRadialSnapshot,
  createRadialItemEditorState,
  editableRadialItems,
  exportSelectedRadialItemDefinition,
  selectRadialItem,
  selectedItemFractalPulse,
  selectedRadialItem,
  selectedTerminalScreenMaterial,
  patchSelectedTerminalScreenMaterial,
  setSelectedItemFractalPulseIntensity,
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
    AGENT_TERMINAL_SCREEN_OBJECT_ID,
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
  assert.equal(terminal.geometry.parts[0].id, 'screen')
})

test('radial item editor can tune agent terminal screen material content', () => {
  const state = createRadialItemEditorState({
    itemId: 'agent-terminal',
    canvasId: 'preview',
  })

  assert.equal(selectedTerminalScreenMaterial(state).title, 'AGENT TERM')
  const material = patchSelectedTerminalScreenMaterial(state, {
    title: 'AOS LINK',
    lines: ['> claude code', '> codex', '', '> resumed'],
    accent: '#00ffcc',
    color: '#02090c',
  })

  assert.deepEqual(material, {
    kind: 'terminal-screen',
    title: 'AOS LINK',
    lines: ['> claude code', '> codex', '> resumed'],
    color: '#02090c',
    accent: '#00ffcc',
    opacity: 0.94,
  })
  assert.deepEqual(exportSelectedRadialItemDefinition(state).item.geometry.parts[0].material.lines, [
    '> claude code',
    '> codex',
    '> resumed',
  ])
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

test('radial item editor exposes wiki brain fractal pulse intensity as lock-in state', () => {
  const state = createRadialItemEditorState({ itemId: 'wiki-graph', canvasId: 'preview' })

  assert.equal(selectedItemFractalPulse(state).intensity, 1)
  const pulse = setSelectedItemFractalPulseIntensity(state, 1.65)

  assert.equal(pulse.intensity, 1.65)
  assert.equal(selectedRadialItem(state).geometry.radialEffect.fractalPulse.intensity, 1.65)
  assert.equal(exportSelectedRadialItemDefinition(state).item.geometry.radialEffect.fractalPulse.intensity, 1.65)
})

test('radial item editor exports a source-ready lock-in payload for the selected item', () => {
  const state = createRadialItemEditorState({
    itemId: 'agent-terminal',
    canvasId: 'preview',
  })

  applyEditorObjectPatch(state, {
    type: 'canvas_object.transform.patch',
    schema_version: '2026-05-03',
    request_id: 'req-terminal-export',
    target: {
      canvas_id: 'preview',
      object_id: AGENT_TERMINAL_MODEL_OBJECT_ID,
    },
    patch: {
      position: { x: 0.07 },
      visible: false,
    },
  })
  setSelectedItemHoverSpin(state, true, 1.8)

  const payload = exportSelectedRadialItemDefinition(state, {
    generatedAt: '2026-05-03T12:00:00.000Z',
  })

  assert.equal(payload.type, 'sigil.radial_item_editor.lock_in')
  assert.equal(payload.schema_version, '2026-05-03')
  assert.equal(payload.generated_at, '2026-05-03T12:00:00.000Z')
  assert.equal(payload.subject.id, 'sigil.radial_menu.item:agent-terminal')
  assert.equal(payload.subject.subject_type, 'sigil.radial_menu.item_3d')
  assert.deepEqual(payload.source, {
    kind: 'sigil.radial_menu.default_items',
    path: 'apps/sigil/renderer/radial-menu-defaults.js',
    export: 'DEFAULT_SIGIL_RADIAL_ITEMS',
    operation: 'replace_item_by_id',
  })
  assert.equal(payload.item_id, 'agent-terminal')
  assert.equal(payload.item.id, 'agent-terminal')
  assert.deepEqual(payload.item.geometry.modelTransform.position, { x: 0.07, y: 0, z: 0 })
  assert.deepEqual(payload.item.geometry.visibility, { model: false })
  assert.equal(payload.item.geometry.hoverSpinSpeed, 1.8)
  assert.equal(payload.registry.canvas_id, 'preview')
  assert.deepEqual(payload.registry.objects.map((object) => object.object_id), [
    AGENT_TERMINAL_MODEL_OBJECT_ID,
    AGENT_TERMINAL_SCREEN_OBJECT_ID,
  ])
})

test('radial item editor exposes an AOS workbench subject descriptor', () => {
  const state = createRadialItemEditorState({
    itemId: 'wiki-graph',
    canvasId: 'preview',
  })
  const subject = buildRadialItemWorkbenchSubject(state)

  assert.equal(subject.type, 'aos.workbench.subject')
  assert.equal(subject.id, 'sigil.radial_menu.item:wiki-graph')
  assert.equal(subject.subject_type, 'sigil.radial_menu.item_3d')
  assert.equal(subject.owner, 'sigil.radial-item-editor')
  assert.equal(subject.state.canvas_id, 'preview')
  assert.equal(subject.state.object_count, 4)
  assert.ok(subject.capabilities.includes('canvas_object.registry'))
  assert.ok(subject.capabilities.includes('sigil.radial_item_editor.lock_in'))
})

test('radial item editor lock-in payload is detached from later state mutation', () => {
  const state = createRadialItemEditorState({
    itemId: 'agent-terminal',
    canvasId: 'preview',
  })
  const payload = exportSelectedRadialItemDefinition(state, {
    generatedAt: '2026-05-03T12:00:00.000Z',
  })

  applyEditorObjectPatch(state, {
    type: 'canvas_object.transform.patch',
    schema_version: '2026-05-03',
    request_id: 'req-terminal-export-after',
    target: {
      canvas_id: 'preview',
      object_id: AGENT_TERMINAL_MODEL_OBJECT_ID,
    },
    patch: {
      position: { x: 1 },
    },
  })

  assert.equal(payload.item.geometry.modelTransform, undefined)
  assert.equal(payload.registry.objects[0].transform.position.x, 0)
})
