import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createUxTree } from '../../packages/toolkit/runtime/ux-tree.js'
import {
  createUxTreeWorkbenchSubject,
  uxTreeSubjectId,
  UX_TREE_RESOURCE_FACETS,
  UX_TREE_SUBJECT_TYPE,
} from '../../packages/toolkit/workbench/ux-tree-subject.js'
import {
  subjectCapabilities,
  subjectContracts,
  subjectFacets,
} from '../../packages/toolkit/workbench/subject.js'

test('UX tree workbench subject exposes read-only commands, bindings, settings, and raw JSON', () => {
  const tree = createUxTree({
    id: 'example.control.ux_tree',
    label: 'Example Control UX Tree',
    owner: 'fixture',
    modes: [{ id: 'global', label: 'Global' }],
    nodes: [{ id: 'example.control', label: 'Control', role: 'root', node_type: 'control' }],
    commands: [
      {
        id: 'example.context_menu.open',
        label: 'Open Context Menu',
        description: '',
        handler_ref: 'example.context_menu.open',
        parameters: {},
        safety: { execution: 'allowlisted' },
      },
    ],
    bindings: [
      {
        id: 'right-click',
        node_id: 'example.control',
        mode: 'global',
        gesture: 'pointer.right.click',
        command_id: 'example.context_menu.open',
        enabled: true,
        priority: 1,
        consume_policy: 'observe',
      },
    ],
    relations: [
      {
        id: 'example.control.opens_context_menu',
        relation_type: 'opens',
        from_node_id: 'example.control',
        to_node_id: 'example.control',
      },
    ],
    settings: { radial: { geometry: { menuRadius: 1.8 } } },
  })
  const subject = createUxTreeWorkbenchSubject({
    tree,
    owner: 'fixture',
    canvasId: 'example-ux-tree',
  })

  assert.equal(subject.type, 'aos.workbench.subject')
  assert.equal(subject.subject_type, UX_TREE_SUBJECT_TYPE)
  assert.equal(subject.id, uxTreeSubjectId(tree))
  assert.deepEqual(subjectCapabilities(subject), ['inspectable'])
  assert.ok(subjectContracts(subject).includes('aos.ux_tree.bindings'))
  assert.ok(subjectContracts(subject).includes('aos.ux_tree.relations'))
  assert.deepEqual(subjectFacets(subject).map((facet) => facet.key), [
    UX_TREE_RESOURCE_FACETS.overview,
    UX_TREE_RESOURCE_FACETS.bindings,
    UX_TREE_RESOURCE_FACETS.relations,
    UX_TREE_RESOURCE_FACETS.commands,
    UX_TREE_RESOURCE_FACETS.settings,
    UX_TREE_RESOURCE_FACETS.rawJson,
  ])
  assert.equal(subject.state.binding_count, 1)
  assert.equal(subject.state.relation_count, 1)
  assert.equal(subject.state.command_count, 1)
  assert.equal(subject.state.relations[0].id, 'example.control.opens_context_menu')
  assert.equal(subject.state.raw_tree.id, 'example.control.ux_tree')
  assert.equal(subject.persistence.kind, 'read_only')
})
