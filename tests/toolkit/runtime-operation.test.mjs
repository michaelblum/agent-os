import assert from 'node:assert/strict'
import test from 'node:test'

globalThis.crypto ??= { randomUUID: () => '11111111-1111-4111-8111-111111111111' }
const runtime = await import('../../packages/toolkit/runtime/operation-control.js')

test('Canvas operation requests carry facts but cannot assert authority', () => {
  const request = runtime.createOperationControlRequest('kill_owner', {
    filters: { task_id: 'task-1', capability_id: 'microphone-capture' },
  }, 'request-1')
  assert.deepEqual(request, {
    schema_version: 'aos.canvas-operation-control.request.v1',
    request_id: 'request-1',
    action: 'kill_owner',
    payload: { filters: { task_id: 'task-1', capability_id: 'microphone-capture' } },
  })
  for (const key of ['owner_root', 'caller_origin', 'human_initiated', 'effective_uid', 'pid']) {
    assert.throws(() => runtime.createOperationControlRequest('list', { [key]: 'forged' }, 'request-2'))
  }
})
test('host stop requires exact barrier generation and the action vocabulary is closed', () => {
  const request = runtime.createOperationControlRequest('stop_all', {
    expected_barrier_generation: 4,
  }, 'request-3')
  assert.equal(request.action, 'stop_all')
  assert.throws(() => runtime.createOperationControlRequest('stop_selected', {}, 'request-4'))
  assert.throws(() => runtime.requestHostStopAll(0, 'request-5'))
})
