import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSigilUxTree } from '../../apps/sigil/renderer/live-modules/ux-tree.js'
import {
  SIGIL_SELECTION_MODE_ESCAPE_COMMAND_INPUT,
  createSigilUxTreeCommandRegistry,
  executeSigilUxTreeCommand,
} from '../../apps/sigil/renderer/live-modules/ux-tree-command-registry.js'

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

test('Sigil UX command adapter executes allowlisted Selection Mode Escape handler once', () => {
  const tree = createSigilUxTree()
  let calls = 0
  const registry = createSigilUxTreeCommandRegistry({
    selectionModeCancel({ binding, command, input, context }) {
      calls += 1
      assert.equal(binding.id, 'sigil.selection_mode.escape')
      assert.equal(command.id, 'sigil.selection_mode.cancel')
      assert.equal(input.gesture, 'key.escape')
      assert.equal(context.reason, 'test')
      return { active: false, reason: 'escape' }
    },
  })

  const result = executeSigilUxTreeCommand(tree, {
    input: SIGIL_SELECTION_MODE_ESCAPE_COMMAND_INPUT,
    registry,
    context: { reason: 'test' },
  })

  assert.equal(calls, 1)
  assert.equal(result.matched, true)
  assert.equal(result.executed, true)
  assert.equal(result.command_id, 'sigil.selection_mode.cancel')
  assert.equal(result.binding_id, 'sigil.selection_mode.escape')
  assert.equal(result.reason, 'executed')
  assert.deepEqual(result.handler_result, { active: false, reason: 'escape' })
})

test('Sigil UX command adapter reports missing handler without executing', () => {
  const result = executeSigilUxTreeCommand(createSigilUxTree(), {
    input: SIGIL_SELECTION_MODE_ESCAPE_COMMAND_INPUT,
    registry: {},
  })

  assert.equal(result.matched, true)
  assert.equal(result.executed, false)
  assert.equal(result.command_id, 'sigil.selection_mode.cancel')
  assert.equal(result.reason, 'handler_not_registered')
  assert.equal(result.errors[0].code, 'command.handler.missing')
})

test('Sigil UX command adapter can fall back from handler_ref to command id', () => {
  let calls = 0
  const tree = cloneJson(createSigilUxTree())
  tree.validation = { ok: true, errors: [] }
  tree.commands = tree.commands.map((command) => command.id === 'sigil.selection_mode.cancel'
    ? {
        ...command,
        handler_ref: 'sigil.selection_mode.cancel.runtime_handler',
      }
    : command)

  const result = executeSigilUxTreeCommand(tree, {
    input: SIGIL_SELECTION_MODE_ESCAPE_COMMAND_INPUT,
    registry: {
      'sigil.selection_mode.cancel'() {
        calls += 1
      },
    },
  })

  assert.equal(calls, 1)
  assert.equal(result.executed, true)
  assert.equal(result.handler_ref, 'sigil.selection_mode.cancel.runtime_handler')
  assert.equal(result.handler_key, 'sigil.selection_mode.cancel')
})

test('Sigil UX command adapter fails closed for invalid trees', () => {
  let calls = 0
  const tree = {
    ...createSigilUxTree(),
    validation: {
      ok: false,
      errors: [{ code: 'tree.invalid', message: 'test invalid tree' }],
    },
  }

  const result = executeSigilUxTreeCommand(tree, {
    input: SIGIL_SELECTION_MODE_ESCAPE_COMMAND_INPUT,
    registry: createSigilUxTreeCommandRegistry({
      selectionModeCancel() {
        calls += 1
      },
    }),
  })

  assert.equal(calls, 0)
  assert.equal(result.matched, false)
  assert.equal(result.executed, false)
  assert.equal(result.reason, 'invalid_tree')
  assert.equal(result.errors[0].code, 'tree.invalid')
})

test('Sigil UX command adapter fails closed for non-allowlisted commands', () => {
  let calls = 0
  const tree = cloneJson(createSigilUxTree())
  tree.validation = { ok: true, errors: [] }
  tree.commands = tree.commands.map((command) => command.id === 'sigil.selection_mode.cancel'
    ? {
        ...command,
        safety: {
          ...command.safety,
          execution: 'shadow_only',
        },
      }
    : command)

  const result = executeSigilUxTreeCommand(tree, {
    input: SIGIL_SELECTION_MODE_ESCAPE_COMMAND_INPUT,
    registry: createSigilUxTreeCommandRegistry({
      selectionModeCancel() {
        calls += 1
      },
    }),
  })

  assert.equal(calls, 0)
  assert.equal(result.matched, true)
  assert.equal(result.executed, false)
  assert.equal(result.reason, 'command_not_allowlisted')
  assert.equal(result.errors[0].code, 'command.safety.execution')
})

test('Sigil UX command adapter only invokes registered handlers', () => {
  let embeddedCalls = 0
  const tree = cloneJson(createSigilUxTree())
  tree.validation = { ok: true, errors: [] }
  tree.commands = tree.commands.map((command) => command.id === 'sigil.selection_mode.cancel'
    ? {
        ...command,
        embedded_handler: () => {
          embeddedCalls += 1
        },
      }
    : command)

  const result = executeSigilUxTreeCommand(tree, {
    input: SIGIL_SELECTION_MODE_ESCAPE_COMMAND_INPUT,
    registry: {},
  })

  assert.equal(embeddedCalls, 0)
  assert.equal(result.executed, false)
  assert.equal(result.reason, 'handler_not_registered')
})
