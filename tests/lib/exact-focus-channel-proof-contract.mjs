import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { supervisorProjectionIsValid } from './exact-focus-channel-supervision-protocol.mjs';

export const AOS_COMMAND_ERROR_MAX_BYTES = 2_048;
export const AOS_COMMAND_ERROR_CODE_LIST = Object.freeze([
  'CHANNEL_NOT_FOUND',
  'CHANNEL_STALE',
  'DAEMON_UNREACHABLE',
  'DAEMON_UNAVAILABLE',
  'DUPLICATE_ID',
  'INTERNAL',
  'INVALID_DEPTH',
  'NATIVE_AX_ROOT_MISMATCH',
  'WINDOW_NOT_FOUND',
]);
export const AOS_PRECOMMIT_REJECTION_CODE_LIST = Object.freeze([
  'CHANNEL_NOT_FOUND',
  'CHANNEL_STALE',
  'DUPLICATE_ID',
  'INVALID_DEPTH',
  'NATIVE_AX_ROOT_MISMATCH',
  'WINDOW_NOT_FOUND',
]);
export const PROGRESS_SCHEMA = 'aos.exact-focus-channel-native-progress.v2';
export const PROGRESS_MAX_BYTES = 2_048;
export const PROGRESS_MAX_ELAPSED_MS = 1_800_000;
export const PROGRESS_STAGES = Object.freeze([
  'runtime_preflight',
  'unrelated_channel_snapshot',
  'fixture_startup',
  'sibling_subtree_rejection',
  'target_channel_creation',
  'initial_capture',
  'rejected_refresh',
  'preserved_capture',
  'target_close',
  'missing_target_capture',
  'missing_target_refresh',
  'channel_cleanup',
  'fixture_cleanup',
  'postflight_attestation',
]);
export const PROGRESS_MAX_ORDINAL = PROGRESS_STAGES.length * 2;

const AOS_COMMAND_ERROR_CODES = new Set(AOS_COMMAND_ERROR_CODE_LIST);
const AOS_PRECOMMIT_REJECTION_CODES = new Set(AOS_PRECOMMIT_REJECTION_CODE_LIST);
const PROGRESS_STAGE_SET = new Set(PROGRESS_STAGES);
const DRIVER_SUMMARY_MAX_BYTES = 8_192;
const DRIVER_FAILURE_BOOLEAN_FIELDS = Object.freeze([
  'channel_removed',
  'cleanup_complete',
  'command_admission_ambiguous',
  'direct_capture_ready_preserved',
  'fixture_process_reaped',
  'fixture_windows_removed',
  'microphone_requested',
  'pixels_persisted',
  'raw_capture_logged',
  'runtime_provenance_preserved',
  'shared_daemon_preserved',
  'unrelated_channel_stable_fields_preserved',
]);
const DRIVER_FAILURE_KEYS = Object.freeze([
  ...DRIVER_FAILURE_BOOLEAN_FIELDS,
  'command_error_code',
  'error_code',
  'status',
]);
const DRIVER_SUCCESS_TRUE_FIELDS = Object.freeze([
  'channel_removed',
  'cleanup_complete',
  'daemon_path_start_order_bound',
  'direct_capture_ready_preserved',
  'exact_ax_scope_verified',
  'exact_window_pixels_verified',
  'failed_capture_artifact_absent',
  'fixture_process_reaped',
  'fixture_windows_removed',
  'missing_target_capture_rejected',
  'missing_target_refresh_rejected',
  'overlap_verified',
  'rejected_refresh_preserved',
  'rejected_refresh_recaptured',
  'runtime_provenance_preserved',
  'same_process_windows',
  'shared_daemon_preserved',
  'sibling_above_target',
  'sibling_refresh_rejected',
  'sibling_subtree_rejected',
  'unrelated_channel_stable_fields_preserved',
]);
const DRIVER_SUCCESS_FALSE_FIELDS = Object.freeze([
  'command_admission_ambiguous',
  'microphone_requested',
  'pixels_persisted',
  'raw_capture_logged',
]);
const DRIVER_SUCCESS_FRACTION_FIELDS = Object.freeze([
  'cyan_fraction', 'green_fraction', 'magenta_fraction', 'overlap_fraction',
]);
const DRIVER_SUCCESS_POSITIVE_INTEGER_FIELDS = Object.freeze([
  'ax_element_count', 'capture_byte_count', 'capture_height', 'capture_width',
]);
const DRIVER_SUCCESS_KEYS = Object.freeze([
  ...DRIVER_SUCCESS_TRUE_FIELDS,
  ...DRIVER_SUCCESS_FALSE_FIELDS,
  ...DRIVER_SUCCESS_FRACTION_FIELDS,
  ...DRIVER_SUCCESS_POSITIVE_INTEGER_FIELDS,
  'build_source_fingerprint',
  'capture_sha256',
  'command_error_code',
  'foreign_window_id_count',
  'repo_revision',
  'status',
  'unique_window_id_count',
]);
const FINAL_OUTPUT_BOOLEAN_FIELDS = new Set([
  ...DRIVER_FAILURE_BOOLEAN_FIELDS,
  ...DRIVER_SUCCESS_TRUE_FIELDS,
  ...DRIVER_SUCCESS_FALSE_FIELDS,
  'admission_ack_bound',
  'ambiguous_admission_cleanup_safe',
  'captured_output_reflected',
  'cleanup_failure_forced_failure',
  'cleanup_signal_deferred',
  'delayed_guardian_reaped',
  'durable_record_recovered',
  'ephemeral_snapshot_key',
  'final_reap_signal_idempotent',
  'guardian_authenticated_after_supervisor_crash',
  'handshake_failed',
  'injected_supervisor_failure_reaped',
  'invalid_guardian_identity_failed_closed',
  'live_unrelated_group_preserved',
  'long_argv_fixture_reaped',
  'missing_aos_cleanup_retained_root',
  'outer_reap_recovered',
  'owned_child_reaped',
  'owned_descendant_reaped',
  'owned_group_reaped',
  'owned_process_group_reaped',
  'parent_loss_before_admission_fail_closed',
  'parent_loss_before_record_fail_closed',
  'payload_admitted',
  'payload_admitted_after_ack',
  'payload_exit_status_preserved',
  'payload_outcome_validated_before_crash',
  'primary_timeout_preserved',
  'progress_receipt_valid',
  'record_publication_failure_bounded',
  'record_recovered_after_guardian_crash',
  'recovery_root_retained',
  'revision_preflight',
  'run_program_timeout_ambiguous',
  'sanitizer_timeout_bounded',
  'shell_progress_transition_coherence',
  'signal_before_admission_fail_closed',
  'supervisor_start_handshake_fail_closed',
  'timeout_descendant_reaped',
  'unresolved_group_record_preserved',
  'withheld_readiness_cleanup',
  'guardian_identity_publication_fail_closed',
]);
const FINAL_OUTPUT_FRACTION_FIELDS = new Set(DRIVER_SUCCESS_FRACTION_FIELDS);
const FINAL_OUTPUT_POSITIVE_INTEGER_FIELDS = new Set(DRIVER_SUCCESS_POSITIVE_INTEGER_FIELDS);
const FINAL_OUTPUT_LOWER_SNAKE_FIELDS = new Set([
  'supervisor_cleanup_detail',
  'supervisor_cleanup_stage',
  'supervisor_detail',
  'supervisor_reason',
  'supervisor_stage',
]);
const FINAL_OUTPUT_FIELD_VALIDATORS = new Map([
  ...[...FINAL_OUTPUT_BOOLEAN_FIELDS].map((field) => [
    field, (value) => typeof value === 'boolean',
  ]),
  ...[...FINAL_OUTPUT_FRACTION_FIELDS].map((field) => [
    field, (value) => Number.isFinite(value) && value >= 0 && value <= 1,
  ]),
  ...[...FINAL_OUTPUT_POSITIVE_INTEGER_FIELDS].map((field) => [
    field, (value) => Number.isSafeInteger(value) && value > 0,
  ]),
  ...[...FINAL_OUTPUT_LOWER_SNAKE_FIELDS].map((field) => [
    field, (value) => typeof value === 'string' && /^[a-z][a-z0-9_]*$/u.test(value),
  ]),
  ['build_source_fingerprint', (value) => /^[0-9a-f]{64}$/u.test(value ?? '')],
  ['capture_sha256', (value) => /^[0-9a-f]{64}$/u.test(value ?? '')],
  ['command_error_code', (value) => value === null || isAOSCommandErrorCode(value)],
  ['error_code', (value) => typeof value === 'string'
    && /^[A-Z][A-Z0-9_]{0,127}$/u.test(value)],
  ['foreign_window_id_count', (value) => value === 0],
  ['initialization_error_code', (value) => typeof value === 'string'
    && /^[A-Z][A-Z0-9_]{0,127}$/u.test(value)],
  ['last_completed_stage', (value) => value === null || value === 'unknown' || isProgressStage(value)],
  ['last_started_stage', (value) => value === 'unknown' || isProgressStage(value)],
  ['progress_elapsed_ms', (value) => value === null
    || (Number.isSafeInteger(value) && value >= 0 && value <= PROGRESS_MAX_ELAPSED_MS)],
  ['progress_ordinal', (value) => value === null
    || (Number.isSafeInteger(value) && value >= 1 && value <= PROGRESS_MAX_ORDINAL)],
  ['repo_revision', (value) => /^[0-9a-f]{40}$/u.test(value ?? '')],
  ['status', (value) => value === 'failed' || value === 'passed'],
  ['supervisor_status', (value) => Number.isSafeInteger(value)
    && value >= 0 && value <= 255],
  ['unique_window_id_count', (value) => value === 1],
]);

function exactKeys(value, keys) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

export function isAOSCommandErrorCode(value) {
  return typeof value === 'string' && AOS_COMMAND_ERROR_CODES.has(value);
}

export function isAOSPrecommitRejectionCode(value) {
  return typeof value === 'string' && AOS_PRECOMMIT_REJECTION_CODES.has(value);
}

export function extractAOSCommandErrorCode(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.code === 'string') return payload.code;
  if (payload.error && typeof payload.error === 'object' && typeof payload.error.code === 'string') {
    return payload.error.code;
  }
  if (payload.data && typeof payload.data === 'object') {
    return extractAOSCommandErrorCode(payload.data);
  }
  return null;
}

export function allowlistedAOSCommandErrorFromText(text) {
  if (typeof text !== 'string') return null;
  const size = Buffer.byteLength(text, 'utf8');
  if (size < 1 || size > AOS_COMMAND_ERROR_MAX_BYTES) return null;
  try {
    const code = extractAOSCommandErrorCode(JSON.parse(text.trim()));
    return /^[A-Z][A-Z0-9_]*$/u.test(code ?? '') && isAOSCommandErrorCode(code) ? code : null;
  } catch {
    return null;
  }
}

export function validateDriverSummaryText(text) {
  try {
    if (typeof text !== 'string'
        || Buffer.byteLength(text, 'utf8') < 1
        || Buffer.byteLength(text, 'utf8') > DRIVER_SUMMARY_MAX_BYTES) return null;
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (value.status === 'failed') {
      if (!exactKeys(value, DRIVER_FAILURE_KEYS)) return null;
      if (!DRIVER_FAILURE_BOOLEAN_FIELDS.every((field) => typeof value[field] === 'boolean')) {
        return null;
      }
      if (!/^[A-Z][A-Z0-9_]{0,127}$/u.test(value.error_code ?? '')) return null;
      if (value.command_error_code !== null
          && !isAOSCommandErrorCode(value.command_error_code)) return null;
      return Object.fromEntries(DRIVER_FAILURE_KEYS.map((key) => [key, value[key]]));
    }
    if (value.status !== 'passed' || !exactKeys(value, DRIVER_SUCCESS_KEYS)) return null;
    if (!DRIVER_SUCCESS_TRUE_FIELDS.every((field) => value[field] === true)) return null;
    if (!DRIVER_SUCCESS_FALSE_FIELDS.every((field) => value[field] === false)) return null;
    if (!DRIVER_SUCCESS_FRACTION_FIELDS.every((field) => (
      Number.isFinite(value[field]) && value[field] >= 0 && value[field] <= 1
    ))) return null;
    if (!DRIVER_SUCCESS_POSITIVE_INTEGER_FIELDS.every((field) => (
      Number.isSafeInteger(value[field]) && value[field] > 0
    ))) return null;
    if (value.command_error_code !== null
        || value.foreign_window_id_count !== 0
        || value.unique_window_id_count !== 1) return null;
    if (!/^[0-9a-f]{40}$/u.test(value.repo_revision)
        || !/^[0-9a-f]{64}$/u.test(value.build_source_fingerprint)
        || !/^[0-9a-f]{64}$/u.test(value.capture_sha256)) return null;
    return Object.fromEntries(DRIVER_SUCCESS_KEYS.map((key) => [key, value[key]]));
  } catch {
    return null;
  }
}

export function progressTransitionIsCoherent(ordinal, lastStartedStage, lastCompletedStage) {
  if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > PROGRESS_MAX_ORDINAL) return false;
  const stageIndex = Math.floor((ordinal - 1) / 2);
  const expectedStage = PROGRESS_STAGES[stageIndex];
  const expectedCompletedStage = ordinal % 2 === 0
    ? expectedStage
    : (stageIndex === 0 ? null : PROGRESS_STAGES[stageIndex - 1]);
  return lastStartedStage === expectedStage && lastCompletedStage === expectedCompletedStage;
}

export function isProgressStage(value) {
  return PROGRESS_STAGE_SET.has(value);
}

export function monotonicElapsedMilliseconds(startedAt) {
  const elapsed = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
  return Math.min(Math.max(elapsed, 0), PROGRESS_MAX_ELAPSED_MS);
}

export function writeProgressReceipt(file, receipt) {
  const tempFile = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${receipt.ordinal}.tmp`,
  );
  let descriptor = null;
  try {
    descriptor = fs.openSync(tempFile, 'wx', 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(receipt)}\n`, { encoding: 'utf8' });
    fs.fchmodSync(descriptor, 0o600);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(tempFile, file);
  } catch {
    if (descriptor !== null) try { fs.closeSync(descriptor); } catch {}
    try { fs.unlinkSync(tempFile); } catch {}
    const error = new Error('PROGRESS_RECEIPT_WRITE_FAILED');
    error.code = 'PROGRESS_RECEIPT_WRITE_FAILED';
    throw error;
  }
}

export function unknownSanitizedProgress() {
  return {
    progress_receipt_valid: false,
    progress_ordinal: null,
    last_started_stage: 'unknown',
    last_completed_stage: 'unknown',
    progress_elapsed_ms: null,
  };
}

export function validatedProgressReceipt(file) {
  let descriptor = null;
  try {
    const noFollow = fs.constants.O_NOFOLLOW;
    if (!Number.isInteger(noFollow) || noFollow === 0) return null;
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | noFollow);
    const metadata = fs.fstatSync(descriptor);
    if (!metadata.isFile() || metadata.size < 1 || metadata.size > PROGRESS_MAX_BYTES) return null;
    if ((metadata.mode & 0o777) !== 0o600) return null;
    const bytes = Buffer.alloc(metadata.size);
    if (fs.readSync(descriptor, bytes, 0, bytes.length, 0) !== bytes.length) return null;
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes)) return null;
    const receipt = JSON.parse(text);
    if (!exactKeys(receipt, [
      'elapsed_ms', 'last_completed_stage', 'last_started_stage', 'ordinal', 'schema',
    ])) return null;
    if (receipt.schema !== PROGRESS_SCHEMA) return null;
    if (!progressTransitionIsCoherent(
      receipt.ordinal, receipt.last_started_stage, receipt.last_completed_stage,
    )) return null;
    if (!Number.isSafeInteger(receipt.elapsed_ms)
        || receipt.elapsed_ms < 0
        || receipt.elapsed_ms > PROGRESS_MAX_ELAPSED_MS) return null;
    return receipt;
  } catch {
    return null;
  } finally {
    if (descriptor !== null) try { fs.closeSync(descriptor); } catch {}
  }
}

export function sanitizedProgressFromFile(file) {
  const receipt = validatedProgressReceipt(file);
  return receipt === null ? unknownSanitizedProgress() : {
    progress_receipt_valid: true,
    progress_ordinal: receipt.ordinal,
    last_started_stage: receipt.last_started_stage,
    last_completed_stage: receipt.last_completed_stage,
    progress_elapsed_ms: receipt.elapsed_ms,
  };
}

function validatedSanitizedProgress(value, maxElapsedMilliseconds) {
  if (!exactKeys(value, [
    'last_completed_stage', 'last_started_stage', 'progress_elapsed_ms',
    'progress_ordinal', 'progress_receipt_valid',
  ])) return null;
  if (value.progress_receipt_valid === false) {
    return value.progress_ordinal === null
      && value.last_started_stage === 'unknown'
      && value.last_completed_stage === 'unknown'
      && value.progress_elapsed_ms === null ? value : null;
  }
  return value.progress_receipt_valid === true
    && progressTransitionIsCoherent(
      value.progress_ordinal, value.last_started_stage, value.last_completed_stage,
    )
    && Number.isSafeInteger(value.progress_elapsed_ms)
    && value.progress_elapsed_ms >= 0
    && value.progress_elapsed_ms <= maxElapsedMilliseconds ? value : null;
}

export function mergeSanitizedProgressText(summaryText, progressText, maxElapsedMilliseconds) {
  try {
    const summary = JSON.parse(summaryText);
    if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return null;
    const candidate = validatedSanitizedProgress(JSON.parse(progressText), maxElapsedMilliseconds)
      ?? unknownSanitizedProgress();
    Object.assign(summary, {
      progress_receipt_valid: candidate.progress_receipt_valid,
      progress_ordinal: candidate.progress_ordinal,
      last_started_stage: candidate.last_started_stage,
      last_completed_stage: candidate.last_completed_stage,
      progress_elapsed_ms: candidate.progress_elapsed_ms,
    });
    return summary;
  } catch {
    return null;
  }
}

export function fallbackDriverSummary(commandStatus) {
  if (!Number.isSafeInteger(commandStatus)) return null;
  return Object.freeze({
    ...unknownSanitizedProgress(),
    cleanup_complete: false,
    command_admission_ambiguous: true,
    command_error_code: null,
    error_code: commandStatus === 124 ? 'PROOF_TIMEOUT' : 'NATIVE_PROOF_FAILED',
    microphone_requested: false,
    pixels_persisted: false,
    raw_capture_logged: false,
    status: 'failed',
  });
}

export function finalOutputInvalidFallback({ pixelsPersisted, recoveryRootRetained }) {
  if (typeof pixelsPersisted !== 'boolean' || typeof recoveryRootRetained !== 'boolean') return null;
  return Object.freeze({
    cleanup_complete: false,
    command_admission_ambiguous: true,
    command_error_code: null,
    error_code: 'PROOF_FINAL_OUTPUT_INVALID',
    last_completed_stage: 'unknown',
    last_started_stage: 'unknown',
    microphone_requested: false,
    pixels_persisted: pixelsPersisted,
    progress_elapsed_ms: null,
    progress_ordinal: null,
    progress_receipt_valid: false,
    raw_capture_logged: false,
    recovery_root_retained: recoveryRootRetained,
    status: 'failed',
  });
}

export function finalizeProofSummary(
  summary,
  { commandStatus, pixelsPersisted, recoveryRootRetained },
) {
  if (summary === null || typeof summary !== 'object' || Array.isArray(summary)
      || !Number.isSafeInteger(commandStatus)
      || typeof pixelsPersisted !== 'boolean'
      || typeof recoveryRootRetained !== 'boolean') return null;
  const finalized = { ...summary };
  if (typeof finalized.progress_receipt_valid !== 'boolean') {
    Object.assign(finalized, {
      progress_receipt_valid: false,
      progress_ordinal: null,
      last_started_stage: 'unknown',
      last_completed_stage: 'unknown',
      progress_elapsed_ms: null,
    });
  }
  finalized.pixels_persisted = pixelsPersisted;
  finalized.recovery_root_retained = recoveryRootRetained;
  if (pixelsPersisted || recoveryRootRetained) {
    finalized.status = 'failed';
    finalized.error_code = 'POSTFLIGHT_CLEANUP_INCOMPLETE';
    finalized.cleanup_complete = false;
  } else if (commandStatus !== 0) {
    const supervisorCodes = new Map([
      [124, 'PROOF_TIMEOUT'],
      [125, 'PROOF_SUPERVISION_FAILED'],
      [130, 'PROOF_INTERRUPTED'],
      [143, 'PROOF_TERMINATED'],
    ]);
    if (finalized.status === 'passed'
        || typeof finalized.error_code !== 'string'
        || finalized.error_code === 'NATIVE_PROOF_FAILED') {
      finalized.error_code = supervisorCodes.get(commandStatus) ?? 'NATIVE_PROOF_FAILED';
    }
    finalized.status = 'failed';
  }
  return Object.freeze(finalized);
}

export function validateFinalOutputText(text) {
  try {
    if (typeof text !== 'string'
        || Buffer.byteLength(text, 'utf8') < 1
        || Buffer.byteLength(text, 'utf8') > DRIVER_SUMMARY_MAX_BYTES) {
      return null;
    }
    const value = JSON.parse(text);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    for (const [key, item] of Object.entries(value)) {
      const validator = FINAL_OUTPUT_FIELD_VALIDATORS.get(key);
      if (validator === undefined || !validator(item)) return null;
    }
    if (!supervisorProjectionIsValid(value)) return null;
    if (!['status', 'cleanup_complete', 'pixels_persisted', 'recovery_root_retained',
      'progress_receipt_valid', 'progress_ordinal', 'last_started_stage',
      'last_completed_stage', 'progress_elapsed_ms'].every((key) => Object.hasOwn(value, key))) {
      return null;
    }
    const progress = validatedSanitizedProgress({
      progress_receipt_valid: value.progress_receipt_valid,
      progress_ordinal: value.progress_ordinal,
      last_started_stage: value.last_started_stage,
      last_completed_stage: value.last_completed_stage,
      progress_elapsed_ms: value.progress_elapsed_ms,
    }, PROGRESS_MAX_ELAPSED_MS);
    if (progress === null) return null;
    return Object.freeze(value);
  } catch {
    return null;
  }
}

export function summaryMatchesExpectedFields(summaryText, expectedText) {
  try {
    const summary = JSON.parse(summaryText);
    const expected = JSON.parse(expectedText);
    return summary !== null && typeof summary === 'object' && !Array.isArray(summary)
      && expected !== null && typeof expected === 'object' && !Array.isArray(expected)
      && Object.entries(expected).every(([key, value]) => (
        Object.hasOwn(summary, key) && JSON.stringify(summary[key]) === JSON.stringify(value)
      ));
  } catch {
    return false;
  }
}

function integer(value) {
  return typeof value === 'string' && /^[0-9]+$/u.test(value) ? Number(value) : NaN;
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : null;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function sanitizeProgressReceiptCLI(args) {
  const file = valueAfter(args, '--path');
  const delayValue = valueAfter(args, '--self-test-delay-ms');
  const delayMilliseconds = delayValue === null ? 0 : integer(delayValue);
  if (!Number.isSafeInteger(delayMilliseconds) || delayMilliseconds > 10_000) {
    process.stdout.write(`${JSON.stringify(unknownSanitizedProgress())}\n`);
    return 0;
  }
  if (delayMilliseconds > 0) await sleep(delayMilliseconds);
  const sanitized = typeof file === 'string' && file.length > 0
    ? sanitizedProgressFromFile(file)
    : unknownSanitizedProgress();
  process.stdout.write(`${JSON.stringify(sanitized)}\n`);
  return 0;
}

async function runCLI(mode, args) {
  if (mode === '--sanitize-progress-receipt') return sanitizeProgressReceiptCLI(args);
  if (mode === '--validate-driver-summary') {
    const value = validateDriverSummaryText(args[0] ?? '');
    if (value === null) return 1;
    process.stdout.write(JSON.stringify(value));
    return 0;
  }
  if (mode === '--summary-admission-is-nonambiguous') {
    const value = validateDriverSummaryText(args[0] ?? '');
    return value?.command_admission_ambiguous === false ? 0 : 1;
  }
  if (mode === '--merge-sanitized-progress') {
    const maximum = integer(args[2]);
    if (!Number.isSafeInteger(maximum)) return 1;
    const value = mergeSanitizedProgressText(args[0] ?? '', args[1] ?? '', maximum);
    if (value === null) return 1;
    process.stdout.write(JSON.stringify(value));
    return 0;
  }
  if (mode === '--fallback-driver-summary') {
    const value = fallbackDriverSummary(integer(args[0]));
    if (value === null) return 1;
    process.stdout.write(JSON.stringify(value));
    return 0;
  }
  if (mode === '--final-output-invalid-fallback') {
    if (!['0', '1'].includes(args[0]) || !['0', '1'].includes(args[1])) return 1;
    const value = finalOutputInvalidFallback({
      pixelsPersisted: args[0] === '1', recoveryRootRetained: args[1] === '1',
    });
    process.stdout.write(JSON.stringify(value));
    return 0;
  }
  if (mode === '--finalize-proof-summary') {
    let summary;
    try { summary = JSON.parse(args[0] ?? ''); } catch { return 1; }
    const value = finalizeProofSummary(summary, {
      commandStatus: integer(args[3]),
      pixelsPersisted: args[1] === '1',
      recoveryRootRetained: args[2] === '1',
    });
    if (value === null || !['0', '1'].includes(args[1]) || !['0', '1'].includes(args[2])) {
      return 1;
    }
    const serialized = JSON.stringify(value);
    if (validateFinalOutputText(serialized) === null) return 1;
    process.stdout.write(serialized);
    return 0;
  }
  if (mode === '--final-output-status') {
    const value = validateFinalOutputText(args[0] ?? '');
    if (value === null) return 2;
    process.stdout.write(value.status);
    return value.status === 'passed' ? 0 : 1;
  }
  if (mode === '--summary-matches') {
    return summaryMatchesExpectedFields(args[0] ?? '', args[1] ?? '') ? 0 : 1;
  }
  return 125;
}

if (process.argv[1]
    && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const [mode, ...args] = process.argv.slice(2);
  try {
    process.exitCode = await runCLI(mode, args);
  } catch {
    process.exitCode = 125;
  }
}
