import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createUxTree,
  mergeUxTreeDefinitions,
  normalizeUxTreeRelation,
  resolveUxTree,
  uxTreeBindingsForGesture,
  uxTreeCommandById,
  uxTreeRelationsByType,
  uxTreeRelationsForNode,
} from '../../packages/toolkit/runtime/ux-tree.js'

function baseTree() {
  return {
    id: 'test.ux',
    label: 'Test UX',
    owner: 'test',
    modes: [
      { id: 'global', label: 'Global' },
      { id: 'idle', label: 'Idle' },
    ],
    nodes: [
      { id: 'avatar', label: 'Avatar', role: 'button', node_type: 'hit_target' },
      { id: 'menu', label: 'Menu', role: 'menu', node_type: 'radial_menu' },
    ],
    commands: [
      {
        id: 'menu.open',
        label: 'Open Menu',
        description: '',
        handler_ref: 'menu.open',
        parameters: {},
        safety: { execution: 'allowlisted' },
      },
      {
        id: 'radial.begin',
        label: 'Begin Radial',
        description: '',
        handler_ref: 'radial.begin',
        parameters: {},
        safety: { execution: 'allowlisted' },
      },
    ],
    bindings: [
      {
        id: 'avatar.right',
        node_id: 'avatar',
        mode: 'idle',
        gesture: 'pointer.right.click',
        command_id: 'menu.open',
        enabled: true,
        priority: 10,
        consume_policy: 'route',
      },
      {
        id: 'avatar.right.global',
        node_id: 'avatar',
        mode: 'global',
        gesture: 'pointer.right.click',
        command_id: 'radial.begin',
        enabled: true,
        priority: 1,
        consume_policy: 'observe',
      },
    ],
    relations: [
      {
        id: 'avatar.opens.menu',
        relation_type: 'opens',
        from_node_id: 'avatar',
        to_node_id: 'menu',
        metadata: {
          gesture: 'pointer.right.click',
        },
      },
    ],
    settings: {
      radial: {
        geometry: { menuRadius: 1.8 },
      },
    },
  }
}

test('createUxTree normalizes data and surfaces valid references', () => {
  const tree = createUxTree(baseTree(), { strict: true })
  assert.equal(tree.schema, 'aos_ux_tree')
  assert.equal(tree.version, '0.1.0')
  assert.equal(tree.validation.ok, true)
  assert.deepEqual(tree.nodes.map((node) => node.id), ['avatar', 'menu'])
  assert.deepEqual(tree.relations.map((relation) => relation.id), ['avatar.opens.menu'])
  assert.equal(uxTreeCommandById(tree, 'menu.open').handler_ref, 'menu.open')
})

test('mergeUxTreeDefinitions deep-merges settings and merges stable arrays by id', () => {
  const merged = mergeUxTreeDefinitions(baseTree(), {
    nodes: [
      { id: 'avatar', label: 'Avatar Body', role: 'button', node_type: 'hit_target', settings_ref: 'settings.avatar' },
      { id: 'selection', label: 'Selection', role: 'mode', node_type: 'mode_scope' },
    ],
    commands: [
      { id: 'radial.begin', label: 'Begin Radial Gesture', parameters: { threshold: 12 } },
    ],
    bindings: [
      { id: 'avatar.right', priority: 20 },
    ],
    relations: [
      { id: 'avatar.opens.menu', metadata: { anchor: 'pointer' } },
      { id: 'avatar.targets.items', relation_type: 'targets', from_node_id: 'menu', to_node_id: 'menu.item.*' },
    ],
    settings: {
      radial: {
        geometry: { spreadDegrees: 90 },
      },
    },
  })

  assert.deepEqual(merged.nodes.map((node) => node.id), ['avatar', 'menu', 'selection'])
  assert.equal(merged.nodes[0].label, 'Avatar Body')
  assert.equal(merged.commands.find((command) => command.id === 'radial.begin').label, 'Begin Radial Gesture')
  assert.equal(merged.bindings.find((binding) => binding.id === 'avatar.right').priority, 20)
  assert.equal(merged.relations.find((relation) => relation.id === 'avatar.opens.menu').metadata.anchor, 'pointer')
  assert.equal(merged.relations.find((relation) => relation.id === 'avatar.targets.items').to_node_id, 'menu.item.*')
  assert.deepEqual(merged.settings.radial.geometry, { menuRadius: 1.8, spreadDegrees: 90 })
})

test('relation helpers normalize and filter by type and node direction', () => {
  const tree = createUxTree({
    ...baseTree(),
    relations: [
      { id: 'avatar.opens.menu', relation_type: 'opens', from_node_id: 'avatar', to_node_id: 'menu' },
      { id: 'menu.targets.items', relation_type: 'targets', from_node_id: 'menu', to_node_id: 'menu.item.*' },
    ],
  }, { strict: true })

  assert.deepEqual(normalizeUxTreeRelation({ id: 'rel', type: 'anchors', from_node_id: 'avatar', to_node_id: 'menu' }), {
    id: 'rel',
    relation_type: 'anchors',
    from_node_id: 'avatar',
    to_node_id: 'menu',
    source_metadata: {},
    metadata: {},
  })
  assert.deepEqual(uxTreeRelationsByType(tree, 'targets').map((relation) => relation.id), ['menu.targets.items'])
  assert.deepEqual(uxTreeRelationsForNode(tree, 'avatar', { direction: 'from' }).map((relation) => relation.id), ['avatar.opens.menu'])
  assert.deepEqual(uxTreeRelationsForNode(tree, 'menu', { direction: 'incoming' }).map((relation) => relation.id), ['avatar.opens.menu'])
})

test('uxTreeBindingsForGesture returns enabled mode matches before lower-priority global matches', () => {
  const tree = createUxTree(baseTree())
  const matches = uxTreeBindingsForGesture(tree, {
    nodeId: 'avatar',
    mode: 'idle',
    gesture: 'pointer.right.click',
  })

  assert.deepEqual(matches.map((binding) => binding.id), ['avatar.right', 'avatar.right.global'])
  assert.equal(uxTreeCommandById(tree, matches[0].command_id).id, 'menu.open')
})

test('resolveUxTree returns validation metadata for invalid references and can throw in strict mode', () => {
  const invalid = baseTree()
  invalid.bindings[0] = { ...invalid.bindings[0], command_id: 'missing' }

  const resolved = resolveUxTree(invalid)
  assert.equal(resolved.validation.ok, false)
  assert.ok(resolved.validation.errors.some((error) => error.code === 'binding.command_ref'))
  assert.throws(() => resolveUxTree(invalid, { strict: true }), /Invalid UX tree/)
})

test('resolveUxTree validates relation node references and collection targets', () => {
  const unknownFrom = baseTree()
  unknownFrom.relations = [
    { id: 'missing.opens.menu', relation_type: 'opens', from_node_id: 'missing', to_node_id: 'menu' },
  ]
  const unknownFromResolved = resolveUxTree(unknownFrom)
  assert.equal(unknownFromResolved.validation.ok, false)
  assert.ok(unknownFromResolved.validation.errors.some((error) => error.code === 'relation.from_node_ref'))

  const unknownTo = baseTree()
  unknownTo.relations = [
    { id: 'avatar.opens.missing', relation_type: 'opens', from_node_id: 'avatar', to_node_id: 'missing' },
  ]
  const unknownToResolved = resolveUxTree(unknownTo)
  assert.equal(unknownToResolved.validation.ok, false)
  assert.ok(unknownToResolved.validation.errors.some((error) => error.code === 'relation.to_node_ref'))

  const wildcardTarget = resolveUxTree({
    ...baseTree(),
    relations: [
      { id: 'menu.targets.items', relation_type: 'targets', from_node_id: 'menu', to_node_id: 'menu.item.*' },
    ],
  })
  assert.equal(wildcardTarget.validation.ok, true)

  const wildcardOpen = resolveUxTree({
    ...baseTree(),
    relations: [
      { id: 'avatar.opens.items', relation_type: 'opens', from_node_id: 'avatar', to_node_id: 'menu.item.*' },
    ],
  })
  assert.equal(wildcardOpen.validation.ok, false)
  assert.ok(wildcardOpen.validation.errors.some((error) => error.code === 'relation.collection_target'))
})

test('resolveUxTree rejects executable relation metadata', () => {
  const invalid = baseTree()
  invalid.relations = [
    {
      id: 'avatar.opens.menu',
      relation_type: 'opens',
      from_node_id: 'avatar',
      to_node_id: 'menu',
      metadata: { onOpen() {} },
    },
  ]

  const resolved = resolveUxTree(invalid)
  assert.equal(resolved.validation.ok, false)
  assert.ok(resolved.validation.errors.some((error) => error.code === 'relation.metadata.executable'))
})

test('resolveUxTree rejects non-string command handler refs before normalization', () => {
  const invalid = baseTree()
  invalid.commands[0] = {
    ...invalid.commands[0],
    handler_ref: { javascript: 'alert(1)' },
  }

  const resolved = resolveUxTree(invalid)
  assert.equal(resolved.validation.ok, false)
  assert.ok(resolved.validation.errors.some((error) => error.code === 'command.handler_ref.type'))
  assert.throws(() => resolveUxTree(invalid, { strict: true }), /handler_ref must be a string/)
})

test('resolveUxTree rejects unsafe command handler and execution values', () => {
  const invalid = baseTree()
  invalid.commands[0] = {
    ...invalid.commands[0],
    handler_ref: 'menu.open()',
    safety: { execution: 'inline' },
  }

  const resolved = resolveUxTree(invalid)
  assert.equal(resolved.validation.ok, false)
  assert.ok(resolved.validation.errors.some((error) => error.code === 'command.handler_ref.pattern'))
  assert.ok(resolved.validation.errors.some((error) => error.code === 'command.safety.execution'))
  assert.throws(() => resolveUxTree(invalid, { strict: true }), /allowlisted reference/)
})

test('resolveUxTree rejects embedded source and node resource refs', () => {
  const invalid = baseTree()
  invalid.source_refs = [{ id: 'embedded', kind: 'asset', ref: 'data:text/plain;base64,SGk=' }]
  invalid.nodes[0] = {
    ...invalid.nodes[0],
    resource_refs: [{ id: 'blob', kind: 'asset', ref: 'blob:https://example.test/resource' }],
  }

  const resolved = resolveUxTree(invalid)
  assert.equal(resolved.validation.ok, false)
  assert.ok(resolved.validation.errors.some((error) => error.code === 'source.binary'))
  assert.ok(resolved.validation.errors.some((error) => error.code === 'resource.binary'))
  assert.throws(() => resolveUxTree(invalid, { strict: true }), /data\/blob payloads/)
})
