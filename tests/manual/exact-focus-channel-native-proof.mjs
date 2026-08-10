#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NO_AUTOSTART_ENV = Object.freeze({
  AOS_ALLOW_DAEMON_AUTOSTART: '0',
  AOS_DISABLE_DAEMON_AUTOSTART: '1',
});
const COMMAND_RESPONSE_DEADLINE_MS = 3_000;
const CLEAN_ABSENCE_SETTLE_MS = COMMAND_RESPONSE_DEADLINE_MS + 250;
// The public see wrapper gives its detached native guardian 2.5 seconds to
// retire; keep the owning group alive beyond that bound before escalation.
const SUPERVISOR_TERM_GRACE_MS = 4_000;
const SUPERVISOR_KILL_GRACE_MS = 3_000;
const SUPERVISOR_PARENT_POLL_MS = 100;
const DRIVER_PATH = fileURLToPath(import.meta.url);
const SNAPSHOT_KEY_ENV = 'AOS_EXACT_FOCUS_CHANNEL_SNAPSHOT_KEY';
const PROGRESS_SCHEMA = 'aos.exact-focus-channel-native-progress.v1';
const PROGRESS_MAX_BYTES = 2_048;
const FIXTURE_RESULT_MAX_BYTES = 2_048;
const FIXTURE_METADATA_SCHEMA = 'aos.exact-focus-channel-native-fixture.v1';
const FIXTURE_READINESS_FAILURE_CODES = Object.freeze([
  'FIXTURE_WINDOW_LIST_UNAVAILABLE',
  'FIXTURE_WINDOW_OWNERSHIP_MISMATCH',
  'FIXTURE_WINDOW_LAYER_MISMATCH',
  'FIXTURE_TARGET_CONTROL_NOT_READY',
  'FIXTURE_SIBLING_CONTROL_NOT_READY',
  'FIXTURE_WINDOW_ORDER_MISMATCH',
  'FIXTURE_WINDOW_GEOMETRY_INVALID',
  'FIXTURE_DISPLAY_UNAVAILABLE',
]);
const FIXTURE_FAILURE_CODE_LIST = Object.freeze([
  'FIXTURE_ARGUMENTS_INVALID',
  'FIXTURE_HELPER_FAILED',
  ...FIXTURE_READINESS_FAILURE_CODES,
]);
const FIXTURE_FAILURE_CODES = new Set(FIXTURE_FAILURE_CODE_LIST);
const FIXTURE_METADATA_KEYS = Object.freeze([
  'display_id',
  'layer_zero_windows',
  'overlap_fraction',
  'ownership_token',
  'pid',
  'same_process_windows',
  'scale_factor',
  'schema',
  'sibling_above_target',
  'sibling_bounds',
  'sibling_identifier',
  'sibling_window_id',
  'target_bounds',
  'target_center_occluded',
  'target_identifier',
  'target_window_id',
]);
const AOS_COMMAND_ERROR_MAX_BYTES = 2_048;
const AOS_COMMAND_ERROR_CODES = new Set([
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
const AOS_PRECOMMIT_REJECTION_CODES = new Set([
  'CHANNEL_NOT_FOUND',
  'CHANNEL_STALE',
  'DUPLICATE_ID',
  'INVALID_DEPTH',
  'NATIVE_AX_ROOT_MISMATCH',
  'WINDOW_NOT_FOUND',
]);
// This content-free observation cap exceeds the shell's conservative
// 1,720,000ms outer live deadline, including failure and catch cleanup.
const PROGRESS_MAX_ELAPSED_MS = 1_800_000;
const PROGRESS_STAGES = Object.freeze([
  'runtime_preflight',
  'unrelated_channel_snapshot',
  'fixture_startup',
  'sibling_subtree_rejection',
  'target_channel_creation',
  'initial_capture',
  'rejected_refresh',
  'preserved_capture',
  'target_close',
  'missing_target_refresh',
  'missing_target_capture',
  'channel_cleanup',
  'fixture_cleanup',
  'postflight_attestation',
]);
const PROGRESS_MAX_ORDINAL = PROGRESS_STAGES.length * 2;
const PROGRESS_STAGE_SET = new Set(PROGRESS_STAGES);
const COMMAND_CLASS_TIMEOUT_MS = Object.freeze({
  // A product capture is allowed 25 seconds; leave five seconds for wrapper
  // startup and response serialization without making the command unbounded.
  capture: 30_000,
  // Public AOS queries/mutations have their own three-second response bound.
  // Ten seconds also covers process startup and typed response serialization.
  aos: 10_000,
  // Local git and offline pixel-analysis helpers must also fail finitely.
  local: 10_000,
  // Offline-only behavioral proof that a timed-out admitted command remains
  // ambiguous until its owning outer process group is reaped.
  timeoutSelfTest: 100,
});

class ProofError extends Error {
  constructor(
    code,
    {
      ambiguous = false,
      commandAdmissionAmbiguous = false,
      commandErrorCode = null,
    } = {},
  ) {
    super(code);
    this.code = code;
    this.ambiguous = ambiguous;
    this.commandAdmissionAmbiguous = commandAdmissionAmbiguous === true;
    this.commandErrorCode = AOS_COMMAND_ERROR_CODES.has(commandErrorCode)
      ? commandErrorCode
      : null;
  }
}

function fail(condition, code, options) {
  if (!condition) throw new ProofError(code, options);
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : null;
}

function parseInteger(value) {
  return /^\d+$/u.test(value ?? '') ? Number(value) : null;
}

function parseArguments(args) {
  const options = {
    aos: valueAfter(args, '--aos'),
    helper: valueAfter(args, '--helper'),
    root: valueAfter(args, '--root'),
    tempRoot: valueAfter(args, '--temp-root'),
    channel: valueAfter(args, '--channel'),
    progress: valueAfter(args, '--progress'),
    runtimeRevision: valueAfter(args, '--runtime-source-revision'),
  };
  fail(Object.values(options).every((value) => typeof value === 'string' && value.length > 0), 'INVALID_ARGUMENTS');
  fail(path.dirname(options.progress) === options.tempRoot, 'INVALID_ARGUMENTS');
  return options;
}

function parseJSON(text, code = 'INVALID_JSON') {
  try {
    return JSON.parse(String(text).trim());
  } catch {
    throw new ProofError(code);
  }
}

function monotonicElapsedMilliseconds(startedAt) {
  const elapsed = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
  return Math.min(Math.max(elapsed, 0), PROGRESS_MAX_ELAPSED_MS);
}

function writeProgressReceipt(file, receipt) {
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
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch {}
    }
    try { fs.unlinkSync(tempFile); } catch {}
    throw new ProofError('PROGRESS_RECEIPT_WRITE_FAILED');
  }
}

function createProgressReporter(file) {
  const startedAt = process.hrtime.bigint();
  let ordinal = 0;
  let activeStage = null;
  let lastCompletedStage = null;
  const persist = () => {
    ordinal += 1;
    fail(ordinal <= PROGRESS_MAX_ORDINAL, 'PROGRESS_RECEIPT_WRITE_FAILED');
    writeProgressReceipt(file, {
      schema: PROGRESS_SCHEMA,
      ordinal,
      last_started_stage: activeStage,
      last_completed_stage: lastCompletedStage,
      elapsed_ms: monotonicElapsedMilliseconds(startedAt),
    });
  };
  return Object.freeze({
    start(stage) {
      fail(PROGRESS_STAGE_SET.has(stage), 'PROGRESS_STAGE_INVALID');
      activeStage = stage;
      persist();
    },
    complete(stage) {
      fail(PROGRESS_STAGE_SET.has(stage) && activeStage === stage, 'PROGRESS_STAGE_INVALID');
      lastCompletedStage = stage;
      persist();
    },
  });
}

function unknownSanitizedProgress() {
  return {
    progress_receipt_valid: false,
    progress_ordinal: null,
    last_started_stage: 'unknown',
    last_completed_stage: 'unknown',
    progress_elapsed_ms: null,
  };
}

function progressTransitionIsCoherent(ordinal, lastStartedStage, lastCompletedStage) {
  if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > PROGRESS_MAX_ORDINAL) return false;
  const stageIndex = Math.floor((ordinal - 1) / 2);
  const expectedStage = PROGRESS_STAGES[stageIndex];
  const transitionCompleted = ordinal % 2 === 0;
  const expectedCompletedStage = transitionCompleted
    ? expectedStage
    : (stageIndex === 0 ? null : PROGRESS_STAGES[stageIndex - 1]);
  return lastStartedStage === expectedStage && lastCompletedStage === expectedCompletedStage;
}

function validatedProgressReceipt(file) {
  try {
    const noFollow = fs.constants.O_NOFOLLOW;
    if (!Number.isInteger(noFollow) || noFollow === 0) return null;
    const descriptor = fs.openSync(file, fs.constants.O_RDONLY | noFollow);
    try {
      const metadata = fs.fstatSync(descriptor);
      if (!metadata.isFile() || metadata.size < 1 || metadata.size > PROGRESS_MAX_BYTES) return null;
      if ((metadata.mode & 0o777) !== 0o600) return null;
      const bytes = Buffer.alloc(metadata.size);
      if (fs.readSync(descriptor, bytes, 0, bytes.length, 0) !== bytes.length) return null;
      const receipt = JSON.parse(bytes.toString('utf8'));
      if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return null;
      const expectedKeys = [
        'elapsed_ms',
        'last_completed_stage',
        'last_started_stage',
        'ordinal',
        'schema',
      ];
      if (JSON.stringify(Object.keys(receipt).sort()) !== JSON.stringify(expectedKeys)) return null;
      if (receipt.schema !== PROGRESS_SCHEMA) return null;
      if (!progressTransitionIsCoherent(
        receipt.ordinal,
        receipt.last_started_stage,
        receipt.last_completed_stage,
      )) return null;
      if (!Number.isSafeInteger(receipt.elapsed_ms)
        || receipt.elapsed_ms < 0
        || receipt.elapsed_ms > PROGRESS_MAX_ELAPSED_MS) return null;
      return receipt;
    } finally {
      fs.closeSync(descriptor);
    }
  } catch {
    return null;
  }
}

async function sanitizeProgressReceipt(args) {
  const file = valueAfter(args, '--path');
  const selfTestDelayValue = valueAfter(args, '--self-test-delay-ms');
  const selfTestDelayMilliseconds = selfTestDelayValue === null
    ? 0
    : parseInteger(selfTestDelayValue);
  if (!Number.isSafeInteger(selfTestDelayMilliseconds) || selfTestDelayMilliseconds > 10_000) {
    process.stdout.write(`${JSON.stringify(unknownSanitizedProgress())}\n`);
    return;
  }
  if (selfTestDelayMilliseconds > 0) await sleep(selfTestDelayMilliseconds);
  if (typeof file !== 'string' || file.length === 0) {
    process.stdout.write(`${JSON.stringify(unknownSanitizedProgress())}\n`);
    return;
  }
  const receipt = validatedProgressReceipt(file);
  const sanitized = receipt === null
    ? unknownSanitizedProgress()
    : {
      progress_receipt_valid: true,
      progress_ordinal: receipt.ordinal,
      last_started_stage: receipt.last_started_stage,
      last_completed_stage: receipt.last_completed_stage,
      progress_elapsed_ms: receipt.elapsed_ms,
    };
  process.stdout.write(`${JSON.stringify(sanitized)}\n`);
}

function nestedData(payload) {
  return payload && typeof payload.data === 'object' && payload.data !== null
    ? payload.data
    : payload;
}

function errorCode(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.code === 'string') return payload.code;
  if (payload.error && typeof payload.error === 'object' && typeof payload.error.code === 'string') {
    return payload.error.code;
  }
  if (payload.data && typeof payload.data === 'object') return errorCode(payload.data);
  return null;
}

function allowlistedAOSCommandErrorFromText(text) {
  if (typeof text !== 'string') return null;
  const size = Buffer.byteLength(text, 'utf8');
  if (size < 1 || size > AOS_COMMAND_ERROR_MAX_BYTES) return null;
  try {
    const payload = JSON.parse(text.trim());
    const code = errorCode(payload);
    return typeof code === 'string'
      && /^[A-Z][A-Z0-9_]*$/u.test(code)
      && AOS_COMMAND_ERROR_CODES.has(code)
      ? code
      : null;
  } catch {
    return null;
  }
}

function allowlistedAOSCommandError(result) {
  return allowlistedAOSCommandErrorFromText(result?.stderr)
    ?? allowlistedAOSCommandErrorFromText(result?.stdout);
}

function aosCommandMayAdmitMutation(args) {
  return (args[0] === 'focus' && ['create', 'remove', 'update'].includes(args[1]))
    || (args[0] === 'see' && args[1] === 'capture');
}

function aosCommandProofError(
  code,
  args,
  result,
  { executionAmbiguous = false, unexpectedSuccess = false } = {},
) {
  const commandErrorCode = unexpectedSuccess
    ? null
    : allowlistedAOSCommandError(result);
  const commandAdmissionAmbiguous = unexpectedSuccess
    || (aosCommandMayAdmitMutation(args)
      && !AOS_PRECOMMIT_REJECTION_CODES.has(commandErrorCode));
  return new ProofError(code, {
    ambiguous: executionAmbiguous || commandAdmissionAmbiguous,
    commandAdmissionAmbiguous,
    commandErrorCode,
  });
}

function commandFailureFields(error) {
  return {
    error_code: error instanceof ProofError ? error.code : 'NATIVE_PROOF_FAILED',
    command_error_code: error instanceof ProofError ? error.commandErrorCode : null,
    command_admission_ambiguous: error instanceof ProofError
      ? error.commandAdmissionAmbiguous
      : false,
  };
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

function processGroupExists(pgid) {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

function signalProcessGroup(pgid, signal) {
  try {
    process.kill(-pgid, signal);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForProcessGroupGone(pgid, timeoutMilliseconds) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (!processGroupExists(pgid)) return true;
    await sleep(25);
  }
  return !processGroupExists(pgid);
}

async function retireProcessGroup(pgid) {
  if (!processGroupExists(pgid)) return true;
  signalProcessGroup(pgid, 'SIGTERM');
  if (await waitForProcessGroupGone(pgid, SUPERVISOR_TERM_GRACE_MS)) return true;
  signalProcessGroup(pgid, 'SIGKILL');
  return waitForProcessGroupGone(pgid, SUPERVISOR_KILL_GRACE_MS);
}

function writeDurableAtomicFile(file, contents, tag) {
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
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch {}
    }
    try { fs.unlinkSync(tempFile); } catch {}
    throw error;
  }
}

async function superviseCommand(args) {
  const separator = args.indexOf('--');
  const supervisorArgs = args.slice(0, separator);
  const ownerPID = parseInteger(valueAfter(supervisorArgs, '--owner-pid'));
  const groupPIDFile = valueAfter(supervisorArgs, '--group-pid-file');
  const readyFile = valueAfter(supervisorArgs, '--ready-file');
  const timeoutMilliseconds = parseInteger(valueAfter(supervisorArgs, '--timeout-ms'));
  const readyDelayValue = valueAfter(supervisorArgs, '--self-test-ready-delay-ms');
  const readyDelayMilliseconds = readyDelayValue === null ? 0 : parseInteger(readyDelayValue);
  const preRecordDelayValue = valueAfter(
    supervisorArgs,
    '--self-test-post-spawn-pre-record-delay-ms',
  );
  const preRecordDelayMilliseconds = preRecordDelayValue === null
    ? 0
    : parseInteger(preRecordDelayValue);
  const postSpawnFile = valueAfter(supervisorArgs, '--self-test-post-spawn-file');
  const finalReapDelayValue = valueAfter(
    supervisorArgs,
    '--self-test-final-reap-delay-ms',
  );
  const finalReapDelayMilliseconds = finalReapDelayValue === null
    ? 0
    : parseInteger(finalReapDelayValue);
  const finalReapFile = valueAfter(supervisorArgs, '--self-test-final-reap-file');
  const finalReapCompleteFile = valueAfter(
    supervisorArgs,
    '--self-test-final-reap-complete-file',
  );
  fail(separator >= 0 && separator + 1 < args.length, 'SUPERVISOR_ARGUMENTS_INVALID');
  fail(Number.isSafeInteger(ownerPID) && ownerPID > 1, 'SUPERVISOR_ARGUMENTS_INVALID');
  fail(typeof groupPIDFile === 'string' && groupPIDFile.length > 0, 'SUPERVISOR_ARGUMENTS_INVALID');
  fail(typeof readyFile === 'string' && readyFile.length > 0, 'SUPERVISOR_ARGUMENTS_INVALID');
  fail(Number.isSafeInteger(timeoutMilliseconds) && timeoutMilliseconds >= 1, 'SUPERVISOR_ARGUMENTS_INVALID');
  fail(Number.isSafeInteger(readyDelayMilliseconds) && readyDelayMilliseconds <= 10_000, 'SUPERVISOR_ARGUMENTS_INVALID');
  fail(Number.isSafeInteger(preRecordDelayMilliseconds) && preRecordDelayMilliseconds <= 10_000, 'SUPERVISOR_ARGUMENTS_INVALID');
  fail(Number.isSafeInteger(finalReapDelayMilliseconds) && finalReapDelayMilliseconds <= 10_000, 'SUPERVISOR_ARGUMENTS_INVALID');
  fail(
    preRecordDelayMilliseconds === 0
      || (typeof postSpawnFile === 'string' && postSpawnFile.length > 0),
    'SUPERVISOR_ARGUMENTS_INVALID',
  );
  fail(
    finalReapDelayMilliseconds === 0
      || (typeof finalReapFile === 'string'
        && finalReapFile.length > 0
        && typeof finalReapCompleteFile === 'string'
        && finalReapCompleteFile.length > 0),
    'SUPERVISOR_ARGUMENTS_INVALID',
  );

  const ownershipToken = crypto.randomBytes(16).toString('hex');
  const command = args.slice(separator + 1);
  let child = null;
  let groupRecorded = false;
  let reason = null;
  let childResult = null;
  let terminationStarted = false;
  let escalationTimer = null;

  const beginTermination = (allowUnrecorded = false) => {
    if (reason === null) return;
    if (terminationStarted || !Number.isSafeInteger(child?.pid)) return;
    if (!groupRecorded && !allowUnrecorded) return;
    terminationStarted = true;
    signalProcessGroup(child.pid, 'SIGTERM');
    escalationTimer = setTimeout(() => {
      signalProcessGroup(child.pid, 'SIGKILL');
    }, SUPERVISOR_TERM_GRACE_MS);
  };
  const requestTermination = (nextReason) => {
    if (reason === null) reason = nextReason;
    beginTermination();
  };
  const signalHandlers = new Map([
    ['SIGINT', () => requestTermination('SIGINT')],
    ['SIGTERM', () => requestTermination('SIGTERM')],
  ]);
  // Persistent handlers keep repeated same-type signals idempotent while an
  // admitted group is still awaiting its durable ownership record.
  for (const [signal, handler] of signalHandlers) process.on(signal, handler);

  const parentMonitor = setInterval(() => {
    if (process.ppid !== ownerPID || !processExists(ownerPID)) requestTermination('PARENT_LOST');
  }, SUPERVISOR_PARENT_POLL_MS);
  const deadline = setTimeout(() => requestTermination('TIMEOUT'), timeoutMilliseconds);

  try {
    try {
      // Signal, parent-loss, and deadline handling are active before detached
      // admission. Any pre-record request remains pending until exact ownership
      // has been durably recorded.
      child = spawn(process.execPath, [
        DRIVER_PATH,
        '--owned-group-wrapper',
        '--ownership-token', ownershipToken,
        '--',
        ...command,
      ], {
        cwd: process.cwd(),
        detached: true,
        env: { ...process.env, ...NO_AUTOSTART_ENV },
        stdio: 'inherit',
      });
      const childResultPromise = new Promise((resolve) => {
        child.once('error', (error) => resolve({ code: null, signal: null, error }));
        child.once('close', (code, signal) => resolve({ code, signal, error: null }));
      });
      const spawnResult = await new Promise((resolve) => {
        child.once('spawn', () => resolve({ error: null }));
        child.once('error', (error) => resolve({ error }));
      });
      if (spawnResult.error || !Number.isSafeInteger(child.pid) || child.pid <= 1) {
        childResult = await childResultPromise;
      } else {
        if (preRecordDelayMilliseconds > 0) {
          writeDurableAtomicFile(postSpawnFile, `${child.pid}\n`, 'post-spawn');
          await sleep(preRecordDelayMilliseconds);
        }
        try {
          writeDurableAtomicFile(
            groupPIDFile,
            `${child.pid} ${ownershipToken}\n`,
            'group-owner',
          );
          groupRecorded = true;
          beginTermination();
        } catch {
          if (reason === null) reason = 'GROUP_RECORD_FAILED';
          beginTermination(true);
        }
        if (groupRecorded && reason === null) {
          if (readyDelayMilliseconds > 0) await sleep(readyDelayMilliseconds);
          beginTermination();
          if (reason === null) {
            // Ready means handlers, owner monitoring, deadline, and the exact
            // durable group record are all active.
            writeDurableAtomicFile(readyFile, `${process.pid}\n`, 'ready');
          }
        }
        childResult = await childResultPromise;
      }
    } catch (error) {
      childResult = { code: null, signal: null, error };
      if (Number.isSafeInteger(child?.pid)) {
        if (reason === null) reason = 'GROUP_RECORD_FAILED';
        beginTermination(true);
      }
    } finally {
      clearInterval(parentMonitor);
      clearTimeout(deadline);
    }

    if (finalReapDelayMilliseconds > 0 && Number.isSafeInteger(child?.pid)) {
      try {
        writeDurableAtomicFile(finalReapFile, `${child.pid}\n`, 'final-reap');
      } catch {
        if (reason === null) reason = 'GROUP_RECORD_FAILED';
      }
      await sleep(finalReapDelayMilliseconds);
    }

    const groupGone = Number.isSafeInteger(child?.pid) ? await retireProcessGroup(child.pid) : true;
    if (groupGone) {
      try {
        fs.unlinkSync(groupPIDFile);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    } else {
      process.stderr.write(`${JSON.stringify({ code: 'PROCESS_GROUP_NOT_REAPED', status: 'failed' })}\n`);
      return 125;
    }
    if (finalReapDelayMilliseconds > 0) {
      writeDurableAtomicFile(finalReapCompleteFile, 'complete\n', 'final-reap-complete');
    }

    if (reason === 'TIMEOUT') return 124;
    if (reason === 'SIGINT') return 130;
    if (reason === 'SIGTERM') return 143;
    if (reason === 'PARENT_LOST') return 125;
    if (reason === 'GROUP_RECORD_FAILED') return 125;
    if (childResult?.error) return 125;
    if (childResult?.signal === 'SIGINT') return 130;
    if (childResult?.signal === 'SIGTERM') return 143;
    if (childResult?.signal !== null) return 128;
    return childResult?.code ?? 1;
  } finally {
    if (escalationTimer !== null) clearTimeout(escalationTimer);
    // Signals remain handled until retirement proves the exact group gone and
    // the durable ownership record has been removed.
    for (const [signal, handler] of signalHandlers) process.off(signal, handler);
  }
}

async function ownedGroupWrapper(args) {
  const separator = args.indexOf('--');
  const ownershipToken = valueAfter(args.slice(0, separator), '--ownership-token');
  fail(separator >= 0 && separator + 1 < args.length, 'OWNED_GROUP_ARGUMENTS_INVALID');
  fail(/^[a-f0-9]{32}$/u.test(ownershipToken ?? ''), 'OWNED_GROUP_ARGUMENTS_INVALID');
  const [executable, ...childArgs] = args.slice(separator + 1);
  const child = spawn(executable, childArgs, {
    cwd: process.cwd(),
    env: { ...process.env, ...NO_AUTOSTART_ENV },
    stdio: 'inherit',
  });
  const result = await new Promise((resolve) => {
    child.once('error', (error) => resolve({ code: null, signal: null, error }));
    child.once('close', (code, signal) => resolve({ code, signal, error: null }));
  });
  if (result.error) return 125;
  if (result.signal === 'SIGINT') return 130;
  if (result.signal === 'SIGTERM') return 143;
  if (result.signal !== null) return 128;
  return result.code ?? 1;
}

async function hangWithGrandchild(args) {
  const pidFile = valueAfter(args, '--pid-file');
  fail(typeof pidFile === 'string' && pidFile.length > 0, 'INVALID_ARGUMENTS');
  const child = spawn('/bin/zsh', ['-c', 'trap "" TERM; exec /bin/sleep 30'], {
    stdio: 'ignore',
  });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  fs.writeFileSync(pidFile, `${child.pid}\n`, { mode: 0o600 });
  process.on('SIGTERM', () => {});
  await new Promise(() => {});
}

async function exitWithTermIgnoringDescendant(args) {
  const pidFile = valueAfter(args, '--pid-file');
  fail(typeof pidFile === 'string' && pidFile.length > 0, 'INVALID_ARGUMENTS');
  const child = spawn('/bin/zsh', ['-c', 'trap "" TERM; exec /bin/sleep 30'], {
    stdio: 'ignore',
  });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  fs.writeFileSync(pidFile, `${child.pid}\n`, { mode: 0o600 });
  child.unref();
}

async function progressHangSelfTest(args) {
  const progressFile = valueAfter(args, '--progress');
  const pidFile = valueAfter(args, '--pid-file');
  fail(typeof progressFile === 'string' && progressFile.length > 0, 'INVALID_ARGUMENTS');
  fail(typeof pidFile === 'string' && pidFile.length > 0, 'INVALID_ARGUMENTS');
  fail(path.dirname(progressFile) === path.dirname(pidFile), 'INVALID_ARGUMENTS');
  const progress = createProgressReporter(progressFile);
  for (const stage of PROGRESS_STAGES.slice(0, 5)) {
    progress.start(stage);
    progress.complete(stage);
  }
  progress.start('initial_capture');
  const child = spawn('/bin/zsh', ['-c', 'trap "" TERM; exec /bin/sleep 30'], {
    stdio: 'ignore',
  });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  fs.writeFileSync(pidFile, `${child.pid}\n`, { mode: 0o600 });
  process.on('SIGTERM', () => {});
  await new Promise(() => {});
}

function runProgramTimeoutSelfTest(args) {
  const pidFile = valueAfter(args, '--pid-file');
  fail(typeof pidFile === 'string' && pidFile.length > 0, 'INVALID_ARGUMENTS');
  const rawSentinel = 'RAW_PROGRESS_SENTINEL_MUST_NOT_LEAK';
  process.env.AOS_RUN_PROGRAM_TIMEOUT_PID_FILE = pidFile;
  process.env.AOS_RUN_PROGRAM_TIMEOUT_SENTINEL = rawSentinel;
  let caught = null;
  try {
    runProgram('/bin/zsh', ['-c', `
      print -r -- "$AOS_RUN_PROGRAM_TIMEOUT_SENTINEL"
      print -u2 -r -- "$AOS_RUN_PROGRAM_TIMEOUT_SENTINEL"
      /bin/zsh -c 'trap "" TERM; exec /bin/sleep 30' &
      descendant_pid="$!"
      print -r -- "$descendant_pid" > "$AOS_RUN_PROGRAM_TIMEOUT_PID_FILE"
      wait "$descendant_pid"
    `], { commandClass: 'timeoutSelfTest' });
  } catch (error) {
    caught = error;
  } finally {
    delete process.env.AOS_RUN_PROGRAM_TIMEOUT_PID_FILE;
    delete process.env.AOS_RUN_PROGRAM_TIMEOUT_SENTINEL;
  }
  const descendantPID = parseInteger(fs.readFileSync(pidFile, 'utf8').trim());
  fail(caught instanceof ProofError && caught.code === 'COMMAND_TIMEOUT', 'COMMAND_TIMEOUT_SELF_TEST_FAILED');
  fail(caught.ambiguous === true, 'COMMAND_TIMEOUT_SELF_TEST_FAILED');
  fail(Number.isSafeInteger(descendantPID) && descendantPID > 1, 'COMMAND_TIMEOUT_SELF_TEST_FAILED');
  fail(processExists(descendantPID), 'COMMAND_TIMEOUT_SELF_TEST_FAILED');
  process.stdout.write(`${JSON.stringify({
    admission_ambiguous: true,
    descendant_live_before_outer_reap: true,
    error_code: 'COMMAND_TIMEOUT',
    status: 'failed',
  })}\n`);
  process.exitCode = 1;
}

function commandTelemetrySelfTest() {
  const rawSentinel = 'éRAW_AOS_COMMAND_SENTINEL_MUST_NOT_LEAK';
  const options = { aos: '/offline/fake-aos', root: '/offline/fake-root' };
  const mutation = ['focus', 'create'];
  const result = (code, error = rawSentinel, stream = 'stderr') => ({
    status: 1,
    signal: null,
    stdout: stream === 'stdout' ? JSON.stringify({ code, error }) : '',
    stderr: stream === 'stderr' ? JSON.stringify({ code, error }) : '',
  });
  const execute = (candidate) => () => candidate;
  const captureProofError = (operation) => {
    let observed = null;
    try {
      operation();
    } catch (error) {
      observed = error;
    }
    fail(observed instanceof ProofError, 'COMMAND_TELEMETRY_SELF_TEST_FAILED');
    return observed;
  };
  const resultAtExactBytes = (code, byteCount) => {
    const payload = { code, error: rawSentinel, padding: '' };
    const baseByteCount = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    fail(baseByteCount <= byteCount, 'COMMAND_TELEMETRY_SELF_TEST_FAILED');
    payload.padding = 'x'.repeat(byteCount - baseByteCount);
    const stderr = JSON.stringify(payload);
    fail(Buffer.byteLength(stderr, 'utf8') === byteCount, 'COMMAND_TELEMETRY_SELF_TEST_FAILED');
    return { status: 1, signal: null, stdout: '', stderr };
  };
  const precommitCodes = [
    'CHANNEL_NOT_FOUND',
    'CHANNEL_STALE',
    'DUPLICATE_ID',
    'INVALID_DEPTH',
    'NATIVE_AX_ROOT_MISMATCH',
    'WINDOW_NOT_FOUND',
  ];
  const rejections = precommitCodes.map((typedCode) => captureProofError(() => (
    runAOSSuccess(options, mutation, 'FOCUS_CREATE_FAILED', execute(result(typedCode)))
  )));
  const expectedFailure = runAOSFailure(
    options,
    mutation,
    'WINDOW_NOT_FOUND',
    'SIBLING_SUBTREE_NOT_REJECTED',
    execute(result('WINDOW_NOT_FOUND', rawSentinel, 'stdout')),
  );
  const stderrPriority = captureProofError(() => runAOSFailure(
    options,
    mutation,
    'WINDOW_NOT_FOUND',
    'SIBLING_SUBTREE_NOT_REJECTED',
    execute({
      status: 1,
      signal: null,
      stdout: JSON.stringify({ code: 'WINDOW_NOT_FOUND', error: rawSentinel }),
      stderr: JSON.stringify({ code: 'INTERNAL', error: rawSentinel }),
    }),
  ));
  const typedAmbiguous = ['DAEMON_UNREACHABLE', 'DAEMON_UNAVAILABLE', 'INTERNAL'].map(
    (typedCode) => captureProofError(() => (
      runAOSSuccess(options, mutation, 'FOCUS_CREATE_FAILED', execute(result(typedCode)))
    )),
  );
  const exactLimit = captureProofError(() => runAOSSuccess(
    options,
    mutation,
    'FOCUS_CREATE_FAILED',
    execute(resultAtExactBytes('INTERNAL', AOS_COMMAND_ERROR_MAX_BYTES)),
  ));
  const overLimit = captureProofError(() => runAOSSuccess(
    options,
    mutation,
    'FOCUS_CREATE_FAILED',
    execute(resultAtExactBytes('INTERNAL', AOS_COMMAND_ERROR_MAX_BYTES + 1)),
  ));
  const untypedAmbiguous = [
    { status: null, signal: 'SIGKILL', stdout: '', stderr: rawSentinel },
    result('UNRECOGNIZED_UPPERCASE_CODE'),
    { status: 1, signal: null, stdout: '', stderr: '' },
    { status: 0, signal: null, stdout: rawSentinel, stderr: '' },
  ].map((candidate) => captureProofError(() => (
    runAOSSuccess(options, mutation, 'FOCUS_CREATE_FAILED', execute(candidate))
  )));
  const executionAmbiguous = [
    'COMMAND_TIMEOUT',
    'COMMAND_LAUNCH_FAILED',
    'COMMAND_INTERRUPTED',
  ].map((executionCode) => captureProofError(() => runAOSSuccess(
    options,
    mutation,
    'FOCUS_CREATE_FAILED',
    () => { throw new ProofError(executionCode, { ambiguous: true }); },
  )));
  const unexpectedSuccess = captureProofError(() => runAOSFailure(
    options,
    mutation,
    'WINDOW_NOT_FOUND',
    'SIBLING_SUBTREE_NOT_REJECTED',
    execute({ status: 0, signal: null, stdout: rawSentinel, stderr: '' }),
  ));
  const readOnlyUntyped = captureProofError(() => runAOSSuccess(
    options,
    ['focus', 'list'],
    'FOCUS_LIST_FAILED',
    execute({ status: 1, signal: null, stdout: '', stderr: rawSentinel }),
  ));
  const observed = [
    ...rejections,
    stderrPriority,
    ...typedAmbiguous,
    exactLimit,
    overLimit,
    ...untypedAmbiguous,
    ...executionAmbiguous,
    unexpectedSuccess,
    readOnlyUntyped,
  ].map(commandFailureFields);

  fail(
    rejections.every((error, index) => (
      error.commandErrorCode === precommitCodes[index]
        && error.commandAdmissionAmbiguous === false
    )),
    'COMMAND_TELEMETRY_SELF_TEST_FAILED',
  );
  fail(expectedFailure === undefined, 'COMMAND_TELEMETRY_SELF_TEST_FAILED');
  fail(
    stderrPriority.commandErrorCode === 'INTERNAL'
      && stderrPriority.commandAdmissionAmbiguous === true,
    'COMMAND_TELEMETRY_SELF_TEST_FAILED',
  );
  fail(
    typedAmbiguous.every((error) => (
      error.commandAdmissionAmbiguous === true && error.commandErrorCode !== null
    )),
    'COMMAND_TELEMETRY_SELF_TEST_FAILED',
  );
  fail(
    exactLimit.commandErrorCode === 'INTERNAL'
      && exactLimit.commandAdmissionAmbiguous === true
      && overLimit.commandErrorCode === null
      && overLimit.commandAdmissionAmbiguous === true,
    'COMMAND_TELEMETRY_SELF_TEST_FAILED',
  );
  fail(
    untypedAmbiguous.every((error) => (
      error.commandAdmissionAmbiguous === true && error.commandErrorCode === null
    )),
    'COMMAND_TELEMETRY_SELF_TEST_FAILED',
  );
  fail(
    executionAmbiguous.every((error) => (
      error.ambiguous === true
        && error.commandAdmissionAmbiguous === true
        && error.commandErrorCode === null
    )),
    'COMMAND_TELEMETRY_SELF_TEST_FAILED',
  );
  fail(
    unexpectedSuccess.commandAdmissionAmbiguous === true
      && unexpectedSuccess.commandErrorCode === null,
    'COMMAND_TELEMETRY_SELF_TEST_FAILED',
  );
  fail(readOnlyUntyped.commandAdmissionAmbiguous === false, 'COMMAND_TELEMETRY_SELF_TEST_FAILED');
  fail(!JSON.stringify(observed).includes(rawSentinel), 'COMMAND_TELEMETRY_SELF_TEST_FAILED');

  process.stdout.write(`${JSON.stringify({
    allowlisted_command_error_code: true,
    ambiguous_command_admission: true,
    exact_utf8_byte_boundaries: true,
    precommit_rejection_nonambiguous: true,
    raw_command_output_reflected: false,
    read_only_failure_nonadmitting: true,
    status: 'passed',
    stderr_priority: true,
    terminal_failure_projection: true,
    unknown_command_error_suppressed: true,
    unexpected_success_ambiguous: true,
    wrappers_exercised: true,
  })}\n`);
}

function proofEnvironment() {
  const environment = { ...process.env, ...NO_AUTOSTART_ENV };
  delete environment[SNAPSHOT_KEY_ENV];
  return environment;
}

function assertEnvironmentScope() {
  const allowed = new Set([
    'AOS_ALLOW_DAEMON_AUTOSTART',
    'AOS_DISABLE_DAEMON_AUTOSTART',
    'AOS_EXACT_FOCUS_CHANNEL_NATIVE_PROOF_OK',
    SNAPSHOT_KEY_ENV,
  ]);
  const unexpected = Object.keys(process.env)
    .filter((key) => key.startsWith('AOS_') && !allowed.has(key))
    .sort();
  fail(unexpected.length === 0, 'RUNTIME_ENVIRONMENT_OVERRIDE');
  fail(process.env.AOS_DISABLE_DAEMON_AUTOSTART === '1', 'DAEMON_AUTOSTART_NOT_DISABLED');
  fail(process.env.AOS_ALLOW_DAEMON_AUTOSTART === '0', 'DAEMON_AUTOSTART_NOT_DISABLED');
  fail(/^[a-f0-9]{64}$/u.test(process.env[SNAPSHOT_KEY_ENV] ?? ''), 'SNAPSHOT_KEY_UNAVAILABLE');
}

function runProgram(
  executable,
  args,
  { cwd, commandClass = 'local', maxBuffer = 64 * 1024 * 1024 } = {},
) {
  const timeout = COMMAND_CLASS_TIMEOUT_MS[commandClass];
  fail(Number.isSafeInteger(timeout) && timeout > 0, 'COMMAND_CLASS_INVALID');
  const result = spawnSync(executable, args, {
    cwd,
    encoding: 'utf8',
    env: proofEnvironment(),
    killSignal: 'SIGKILL',
    maxBuffer,
    timeout,
  });
  if (result.error?.code === 'ETIMEDOUT') {
    throw new ProofError('COMMAND_TIMEOUT', { ambiguous: true });
  }
  if (result.error) throw new ProofError('COMMAND_LAUNCH_FAILED', { ambiguous: true });
  if (result.signal !== null || result.status === null) {
    throw new ProofError('COMMAND_INTERRUPTED', { ambiguous: true });
  }
  return result;
}

function aosCommandClass(args) {
  return args[0] === 'see' && args[1] === 'capture' ? 'capture' : 'aos';
}

function runAOSSuccess(options, args, code, execute = runProgram) {
  let result;
  try {
    result = execute(options.aos, args, {
      commandClass: aosCommandClass(args),
      cwd: options.root,
    });
  } catch (error) {
    if (error instanceof ProofError) {
      throw aosCommandProofError(error.code, args, null, {
        executionAmbiguous: error.ambiguous,
      });
    }
    throw error;
  }
  if (result.status !== 0) throw aosCommandProofError(code, args, result);
  let payload;
  try {
    payload = parseJSON(result.stdout, `${code}_JSON_INVALID`);
  } catch {
    throw aosCommandProofError(`${code}_JSON_INVALID`, args, result);
  }
  if (errorCode(payload) !== null) throw aosCommandProofError(code, args, result);
  return payload;
}

function runAOSFailure(options, args, expectedCode, code, execute = runProgram) {
  let result;
  try {
    result = execute(options.aos, args, {
      commandClass: aosCommandClass(args),
      cwd: options.root,
    });
  } catch (error) {
    if (error instanceof ProofError) {
      throw aosCommandProofError(error.code, args, null, {
        executionAmbiguous: error.ambiguous,
      });
    }
    throw error;
  }
  if (result.status === 0) {
    throw aosCommandProofError(code, args, result, { unexpectedSuccess: true });
  }
  const commandErrorCode = allowlistedAOSCommandError(result);
  if (commandErrorCode !== expectedCode) throw aosCommandProofError(code, args, result);
  return undefined;
}

function focusEntries(payload) {
  const data = nestedData(payload);
  fail(Array.isArray(data?.channels), 'FOCUS_LIST_INVALID');
  return data.channels;
}

function stableFocusProjection(entry) {
  return {
    app: entry.app,
    elements_count: entry.elements_count,
    id: entry.id,
    kind: entry.kind,
    window_id: entry.window_id,
  };
}

function canonicalJSON(value) {
  if (Array.isArray(value)) return value.map((item) => canonicalJSON(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, canonicalJSON(value[key])]),
    );
  }
  return value;
}

function stablePublicChannelEntry(entry) {
  const stable = { ...entry };
  if (stable.kind === 'window') {
    delete stable.elements_count;
    delete stable.updated_at;
  }
  return canonicalJSON(stable);
}

function stablePublicChannelSnapshots(entries, excludedIDs) {
  const snapshots = entries
    .filter((entry) => !excludedIDs.includes(entry?.id))
    .map((entry) => stablePublicChannelEntry(entry));
  return snapshots.sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

function stablePublicChannelDigests(entries, excludedIDs, key) {
  return stablePublicChannelSnapshots(entries, excludedIDs)
    .map((entry) => crypto.createHmac('sha256', key)
      .update(JSON.stringify(entry))
      .digest('hex'));
}

function channelSnapshotSelfTest() {
  const native = {
    id: 'native-existing',
    kind: 'window',
    app: 'Fixture',
    elements_count: 2,
    updated_at: '2026-08-09T12:00:00Z',
    window_id: 41,
  };
  const browser = {
    id: 'browser-existing',
    kind: 'browser',
    session: 'browser-existing',
    mode: 'cdp',
    updated_at: '2026-08-09T12:00:00Z',
    attach: 'extension',
    headless: false,
    browser_window_id: 7,
    active_url: 'https://example.invalid/one',
  };
  const proof = { id: 'proof-owned', kind: 'window', elements_count: 1 };
  const key = Buffer.alloc(32, 0x42);
  const baseline = stablePublicChannelDigests([native, proof, browser], ['proof-owned'], key);
  fail(
    equalJSON(
      baseline,
      stablePublicChannelDigests([
        { ...browser },
        { window_id: 41, updated_at: native.updated_at, kind: 'window', id: native.id, elements_count: 2, app: 'Fixture' },
      ], [], key),
    ),
    'CHANNEL_SNAPSHOT_CANONICALIZATION_FAILED',
  );
  const nativeRefresh = stablePublicChannelDigests([
    { ...native, elements_count: 3, updated_at: '2026-08-09T12:00:01Z' },
    browser,
  ], [], key);
  fail(equalJSON(baseline, nativeRefresh), 'CHANNEL_SNAPSHOT_VOLATILE_REFRESH_REJECTED');
  const mutations = [
    [{ ...native, app: 'Other Fixture' }, browser],
    [{ ...native, window_id: 42 }, browser],
    [native, { ...browser, attach: 'cdp' }],
    [native, { ...browser, headless: true }],
    [native, { ...browser, active_url: 'https://example.invalid/two' }],
    [native, { ...browser, session: 'other-session' }],
    [native, { ...browser, updated_at: '2026-08-09T12:00:01Z' }],
  ];
  fail(
    mutations.every((entries) => !equalJSON(
      baseline,
      stablePublicChannelDigests(entries, [], key),
    )),
    'CHANNEL_SNAPSHOT_MUTATION_UNDETECTED',
  );
  process.stdout.write(`${JSON.stringify({
    keyed_stable_public_channel_snapshot: true,
    status: 'passed',
  })}\n`);
}

function equalJSON(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function boundsEqual(actual, expected) {
  return actual
    && Number(actual.x) === expected.x
    && Number(actual.y) === expected.y
    && Number(actual.width) === expected.width
    && Number(actual.height) === expected.height;
}

function elementCarriesIdentifier(element, identifier) {
  return element?.identifier === identifier
    || element?.handle?.query?.identifier === identifier;
}

function canonicalAXProjection(elements) {
  return elements
    .map((element) => ({
      app_pid: element.app_pid ?? null,
      window_id: element.window_id ?? null,
      role: element.role ?? null,
      title: element.title ?? null,
      label: element.label ?? null,
      identifier: element.identifier ?? null,
      enabled: element.enabled ?? null,
      bounds: element.bounds ? {
        x: element.bounds.x,
        y: element.bounds.y,
        width: element.bounds.width,
        height: element.bounds.height,
      } : null,
      handle: element.handle ? {
        kind: element.handle.kind ?? null,
        backend: element.handle.backend ?? null,
        query: element.handle.query ? {
          pid: element.handle.query.pid ?? null,
          window_id: element.handle.query.window_id ?? null,
          role: element.handle.query.role ?? null,
          title: element.handle.query.title ?? null,
          label: element.handle.query.label ?? null,
          identifier: element.handle.query.identifier ?? null,
        } : null,
      } : null,
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function assertExactTargetAX(capture, metadata, analysis, scale, codePrefix) {
  const targets = capture.elements.filter(
    (element) => element?.identifier === metadata.target_identifier,
  );
  fail(targets.length === 1, `${codePrefix}_TARGET_AX_CARDINALITY`);
  fail(
    !capture.elements.some((element) => elementCarriesIdentifier(element, metadata.sibling_identifier)),
    `${codePrefix}_SIBLING_AX_PRESENT`,
  );
  const target = targets[0];
  fail(target.app_pid === metadata.pid, `${codePrefix}_TARGET_AX_OWNER`);
  fail(target.window_id === metadata.target_window_id, `${codePrefix}_TARGET_AX_WINDOW`);
  fail(target.role === 'AXButton', `${codePrefix}_TARGET_AX_ROLE`);
  fail(target.title === 'Exact Target', `${codePrefix}_TARGET_AX_TITLE`);
  fail(target.enabled === true, `${codePrefix}_TARGET_AX_DISABLED`);

  const bounds = target.bounds;
  fail(
    bounds
      && Number.isInteger(bounds.x)
      && Number.isInteger(bounds.y)
      && Number.isInteger(bounds.width)
      && Number.isInteger(bounds.height)
      && bounds.x >= 0
      && bounds.y >= 0
      && bounds.width > 0
      && bounds.height > 0
      && bounds.x + bounds.width <= analysis.width + 1
      && bounds.y + bounds.height <= analysis.height + 1,
    `${codePrefix}_TARGET_AX_BOUNDS`,
  );
  fail(Math.abs(bounds.width - 150 * scale) <= 2, `${codePrefix}_TARGET_AX_WIDTH`);
  fail(Math.abs(bounds.height - 42 * scale) <= 2, `${codePrefix}_TARGET_AX_HEIGHT`);

  const handle = target.handle;
  const query = handle?.query;
  fail(handle?.kind === 'locator', `${codePrefix}_TARGET_HANDLE_KIND`);
  fail(handle?.backend === 'native_ax', `${codePrefix}_TARGET_HANDLE_BACKEND`);
  fail(query?.pid === metadata.pid, `${codePrefix}_TARGET_HANDLE_OWNER`);
  fail(query?.window_id === metadata.target_window_id, `${codePrefix}_TARGET_HANDLE_WINDOW`);
  fail(query?.role === 'AXButton', `${codePrefix}_TARGET_HANDLE_ROLE`);
  fail(query?.title === 'Exact Target', `${codePrefix}_TARGET_HANDLE_TITLE`);
  fail(query?.identifier === metadata.target_identifier, `${codePrefix}_TARGET_HANDLE_IDENTIFIER`);
  return canonicalAXProjection([target])[0];
}

function isRegularFile(file) {
  try {
    const metadata = fs.lstatSync(file);
    return metadata.isFile() && !metadata.isSymbolicLink();
  } catch {
    return false;
  }
}

function hasExactKeys(value, keys) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys);
}

function fixtureMetadataFromResultBytes(bytes) {
  fail(
    Buffer.isBuffer(bytes)
      && bytes.length >= 1
      && bytes.length <= FIXTURE_RESULT_MAX_BYTES,
    'FIXTURE_METADATA_INVALID',
  );
  const text = bytes.toString('utf8');
  fail(Buffer.from(text, 'utf8').equals(bytes), 'FIXTURE_METADATA_INVALID');
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch {
    throw new ProofError('FIXTURE_METADATA_INVALID');
  }
  if (envelope?.status === 'failed') {
    fail(hasExactKeys(envelope, ['error_code', 'status']), 'FIXTURE_METADATA_INVALID');
    fail(FIXTURE_FAILURE_CODES.has(envelope.error_code), 'FIXTURE_METADATA_INVALID');
    throw new ProofError(envelope.error_code);
  }
  fail(envelope?.status === 'ready', 'FIXTURE_METADATA_INVALID');
  fail(hasExactKeys(envelope, ['metadata', 'status']), 'FIXTURE_METADATA_INVALID');
  const metadata = envelope.metadata;
  fail(hasExactKeys(metadata, FIXTURE_METADATA_KEYS), 'FIXTURE_METADATA_INVALID');
  fail(metadata.schema === FIXTURE_METADATA_SCHEMA, 'FIXTURE_METADATA_INVALID');
  fail(hasExactKeys(metadata.target_bounds, ['height', 'width', 'x', 'y']), 'FIXTURE_METADATA_INVALID');
  fail(hasExactKeys(metadata.sibling_bounds, ['height', 'width', 'x', 'y']), 'FIXTURE_METADATA_INVALID');
  return metadata;
}

function parseFixtureResultFile(file) {
  const noFollow = fs.constants.O_NOFOLLOW;
  fail(Number.isInteger(noFollow) && noFollow !== 0, 'FIXTURE_METADATA_INVALID');
  let descriptor = null;
  try {
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | noFollow);
    const metadata = fs.fstatSync(descriptor);
    fail(
      metadata.isFile()
        && metadata.size >= 1
        && metadata.size <= FIXTURE_RESULT_MAX_BYTES,
      'FIXTURE_METADATA_INVALID',
    );
    const bytes = Buffer.alloc(metadata.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, null);
      fail(count > 0, 'FIXTURE_METADATA_INVALID');
      offset += count;
    }
    const trailingByte = Buffer.alloc(1);
    fail(fs.readSync(descriptor, trailingByte, 0, 1, null) === 0, 'FIXTURE_METADATA_INVALID');
    return fixtureMetadataFromResultBytes(bytes);
  } catch (error) {
    if (error instanceof ProofError) throw error;
    throw new ProofError('FIXTURE_METADATA_INVALID');
  } finally {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch {}
    }
  }
}

function fixtureResultParserSelfTest() {
  const rawSentinel = 'RAW_FIXTURE_RESULT_SENTINEL_MUST_NOT_LEAK';
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-fixture-result-parser-'));
  const resultFile = path.join(temporaryRoot, 'fixture-result.json');
  const metadata = {
    schema: FIXTURE_METADATA_SCHEMA,
    pid: 101,
    target_window_id: 201,
    sibling_window_id: 202,
    target_bounds: { x: 10, y: 20, width: 480, height: 320 },
    sibling_bounds: { x: 80, y: 55, width: 340, height: 250 },
    display_id: 1,
    scale_factor: 2,
    target_identifier: 'target',
    sibling_identifier: 'sibling',
    ownership_token: '0123456789abcdef0123456789abcdef',
    same_process_windows: true,
    layer_zero_windows: true,
    sibling_above_target: true,
    target_center_occluded: true,
    overlap_fraction: 0.5,
  };
  const encode = (value) => Buffer.from(JSON.stringify(value), 'utf8');
  const parseBytes = (bytes) => {
    fs.writeFileSync(resultFile, bytes, { mode: 0o600 });
    return parseFixtureResultFile(resultFile);
  };
  const caughtCode = (bytes) => {
    try {
      parseBytes(bytes);
      return null;
    } catch (error) {
      return error instanceof ProofError ? error.code : 'FIXTURE_PARSER_SELF_TEST_FAILED';
    }
  };
  let receipt;
  try {
    const parsed = parseBytes(encode({ status: 'ready', metadata }));
    fail(parsed.schema === FIXTURE_METADATA_SCHEMA, 'FIXTURE_PARSER_SELF_TEST_FAILED');
    const allowlisted = FIXTURE_FAILURE_CODE_LIST;
    fail(
      allowlisted.every((errorCodeValue) => caughtCode(encode({
        status: 'failed',
        error_code: errorCodeValue,
      })) === errorCodeValue),
      'FIXTURE_PARSER_SELF_TEST_FAILED',
    );
    const boundaryEnvelope = JSON.stringify({
      status: 'failed',
      error_code: 'FIXTURE_HELPER_FAILED',
    });
    const exactBoundary = Buffer.from(
      boundaryEnvelope.padEnd(FIXTURE_RESULT_MAX_BYTES, ' '),
      'utf8',
    );
    const overBoundary = Buffer.from(
      boundaryEnvelope.padEnd(FIXTURE_RESULT_MAX_BYTES + 1, ' '),
      'utf8',
    );
    fail(
      exactBoundary.length === FIXTURE_RESULT_MAX_BYTES
        && caughtCode(exactBoundary) === 'FIXTURE_HELPER_FAILED'
        && overBoundary.length === FIXTURE_RESULT_MAX_BYTES + 1
        && caughtCode(overBoundary) === 'FIXTURE_METADATA_INVALID',
      'FIXTURE_PARSER_SELF_TEST_FAILED',
    );
    const untrusted = [
      Buffer.from(`{${rawSentinel}`, 'utf8'),
      encode({ status: 'failed', error_code: `UNKNOWN_${rawSentinel}` }),
      encode({ status: 'failed', error_code: 'FIXTURE_HELPER_FAILED', raw: rawSentinel }),
    ];
    const observed = untrusted.map(caughtCode);
    fail(
      observed.every((code) => code === 'FIXTURE_METADATA_INVALID'),
      'FIXTURE_PARSER_SELF_TEST_FAILED',
    );
    const symlinkTarget = path.join(temporaryRoot, 'symlink-target.json');
    const symlinkResult = path.join(temporaryRoot, 'symlink-result.json');
    fs.writeFileSync(symlinkTarget, encode({
      status: 'failed',
      error_code: 'FIXTURE_HELPER_FAILED',
    }), { mode: 0o600 });
    fs.symlinkSync(symlinkTarget, symlinkResult);
    let symlinkCode = null;
    try {
      parseFixtureResultFile(symlinkResult);
    } catch (error) {
      symlinkCode = error instanceof ProofError ? error.code : null;
    }
    fail(symlinkCode === 'FIXTURE_METADATA_INVALID', 'FIXTURE_PARSER_SELF_TEST_FAILED');
    fail(!JSON.stringify(observed).includes(rawSentinel), 'FIXTURE_PARSER_SELF_TEST_FAILED');
    receipt = {
      allowlisted_failure_codes: FIXTURE_FAILURE_CODE_LIST,
      exact_byte_boundaries: true,
      fixture_result_parser_self_test: true,
      malformed_unknown_fail_closed: true,
      raw_fixture_output_reflected: false,
      regular_file_enforced: true,
      status: 'passed',
    };
  } finally {
    fs.rmSync(temporaryRoot, { force: true, recursive: true });
  }
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

function removeFile(file) {
  try {
    fs.unlinkSync(file);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function waitForFile(file, timeoutMilliseconds) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (isRegularFile(file) && fs.statSync(file).size > 0) return;
    await sleep(50);
  }
  throw new ProofError('FIXTURE_TIMEOUT');
}

function canonicalExistingPath(file) {
  return fs.realpathSync(file);
}

function assertRuntimeSource(options) {
  const head = runProgram('/usr/bin/git', ['-C', options.root, 'rev-parse', 'HEAD'], { cwd: options.root });
  fail(head.status === 0 && head.stdout.trim() === options.runtimeRevision, 'RUNTIME_REVISION_MISMATCH');

  const runtimePaths = [
    'src',
    'shared',
    'scripts',
    'manifests',
    'tests/exact-focus-channel-native-proof-contract.test.mjs',
    'tests/manual/exact-focus-channel-native-proof.mjs',
    'tests/manual/exact-focus-channel-native-proof.sh',
    'tests/manual/exact-focus-channel-native-proof.swift',
  ];
  const status = runProgram(
    '/usr/bin/git',
    ['-C', options.root, 'status', '--porcelain=v1', '--untracked-files=all', '--', ...runtimePaths],
    { cwd: options.root },
  );
  fail(status.status === 0 && status.stdout.trim() === '', 'RUNTIME_SOURCE_DIRTY');

  const binaryStat = fs.lstatSync(options.aos);
  fail(binaryStat.isFile() && !binaryStat.isSymbolicLink() && (binaryStat.mode & 0o111) !== 0, 'RUNTIME_BINARY_UNAVAILABLE');
  return {
    dev: binaryStat.dev,
    ino: binaryStat.ino,
    mode: binaryStat.mode,
    mtime_ms: binaryStat.mtimeMs,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(options.aos)).digest('hex'),
    size: binaryStat.size,
  };
}

function assertStatusPreconditions(payload) {
  const runtime = payload?.runtime;
  fail(runtime?.mode === 'repo', 'RUNTIME_MODE_MISMATCH');
  fail(runtime?.socket_reachable === true, 'DAEMON_UNAVAILABLE');
  fail(Number.isInteger(runtime?.daemon_pid) && runtime.daemon_pid > 0, 'DAEMON_PID_UNAVAILABLE');
  fail(runtime.serving_pid === runtime.daemon_pid, 'DAEMON_IDENTITY_MISMATCH');
  fail(runtime.owner_pid === runtime.daemon_pid, 'DAEMON_IDENTITY_MISMATCH');
  fail(runtime.ownership_state === 'consistent', 'DAEMON_OWNERSHIP_MISMATCH');
  fail(runtime.ownership_kind === 'launchd_managed', 'DAEMON_OWNERSHIP_MISMATCH');
  fail(runtime.owner_launchd_managed === true, 'DAEMON_OWNERSHIP_MISMATCH');
  fail(Number.isInteger(runtime.service_pid) && runtime.service_pid > 0, 'SERVICE_PID_UNAVAILABLE');
  fail(Number.isFinite(runtime.uptime_seconds) && runtime.uptime_seconds >= 0, 'DAEMON_UPTIME_UNAVAILABLE');
  return runtime;
}

function assertPermissionPreconditions(payload) {
  fail(payload?.permissions?.accessibility === true, 'ACCESSIBILITY_REQUIRED');
  fail(payload?.permissions?.screen_recording === true, 'SCREEN_RECORDING_REQUIRED');
  fail(payload?.screen_capture_direct?.status === 'ready', 'DIRECT_CAPTURE_NOT_READY');
}

function assertBuildAttestation(payload) {
  fail(payload?.schema_version === 1, 'BUILD_ATTESTATION_INVALID');
  fail(payload?.runtime_mode === 'repo', 'BUILD_ATTESTATION_INVALID');
  fail(payload?.status === 'current' && payload?.current === true, 'RUNTIME_BINARY_STALE');
  fail(typeof payload?.source_fingerprint === 'string' && /^[a-f0-9]{64}$/u.test(payload.source_fingerprint), 'BUILD_ATTESTATION_INVALID');
  fail(payload.source_fingerprint === payload.recorded_fingerprint, 'RUNTIME_BINARY_STALE');
  fail(Number.isInteger(payload.source_file_count) && payload.source_file_count > 0, 'BUILD_ATTESTATION_INVALID');
  return payload.source_fingerprint;
}

function assertServiceBinding(options, payload, runtime, binaryIdentity, statusObservedAt) {
  fail(payload?.mode === 'repo', 'SERVICE_MODE_MISMATCH');
  fail(payload?.installed === true && payload?.loaded === true && payload?.running === true, 'SERVICE_UNAVAILABLE');
  fail(payload?.status === 'ok', 'SERVICE_UNAVAILABLE');
  fail(payload?.pid === runtime.service_pid, 'SERVICE_PID_MISMATCH');
  fail(payload?.target_matches_expected === true, 'SERVICE_BINARY_MISMATCH');
  fail(typeof payload.actual_binary_path === 'string' && typeof payload.expected_binary_path === 'string', 'SERVICE_BINARY_MISMATCH');
  const expectedBinary = canonicalExistingPath(options.aos);
  fail(canonicalExistingPath(payload.actual_binary_path) === expectedBinary, 'SERVICE_BINARY_MISMATCH');
  fail(canonicalExistingPath(payload.expected_binary_path) === expectedBinary, 'SERVICE_BINARY_MISMATCH');
  const estimatedDaemonStart = statusObservedAt - runtime.uptime_seconds * 1_000;
  fail(binaryIdentity.mtime_ms + 1_000 <= estimatedDaemonStart, 'SERVING_DAEMON_PREDATES_BINARY');
}

function assertSameDaemon(options, identity) {
  const status = runAOSSuccess(options, ['status', '--json'], 'STATUS_IDENTITY_CHECK_FAILED');
  const runtime = assertStatusPreconditions(status);
  fail(runtime.daemon_pid === identity.daemon_pid, 'SHARED_DAEMON_CHANGED');
  fail(runtime.service_pid === identity.service_pid, 'SHARED_DAEMON_CHANGED');
  const service = runAOSSuccess(
    options,
    ['service', 'status', '--mode', 'repo', '--json'],
    'SERVICE_IDENTITY_CHECK_FAILED',
  );
  fail(service.pid === identity.service_pid, 'SHARED_DAEMON_CHANGED');
  fail(service.target_matches_expected === true, 'SERVICE_BINARY_MISMATCH');
  fail(canonicalExistingPath(service.actual_binary_path) === identity.binary_path, 'SERVICE_BINARY_MISMATCH');
  fail(canonicalExistingPath(service.expected_binary_path) === identity.binary_path, 'SERVICE_BINARY_MISMATCH');
  return status;
}

function strictFocusEntries(options, identity) {
  const before = assertSameDaemon(options, identity);
  const beforeCount = before?.daemon_snapshot?.channels;
  fail(Number.isInteger(beforeCount) && beforeCount >= 0, 'DAEMON_CHANNEL_COUNT_UNAVAILABLE');
  const entries = focusEntries(runAOSSuccess(options, ['focus', 'list'], 'FOCUS_LIST_FAILED'));
  const after = assertSameDaemon(options, identity);
  const afterCount = after?.daemon_snapshot?.channels;
  fail(Number.isInteger(afterCount) && afterCount >= 0, 'DAEMON_CHANNEL_COUNT_UNAVAILABLE');
  const nativeCount = entries.filter((entry) => entry?.kind === 'window').length;
  fail(beforeCount === afterCount && nativeCount === beforeCount, 'FOCUS_LIST_NATIVE_COUNT_MISMATCH');
  return entries;
}

function focusEntry(options, identity, id) {
  const matches = strictFocusEntries(options, identity).filter((entry) => entry?.id === id);
  fail(matches.length <= 1, 'FOCUS_ID_AMBIGUOUS');
  return matches[0] ?? null;
}

async function removeChannelsQuiescent(options, identity, ids) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const entries = strictFocusEntries(options, identity);
    for (const id of ids) {
      if (!entries.some((entry) => entry?.id === id)) continue;
      runAOSSuccess(options, ['focus', 'remove', '--id', id], 'FOCUS_REMOVE_FAILED');
    }
    const first = strictFocusEntries(options, identity);
    if (ids.some((id) => first.some((entry) => entry?.id === id))) continue;
    await sleep(CLEAN_ABSENCE_SETTLE_MS);
    const second = strictFocusEntries(options, identity);
    if (ids.every((id) => !second.some((entry) => entry?.id === id))) return true;
  }
  return false;
}

async function startFixture(options, files) {
  const ownershipToken = crypto.randomBytes(16).toString('hex');
  const child = spawn(options.helper, [
    '--fixture',
    '--metadata', files.metadata,
    '--close-request', files.closeRequest,
    '--close-ack', files.closeAck,
    '--stop-request', files.stopRequest,
    '--cleanup-report', files.cleanupReport,
    '--ownership-token', ownershipToken,
  ], {
    cwd: options.root,
    env: proofEnvironment(),
    stdio: 'ignore',
  });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  }).catch(() => { throw new ProofError('FIXTURE_LAUNCH_FAILED'); });
  fail(Number.isSafeInteger(child.pid) && child.pid > 1, 'FIXTURE_LAUNCH_FAILED');
  fs.writeFileSync(files.fixturePID, `${child.pid} ${ownershipToken}\n`, { mode: 0o600 });
  return { child, ownershipToken };
}

async function waitForChildExit(child, timeoutMilliseconds) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null || !processExists(child.pid)) return true;
    await sleep(25);
  }
  return child.exitCode !== null || child.signalCode !== null || !processExists(child.pid);
}

async function stopFixture(files, fixture) {
  let fixtureWindowsRemoved = false;
  if (fixture?.child && fixture.child.exitCode === null && fixture.child.signalCode === null) {
    fs.writeFileSync(files.stopRequest, 'stop\n', { mode: 0o600 });
    try {
      await waitForFile(files.cleanupReport, 3_000);
      const cleanup = parseJSON(fs.readFileSync(files.cleanupReport, 'utf8'), 'FIXTURE_CLEANUP_INVALID');
      fixtureWindowsRemoved = cleanup.fixture_windows_removed === true;
    } catch {
      fixtureWindowsRemoved = false;
    }
    if (!await waitForChildExit(fixture.child, 1_000)) fixture.child.kill('SIGTERM');
    if (!await waitForChildExit(fixture.child, 750)) fixture.child.kill('SIGKILL');
    await waitForChildExit(fixture.child, 1_000);
  } else if (isRegularFile(files.cleanupReport)) {
    const cleanup = parseJSON(fs.readFileSync(files.cleanupReport, 'utf8'), 'FIXTURE_CLEANUP_INVALID');
    fixtureWindowsRemoved = cleanup.fixture_windows_removed === true;
  }
  const fixtureProcessReaped = !fixture?.child || !processExists(fixture.child.pid);
  return { fixtureWindowsRemoved, fixtureProcessReaped };
}

function armChannelCleanup(files) {
  fs.writeFileSync(files.cleanupArmed, 'armed\n', { mode: 0o600 });
}

function disarmChannelCleanup(files) {
  removeFile(files.cleanupArmed);
}

function verifyCapture(options, metadata, outputFile, codePrefix) {
  const capture = runAOSSuccess(options, [
    'see', 'capture',
    '--channel', options.channel,
    '--xray',
    '--perception',
    '--format', 'png',
    '--out', outputFile,
  ], `${codePrefix}_CAPTURE_FAILED`);
  fail(capture?.status === 'success', `${codePrefix}_CAPTURE_STATUS_INVALID`);
  fail(typeof capture.state_id === 'string' && capture.state_id.length > 0, `${codePrefix}_CAPTURE_STATE_ID_MISSING`);
  fail(capture.warning === undefined, `${codePrefix}_CAPTURE_WARNING_UNEXPECTED`);
  fail(capture.base64 === undefined, 'PIXEL_BYTES_IN_RESPONSE');
  fail(Array.isArray(capture.files) && capture.files.length === 1 && capture.files[0] === outputFile, `${codePrefix}_CAPTURE_FILE_MISMATCH`);
  fail(isRegularFile(outputFile), `${codePrefix}_CAPTURE_ARTIFACT_MISSING`);
  const captureStat = fs.statSync(outputFile);
  fail(captureStat.size > 0 && captureStat.size <= 8 * 1024 * 1024, `${codePrefix}_CAPTURE_ARTIFACT_BOUNDS`);
  const captureDigest = crypto.createHash('sha256').update(fs.readFileSync(outputFile)).digest('hex');

  fail(Array.isArray(capture.surfaces) && capture.surfaces.length === 1, `${codePrefix}_CAPTURE_SURFACE_INVALID`);
  const surface = capture.surfaces[0];
  fail(surface.kind === 'channel' && surface.id === options.channel, `${codePrefix}_CAPTURE_SURFACE_IDENTITY_MISMATCH`);
  fail(surface.window_id === metadata.target_window_id, `${codePrefix}_CAPTURE_SURFACE_WINDOW_MISMATCH`);
  fail(Array.isArray(surface.displays) && surface.displays.length === 1, `${codePrefix}_CAPTURE_DISPLAY_CARDINALITY`);
  fail(Array.isArray(surface.segments) && surface.segments.length === 1, `${codePrefix}_CAPTURE_SEGMENT_CARDINALITY`);
  fail(surface.segments[0].display_id === metadata.display_id, `${codePrefix}_CAPTURE_DISPLAY_ID_MISMATCH`);
  fail(boundsEqual(surface.bounds_global, metadata.target_bounds), `${codePrefix}_CAPTURE_BOUNDS_MISMATCH`);
  fail(Math.abs(Number(surface.capture_scale_factor) - Number(metadata.scale_factor)) < 0.001, `${codePrefix}_CAPTURE_SCALE_MISMATCH`);
  fail(Math.abs(Number(surface.scale_factor) - Number(metadata.scale_factor)) < 0.001, `${codePrefix}_CAPTURE_SCALE_MISMATCH`);
  fail(Math.abs(Number(surface.segments[0].scale_factor) - Number(metadata.scale_factor)) < 0.001, `${codePrefix}_CAPTURE_SCALE_MISMATCH`);

  const analysisResult = runProgram(options.helper, ['--analyze-png', '--path', outputFile], {
    cwd: options.root,
  });
  fail(analysisResult.status === 0, `${codePrefix}_PIXEL_ANALYSIS_FAILED`);
  const analysis = parseJSON(analysisResult.stdout, `${codePrefix}_PIXEL_ANALYSIS_INVALID`);
  fail(analysis.exact_window_pixels_verified === true, `${codePrefix}_PIXEL_FIDELITY_MISMATCH`);
  fail(typeof analysis.decoded_rgba_sha256 === 'string' && /^[a-f0-9]{64}$/u.test(analysis.decoded_rgba_sha256), `${codePrefix}_PIXEL_DIGEST_INVALID`);
  fail(surface.bounds_local?.width === analysis.width && surface.bounds_local?.height === analysis.height, `${codePrefix}_CAPTURE_LOCAL_BOUNDS_MISMATCH`);
  const expectedWidth = Math.round(metadata.target_bounds.width * Number(surface.capture_scale_factor));
  const expectedHeight = Math.round(metadata.target_bounds.height * Number(surface.capture_scale_factor));
  fail(analysis.width === expectedWidth && analysis.height === expectedHeight, `${codePrefix}_CAPTURE_PIXEL_GEOMETRY_MISMATCH`);

  fail(Array.isArray(capture.perceptions) && capture.perceptions.length === 1, `${codePrefix}_CAPTURE_PERCEPTION_MISSING`);
  fail(capture.perceptions[0]?.segments?.[0]?.display_id === metadata.display_id, `${codePrefix}_CAPTURE_PERCEPTION_DISPLAY_MISMATCH`);
  fail(Array.isArray(capture.elements) && capture.elements.length > 0, `${codePrefix}_EXACT_AX_EMPTY`);
  fail(capture.elements.every((element) => element.app_pid === metadata.pid), `${codePrefix}_EXACT_AX_OWNER_MISMATCH`);
  fail(capture.elements.every((element) => element.window_id === metadata.target_window_id), `${codePrefix}_EXACT_AX_WINDOW_MISMATCH`);
  fail(capture.elements.some((element) => elementCarriesIdentifier(element, metadata.target_identifier)), `${codePrefix}_TARGET_AX_IDENTIFIER_MISSING`);
  fail(!capture.elements.some((element) => elementCarriesIdentifier(element, metadata.sibling_identifier)), `${codePrefix}_FOREIGN_AX_IDENTIFIER_PRESENT`);
  const nativeHandles = capture.elements
    .map((element) => element.handle)
    .filter((handle) => handle?.backend === 'native_ax' && handle?.query);
  fail(nativeHandles.length > 0, `${codePrefix}_NATIVE_AX_HANDLES_MISSING`);
  fail(nativeHandles.every((handle) => (
    handle.query.pid === metadata.pid && handle.query.window_id === metadata.target_window_id
  )), `${codePrefix}_NATIVE_AX_HANDLE_SCOPE_MISMATCH`);

  const targetProjection = assertExactTargetAX(
    capture,
    metadata,
    analysis,
    Number(surface.capture_scale_factor),
    codePrefix,
  );
  const axProjection = canonicalAXProjection(capture.elements);

  return { analysis, axProjection, capture, captureDigest, captureStat, targetProjection };
}

function writeDaemonIdentity(file, identity) {
  fs.writeFileSync(file, `${JSON.stringify(identity)}\n`, { mode: 0o600 });
}

function writeJSONFile(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`, { mode: 0o600 });
}

async function cleanupOnly(args) {
  assertEnvironmentScope();
  const options = {
    aos: valueAfter(args, '--aos'),
    root: valueAfter(args, '--root'),
  };
  const channel = valueAfter(args, '--channel');
  const negativeChannel = valueAfter(args, '--negative-channel');
  const identityPath = valueAfter(args, '--identity');
  const unrelatedDigestsPath = valueAfter(args, '--unrelated-digests');
  fail(Object.values(options).every((value) => typeof value === 'string' && value.length > 0), 'INVALID_ARGUMENTS');
  fail(typeof channel === 'string' && typeof negativeChannel === 'string', 'INVALID_ARGUMENTS');
  fail(isRegularFile(identityPath), 'DAEMON_IDENTITY_UNAVAILABLE');
  fail(isRegularFile(unrelatedDigestsPath), 'UNRELATED_CHANNEL_DIGESTS_UNAVAILABLE');
  const identity = parseJSON(fs.readFileSync(identityPath, 'utf8'), 'DAEMON_IDENTITY_INVALID');
  const unrelatedDigestsBefore = parseJSON(
    fs.readFileSync(unrelatedDigestsPath, 'utf8'),
    'UNRELATED_CHANNEL_DIGESTS_INVALID',
  );
  fail(
    Array.isArray(unrelatedDigestsBefore)
      && unrelatedDigestsBefore.every((digest) => /^[a-f0-9]{64}$/u.test(digest)),
    'UNRELATED_CHANNEL_DIGESTS_INVALID',
  );
  const removed = await removeChannelsQuiescent(options, identity, [channel, negativeChannel]);
  fail(removed, 'CHANNEL_CLEANUP_FAILED');
  const unrelatedDigestsAfter = stablePublicChannelDigests(
    strictFocusEntries(options, identity),
    [channel, negativeChannel],
    Buffer.from(process.env[SNAPSHOT_KEY_ENV], 'hex'),
  );
  fail(
    equalJSON(unrelatedDigestsAfter, unrelatedDigestsBefore),
    'UNRELATED_CHANNEL_STABLE_FIELDS_CHANGED',
  );
  assertPermissionPreconditions(
    runAOSSuccess(options, ['permissions', 'check', '--json'], 'PERMISSION_POSTCHECK_FAILED'),
  );
  const postBinaryIdentity = assertRuntimeSource({
    ...options,
    runtimeRevision: identity.repo_revision,
  });
  fail(equalJSON(postBinaryIdentity, identity.binary_identity), 'RUNTIME_BINARY_CHANGED');
  const postFingerprint = assertBuildAttestation(
    runAOSSuccess(options, ['runtime', 'build-attestation', '--json'], 'BUILD_ATTESTATION_FAILED'),
  );
  fail(postFingerprint === identity.build_source_fingerprint, 'BUILD_ATTESTATION_CHANGED');
  assertSameDaemon(options, identity);
  process.stdout.write(`${JSON.stringify({
    channels_absent: true,
    direct_capture_ready_preserved: true,
    runtime_provenance_preserved: true,
    shared_daemon_preserved: true,
    status: 'passed',
    unrelated_channel_stable_fields_preserved: true,
  })}\n`);
}

async function main() {
  assertEnvironmentScope();
  const options = parseArguments(process.argv.slice(2));
  const progress = createProgressReporter(options.progress);
  const negativeChannel = `${options.channel}-negative`;
  const files = {
    metadata: path.join(options.tempRoot, 'fixture.json'),
    fixturePID: path.join(options.tempRoot, 'fixture.pid'),
    closeRequest: path.join(options.tempRoot, 'close-target'),
    closeAck: path.join(options.tempRoot, 'target-closed.json'),
    stopRequest: path.join(options.tempRoot, 'stop-fixture'),
    cleanupReport: path.join(options.tempRoot, 'fixture-cleanup.json'),
    cleanupArmed: path.join(options.tempRoot, 'channel-cleanup-armed'),
    daemonIdentity: path.join(options.tempRoot, 'daemon-identity.json'),
    unrelatedDigests: path.join(options.tempRoot, 'unrelated-channel-digests.json'),
    capture: path.join(options.tempRoot, 'exact-window.png'),
    preservedCapture: path.join(options.tempRoot, 'preserved-window.png'),
    failedCapture: path.join(options.tempRoot, 'missing-window.png'),
  };
  const channelIDs = [options.channel, negativeChannel];
  let fixture = null;
  let fixtureWindowsRemoved = false;
  let fixtureProcessReaped = false;
  let channelRemoved = false;
  let identity = null;
  let sharedDaemonPreserved = false;
  let unrelatedStableFieldsPreserved = false;
  let directCaptureReadyPreserved = false;
  let runtimeProvenancePreserved = false;
  let unrelatedDigestsBefore = null;
  let buildFingerprint = null;
  let binaryIdentity = null;

  try {
    progress.start('runtime_preflight');
    binaryIdentity = assertRuntimeSource(options);
    buildFingerprint = assertBuildAttestation(
      runAOSSuccess(options, ['runtime', 'build-attestation', '--json'], 'BUILD_ATTESTATION_FAILED'),
    );
    const statusBefore = runAOSSuccess(options, ['status', '--json'], 'STATUS_PRECHECK_FAILED');
    const statusObservedAt = Date.now();
    const runtime = assertStatusPreconditions(statusBefore);
    const serviceBefore = runAOSSuccess(
      options,
      ['service', 'status', '--mode', 'repo', '--json'],
      'SERVICE_PRECHECK_FAILED',
    );
    assertServiceBinding(options, serviceBefore, runtime, binaryIdentity, statusObservedAt);
    assertPermissionPreconditions(
      runAOSSuccess(options, ['permissions', 'check', '--json'], 'PERMISSION_PRECHECK_FAILED'),
    );
    identity = {
      binary_path: canonicalExistingPath(options.aos),
      binary_identity: binaryIdentity,
      build_source_fingerprint: buildFingerprint,
      daemon_pid: runtime.daemon_pid,
      repo_revision: options.runtimeRevision,
      service_pid: runtime.service_pid,
    };
    writeDaemonIdentity(files.daemonIdentity, identity);
    progress.complete('runtime_preflight');

    progress.start('unrelated_channel_snapshot');
    const preexistingEntries = strictFocusEntries(options, identity);
    fail(channelIDs.every((id) => !preexistingEntries.some((entry) => entry?.id === id)), 'CHANNEL_ID_COLLISION');
    unrelatedDigestsBefore = stablePublicChannelDigests(
      preexistingEntries,
      channelIDs,
      Buffer.from(process.env[SNAPSHOT_KEY_ENV], 'hex'),
    );
    writeJSONFile(files.unrelatedDigests, unrelatedDigestsBefore);
    armChannelCleanup(files);
    progress.complete('unrelated_channel_snapshot');

    progress.start('fixture_startup');
    fixture = await startFixture(options, files);
    await waitForFile(files.metadata, 5_000);
    const metadata = parseFixtureResultFile(files.metadata);
    fail(metadata.pid === fixture.child.pid && metadata.ownership_token === fixture.ownershipToken, 'FIXTURE_IDENTITY_MISMATCH');
    fail(processExists(fixture.child.pid), 'FIXTURE_PROCESS_MISSING');
    fail(Number.isInteger(metadata.target_window_id) && metadata.target_window_id > 0, 'FIXTURE_WINDOW_ID_INVALID');
    fail(Number.isInteger(metadata.sibling_window_id) && metadata.sibling_window_id > 0, 'FIXTURE_WINDOW_ID_INVALID');
    fail(metadata.target_window_id !== metadata.sibling_window_id, 'FIXTURE_WINDOW_ID_INVALID');
    fail(metadata.same_process_windows === true, 'FIXTURE_PROCESS_MISMATCH');
    fail(metadata.layer_zero_windows === true, 'FIXTURE_LAYER_MISMATCH');
    fail(metadata.sibling_above_target === true, 'FIXTURE_ORDER_MISMATCH');
    fail(metadata.target_center_occluded === true, 'FIXTURE_OCCLUSION_MISSING');
    fail(Number(metadata.overlap_fraction) >= 0.35, 'FIXTURE_OVERLAP_INSUFFICIENT');
    progress.complete('fixture_startup');

    progress.start('sibling_subtree_rejection');
    runAOSFailure(options, [
      'focus', 'create',
      '--id', negativeChannel,
      '--window', String(metadata.target_window_id),
      '--pid', String(metadata.pid),
      '--depth', '15',
      '--subtree-identifier', metadata.sibling_identifier,
    ], 'WINDOW_NOT_FOUND', 'SIBLING_SUBTREE_NOT_REJECTED');
    fail(focusEntry(options, identity, negativeChannel) === null, 'NEGATIVE_CHANNEL_PUBLISHED');
    progress.complete('sibling_subtree_rejection');

    progress.start('target_channel_creation');
    runAOSSuccess(options, [
      'focus', 'create',
      '--id', options.channel,
      '--window', String(metadata.target_window_id),
      '--pid', String(metadata.pid),
      '--depth', '15',
      '--subtree-identifier', metadata.target_identifier,
    ], 'FOCUS_CREATE_FAILED');
    const createdEntry = focusEntry(options, identity, options.channel);
    fail(createdEntry?.kind === 'window', 'FOCUS_CHANNEL_KIND_MISMATCH');
    fail(createdEntry?.window_id === metadata.target_window_id, 'FOCUS_CHANNEL_WINDOW_MISMATCH');
    fail(createdEntry?.elements_count === 1, 'FOCUS_CHANNEL_SUBTREE_CARDINALITY');
    progress.complete('target_channel_creation');

    progress.start('initial_capture');
    const initial = verifyCapture(options, metadata, files.capture, 'INITIAL');
    removeFile(files.capture);
    fail(!fs.existsSync(files.capture), 'CAPTURE_ARTIFACT_CLEANUP_FAILED');
    progress.complete('initial_capture');

    progress.start('rejected_refresh');
    const beforeRejectedRefresh = focusEntry(options, identity, options.channel);
    fail(beforeRejectedRefresh !== null, 'LAST_GOOD_CHANNEL_MISSING');
    const preservedProjection = stableFocusProjection(beforeRejectedRefresh);
    runAOSFailure(options, [
      'focus', 'update',
      '--id', options.channel,
      '--depth', '15',
      '--subtree-identifier', metadata.sibling_identifier,
    ], 'WINDOW_NOT_FOUND', 'SIBLING_REFRESH_NOT_REJECTED');
    const afterRejectedRefresh = focusEntry(options, identity, options.channel);
    fail(afterRejectedRefresh !== null, 'REJECTED_REFRESH_REMOVED_CHANNEL');
    fail(equalJSON(stableFocusProjection(afterRejectedRefresh), preservedProjection), 'REJECTED_REFRESH_CHANGED_PUBLICATION');
    progress.complete('rejected_refresh');

    progress.start('preserved_capture');
    const preserved = verifyCapture(options, metadata, files.preservedCapture, 'PRESERVED');
    fail(
      preserved.analysis.decoded_rgba_sha256 === initial.analysis.decoded_rgba_sha256,
      'REJECTED_REFRESH_CHANGED_DECODED_PIXELS',
    );
    fail(equalJSON(preserved.axProjection, initial.axProjection), 'REJECTED_REFRESH_CHANGED_AX');
    fail(equalJSON(preserved.targetProjection, initial.targetProjection), 'REJECTED_REFRESH_CHANGED_TARGET_AX');
    removeFile(files.preservedCapture);
    fail(!fs.existsSync(files.preservedCapture), 'PRESERVED_CAPTURE_ARTIFACT_CLEANUP_FAILED');
    progress.complete('preserved_capture');

    progress.start('target_close');
    fs.writeFileSync(files.closeRequest, 'close\n', { mode: 0o600 });
    await waitForFile(files.closeAck, 3_000);
    const closeAck = parseJSON(fs.readFileSync(files.closeAck, 'utf8'), 'TARGET_CLOSE_INVALID');
    fail(closeAck.target_window_removed === true, 'TARGET_WINDOW_STILL_PRESENT');
    await sleep(1_250);
    progress.complete('target_close');

    progress.start('missing_target_refresh');
    runAOSFailure(options, [
      'focus', 'update', '--id', options.channel, '--depth', '15',
    ], 'WINDOW_NOT_FOUND', 'MISSING_TARGET_REFRESH_NOT_REJECTED');
    const afterMissingRefresh = focusEntry(options, identity, options.channel);
    fail(afterMissingRefresh !== null, 'MISSING_REFRESH_REMOVED_CHANNEL');
    fail(equalJSON(stableFocusProjection(afterMissingRefresh), preservedProjection), 'MISSING_REFRESH_CHANGED_PUBLICATION');
    progress.complete('missing_target_refresh');

    progress.start('missing_target_capture');
    removeFile(files.failedCapture);
    runAOSFailure(options, [
      'see', 'capture', '--channel', options.channel, '--out', files.failedCapture,
    ], 'WINDOW_NOT_FOUND', 'MISSING_TARGET_CAPTURE_NOT_REJECTED');
    fail(!fs.existsSync(files.failedCapture), 'FAILED_CAPTURE_ARTIFACT_PRESENT');
    progress.complete('missing_target_capture');

    progress.start('channel_cleanup');
    channelRemoved = await removeChannelsQuiescent(options, identity, channelIDs);
    fail(channelRemoved, 'CHANNEL_RESIDUE_PRESENT');
    disarmChannelCleanup(files);
    progress.complete('channel_cleanup');

    progress.start('fixture_cleanup');
    const fixtureCleanup = await stopFixture(files, fixture);
    fixtureWindowsRemoved = fixtureCleanup.fixtureWindowsRemoved;
    fixtureProcessReaped = fixtureCleanup.fixtureProcessReaped;
    fail(fixtureWindowsRemoved, 'FIXTURE_CLEANUP_FAILED');
    fail(fixtureProcessReaped, 'FIXTURE_PROCESS_NOT_REAPED');
    progress.complete('fixture_cleanup');

    progress.start('postflight_attestation');
    const unrelatedDigestsAfter = stablePublicChannelDigests(
      strictFocusEntries(options, identity),
      channelIDs,
      Buffer.from(process.env[SNAPSHOT_KEY_ENV], 'hex'),
    );
    unrelatedStableFieldsPreserved = equalJSON(
      unrelatedDigestsAfter,
      unrelatedDigestsBefore,
    );
    fail(unrelatedStableFieldsPreserved, 'UNRELATED_CHANNEL_STABLE_FIELDS_CHANGED');
    assertPermissionPreconditions(
      runAOSSuccess(options, ['permissions', 'check', '--json'], 'PERMISSION_POSTCHECK_FAILED'),
    );
    directCaptureReadyPreserved = true;
    const postBinaryIdentity = assertRuntimeSource(options);
    fail(equalJSON(postBinaryIdentity, binaryIdentity), 'RUNTIME_BINARY_CHANGED');
    const postFingerprint = assertBuildAttestation(
      runAOSSuccess(options, ['runtime', 'build-attestation', '--json'], 'BUILD_ATTESTATION_FAILED'),
    );
    fail(postFingerprint === buildFingerprint, 'BUILD_ATTESTATION_CHANGED');
    const statusAfter = runAOSSuccess(options, ['status', '--json'], 'STATUS_POSTCHECK_FAILED');
    const statusAfterObservedAt = Date.now();
    const runtimeAfter = assertStatusPreconditions(statusAfter);
    fail(runtimeAfter.daemon_pid === identity.daemon_pid, 'SHARED_DAEMON_CHANGED');
    fail(runtimeAfter.service_pid === identity.service_pid, 'SHARED_DAEMON_CHANGED');
    const serviceAfter = runAOSSuccess(
      options,
      ['service', 'status', '--mode', 'repo', '--json'],
      'SERVICE_POSTCHECK_FAILED',
    );
    assertServiceBinding(options, serviceAfter, runtimeAfter, postBinaryIdentity, statusAfterObservedAt);
    runtimeProvenancePreserved = true;
    sharedDaemonPreserved = true;
    progress.complete('postflight_attestation');

    const summary = {
      status: 'passed',
      command_error_code: null,
      command_admission_ambiguous: false,
      repo_revision: options.runtimeRevision,
      build_source_fingerprint: buildFingerprint,
      daemon_path_start_order_bound: true,
      same_process_windows: true,
      overlap_verified: true,
      overlap_fraction: Number(metadata.overlap_fraction.toFixed(4)),
      sibling_above_target: true,
      sibling_subtree_rejected: true,
      exact_window_pixels_verified: true,
      magenta_fraction: Number(initial.analysis.magenta_fraction.toFixed(4)),
      green_fraction: Number(initial.analysis.green_fraction.toFixed(4)),
      cyan_fraction: Number(initial.analysis.cyan_fraction.toFixed(4)),
      capture_width: initial.analysis.width,
      capture_height: initial.analysis.height,
      capture_byte_count: initial.captureStat.size,
      capture_sha256: initial.captureDigest,
      exact_ax_scope_verified: true,
      ax_element_count: initial.capture.elements.length,
      unique_window_id_count: new Set(initial.capture.elements.map((element) => element.window_id)).size,
      foreign_window_id_count: 0,
      sibling_refresh_rejected: true,
      rejected_refresh_preserved: true,
      rejected_refresh_recaptured: true,
      missing_target_refresh_rejected: true,
      missing_target_capture_rejected: true,
      failed_capture_artifact_absent: true,
      channel_removed: channelRemoved,
      fixture_windows_removed: fixtureWindowsRemoved,
      fixture_process_reaped: fixtureProcessReaped,
      unrelated_channel_stable_fields_preserved: unrelatedStableFieldsPreserved,
      direct_capture_ready_preserved: directCaptureReadyPreserved,
      runtime_provenance_preserved: runtimeProvenancePreserved,
      shared_daemon_preserved: sharedDaemonPreserved,
      microphone_requested: false,
      raw_capture_logged: false,
      pixels_persisted: false,
      cleanup_complete: channelRemoved
        && fixtureWindowsRemoved
        && fixtureProcessReaped
        && unrelatedStableFieldsPreserved
        && directCaptureReadyPreserved
        && runtimeProvenancePreserved
        && sharedDaemonPreserved,
    };
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } catch (error) {
    const admissionAmbiguous = error?.ambiguous === true;
    if (!admissionAmbiguous) {
      removeFile(files.capture);
      removeFile(files.preservedCapture);
      removeFile(files.failedCapture);
    }
    if (!admissionAmbiguous && identity !== null && isRegularFile(files.cleanupArmed)) {
      try {
        channelRemoved = await removeChannelsQuiescent(options, identity, channelIDs);
        if (channelRemoved) disarmChannelCleanup(files);
      } catch {
        channelRemoved = false;
      }
    }
    if (!admissionAmbiguous) {
      const fixtureCleanup = await stopFixture(files, fixture);
      fixtureWindowsRemoved = fixtureCleanup.fixtureWindowsRemoved;
      fixtureProcessReaped = fixtureCleanup.fixtureProcessReaped;
    }
    if (!admissionAmbiguous && identity !== null) {
      try {
        if (Array.isArray(unrelatedDigestsBefore)) {
          const unrelatedDigestsAfter = stablePublicChannelDigests(
            strictFocusEntries(options, identity),
            channelIDs,
            Buffer.from(process.env[SNAPSHOT_KEY_ENV], 'hex'),
          );
          unrelatedStableFieldsPreserved = equalJSON(
            unrelatedDigestsAfter,
            unrelatedDigestsBefore,
          );
        }
        assertPermissionPreconditions(
          runAOSSuccess(options, ['permissions', 'check', '--json'], 'PERMISSION_POSTCHECK_FAILED'),
        );
        directCaptureReadyPreserved = true;
        const postBinaryIdentity = assertRuntimeSource(options);
        const postFingerprint = assertBuildAttestation(
          runAOSSuccess(options, ['runtime', 'build-attestation', '--json'], 'BUILD_ATTESTATION_FAILED'),
        );
        runtimeProvenancePreserved = binaryIdentity !== null
          && equalJSON(postBinaryIdentity, binaryIdentity)
          && postFingerprint === buildFingerprint;
        assertSameDaemon(options, identity);
        sharedDaemonPreserved = true;
      } catch {
        sharedDaemonPreserved = false;
      }
    }
    const summary = {
      status: 'failed',
      ...commandFailureFields(error),
      channel_removed: channelRemoved,
      fixture_windows_removed: fixtureWindowsRemoved,
      fixture_process_reaped: fixtureProcessReaped,
      unrelated_channel_stable_fields_preserved: unrelatedStableFieldsPreserved,
      direct_capture_ready_preserved: directCaptureReadyPreserved,
      runtime_provenance_preserved: runtimeProvenancePreserved,
      shared_daemon_preserved: sharedDaemonPreserved,
      microphone_requested: false,
      raw_capture_logged: false,
      pixels_persisted: fs.existsSync(files.capture)
        || fs.existsSync(files.preservedCapture)
        || fs.existsSync(files.failedCapture),
      cleanup_complete: channelRemoved
        && fixtureWindowsRemoved
        && fixtureProcessReaped
        && unrelatedStableFieldsPreserved
        && directCaptureReadyPreserved
        && runtimeProvenancePreserved
        && sharedDaemonPreserved,
    };
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    process.exitCode = 1;
  }
}

const [mode, ...modeArgs] = process.argv.slice(2);
if (mode === '--supervise-command') {
  process.exitCode = await superviseCommand(modeArgs);
} else if (mode === '--owned-group-wrapper') {
  try {
    process.exitCode = await ownedGroupWrapper(modeArgs);
  } catch {
    process.exitCode = 125;
  }
} else if (mode === '--hang-with-grandchild') {
  await hangWithGrandchild(modeArgs);
} else if (mode === '--exit-with-term-ignoring-descendant') {
  await exitWithTermIgnoringDescendant(modeArgs);
} else if (mode === '--progress-hang-self-test') {
  await progressHangSelfTest(modeArgs);
} else if (mode === '--run-program-timeout-self-test') {
  runProgramTimeoutSelfTest(modeArgs);
} else if (mode === '--command-telemetry-self-test') {
  commandTelemetrySelfTest();
} else if (mode === '--fixture-result-parser-self-test') {
  fixtureResultParserSelfTest();
} else if (mode === '--sanitize-progress-receipt') {
  await sanitizeProgressReceipt(modeArgs);
} else if (mode === '--cleanup-only') {
  try {
    await cleanupOnly(modeArgs);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      code: error instanceof ProofError ? error.code : 'CHANNEL_CLEANUP_FAILED',
      status: 'failed',
    })}\n`);
    process.exitCode = 1;
  }
} else if (mode === '--channel-snapshot-self-test') {
  try {
    channelSnapshotSelfTest();
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      code: error instanceof ProofError ? error.code : 'CHANNEL_SNAPSHOT_SELF_TEST_FAILED',
      status: 'failed',
    })}\n`);
    process.exitCode = 1;
  }
} else {
  await main();
}
