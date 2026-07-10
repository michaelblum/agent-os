import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  createSigilVoiceRuntime,
  isSigilTextEntryActive,
  normalizeSigilVoiceInputSourceIdentity,
} from '../../apps/sigil/renderer/live-modules/voice-runtime.js'

function createRuntimeHarness(options = {}) {
  const liveState = {
    voiceDictation: null,
    voiceDictationEvents: [],
    voiceResponse: null,
    voiceResponseActions: [],
  }
  const interactions = []
  const scheduled = []
  const runtime = createSigilVoiceRuntime({
    liveState,
    recordInteraction(stage, data) {
      interactions.push({ stage, data })
    },
    scheduleRenderFrame(options) {
      scheduled.push(options)
    },
    isRendererSuspended: () => false,
    getInputContext: options.getInputContext,
  })
  return { liveState, interactions, scheduled, runtime }
}

test('Sigil voice runtime classifies focused text-entry elements', () => {
  const body = {}
  const documentElement = {}
  const textInput = { matches: (selector) => selector.includes('input:not') }
  const commentChild = { matches: () => false }
  const commentRoot = { contains: (element) => element === commentChild }

  assert.equal(isSigilTextEntryActive({ body, documentElement, activeElement: body }), false)
  assert.equal(isSigilTextEntryActive({ body, documentElement, activeElement: textInput }), true)
  assert.equal(isSigilTextEntryActive({ body, documentElement, activeElement: commentChild }, commentRoot), true)
})

test('Sigil voice runtime normalizes daemon and canvas input identity fields', () => {
  assert.deepEqual(
    normalizeSigilVoiceInputSourceIdentity({
      source_origin: 'canvas',
      source_canvas_id: 'panel',
      owner_canvas_id: 'avatar-main',
      envelope_type: 'input_region.event',
    }),
    {
      sourceOrigin: 'canvas',
      sourceCanvasId: 'panel',
      ownerCanvasId: 'avatar-main',
      envelopeType: 'input_region.event',
    },
  )
})

test('Sigil voice runtime initializes live snapshots and backend menu items', () => {
  const { liveState, runtime } = createRuntimeHarness()

  assert.equal(liveState.voiceDictation.phase, 'IDLE')
  assert.equal(liveState.voiceResponse.selectedBackendId, 'system-sound')
  assert.deepEqual(
    runtime.responseBackendMenuItems().map((item) => ({ id: item.id, checked: item.checked, enabled: item.enabled })),
    [
      { id: 'sigil.voice.response.backend.system-sound', checked: true, enabled: true },
      { id: 'sigil.voice.response.backend.mock-tts', checked: false, enabled: true },
      { id: 'sigil.voice.response.backend.kokoro', checked: false, enabled: false },
    ],
  )
})

test('Sigil voice runtime routes hold-space dictation into live state, trace, and response action', () => {
  const { liveState, interactions, scheduled, runtime } = createRuntimeHarness()

  const result = runtime.handleInput({ type: 'key_down', key_code: 49 })

  assert.equal(result.handled, true)
  assert.equal(liveState.voiceDictation.phase, 'LISTENING')
  assert.equal(liveState.voiceDictationEvents.at(-1).event, 'dictation_opened')
  assert.equal(liveState.voiceResponseActions.at(-1).event, 'dictation_opened')
  assert.equal(liveState.voiceResponseActions.at(-1).kind, 'system_sound')
  assert.equal(interactions.some((entry) => entry.stage === 'voice-dictation:event'), true)
  assert.equal(interactions.some((entry) => entry.stage === 'voice-response:action'), true)
  assert.ok(scheduled.length >= 1)
})

test('Sigil voice runtime declines new dictation while higher-priority input owners are active', () => {
  const context = {
    currentState: 'IDLE',
    selectionModeActive: false,
    avatarControlsOpen: false,
    textInputActive: false,
  }
  const { runtime } = createRuntimeHarness({
    getInputContext(message) {
      return { ...context, sourceIdentity: normalizeSigilVoiceInputSourceIdentity(message) }
    },
  })
  const input = { type: 'key_down', key_code: 49 }

  context.textInputActive = true
  assert.equal(runtime.handleInput(input).reason, 'text_input_active')
  context.textInputActive = false
  context.selectionModeActive = true
  assert.equal(runtime.handleInput(input).reason, 'selection_mode_active')
  context.selectionModeActive = false
  context.avatarControlsOpen = true
  assert.equal(runtime.handleInput(input).reason, 'panel_active')
  context.avatarControlsOpen = false
  context.currentState = 'RADIAL'
  assert.equal(runtime.handleInput(input).reason, 'higher_priority_mode_active')
  context.currentState = 'FAST_TRAVEL'
  assert.equal(runtime.handleInput(input).reason, 'higher_priority_mode_active')
  context.currentState = 'IDLE'
  assert.equal(runtime.handleInput({ ...input, sourceOrigin: 'canvas' }).reason, 'non_global_source')
  assert.equal(runtime.handleInput({ ...input, envelope_type: 'input_region.event' }).reason, 'non_global_source')
  assert.equal(runtime.handleInput({ ...input, sourceCanvasId: 'panel' }).reason, 'non_global_source')
  assert.equal(runtime.handleInput(input).handled, true)
})

test('Sigil voice runtime accepts release for active dictation after input ownership changes', () => {
  const context = { selectionModeActive: false }
  const { liveState, runtime } = createRuntimeHarness({
    getInputContext(message) {
      return { ...context, sourceIdentity: normalizeSigilVoiceInputSourceIdentity(message) }
    },
  })

  assert.equal(runtime.handleInput({ type: 'key_down', key_code: 49 }).policy, 'global_hotkey')
  context.selectionModeActive = true
  const released = runtime.handleInput({ type: 'key_up', key_code: 49, sourceOrigin: 'canvas' })
  assert.equal(released.handled, true)
  assert.equal(released.policy, 'dictation_active')
  assert.equal(liveState.voiceDictation.phase, 'CANCEL')
})

test('Sigil voice runtime handles menu backend selection and external voice events', () => {
  const { liveState, runtime } = createRuntimeHarness()

  const selected = runtime.handleMenuAction('sigil.voice.response.backend.mock-tts')
  const routed = runtime.handleVoiceEvent({
    v: 1,
    service: 'voice',
    event: 'dictation_opened',
    ts: 10,
    data: { source: 'phrase' },
  })

  assert.equal(selected.handled, true)
  assert.equal(liveState.voiceResponse.selectedBackendId, 'mock-tts')
  assert.equal(routed.handled, true)
  assert.equal(routed.dictation.handled, true)
  assert.equal(routed.response.handled, true)
  assert.equal(liveState.voiceResponseActions.at(-1).kind, 'tts')
  assert.equal(runtime.handleVoiceEvent({ type: 'mouse_moved' }).handled, false)
})
