import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createSigilUxTree,
  createSigilUxTreeShadowResolver,
  resolveSigilUxTreeBinding,
} from '../../apps/sigil/renderer/live-modules/ux-tree.js'

function commandFor(input) {
  const tree = createSigilUxTree({
    state: {
      avatarHitRadius: 40,
      dragThreshold: 10,
    },
    metadata: { generated_at: 'test' },
  })
  return resolveSigilUxTreeBinding(tree, input).command_id
}

test('Sigil UX tree exposes avatar, radial, selection mode, reticle, camera, and radial item nodes', () => {
  const tree = createSigilUxTree()
  const nodeIds = new Set(tree.nodes.map((node) => node.id))

  assert.equal(tree.schema, 'aos_ux_tree')
  assert.equal(tree.validation.ok, true)
  assert.ok(nodeIds.has('sigil.avatar'))
  assert.ok(nodeIds.has('sigil.avatar.body'))
  assert.ok(nodeIds.has('sigil.avatar.radial_menu'))
  assert.ok(nodeIds.has('sigil.avatar.context_menu'))
  assert.ok(nodeIds.has('sigil.avatar.selection_mode'))
  assert.ok(nodeIds.has('sigil.avatar.selection_mode.cursor_overlay'))
  assert.ok(nodeIds.has('sigil.avatar.selection_mode.ancestor_badges'))
  assert.ok(nodeIds.has('sigil.avatar.annotation_reticle'))
  assert.ok(nodeIds.has('sigil.avatar.annotation_camera'))
  assert.ok(nodeIds.has('sigil.avatar.radial_menu.item.context-menu'))
  assert.ok(nodeIds.has('sigil.avatar.radial_menu.item.agent-terminal'))
  assert.ok(nodeIds.has('sigil.avatar.radial_menu.item.annotation-mode'))
  assert.ok(nodeIds.has('sigil.avatar.radial_menu.item.annotation-camera'))
  assert.ok(nodeIds.has('sigil.avatar.radial_menu.item.wiki-graph'))
})

test('Sigil UX tree represents current command allowlist and plain radial settings', () => {
  const tree = createSigilUxTree()
  const commandIds = new Set(tree.commands.map((command) => command.id))

  for (const id of [
    'sigil.context_menu.open',
    'sigil.context_menu.toggle',
    'sigil.avatar.goto.begin',
    'sigil.radial.begin',
    'sigil.radial.release_item',
    'sigil.selection_mode.enter',
    'sigil.selection_mode.cancel',
    'sigil.selection_mode.commit',
    'sigil.selection_mode.cycle_target',
    'sigil.selection_mode.acquire',
    'sigil.annotation_reticle.enter',
    'sigil.annotation_camera.capture_bundle',
    'sigil.wiki_graph.open',
    'sigil.agent_terminal.open',
  ]) {
    assert.ok(commandIds.has(id), `${id} command missing`)
  }
  assert.equal(tree.settings.radial.menu_config.id, 'sigil.radial.main')
  assert.equal(tree.settings.radial.items['context-menu'].action, 'contextMenu')
  assert.equal(typeof tree.commands[0].handler_ref, 'string')
})

test('Sigil shadow resolver maps avatar and Selection Mode gestures to current command IDs', () => {
  assert.equal(commandFor({
    nodeId: 'sigil.avatar.body',
    mode: 'idle',
    gesture: 'pointer.right.click',
  }), 'sigil.context_menu.open')
  assert.equal(commandFor({
    nodeId: 'sigil.avatar.context_menu',
    mode: 'global',
    gesture: 'pointer.right.click',
  }), 'sigil.context_menu.toggle')
  assert.equal(commandFor({
    nodeId: 'sigil.avatar.body',
    mode: 'goto',
    gesture: 'pointer.left.double_click',
  }), 'sigil.selection_mode.enter')
  assert.equal(commandFor({
    nodeId: 'sigil.avatar.body',
    mode: 'press',
    gesture: 'pointer.left.drag_threshold',
  }), 'sigil.radial.begin')
  assert.equal(commandFor({
    nodeId: 'sigil.avatar.selection_mode',
    mode: 'selection_mode',
    gesture: 'key.escape',
  }), 'sigil.selection_mode.cancel')
  assert.equal(commandFor({
    nodeId: 'sigil.avatar.selection_mode',
    mode: 'selection_mode',
    gesture: 'key.enter',
  }), 'sigil.selection_mode.commit')
  assert.equal(commandFor({
    nodeId: 'sigil.avatar.selection_mode',
    mode: 'selection_mode',
    gesture: 'key.tab',
  }), 'sigil.selection_mode.cycle_target')
  assert.equal(commandFor({
    nodeId: 'sigil.avatar.selection_mode',
    mode: 'selection_mode',
    gesture: 'key.arrow_up',
  }), 'sigil.selection_mode.cycle_target')
  assert.equal(commandFor({
    nodeId: 'sigil.avatar.selection_mode',
    mode: 'selection_mode',
    gesture: 'key.arrow_down',
  }), 'sigil.selection_mode.cycle_target')
  assert.equal(commandFor({
    nodeId: 'sigil.avatar.selection_mode',
    mode: 'selection_mode',
    gesture: 'pointer.left.click',
  }), 'sigil.selection_mode.acquire')
})

test('Sigil shadow resolver maps radial item release using the item id', () => {
  const tree = createSigilUxTree()
  const resolver = createSigilUxTreeShadowResolver(tree)
  const context = resolver.resolve({
    mode: 'radial',
    gesture: 'pointer.left.release',
    itemId: 'context-menu',
  })
  const terminal = resolver.resolve({
    mode: 'radial',
    gesture: 'pointer.left.release',
    itemId: 'agent-terminal',
  })

  assert.equal(context.matched, true)
  assert.equal(context.item_id, 'context-menu')
  assert.equal(context.binding.parameters.release_command_id, 'sigil.radial.release_item')
  assert.equal(context.command_id, 'sigil.context_menu.open')
  assert.equal(terminal.command_id, 'sigil.agent_terminal.open')
})
