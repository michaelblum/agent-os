import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  commandForHotkey,
  hotkeyStringFromEvent,
  resolveHotkeyBindings,
  runControlEventForHotkey,
} from '../../packages/toolkit/run-puck/hotkeys.js'

test('run puck normalizes key events into hotkey strings', () => {
  assert.equal(hotkeyStringFromEvent({ type: 'key_down', logical: ' ', modifiers: {} }), 'Space')
  assert.equal(hotkeyStringFromEvent({ type: 'key_down', logical: 'Escape', modifiers: { shift: true } }), 'Shift+Esc')
  assert.equal(hotkeyStringFromEvent({ type: 'key_down', logical: '.', modifiers: { cmd: true } }), 'Cmd+.')
})

test('run puck hotkeys map through run state', () => {
  assert.equal(commandForHotkey({ type: 'key_down', logical: ' ', modifiers: {} }, 'running'), 'pause')
  assert.equal(commandForHotkey({ type: 'key_down', logical: ' ', modifiers: {} }, 'paused'), 'resume')
  assert.equal(commandForHotkey({ type: 'key_down', logical: 't', modifiers: {} }, 'takeover'), 'release')
  assert.equal(commandForHotkey({ type: 'key_down', logical: 's', modifiers: {} }, 'paused'), 'step')
})

test('run puck hotkeys can be rebound from config object', () => {
  const bindings = resolveHotkeyBindings({ hotkeys: { X: 'abort' } })
  assert.equal(bindings.X, 'abort')
  assert.equal(commandForHotkey({ type: 'key_down', logical: 'x', modifiers: {} }, 'running', bindings), 'abort')
})

test('run puck produces semantic run-control events for routed hotkeys', () => {
  const event = runControlEventForHotkey(
    {
      routed_schema_version: 1,
      type: 'key_down',
      event_kind: 'key',
      logical: 's',
      modifiers: {},
    },
    'paused',
    {
      session_id: 'steerable-demo',
      clock: () => '2026-04-28T12:00:00Z',
      idGenerator: () => 'evt_hotkey_001',
    },
  )

  assert.deepEqual(event, {
    type: 'run.control',
    event_id: 'evt_hotkey_001',
    session_id: 'steerable-demo',
    command: 'step',
    source: 'hotkey',
    at: '2026-04-28T12:00:00Z',
    budget: 1,
  })
})
