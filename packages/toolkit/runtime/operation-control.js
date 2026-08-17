// Internal Canvas bridge for the AOS operation control plane.
// Caller origin and owner authority are attached by the daemon; this module
// deliberately has no fields that can assert either one.

import { emit } from './bridge.js'

export const OPERATION_CONTROL_ACTIONS = Object.freeze([
  'list',
  'inspect',
  'status',
  'recent',
  'cancel',
  'kill',
  'kill_owner',
  'stop_all',
  'barrier_status',
  'reopen',
])

const ACTION_SET = new Set(OPERATION_CONTROL_ACTIONS)
const FORBIDDEN_AUTHORITY_FIELDS = new Set([
  'owner_root',
  'owner_root_id',
  'caller_origin',
  'caller_origin_evidence',
  'human_initiated',
  'effective_uid',
  'pid',
  'pid_generation',
])

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function cloneJSON(value) {
  return JSON.parse(JSON.stringify(value))
}

function assertNoAuthorityClaims(value, path = 'request') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoAuthorityClaims(item, `${path}[${index}]`))
    return
  }
  if (!plainObject(value)) return
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_AUTHORITY_FIELDS.has(key)) {
      throw new TypeError(`${path}.${key} is daemon-owned authority`)
    }
    assertNoAuthorityClaims(child, `${path}.${key}`)
  }
}

export function createOperationControlRequest(action, payload = {}, requestId = crypto.randomUUID()) {
  if (!ACTION_SET.has(action)) throw new TypeError(`unsupported operation action: ${action}`)
  if (!plainObject(payload)) throw new TypeError('operation payload must be an object')
  if (typeof requestId !== 'string' || requestId.length < 1 || requestId.length > 128) {
    throw new TypeError('operation request id must be a bounded string')
  }
  assertNoAuthorityClaims(payload)
  return Object.freeze({
    schema_version: 'aos.canvas-operation-control.request.v1',
    request_id: requestId,
    action,
    payload: cloneJSON(payload),
  })
}

export function requestOperationControl(action, payload = {}, requestId) {
  const request = createOperationControlRequest(action, payload, requestId)
  emit('operation.control.request', request)
  return request
}

export function requestOperationSnapshot(requestId) {
  return requestOperationControl('list', { filters: {} }, requestId)
}

export function requestHostStopAll(expectedBarrierGeneration, requestId) {
  if (!Number.isSafeInteger(expectedBarrierGeneration) || expectedBarrierGeneration < 1) {
    throw new TypeError('expected barrier generation must be a positive safe integer')
  }
  return requestOperationControl(
    'stop_all',
    { expected_barrier_generation: expectedBarrierGeneration },
    requestId,
  )
}
