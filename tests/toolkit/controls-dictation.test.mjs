import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  adaptLegacyVoiceDictationBridgeEvent,
  applyDictationTextValue,
  buildDictationTextValue,
  createDictationController,
  isHoldToDictateInput,
  normalizeVoiceDictationEvent,
  parseCanonicalVoiceDictationEvent,
} from '../../packages/toolkit/controls/dictation.js'

function createHarness(options = {}) {
  let now = 1000
  const voiceEvents = []
  const changes = []
  const controller = createDictationController({
    now: () => now,
    timestamp: () => now / 1000,
    timeoutMs: options.timeoutMs ?? 500,
    onChange(snapshot, transition) {
      changes.push({ snapshot, transition })
    },
    onVoiceEvent(event) {
      voiceEvents.push(event)
    },
  })
  return {
    controller,
    voiceEvents,
    changes,
    advance(ms) {
      now += ms
    },
  }
}

test('dictation recognizes daemon key-code and DOM Space key shapes', () => {
  assert.equal(isHoldToDictateInput({ type: 'key_down', key_code: 49 }), true)
  assert.equal(isHoldToDictateInput({ type: 'key_up', key: ' ' }), true)
  assert.equal(isHoldToDictateInput({ type: 'key_down', code: 'Space' }), true)
  assert.equal(isHoldToDictateInput({ type: 'key_down', key: 'Enter' }), false)
  assert.equal(isHoldToDictateInput({ type: 'mouse_moved' }), false)
})

test('hold-to-dictate opens LISTENING and emits generic dictation_opened', () => {
  const harness = createHarness()
  const result = harness.controller.handleInput({ type: 'key_down', key_code: 49 })

  assert.equal(result.handled, true)
  assert.equal(harness.controller.snapshot().phase, 'LISTENING')
  assert.equal(harness.controller.snapshot().source, 'hotkey')
  assert.equal(harness.voiceEvents.length, 1)
  assert.deepEqual(
    { service: harness.voiceEvents[0].service, event: harness.voiceEvents[0].event, data: harness.voiceEvents[0].data },
    { service: 'voice', event: 'dictation_opened', data: { source: 'hotkey' } },
  )

  const repeat = harness.controller.handleInput({ type: 'key_down', key_code: 49 })
  assert.equal(repeat.handled, true)
  assert.equal(repeat.reason, 'spacebar_repeat')
  assert.equal(harness.voiceEvents.length, 1)
})

test('key release sends when speech or transcript was captured', () => {
  const harness = createHarness()

  harness.controller.handleInput({ type: 'key_down', key: 'Space' })
  harness.controller.recordSpeech({ transcript: 'open the terminal' })
  const result = harness.controller.handleInput({ type: 'key_up', key: 'Space' })

  assert.equal(result.handled, true)
  assert.equal(harness.controller.snapshot().phase, 'SEND')
  assert.equal(harness.controller.snapshot().closeReason, 'key_release')
  assert.equal(harness.voiceEvents.at(-1).event, 'dictation_closed_send')
  assert.deepEqual(harness.voiceEvents.at(-1).data, { reason: 'key_release' })
})

test('key release cancels when no speech was captured', () => {
  const harness = createHarness()

  harness.controller.handleInput({ type: 'key_down', key_code: 49 })
  const result = harness.controller.handleInput({ type: 'key_up', key_code: 49 })

  assert.equal(result.handled, true)
  assert.equal(harness.controller.snapshot().phase, 'CANCEL')
  assert.equal(harness.controller.snapshot().closeReason, 'key_release')
  assert.equal(harness.voiceEvents.at(-1).event, 'dictation_closed_cancel')
  assert.deepEqual(harness.voiceEvents.at(-1).data, { reason: 'key_release' })
})

test('timeout sends with captured speech and cancels when empty', () => {
  const withSpeech = createHarness({ timeoutMs: 250 })
  withSpeech.controller.handleInput({ type: 'key_down', key_code: 49 })
  withSpeech.controller.recordSpeech({ speechDetected: true })
  withSpeech.advance(300)
  const send = withSpeech.controller.handleTimeout()

  assert.equal(send.handled, true)
  assert.equal(withSpeech.controller.snapshot().phase, 'SEND')
  assert.equal(withSpeech.controller.snapshot().closeReason, 'timeout')
  assert.equal(withSpeech.voiceEvents.at(-1).event, 'dictation_closed_send')
  assert.deepEqual(withSpeech.voiceEvents.at(-1).data, { reason: 'timeout' })

  const empty = createHarness({ timeoutMs: 250 })
  empty.controller.handleInput({ type: 'key_down', key_code: 49 })
  empty.advance(300)
  const cancel = empty.controller.handleTimeout()

  assert.equal(cancel.handled, true)
  assert.equal(empty.controller.snapshot().phase, 'CANCEL')
  assert.equal(empty.controller.snapshot().closeReason, 'timeout')
  assert.equal(empty.voiceEvents.at(-1).event, 'dictation_closed_cancel')
  assert.deepEqual(empty.voiceEvents.at(-1).data, { reason: 'timeout' })
})

test('controller consumes generic voice dictation envelopes without re-emitting them', () => {
  const harness = createHarness()

  const opened = harness.controller.handleVoiceEvent({
    v: 1,
    service: 'voice',
    event: 'dictation_opened',
    ts: 1,
    data: { source: 'hotkey' },
  })
  assert.equal(opened.handled, true)
  assert.equal(harness.controller.snapshot().phase, 'LISTENING')
  assert.equal(harness.voiceEvents.length, 0)

  harness.controller.recordSpeech('use current selection')
  const closed = harness.controller.handleVoiceEvent({
    v: 1,
    service: 'voice',
    event: 'dictation_closed_send',
    ts: 2,
    data: { reason: 'key_release' },
  })

  assert.equal(closed.handled, true)
  assert.equal(harness.controller.snapshot().phase, 'SEND')
  assert.equal(harness.controller.snapshot().closeReason, 'key_release')
  assert.equal(harness.voiceEvents.length, 0)
})

test('canonical voice event parsing follows the frozen daemon schema', () => {
  const cases = [
    ['wake_detected', { source: 'hotkey' }],
    ['dictation_opened', { source: 'phrase' }],
    ['dictation_closed_send', { reason: 'key_release' }],
    ['dictation_closed_cancel', { reason: 'timeout' }],
  ]

  for (const [event, data] of cases) {
    assert.deepEqual(
      parseCanonicalVoiceDictationEvent({ v: 1, service: 'voice', event, ts: 1.25, data, ref: 'voice-1' }),
      { v: 1, service: 'voice', event, ts: 1.25, data, ref: 'voice-1' },
    )
  }

  const base = { v: 1, service: 'voice', event: 'dictation_opened', ts: 1, data: { source: 'hotkey' } }
  assert.equal(parseCanonicalVoiceDictationEvent({ ...base, v: undefined }), null)
  assert.equal(parseCanonicalVoiceDictationEvent({ ...base, ts: '1' }), null)
  assert.equal(parseCanonicalVoiceDictationEvent({ ...base, ts: Number.POSITIVE_INFINITY }), null)
  assert.equal(parseCanonicalVoiceDictationEvent({ ...base, data: { source: 'invalid' } }), null)
  assert.equal(parseCanonicalVoiceDictationEvent({ ...base, data: { source: 'hotkey', extra: true } }), null)
  assert.equal(parseCanonicalVoiceDictationEvent({ ...base, ref: 123 }), null)
  assert.equal(parseCanonicalVoiceDictationEvent({ ...base, extra: true }), null)
  assert.equal(normalizeVoiceDictationEvent({ ...base, type: 'dictation_opened' }), null)
})

test('legacy flat canvas events normalize only through the explicit adapter', () => {
  const event = adaptLegacyVoiceDictationBridgeEvent({
    type: 'dictation_closed_cancel',
    reason: 'timeout',
    ts: '2',
    ref: 'legacy-1',
  })

  assert.deepEqual(
    event,
    { v: 1, service: 'voice', event: 'dictation_closed_cancel', ts: 2, data: { reason: 'timeout' }, ref: 'legacy-1' },
  )
  assert.deepEqual(normalizeVoiceDictationEvent({ type: 'dictation_opened', source: 'phrase' }).data, { source: 'phrase' })
  assert.equal(adaptLegacyVoiceDictationBridgeEvent({ type: 'dictation_opened', source: 'invalid' }), null)
  assert.equal(adaptLegacyVoiceDictationBridgeEvent({ type: 'dictation_closed_send', data: {} }), null)
})

test('dictation text values can insert, append, replace, and apply to text targets', () => {
  assert.deepEqual(
    buildDictationTextValue('open window', 'terminal', { selectionStart: 5, selectionEnd: 11 }),
    { value: 'open terminal', selectionStart: 13, selectionEnd: 13, changed: true },
  )
  assert.equal(buildDictationTextValue('open', 'terminal', { mode: 'append' }).value, 'open terminal')
  assert.equal(buildDictationTextValue('open', 'close', { mode: 'replace' }).value, 'close')

  const target = { value: 'hello world', selectionStart: 6, selectionEnd: 11 }
  const result = applyDictationTextValue(target, 'there')
  assert.deepEqual(result, { value: 'hello there', selectionStart: 11, selectionEnd: 11, changed: true })
  assert.deepEqual(target, { value: 'hello there', selectionStart: 11, selectionEnd: 11 })
})
