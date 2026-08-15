import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { ManagedSessionError, sessionFail, validateSessionRecord } from './session-model.mjs';
import { managedRuntimeBinding, sessionWorkspace } from './session-store.mjs';
import {
  knownWorkerPending,
  markAcknowledgementUnknown,
} from './session-worker-pending.mjs';
import { runGuardedWorker } from './worker-guardian-client.mjs';
import { retireCompleteGuardianRecord } from './worker-guardian-state.mjs';
import { browserEvidenceQueryScript } from './evidence-query.mjs';
import {
  exactEvalResult,
  validateCleanupEnvelope,
  validateEvidenceResult,
  validateLivenessEnvelope,
  validateOperationEnvelope,
  validatePageIdentityResult,
  validateStartEnvelope,
} from './worker-protocol.mjs';

const START_TIMEOUT_MS = 30_000;
const OPERATION_TIMEOUT_MS = 20_000;
const CLEANUP_TIMEOUT_MS = 30_000;
export const MAX_SCREENSHOT_BYTES = 32 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = MAX_SCREENSHOT_BYTES;
const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;

const PAGE_IDENTITY_SCRIPT = `() => ({schema:'aos.agent-workspace.browser-identity.v1',page_url:String(location.href||'')||null,frame_url:String(location.href||'')||null,top_frame_url:(()=>{try{return String(top.location.href||'')||null}catch{return null}})(),document_title:String(document.title||'')||null})`;
const LIVENESS_SCRIPT = `() => ({status:'alive'})`;

function boundedText(value, maximum) {
  const text = String(value ?? '');
  if (Buffer.byteLength(text) > maximum) sessionFail('BROWSER_SESSION_OUTPUT_LIMIT', 'worker output exceeds limit');
  return text;
}

function exactUrl(value, label) {
  const text = boundedText(value, 4096);
  try {
    const parsed = new URL(text);
    if (!['http:', 'https:', 'data:', 'about:'].includes(parsed.protocol)) throw new Error('protocol');
  } catch {
    sessionFail('BROWSER_SESSION_INVALID', `${label} is invalid`);
  }
  return text;
}

function exactCdpUrl(value) {
  const text = boundedText(value, 4096);
  try {
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(new URL(text).protocol)) throw new Error('protocol');
  } catch {
    sessionFail('BROWSER_SESSION_INVALID', 'CDP URL is invalid');
  }
  return text;
}

function exactInputObject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    sessionFail('BROWSER_SESSION_INVALID', 'managed operation input is invalid');
  }
  return input;
}

export function validateManagedOperationInput(operation, input = {}) {
  const value = exactInputObject(input);
  const keys = Object.keys(value).sort();
  if (operation === 'navigate') {
    if (JSON.stringify(keys) !== JSON.stringify(['url'])) sessionFail('BROWSER_SESSION_INVALID', 'navigation input differs');
    return Object.freeze({ url: exactUrl(value.url, 'navigation URL') });
  }
  if (operation === 'type') {
    if (JSON.stringify(keys) !== JSON.stringify(['text'])) sessionFail('BROWSER_SESSION_INVALID', 'type input differs');
    return Object.freeze({ text: boundedText(value.text, 64 * 1024) });
  }
  if (operation === 'key') {
    if (JSON.stringify(keys) !== JSON.stringify(['key'])) sessionFail('BROWSER_SESSION_INVALID', 'key input differs');
    return Object.freeze({ key: boundedText(value.key, 256) });
  }
  if (operation === 'scroll') {
    if (keys.some((key) => !['delta_x', 'delta_y'].includes(key))) sessionFail('BROWSER_SESSION_INVALID', 'scroll input differs');
    const x = Number(value.delta_x ?? 0);
    const y = Number(value.delta_y ?? 0);
    if (![x, y].every((item) => Number.isSafeInteger(item) && Math.abs(item) <= 1_000_000)) {
      sessionFail('BROWSER_SESSION_INVALID', 'scroll delta is invalid');
    }
    return Object.freeze({ delta_x: x, delta_y: y });
  }
  if (['snapshot', 'screenshot', 'page_identity'].includes(operation)) {
    if (keys.length !== 0) sessionFail('BROWSER_SESSION_INVALID', 'managed read input differs');
    return Object.freeze({});
  }
  sessionFail('BROWSER_SESSION_OPERATION_UNSUPPORTED', 'managed browser operation is unsupported');
}

function sanitizedEnvironment(workspace, env, extensionUserDataDir = null) {
  const keep = {};
  for (const key of ['USER', 'LOGNAME', 'LANG', 'LC_ALL']) {
    if (typeof env[key] === 'string' && env[key].length > 0) keep[key] = env[key];
  }
  const result = {
    ...keep,
    HOME: path.join(workspace, 'home'),
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    CI: '1',
    NO_UPDATE_NOTIFIER: '1',
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
    PLAYWRIGHT_BROWSERS_PATH: path.join(workspace, 'browser-cache'),
    XDG_CACHE_HOME: path.join(workspace, 'browser-cache'),
    TMPDIR: path.join(workspace, 'temp'),
    PWTEST_DAEMON_SESSION_DIR: path.join(workspace, 'daemon'),
    PWTEST_SOCKETS_DIR: path.join(workspace, 'sockets'),
    PWTEST_SERVER_REGISTRY: path.join(workspace, 'server-registry'),
    PWTEST_CLI_GLOBAL_CONFIG: path.join(workspace, 'global-config', 'config.json'),
    PLAYWRIGHT_MCP_OUTPUT_DIR: path.join(workspace, 'output'),
  };
  if (extensionUserDataDir !== null) result.PWTEST_EXTENSION_USER_DATA_DIR = extensionUserDataDir;
  return Object.freeze(result);
}

function artifactPath(workspace, suffix) {
  return path.join(workspace, 'output', `operation-${crypto.randomBytes(12).toString('hex')}.${suffix}`);
}

function operationPlan(record, operation, input, workspace) {
  const prefix = [`-s=${record.upstream_session_id}`];
  switch (operation) {
    case 'start': {
      if (record.ownership === 'attached') {
        if (record.attach_kind === 'extension') return { argv: [...prefix, 'attach', '--extension=chrome', '--json'], timeoutMs: START_TIMEOUT_MS };
        return { argv: [...prefix, 'attach', `--cdp=${exactCdpUrl(input?.cdp_url)}`, '--json'], timeoutMs: START_TIMEOUT_MS };
      }
      const argv = [...prefix, 'open', '--browser=chrome'];
      if (!record.headless) argv.push('--headed');
      if (record.persistent) argv.push('--persistent');
      if (input?.url !== undefined) argv.push(exactUrl(input.url, 'initial URL'));
      argv.push('--json');
      return { argv, timeoutMs: START_TIMEOUT_MS };
    }
    case 'cleanup':
      return { argv: [...prefix, record.cleanup_operation, '--json'], timeoutMs: CLEANUP_TIMEOUT_MS };
    case 'liveness':
      return { argv: [...prefix, 'eval', LIVENESS_SCRIPT, '--json'], timeoutMs: OPERATION_TIMEOUT_MS, resultKind: 'json' };
    case 'navigate':
      return { argv: [...prefix, 'goto', input.url, '--json'], timeoutMs: OPERATION_TIMEOUT_MS };
    case 'type':
      return { argv: [...prefix, 'type', input.text, '--json'], timeoutMs: OPERATION_TIMEOUT_MS };
    case 'key':
      return { argv: [...prefix, 'press', input.key, '--json'], timeoutMs: OPERATION_TIMEOUT_MS };
    case 'scroll': {
      const x = input.delta_x;
      const y = input.delta_y;
      return { argv: [...prefix, 'mousewheel', String(x), String(y), '--json'], timeoutMs: OPERATION_TIMEOUT_MS };
    }
    case 'snapshot': {
      const artifact = artifactPath(workspace, 'md');
      return { argv: [...prefix, 'snapshot', `--filename=${artifact}`, '--json'], timeoutMs: OPERATION_TIMEOUT_MS, artifact, artifactKind: 'text' };
    }
    case 'screenshot': {
      const artifact = artifactPath(workspace, 'png');
      return { argv: [...prefix, 'screenshot', `--filename=${artifact}`, '--json'], timeoutMs: OPERATION_TIMEOUT_MS, artifact, artifactKind: 'bytes' };
    }
    case 'page_identity':
      return { argv: [...prefix, 'eval', PAGE_IDENTITY_SCRIPT, '--json'], timeoutMs: OPERATION_TIMEOUT_MS, resultKind: 'json' };
    case 'evidence_query':
      return { argv: [...prefix, 'eval', browserEvidenceQueryScript(input), '--json'], timeoutMs: OPERATION_TIMEOUT_MS, resultKind: 'json' };
    default:
      sessionFail('BROWSER_SESSION_OPERATION_UNSUPPORTED', 'managed browser operation is unsupported');
  }
}

function nestedIsError(value, depth = 0) {
  if (depth > 16 || !value || typeof value !== 'object') return false;
  if (value.isError === true) return true;
  return Object.values(value).some((item) => nestedIsError(item, depth + 1));
}

function parseOneJSON(bytes) {
  let value;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim();
    if (!text) throw new Error('empty');
    value = JSON.parse(text);
  } catch {
    sessionFail('BROWSER_SESSION_OUTPUT_INVALID', 'worker output is not one JSON value');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) || nestedIsError(value)) {
    sessionFail('BROWSER_SESSION_WORKER_FAILED', 'worker JSON reports failure');
  }
  return value;
}

function workerProcessFailure(code, message, authorityPossible) {
  const error = new ManagedSessionError(code, message);
  error.authority_possible = authorityPossible;
  throw error;
}

async function acknowledgeAndRetire(store, lockOwner, result, value, options, realGuardian) {
  let acknowledgement;
  try {
    acknowledgement = await options.acknowledge(value);
  } catch (error) {
    throw markAcknowledgementUnknown(error);
  }
  if (!acknowledgement || typeof acknowledgement !== 'object') {
    throw markAcknowledgementUnknown(new ManagedSessionError(
      'COMPANION_STORE_BLOCKED',
      'worker acknowledgement result is absent',
    ));
  }
  if (acknowledgement.recovery_pending === true) {
    throw knownWorkerPending(value, acknowledgement, 'acknowledgement');
  }
  try {
    options.hooks?.afterWorkerAcknowledgement?.(value);
    if (realGuardian) {
      if (!result.guardianCompletion) {
        sessionFail('COMPANION_STORE_BLOCKED', 'guardian completion witness is absent');
      }
      retireCompleteGuardianRecord(
        store, lockOwner, result.guardianCompletion,
        options.hooks?.guardianRetirementHooks,
      );
    }
  } catch (error) {
    throw knownWorkerPending(value, acknowledgement, 'guardian_retirement');
  }
  return Object.freeze(value);
}

function readArtifact(file, kind) {
  let descriptor;
  let opened;
  try {
    const before = fs.lstatSync(file);
    const uid = typeof process.getuid === 'function' ? process.getuid() : null;
    if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1 || before.size <= 0 || before.size > MAX_ARTIFACT_BYTES || (before.mode & 0o777) !== 0o600 || (uid !== null && before.uid !== uid)) throw new Error('metadata');
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | NOFOLLOW | fs.constants.O_NONBLOCK);
    opened = fs.fstatSync(descriptor);
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size || opened.nlink !== 1) throw new Error('identity');
    const bytes = fs.readFileSync(descriptor);
    const after = fs.lstatSync(file);
    if (bytes.length !== opened.size || after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size || after.nlink !== 1 || !after.isFile()) throw new Error('short read');
    return kind === 'text' ? new TextDecoder('utf-8', { fatal: true }).decode(bytes) : bytes;
  } catch {
    sessionFail('BROWSER_SESSION_OUTPUT_INVALID', 'worker artifact is invalid');
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try {
      const current = fs.lstatSync(file);
      if (opened && current.dev === opened.dev && current.ino === opened.ino && current.isFile() && current.nlink === 1) fs.unlinkSync(file);
    } catch {}
  }
}

export async function runManagedWorker(store, record, operation, input = {}, options = {}) {
  const session = validateSessionRecord(record);
  const workspace = sessionWorkspace(store, session);
  const runtime = managedRuntimeBinding(store, session);
  const validatedInput = ['start', 'cleanup', 'liveness', 'evidence_query'].includes(operation)
    ? input
    : validateManagedOperationInput(operation, input);
  const plan = operationPlan(session, operation, validatedInput, workspace);
  const run = options.run ?? runGuardedWorker;
  const realGuardian = run === runGuardedWorker;
  if (realGuardian && !options.lockOwner) {
    sessionFail('COMPANION_STORE_BLOCKED', 'managed worker lock binding is absent');
  }
  if (typeof options.acknowledge !== 'function') {
    sessionFail('COMPANION_STORE_BLOCKED', 'managed worker acknowledgement is absent');
  }
  const extensionUserDataDir = operation === 'start' && session.attach_kind === 'extension'
    ? options.extensionUserDataDir ?? null
    : null;
  if (operation === 'start' && session.attach_kind === 'extension' && extensionUserDataDir === null) {
    sessionFail('BROWSER_SESSION_EXTENSION_BLOCKED', 'extension profile binding is absent');
  }
  const guardianNonce = options.guardianNonce ?? session.operation_nonce;
  if (!/^[a-f0-9]{32}$/u.test(guardianNonce ?? '')) {
    sessionFail('COMPANION_STORE_BLOCKED', 'managed worker operation binding is absent');
  }
  const result = await run({
    operation, entrypoint: runtime.entrypoint, argv: plan.argv, cwd: workspace,
    store, session, lockOwner: options.lockOwner,
    env: sanitizedEnvironment(workspace, options.env ?? process.env, extensionUserDataDir),
    timeoutMs: plan.timeoutMs,
    maxOutputBytes: runtime.max_captured_output_bytes,
    guardianNonce,
    spawn: options.spawn, spawnGuardian: options.spawnGuardian,
    beforeGuardianRequest: options.hooks?.beforeGuardianRequest,
    beforeGuardianExecute: options.hooks?.beforeGuardianExecute,
    afterGuardianSpawn: options.hooks?.afterGuardianSpawn,
    afterGuardianReservation: options.hooks?.afterGuardianReservation,
    guardianPublicationHooks: options.hooks?.guardianPublicationHooks,
  });
  const rawStdout = Buffer.isBuffer(result?.stdout) ? result.stdout : Buffer.from(String(result?.stdout ?? ''));
  const rawStderr = Buffer.isBuffer(result?.stderr) ? result.stderr : Buffer.from(String(result?.stderr ?? ''));
  if (rawStdout.length + rawStderr.length > runtime.max_captured_output_bytes) {
    workerProcessFailure('BROWSER_SESSION_OUTPUT_LIMIT', 'worker output exceeds limit', result?.spawned !== false);
  }
  if (result?.exceeded) workerProcessFailure('BROWSER_SESSION_OUTPUT_LIMIT', 'worker output exceeds limit', result?.spawned !== false);
  if (result?.timedOut) workerProcessFailure('BROWSER_SESSION_WORKER_TIMEOUT', 'worker deadline expired', result?.spawned !== false);
  if (!result?.spawned) workerProcessFailure(
    'BROWSER_SESSION_WORKER_FAILED', 'worker process failed',
    result?.authorityPossible === true,
  );
  if (result?.error || result?.exitCode !== 0) workerProcessFailure('BROWSER_SESSION_WORKER_FAILED', 'worker process failed', true);
  const json = parseOneJSON(rawStdout);
  let value;
  if (operation === 'start') {
    validateStartEnvelope(json, session, input);
    value = { json };
  } else if (operation === 'cleanup') {
    const cleanup = validateCleanupEnvelope(json, session).state;
    if (cleanup === 'missing') {
      workerProcessFailure('BROWSER_SESSION_WORKER_FAILED', 'managed cleanup acknowledgement is missing', true);
    }
    value = { json, cleanup };
  } else if (plan.artifact) {
    validateOperationEnvelope(json, operation, plan.artifact);
    value = { json, artifact: readArtifact(plan.artifact, plan.artifactKind) };
  } else if (operation === 'liveness') {
    value = { json, result: validateLivenessEnvelope(json) };
  } else if (operation === 'page_identity') {
    value = { json, result: validatePageIdentityResult(exactEvalResult(json)) };
  } else if (operation === 'evidence_query') {
    value = { json, result: validateEvidenceResult(exactEvalResult(json), input) };
  } else if (plan.resultKind === 'json') {
    value = { json, result: exactEvalResult(json) };
  } else {
    validateOperationEnvelope(json, operation);
    value = { json };
  }
  return acknowledgeAndRetire(store, options.lockOwner, result, value, options, realGuardian);
}

export function runnerEnvironmentForTest(workspace, env = process.env, extensionUserDataDir = null) {
  return sanitizedEnvironment(workspace, env, extensionUserDataDir);
}
