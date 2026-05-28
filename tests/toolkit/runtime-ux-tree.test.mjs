import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createUxTree,
  mergeUxTreeDefinitions,
  resolveUxTree,
  uxTreeBindingsForGesture,
  uxTreeCommandById,
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
  assert.deepEqual(merged.settings.radial.geometry, { menuRadius: 1.8, spreadDegrees: 90 })
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
