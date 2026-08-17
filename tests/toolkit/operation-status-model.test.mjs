import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyOperationControlMessage,
  createOperationControlModel,
  operationControlCounts,
} from '../../packages/toolkit/components/operation-control/model.js'

test('operation projection is content-free, deterministic, and exposes cleanup facts', () => {
  const result = applyOperationControlMessage(createOperationControlModel(), {
    schema_version: 'aos.canvas-operation-control.projection.v1',
    revision: 7,
    checked_at: '2026-08-16T00:00:00Z',
    barrier: { generation: 9, state: 'open', admission_open: true },
    operations: [
      {
        operation_id: 'b', operation_generation: 2, capability_id: 'capture',
        owner_root_id: 'owner-2', state: 'cleanup_required', cleanup_result: 'residuals_present',
        resource_claims: [{
          claim_id: 'claim-b', transaction_id: 'transaction-b', resource_key: 'camera.input',
          resource_generation: 7, admission_mode: 'multiplexable',
          adapter_registration_id: 'capture-adapter', adapter_registration_revision: 2,
          state: 'recovering', broker_id: 'broker-b', broker_generation: 8,
          subscriber_id: 'subscriber-b', raw_resource: 'must-not-project',
        }],
        artifacts: [{
          artifact_id: 'artifact-b', artifact_generation: 4, state: 'recovering',
          recovery_origin_state: 'retained', recovery_disposition: 'retention_verification',
          custody_digest: 'b'.repeat(64), raw_path: '/must/not/project',
        }],
      },
      {
        operation_id: 'a', operation_generation: 1, capability_id: 'microphone-capture',
        owner_root_id: 'owner-1', state: 'active', status_indicator_class: 'recording',
        resource_claims: [{
          claim_id: 'claim-a', transaction_id: 'transaction-a', resource_key: 'microphone.input',
          resource_generation: 3, admission_mode: 'exclusive',
          adapter_registration_id: 'recording-adapter', adapter_registration_revision: 4,
          state: 'active',
        }],
        artifacts: [{
          artifact_id: 'artifact-a', artifact_generation: 2, state: 'published',
          custody_digest: 'a'.repeat(64),
        }],
        raw_data: 'must-not-project',
      },
    ],
  })
  assert.deepEqual(result.operations.map((value) => value.operation_id), ['a', 'b'])
  assert.equal('raw_data' in result.operations[0], false)
  assert.deepEqual(result.operations[0].resource_claims, [{
    claim_id: 'claim-a', transaction_id: 'transaction-a', resource_key: 'microphone.input',
    resource_generation: 3, admission_mode: 'exclusive',
    adapter_registration_id: 'recording-adapter', adapter_registration_revision: 4,
    state: 'active', broker_id: null, broker_generation: null, subscriber_id: null,
  }])
  assert.equal('raw_resource' in result.operations[1].resource_claims[0], false)
  assert.deepEqual(result.operations[1].artifacts, [{
    artifact_id: 'artifact-b', artifact_generation: 4, state: 'recovering',
    recovery_origin_state: 'retained', recovery_disposition: 'retention_verification',
    custody_digest: 'b'.repeat(64),
  }])
  assert.equal('raw_path' in result.operations[1].artifacts[0], false)
  assert.equal(result.operations[0].resource_claim_count, 1)
  assert.equal(result.operations[0].artifact_count, 1)
  assert.deepEqual(operationControlCounts(result), { total: 2, active: 1, recording: 1, residual: 1 })
})

test('unknown projection messages are ignored', () => {
  const initial = createOperationControlModel()
  assert.equal(applyOperationControlMessage(initial, { schema_version: 'other' }), initial)
})
