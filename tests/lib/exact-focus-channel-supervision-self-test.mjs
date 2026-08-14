import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRunProgram } from './exact-focus-channel-command-runner.mjs';
import {
  PROGRESS_SCHEMA,
  monotonicElapsedMilliseconds,
  writeProgressReceipt,
} from './exact-focus-channel-proof-contract.mjs';
import {
  PROCESS_TREE_MAX_BYTES,
  PROCESS_TREE_NONCE_ENV,
  PROCESS_TREE_SCHEMA,
  RUN_PROGRAM_MAX_BYTES,
  RUN_PROGRAM_NONCE_ENV,
  RUN_PROGRAM_SCHEMA,
  integer,
  normalizedProcessStatus,
  payloadOutcomeFromProcessResult,
  processExists,
  readReadiness,
  runProgramTimeoutInitializationError,
  valueAfter,
  writeDurableAtomicFile,
  writeDurableExclusiveFile,
} from './exact-focus-channel-supervision-protocol.mjs';

const SELF_TEST_PATH = fileURLToPath(import.meta.url);
const NO_AUTOSTART_ENVIRONMENT = Object.freeze({
  AOS_ALLOW_DAEMON_AUTOSTART: '0',
  AOS_DISABLE_DAEMON_AUTOSTART: '1',
});

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

class SupervisionError extends Error {
  constructor(code, { ambiguous = false } = {}) {
    super(code);
    this.code = code;
    this.ambiguous = ambiguous;
  }
}

function fail(condition, code) {
  if (!condition) throw new SupervisionError(code);
}

const runProgramForSelfTest = createRunProgram({
  ProofError: SupervisionError,
  commandClassTimeouts: Object.freeze({ timeoutSelfTest: 2_000 }),
  proofEnvironment: () => {
    const environment = { ...process.env, ...NO_AUTOSTART_ENVIRONMENT };
    delete environment.AOS_EXACT_FOCUS_CHANNEL_SNAPSHOT_KEY;
    delete environment.AOS_EXACT_FOCUS_CHANNEL_FIXTURE_GEOMETRY_KEY;
    return environment;
  },
});

async function runProgramTimeoutChildProcess(args, fail) {
  const readinessFile = valueAfter(args, '--readiness');
  const nonce = process.env[RUN_PROGRAM_NONCE_ENV];
  delete process.env[RUN_PROGRAM_NONCE_ENV];
  fail(typeof readinessFile === 'string' && readinessFile.length > 0, 'INVALID_ARGUMENTS');
  fail(typeof nonce === 'string' && /^[a-f0-9]{64}$/u.test(nonce), 'INVALID_ARGUMENTS');
  const child = spawn('/bin/zsh', ['-c', 'trap "" TERM; exec /bin/sleep 30'], { stdio: 'ignore' });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  fail(Number.isSafeInteger(child.pid) && child.pid > 1 && processExists(child.pid), 'INVALID_ARGUMENTS');
  writeDurableAtomicFile(readinessFile, `${JSON.stringify({
    nonce, pid: child.pid, schema: RUN_PROGRAM_SCHEMA,
  })}\n`, nonce);
  child.unref();
  process.stdout.write('RAW_PROGRESS_SENTINEL_MUST_NOT_LEAK\n');
  process.stderr.write('RAW_PROGRESS_SENTINEL_MUST_NOT_LEAK\n');
  await new Promise((resolve) => setTimeout(resolve, 30_000));
}

async function hangWithGrandchild(args) {
  const readinessFile = valueAfter(args, '--readiness');
  const withholdReadiness = args.includes('--withhold-readiness');
  const nonce = process.env[PROCESS_TREE_NONCE_ENV];
  delete process.env[PROCESS_TREE_NONCE_ENV];
  fail(typeof readinessFile === 'string' && readinessFile.length > 0, 'INVALID_ARGUMENTS');
  fail(typeof nonce === 'string' && /^[a-f0-9]{64}$/u.test(nonce), 'INVALID_ARGUMENTS');
  const child = spawn('/bin/zsh', ['-c', 'trap "" TERM; exec /bin/sleep 30'], { stdio: 'ignore' });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  fail(Number.isSafeInteger(child.pid) && child.pid > 1 && processExists(child.pid), 'INVALID_ARGUMENTS');
  if (!withholdReadiness) writeDurableAtomicFile(readinessFile, `${JSON.stringify({
    nonce, pid: child.pid, schema: PROCESS_TREE_SCHEMA,
  })}\n`, nonce);
  process.on('SIGTERM', () => {});
  await new Promise((resolve) => setTimeout(resolve, 30_000));
}

async function basicTimeoutSelfTest(args) {
  const readinessFile = valueAfter(args, '--readiness');
  const exitStatusValue = valueAfter(args, '--self-test-exit-status');
  const exitStatus = exitStatusValue === null ? 0 : integer(exitStatusValue);
  const exitDelayValue = valueAfter(args, '--self-test-exit-after-readiness-ms');
  const exitDelayMilliseconds = exitDelayValue === null ? 0 : integer(exitDelayValue);
  const useDefaultSIGTERM = args.includes('--self-test-default-sigterm');
  const nonce = process.env[PROCESS_TREE_NONCE_ENV];
  delete process.env[PROCESS_TREE_NONCE_ENV];
  fail(typeof readinessFile === 'string' && readinessFile.length > 0, 'INVALID_ARGUMENTS');
  fail(typeof nonce === 'string' && /^[a-f0-9]{64}$/u.test(nonce), 'INVALID_ARGUMENTS');
  fail(exitStatus === 0 || exitStatus === 1, 'INVALID_ARGUMENTS');
  fail(exitDelayMilliseconds === 0
    || (Number.isSafeInteger(exitDelayMilliseconds)
      && exitDelayMilliseconds >= 50 && exitDelayMilliseconds <= 1_000),
  'INVALID_ARGUMENTS');
  fail(exitStatus === 0 || exitDelayMilliseconds === 0, 'INVALID_ARGUMENTS');
  fail(processExists(process.pid), 'INVALID_ARGUMENTS');
  if (!useDefaultSIGTERM) process.on('SIGTERM', () => {});
  writeDurableAtomicFile(readinessFile, `${JSON.stringify({
    nonce, pid: process.pid, schema: PROCESS_TREE_SCHEMA,
  })}\n`, nonce);
  if (args.includes('--self-test-stderr-sentinel')) {
    process.stderr.write('PAYLOAD_STDERR_SENTINEL\n');
  }
  if (exitStatus !== 0) {
    await sleep(100);
    return exitStatus;
  }
  if (exitDelayMilliseconds > 0) {
    await sleep(exitDelayMilliseconds);
    return 0;
  }
  await sleep(30_000);
  return 0;
}

async function exitWithTermIgnoringDescendant(args) {
  const pidFile = valueAfter(args, '--pid-file');
  const termReceiptFile = valueAfter(args, '--term-receipt');
  fail(typeof pidFile === 'string' && pidFile.length > 0, 'INVALID_ARGUMENTS');
  fail(typeof termReceiptFile === 'string' && termReceiptFile.length > 0, 'INVALID_ARGUMENTS');
  const child = spawn(process.execPath, [SELF_TEST_PATH,
    '--term-holding-descendant', '--readiness', pidFile, '--term-receipt', termReceiptFile,
  ], { stdio: 'ignore' });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline && !fs.existsSync(pidFile)) await sleep(10);
  fail(fs.readFileSync(pidFile, 'utf8') === `${child.pid}\n`, 'INVALID_ARGUMENTS');
  child.unref();
}

async function termHoldingDescendant(args) {
  const readinessFile = valueAfter(args, '--readiness');
  const termReceiptFile = valueAfter(args, '--term-receipt');
  const heartbeatRequestFile = valueAfter(args, '--heartbeat-request');
  const heartbeatAckFile = valueAfter(args, '--heartbeat-ack');
  fail(typeof readinessFile === 'string' && readinessFile.length > 0, 'INVALID_ARGUMENTS');
  fail(typeof termReceiptFile === 'string' && termReceiptFile.length > 0, 'INVALID_ARGUMENTS');
  fail((heartbeatRequestFile === null && heartbeatAckFile === null)
    || (typeof heartbeatRequestFile === 'string' && heartbeatRequestFile.length > 0
      && typeof heartbeatAckFile === 'string' && heartbeatAckFile.length > 0),
  'INVALID_ARGUMENTS');
  let termObserved = false;
  process.on('SIGTERM', () => {
    if (termObserved) return;
    termObserved = true;
    try { writeDurableExclusiveFile(termReceiptFile, 'term-held\n', 'term-held'); } catch {}
  });
  writeDurableExclusiveFile(readinessFile, `${process.pid}\n`, 'term-ready');
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (heartbeatRequestFile !== null && fs.existsSync(heartbeatRequestFile)
        && !fs.existsSync(heartbeatAckFile)) {
      writeDurableExclusiveFile(heartbeatAckFile, 'alive\n', 'heartbeat-ack');
    }
    await sleep(25);
  }
}

async function progressHangSelfTest(args) {
  const progressFile = valueAfter(args, '--progress');
  const pidFile = valueAfter(args, '--pid-file');
  const readinessFile = valueAfter(args, '--readiness');
  const nonce = process.env[PROCESS_TREE_NONCE_ENV];
  delete process.env[PROCESS_TREE_NONCE_ENV];
  fail(typeof progressFile === 'string' && progressFile.length > 0, 'INVALID_ARGUMENTS');
  fail(typeof pidFile === 'string' && pidFile.length > 0, 'INVALID_ARGUMENTS');
  fail(typeof readinessFile === 'string' && readinessFile.length > 0, 'INVALID_ARGUMENTS');
  fail(typeof nonce === 'string' && /^[a-f0-9]{64}$/u.test(nonce), 'INVALID_ARGUMENTS');
  fail(path.dirname(progressFile) === path.dirname(pidFile)
    && path.dirname(pidFile) === path.dirname(readinessFile), 'INVALID_ARGUMENTS');
  const startedAt = process.hrtime.bigint();
  writeProgressReceipt(progressFile, {
    schema: PROGRESS_SCHEMA,
    ordinal: 11,
    last_started_stage: 'initial_capture',
    last_completed_stage: 'target_channel_creation',
    elapsed_ms: monotonicElapsedMilliseconds(startedAt),
  });
  const child = spawn('/bin/zsh', ['-c', 'trap "" TERM; exec /bin/sleep 30'], { stdio: 'ignore' });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  fail(Number.isSafeInteger(child.pid) && child.pid > 1 && processExists(child.pid), 'INVALID_ARGUMENTS');
  writeDurableAtomicFile(pidFile, `${child.pid}\n`, 'progress-descendant');
  process.on('SIGTERM', () => {});
  writeDurableAtomicFile(readinessFile, `${JSON.stringify({
    nonce, pid: child.pid, schema: PROCESS_TREE_SCHEMA,
  })}\n`, nonce);
  await sleep(30_000);
}

async function runProgramTimeoutChild(args) {
  return runProgramTimeoutChildProcess(args, fail);
}

function emitRunProgramTimeoutFailure(errorCode, descendantLive = false) {
  process.stdout.write(`${JSON.stringify({
    admission_ambiguous: true,
    ...(descendantLive ? { descendant_live_before_outer_reap: true } : {}),
    error_code: errorCode,
    status: 'failed',
  })}\n`);
  return 1;
}

function runProgramTimeoutSelfTest(args) {
  const readinessFile = valueAfter(args, '--readiness');
  fail(typeof readinessFile === 'string' && readinessFile.length > 0, 'INVALID_ARGUMENTS');
  const nonce = crypto.randomBytes(32).toString('hex');
  process.env[RUN_PROGRAM_NONCE_ENV] = nonce;
  let caught = null;
  try {
    runProgramForSelfTest(process.execPath, [SELF_TEST_PATH, '--run-program-timeout-child', '--readiness', readinessFile], {
      commandClass: 'timeoutSelfTest',
    });
  } catch (error) {
    caught = error;
  } finally {
    delete process.env[RUN_PROGRAM_NONCE_ENV];
  }
  const readiness = readReadiness(
    readinessFile, nonce, RUN_PROGRAM_SCHEMA, RUN_PROGRAM_MAX_BYTES, false, processExists,
  );
  const initializationError = runProgramTimeoutInitializationError(readiness, processExists);
  if (initializationError !== null) return emitRunProgramTimeoutFailure(initializationError);
  if (!(caught instanceof SupervisionError
      && caught.code === 'COMMAND_TIMEOUT' && caught.ambiguous === true)) {
    return emitRunProgramTimeoutFailure('COMMAND_TIMEOUT_SELF_TEST_FAILED', true);
  }
  return emitRunProgramTimeoutFailure('COMMAND_TIMEOUT', true);
}

function runProgramTimeoutReadinessSelfTest() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-run-program-readiness-'));
  const readinessFile = path.join(temporaryRoot, 'readiness.json');
  const nonce = 'ab'.repeat(32);
  try {
    const missing = readReadiness(
      readinessFile, nonce, RUN_PROGRAM_SCHEMA, RUN_PROGRAM_MAX_BYTES, false, processExists,
    );
    fs.writeFileSync(readinessFile, '{"schema":"RAW_RUN_PROGRAM_READINESS_SENTINEL_MUST_NOT_LEAK"}\n', { mode: 0o600 });
    const malformed = readReadiness(
      readinessFile, nonce, RUN_PROGRAM_SCHEMA, RUN_PROGRAM_MAX_BYTES, false, processExists,
    );
    writeDurableAtomicFile(readinessFile, `${JSON.stringify({
      nonce, pid: process.pid, schema: RUN_PROGRAM_SCHEMA,
    })}\n`, 'valid-readiness');
    const valid = readReadiness(
      readinessFile, nonce, RUN_PROGRAM_SCHEMA, RUN_PROGRAM_MAX_BYTES, false, processExists,
    );
    const missingCode = runProgramTimeoutInitializationError(missing, processExists);
    const malformedCode = runProgramTimeoutInitializationError(malformed, processExists);
    fail(missingCode === 'RUN_PROGRAM_TIMEOUT_INITIALIZATION_FAILED'
      && malformedCode === 'RUN_PROGRAM_TIMEOUT_INITIALIZATION_FAILED'
      && valid?.pid === process.pid
      && runProgramTimeoutInitializationError(valid, processExists) === null,
    'RUN_PROGRAM_TIMEOUT_READINESS_SELF_TEST_FAILED');
    process.stdout.write(`${JSON.stringify({
      malformed_readiness_error_code: malformedCode,
      missing_readiness_error_code: missingCode,
      raw_readiness_reflected: false,
      status: 'passed',
    })}\n`);
  } finally {
    fs.rmSync(temporaryRoot, { force: true, recursive: true });
  }
}

function processOutcomeSelfTest() {
  const success = payloadOutcomeFromProcessResult({ code: 0, signal: null, error: null });
  const abnormal = payloadOutcomeFromProcessResult({ code: null, signal: null, error: null });
  const exitOne = payloadOutcomeFromProcessResult({ code: 1, signal: null, error: null });
  fail(normalizedProcessStatus({ code: null, signal: null, error: null }) === 125
    && success?.detail === 'payload_success'
    && success.status === 0
    && abnormal?.detail === 'payload_spawn_or_init_failure'
    && abnormal.status === 125
    && exitOne?.detail === 'payload_nonzero_exit'
    && exitOne.status === 1,
  'PROCESS_OUTCOME_SELF_TEST_FAILED');
  process.stdout.write(`${JSON.stringify({
    abnormal_null_status: abnormal.status, payload_success_status: success.status,
    payload_exit_status: exitOne.status,
    status: 'passed',
  })}\n`);
}

async function payloadAdmissionMarker(args) {
  const markerFile = valueAfter(args, '--marker');
  fail(typeof markerFile === 'string' && markerFile.length > 0, 'INVALID_ARGUMENTS');
  writeDurableExclusiveFile(markerFile, 'admitted\n', 'payload-admitted');
  await sleep(30_000);
}

async function runCLI(mode, args) {
  if (mode === '--hang-with-grandchild') { await hangWithGrandchild(args); return 0; }
  if (mode === '--basic-timeout-self-test') return basicTimeoutSelfTest(args);
  if (mode === '--exit-with-term-ignoring-descendant') {
    await exitWithTermIgnoringDescendant(args);
    return 0;
  }
  if (mode === '--term-holding-descendant') { await termHoldingDescendant(args); return 0; }
  if (mode === '--progress-hang-self-test') { await progressHangSelfTest(args); return 0; }
  if (mode === '--run-program-timeout-child') { await runProgramTimeoutChild(args); return 0; }
  if (mode === '--run-program-timeout-self-test') return runProgramTimeoutSelfTest(args);
  if (mode === '--run-program-timeout-readiness-self-test') {
    runProgramTimeoutReadinessSelfTest();
    return 0;
  }
  if (mode === '--process-outcome-self-test') {
    processOutcomeSelfTest();
    return 0;
  }
  if (mode === '--self-test-payload-admission-marker') {
    await payloadAdmissionMarker(args);
    return 0;
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
