import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifySafetyGate,
  evaluateSafetyGate,
} from '../../packages/toolkit/run-control/safety-gates.js'

test('safety gate classifiers cover V0 browser heuristics', () => {
  assert.equal(classifySafetyGate({ event: 'submit' }), 'before_submit')
  assert.equal(classifySafetyGate({ download: true }), 'before_download')
  assert.equal(classifySafetyGate({ input: { type: 'file' } }), 'before_file_upload')
  assert.equal(classifySafetyGate({ input: { name: 'cardNumber' } }), 'before_payment')
  assert.equal(classifySafetyGate({ input: { autocomplete: 'current-password' } }), 'before_login_secret')
  assert.equal(classifySafetyGate({ op: 'click', target_text: 'Delete account' }), 'before_destructive_action')
  assert.equal(
    classifySafetyGate({ url: 'https://other.test/jobs' }, { anchor_url: 'https://example.test/careers' }),
    'before_external_domain',
  )
})

test('routine browser actions pass without a safety gate', () => {
  assert.equal(classifySafetyGate({ op: 'click', target_text: 'Benefits' }), null)
  assert.deepEqual(evaluateSafetyGate({ op: 'scroll' }), { status: 'pass' })
})
