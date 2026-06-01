import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_SIGIL_RADIAL_ITEMS } from '../../apps/sigil/renderer/radial-menu-defaults.js'
import {
  AGENT_TERMINAL_MODEL_OBJECT_ID,
  AGENT_TERMINAL_SCREEN_OBJECT_ID,
  WIKI_BRAIN_FIBER_BLOOM_OBJECT_ID,
  WIKI_BRAIN_FIBER_OPTICS_GROUP_OBJECT_ID,
  WIKI_BRAIN_FIBER_STEM_OBJECT_ID,
  WIKI_BRAIN_FRACTAL_TREE_OBJECT_ID,
  WIKI_BRAIN_GROUP_OBJECT_ID,
  WIKI_BRAIN_SHELL_OBJECT_ID,
} from '../../apps/sigil/renderer/live-modules/radial-object-control.js'
import {
  AVATAR_AURA_OBJECT_ID,
  AVATAR_OMEGA_OBJECT_ID,
  AVATAR_PRIMARY_OBJECT_ID,
  AVATAR_PRIMARY_TESSERON_OBJECT_ID,
  AVATAR_ROOT_OBJECT_ID,
} from '../../apps/sigil/renderer/live-modules/avatar-object-control.js'
import {
  AVATAR_SUBJECT_TYPE,
  applyEditorEffectsPatch,
  applyEditorObjectPatch,
  applyRadialItemVisualObjectDescriptorUpdate,
  applyThingEditorEffectsPatch,
  applyThingEditorObjectPatch,
  buildThingEditorObjectRegistry,
  buildThingEditorPreview,
  buildThingEditorWorkbenchSubject,
  buildRadialItemWorkbenchSubject,
  buildEditorObjectRegistry,
  buildEditorRadialSnapshot,
  createRadialItemEditorState,
  editableRadialItems,
  exportSelectedRadialItemDefinition,
  exportThingEditorSubject,
  loadThingEditorSubject,
  RADIAL_ITEM_SUBJECT_TYPE,
  selectRadialItem,
  selectedItemFractalPulse,
  selectedRadialItem,
  selectedTerminalScreenMaterial,
  patchSelectedTerminalScreenMaterial,
  setRadialMenuWorkbenchSubjectFactory,
  setVisualObjectControllerUpdate,
  setSelectedItemFractalPulseIntensity,
  setSelectedItemHoverSpin,
} from '../../apps/sigil/radial-item-editor/model.js'
import { createRadialMenuWorkbenchSubject } from '../../packages/toolkit/workbench/radial-menu-subject.js'
import { applyVisualObjectControllerUpdate } from '../../packages/toolkit/workbench/visual-object-controller.js'
import {
  createVisualObjectResourceLifecycleEvidence,
  validateVisualObjectResourceLifecycleEvidence,
} from '../../packages/toolkit/workbench/visual-object-resource-lifecycle.js'
import {
  subjectCapabilities,
  subjectContracts,
  subjectFacets,
  subjectHosts,
} from '../../packages/toolkit/workbench/subject.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')
const canvasObjectControlSchemaPath = path.join(repoRoot, 'shared/schemas/canvas-object-control.schema.json')

setRadialMenuWorkbenchSubjectFactory(createRadialMenuWorkbenchSubject)
setVisualObjectControllerUpdate(applyVisualObjectControllerUpdate)

function assertValidCanvasObjectControlMessage(message) {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator

schema = json.loads(Path(sys.argv[1]).read_text())
instance = json.loads(sys.stdin.read())
Draft202012Validator.check_schema(schema)
validator = Draft202012Validator(schema)
errors = sorted(validator.iter_errors(instance), key=lambda error: list(error.path))
if errors:
    for error in errors[:8]:
        print(error.message)
    sys.exit(1)
`,
      canvasObjectControlSchemaPath,
    ],
    {
      input: JSON.stringify(message),
      encoding: 'utf8',
    },
  )
  assert.equal(result.status, 0, `expected canonical canvas object control message\n${result.stdout}${result.stderr}`)
}

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
    WIKI_BRAIN_GROUP_OBJECT_ID,
    WIKI_BRAIN_SHELL_OBJECT_ID,
    WIKI_BRAIN_FIBER_OPTICS_GROUP_OBJECT_ID,
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

test('radial item editor applies effects patches through the selected subject', () => {
  const state = createRadialItemEditorState({ itemId: 'wiki-graph', canvasId: 'preview' })

  const result = applyEditorEffectsPatch(state, {
    type: 'canvas_object.effects.patch',
    schema_version: '2026-05-03',
    request_id: 'req-editor-effects',
    target: {
      canvas_id: 'preview',
      object_id: WIKI_BRAIN_FRACTAL_TREE_OBJECT_ID,
    },
    patch: {
      controls: {
        'fractalPulse.intensity': 1.8,
      },
    },
  })

  assert.equal(result.status, 'applied')
  assert.deepEqual(result.controls, { 'fractalPulse.intensity': 1.8 })
  assert.equal(selectedRadialItem(state).geometry.radialEffect.fractalPulse.intensity, 1.8)
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
  assert.equal(payload.subject.id, 'aos.radial_menu:sigil.radial.main')
  assert.equal(payload.subject.subject_type, 'aos.radial_menu.3d')
  assert.equal(payload.subject.state.selected_item_id, 'agent-terminal')
  assert.equal(payload.subject.state.selected_resource_path, 'item/agent-terminal')
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
  assert.equal(subject.id, 'aos.radial_menu:sigil.radial.main')
  assert.equal(subject.subject_type, 'aos.radial_menu.3d')
  assert.equal(subject.owner, 'sigil.radial-item-editor')
  assert.equal(subject.state.canvas_id, 'preview')
  assert.equal(subject.state.object_count, 6)
  assert.equal(subject.state.selected_item_id, 'wiki-graph')
  assert.equal(subject.state.selected_resource_path, 'item/wiki-graph')
  assert.deepEqual(subjectCapabilities(subject), ['inspectable', 'editable', 'exportable'])
  assert.ok(!subject.capabilities.some((capability) => capability.includes('.')))
  assert.ok(subjectContracts(subject).includes('canvas_object.registry'))
  assert.ok(subjectContracts(subject).includes('canvas_object.effects.patch'))
  assert.ok(subjectContracts(subject).includes('aos.radial_menu.export'))
  assert.ok(subjectContracts(subject).includes('canvas_object.transform.patch'))
  const facets = subjectFacets(subject)
  assert.deepEqual(facets.map((facet) => facet.key), [
    'menu-overview',
    'menu-config',
    'item-config',
    'source-notes',
    'radial-preview',
    'object-registry',
    'object-controls',
    'animation-controls',
    'export-lock-in',
  ])
  assert.ok(facets.find((facet) => facet.key === 'export-lock-in').contracts.includes('aos.radial_menu.export'))
  assert.ok(subjectHosts(subject).every((host) => host.kind === 'canvas' && host.target_dialect === 'canvas'))
  assert.equal(subjectHosts(subject)[0].entry.value, 'preview')
  assert.equal('views' in subject, false)
  assert.equal('controls' in subject, false)
})

test('radial item editor workbench subject preserves edited non-default item sets', () => {
  const wikiItem = DEFAULT_SIGIL_RADIAL_ITEMS.find((item) => item.id === 'wiki-graph')
  const editedItem = {
    ...wikiItem,
    id: 'custom-edited-item',
    label: 'Edited Custom Item',
    action: 'editedCustomAction',
  }
  const state = createRadialItemEditorState({
    items: [editedItem],
    itemId: 'custom-edited-item',
    canvasId: 'preview',
  })
  const subject = buildRadialItemWorkbenchSubject(state)

  assert.equal(subject.state.selected_item_id, 'custom-edited-item')
  assert.equal(subject.state.selected_resource_path, 'item/custom-edited-item')
  assert.deepEqual(
    subject.state.logical_items.map((item) => [item.id, item.label, item.action]),
    [['custom-edited-item', 'Edited Custom Item', 'editedCustomAction']]
  )
})

test('radial item visual descriptors route transform edits through editor patch and sync paths', () => {
  const state = createRadialItemEditorState({
    itemId: 'wiki-graph',
    canvasId: 'preview',
  })
  const routeCalls = []
  const syncCalls = []
  const subject = buildRadialItemWorkbenchSubject(state)
  const descriptor = subject.state.visual_object_descriptors.find((entry) => (
    entry.id === 'radial-menu-sigil.radial.main-wiki-graph-radius-scale'
  ))

  const result = applyRadialItemVisualObjectDescriptorUpdate(state, {
    descriptor,
    value: '1.35',
    requestId: 'req-visual-transform',
    onRouteResult({ message, result: routeResult }) {
      routeCalls.push([message.type, routeResult.status, routeResult.target.object_id, routeResult.transform.scale.x])
    },
    onSync({ label }) {
      syncCalls.push(label)
      return { status: 'synced', label }
    },
  })
  const item = selectedRadialItem(state)
  const registry = buildEditorObjectRegistry(state)
  const preview = buildEditorRadialSnapshot(state)
  const roundTrip = JSON.parse(JSON.stringify(exportSelectedRadialItemDefinition(state, {
    generatedAt: '2026-05-03T12:00:00.000Z',
  })))

  assert.equal(result.route, 'canvas_object.transform.patch')
  assert.equal(result.value, 1.35)
  assert.equal(item.geometry.radiusScale, 1.35)
  assert.deepEqual(item.geometry.modelTransform.scale, { x: 1.35, y: 1.35, z: 1.35 })
  assert.deepEqual(routeCalls, [
    ['canvas_object.transform.patch', 'applied', WIKI_BRAIN_GROUP_OBJECT_ID, 1.35],
  ])
  assert.deepEqual(syncCalls, ['resolveRadialMenuConfig', 'renderRadialMenuPreview'])
  assert.equal(registry.objects.find((object) => object.object_id === WIKI_BRAIN_GROUP_OBJECT_ID).transform.scale.x, 1.35)
  assert.equal(preview.items[0].geometry.radiusScale, 1.35)
  assert.equal(roundTrip.item.geometry.radiusScale, 1.35)
  const evidence = createVisualObjectResourceLifecycleEvidence({
    descriptor,
    updateResult: result,
    editCount: 1,
    retainedResources: [state, registry.objects.find((object) => object.object_id === WIKI_BRAIN_GROUP_OBJECT_ID)],
    retainedResourceLimit: 2,
    identityStable: selectedRadialItem(state) === item,
    jsonSerializableState: roundTrip,
  })
  assert.equal(evidence.route, 'canvas_object.transform.patch')
  assert.equal(evidence.identity_stable, true)
  assert.equal(validateVisualObjectResourceLifecycleEvidence(evidence).ok, true)
})

test('radial item visual descriptors route visibility edits through editor patch and sync paths', () => {
  const state = createRadialItemEditorState({
    itemId: 'wiki-graph',
    canvasId: 'preview',
  })
  const routeCalls = []
  const syncCalls = []

  const result = applyRadialItemVisualObjectDescriptorUpdate(state, {
    descriptorId: 'radial-menu-sigil.radial.main-wiki-graph-visible',
    value: 'false',
    requestId: 'req-visual-visibility',
    onRouteResult({ message, result: routeResult }) {
      routeCalls.push([message.type, message.patch.visible, routeResult.status, routeResult.visible])
    },
    onSync({ label }) {
      syncCalls.push(label)
      return { status: 'synced', label }
    },
  })
  const item = selectedRadialItem(state)
  const registry = buildEditorObjectRegistry(state)
  const exported = exportSelectedRadialItemDefinition(state, {
    generatedAt: '2026-05-03T12:00:00.000Z',
  })
  const serialized = JSON.parse(JSON.stringify(exported))

  assert.equal(result.route, 'canvas_object.visibility.patch')
  assert.equal(result.value, true)
  assert.equal(item.hidden, true)
  assert.deepEqual(item.geometry.visibility, { model: false })
  assert.deepEqual(routeCalls, [
    ['canvas_object.transform.patch', false, 'applied', false],
  ])
  assert.deepEqual(syncCalls, ['resolveRadialMenuConfig', 'renderRadialMenuPreview'])
  assert.equal(registry.objects.find((object) => object.object_id === WIKI_BRAIN_GROUP_OBJECT_ID).visible, false)
  assert.equal(serialized.item.hidden, true)
  assert.deepEqual(serialized.item.geometry.visibility, { model: false })
})

test('3D thing editor loader preserves radial subject registry, preview, patches, and lock-in action', () => {
  const state = createRadialItemEditorState({
    itemId: 'agent-terminal',
    canvasId: 'preview',
  })
  const subject = loadThingEditorSubject({
    subject_type: RADIAL_ITEM_SUBJECT_TYPE,
    state,
  })

  assert.equal(subject.subject_id, 'sigil.radial_menu.item:agent-terminal')
  assert.equal(subject.subject_type, 'sigil.radial_menu.item_3d')
  assert.equal(buildThingEditorObjectRegistry(subject).objects[0].object_id, AGENT_TERMINAL_MODEL_OBJECT_ID)
  assert.equal(buildThingEditorPreview(subject, { width: 640, height: 480 }).activeItemId, 'agent-terminal')

  const result = applyThingEditorObjectPatch(subject, {
    type: 'canvas_object.transform.patch',
    schema_version: '2026-05-03',
    request_id: 'req-loader-radial',
    target: {
      canvas_id: 'preview',
      object_id: AGENT_TERMINAL_MODEL_OBJECT_ID,
    },
    patch: {
      scale: { z: 1.4 },
    },
  })

  assert.equal(result.status, 'applied')
  assert.deepEqual(selectedRadialItem(state).geometry.modelTransform.scale, { x: 1, y: 1, z: 1.4 })
  assert.equal(exportThingEditorSubject(subject, { generatedAt: '2026-05-03T12:00:00.000Z' }).type, 'sigil.radial_item_editor.lock_in')
})

test('3D thing editor loader builds an avatar subject descriptor from the avatar object graph adapter', () => {
  const subject = loadThingEditorSubject({
    subject_type: AVATAR_SUBJECT_TYPE,
    canvasId: 'avatar-main',
    rendererState: {
      currentGeometryType: 12,
      stellationFactor: 0.3,
      currentOpacity: 0.42,
      currentEdgeOpacity: 0.88,
      z_depth: 1.2,
      appScale: 1.5,
      tesseron: { enabled: true, proportion: 0.44, matchMother: false },
      isAuraEnabled: true,
      auraIntensity: 1.7,
      auraReach: 2.1,
      isOmegaEnabled: true,
      omegaGeometryType: 8,
      omegaScale: 2.2,
      radialGestureMenu: { items: [] },
    },
    avatarPos: { x: 10, y: 20, z: 0 },
  })
  const registry = buildThingEditorObjectRegistry(subject)

  assert.equal(subject.subject_id, 'sigil.avatar:avatar-main')
  assert.equal(subject.subject_type, AVATAR_SUBJECT_TYPE)
  assert.equal(registry.type, 'canvas_object.registry')
  assert.equal(registry.canvas_id, 'avatar-main')
  assert.ok(registry.objects.find((object) => object.object_id === AVATAR_ROOT_OBJECT_ID))
  assert.ok(registry.objects.find((object) => object.object_id === AVATAR_PRIMARY_OBJECT_ID))
  assert.ok(registry.objects.find((object) => object.object_id === AVATAR_PRIMARY_TESSERON_OBJECT_ID))
  assert.ok(registry.objects.find((object) => object.object_id === AVATAR_AURA_OBJECT_ID))
  assert.ok(registry.objects.find((object) => object.object_id === AVATAR_OMEGA_OBJECT_ID))

  const workbenchSubject = buildThingEditorWorkbenchSubject(subject)
  const objectControlsFacet = subjectFacets(workbenchSubject).find((facet) => facet.key === 'object-controls')
  assert.equal(workbenchSubject.type, 'aos.workbench.subject')
  assert.equal(workbenchSubject.subject_type, AVATAR_SUBJECT_TYPE)
  assert.ok(subjectContracts(workbenchSubject).includes('canvas_object.registry'))
  assert.ok(subjectContracts(workbenchSubject).includes('canvas_object.effects.patch'))
  assert.ok(!subjectContracts(workbenchSubject).includes('canvas_object.visibility.patch'))
  assert.deepEqual(subjectFacets(workbenchSubject).map((facet) => facet.key), [
    'object-registry',
    'object-controls',
    'preview',
    'owner-actions',
  ])
  assert.deepEqual(objectControlsFacet.contracts, [
    'canvas_object.transform.patch',
    'canvas_object.effects.patch',
    'sigil.avatar.action',
  ])
  assert.equal(buildThingEditorPreview(subject).status, 'owner-managed')
  assert.equal(exportThingEditorSubject(subject).status, 'owner-managed')
})

test('avatar subject patch facets return owner-managed results without mutating renderer state', () => {
  const rendererState = {
    currentGeometryType: 6,
    radialGestureMenu: { items: [] },
  }
  const subject = loadThingEditorSubject({
    subject_type: 'avatar',
    canvasId: 'avatar-main',
    rendererState,
  })

  const transform = applyThingEditorObjectPatch(subject, {
    type: 'canvas_object.transform.patch',
    request_id: 'req-avatar-transform',
    target: {
      canvas_id: 'avatar-main',
      object_id: AVATAR_PRIMARY_OBJECT_ID,
    },
    patch: { scale: { x: 2 } },
  })
  const effects = applyThingEditorEffectsPatch(subject, {
    type: 'canvas_object.effects.patch',
    request_id: 'req-avatar-effects',
    target: {
      canvas_id: 'avatar-main',
      object_id: AVATAR_AURA_OBJECT_ID,
    },
    patch: { controls: { 'aura.intensity': 2 } },
  })

  assert.equal(transform.type, 'canvas_object.transform.result')
  assert.equal(transform.status, 'rejected')
  assert.equal(transform.reason, 'unsupported_capability')
  assert.match(transform.message, /owner-managed/)
  assert.equal('error' in transform, false)
  assertValidCanvasObjectControlMessage(transform)
  assert.equal(effects.type, 'canvas_object.effects.result')
  assert.equal(effects.status, 'rejected')
  assert.equal(effects.reason, 'unsupported_capability')
  assert.match(effects.message, /owner-managed/)
  assert.equal('error' in effects, false)
  assertValidCanvasObjectControlMessage(effects)
  assert.equal(rendererState.currentGeometryType, 6)
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
