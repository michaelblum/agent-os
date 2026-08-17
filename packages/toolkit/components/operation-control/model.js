export const OPERATION_CONTROL_MODEL_SCHEMA = 'aos.canvas-operation-control.model.v1'

const OPERATION_STATES = new Set([
  'prepared', 'starting', 'active', 'stopping', 'cleanup_required', 'recovering', 'terminal',
])

const RECORDING_INDICATOR_RED_STATES = new Set(['active'])

const RESOURCE_CLAIM_STATES = new Set([
  'prepared', 'active', 'releasing', 'cleanup_required', 'recovering', 'terminal',
])

const ARTIFACT_STATES = new Set([
  'transient', 'published', 'released', 'retained', 'removing', 'removed',
  'cleanup_required', 'recovering',
])

const ARTIFACT_RECOVERY_DISPOSITIONS = new Set([
  'release_verification', 'retention_verification', 'removal_verification',
])

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function string(value, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function integer(value, fallback = 0) {
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback
}

function optionalString(value) {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function digest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value) ? value : null
}

export function normalizeResourceClaim(value) {
  const input = object(value)
  const claimID = string(input.claim_id)
  const transactionID = string(input.transaction_id)
  const resourceKey = string(input.resource_key)
  const resourceGeneration = integer(input.resource_generation)
  const admissionMode = string(input.admission_mode)
  const state = string(input.state)
  const adapterRegistrationID = string(input.adapter_registration_id)
  const adapterRegistrationRevision = integer(input.adapter_registration_revision)
  if (!claimID || !transactionID || !resourceKey || resourceGeneration < 1
      || !['exclusive', 'multiplexable'].includes(admissionMode)
      || !RESOURCE_CLAIM_STATES.has(state)
      || !adapterRegistrationID || adapterRegistrationRevision < 1) return null
  const brokerID = optionalString(input.broker_id)
  const brokerGeneration = integer(input.broker_generation)
  const subscriberID = optionalString(input.subscriber_id)
  if (admissionMode === 'exclusive' && (brokerID !== null || brokerGeneration > 0 || subscriberID !== null)) {
    return null
  }
  if (admissionMode === 'multiplexable' && (!brokerID || brokerGeneration < 1 || !subscriberID)) {
    return null
  }
  return Object.freeze({
    claim_id: claimID,
    transaction_id: transactionID,
    resource_key: resourceKey,
    resource_generation: resourceGeneration,
    admission_mode: admissionMode,
    adapter_registration_id: adapterRegistrationID,
    adapter_registration_revision: adapterRegistrationRevision,
    state,
    broker_id: brokerID,
    broker_generation: brokerGeneration || null,
    subscriber_id: subscriberID,
  })
}

export function normalizeArtifact(value) {
  const input = object(value)
  const artifactID = string(input.artifact_id)
  const artifactGeneration = integer(input.artifact_generation)
  const state = string(input.state)
  if (!artifactID || artifactGeneration < 1 || !ARTIFACT_STATES.has(state)) return null
  const recoveryOriginState = optionalString(input.recovery_origin_state)
  const recoveryDisposition = optionalString(input.recovery_disposition)
  if ((recoveryOriginState !== null && !ARTIFACT_STATES.has(recoveryOriginState))
      || (recoveryDisposition !== null
        && !ARTIFACT_RECOVERY_DISPOSITIONS.has(recoveryDisposition))) return null
  return Object.freeze({
    artifact_id: artifactID,
    artifact_generation: artifactGeneration,
    state,
    recovery_origin_state: recoveryOriginState,
    recovery_disposition: recoveryDisposition,
    custody_digest: digest(input.custody_digest),
  })
}

export function normalizeOperationSummary(value) {
  const input = object(value)
  const state = string(input.state)
  if (!string(input.operation_id) || !Number.isSafeInteger(input.operation_generation) || input.operation_generation < 1) {
    return null
  }
  if (!OPERATION_STATES.has(state)) return null
  const resourceClaims = Array.isArray(input.resource_claims)
    ? input.resource_claims.map(normalizeResourceClaim).filter(Boolean)
      .sort((left, right) => left.resource_key.localeCompare(right.resource_key)
        || left.resource_generation - right.resource_generation
        || left.claim_id.localeCompare(right.claim_id))
    : []
  const artifacts = Array.isArray(input.artifacts)
    ? input.artifacts.map(normalizeArtifact).filter(Boolean)
      .sort((left, right) => left.artifact_id.localeCompare(right.artifact_id)
        || left.artifact_generation - right.artifact_generation)
    : []
  return Object.freeze({
    operation_id: input.operation_id,
    operation_generation: input.operation_generation,
    capability_id: string(input.capability_id, 'unknown'),
    capability_label: string(input.capability_label),
    owner_root_id: string(input.owner_root_id, 'unknown'),
    state,
    status_indicator_class: input.status_indicator_class === 'recording' ? 'recording' : 'neutral',
    outcome: string(input.outcome),
    blame: string(input.blame),
    cleanup_result: string(input.cleanup_result, 'not_started'),
    resource_claim_count: resourceClaims.length,
    resource_claims: Object.freeze(resourceClaims),
    artifact_count: artifacts.length,
    artifacts: Object.freeze(artifacts),
    updated_at: string(input.updated_at),
  })
}

export function createOperationControlModel() {
  return Object.freeze({
    schema_version: OPERATION_CONTROL_MODEL_SCHEMA,
    revision: 0,
    checked_at: '',
    barrier: Object.freeze({ generation: 0, state: 'boot_reconciling', admission_open: false }),
    operations: Object.freeze([]),
    last_receipt: null,
    last_error: null,
  })
}

export function applyOperationControlMessage(current, message) {
  const model = object(current)
  const input = object(message)
  if (input.schema_version !== 'aos.canvas-operation-control.projection.v1') return current

  const operations = Array.isArray(input.operations)
    ? input.operations.map(normalizeOperationSummary).filter(Boolean)
      .sort((left, right) => left.operation_id.localeCompare(right.operation_id)
        || left.operation_generation - right.operation_generation)
    : []
  const barrier = object(input.barrier)
  const generation = integer(barrier.generation)
  const state = string(barrier.state, 'boot_reconciling')
  return Object.freeze({
    schema_version: OPERATION_CONTROL_MODEL_SCHEMA,
    revision: integer(input.revision, integer(model.revision) + 1),
    checked_at: string(input.checked_at),
    barrier: Object.freeze({
      generation,
      state,
      admission_open: barrier.admission_open === true,
    }),
    operations: Object.freeze(operations),
    last_receipt: input.receipt === undefined ? model.last_receipt ?? null : object(input.receipt),
    last_error: input.error === undefined ? null : object(input.error),
  })
}

export function operationControlCounts(model) {
  const operations = Array.isArray(model?.operations) ? model.operations : []
  return Object.freeze({
    total: operations.length,
    active: operations.filter((value) => ['starting', 'active', 'stopping'].includes(value.state)).length,
    recording: operations.filter((value) => value.status_indicator_class === 'recording'
      && RECORDING_INDICATOR_RED_STATES.has(value.state)).length,
    residual: operations.filter((value) => ['cleanup_required', 'recovering'].includes(value.state)).length,
  })
}
