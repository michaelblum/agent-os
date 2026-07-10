import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  createSigilVoiceRuntime,
} from '../../apps/sigil/renderer/live-modules/voice-runtime.js'

function createRuntimeHarness() {
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
  })
  return { liveState, interactions, scheduled, runtime }
}

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
