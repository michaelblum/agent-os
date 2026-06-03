import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSigilUxTree } from '../../apps/sigil/renderer/live-modules/ux-tree.js'
import {
  createSigilUxTreeCommandRegistry,
  createSigilUxTreeCommandRouteCatalog,
  resolveSigilUxTreeCommandRegistryHandler,
} from '../../apps/sigil/renderer/live-modules/ux-tree-command-registry.js'
import { createSigilUxTreeReadinessAudit } from '../../apps/sigil/renderer/live-modules/ux-tree-readiness.js'

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function completeRegistry() {
  return createSigilUxTreeCommandRegistry({
    avatarPressBegin() {},
    avatarGotoBegin() {},
    radialBegin() {},
    radialReleaseItem() {},
    selectionModeEnter() {},
    selectionModeCancel() {},
    selectionModeCommit() {},
    selectionModeCycleTarget() {},
    selectionModeAcquire() {},
    avatarControlsOpen() {},
    avatarControlsToggle() {},
    annotationReticleEnter() {},
    annotationCameraCaptureBundle() {},
    wikiGraphOpen() {},
    agentTerminalOpen() {},
  })
}

test('Sigil UX tree readiness audit proves command handlers, routed bindings, mechanics, and relations', () => {
  const tree = createSigilUxTree()
  const audit = createSigilUxTreeReadinessAudit(tree, {
    registry: completeRegistry(),
  })

  assert.equal(audit.schema, 'sigil_ux_tree_readiness_audit')
  assert.equal(audit.ok, true)
  assert.equal(audit.failures.length, 0)
  assert.equal(audit.summary.commands_total, tree.commands.length)
  assert.equal(audit.summary.commands_registered, tree.commands.length)
  assert.equal(audit.summary.bindings_total, tree.bindings.length)
  assert.equal(audit.summary.bindings_routed, tree.bindings.length)
  assert.equal(audit.summary.bindings_unclassified, 0)

  const commandStatuses = new Map(audit.commandCoverage.map((entry) => [entry.id, entry.status]))
  for (const command of tree.commands) {
    assert.equal(commandStatuses.get(command.id), 'registered_runtime_handler', command.id)
  }

  const mechanicIds = new Set(audit.directRuntimeMechanics.map((entry) => entry.id))
  assert.ok(mechanicIds.has('sigil.radial.pointer_tracking'))
  assert.ok(mechanicIds.has('sigil.selection_mode.entry_release'))
  assert.ok(mechanicIds.has('sigil.avatar.controls.duplicate_echo'))

  const relationIds = new Set(audit.relationTopology.map((entry) => entry.id))
  assert.ok(relationIds.has('sigil.avatar.body.triggers_radial_menu'))
  assert.ok(relationIds.has('sigil.avatar.anchors_radial_menu'))
  assert.ok(relationIds.has('sigil.avatar.radial_menu.targets_items'))
})

test('Sigil UX tree readiness audit fails closed for invalid tree validation', () => {
  const tree = cloneJson(createSigilUxTree())
  tree.validation = {
    ok: false,
    errors: [{ code: 'tree.invalid', message: 'test invalid tree', path: '/test' }],
  }

  const audit = createSigilUxTreeReadinessAudit(tree, {
    registry: completeRegistry(),
  })

  assert.equal(audit.ok, false)
  assert.equal(audit.summary.validation_errors, 1)
  assert.ok(audit.failures.some((failure) => (
    failure.kind === 'validation'
      && failure.code === 'tree.invalid'
      && failure.path === '/test'
  )))
})

test('Sigil UX tree readiness audit fails closed for routed bindings with missing commands', () => {
  const tree = cloneJson(createSigilUxTree())
  tree.validation = { ok: true, errors: [] }
  tree.commands = tree.commands.filter((command) => command.id !== 'sigil.avatar.controls.open')

  const audit = createSigilUxTreeReadinessAudit(tree, {
    registry: completeRegistry(),
  })

  assert.equal(audit.ok, false)
  assert.ok(audit.summary.validation_errors > 0)
  assert.ok(audit.summary.bindings_routed_missing_command > 0)
  assert.ok(audit.failures.some((failure) => (
    failure.kind === 'binding'
      && failure.id === 'sigil.avatar.controls.right_click'
      && failure.command_id === 'sigil.avatar.controls.open'
  )))
})

test('Sigil UX tree readiness audit fails closed for invalid relation topology', () => {
  const tree = cloneJson(createSigilUxTree())
  tree.validation = { ok: true, errors: [] }
  tree.relations = tree.relations.map((relation) => relation.id === 'sigil.avatar.anchors_radial_menu'
    ? {
        ...relation,
        to_node_id: 'sigil.missing.radial_menu',
      }
    : relation)

  const audit = createSigilUxTreeReadinessAudit(tree, {
    registry: completeRegistry(),
  })

  assert.equal(audit.ok, false)
  assert.ok(audit.failures.some((failure) => (
    failure.kind === 'validation'
      && failure.code === 'relation.to_node_ref'
  )))
})

test('Sigil UX tree readiness audit does not certify bindings outside the adapter route catalog', () => {
  const tree = createSigilUxTree()
  const routedCommandRoutes = createSigilUxTreeCommandRouteCatalog(tree)
    .filter((route) => route.binding_id !== 'sigil.avatar.controls.right_click')

  const audit = createSigilUxTreeReadinessAudit(tree, {
    registry: completeRegistry(),
    routedCommandRoutes,
  })

  assert.equal(audit.ok, false)
  assert.equal(audit.summary.bindings_unclassified, 1)
  assert.ok(audit.failures.some((failure) => (
    failure.kind === 'binding'
      && failure.id === 'sigil.avatar.controls.right_click'
      && /neither routed/.test(failure.reason)
  )))
})

test('Sigil UX tree readiness audit fails closed for unregistered commands and unclassified bindings', () => {
  const tree = createSigilUxTree()
  const audit = createSigilUxTreeReadinessAudit({
    ...tree,
    bindings: [
      ...tree.bindings,
      {
        id: 'sigil.test.unclassified',
        node_id: 'sigil.avatar.body',
        mode: 'idle',
        gesture: 'pointer.middle.click',
        command_id: 'sigil.avatar.controls.open',
      },
    ],
  }, {
    registry: {},
  })

  assert.equal(audit.ok, false)
  assert.ok(audit.failures.some((failure) => failure.kind === 'command' && failure.id === 'sigil.avatar.controls.open'))
  assert.ok(audit.failures.some((failure) => failure.kind === 'binding' && failure.id === 'sigil.test.unclassified'))
})

test('Sigil UX tree readiness uses executor-owned handler lookup semantics', () => {
  const tree = cloneJson(createSigilUxTree())
  tree.validation = { ok: true, errors: [] }
  tree.commands = tree.commands.map((command) => command.id === 'sigil.selection_mode.cancel'
    ? {
        ...command,
        handler_ref: 'toString',
      }
    : command)
  const inheritedAudit = createSigilUxTreeReadinessAudit(tree, {
    registry: {},
  })
  assert.equal(inheritedAudit.ok, false)
  assert.ok(inheritedAudit.failures.some((failure) => (
    failure.kind === 'command'
      && failure.id === 'sigil.selection_mode.cancel'
  )))

  const registry = Object.create(null)
  Object.defineProperty(registry, 'toString', {
    value() {},
  })
  const handler = resolveSigilUxTreeCommandRegistryHandler(
    registry,
    tree.commands.find((command) => command.id === 'sigil.selection_mode.cancel'),
  )
  const ownHandlerAudit = createSigilUxTreeReadinessAudit(tree, {
    registry,
  })

  assert.equal(typeof handler.handler, 'function')
  assert.equal(ownHandlerAudit.commandCoverage
    .find((entry) => entry.id === 'sigil.selection_mode.cancel')
    .status, 'registered_runtime_handler')
})
