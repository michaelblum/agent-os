import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  GEOMETRY_CHECKPOINT_KEY_ENV,
  GeometryCheckpointError,
  GeometryCheckpointRequester,
  verifyCaptureGeometryCheckpoint,
} from './exact-focus-channel-geometry-checkpoint.mjs';
import { createRunProgram } from './exact-focus-channel-command-runner.mjs';
import { extractAOSCommandErrorCode } from './exact-focus-channel-proof-contract.mjs';
import {
  FIXTURE_RESULT_MAX_BYTES,
  MISSING_TARGET_CAPTURE_COMMAND_TIMEOUT_MS,
  SNAPSHOT_KEY_ENV,
  ProofError,
  allowlistedAOSCommandError,
  aosCommandProofError,
  assertExactTargetAX,
  canonicalAXProjection,
  elementCarriesIdentifier,
  equalJSON,
  fail,
  fixtureMetadataFromResultBytes,
  focusEntries,
  parseJSON,
  stablePublicChannelDigests,
} from './exact-focus-channel-native-proof-model.mjs';

const NO_AUTOSTART_ENV = Object.freeze({
  AOS_ALLOW_DAEMON_AUTOSTART: '0',
  AOS_DISABLE_DAEMON_AUTOSTART: '1',
});
const COMMAND_RESPONSE_DEADLINE_MS = 3_000;
const CLEAN_ABSENCE_SETTLE_MS = COMMAND_RESPONSE_DEADLINE_MS + 250;
const FIXTURE_GEOMETRY_CHECKPOINT_WAIT_MS = 2_000;
export const MISSING_TARGET_CAPTURE_COMMAND_CLASS = 'missing_target_capture';
const COMMAND_CLASS_TIMEOUT_MS = Object.freeze({
  capture: 30_000,
  [MISSING_TARGET_CAPTURE_COMMAND_CLASS]: MISSING_TARGET_CAPTURE_COMMAND_TIMEOUT_MS,
  aos: 10_000,
  local: 10_000,
});

export function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function processExists(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

export function isRegularFile(file) {
  try {
    const metadata = fs.lstatSync(file);
    return metadata.isFile() && !metadata.isSymbolicLink();
  } catch {
    return false;
  }
}

export function readBoundedRegularFile(file, maximumBytes, errorCode, requiredMode = null) {
  const noFollow = fs.constants.O_NOFOLLOW;
  fail(Number.isInteger(noFollow) && noFollow !== 0, errorCode);
  let descriptor = null;
  try {
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | noFollow);
    const metadata = fs.fstatSync(descriptor);
    fail(
      metadata.isFile()
        && metadata.size >= 1
        && metadata.size <= maximumBytes
        && (requiredMode === null || (metadata.mode & 0o777) === requiredMode),
      errorCode,
    );
    const bytes = Buffer.alloc(metadata.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, null);
      fail(count > 0, errorCode);
      offset += count;
    }
    const trailingByte = Buffer.alloc(1);
    fail(fs.readSync(descriptor, trailingByte, 0, 1, null) === 0, errorCode);
    return bytes;
  } catch (error) {
    if (error instanceof ProofError) throw error;
    throw new ProofError(errorCode);
  } finally {
    if (descriptor !== null) try { fs.closeSync(descriptor); } catch {}
  }
}

export function parseFixtureResultFile(file) {
  return fixtureMetadataFromResultBytes(
    readBoundedRegularFile(file, FIXTURE_RESULT_MAX_BYTES, 'FIXTURE_METADATA_INVALID'),
  );
}

export function proofEnvironment() {
  const environment = { ...process.env, ...NO_AUTOSTART_ENV };
  delete environment[SNAPSHOT_KEY_ENV];
  delete environment[GEOMETRY_CHECKPOINT_KEY_ENV];
  return environment;
}

export function assertEnvironmentScope() {
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

function aosCommandClass(args) {
  return args[0] === 'see' && args[1] === 'capture' ? 'capture' : 'aos';
}

export const runProgram = createRunProgram({
  ProofError,
  commandClassTimeouts: COMMAND_CLASS_TIMEOUT_MS,
  proofEnvironment,
});

export function runAOSSuccess(options, args, code, execute = runProgram) {
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
  if (allowlistedAOSCommandError(result) !== null) {
    throw aosCommandProofError(code, args, result, { unexpectedSuccess: true });
  }
  let payload;
  try {
    payload = parseJSON(result.stdout, `${code}_JSON_INVALID`);
  } catch {
    throw aosCommandProofError(`${code}_JSON_INVALID`, args, result);
  }
  if (extractAOSCommandErrorCode(payload) !== null) {
    throw aosCommandProofError(code, args, result, { unexpectedSuccess: true });
  }
  return payload;
}

function failureCommandExecution(execution, args) {
  if (typeof execution === 'function') {
    return { execute: execution, commandClass: aosCommandClass(args) };
  }
  if (execution === undefined) {
    return { execute: runProgram, commandClass: aosCommandClass(args) };
  }
  fail(execution !== null && typeof execution === 'object' && !Array.isArray(execution),
    'COMMAND_CLASS_INVALID');
  fail(Object.keys(execution).every((key) => ['commandClass', 'execute'].includes(key)),
    'COMMAND_CLASS_INVALID');
  const execute = Object.hasOwn(execution, 'execute') ? execution.execute : runProgram;
  const commandClass = Object.hasOwn(execution, 'commandClass')
    ? execution.commandClass
    : aosCommandClass(args);
  fail(typeof execute === 'function'
    && typeof commandClass === 'string'
    && Object.hasOwn(COMMAND_CLASS_TIMEOUT_MS, commandClass),
  'COMMAND_CLASS_INVALID');
  return { execute, commandClass };
}

export function runAOSFailure(options, args, expectedCode, code, execution = undefined) {
  const { execute, commandClass } = failureCommandExecution(execution, args);
  let result;
  try {
    result = execute(options.aos, args, {
      commandClass,
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
}

export function removeFile(file) {
  try {
    fs.unlinkSync(file);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

export async function waitForFile(file, timeoutMilliseconds) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (isRegularFile(file) && fs.statSync(file).size > 0) return;
    await sleep(50);
  }
  throw new ProofError('FIXTURE_TIMEOUT');
}

function projectGeometryCheckpointError(error, prefix = null) {
  if (error instanceof GeometryCheckpointError) {
    return new ProofError(prefix === null ? error.code : `${prefix}_${error.code}`);
  }
  return error;
}

async function requestFixtureGeometryCheckpoint(files, fixture, phase) {
  try {
    const transaction = fixture.checkpointRequester.begin(phase);
    try {
      await waitForFile(files.checkpointReceipt, FIXTURE_GEOMETRY_CHECKPOINT_WAIT_MS);
    } catch {
      throw new ProofError('FIXTURE_GEOMETRY_CHECKPOINT_TIMEOUT');
    }
    try {
      return fixture.checkpointRequester.read(transaction);
    } catch (error) {
      throw projectGeometryCheckpointError(error);
    }
  } catch (error) {
    throw projectGeometryCheckpointError(error);
  } finally {
    fixture?.checkpointRequester?.cleanup();
  }
}

export function canonicalExistingPath(file) {
  return fs.realpathSync(file);
}

export function assertRuntimeSource(options) {
  const head = runProgram('/usr/bin/git', ['-C', options.root, 'rev-parse', 'HEAD'], { cwd: options.root });
  fail(head.status === 0 && head.stdout.trim() === options.runtimeRevision, 'RUNTIME_REVISION_MISMATCH');
  const runtimePaths = [
    'src',
    'shared',
    'scripts',
    'manifests',
    'tests/exact-focus-channel-geometry-checkpoint.test.mjs',
    'tests/exact-focus-channel-native-proof-contract.test.mjs',
    'tests/exact-focus-channel-proof-protocol-contract.test.mjs',
    'tests/exact-focus-channel-supervision-contract.test.mjs',
    'tests/lib/exact-focus-channel-command-runner.mjs',
    'tests/lib/exact-focus-channel-geometry-checkpoint-harness.swift',
    'tests/lib/exact-focus-channel-geometry-checkpoint.mjs',
    'tests/lib/exact-focus-channel-geometry-checkpoint.swift',
    'tests/lib/exact-focus-channel-native-proof-model.mjs',
    'tests/lib/exact-focus-channel-native-proof-runtime.mjs',
    'tests/lib/exact-focus-channel-native-proof-self-test.mjs',
    'tests/lib/exact-focus-channel-proof-contract.mjs',
    'tests/lib/exact-focus-channel-supervision-protocol.mjs',
    'tests/lib/exact-focus-channel-supervision-self-test.mjs',
    'tests/lib/exact-focus-channel-supervision.mjs',
    'tests/lib/exact-focus-channel-supervision-scenarios.zsh',
    'tests/lib/exact-focus-channel-supervision.zsh',
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

export function assertStatusPreconditions(payload) {
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

export function assertPermissionPreconditions(payload) {
  fail(payload?.permissions?.accessibility === true, 'ACCESSIBILITY_REQUIRED');
  fail(payload?.permissions?.screen_recording === true, 'SCREEN_RECORDING_REQUIRED');
  fail(payload?.screen_capture_direct?.status === 'ready', 'DIRECT_CAPTURE_NOT_READY');
}

export function assertBuildAttestation(payload) {
  fail(payload?.schema_version === 1, 'BUILD_ATTESTATION_INVALID');
  fail(payload?.runtime_mode === 'repo', 'BUILD_ATTESTATION_INVALID');
  fail(payload?.status === 'current' && payload?.current === true, 'RUNTIME_BINARY_STALE');
  fail(typeof payload?.source_fingerprint === 'string' && /^[a-f0-9]{64}$/u.test(payload.source_fingerprint), 'BUILD_ATTESTATION_INVALID');
  fail(payload.source_fingerprint === payload.recorded_fingerprint, 'RUNTIME_BINARY_STALE');
  fail(Number.isInteger(payload.source_file_count) && payload.source_file_count > 0, 'BUILD_ATTESTATION_INVALID');
  return payload.source_fingerprint;
}

export function assertServiceBinding(options, payload, runtime, binaryIdentity, statusObservedAt) {
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

export function assertSameDaemon(options, identity) {
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

export function strictFocusEntries(options, identity) {
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

export function focusEntry(options, identity, id) {
  const matches = strictFocusEntries(options, identity).filter((entry) => entry?.id === id);
  fail(matches.length <= 1, 'FOCUS_ID_AMBIGUOUS');
  return matches[0] ?? null;
}

export async function removeChannelsQuiescent(options, identity, ids) {
  const channelIDs = Array.isArray(ids) ? ids : [ids];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const entries = strictFocusEntries(options, identity);
    for (const id of channelIDs) {
      if (!entries.some((entry) => entry?.id === id)) continue;
      runAOSSuccess(options, ['focus', 'remove', '--id', id], 'FOCUS_REMOVE_FAILED');
    }
    const first = strictFocusEntries(options, identity);
    if (channelIDs.some((id) => first.some((entry) => entry?.id === id))) continue;
    await sleep(CLEAN_ABSENCE_SETTLE_MS);
    const second = strictFocusEntries(options, identity);
    if (channelIDs.every((id) => !second.some((entry) => entry?.id === id))) return true;
  }
  return false;
}

async function waitForChildExit(child, timeoutMilliseconds) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null || !processExists(child.pid)) return true;
    await sleep(25);
  }
  return child.exitCode !== null || child.signalCode !== null || !processExists(child.pid);
}

export async function startFixture(options, files) {
  const ownershipToken = crypto.randomBytes(16).toString('hex');
  const checkpointKey = crypto.randomBytes(32);
  let child = null;
  try {
    child = spawn(options.helper, [
      '--fixture',
      '--metadata', files.metadata,
      '--close-request', files.closeRequest,
      '--close-ack', files.closeAck,
      '--stop-request', files.stopRequest,
      '--cleanup-report', files.cleanupReport,
      '--checkpoint-request', files.checkpointRequest,
      '--checkpoint-receipt', files.checkpointReceipt,
      '--ownership-token', ownershipToken,
    ], {
      cwd: options.root,
      env: {
        ...proofEnvironment(),
        [GEOMETRY_CHECKPOINT_KEY_ENV]: checkpointKey.toString('hex'),
      },
      stdio: 'ignore',
    });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    fail(Number.isSafeInteger(child.pid) && child.pid > 1, 'FIXTURE_LAUNCH_FAILED');
    fs.writeFileSync(files.fixturePID, `${child.pid} ${ownershipToken}\n`, { mode: 0o600 });
    return {
      child,
      checkpointKey,
      checkpointRequester: new GeometryCheckpointRequester({
        key: checkpointKey,
        receiptFile: files.checkpointReceipt,
        requestFile: files.checkpointRequest,
      }),
      ownershipToken,
    };
  } catch {
    if (child?.pid && processExists(child.pid)) {
      child.kill('SIGTERM');
      if (!await waitForChildExit(child, 1_000)) child.kill('SIGKILL');
      await waitForChildExit(child, 1_000);
    }
    checkpointKey.fill(0);
    throw new ProofError('FIXTURE_LAUNCH_FAILED');
  }
}

export async function stopFixture(files, fixture) {
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
  try { fixture?.checkpointRequester?.cleanup(); } catch {}
  if (Buffer.isBuffer(fixture?.checkpointKey)) {
    fixture.checkpointKey.fill(0);
    fixture.checkpointKey = null;
  }
  return { fixtureWindowsRemoved, fixtureProcessReaped };
}

export function armChannelCleanup(files) {
  fs.writeFileSync(files.cleanupArmed, 'armed\n', { mode: 0o600 });
}

export function disarmChannelCleanup(files) {
  removeFile(files.cleanupArmed);
}

async function captureCheckpointBracket(files, fixture, prePhase, postPhase, captureOperation) {
  const pre = await requestFixtureGeometryCheckpoint(files, fixture, prePhase);
  const capture = await captureOperation();
  const post = await requestFixtureGeometryCheckpoint(files, fixture, postPhase);
  return { capture, post, pre };
}

export async function verifyCapture(options, metadata, files, fixture, outputFile, codePrefix) {
  const phasePrefix = codePrefix.toLowerCase();
  const { capture, post, pre } = await captureCheckpointBracket(
    files,
    fixture,
    `${phasePrefix}_pre`,
    `${phasePrefix}_post`,
    () => runAOSSuccess(options, [
      'see', 'capture',
      '--channel', options.channel,
      '--xray',
      '--perception',
      '--format', 'png',
      '--out', outputFile,
    ], `${codePrefix}_CAPTURE_FAILED`),
  );
  fail(capture?.status === 'success', `${codePrefix}_CAPTURE_STATUS_INVALID`);
  fail(typeof capture.state_id === 'string' && capture.state_id.length > 0, `${codePrefix}_CAPTURE_STATE_ID_MISSING`);
  fail(capture.warning === undefined, `${codePrefix}_CAPTURE_WARNING_UNEXPECTED`);
  fail(capture.base64 === undefined, 'PIXEL_BYTES_IN_RESPONSE');
  fail(Array.isArray(capture.files) && capture.files.length === 1 && capture.files[0] === outputFile, `${codePrefix}_CAPTURE_FILE_MISMATCH`);
  fail(isRegularFile(outputFile), `${codePrefix}_CAPTURE_ARTIFACT_MISSING`);
  const captureStat = fs.statSync(outputFile);
  fail(captureStat.size > 0 && captureStat.size <= 8 * 1024 * 1024, `${codePrefix}_CAPTURE_ARTIFACT_BOUNDS`);
  const captureDigest = crypto.createHash('sha256').update(fs.readFileSync(outputFile)).digest('hex');
  const analysisResult = runProgram(options.helper, ['--analyze-png', '--path', outputFile], {
    cwd: options.root,
  });
  fail(analysisResult.status === 0, `${codePrefix}_PIXEL_ANALYSIS_FAILED`);
  const analysis = parseJSON(analysisResult.stdout, `${codePrefix}_PIXEL_ANALYSIS_INVALID`);
  fail(analysis.exact_window_pixels_verified === true, `${codePrefix}_PIXEL_FIDELITY_MISMATCH`);
  fail(typeof analysis.decoded_rgba_sha256 === 'string' && /^[a-f0-9]{64}$/u.test(analysis.decoded_rgba_sha256), `${codePrefix}_PIXEL_DIGEST_INVALID`);
  let evidence;
  try {
    evidence = verifyCaptureGeometryCheckpoint({
      capture,
      channel: options.channel,
      decodedHeight: analysis.height,
      decodedWidth: analysis.width,
      key: fixture.checkpointKey,
      ownerPID: metadata.pid,
      post,
      pre,
      targetWindowID: metadata.target_window_id,
    });
  } catch (error) {
    throw projectGeometryCheckpointError(error, codePrefix);
  }
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
    evidence.scaleFactor,
    codePrefix,
  );
  const axProjection = canonicalAXProjection(capture.elements);
  return { analysis, axProjection, capture, captureDigest, captureStat, targetProjection };
}

export function writeDaemonIdentity(file, identity) {
  fs.writeFileSync(file, `${JSON.stringify(identity)}\n`, { mode: 0o600 });
}

export function writeJSONFile(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`, { mode: 0o600 });
}
