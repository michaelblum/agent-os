import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSigilUxTree } from '../../apps/sigil/renderer/live-modules/ux-tree.js'
import { createSigilUxTreeCommandRegistry } from '../../apps/sigil/renderer/live-modules/ux-tree-command-registry.js'
import { createSigilUxTreeReadinessAudit } from '../../apps/sigil/renderer/live-modules/ux-tree-readiness.js'

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
    contextMenuOpen() {},
    contextMenuToggle() {},
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
  assert.ok(mechanicIds.has('sigil.context_menu.duplicate_echo'))

  const relationIds = new Set(audit.relationTopology.map((entry) => entry.id))
  assert.ok(relationIds.has('sigil.avatar.body.triggers_radial_menu'))
  assert.ok(relationIds.has('sigil.avatar.anchors_radial_menu'))
  assert.ok(relationIds.has('sigil.avatar.radial_menu.targets_items'))
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
        command_id: 'sigil.context_menu.open',
      },
    ],
  }, {
    registry: {},
  })

  assert.equal(audit.ok, false)
  assert.ok(audit.failures.some((failure) => failure.kind === 'command' && failure.id === 'sigil.context_menu.open'))
  assert.ok(audit.failures.some((failure) => failure.kind === 'binding' && failure.id === 'sigil.test.unclassified'))
})
