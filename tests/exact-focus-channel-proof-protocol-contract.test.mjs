import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  AOS_COMMAND_ERROR_CODE_LIST,
  AOS_PRECOMMIT_REJECTION_CODE_LIST,
  PROGRESS_STAGES,
  fallbackDriverSummary,
  finalOutputInvalidFallback,
  finalizeProofSummary,
  mergeSanitizedProgressText,
  validateDriverSummaryText,
  validateFinalOutputText,
} from './lib/exact-focus-channel-proof-contract.mjs';
import { createRunProgram } from './lib/exact-focus-channel-command-runner.mjs';
import {
  PROCESS_TREE_MAX_BYTES,
  PROCESS_TREE_SCHEMA,
  OWNER_RECORD_MAX_BYTES,
  RUN_PROGRAM_MAX_BYTES,
  RUN_PROGRAM_SCHEMA,
  SUPERVISOR_READY_MAX_BYTES,
  createPrivateOutputFiles,
  groupSignalIsPermitted,
  normalizedProcessStatus,
  ownerRecordFromFile,
  ownedGroupRecordIsValid,
  payloadOutcomeFromMessage,
  payloadOutcomeFromProcessResult,
  payloadOutcomeMessage,
  parseSupervisorFailureReceiptText,
  primarySupervisorFailure,
  processExists,
  processTreeRetirementStatus,
  publicSupervisorReason,
  readBoundedRegularFile,
  readReadiness,
  runProgramReceiptStatus,
  runProgramTimeoutInitializationError,
  serializeSupervisorFailureReceipt,
  supervisorProjectionIsValid,
  supervisorReadyPIDFromFile,
} from './lib/exact-focus-channel-supervision-protocol.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const driverPath = path.join(root, 'tests/manual/exact-focus-channel-native-proof.mjs');
const runnerPath = path.join(root, 'tests/manual/exact-focus-channel-native-proof.sh');
const shellHelperPath = path.join(root, 'tests/lib/exact-focus-channel-supervision.zsh');
const scenarioHelperPath = path.join(root, 'tests/lib/exact-focus-channel-supervision-scenarios.zsh');
const proofContractPath = path.join(root, 'tests/lib/exact-focus-channel-proof-contract.mjs');
const protocolPath = path.join(root, 'tests/lib/exact-focus-channel-supervision-protocol.mjs');
function diagnostics(result) {
  return JSON.stringify({
    signal: result.signal, status: result.status, stderr: result.stderr, stdout: result.stdout,
  });
}
function run(mode, timeout = 30_000) {
  return spawnSync('zsh', [runnerPath, mode], { cwd: root, encoding: 'utf8', timeout });
}
function validDriverFailure(overrides = {}) {
  return {
    channel_removed: false,
    cleanup_complete: false,
    command_admission_ambiguous: true,
    command_error_code: 'INTERNAL',
    direct_capture_ready_preserved: false,
    error_code: 'SELF_TEST_FAILURE',
    fixture_process_reaped: false,
    fixture_windows_removed: false,
    microphone_requested: false,
    pixels_persisted: false,
    raw_capture_logged: false,
    runtime_provenance_preserved: false,
    shared_daemon_preserved: false,
    status: 'failed',
    unrelated_channel_stable_fields_preserved: false,
    ...overrides,
  };
}
function validDriverSuccess() {
  return {
    ax_element_count: 2,
    build_source_fingerprint: 'b'.repeat(64),
    capture_byte_count: 1024,
    capture_height: 696,
    capture_sha256: 'c'.repeat(64),
    capture_width: 960,
    channel_removed: true,
    cleanup_complete: true,
    command_admission_ambiguous: false,
    command_error_code: null,
    cyan_fraction: 0.1,
    daemon_path_start_order_bound: true,
    direct_capture_ready_preserved: true,
    exact_ax_scope_verified: true,
    exact_window_pixels_verified: true,
    failed_capture_artifact_absent: true,
    fixture_process_reaped: true,
    fixture_windows_removed: true,
    foreign_window_id_count: 0,
    green_fraction: 0.2,
    magenta_fraction: 0.3,
    microphone_requested: false,
    missing_target_capture_rejected: true,
    missing_target_refresh_rejected: true,
    overlap_fraction: 0.5,
    overlap_verified: true,
    pixels_persisted: false,
    raw_capture_logged: false,
    rejected_refresh_preserved: true,
    rejected_refresh_recaptured: true,
    repo_revision: 'a'.repeat(40),
    runtime_provenance_preserved: true,
    same_process_windows: true,
    shared_daemon_preserved: true,
    sibling_above_target: true,
    sibling_refresh_rejected: true,
    sibling_subtree_rejected: true,
    status: 'passed',
    unique_window_id_count: 1,
    unrelated_channel_stable_fields_preserved: true,
  };
}
test('final proof output is closed, typed, and validates before CLI emission', () => {
  const invalidFallback = {
    cleanup_complete: false,
    command_admission_ambiguous: true,
    command_error_code: null,
    error_code: 'PROOF_FINAL_OUTPUT_INVALID',
    last_completed_stage: 'unknown',
    last_started_stage: 'unknown',
    microphone_requested: false,
    pixels_persisted: false,
    progress_elapsed_ms: null,
    progress_ordinal: null,
    progress_receipt_valid: false,
    raw_capture_logged: false,
    recovery_root_retained: false,
    status: 'failed',
  };
  assert.deepEqual(finalOutputInvalidFallback({
    pixelsPersisted: false, recoveryRootRetained: false,
  }), invalidFallback);
  const rejectedFallback = spawnSync('node', [
    proofContractPath, '--final-output-invalid-fallback', 'false', '0',
  ], { cwd: root, encoding: 'utf8' });
  assert.deepEqual([
    rejectedFallback.status, rejectedFallback.stdout, rejectedFallback.stderr,
  ], [1, '', '']);
  const missingCleanup = run('--final-output-missing-cleanup-self-test', 5_000);
  assert.equal(missingCleanup.status, 1, diagnostics(missingCleanup));
  assert.deepEqual(JSON.parse(missingCleanup.stdout.trim()), invalidFallback);
  assert.equal(missingCleanup.stderr, '');
  const finalizedFailure = finalizeProofSummary(fallbackDriverSummary(124), {
    commandStatus: 124, pixelsPersisted: false, recoveryRootRetained: false,
  });
  const finalizedSuccess = finalizeProofSummary(validDriverSuccess(), {
    commandStatus: 0, pixelsPersisted: false, recoveryRootRetained: false,
  });
  assert.deepEqual(validateFinalOutputText(JSON.stringify(finalizedFailure)), finalizedFailure);
  assert.deepEqual(validateFinalOutputText(JSON.stringify(finalizedSuccess)), finalizedSuccess);
  const guardianCrashProof = {
    ...finalizedSuccess,
    guardian_authenticated_after_supervisor_crash: true,
    live_unrelated_group_preserved: true,
    payload_outcome_validated_before_crash: true,
  };
  assert.deepEqual(
    validateFinalOutputText(JSON.stringify(guardianCrashProof)), guardianCrashProof,
  );
  for (const rejectedGuardianCrashProof of [
    { ...guardianCrashProof, guardian_authenticated_after_supervisor_crash: 'true' },
    { ...guardianCrashProof, payload_outcome_validated_before_crash: 1 },
    { ...guardianCrashProof, unrelated_group_preserved: true },
  ]) assert.equal(validateFinalOutputText(JSON.stringify(rejectedGuardianCrashProof)), null);
  const supervisorProjection = {
    supervisor_detail: 'supervisor_timeout',
    supervisor_reason: 'timeout',
    supervisor_stage: 'payload_outcome_wait',
    supervisor_status: 124,
  };
  const supervisorWithCleanup = {
    ...supervisorProjection,
    supervisor_cleanup_detail: 'group_record_remove_failed',
    supervisor_cleanup_stage: 'group_record_remove',
  };
  assert.equal(supervisorProjectionIsValid(supervisorProjection), true);
  assert.equal(supervisorProjectionIsValid({
    supervisor_detail: 'shell_finalizer_failure',
    supervisor_reason: 'shell_finalizer',
    supervisor_stage: 'shell_finalizer',
    supervisor_status: 125,
  }), true);
  assert.deepEqual(
    validateFinalOutputText(JSON.stringify({ ...finalizedFailure, ...supervisorWithCleanup })),
    { ...finalizedFailure, ...supervisorWithCleanup },
  );
  for (const invalidProjection of [
    { supervisor_detail: 'supervisor_timeout' },
    { supervisor_cleanup_detail: 'group_reap_failed', supervisor_cleanup_stage: 'final_group_reap' },
    { ...supervisorProjection, supervisor_cleanup_detail: 'group_reap_failed' },
    { ...supervisorProjection, supervisor_detail: 'invented_detail' },
    { ...supervisorProjection, supervisor_stage: 'final_group_reap' },
    { ...supervisorProjection, supervisor_status: 0 },
  ]) {
    const candidate = { ...finalizedFailure, ...invalidProjection };
    assert.equal(validateFinalOutputText(JSON.stringify(candidate)), null);
    const rejected = spawnSync('node', [
      proofContractPath, '--finalize-proof-summary', JSON.stringify(candidate), '0', '0', '0',
    ], { cwd: root, encoding: 'utf8' });
    assert.deepEqual([rejected.status, rejected.stdout, rejected.stderr], [1, '', '']);
  }
  for (const raw of [true, 1, null, 'RAW_FINAL_OUTPUT_SENTINEL_MUST_NOT_LEAK']) {
    const candidate = { ...finalizedFailure, undeclared_field: raw };
    assert.equal(validateFinalOutputText(JSON.stringify(candidate)), null);
    const projected = spawnSync('node', [
      proofContractPath,
      '--finalize-proof-summary',
      JSON.stringify(candidate),
      '0',
      '0',
      '124',
    ], { cwd: root, encoding: 'utf8', timeout: 2_000 });
    assert.deepEqual([projected.status, projected.stdout, projected.stderr], [1, '', '']);
  }
  for (const mutation of [
    { cleanup_complete: 'false' },
    { command_error_code: 'UNKNOWN_CODE' },
    { error_code: 'not_typed' },
    { progress_receipt_valid: true },
    { progress_ordinal: 1 },
    { last_started_stage: 'not_a_stage' },
    { supervisor_detail: 'NOT_LOWER' },
    { supervisor_status: 256 },
    { build_source_fingerprint: 'x'.repeat(64) },
    { cyan_fraction: 2 },
    { capture_width: 0 },
  ]) assert.equal(validateFinalOutputText(JSON.stringify({
    ...finalizedFailure, ...mutation,
  })), null);
});
test('supervision protocol is closed and directly exercised', () => {
  const timeoutReceipt = serializeSupervisorFailureReceipt(
    'supervisor_timeout', 'payload_outcome_wait', 124, 'timeout',
  );
  assert.equal(timeoutReceipt,
    '{"detail":"supervisor_timeout","reason":"timeout","schema":"aos.exact-focus-channel-supervisor-failure.v1","stage":"payload_outcome_wait","status":124}\n');
  assert.deepEqual(parseSupervisorFailureReceiptText(timeoutReceipt), {
    cleanupDetail: null,
    cleanupStage: null,
    detail: 'supervisor_timeout',
    reason: 'timeout',
    stage: 'payload_outcome_wait',
    status: 124,
  });
  const cleanupReceipt = serializeSupervisorFailureReceipt(
    'unexpected_supervisor_exception',
    'payload_readiness_wait',
    125,
    'supervisor_exception',
    { detail: 'group_reap_failed', stage: 'final_group_reap' },
  );
  assert.deepEqual(parseSupervisorFailureReceiptText(cleanupReceipt), {
    cleanupDetail: 'group_reap_failed',
    cleanupStage: 'final_group_reap',
    detail: 'unexpected_supervisor_exception',
    reason: 'supervisor_exception',
    stage: 'payload_readiness_wait',
    status: 125,
  });
  for (const stage of [
    'guardian_spawn', 'group_record_wait', 'admission_ack_publish', 'payload_readiness_wait',
  ]) {
    const earlyStartupReceipt = serializeSupervisorFailureReceipt(
      'payload_initialization_timeout', stage, 126, 'initialization_timeout',
    );
    assert.equal(parseSupervisorFailureReceiptText(earlyStartupReceipt)?.stage, stage);
  }
  assert.equal(serializeSupervisorFailureReceipt(
    'payload_initialization_timeout', 'final_group_reap', 126, 'initialization_timeout',
  ), null);
  const identityPublicationReceipt = serializeSupervisorFailureReceipt(
    'group_record_failed', 'group_record_wait', 125, 'group_record_failed',
  );
  assert.equal(parseSupervisorFailureReceiptText(identityPublicationReceipt)?.detail,
    'group_record_failed');
  for (const stage of ['guardian_spawn', 'payload_outcome_wait']) {
    assert.equal(parseSupervisorFailureReceiptText(serializeSupervisorFailureReceipt(
      'guardian_admission_failure', stage, 125, 'payload_exit',
    ))?.stage, stage);
  }
  assert.equal(serializeSupervisorFailureReceipt(
    'guardian_admission_failure', 'group_record_wait', 125, 'payload_exit',
  ), null);
  const removeReceipt = serializeSupervisorFailureReceipt(
    'payload_nonzero_exit',
    'payload_outcome_wait',
    1,
    'payload_exit',
    { detail: 'group_record_remove_failed', stage: 'group_record_remove' },
  );
  assert.deepEqual(parseSupervisorFailureReceiptText(removeReceipt), {
    cleanupDetail: 'group_record_remove_failed',
    cleanupStage: 'group_record_remove',
    detail: 'payload_nonzero_exit',
    reason: 'payload_exit',
    stage: 'payload_outcome_wait',
    status: 1,
  });
  for (const invalid of [
    ['supervisor_timeout', 'payload_outcome_wait', 125, 'timeout'],
    ['RAW_SUPERVISOR_SENTINEL', 'payload_outcome_wait', 124, 'timeout'],
    ['parent_lost', 'group_record_remove', 125, 'parent_lost'],
  ]) assert.equal(serializeSupervisorFailureReceipt(...invalid), null);
  for (const invalidText of [
    timeoutReceipt.trim(),
    `${timeoutReceipt.trim().replace('"status":124', '"status":124,"raw":true')}\n`,
    `${cleanupReceipt.trim().replace(',"cleanup_stage":"final_group_reap"', '')}\n`,
  ]) assert.equal(parseSupervisorFailureReceiptText(invalidText), null);
  const successMessage = payloadOutcomeMessage('payload_success', 0);
  const failureMessage = payloadOutcomeMessage('payload_nonzero_exit', 1);
  assert.deepEqual(payloadOutcomeFromMessage(successMessage), {
    detail: 'payload_success', status: 0,
  });
  assert.deepEqual(payloadOutcomeFromMessage(failureMessage), {
    detail: 'payload_nonzero_exit', status: 1,
  });
  assert.equal(payloadOutcomeFromMessage({ ...failureMessage, raw: true }), null);
  assert.equal(payloadOutcomeMessage('payload_success', 1), null);
  assert.equal(payloadOutcomeMessage('payload_nonzero_exit', 0), null);
  assert.deepEqual(payloadOutcomeFromProcessResult({ code: 0, signal: null, error: null }), {
    detail: 'payload_success', status: 0,
  });
  assert.deepEqual(payloadOutcomeFromProcessResult({ code: 1, signal: null, error: null }), {
    detail: 'payload_nonzero_exit', status: 1,
  });
  assert.deepEqual(payloadOutcomeFromProcessResult({ code: null, signal: null, error: null }), {
    detail: 'payload_spawn_or_init_failure', status: 125,
  });
  assert.deepEqual([
    normalizedProcessStatus({ code: 0, signal: null }),
    normalizedProcessStatus({ code: null, signal: 'SIGINT' }),
    normalizedProcessStatus({ code: null, signal: 'SIGTERM' }),
    normalizedProcessStatus({ code: null, signal: null }),
  ], [0, 130, 143, 125]);
  assert.equal(processExists(process.pid), true);
  assert.equal(publicSupervisorReason('TIMEOUT'), 'timeout');
  assert.equal(publicSupervisorReason(null, true), 'payload_exit');
  assert.deepEqual([
    groupSignalIsPermitted(true, true),
    groupSignalIsPermitted(true, false),
    groupSignalIsPermitted(false, true),
  ], [true, false, false]);
  assert.deepEqual(primarySupervisorFailure({
    asynchronousFailure: null,
    fallbackStage: 'payload_outcome_wait',
    guardianFailureStage: null,
    guardianResult: null,
    payloadOutcome: { detail: 'payload_nonzero_exit', status: 1 },
    reason: null,
    reasonStage: null,
  }), {
    detail: 'payload_nonzero_exit', reason: 'payload_exit',
    stage: 'payload_outcome_wait', status: 1,
  });
  assert.deepEqual(primarySupervisorFailure({
    asynchronousFailure: null,
    fallbackStage: 'final_group_reap',
    guardianFailureStage: 'guardian_spawn',
    guardianResult: { code: 0, signal: null },
    payloadOutcome: null,
    reason: null,
    reasonStage: null,
  }), {
    detail: 'guardian_admission_failure', reason: 'payload_exit',
    stage: 'guardian_spawn', status: 125,
  });
  assert.deepEqual(primarySupervisorFailure({
    asynchronousFailure: null,
    fallbackStage: 'final_group_reap',
    guardianFailureStage: 'payload_outcome_wait',
    guardianResult: { code: 0, signal: null },
    payloadOutcome: null,
    reason: null,
    reasonStage: null,
  }), {
    detail: 'guardian_admission_failure', reason: 'payload_exit',
    stage: 'payload_outcome_wait', status: 125,
  });
  const lateAsync = {
    detail: 'unexpected_supervisor_exception', reason: 'supervisor_exception',
    stage: 'final_group_reap', status: 125,
  };
  for (const [reason, reasonStage, expected] of [
    ['TIMEOUT', 'payload_outcome_wait', {
      detail: 'supervisor_timeout', reason: 'timeout', stage: 'payload_outcome_wait', status: 124,
    }],
    ['SIGTERM', 'payload_readiness_wait', {
      detail: 'supervisor_signal', reason: 'sigterm', stage: 'payload_readiness_wait', status: 143,
    }],
  ]) assert.deepEqual(primarySupervisorFailure({
    asynchronousFailure: lateAsync,
    fallbackStage: 'final_group_reap',
    guardianFailureStage: null,
    guardianResult: null,
    payloadOutcome: null,
    reason,
    reasonStage,
  }), expected);
});
test('shared command-error, progress, and command-runner contracts are exact', () => {
  const driver = fs.readFileSync(driverPath, 'utf8');
  const runner = fs.readFileSync(runnerPath, 'utf8');
  const proofContract = fs.readFileSync(proofContractPath, 'utf8');
  assert.deepEqual(AOS_COMMAND_ERROR_CODE_LIST, [
    'CHANNEL_NOT_FOUND', 'CHANNEL_STALE', 'DAEMON_UNREACHABLE', 'DAEMON_UNAVAILABLE',
    'DUPLICATE_ID', 'INTERNAL', 'INVALID_DEPTH', 'NATIVE_AX_ROOT_MISMATCH',
    'WINDOW_NOT_FOUND',
  ]);
  assert.deepEqual(AOS_PRECOMMIT_REJECTION_CODE_LIST, [
    'CHANNEL_NOT_FOUND', 'CHANNEL_STALE', 'DUPLICATE_ID', 'INVALID_DEPTH',
    'NATIVE_AX_ROOT_MISMATCH', 'WINDOW_NOT_FOUND',
  ]);
  assert.deepEqual(PROGRESS_STAGES, [
    'runtime_preflight', 'unrelated_channel_snapshot', 'fixture_startup',
    'sibling_subtree_rejection', 'target_channel_creation', 'initial_capture',
    'rejected_refresh', 'preserved_capture', 'target_close',
    'missing_target_capture', 'missing_target_refresh', 'channel_cleanup',
    'fixture_cleanup', 'postflight_attestation',
  ]);
  assert.match(driver, /from '\.\.\/lib\/exact-focus-channel-proof-contract\.mjs'/u);
  assert.match(runner, /--validate-driver-summary|--summary-admission-is-nonambiguous/u);
  assert.match(runner, /--merge-sanitized-progress/u);
  assert.doesNotMatch(driver, /const AOS_COMMAND_ERROR_CODE_LIST|const PROGRESS_STAGES/u);
  assert.doesNotMatch(runner, /const commandErrorCodes|const stagesInOrder/u);
  assert.match(proofContract, /export const AOS_COMMAND_ERROR_CODE_LIST/u);
  assert.match(proofContract, /export const PROGRESS_STAGES/u);
  const successText = JSON.stringify(validDriverSuccess());
  assert.deepEqual(validateDriverSummaryText(successText), JSON.parse(successText));
  assert.deepEqual(validateDriverSummaryText(JSON.stringify(validDriverFailure())),
    validDriverFailure());
  for (const rejectedSummary of [
    { ...validDriverFailure(), raw: 'RAW_DRIVER_SUMMARY_SENTINEL_MUST_NOT_LEAK' },
    { ...validDriverFailure(), error_code: 'not typed' },
    { ...validDriverFailure(), cleanup_complete: 'false' },
    { ...validDriverSuccess(), repo_revision: 'RAW_DRIVER_SUMMARY_SENTINEL_MUST_NOT_LEAK' },
    { ...validDriverSuccess(), capture_width: '960' },
  ]) assert.equal(validateDriverSummaryText(JSON.stringify(rejectedSummary)), null);
  const validProgress = JSON.stringify({
    last_completed_stage: null,
    last_started_stage: 'runtime_preflight',
    progress_elapsed_ms: 1,
    progress_ordinal: 1,
    progress_receipt_valid: true,
  });
  assert.deepEqual(mergeSanitizedProgressText('{"status":"failed"}', validProgress, 10), {
    last_completed_stage: null,
    last_started_stage: 'runtime_preflight',
    progress_elapsed_ms: 1,
    progress_ordinal: 1,
    progress_receipt_valid: true,
    status: 'failed',
  });
  assert.deepEqual(mergeSanitizedProgressText(
    '{"status":"failed"}',
    '{"last_completed_stage":null,"last_started_stage":"initial_capture","progress_elapsed_ms":1,"progress_ordinal":1,"progress_receipt_valid":true}',
    10,
  ), {
    last_completed_stage: 'unknown',
    last_started_stage: 'unknown',
    progress_elapsed_ms: null,
    progress_ordinal: null,
    progress_receipt_valid: false,
    status: 'failed',
  });
  const merged = spawnSync('node', [
    proofContractPath,
    '--merge-sanitized-progress',
    '{"status":"failed"}',
    validProgress,
    '10',
  ], { cwd: root, encoding: 'utf8', timeout: 2_000 });
  assert.equal(merged.status, 0, diagnostics(merged));
  assert.equal(JSON.parse(merged.stdout).progress_ordinal, 1);
  class TestProofError extends Error {
    constructor(code, { ambiguous = false } = {}) {
      super(code);
      this.code = code;
      this.ambiguous = ambiguous;
    }
  }
  const runProgram = createRunProgram({
    ProofError: TestProofError,
    commandClassTimeouts: { local: 20 },
    proofEnvironment: () => ({ PATH: process.env.PATH }),
  });
  assert.equal(runProgram('/usr/bin/printf', ['ok']).stdout, 'ok');
  assert.throws(() => runProgram('/bin/sleep', ['1']), (error) => (
    error instanceof TestProofError
      && error.code === 'COMMAND_TIMEOUT'
      && error.ambiguous === true
  ));
  assert.throws(() => runProgram('/usr/bin/printf', ['ok'], { commandClass: 'unknown' }),
    (error) => error instanceof TestProofError && error.code === 'COMMAND_CLASS_INVALID');

  const fallback = fallbackDriverSummary(124);
  assert.equal(fallback.error_code, 'PROOF_TIMEOUT');
  assert.equal(fallback.progress_ordinal, null);
  const finalized = finalizeProofSummary(fallback, {
    commandStatus: 124, pixelsPersisted: false, recoveryRootRetained: false,
  });
  assert.equal(finalized.progress_ordinal, null);
  assert.deepEqual(validateFinalOutputText(JSON.stringify(finalized)), finalized);
});
test('bounded private readers and guarded CLIs fail closed on file and framing drift', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(
    process.env.TMPDIR ?? '/tmp', 'aos-supervision-protocol-',
  ));
  const stdoutFile = path.join(temporaryRoot, 'stdout');
  const stderrFile = path.join(temporaryRoot, 'stderr');
  const readinessFile = path.join(temporaryRoot, 'readiness');
  const ownerFile = path.join(temporaryRoot, 'owner');
  const readyFile = path.join(temporaryRoot, 'ready');
  const cli = (mode, file) => spawnSync('node', [protocolPath, mode, file], {
    cwd: root, encoding: 'utf8', timeout: 2_000,
  });
  const receipt = `${JSON.stringify({
    admission_ambiguous: true,
    descendant_live_before_outer_reap: true,
    error_code: 'COMMAND_TIMEOUT',
    status: 'failed',
  })}\n`;
  try {
    assert.equal(createPrivateOutputFiles([stdoutFile, stderrFile]), true);
    for (const file of [stdoutFile, stderrFile]) {
      const stat = fs.lstatSync(file);
      assert.equal(stat.isFile() && !stat.isSymbolicLink(), true);
      assert.equal(stat.mode & 0o777, 0o600);
    }
    fs.writeFileSync(stdoutFile, receipt);
    assert.equal(runProgramReceiptStatus(stdoutFile), 0);
    assert.equal(readBoundedRegularFile(stdoutFile, 512, 0o600)?.length > 0, true);
    fs.chmodSync(stdoutFile, 0o644);
    assert.equal(runProgramReceiptStatus(stdoutFile), 1);
    fs.chmodSync(stdoutFile, 0o600);
    const symlinkFile = path.join(temporaryRoot, 'receipt-link');
    fs.symlinkSync(stdoutFile, symlinkFile);
    assert.equal(readBoundedRegularFile(symlinkFile, 512, 0o600), null);
    const token = 'a'.repeat(32);
    fs.writeFileSync(ownerFile, `${process.pid} ${token}\n`, { mode: 0o600 });
    fs.writeFileSync(readyFile, `${process.pid}\n`, { mode: 0o600 });
    assert.deepEqual(ownerRecordFromFile(ownerFile), { pid: process.pid, token });
    assert.equal(supervisorReadyPIDFromFile(readyFile), process.pid);
    assert.deepEqual([cli('--read-owner-record', ownerFile).status,
      cli('--read-owner-record', ownerFile).stdout], [0, `${process.pid} ${token}`]);
    assert.deepEqual([cli('--read-supervisor-ready', readyFile).status,
      cli('--read-supervisor-ready', readyFile).stdout], [0, String(process.pid)]);
    assert.equal(OWNER_RECORD_MAX_BYTES, 96);
    assert.equal(SUPERVISOR_READY_MAX_BYTES, 32);
    for (const [mode, file] of [['--read-owner-record', ownerFile],
      ['--read-supervisor-ready', readyFile]]) {
      fs.chmodSync(file, 0o644); const rejectedMode = cli(mode, file); fs.chmodSync(file, 0o600);
      assert.deepEqual([rejectedMode.status, rejectedMode.stdout, rejectedMode.stderr], [1, '', '']);
    }
    for (const invalidOwner of [`0 ${token}\n`, `1 ${token}\n`, `01 ${token}\n`,
      `9007199254740992 ${token}\n`, `${process.pid} ${token.toUpperCase()}\n`,
      `${process.pid} ${'a'.repeat(31)}\n`, `${process.pid} ${'a'.repeat(33)}\n`,
      `${process.pid} ${'g'.repeat(32)}\n`, `${process.pid} ${token}\n\n`]) {
      fs.writeFileSync(ownerFile, invalidOwner);
      const rejectedOwner = cli('--read-owner-record', ownerFile);
      assert.deepEqual([rejectedOwner.status, rejectedOwner.stdout, rejectedOwner.stderr], [1, '', '']);
    }
    for (const invalidReady of [`0\n`, `01\n`, `${process.pid}\n\n`]) {
      fs.writeFileSync(readyFile, invalidReady);
      const rejectedReady = cli('--read-supervisor-ready', readyFile);
      assert.deepEqual([rejectedReady.status, rejectedReady.stdout, rejectedReady.stderr], [1, '', '']);
    }
    for (const mode of ['--read-owner-record', '--read-supervisor-ready']) {
      const rejectedLink = cli(mode, symlinkFile);
      assert.deepEqual([rejectedLink.status, rejectedLink.stdout, rejectedLink.stderr], [1, '', '']);
    }
    const unknown = cli('--unknown-route', ownerFile);
    assert.deepEqual([unknown.status, unknown.stdout, unknown.stderr], [1, '', '']);
    const internal = cli('--self-test-internal-failure', ownerFile);
    assert.deepEqual([internal.status, internal.stdout, internal.stderr], [125, '', '']);
    const nonce = 'ab'.repeat(32);
    fs.writeFileSync(readinessFile, `${JSON.stringify({
      nonce, pid: process.pid, schema: PROCESS_TREE_SCHEMA,
    })}\n`, { mode: 0o600 });
    const live = (pid) => pid === process.pid;
    assert.equal(readReadiness(
      readinessFile, nonce, PROCESS_TREE_SCHEMA, PROCESS_TREE_MAX_BYTES, true, live,
    )?.pid, process.pid);
    assert.equal(processTreeRetirementStatus(readinessFile, nonce, live), 3);
    assert.equal(processTreeRetirementStatus(readinessFile, nonce, () => false), 0);
    assert.equal(runProgramTimeoutInitializationError({ pid: process.pid }, live), null);
    assert.equal(runProgramTimeoutInitializationError(null, live),
      'RUN_PROGRAM_TIMEOUT_INITIALIZATION_FAILED');
    assert.equal(ownedGroupRecordIsValid(readinessFile, process.pid, nonce), false);
    assert.equal(readReadiness(
      readinessFile, nonce, RUN_PROGRAM_SCHEMA, RUN_PROGRAM_MAX_BYTES, false, live,
    ), null);
    const failureFile = path.join(temporaryRoot, 'supervisor-failure');
    for (const [value, expected] of [
      [{ detail: 'parent_lost', reason: 'parent_lost',
        schema: 'aos.exact-focus-channel-supervisor-failure.v1',
        stage: 'payload_outcome_wait', status: 125 },
      '125 parent_lost payload_outcome_wait parent_lost absent absent'],
      [{ cleanup_detail: 'group_record_remove_failed', cleanup_stage: 'group_record_remove',
        detail: 'payload_nonzero_exit', reason: 'payload_exit',
        schema: 'aos.exact-focus-channel-supervisor-failure.v1',
        stage: 'payload_outcome_wait', status: 1 },
      '1 payload_nonzero_exit payload_outcome_wait payload_exit group_record_remove_failed group_record_remove'],
    ]) {
      fs.writeFileSync(failureFile, `${JSON.stringify(value)}\n`, { mode: 0o600 });
      const projection = spawnSync('node', [
        protocolPath, '--read-supervisor-failure-detail', failureFile,
      ], { cwd: root, encoding: 'utf8', timeout: 2_000 });
      assert.equal(projection.status, 0, diagnostics(projection));
      assert.equal(projection.stdout, expected);
      assert.equal(projection.stderr, '');
    }
    fs.writeFileSync(failureFile, `${JSON.stringify({
      detail: 'parent_lost', raw: true, reason: 'parent_lost',
      schema: 'aos.exact-focus-channel-supervisor-failure.v1',
      stage: 'payload_outcome_wait', status: 125,
    })}\n`, { mode: 0o600 });
    const rejected = spawnSync('node', [
      protocolPath, '--read-supervisor-failure-detail', failureFile,
    ], { cwd: root, encoding: 'utf8', timeout: 2_000 });
    assert.deepEqual([rejected.status, rejected.stdout, rejected.stderr], [1, '', '']);
  } finally {
    fs.rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test('timeout status projection and receipt predicates are closed', () => {
  for (const [supervisorStatus, detail, stage, reason, suffix] of [
    [0, '', '', '', 'UNEXPECTED_INNER_COMPLETION'],
    [1, '', '', '', 'STATUS_MISMATCH'],
    [1, 'payload_nonzero_exit', 'payload_outcome_wait', 'payload_exit', 'PAYLOAD_NONZERO_EXIT'],
    [125, 'group_reap_failed', 'final_group_reap', 'timeout', 'GROUP_REAP_FAILED'],
    [125, 'group_record_remove_failed', 'group_record_remove', 'none',
      'GROUP_RECORD_REMOVE_FAILED'],
    [125, 'parent_lost', 'payload_readiness_wait', 'parent_lost', 'PARENT_LOST'],
    [125, 'unexpected_supervisor_exception', 'cli_boundary', 'supervisor_exception',
      'UNEXPECTED_SUPERVISOR_EXCEPTION'],
    [143, 'supervisor_signal', 'payload_outcome_wait', 'sigterm', 'SUPERVISOR_SIGNAL'],
  ]) {
    const result = spawnSync('zsh', ['-c', `
      . "$1"
      . "$2"
      exact_focus_supervision_init a b c d e f g h
      exact_focus_supervision_scenario_init
      exact_focus_supervision_timeout_status_failure TIMEOUT "$3" "$4" "$5" "$6" || true
      print -r -- "$EFCS_SCENARIO_ERROR"
    `, 'projection', shellHelperPath, scenarioHelperPath, String(supervisorStatus),
    detail, stage, reason], { cwd: root, encoding: 'utf8', timeout: 2_000 });
    assert.equal(result.status, 0, diagnostics(result));
    assert.deepEqual(JSON.parse(result.stdout.trim()), {
      error_code: `TIMEOUT_${suffix}`,
      handshake_failed: false,
      status: 'failed',
      ...(detail === '' ? {} : {
        supervisor_detail: detail, supervisor_reason: reason, supervisor_stage: stage,
      }),
      supervisor_status: supervisorStatus,
    });
  }
  for (const [detail, stage, reason, receiptStatus, recovered, expected] of [
    ['supervisor_timeout', 'payload_outcome_wait', 'timeout', 124, 0, 0],
    ['group_reap_failed', 'final_group_reap', 'timeout', 125, 1, 0],
    ['supervisor_timeout', 'payload_outcome_wait', 'timeout', 124, 1, 1],
    ['group_reap_failed', 'final_group_reap', 'timeout', 125, 0, 1],
    ['supervisor_timeout', 'final_group_reap', 'timeout', 124, 0, 1],
  ]) {
    const result = spawnSync('zsh', ['-c', `
      . "$1"
      . "$2"
      exact_focus_supervision_init a b c d e f g h
      exact_focus_supervision_scenario_init
      EFCS_LAST_SUPERVISOR_DETAIL="$3"
      EFCS_LAST_SUPERVISOR_STAGE="$4"
      EFCS_LAST_SUPERVISOR_REASON="$5"
      EFCS_LAST_SUPERVISOR_STATUS="$6"
      EFCS_OUTER_REAP_RECOVERED="$7"
      exact_focus_supervision_timeout_receipt_is_valid
    `, 'receipt', shellHelperPath, scenarioHelperPath, detail, stage, reason,
    String(receiptStatus), String(recovered)], {
      cwd: root, encoding: 'utf8', timeout: 2_000,
    });
    assert.equal(result.status, expected, diagnostics(result));
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  }
});
