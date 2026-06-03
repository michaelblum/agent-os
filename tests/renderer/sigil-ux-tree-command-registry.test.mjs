import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSigilUxTree } from '../../apps/sigil/renderer/live-modules/ux-tree.js'
import {
  SIGIL_AVATAR_COMMAND_INPUTS,
  SIGIL_AVATAR_CONTROLS_COMMAND_INPUTS,
  SIGIL_RADIAL_COMMAND_INPUTS,
  SIGIL_SELECTION_MODE_COMMAND_INPUTS,
  SIGIL_SELECTION_MODE_ESCAPE_COMMAND_INPUT,
  createSigilUxTreeCommandRegistry,
  createSigilUxTreeCommandRouteCatalog,
  createSigilUxTreeCommandRunner,
  createSigilUxTreeCommandRuntime,
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

test('Sigil UX command adapter executes avatar controls open handler with pointer context', () => {
  const pointer = { x: 44, y: 55, valid: true }
  let seenPointer = null
  const registry = createSigilUxTreeCommandRegistry({
    avatarControlsOpen(nextPointer) {
      seenPointer = nextPointer
      return true
    },
  })

  const result = executeSigilUxTreeCommand(createSigilUxTree(), {
    input: SIGIL_AVATAR_CONTROLS_COMMAND_INPUTS.open,
    registry,
    context: { pointer },
  })

  assert.equal(seenPointer, pointer)
  assert.equal(result.command_id, 'sigil.avatar.controls.open')
  assert.equal(result.binding_id, 'sigil.avatar.controls.right_click')
  assert.equal(result.executed, true)
  assert.equal(result.handler_result, true)
})

test('Sigil UX command adapter executes avatar controls toggle handler with pointer context', () => {
  const pointer = { x: 66, y: 77, valid: true }
  let seenPointer = null
  const registry = createSigilUxTreeCommandRegistry({
    avatarControlsToggle(nextPointer) {
      seenPointer = nextPointer
      return { closed: true }
    },
  })

  const result = executeSigilUxTreeCommand(createSigilUxTree(), {
    input: SIGIL_AVATAR_CONTROLS_COMMAND_INPUTS.toggle,
    registry,
    context: { pointer },
  })

  assert.equal(seenPointer, pointer)
  assert.equal(result.command_id, 'sigil.avatar.controls.toggle')
  assert.equal(result.binding_id, 'sigil.avatar.controls.right_click_toggle')
  assert.equal(result.executed, true)
  assert.deepEqual(result.handler_result, { closed: true })
})

test('Sigil UX command adapter reports missing avatar controls handler without executing', () => {
  const result = executeSigilUxTreeCommand(createSigilUxTree(), {
    input: SIGIL_AVATAR_CONTROLS_COMMAND_INPUTS.open,
    registry: createSigilUxTreeCommandRegistry(),
  })

  assert.equal(result.matched, true)
  assert.equal(result.executed, false)
  assert.equal(result.command_id, 'sigil.avatar.controls.open')
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

test('Sigil UX command adapter executes Selection Mode snapshot and record handlers', () => {
  const calls = []
  const registry = createSigilUxTreeCommandRegistry({
    selectionModeSnapshot(pointer, payload) {
      calls.push(['snapshot', pointer, payload.context?.source || null, payload.context?.nodeId || null])
      return { copied: true }
    },
    selectionModeRecord(pointer, payload) {
      calls.push(['record', pointer, payload.context?.source || null, payload.context?.nodeId || null])
      return false
    },
  })
  const pointer = { x: 8, y: 9, valid: true }

  const snapshotResult = executeSigilUxTreeCommand(createSigilUxTree(), {
    input: SIGIL_SELECTION_MODE_COMMAND_INPUTS.snapshot,
    registry,
    context: { pointer, source: 'lineage-button', nodeId: 'node:ancestor' },
  })
  const recordResult = executeSigilUxTreeCommand(createSigilUxTree(), {
    input: SIGIL_SELECTION_MODE_COMMAND_INPUTS.record,
    registry,
    context: { pointer, source: 'lineage-button', nodeId: 'node:ancestor' },
  })

  assert.equal(snapshotResult.command_id, 'sigil.selection_mode.snapshot')
  assert.equal(snapshotResult.binding_id, 'sigil.selection_mode.snapshot_button')
  assert.equal(snapshotResult.executed, true)
  assert.deepEqual(snapshotResult.handler_result, { copied: true })
  assert.equal(recordResult.command_id, 'sigil.selection_mode.record')
  assert.equal(recordResult.binding_id, 'sigil.selection_mode.record_button')
  assert.equal(recordResult.executed, true)
  assert.equal(recordResult.handler_result, false)
  assert.deepEqual(calls, [
    ['snapshot', pointer, 'lineage-button', 'node:ancestor'],
    ['record', pointer, 'lineage-button', 'node:ancestor'],
  ])
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

test('Sigil UX command adapter executes avatar press, GOTO, and radial begin handlers', () => {
  const calls = []
  const registry = createSigilUxTreeCommandRegistry({
    avatarPressBegin(pointer) {
      calls.push(['press', pointer])
      return { state: 'PRESS' }
    },
    avatarGotoBegin(pointer) {
      calls.push(['goto', pointer])
      return { state: 'GOTO' }
    },
    radialBegin(pointer) {
      calls.push(['radial', pointer])
      return { state: 'RADIAL' }
    },
  })
  const pointer = { x: 10, y: 20, valid: true }
  const cases = [
    [SIGIL_AVATAR_COMMAND_INPUTS.pressBegin, 'sigil.avatar.press.begin', 'sigil.avatar.press.left_press'],
    [SIGIL_AVATAR_COMMAND_INPUTS.gotoBegin, 'sigil.avatar.goto.begin', 'sigil.avatar.goto.left_release'],
    [SIGIL_AVATAR_COMMAND_INPUTS.radialBegin, 'sigil.radial.begin', 'sigil.avatar.radial.drag_threshold'],
  ]

  for (const [input, commandId, bindingId] of cases) {
    const result = executeSigilUxTreeCommand(createSigilUxTree(), {
      input,
      registry,
      context: { pointer },
    })
    assert.equal(result.executed, true)
    assert.equal(result.command_id, commandId)
    assert.equal(result.binding_id, bindingId)
  }
  assert.deepEqual(calls.map(([name]) => name), ['press', 'goto', 'radial'])
  assert.deepEqual(calls.map(([, seenPointer]) => seenPointer), [pointer, pointer, pointer])
})

test('Sigil avatar press runtime stores valid drag-origin points for fast-travel preview', () => {
  const liveState = {
    currentState: 'IDLE',
    avatarPos: { x: 80, y: 90, valid: true },
    mousedownPos: null,
    mousedownAvatarPos: null,
  }
  const runtime = createSigilUxTreeCommandRuntime({
    liveState,
    getTree: () => createSigilUxTree(),
    setInteractionState(stateName) {
      liveState.currentState = stateName
    },
  })

  const pointer = { x: 12, y: 24, valid: true }
  const result = runtime.executeAvatarPressBegin({ type: 'left_mouse_down', x: 12, y: 24 }, { pointer })

  assert.equal(result.executed, true)
  assert.deepEqual(liveState.mousedownPos, { x: 12, y: 24, valid: true })
  assert.deepEqual(liveState.mousedownAvatarPos, { x: 80, y: 90, valid: true })
})

test('Sigil UX command adapter routes radial item actions through their command handlers', () => {
  const calls = []
  const registry = createSigilUxTreeCommandRegistry({
    avatarControlsOpen(pointer, payload) {
      calls.push(['context', pointer, payload.context.item.id])
      return { opened: true }
    },
    agentTerminalOpen(kind, payload) {
      calls.push(['agent', kind, payload.context.item.id])
      return { canvas: 'agent-terminal' }
    },
    selectionModeEnter(pointer, payload) {
      calls.push(['selection', pointer, payload.context.item.id])
      return { active: true }
    },
    annotationCameraCaptureBundle(reason, payload) {
      calls.push(['camera', reason, payload.context.item.id])
      return { captured: true }
    },
    wikiGraphOpen(path, payload) {
      calls.push(['wiki', path, payload.context.item.id])
      return { canvas: 'wiki' }
    },
  })
  const pointer = { x: 33, y: 44, valid: true }
  const cases = [
    ['avatar-controls', 'sigil.avatar.controls.open'],
    ['agent-terminal', 'sigil.agent_terminal.open'],
    ['annotation-mode', 'sigil.selection_mode.enter'],
    ['annotation-camera', 'sigil.annotation_camera.capture_bundle'],
    ['wiki-graph', 'sigil.wiki_graph.open'],
  ]

  for (const [itemId, commandId] of cases) {
    const result = executeSigilUxTreeCommand(createSigilUxTree({
      state: {
        annotationReticle: { camera_available: true, live_anchor_count: 1 },
      },
    }), {
      input: SIGIL_RADIAL_COMMAND_INPUTS.itemRelease(itemId),
      registry,
      context: {
        pointer,
        item: { id: itemId },
        reason: 'test-camera',
        path: 'aos/test.md',
      },
    })
    assert.equal(result.executed, true, itemId)
    assert.equal(result.command_id, commandId, itemId)
    assert.equal(result.binding_id, `sigil.radial.item.release.${itemId}`, itemId)
  }

  assert.deepEqual(calls.map(([kind]) => kind), ['context', 'agent', 'selection', 'camera', 'wiki'])
})

test('Sigil UX command runner records fail-closed command declines without fallback execution', () => {
  const records = []
  const runner = createSigilUxTreeCommandRunner({
    getTree: () => createSigilUxTree(),
    registry: createSigilUxTreeCommandRegistry(),
    recordRuntime(result, options) {
      records.push({ result, options })
    },
  })

  const result = runner.execute(SIGIL_SELECTION_MODE_COMMAND_INPUTS.commit, {
    source: 'test',
  })

  assert.equal(result.executed, false)
  assert.equal(result.reason, 'handler_not_registered')
  assert.deepEqual(records.map((entry) => entry.options), [{ fallback: false }])
})

test('Sigil UX command route catalog is derived from adapter-resolved command inputs', () => {
  const tree = createSigilUxTree()
  const catalog = createSigilUxTreeCommandRouteCatalog(tree)
  const routeIds = new Set(catalog.map((route) => route.binding_id))

  assert.equal(catalog.length, tree.bindings.length)
  assert.ok(routeIds.has('sigil.avatar.controls.right_click'))
  assert.ok(routeIds.has('sigil.selection_mode.left_click_acquire'))
  assert.ok(routeIds.has('sigil.selection_mode.snapshot_button'))
  assert.ok(routeIds.has('sigil.selection_mode.record_button'))
  assert.ok(routeIds.has('sigil.radial.item.release.annotation-mode'))
  assert.ok([...routeIds].some((id) => id.startsWith('sigil.radial.item.release.')))
})
