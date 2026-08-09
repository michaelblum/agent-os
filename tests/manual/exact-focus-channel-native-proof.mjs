#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
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

class ProofError extends Error {
  constructor(code, { ambiguous = false } = {}) {
    super(code);
    this.code = code;
    this.ambiguous = ambiguous;
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
    runtimeRevision: valueAfter(args, '--runtime-source-revision'),
  };
  fail(Object.values(options).every((value) => typeof value === 'string' && value.length > 0), 'INVALID_ARGUMENTS');
  return options;
}

function parseJSON(text, code = 'INVALID_JSON') {
  try {
    return JSON.parse(String(text).trim());
  } catch {
    throw new ProofError(code);
  }
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

async function superviseCommand(args) {
  const separator = args.indexOf('--');
  const ownerPID = parseInteger(valueAfter(args.slice(0, separator), '--owner-pid'));
  const groupPIDFile = valueAfter(args.slice(0, separator), '--group-pid-file');
  const timeoutMilliseconds = parseInteger(valueAfter(args.slice(0, separator), '--timeout-ms'));
  fail(separator >= 0 && separator + 1 < args.length, 'SUPERVISOR_ARGUMENTS_INVALID');
  fail(Number.isSafeInteger(ownerPID) && ownerPID > 1, 'SUPERVISOR_ARGUMENTS_INVALID');
  fail(typeof groupPIDFile === 'string' && groupPIDFile.length > 0, 'SUPERVISOR_ARGUMENTS_INVALID');
  fail(Number.isSafeInteger(timeoutMilliseconds) && timeoutMilliseconds >= 1, 'SUPERVISOR_ARGUMENTS_INVALID');

  const ownershipToken = crypto.randomBytes(16).toString('hex');
  const command = args.slice(separator + 1);
  const child = spawn(process.execPath, [
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
  let groupRecorded = false;
  if (Number.isSafeInteger(child.pid) && child.pid > 1) {
    try {
      fs.writeFileSync(groupPIDFile, `${child.pid} ${ownershipToken}\n`, { mode: 0o600 });
      groupRecorded = true;
    } catch (error) {
      await retireProcessGroup(child.pid);
      throw error;
    }
  }
  let reason = null;
  let childResult = null;
  let terminationStarted = false;
  let escalationTimer = null;

  const requestTermination = (nextReason) => {
    if (terminationStarted || !Number.isSafeInteger(child.pid)) return;
    terminationStarted = true;
    reason = nextReason;
    signalProcessGroup(child.pid, 'SIGTERM');
    escalationTimer = setTimeout(() => {
      signalProcessGroup(child.pid, 'SIGKILL');
    }, SUPERVISOR_TERM_GRACE_MS);
  };
  const signalHandlers = new Map([
    ['SIGINT', () => requestTermination('SIGINT')],
    ['SIGTERM', () => requestTermination('SIGTERM')],
  ]);
  for (const [signal, handler] of signalHandlers) process.once(signal, handler);

  const parentMonitor = setInterval(() => {
    if (process.ppid !== ownerPID || !processExists(ownerPID)) requestTermination('PARENT_LOST');
  }, SUPERVISOR_PARENT_POLL_MS);
  const deadline = setTimeout(() => requestTermination('TIMEOUT'), timeoutMilliseconds);

  try {
    childResult = await new Promise((resolve) => {
      child.once('spawn', () => {
        if (groupRecorded) return;
        try {
          fs.writeFileSync(groupPIDFile, `${child.pid} ${ownershipToken}\n`, { mode: 0o600 });
          groupRecorded = true;
        } catch (error) {
          requestTermination('GROUP_RECORD_FAILED');
          resolve({ code: null, signal: null, error });
        }
      });
      child.once('error', (error) => resolve({ code: null, signal: null, error }));
      child.once('close', (code, signal) => resolve({ code, signal, error: null }));
    });
  } finally {
    clearInterval(parentMonitor);
    clearTimeout(deadline);
    if (escalationTimer !== null) clearTimeout(escalationTimer);
    for (const [signal, handler] of signalHandlers) process.off(signal, handler);
  }

  const groupGone = Number.isSafeInteger(child.pid) ? await retireProcessGroup(child.pid) : true;
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

function runProgram(executable, args, { cwd, maxBuffer = 64 * 1024 * 1024 } = {}) {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: 'utf8',
    env: proofEnvironment(),
    maxBuffer,
  });
  if (result.error) throw new ProofError('COMMAND_LAUNCH_FAILED', { ambiguous: true });
  if (result.signal !== null || result.status === null) {
    throw new ProofError('COMMAND_INTERRUPTED', { ambiguous: true });
  }
  return result;
}

function runAOSSuccess(options, args, code) {
  const result = runProgram(options.aos, args, { cwd: options.root });
  fail(result.status === 0, code);
  const payload = parseJSON(result.stdout, `${code}_JSON_INVALID`);
  fail(errorCode(payload) === null, code);
  return payload;
}

function runAOSFailure(options, args, expectedCode, code) {
  const result = runProgram(options.aos, args, { cwd: options.root });
  fail(result.status !== 0, code);
  const payload = parseJSON(result.stderr || result.stdout, `${code}_JSON_INVALID`);
  fail(errorCode(payload) === expectedCode, code);
  return payload;
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

    const preexistingEntries = strictFocusEntries(options, identity);
    fail(channelIDs.every((id) => !preexistingEntries.some((entry) => entry?.id === id)), 'CHANNEL_ID_COLLISION');
    unrelatedDigestsBefore = stablePublicChannelDigests(
      preexistingEntries,
      channelIDs,
      Buffer.from(process.env[SNAPSHOT_KEY_ENV], 'hex'),
    );
    writeJSONFile(files.unrelatedDigests, unrelatedDigestsBefore);
    armChannelCleanup(files);

    fixture = await startFixture(options, files);
    await waitForFile(files.metadata, 5_000);
    const metadata = parseJSON(fs.readFileSync(files.metadata, 'utf8'), 'FIXTURE_METADATA_INVALID');
    fail(metadata?.schema === 'aos.exact-focus-channel-native-fixture.v1', 'FIXTURE_METADATA_INVALID');
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

    runAOSFailure(options, [
      'focus', 'create',
      '--id', negativeChannel,
      '--window', String(metadata.target_window_id),
      '--pid', String(metadata.pid),
      '--depth', '15',
      '--subtree-identifier', metadata.sibling_identifier,
    ], 'WINDOW_NOT_FOUND', 'SIBLING_SUBTREE_NOT_REJECTED');
    fail(focusEntry(options, identity, negativeChannel) === null, 'NEGATIVE_CHANNEL_PUBLISHED');

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

    const initial = verifyCapture(options, metadata, files.capture, 'INITIAL');
    removeFile(files.capture);
    fail(!fs.existsSync(files.capture), 'CAPTURE_ARTIFACT_CLEANUP_FAILED');

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
    const preserved = verifyCapture(options, metadata, files.preservedCapture, 'PRESERVED');
    fail(
      preserved.analysis.decoded_rgba_sha256 === initial.analysis.decoded_rgba_sha256,
      'REJECTED_REFRESH_CHANGED_DECODED_PIXELS',
    );
    fail(equalJSON(preserved.axProjection, initial.axProjection), 'REJECTED_REFRESH_CHANGED_AX');
    fail(equalJSON(preserved.targetProjection, initial.targetProjection), 'REJECTED_REFRESH_CHANGED_TARGET_AX');
    removeFile(files.preservedCapture);
    fail(!fs.existsSync(files.preservedCapture), 'PRESERVED_CAPTURE_ARTIFACT_CLEANUP_FAILED');

    fs.writeFileSync(files.closeRequest, 'close\n', { mode: 0o600 });
    await waitForFile(files.closeAck, 3_000);
    const closeAck = parseJSON(fs.readFileSync(files.closeAck, 'utf8'), 'TARGET_CLOSE_INVALID');
    fail(closeAck.target_window_removed === true, 'TARGET_WINDOW_STILL_PRESENT');
    await sleep(1_250);

    runAOSFailure(options, [
      'focus', 'update', '--id', options.channel, '--depth', '15',
    ], 'WINDOW_NOT_FOUND', 'MISSING_TARGET_REFRESH_NOT_REJECTED');
    const afterMissingRefresh = focusEntry(options, identity, options.channel);
    fail(afterMissingRefresh !== null, 'MISSING_REFRESH_REMOVED_CHANNEL');
    fail(equalJSON(stableFocusProjection(afterMissingRefresh), preservedProjection), 'MISSING_REFRESH_CHANGED_PUBLICATION');

    removeFile(files.failedCapture);
    runAOSFailure(options, [
      'see', 'capture', '--channel', options.channel, '--out', files.failedCapture,
    ], 'WINDOW_NOT_FOUND', 'MISSING_TARGET_CAPTURE_NOT_REJECTED');
    fail(!fs.existsSync(files.failedCapture), 'FAILED_CAPTURE_ARTIFACT_PRESENT');

    channelRemoved = await removeChannelsQuiescent(options, identity, channelIDs);
    fail(channelRemoved, 'CHANNEL_RESIDUE_PRESENT');
    disarmChannelCleanup(files);

    const fixtureCleanup = await stopFixture(files, fixture);
    fixtureWindowsRemoved = fixtureCleanup.fixtureWindowsRemoved;
    fixtureProcessReaped = fixtureCleanup.fixtureProcessReaped;
    fail(fixtureWindowsRemoved, 'FIXTURE_CLEANUP_FAILED');
    fail(fixtureProcessReaped, 'FIXTURE_PROCESS_NOT_REAPED');

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

    const summary = {
      status: 'passed',
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
      error_code: error instanceof ProofError ? error.code : 'NATIVE_PROOF_FAILED',
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
