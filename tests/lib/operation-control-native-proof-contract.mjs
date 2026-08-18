import assert from 'node:assert/strict'
import path from 'node:path'

export const proofSchemaVersion = 'aos.operation-control-native-proof.v1'

export class OperationNativeProofError extends Error {
  constructor(code, message = code, beforeCaptureFailure = null) {
    super(message)
    this.name = 'OperationNativeProofError'
    this.code = code
    this.beforeCaptureFailure = beforeCaptureFailure
  }
}

export function requireProof(condition, code, message = code) {
  if (!condition) throw new OperationNativeProofError(code, message)
}

export function parseSingleJSON(text, code = 'INVALID_JSON_RESULT') {
  const trimmed = String(text ?? '').trim()
  requireProof(trimmed.length > 0, code)
  try {
    return JSON.parse(trimmed)
  } catch {
    throw new OperationNativeProofError(code)
  }
}

export function envelopeData(value, code = 'OPERATION_ENVELOPE_INVALID') {
  requireProof(value?.v === 1 && value?.status === 'success', code)
  requireProof(value.data && typeof value.data === 'object' && !Array.isArray(value.data), code)
  return value.data
}

const safeCommandErrorCodes = new Set([
  'DAEMON_UNREACHABLE',
  'EXTERNAL_SPAWN_INTENT_DAEMON_ERROR',
  'EXTERNAL_SPAWN_INTENT_INVALID',
  'EXTERNAL_SPAWN_INTENT_NO_RESPONSE',
  'INVALID_ARG',
  'INVALID_MANIFEST',
  'OPERATION_ADAPTER_REGISTRY_CONFLICT',
  'OPERATION_ARTIFACT_CUSTODY_UNAVAILABLE',
  'OPERATION_BARRIER_CLOSED',
  'OPERATION_BARRIER_GENERATION_CONFLICT',
  'OPERATION_BARRIER_NOT_CLOSED',
  'OPERATION_CALLER_NOT_AUTHENTICATED',
  'OPERATION_CONTROL_ORIGIN_UNSUPPORTED',
  'OPERATION_GENERATION_CONFLICT',
  'OPERATION_IDEMPOTENCY_CONFLICT',
  'OPERATION_NOT_FOUND',
  'OPERATION_OWNER_MISMATCH',
  'OPERATION_RECONCILIATION_INCOMPLETE',
  'OPERATION_RECORD_INVALID',
  'OPERATION_RECOVERY_CLAIM_STALE',
  'OPERATION_RESIDUALS_PRESENT',
  'OPERATION_RESOURCE_BUSY',
  'OPERATION_RESOURCE_CAS_CONFLICT',
  'OPERATION_RESOURCE_DECLARATION_CONFLICT',
  'OPERATION_RESOURCE_FANOUT_EXHAUSTED',
  'OPERATION_SPAWN_RECORD_CAPACITY',
  'OPERATION_STORE_CORRUPT',
  'OPERATION_STORE_LOCKED',
  'OPERATION_STORE_UNAVAILABLE',
  'OPERATION_TAP_UNAVAILABLE',
  'OPERATION_TRANSITION_INVALID',
])

function commandErrorClassificationFromValue(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const code = typeof value.code === 'string' && safeCommandErrorCodes.has(value.code)
    ? value.code
    : null
  if (code === null) return null
  const reason = code === 'OPERATION_RECORD_INVALID' && value.reason === 'external_spawn_intent'
    ? 'external_spawn_intent'
    : null
  return { code, reason }
}

export function commandErrorClassification(result) {
  for (const text of [result?.stdout, result?.stderr]) {
    const trimmed = String(text ?? '').trim()
    if (!trimmed) continue
    try {
      const classification = commandErrorClassificationFromValue(JSON.parse(trimmed))
      if (classification !== null) return classification
    } catch {
      // Fall through to the one-object-per-line envelope form.
    }
    for (const line of trimmed.split(/\r?\n/u).filter(Boolean).reverse()) {
      try {
        const classification = commandErrorClassificationFromValue(JSON.parse(line))
        if (classification !== null) return classification
      } catch {
        // Child diagnostics are treated as opaque unless they are one-line JSON.
      }
    }
  }
  return null
}

export function commandErrorCode(result) {
  return commandErrorClassification(result)?.code ?? null
}

export function captureEndedBeforeStartError(result) {
  const classification = commandErrorClassification(result)
  const beforeCaptureFailure = classification ?? {
    code: 'CAPTURE_ENDED_BEFORE_START',
    reason: null,
  }
  return new OperationNativeProofError(
    beforeCaptureFailure.code,
    beforeCaptureFailure.code,
    beforeCaptureFailure,
  )
}

function sha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0
}

export function assertPreflight({ build, status, service, permissions, barrier, aosPath }) {
  requireProof(build?.status === 'current' && build?.current === true, 'RUNTIME_BINARY_STALE')
  requireProof(sha256(build?.source_fingerprint), 'BUILD_ATTESTATION_INVALID')
  requireProof(build.source_fingerprint === build.recorded_fingerprint, 'RUNTIME_BINARY_STALE')

  const runtime = status?.runtime
  requireProof(status && typeof status === 'object' && runtime?.mode === 'repo', 'RUNTIME_MODE_MISMATCH')
  requireProof(runtime?.socket_reachable === true, 'DAEMON_UNAVAILABLE')
  requireProof(positiveInteger(runtime?.daemon_pid), 'DAEMON_IDENTITY_INVALID')
  requireProof(runtime.serving_pid === runtime.daemon_pid, 'DAEMON_IDENTITY_INVALID')
  requireProof(runtime.owner_pid === runtime.daemon_pid, 'DAEMON_IDENTITY_INVALID')
  requireProof(runtime.ownership_state === 'consistent', 'DAEMON_OWNERSHIP_MISMATCH')
  requireProof(runtime.ownership_kind === 'launchd_managed', 'DAEMON_OWNERSHIP_MISMATCH')
  requireProof(runtime.owner_launchd_managed === true, 'DAEMON_OWNERSHIP_MISMATCH')
  requireProof(positiveInteger(runtime.service_pid), 'SERVICE_PID_INVALID')

  requireProof(service?.status === 'ok' && service?.mode === 'repo', 'SERVICE_UNAVAILABLE')
  requireProof(service.loaded === true && service.running === true, 'SERVICE_UNAVAILABLE')
  requireProof(service.pid === runtime.service_pid, 'SERVICE_PID_MISMATCH')
  requireProof(service.target_matches_expected === true, 'SERVICE_BINARY_MISMATCH')
  if (typeof service.actual_binary_path === 'string') {
    requireProof(path.resolve(service.actual_binary_path) === path.resolve(aosPath), 'SERVICE_BINARY_MISMATCH')
  }
  if (typeof service.expected_binary_path === 'string') {
    requireProof(path.resolve(service.expected_binary_path) === path.resolve(aosPath), 'SERVICE_BINARY_MISMATCH')
  }

  const daemonPermissions = permissions?.daemon_view?.permissions ?? permissions?.daemon_view ?? {}
  requireProof(permissions?.permissions?.microphone === true, 'MICROPHONE_PERMISSION_REQUIRED')
  requireProof(permissions?.daemon_view?.reachable === true, 'DAEMON_UNAVAILABLE')
  requireProof(
    daemonPermissions.microphone === true && daemonPermissions.microphone_state === 'authorized',
    'MICROPHONE_PERMISSION_REQUIRED',
  )

  const barrierReceipt = envelopeData(barrier, 'BARRIER_STATUS_INVALID')
  requireProof(barrierReceipt.schema_version === 'aos.host-stop-barrier.status-receipt.v1', 'BARRIER_STATUS_INVALID')
  requireProof(
    positiveInteger(barrierReceipt.daemon_generation)
      && positiveInteger(barrierReceipt.barrier_generation),
    'BARRIER_STATUS_INVALID',
  )
  requireProof(barrierReceipt.barrier_state === 'open' && barrierReceipt.admission_open === true, 'BARRIER_NOT_OPEN')
  requireProof(barrierReceipt.reconciliation_state === 'complete', 'BARRIER_RECONCILIATION_INCOMPLETE')
  requireProof(barrierReceipt.residual_count === 0 && sha256(barrierReceipt.residual_digest), 'BARRIER_RESIDUAL_PRESENT')

  return {
    daemonIdentity: {
      daemonPID: runtime.daemon_pid,
      servicePID: runtime.service_pid,
      daemonGeneration: barrierReceipt.daemon_generation,
    },
    buildFingerprint: build.source_fingerprint,
    barrier: barrierReceipt,
  }
}

const stableBarrierKeys = Object.freeze([
  'adapter_registry_revision',
  'admission_open',
  'barrier_generation',
  'barrier_snapshot_digest',
  'barrier_state',
  'daemon_generation',
  'reconciliation_state',
  'registered_operation_set_count',
  'registered_operation_set_digest',
  'residual_count',
  'residual_digest',
  'selected_operation_count',
  'selected_operation_digest',
  'stop_operation_generation',
  'stop_operation_id',
])

export function assertBarrierUnchanged(initialBarrier, finalBarrier) {
  requireProof(initialBarrier && finalBarrier, 'BARRIER_CHANGED')
  for (const key of stableBarrierKeys) {
    requireProof(
      Object.hasOwn(initialBarrier, key)
        && Object.hasOwn(finalBarrier, key)
        && Object.is(finalBarrier[key], initialBarrier[key]),
      'BARRIER_CHANGED',
    )
  }
  return finalBarrier
}

export function activeMicrophoneOperations(listEnvelope) {
  const data = envelopeData(listEnvelope, 'OPERATION_LIST_INVALID')
  requireProof(data.schema_version === 'aos.operation.list-result.v1', 'OPERATION_LIST_INVALID')
  requireProof(Array.isArray(data.operations), 'OPERATION_LIST_INVALID')
  return data.operations.filter((operation) => (
    operation?.capability_id === 'microphone-capture-adapter'
    && operation?.state !== 'terminal'
  ))
}

export function assertOperationSnapshot(snapshot, expectedIdentity, expectedState = null) {
  requireProof(snapshot?.schema_version === 'aos.operation.v1', 'OPERATION_SNAPSHOT_INVALID')
  requireProof(snapshot.operation_id === expectedIdentity.id, 'OPERATION_IDENTITY_MISMATCH')
  requireProof(snapshot.operation_generation === expectedIdentity.generation, 'OPERATION_IDENTITY_MISMATCH')
  requireProof(snapshot.capability_id === 'microphone-capture-adapter', 'OPERATION_CAPABILITY_MISMATCH')
  if (expectedState !== null) requireProof(snapshot.state === expectedState, 'OPERATION_STATE_MISMATCH')
  return snapshot
}

export function operationIdentity(snapshot) {
  requireProof(typeof snapshot?.operation_id === 'string' && positiveInteger(snapshot?.operation_generation), 'OPERATION_IDENTITY_INVALID')
  return { id: snapshot.operation_id, generation: snapshot.operation_generation }
}

export function assertTerminalOperation(snapshot, { outcome, trigger, blame }) {
  assertOperationSnapshot(snapshot, operationIdentity(snapshot), 'terminal')
  requireProof(snapshot.cleanup?.result === 'zero_residuals', 'OPERATION_CLEANUP_INCOMPLETE')
  requireProof(snapshot.cleanup?.residual?.classification === 'none', 'OPERATION_CLEANUP_INCOMPLETE')
  requireProof(snapshot.cleanup?.residual?.count === 0, 'OPERATION_CLEANUP_INCOMPLETE')
  requireProof(snapshot.terminal?.outcome === outcome, 'OPERATION_TERMINAL_OUTCOME_MISMATCH')
  requireProof(snapshot.terminal?.trigger === trigger, 'OPERATION_TERMINAL_TRIGGER_MISMATCH')
  requireProof(snapshot.terminal?.blame === blame, 'OPERATION_TERMINAL_BLAME_MISMATCH')
  return snapshot
}

export function assertTapUnavailable(result, beforeSnapshot, afterSnapshot) {
  requireProof(result?.code !== 0, 'TAP_UNAVAILABLE_COMMAND_SUCCEEDED')
  requireProof(commandErrorCode(result) === 'OPERATION_TAP_UNAVAILABLE', 'TAP_UNAVAILABLE_CODE_INVALID')
  requireProof(Array.isArray(beforeSnapshot?.taps) && Array.isArray(afterSnapshot?.taps), 'TAP_RECORD_SET_INVALID')
  requireProof(
    JSON.stringify(afterSnapshot.taps) === JSON.stringify(beforeSnapshot.taps),
    'TAP_RECORD_CREATED',
  )
  return 'OPERATION_TAP_UNAVAILABLE'
}

export function makeSummary(runtimeRevision) {
  return {
    schema_version: proofSchemaVersion,
    execution_mode: 'unstarted',
    status: 'failed',
    runtime_revision: runtimeRevision,
    failure_code: null,
    before_capture_failure: null,
    offline_checks: {
      live_evidence_unset: false,
      runtime_command_count: null,
      summary_contract_validated: false,
    },
    preflight: {
      managed_repo_daemon: false,
      microphone_authorized: false,
      barrier_open: false,
      build_current: false,
    },
    ownership: {
      same_root_visible: false,
      cross_root_error_code: null,
      asserted_filter_empty: false,
      asserted_filter_target_remained_active: false,
    },
    singleton: {
      error_code: null,
      incumbent_remained_active: false,
    },
    tap: {
      error_code: null,
      no_record_created: false,
    },
    ordinary_control: {
      cancel_outcome: null,
      kill_outcome: null,
      zero_residuals: false,
    },
    final: {
      barrier_open: false,
      barrier_unchanged: false,
      owned_nonterminal_operation_count: null,
      owned_outputs_removed: false,
      daemon_stable: false,
      build_stable: false,
      cleanup_complete: false,
      recovery_root_retained: true,
    },
    excluded_claims: {
      artifact_success_tested: false,
      host_stop_reopen_tested: false,
      status_canvas_tested: false,
      prior_generation_recovery_tested: false,
      stop_all_replay_tested: false,
      positive_attribution_tested: false,
      public_sdk_tested: false,
      tap_source_delivery_tested: false,
      peer_loss_tested: false,
    },
  }
}

const prohibitedSummaryKey = /(?:path|pid|token|argv|stdout|stderr|audio|segment|text|url|account|credential)/iu
const absolutePathValue = /(?:^|[\s"'])\/(?:Users|private|tmp|var|Applications|Volumes)\//u
const contentFreeFailureCode = /^[A-Z][A-Z0-9_]{0,127}$/u

export function assertContentFreeSummary(summary) {
  requireProof(summary?.schema_version === proofSchemaVersion, 'SUMMARY_SCHEMA_INVALID')
  requireProof(
    summary.failure_code === null
      || (typeof summary.failure_code === 'string' && contentFreeFailureCode.test(summary.failure_code)),
    'SUMMARY_FAILURE_CLASSIFICATION_INVALID',
  )
  requireProof(
    summary.before_capture_failure === null
      || (
        summary.before_capture_failure
        && typeof summary.before_capture_failure === 'object'
        && !Array.isArray(summary.before_capture_failure)
        && JSON.stringify(Object.keys(summary.before_capture_failure).sort())
          === JSON.stringify(['code', 'reason'])
        && (summary.before_capture_failure.code === 'CAPTURE_ENDED_BEFORE_START'
          || safeCommandErrorCodes.has(summary.before_capture_failure.code))
        && (summary.before_capture_failure.reason === null
          || (summary.before_capture_failure.code === 'OPERATION_RECORD_INVALID'
            && summary.before_capture_failure.reason === 'external_spawn_intent'))
      ),
    'SUMMARY_FAILURE_CLASSIFICATION_INVALID',
  )
  requireProof(
    summary.offline_checks
      && typeof summary.offline_checks === 'object'
      && !Array.isArray(summary.offline_checks)
      && JSON.stringify(Object.keys(summary.offline_checks).sort()) === JSON.stringify([
        'live_evidence_unset',
        'runtime_command_count',
        'summary_contract_validated',
      ]),
    'SUMMARY_SCHEMA_INVALID',
  )
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        requireProof(!prohibitedSummaryKey.test(key), 'SUMMARY_SENSITIVE_KEY')
        visit(child)
      }
      return
    }
    if (typeof value === 'string') {
      requireProof(!absolutePathValue.test(value) && !/\.wav\b/iu.test(value), 'SUMMARY_SENSITIVE_VALUE')
    }
  }
  visit(summary)
  assert.deepEqual(Object.keys(summary.excluded_claims).sort(), [
    'artifact_success_tested',
    'host_stop_reopen_tested',
    'peer_loss_tested',
    'positive_attribution_tested',
    'prior_generation_recovery_tested',
    'public_sdk_tested',
    'status_canvas_tested',
    'stop_all_replay_tested',
    'tap_source_delivery_tested',
  ])
  requireProof(Object.values(summary.excluded_claims).every((value) => value === false), 'SUMMARY_EXCLUDED_CLAIM_INVALID')
  return summary
}

export function selfTestSummary(runtimeRevision = '0'.repeat(40)) {
  const summary = makeSummary(runtimeRevision)
  Object.assign(summary.offline_checks, {
    live_evidence_unset: true,
    runtime_command_count: 0,
    summary_contract_validated: true,
  })
  summary.failure_code = null
  summary.execution_mode = 'offline_self_test'
  summary.status = 'passed'
  return assertContentFreeSummary(summary)
}
