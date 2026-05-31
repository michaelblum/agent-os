import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import sigilMenu from '../../apps/sigil/renderer/radial-menu/sigil-radial-menu.json' with { type: 'json' }
import default3d from '../../packages/toolkit/runtime/radial-menu/default-3d.json' with { type: 'json' }
import { resolveRadialMenuConfig } from '../../packages/toolkit/runtime/radial-menu-config.js'
import {
  createRadialMenuWorkbenchSubject,
  createRadialMenuVisualObjectDescriptors,
  radialMenuEntryHandle,
  radialMenuLogicalItems,
  radialMenuResourceEntryHandle,
  radialMenuResourceSubjectId,
  RADIAL_MENU_RESOURCE_FACETS,
  RADIAL_MENU_SUBJECT_TYPE,
} from '../../packages/toolkit/workbench/radial-menu-subject.js'
import {
  parseSubjectEntryHandle,
  subjectEntryHandleFacetKey,
  subjectEntryHandleSubjectId,
} from '../../packages/toolkit/workbench/subject-entry-handle.js'
import {
  subjectContracts,
  subjectFacets,
  subjectReferences,
} from '../../packages/toolkit/workbench/subject.js'
import {
  validateVisualObjectDescriptors,
  VISUAL_OBJECT_DESCRIPTOR_CONTRACT_ID,
} from '../../packages/toolkit/workbench/visual-object-contract.js'
import { applyVisualObjectControllerUpdate } from '../../packages/toolkit/workbench/visual-object-controller.js'

function resolvedSigilMenu() {
  return resolveRadialMenuConfig(sigilMenu, {
    allowExtends: {
      'aos://toolkit/runtime/radial-menu/default-3d.json': default3d,
    },
  })
}

test('radial menu workbench subject exposes reusable facets and logical items', () => {
  const menu = resolvedSigilMenu()
  const subject = createRadialMenuWorkbenchSubject({
    menu,
    owner: 'sigil.radial-item-editor',
    canvasId: 'preview',
    selectedItemId: 'wiki-graph',
  })

  assert.equal(subject.type, 'aos.workbench.subject')
  assert.equal(subject.subject_type, RADIAL_MENU_SUBJECT_TYPE)
  assert.equal(subject.id, 'aos.radial_menu:sigil.radial.main')
  assert.equal(subject.owner, 'sigil.radial-item-editor')
  assert.equal(subject.state.selected_item_id, 'wiki-graph')
  assert.equal(subject.state.selected_resource_path, 'item/wiki-graph')
  assert.equal(subject.state.logical_item_count, 5)
  assert.deepEqual(
    subject.state.logical_items.map((item) => [item.id, item.action]),
    [
      ['context-menu', 'contextMenu'],
      ['agent-terminal', 'agentTerminal'],
      ['annotation-mode', 'annotationMode'],
      ['annotation-camera', 'annotationSnapshot'],
      ['wiki-graph', 'wikiGraph'],
    ],
  )
  assert.equal(subject.state.visual_object_descriptors.length, 7)
  assert.equal(validateVisualObjectDescriptors(subject.state.visual_object_descriptors).ok, true)

  assert.ok(subjectContracts(subject).includes('aos.radial_menu.logical_items'))
  assert.ok(subjectContracts(subject).includes('canvas_object.registry'))
  assert.ok(subjectContracts(subject).includes('canvas_object.transform.patch'))
  assert.deepEqual(subjectFacets(subject).map((facet) => facet.key), [
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
})

test('radial menu visual descriptors validate and serialize as non-avatar contract data', () => {
  const menu = resolvedSigilMenu()
  const descriptors = createRadialMenuVisualObjectDescriptors({
    menu,
    selectedItemId: 'wiki-graph',
  })
  const roundTrip = JSON.parse(JSON.stringify(descriptors))
  const byId = new Map(roundTrip.map((descriptor) => [descriptor.id, descriptor]))

  assert.equal(roundTrip.length, 7)
  assert.equal(validateVisualObjectDescriptors(roundTrip).ok, true)
  assert.ok(roundTrip.every((descriptor) => descriptor.contract === VISUAL_OBJECT_DESCRIPTOR_CONTRACT_ID))
  assert.ok(roundTrip.every((descriptor) => descriptor.evidence_contracts.includes('non_avatar_visual_object')))
  assert.ok(roundTrip.some((descriptor) => descriptor.technology === 'threejs-3d'))
  assert.ok(roundTrip.some((descriptor) => descriptor.technology === 'dom-toolkit'))

  const selected = byId.get('radial-menu-sigil.radial.main-selected-item')
  assert.equal(selected.state_path, 'radial_menu.sigil.radial.main.selected_item_id')
  assert.equal(selected.route, 'aos.radial_menu.config.patch')
  assert.deepEqual(selected.options.map((option) => option.value), [
    'context-menu',
    'agent-terminal',
    'annotation-mode',
    'annotation-camera',
    'wiki-graph',
  ])

  const radius = byId.get('radial-menu-sigil.radial.main-wiki-graph-radius-scale')
  assert.equal(radius.route, 'canvas_object.transform.patch')
  assert.equal(radius.state_path, 'radial_menu.sigil.radial.main.items.wiki-graph.geometry.radiusScale')
  assert.deepEqual(radius.object_ids, ['radial-menu.sigil.radial.main.item.wiki-graph'])

  const visibility = byId.get('radial-menu-sigil.radial.main-wiki-graph-visible')
  assert.equal(visibility.route, 'canvas_object.visibility.patch')
  assert.equal(visibility.coerce, 'boolean_inverse')

  const effect = byId.get('radial-menu-sigil.radial.main-wiki-graph-effect-enabled')
  assert.equal(effect.route, 'canvas_object.effects.patch')
  assert.deepEqual(effect.object_ids, [
    'radial-menu.sigil.radial.main.item.wiki-graph',
    'sigil.radial.effect.nested-neural-tree',
  ])

  const preview = byId.get('radial-menu-sigil.radial.main-preview-resource')
  assert.equal(preview.projection.classification, 'projection_only')
  assert.equal(preview.projection.reason, 'runtime-or-world-projection')
  assert.equal(preview.state_path, null)

  const exportAction = byId.get('radial-menu-sigil.radial.main-export-action')
  assert.equal(exportAction.projection.classification, 'projection_only')
  assert.equal(exportAction.projection.reason, 'app-action-shortcut')
  assert.equal(exportAction.action_id, 'aos.radial_menu.export')
})

test('radial menu descriptors route representative non-avatar JSON state and renderer sync', () => {
  const menu = resolvedSigilMenu()
  const descriptors = createRadialMenuVisualObjectDescriptors({
    menu,
    selectedItemId: 'wiki-graph',
  })
  const byId = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor]))
  const state = {
    radial_menu: {
      'sigil.radial.main': {
        selected_item_id: 'wiki-graph',
        items: {
          'wiki-graph': {
            geometry: { radiusScale: 1 },
            hidden: false,
            effects: [{ enabled: true }],
          },
        },
      },
    },
  }

  const calls = []
  const routeHandlers = {
    'canvas_object.transform.patch': ({ mutation }) => calls.push(['route', mutation.route, mutation.descriptor_id, mutation.value]),
    'canvas_object.visibility.patch': ({ mutation }) => calls.push(['route', mutation.route, mutation.descriptor_id, mutation.value]),
    'canvas_object.effects.patch': ({ mutation }) => calls.push(['route', mutation.route, mutation.descriptor_id, mutation.value]),
  }
  const rendererSyncHandlers = {
    resolveRadialMenuConfig: ({ mutation }) => calls.push(['sync', 'resolveRadialMenuConfig', mutation.descriptor_id]),
    renderRadialMenuPreview: ({ mutation }) => calls.push(['sync', 'renderRadialMenuPreview', mutation.descriptor_id]),
  }
  const radius = applyVisualObjectControllerUpdate(
    byId.get('radial-menu-sigil.radial.main-wiki-graph-radius-scale'),
    '1.35',
    state,
    { routeHandlers, rendererSyncHandlers },
  )
  const visible = applyVisualObjectControllerUpdate(
    byId.get('radial-menu-sigil.radial.main-wiki-graph-visible'),
    'false',
    state,
    { routeHandlers, rendererSyncHandlers },
  )
  const effect = applyVisualObjectControllerUpdate(
    byId.get('radial-menu-sigil.radial.main-wiki-graph-effect-enabled'),
    'off',
    state,
    { routeHandlers, rendererSyncHandlers },
  )
  const roundTrip = JSON.parse(JSON.stringify(state))

  assert.equal(state.radial_menu['sigil.radial.main'].items['wiki-graph'].geometry.radiusScale, 1.35)
  assert.equal(state.radial_menu['sigil.radial.main'].items['wiki-graph'].hidden, true)
  assert.equal(state.radial_menu['sigil.radial.main'].items['wiki-graph'].effects[0].enabled, false)
  assert.equal(radius.route, 'canvas_object.transform.patch')
  assert.equal(visible.route, 'canvas_object.visibility.patch')
  assert.equal(effect.route, 'canvas_object.effects.patch')
  assert.deepEqual(calls, [
    ['route', 'canvas_object.transform.patch', 'radial-menu-sigil.radial.main-wiki-graph-radius-scale', 1.35],
    ['sync', 'resolveRadialMenuConfig', 'radial-menu-sigil.radial.main-wiki-graph-radius-scale'],
    ['sync', 'renderRadialMenuPreview', 'radial-menu-sigil.radial.main-wiki-graph-radius-scale'],
    ['route', 'canvas_object.visibility.patch', 'radial-menu-sigil.radial.main-wiki-graph-visible', true],
    ['sync', 'resolveRadialMenuConfig', 'radial-menu-sigil.radial.main-wiki-graph-visible'],
    ['sync', 'renderRadialMenuPreview', 'radial-menu-sigil.radial.main-wiki-graph-visible'],
    ['route', 'canvas_object.effects.patch', 'radial-menu-sigil.radial.main-wiki-graph-effect-enabled', false],
    ['sync', 'resolveRadialMenuConfig', 'radial-menu-sigil.radial.main-wiki-graph-effect-enabled'],
    ['sync', 'renderRadialMenuPreview', 'radial-menu-sigil.radial.main-wiki-graph-effect-enabled'],
  ])
  assert.deepEqual(radius.sync_outcomes.map((outcome) => outcome.label), [
    'resolveRadialMenuConfig',
    'renderRadialMenuPreview',
  ])
  assert.deepEqual(roundTrip, state)
})

test('radial menu entry handles address resources without graph-node promotion', () => {
  const menu = resolvedSigilMenu()
  const menuHandle = radialMenuEntryHandle(menu, RADIAL_MENU_RESOURCE_FACETS.config)
  const itemHandle = radialMenuResourceEntryHandle(menu, 'item/wiki-graph', RADIAL_MENU_RESOURCE_FACETS.objectControls)

  assert.equal(menuHandle, 'menu-config:aos.radial_menu:sigil.radial.main')
  assert.equal(subjectEntryHandleFacetKey(itemHandle), 'object-controls')
  assert.equal(subjectEntryHandleSubjectId(itemHandle), radialMenuResourceSubjectId(menu, 'item/wiki-graph'))
  assert.equal(parseSubjectEntryHandle(itemHandle).subject_id, 'aos.radial_menu:sigil.radial.main/item/wiki-graph')

  const subject = createRadialMenuWorkbenchSubject({
    menu,
    selectedItemId: 'wiki-graph',
  })
  const reference = subjectReferences(subject)[0]
  assert.equal(reference.relationship, 'selected-resource')
  assert.equal(reference.subject_type, 'aos.radial_menu.item_resource')
  assert.equal(reference.metadata.graph_node, false)
  assert.equal(reference.metadata.resource_path, 'item/wiki-graph')
})

test('radial menu logical projection is independent of Sigil modules and Three.js', () => {
  const items = radialMenuLogicalItems({
    id: 'minimal',
    items: [
      { id: 'alpha', label: 'Alpha', action: 'alphaAction', geometry: { module_ref: 'app.leaf' } },
      { id: 'hidden', label: 'Hidden', action: 'hiddenAction', hidden: true },
    ],
  })

  assert.deepEqual(items, [{
    id: 'alpha',
    label: 'Alpha',
    action: 'alphaAction',
    disabled: false,
    hidden: false,
    checked: false,
    current: false,
    role: 'menuitem',
    shortcut: null,
    typeahead: 'Alpha',
    close_on_select: true,
    target_surface: null,
    action_payload: null,
    submenu_ref: null,
    children: [],
  }])
})

test('radial menu toolkit subject helper stays free of Sigil, Three.js, DOM, and Zag imports', async () => {
  const source = await readFile(new URL('../../packages/toolkit/workbench/radial-menu-subject.js', import.meta.url), 'utf8')
  const imports = source
    .split('\n')
    .filter((line) => /^\s*import\b/.test(line))
    .join('\n')

  assert.doesNotMatch(imports, /apps\/sigil|sigil\//)
  assert.doesNotMatch(imports, /three/i)
  assert.doesNotMatch(source, /\bwindow\b|\bdocument\b/)
  assert.doesNotMatch(imports, /zag/i)
})
