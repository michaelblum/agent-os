import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSigilUxTree } from '../../apps/sigil/renderer/live-modules/ux-tree.js'
import {
  SIGIL_CONTEXT_MENU_COMMAND_INPUTS,
  SIGIL_SELECTION_MODE_COMMAND_INPUTS,
  SIGIL_SELECTION_MODE_ESCAPE_COMMAND_INPUT,
  createSigilUxTreeCommandRegistry,
  executeSigilUxTreeCommand,
} from '../../apps/sigil/renderer/live-modules/ux-tree-command-registry.js'

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function treeWithSelectionCancelHandlerRef(handlerRef) {
  const tree = cloneJson(createSigilUxTree())
  tree.validation = { ok: true, errors: [] }
  tree.commands = tree.commands.map((command) => command.id === 'sigil.selection_mode.cancel'
    ? {
        ...command,
        handler_ref: handlerRef,
      }
    : command)
  return tree
}

const INHERITED_PROTOTYPE_HANDLER_REFS = [
  'toString',
  'valueOf',
  'constructor',
  '__defineGetter__',
]

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

test('Sigil UX command adapter executes context menu open handler with pointer context', () => {
  const pointer = { x: 44, y: 55, valid: true }
  let seenPointer = null
  const registry = createSigilUxTreeCommandRegistry({
    contextMenuOpen(nextPointer) {
      seenPointer = nextPointer
      return true
    },
  })

  const result = executeSigilUxTreeCommand(createSigilUxTree(), {
    input: SIGIL_CONTEXT_MENU_COMMAND_INPUTS.open,
    registry,
    context: { pointer },
  })

  assert.equal(seenPointer, pointer)
  assert.equal(result.command_id, 'sigil.context_menu.open')
  assert.equal(result.binding_id, 'sigil.avatar.context_menu.right_click')
  assert.equal(result.executed, true)
  assert.equal(result.handler_result, true)
})

test('Sigil UX command adapter executes context menu toggle handler with pointer context', () => {
  const pointer = { x: 66, y: 77, valid: true }
  let seenPointer = null
  const registry = createSigilUxTreeCommandRegistry({
    contextMenuToggle(nextPointer) {
      seenPointer = nextPointer
      return { closed: true }
    },
  })

  const result = executeSigilUxTreeCommand(createSigilUxTree(), {
    input: SIGIL_CONTEXT_MENU_COMMAND_INPUTS.toggle,
    registry,
    context: { pointer },
  })

  assert.equal(seenPointer, pointer)
  assert.equal(result.command_id, 'sigil.context_menu.toggle')
  assert.equal(result.binding_id, 'sigil.avatar.context_menu.right_click_toggle')
  assert.equal(result.executed, true)
  assert.deepEqual(result.handler_result, { closed: true })
})

test('Sigil UX command adapter reports missing context menu handler without executing', () => {
  const result = executeSigilUxTreeCommand(createSigilUxTree(), {
    input: SIGIL_CONTEXT_MENU_COMMAND_INPUTS.open,
    registry: createSigilUxTreeCommandRegistry(),
  })

  assert.equal(result.matched, true)
  assert.equal(result.executed, false)
  assert.equal(result.command_id, 'sigil.context_menu.open')
  assert.equal(result.reason, 'handler_not_registered')
  assert.equal(result.errors[0].code, 'command.handler.missing')
})

test('Sigil UX command adapter does not execute inherited direct registry handlers', () => {
  for (const handlerRef of INHERITED_PROTOTYPE_HANDLER_REFS) {
    const result = executeSigilUxTreeCommand(treeWithSelectionCancelHandlerRef(handlerRef), {
      input: SIGIL_SELECTION_MODE_ESCAPE_COMMAND_INPUT,
      registry: {},
    })

    assert.equal(result.matched, true, handlerRef)
    assert.equal(result.executed, false, handlerRef)
    assert.equal(result.command_id, 'sigil.selection_mode.cancel', handlerRef)
    assert.equal(result.handler_ref, handlerRef)
    assert.equal(result.reason, 'handler_not_registered', handlerRef)
    assert.equal(result.errors[0].code, 'command.handler.missing', handlerRef)
  }
})

test('Sigil UX command adapter does not execute inherited nested registry handlers', () => {
  for (const handlerRef of INHERITED_PROTOTYPE_HANDLER_REFS) {
    const result = executeSigilUxTreeCommand(treeWithSelectionCancelHandlerRef(handlerRef), {
      input: SIGIL_SELECTION_MODE_ESCAPE_COMMAND_INPUT,
      registry: {
        handlers: {},
      },
    })

    assert.equal(result.matched, true, handlerRef)
    assert.equal(result.executed, false, handlerRef)
    assert.equal(result.command_id, 'sigil.selection_mode.cancel', handlerRef)
    assert.equal(result.handler_ref, handlerRef)
    assert.equal(result.reason, 'handler_not_registered', handlerRef)
    assert.equal(result.errors[0].code, 'command.handler.missing', handlerRef)
  }
})

test('Sigil UX command adapter executes explicit own prototype-name handlers', () => {
  let calls = 0
  const registry = Object.create(null)
  Object.defineProperty(registry, 'toString', {
    value() {
      calls += 1
      return { explicit: true }
    },
  })

  const result = executeSigilUxTreeCommand(treeWithSelectionCancelHandlerRef('toString'), {
    input: SIGIL_SELECTION_MODE_ESCAPE_COMMAND_INPUT,
    registry,
  })

  assert.equal(calls, 1)
  assert.equal(result.executed, true)
  assert.equal(result.reason, 'executed')
  assert.equal(result.handler_key, 'toString')
  assert.deepEqual(result.handler_result, { explicit: true })
})

test('Sigil UX command adapter still supports Map registries', () => {
  let calls = 0
  const result = executeSigilUxTreeCommand(createSigilUxTree(), {
    input: SIGIL_SELECTION_MODE_ESCAPE_COMMAND_INPUT,
    registry: new Map([
      ['sigil.selection_mode.cancel', () => {
        calls += 1
        return { active: false }
      }],
    ]),
  })

  assert.equal(calls, 1)
  assert.equal(result.executed, true)
  assert.equal(result.reason, 'executed')
  assert.equal(result.handler_key, 'sigil.selection_mode.cancel')
  assert.deepEqual(result.handler_result, { active: false })
})

test('Sigil UX command adapter can fall back from handler_ref to command id', () => {
  let calls = 0
  const tree = treeWithSelectionCancelHandlerRef('sigil.selection_mode.cancel.runtime_handler')

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

test('Sigil UX command adapter executes Selection Mode commit handler for Enter', () => {
  const calls = []
  const registry = createSigilUxTreeCommandRegistry({
    selectionModeCommit(reason) {
      calls.push(reason)
      return { committed: true, reason }
    },
  })

  const result = executeSigilUxTreeCommand(createSigilUxTree(), {
    input: SIGIL_SELECTION_MODE_COMMAND_INPUTS.commit,
    registry,
  })

  assert.deepEqual(calls, ['enter'])
  assert.equal(result.command_id, 'sigil.selection_mode.commit')
  assert.equal(result.binding_id, 'sigil.selection_mode.enter')
  assert.equal(result.executed, true)
  assert.deepEqual(result.handler_result, { committed: true, reason: 'enter' })
})

test('Sigil UX command adapter executes Selection Mode cycle handler with tree binding deltas', () => {
  const calls = []
  const registry = createSigilUxTreeCommandRegistry({
    selectionModeCycleTarget(delta) {
      calls.push(delta)
      return { delta }
    },
  })

  const cases = [
    [SIGIL_SELECTION_MODE_COMMAND_INPUTS.tabPreviousTarget, 'sigil.selection_mode.tab', -1],
    [SIGIL_SELECTION_MODE_COMMAND_INPUTS.arrowUpPreviousTarget, 'sigil.selection_mode.arrow_up', -1],
    [SIGIL_SELECTION_MODE_COMMAND_INPUTS.arrowDownNextTarget, 'sigil.selection_mode.arrow_down', 1],
  ]

  for (const [input, bindingId, delta] of cases) {
    const result = executeSigilUxTreeCommand(createSigilUxTree(), {
      input,
      registry,
    })
    assert.equal(result.command_id, 'sigil.selection_mode.cycle_target')
    assert.equal(result.binding_id, bindingId)
    assert.equal(result.executed, true)
    assert.deepEqual(result.handler_result, { delta })
  }

  assert.deepEqual(calls, [-1, -1, 1])
})

test('Sigil UX command adapter executes Selection Mode acquire handler with pointer context', () => {
  const pointer = { x: 12, y: 34, valid: true }
  let seenPointer = null
  const registry = createSigilUxTreeCommandRegistry({
    selectionModeAcquire(nextPointer) {
      seenPointer = nextPointer
      return { acquired: true, pointer: nextPointer }
    },
  })

  const result = executeSigilUxTreeCommand(createSigilUxTree(), {
    input: SIGIL_SELECTION_MODE_COMMAND_INPUTS.acquire,
    registry,
    context: { pointer },
  })

  assert.equal(seenPointer, pointer)
  assert.equal(result.command_id, 'sigil.selection_mode.acquire')
  assert.equal(result.binding_id, 'sigil.selection_mode.left_click_acquire')
  assert.equal(result.executed, true)
  assert.deepEqual(result.handler_result, { acquired: true, pointer })
})

test('Sigil UX command adapter reports missing Selection Mode commit handler without executing', () => {
  const result = executeSigilUxTreeCommand(createSigilUxTree(), {
    input: SIGIL_SELECTION_MODE_COMMAND_INPUTS.commit,
    registry: createSigilUxTreeCommandRegistry(),
  })

  assert.equal(result.matched, true)
  assert.equal(result.executed, false)
  assert.equal(result.command_id, 'sigil.selection_mode.commit')
  assert.equal(result.reason, 'handler_not_registered')
  assert.equal(result.errors[0].code, 'command.handler.missing')
})
