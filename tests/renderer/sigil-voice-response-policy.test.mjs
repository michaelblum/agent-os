import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  SIGIL_VOICE_RESPONSE_BACKEND_IDS,
  createSigilVoiceResponsePolicy,
  lookupSigilVoiceResponsePolicy,
  sigilVoiceResponseBackendMenuItems,
} from '../../apps/sigil/renderer/live-modules/voice-response-policy.js'

function voiceEvent(event, data = {}) {
  return {
    v: 1,
    service: 'voice',
    event,
    ts: 10,
    data,
  }
}

test('Sigil voice response policy maps dictation_opened to system sound by default', () => {
  const soundActions = []
  const ttsActions = []
  const policy = createSigilVoiceResponsePolicy({
    playSound(action) {
      soundActions.push(action)
    },
    speak(action) {
      ttsActions.push(action)
    },
  })

  const result = policy.handleVoiceEvent(voiceEvent('dictation_opened', { source: 'hotkey' }))

  assert.equal(result.handled, true)
  assert.equal(soundActions.length, 1)
  assert.equal(ttsActions.length, 0)
  assert.equal(soundActions[0].kind, 'system_sound')
  assert.equal(soundActions[0].event, 'dictation_opened')
  assert.equal(soundActions[0].sound, 'sigil_dictation_opened')
  assert.equal(soundActions[0].mocked, false)
})

test('Sigil voice response backend selection routes dictation_opened to mocked TTS', () => {
  const soundActions = []
  const ttsActions = []
  const policy = createSigilVoiceResponsePolicy({
    playSound(action) {
      soundActions.push(action)
    },
    speak(action) {
      ttsActions.push(action)
    },
  })

  const selected = policy.handleMenuAction('sigil.voice.response.backend.mock-tts')
  const result = policy.handleVoiceEvent(voiceEvent('dictation_opened', { source: 'phrase' }))

  assert.equal(selected.handled, true)
  assert.equal(selected.selected, true)
  assert.equal(result.handled, true)
  assert.equal(soundActions.length, 0)
  assert.equal(ttsActions.length, 1)
  assert.equal(ttsActions[0].kind, 'mock_tts')
  assert.equal(ttsActions[0].backendId, SIGIL_VOICE_RESPONSE_BACKEND_IDS.MOCK_TTS)
  assert.equal(ttsActions[0].text, 'Listening.')
  assert.equal(ttsActions[0].mocked, true)
})

test('Sigil voice response menu exposes system, mock, and unavailable Kokoro backends', () => {
  const policy = createSigilVoiceResponsePolicy()
  const menuItems = sigilVoiceResponseBackendMenuItems(policy.snapshot())

  assert.deepEqual(
    menuItems.map((item) => ({ id: item.id, title: item.title, checked: item.checked, enabled: item.enabled })),
    [
      {
        id: 'sigil.voice.response.backend.system-sound',
        title: 'Voice Response: System Sound',
        checked: true,
        enabled: true,
      },
      {
        id: 'sigil.voice.response.backend.mock-tts',
        title: 'Voice Response: Mock TTS',
        checked: false,
        enabled: true,
      },
      {
        id: 'sigil.voice.response.backend.kokoro',
        title: 'Voice Response: Kokoro TTS (Unavailable)',
        checked: false,
        enabled: false,
      },
    ],
  )

  const unavailable = policy.handleMenuAction('sigil.voice.response.backend.kokoro')
  assert.equal(unavailable.handled, true)
  assert.equal(unavailable.selected, false)
  assert.equal(unavailable.reason, 'distribution_clearance_required')
  assert.equal(policy.snapshot().selectedBackendId, SIGIL_VOICE_RESPONSE_BACKEND_IDS.SYSTEM_SOUND)
})

test('Sigil voice response policy lookup is local and event keyed', () => {
  assert.deepEqual(
    lookupSigilVoiceResponsePolicy('dictation_closed_cancel'),
    {
      sound: 'sigil_dictation_cancel',
      text: 'Dictation cancelled.',
    },
  )
  assert.equal(lookupSigilVoiceResponsePolicy('session.started'), null)
})

test('Sigil voice response module does not import daemon schemas', async () => {
  const source = await readFile(new URL('../../apps/sigil/renderer/live-modules/voice-response-policy.js', import.meta.url), 'utf8')
  const imports = [...source.matchAll(/from ['"]([^'"]+)['"]/g)].map((match) => match[1])

  assert.deepEqual(imports, ['./voice-dictation.js'])
  assert.doesNotMatch(source, /shared\/schemas|src\/daemon|daemon-event|VoiceRegistry/)
})

test('Sigil main delegates voice response menu and event routing to voice runtime', async () => {
  const source = await readFile(new URL('../../apps/sigil/renderer/live-modules/main.js', import.meta.url), 'utf8')

  assert.match(source, /createSigilVoiceRuntime/)
  assert.match(source, /voiceRuntime\.responseBackendMenuItems\(\)/)
  assert.match(source, /voiceRuntime\.handleMenuAction\(id\)/)
  assert.match(source, /voiceRuntime\.handleVoiceEvent\(msg\)\.handled/)
  assert.doesNotMatch(source, /createSigilVoiceResponsePolicy/)
  assert.doesNotMatch(source, /sigilVoiceResponseBackendMenuItems\(voiceResponsePolicy\.snapshot\(\)\)/)
})
