import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const PROCESS_TREE_SCHEMA = 'aos.exact-focus-channel-process-tree-ready.v1';
export const PROCESS_TREE_MAX_BYTES = 256;
export const PROCESS_TREE_NONCE_ENV = 'AOS_PROCESS_TREE_READINESS_NONCE';
export const RUN_PROGRAM_SCHEMA = 'aos.exact-focus-channel-run-program-timeout-ready.v1';
export const RUN_PROGRAM_MAX_BYTES = 256;
export const RUN_PROGRAM_NONCE_ENV = 'AOS_RUN_PROGRAM_TIMEOUT_NONCE';
export const SUPERVISOR_FAILURE_SCHEMA = 'aos.exact-focus-channel-supervisor-failure.v1';
export const ADMISSION_COMMIT_MESSAGE = 'aos.exact-focus-channel.admission-commit.v1';
export const PAYLOAD_OUTCOME_MESSAGE_SCHEMA = 'aos.exact-focus-channel.payload-outcome.v1';

const SUPERVISOR_FAILURE_MAX_BYTES = 4096;
const SUPERVISOR_FAILURE_DETAILS = new Set([
  'group_reap_failed',
  'group_record_failed',
  'group_record_remove_failed',
  'guardian_admission_failure',
  'parent_lost',
  'payload_initialization_timeout',
  'payload_nonzero_exit',
  'payload_spawn_or_init_failure',
  'shell_finalizer_failure',
  'supervisor_signal',
  'supervisor_timeout',
  'unexpected_supervisor_exception',
]);
const SUPERVISOR_FAILURE_STAGES = new Set([
  'admission_ack_publish',
  'cli_boundary',
  'final_group_reap',
  'group_record_remove',
  'group_record_wait',
  'guardian_spawn',
  'payload_outcome_wait',
  'payload_readiness_wait',
  'shell_finalizer',
]);
const SUPERVISOR_FAILURE_REASONS = new Set([
  'group_record_failed',
  'initialization_timeout',
  'none',
  'parent_lost',
  'payload_exit',
  'shell_finalizer',
  'sigint',
  'sigterm',
  'supervisor_exception',
  'timeout',
]);
const PAYLOAD_OUTCOME_DETAILS = new Set([
  'payload_success',
  'payload_nonzero_exit',
  'payload_spawn_or_init_failure',
]);

export function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : null;
}

export function integer(value) {
  return typeof value === 'string' && /^[0-9]+$/u.test(value) ? Number(value) : NaN;
}

export function groupSignalIsPermitted(groupOwned, groupMayBeSignaled) {
  return groupOwned === true && groupMayBeSignaled === true;
}

function exactKeys(value, keys) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

export function isSupervisorFailureStage(stage) {
  return SUPERVISOR_FAILURE_STAGES.has(stage);
}

export function writeDurableAtomicFile(file, contents, tag) {
  const tempFile = `${file}.${process.pid}.${tag}.tmp`;
  let descriptor = null;
  try {
    descriptor = fs.openSync(tempFile, 'wx', 0o600);
    fs.writeFileSync(descriptor, contents, { encoding: 'utf8' });
    fs.fchmodSync(descriptor, 0o600);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(tempFile, file);
  } catch (error) {
    if (descriptor !== null) try { fs.closeSync(descriptor); } catch {}
    try { fs.unlinkSync(tempFile); } catch {}
    throw error;
  }
}

export function writeDurableExclusiveFile(file, contents, tag, failBeforePublish = false) {
  const tempFile = `${file}.${process.pid}.${tag}.tmp`;
  let descriptor = null;
  let directoryDescriptor = null;
  try {
    descriptor = fs.openSync(tempFile, 'wx', 0o600);
    fs.writeFileSync(descriptor, contents, { encoding: 'utf8' });
    fs.fchmodSync(descriptor, 0o600);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    if (failBeforePublish) throw new Error('SELF_TEST_PUBLICATION_FAILURE');
    fs.linkSync(tempFile, file);
    fs.unlinkSync(tempFile);
    directoryDescriptor = fs.openSync(path.dirname(file), fs.constants.O_RDONLY);
    fs.fsyncSync(directoryDescriptor);
    fs.closeSync(directoryDescriptor);
    directoryDescriptor = null;
  } catch (error) {
    if (descriptor !== null) try { fs.closeSync(descriptor); } catch {}
    if (directoryDescriptor !== null) try { fs.closeSync(directoryDescriptor); } catch {}
    try { fs.unlinkSync(tempFile); } catch {}
    throw error;
  }
}

export function readBoundedRegularFile(file, maximumBytes, requiredMode = null) {
  let descriptor = null;
  try {
    const noFollow = fs.constants.O_NOFOLLOW;
    if (!Number.isInteger(noFollow) || noFollow === 0) return null;
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | noFollow);
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size < 1 || stat.size > maximumBytes) return null;
    if (requiredMode !== null && (stat.mode & 0o777) !== requiredMode) return null;
    const bytes = Buffer.alloc(stat.size);
    if (fs.readSync(descriptor, bytes, 0, bytes.length, 0) !== bytes.length) return null;
    return bytes;
  } catch {
    return null;
  } finally {
    if (descriptor !== null) try { fs.closeSync(descriptor); } catch {}
  }
}

function supervisorFailureCombinationIsValid(detail, stage, status, reason) {
  if (!SUPERVISOR_FAILURE_DETAILS.has(detail)
      || !SUPERVISOR_FAILURE_STAGES.has(stage)
      || !Number.isSafeInteger(status) || status < 1 || status > 255
      || !SUPERVISOR_FAILURE_REASONS.has(reason)) return false;
  if (detail === 'group_reap_failed') return stage === 'final_group_reap' && status === 125;
  if (detail === 'group_record_remove_failed') {
    return stage === 'group_record_remove' && status === 125;
  }
  if (detail === 'group_record_failed') {
    return status === 125 && reason === 'group_record_failed'
      && ['admission_ack_publish', 'final_group_reap', 'group_record_wait'].includes(stage);
  }
  if (detail === 'parent_lost') {
    return status === 125 && reason === 'parent_lost'
      && ['admission_ack_publish', 'group_record_wait', 'payload_readiness_wait',
      'payload_outcome_wait', 'guardian_spawn'].includes(stage);
  }
  if (detail === 'payload_initialization_timeout') {
    return status === 126 && reason === 'initialization_timeout'
      && ['admission_ack_publish', 'group_record_wait', 'guardian_spawn',
        'payload_readiness_wait'].includes(stage);
  }
  if (detail === 'payload_nonzero_exit') {
    return reason === 'payload_exit' && stage === 'payload_outcome_wait';
  }
  if (detail === 'payload_spawn_or_init_failure') {
    return status === 125 && reason === 'payload_exit' && stage === 'payload_outcome_wait';
  }
  if (detail === 'shell_finalizer_failure') {
    return reason === 'shell_finalizer' && stage === 'shell_finalizer';
  }
  if (detail === 'supervisor_signal') {
    return (status === 130 && reason === 'sigint') || (status === 143 && reason === 'sigterm');
  }
  if (detail === 'supervisor_timeout') {
    return stage === 'payload_outcome_wait' && status === 124 && reason === 'timeout';
  }
  if (detail === 'guardian_admission_failure') {
    return status === 125 && reason === 'payload_exit'
      && ['guardian_spawn', 'payload_outcome_wait'].includes(stage);
  }
  return detail === 'unexpected_supervisor_exception'
    && status === 125 && reason === 'supervisor_exception';
}

function supervisorCleanupCombinationIsValid(detail, stage) {
  return (detail === 'group_reap_failed' && stage === 'final_group_reap')
    || (detail === 'group_record_remove_failed' && stage === 'group_record_remove');
}

export function supervisorProjectionIsValid(projection) {
  if (projection === null || typeof projection !== 'object' || Array.isArray(projection)) {
    return false;
  }
  const primaryKeys = [
    'supervisor_detail', 'supervisor_stage', 'supervisor_status', 'supervisor_reason',
  ];
  const cleanupKeys = ['supervisor_cleanup_detail', 'supervisor_cleanup_stage'];
  const primaryPresence = primaryKeys.map((key) => Object.hasOwn(projection, key));
  const cleanupPresence = cleanupKeys.map((key) => Object.hasOwn(projection, key));
  if (!primaryPresence.some(Boolean)) return !cleanupPresence.some(Boolean);
  if (!primaryPresence.every(Boolean)
      || (cleanupPresence.some(Boolean) && !cleanupPresence.every(Boolean))) return false;
  return supervisorFailureCombinationIsValid(
    projection.supervisor_detail,
    projection.supervisor_stage,
    projection.supervisor_status,
    projection.supervisor_reason,
  ) && (!cleanupPresence[0] || supervisorCleanupCombinationIsValid(
    projection.supervisor_cleanup_detail, projection.supervisor_cleanup_stage,
  ));
}

export function serializeSupervisorFailureReceipt(
  detail, stage, status, reason, cleanup = null,
) {
  if (!supervisorProjectionIsValid({
    ...(cleanup === null ? {} : {
      supervisor_cleanup_detail: cleanup.detail,
      supervisor_cleanup_stage: cleanup.stage,
    }),
    supervisor_detail: detail,
    supervisor_reason: reason,
    supervisor_stage: stage,
    supervisor_status: status,
  })) return null;
  return `${JSON.stringify({
    ...(cleanup === null ? {} : {
      cleanup_detail: cleanup.detail,
      cleanup_stage: cleanup.stage,
    }),
    detail,
    reason,
    schema: SUPERVISOR_FAILURE_SCHEMA,
    stage,
    status,
  })}\n`;
}

export function parseSupervisorFailureReceiptText(text) {
  try {
    if (typeof text !== 'string' || !text.endsWith('\n')) return null;
    const line = text.slice(0, -1).split('\n').at(-1);
    const receipt = JSON.parse(line);
    const hasCleanupDetail = Object.hasOwn(receipt, 'cleanup_detail');
    const hasCleanupStage = Object.hasOwn(receipt, 'cleanup_stage');
    const expectedKeys = hasCleanupDetail && hasCleanupStage
      ? ['cleanup_detail', 'cleanup_stage', 'detail', 'reason', 'schema', 'stage', 'status']
      : ['detail', 'reason', 'schema', 'stage', 'status'];
    if (hasCleanupDetail !== hasCleanupStage
        || !exactKeys(receipt, expectedKeys)
        || receipt.schema !== SUPERVISOR_FAILURE_SCHEMA
        || !supervisorProjectionIsValid({
          ...(hasCleanupDetail ? {
            supervisor_cleanup_detail: receipt.cleanup_detail,
            supervisor_cleanup_stage: receipt.cleanup_stage,
          } : {}),
          supervisor_detail: receipt.detail,
          supervisor_reason: receipt.reason,
          supervisor_stage: receipt.stage,
          supervisor_status: receipt.status,
        })) return null;
    return Object.freeze({
      cleanupDetail: hasCleanupDetail ? receipt.cleanup_detail : null,
      cleanupStage: hasCleanupStage ? receipt.cleanup_stage : null,
      detail: receipt.detail,
      reason: receipt.reason,
      stage: receipt.stage,
      status: receipt.status,
    });
  } catch {
    return null;
  }
}

export function supervisorFailureDetailFromFile(file) {
  const bytes = readBoundedRegularFile(file, SUPERVISOR_FAILURE_MAX_BYTES, 0o600);
  if (bytes === null) return null;
  const text = bytes.toString('utf8');
  return Buffer.from(text, 'utf8').equals(bytes)
    ? parseSupervisorFailureReceiptText(text)
    : null;
}

export function payloadOutcomeMessage(detail, status) {
  return PAYLOAD_OUTCOME_DETAILS.has(detail)
    && Number.isSafeInteger(status) && status >= 0 && status <= 255
    && ((detail === 'payload_success' && status === 0)
      || (detail === 'payload_nonzero_exit' && status >= 1)
      || (detail === 'payload_spawn_or_init_failure' && status === 125))
    ? Object.freeze({ detail, schema: PAYLOAD_OUTCOME_MESSAGE_SCHEMA, status })
    : null;
}

export function payloadOutcomeFromMessage(message) {
  return exactKeys(message, ['detail', 'schema', 'status'])
    && message.schema === PAYLOAD_OUTCOME_MESSAGE_SCHEMA
    && payloadOutcomeMessage(message.detail, message.status) !== null
    ? Object.freeze({ detail: message.detail, status: message.status })
    : null;
}

export function normalizedProcessStatus(result) {
  if (result?.error) return 125;
  if (result?.signal === 'SIGINT') return 130;
  if (result?.signal === 'SIGTERM') return 143;
  if (result?.signal !== null && result?.signal !== undefined) return 128;
  return Number.isSafeInteger(result?.code) && result.code >= 0 && result.code <= 255
    ? result.code
    : 125;
}

export function payloadOutcomeFromProcessResult(result) {
  const status = normalizedProcessStatus(result);
  if (status === 0) return Object.freeze({ detail: 'payload_success', status: 0 });
  if (result?.error || (result?.code == null && result?.signal == null)) {
    return Object.freeze({ detail: 'payload_spawn_or_init_failure', status: 125 });
  }
  return Object.freeze({ detail: 'payload_nonzero_exit', status });
}

export function publicSupervisorReason(reason, childFailed = false) {
  return new Map([
    ['GROUP_RECORD_FAILED', 'group_record_failed'],
    ['PARENT_LOST', 'parent_lost'],
    ['SELF_TEST_INITIALIZATION_TIMEOUT', 'initialization_timeout'],
    ['SIGINT', 'sigint'],
    ['SIGTERM', 'sigterm'],
    ['SUPERVISOR_EXCEPTION', 'supervisor_exception'],
    ['TIMEOUT', 'timeout'],
  ]).get(reason) ?? (childFailed ? 'payload_exit' : 'none');
}

export function primarySupervisorFailure({
  asynchronousFailure,
  fallbackStage,
  guardianFailureStage,
  guardianResult,
  payloadOutcome,
  reason,
  reasonStage,
}) {
  const reasonFailure = new Map([
    ['GROUP_RECORD_FAILED', ['group_record_failed', 125, 'group_record_failed']],
    ['PARENT_LOST', ['parent_lost', 125, 'parent_lost']],
    ['SELF_TEST_INITIALIZATION_TIMEOUT', [
      'payload_initialization_timeout', 126, 'initialization_timeout',
    ]],
    ['SIGINT', ['supervisor_signal', 130, 'sigint']],
    ['SIGTERM', ['supervisor_signal', 143, 'sigterm']],
    ['SUPERVISOR_EXCEPTION', [
      'unexpected_supervisor_exception', 125, 'supervisor_exception',
    ]],
    ['TIMEOUT', ['supervisor_timeout', 124, 'timeout']],
  ]).get(reason);
  if (reasonFailure !== undefined && reason !== 'SUPERVISOR_EXCEPTION') {
    const [detail, status, publicReason] = reasonFailure;
    return Object.freeze({
      detail, reason: publicReason, stage: reasonStage ?? fallbackStage, status,
    });
  }
  if (asynchronousFailure !== null) return asynchronousFailure;
  if (reasonFailure !== undefined) {
    const [detail, status, publicReason] = reasonFailure;
    return Object.freeze({
      detail, reason: publicReason, stage: reasonStage ?? fallbackStage, status,
    });
  }
  if (payloadOutcome?.status === 0) return null;
  if (payloadOutcome !== null) return Object.freeze({
    detail: payloadOutcome.detail,
    reason: 'payload_exit',
    stage: 'payload_outcome_wait',
    status: payloadOutcome.status,
  });
  return Object.freeze({
    detail: 'guardian_admission_failure',
    reason: 'payload_exit',
    stage: guardianFailureStage,
    status: 125,
  });
}

export function createPrivateOutputFiles(files) {
  if (files.length !== 2 || files[0] === files[1]) return false;
  const noFollow = fs.constants.O_NOFOLLOW;
  if (!Number.isInteger(noFollow) || noFollow === 0) return false;
  const created = [];
  let descriptor = null;
  let complete = false;
  try {
    for (const file of files) {
      descriptor = fs.openSync(
        file,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow,
        0o600,
      );
      created.push(file);
      fs.fchmodSync(descriptor, 0o600);
      const stat = fs.fstatSync(descriptor);
      if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.size !== 0) return false;
      fs.closeSync(descriptor);
      descriptor = null;
    }
    complete = true;
    return true;
  } catch {
    return false;
  } finally {
    if (descriptor !== null) try { fs.closeSync(descriptor); } catch {}
    if (!complete) {
      for (const file of created) try { fs.unlinkSync(file); } catch {}
    }
  }
}

export function readReadiness(
  file, expectedNonce, schema, maximumBytes, requireLive, processExists,
) {
  const bytes = readBoundedRegularFile(file, maximumBytes, 0o600);
  if (bytes === null) return null;
  try {
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes)) return null;
    const readiness = JSON.parse(text);
    if (!exactKeys(readiness, ['nonce', 'pid', 'schema'])) return null;
    if (readiness.schema !== schema || readiness.nonce !== expectedNonce) return null;
    if (!Number.isSafeInteger(readiness.pid) || readiness.pid <= 1) return null;
    if (requireLive && (typeof processExists !== 'function' || !processExists(readiness.pid))) {
      return null;
    }
    return readiness;
  } catch {
    return null;
  }
}

export function processTreeRetirementStatus(file, expectedNonce, processExists) {
  const readiness = readReadiness(
    file, expectedNonce, PROCESS_TREE_SCHEMA, PROCESS_TREE_MAX_BYTES, false, processExists,
  );
  if (readiness === null) return 2;
  return processExists(readiness.pid) ? 3 : 0;
}

export function runProgramTimeoutInitializationError(readiness, processExists) {
  return readiness === null || !processExists(readiness.pid)
    ? 'RUN_PROGRAM_TIMEOUT_INITIALIZATION_FAILED'
    : null;
}

export function ownedGroupRecordIsValid(file, expectedLeaderPID, expectedToken) {
  const bytes = readBoundedRegularFile(file, 96, 0o600);
  if (bytes === null) return false;
  const text = bytes.toString('utf8');
  return Buffer.from(text, 'utf8').equals(bytes)
    && text === `${expectedLeaderPID} ${expectedToken}\n`;
}

export function runProgramReceiptStatus(file) {
  const bytes = readBoundedRegularFile(file, 512, 0o600);
  if (bytes === null) return 1;
  try {
    const receipt = JSON.parse(bytes.toString('utf8'));
    if (receipt.status !== 'failed' || receipt.admission_ambiguous !== true) return 1;
    const baseKeys = ['admission_ambiguous', 'error_code', 'status'];
    if (receipt.error_code === 'RUN_PROGRAM_TIMEOUT_INITIALIZATION_FAILED') {
      return exactKeys(receipt, baseKeys) ? 2 : 1;
    }
    const timeoutKeys = [...baseKeys, 'descendant_live_before_outer_reap'];
    if (!exactKeys(receipt, timeoutKeys)
        || receipt.descendant_live_before_outer_reap !== true) return 1;
    if (receipt.error_code === 'COMMAND_TIMEOUT_SELF_TEST_FAILED') return 3;
    return receipt.error_code === 'COMMAND_TIMEOUT' ? 0 : 1;
  } catch {
    return 1;
  }
}

export function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

async function runCLI(mode, args) {
  if (mode === '--validate-owned-group-record' || mode === '--validate-guardian-identity') {
    return ownedGroupRecordIsValid(args[0], integer(args[1]), args[2]) ? 0 : 1;
  }
  if (mode === '--validate-process-tree-retired') {
    return processTreeRetirementStatus(
      args[0], process.env[PROCESS_TREE_NONCE_ENV] ?? '', processExists,
    );
  }
  if (mode === '--validate-run-program-receipt') return runProgramReceiptStatus(args[0]);
  if (mode === '--read-supervisor-failure-detail') {
    const failure = supervisorFailureDetailFromFile(args[0]);
    if (failure === null) return 1;
    process.stdout.write(`${failure.status} ${failure.detail} ${failure.stage} ${failure.reason} ${failure.cleanupDetail ?? 'absent'} ${failure.cleanupStage ?? 'absent'}`);
    return 0;
  }
  if (mode === '--create-private-output-files') return createPrivateOutputFiles(args) ? 0 : 1;
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
