import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import sigilMenu from '../../apps/sigil/renderer/radial-menu/sigil-radial-menu.json' with { type: 'json' }
import default3d from '../../packages/toolkit/runtime/radial-menu/default-3d.json' with { type: 'json' }
import { resolveRadialMenuConfig } from '../../packages/toolkit/runtime/radial-menu-config.js'
import {
  createRadialMenuWorkbenchSubject,
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
