import { randomUUID } from 'node:crypto';
import {
  connectWithAutoStart,
  stopManagedDaemon,
} from './aos-daemon-client.mjs';

const MAX_LINE_BYTES = 16 * 1024;
const MAX_SPEECH_BYTES = 64 * 1024;
const ASSERTED_ATTRIBUTION_FLAGS = new Set([
  '--client-id',
  '--agent-id',
  '--project-id',
  '--task-id',
  '--run-id',
  '--skill-id',
  '--target-id',
  '--capability-label',
  '--retry-id',
]);
const EXTERNAL_DISPATCH_REVIEWED_DEPENDENCY_SET_DIGEST_ENV = 'AOS_EXTERNAL_DISPATCH_REVIEWED_DEPENDENCY_SET_DIGEST';
const EXTERNAL_DISPATCH_LIFECYCLE_PARENT_PID_ENV = 'AOS_EXTERNAL_DISPATCH_LIFECYCLE_PARENT_PID';
const externalDispatchReviewedDependencySetDigest = process.env[EXTERNAL_DISPATCH_REVIEWED_DEPENDENCY_SET_DIGEST_ENV];
const assertedLifecycleParentPID = process.env[EXTERNAL_DISPATCH_LIFECYCLE_PARENT_PID_ENV];
const parsedLifecycleParentPID = /^\d+$/.test(assertedLifecycleParentPID ?? '')
  ? Number(assertedLifecycleParentPID)
  : null;
const externalDispatchParentAssertionValid = assertedLifecycleParentPID === undefined
  || (Number.isSafeInteger(parsedLifecycleParentPID) && parsedLifecycleParentPID > 0 && parsedLifecycleParentPID === process.ppid);
const externalDispatchParentPID = parsedLifecycleParentPID ?? process.ppid;
delete process.env[EXTERNAL_DISPATCH_REVIEWED_DEPENDENCY_SET_DIGEST_ENV];
delete process.env[EXTERNAL_DISPATCH_LIFECYCLE_PARENT_PID_ENV];
const TERMINAL_EVENTS = new Set([
  'capture_completed',
  'capture_canceled',
  'capture_failed',
  'capture_segmented_completed',
  'capture_segmented_canceled',
  'capture_segmented_failed',
  'speech_finished',
  'speech_canceled',
  'speech_failed',
  'playback_finished',
  'playback_canceled',
  'playback_failed',
]);
const FAILURE_EVENTS = new Set(['capture_failed', 'capture_segmented_failed', 'speech_failed', 'playback_failed']);
const SAFE_DAEMON_ERRORS = new Map([
  ['MICROPHONE_PERMISSION_DENIED', 'microphone permission is not granted'],
  ['MICROPHONE_PERMISSION_NOT_DETERMINED', 'microphone permission has not been requested'],
  ['MICROPHONE_PERMISSION_RESTRICTED', 'microphone access is restricted by system policy'],
  ['MICROPHONE_PERMISSION_UNKNOWN', 'microphone permission state is unavailable'],
  ['MICROPHONE_UNAVAILABLE', 'microphone input is unavailable'],
  ['HOTKEY_LEASE_BUSY', 'a voice hotkey listener is already active'],
  ['CAPTURE_LEASE_BUSY', 'microphone capture is already active'],
  ['CAPTURE_CANCELED', 'microphone capture was canceled before startup'],
  ['SPEECH_LEASE_BUSY', 'speech playback is already active'],
  ['CAPTURE_ACTIVE', 'speech cannot start during microphone capture'],
  ['INVALID_SHORTCUT', 'unsupported voice shortcut'],
  ['INVALID_OUTPUT_PATH', 'voice capture output path is invalid'],
  ['UNSAFE_OUTPUT_PARENT', 'voice capture output parent is unsafe'],
  ['OUTPUT_EXISTS', 'voice capture output must not already exist'],
  ['OUTPUT_CREATE_FAILED', 'voice capture output could not be created'],
  ['INVALID_SEGMENT_DIRECTORY', 'voice segment directory is invalid'],
  ['UNSAFE_SEGMENT_DIRECTORY', 'voice segment directory is unsafe'],
  ['SEGMENT_DIRECTORY_NOT_EMPTY', 'voice segment directory must be empty'],
  ['INVALID_SEGMENT_DURATION', 'voice segment duration is invalid'],
  ['SEGMENT_CREATE_FAILED', 'voice segment could not be created'],
  ['INVALID_READY_CUE', 'microphone ready cue is invalid'],
  ['READY_CUE_UNAVAILABLE', 'microphone ready cue is unavailable'],
  ['CAPTURE_CLOCK_UNAVAILABLE', 'microphone input timing is unavailable'],
  ['INVALID_SPEECH_TEXT', 'speech input is invalid'],
  ['INVALID_SPEECH_RATE', 'speech rate is invalid'],
  ['INVALID_VOICE_ID', 'voice identifier is malformed'],
  ['INVALID_VOICE_PROVIDER', 'streamed speech requires a system voice'],
  ['VOICE_NOT_FOUND', 'requested system voice is unavailable'],
  ['INVALID_AUDIO_PATH', 'audio playback input path is invalid'],
  ['UNSAFE_AUDIO_PARENT', 'audio playback input parent is unsafe'],
  ['UNSAFE_AUDIO_INPUT', 'audio playback input is unsafe'],
  ['AUDIO_INPUT_UNAVAILABLE', 'audio playback input is unavailable'],
  ['AUDIO_INPUT_LIMIT', 'audio playback input exceeds the supported size'],
  ['INVALID_AUDIO_FILE', 'audio playback input is not readable PCM audio'],
  ['UNSUPPORTED_AUDIO_FILE', 'audio playback format or duration is unsupported'],
  ['AUDIO_OUTPUT_UNAVAILABLE', 'audio playback output is unavailable'],
  ['PLAYBACK_CANCELED', 'audio playback was canceled before startup'],
]);
const SAFE_CLI_ERRORS = new Map([
  ['MISSING_ARG', 'required voice argument is missing'],
  ['UNKNOWN_ARG', 'voice command received an unexpected argument'],
  ['UNKNOWN_FLAG', 'voice command received an unknown flag'],
  ['INVALID_ARG', 'voice command argument is invalid'],
  ['INVALID_AUDIO_PATH', 'audio playback input path is invalid'],
  ['DAEMON_UNREACHABLE', 'AOS daemon is unavailable'],
]);

function fail(message, code) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function hasExactKeys(value, keys) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function operationIdentifier(value) {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= 128
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function operationGeneration(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= Number.MAX_SAFE_INTEGER;
}

function validateAssertedAttributionArguments(args) {
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    if (!ASSERTED_ATTRIBUTION_FLAGS.has(args[index])) continue;
    if (seen.has(args[index])) fail('asserted attribution flags may appear only once', 'INVALID_ARG');
    seen.add(args[index]);
    const value = args[index + 1];
    if (!operationIdentifier(value)) fail('asserted attribution values must be operation identifiers', 'INVALID_ARG');
    index += 1;
  }
}

function valueAfter(args, token) {
  const index = args.indexOf(token);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) fail(`${token} requires a value`, 'MISSING_ARG');
  return value;
}

function assertOnlyFlags(args, valueFlags, boolFlags = new Set()) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (boolFlags.has(arg)) continue;
    if (valueFlags.has(arg)) {
      index += 1;
      if (index >= args.length || args[index].startsWith('--')) fail(`${arg} requires a value`, 'MISSING_ARG');
      continue;
    }
    if (arg.startsWith('--')) fail(`Unknown flag: ${arg}`, 'UNKNOWN_FLAG');
    fail('Unexpected positional argument', 'UNKNOWN_ARG');
  }
}

function parseDuration(value) {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m)?$/.exec(value ?? '120s');
  if (!match) fail('listen --max-duration must be a positive duration', 'INVALID_ARG');
  const amount = Number(match[1]);
  const seconds = match[2] === 'ms' ? amount / 1000 : match[2] === 'm' ? amount * 60 : amount;
  if (!Number.isFinite(seconds) || seconds < 0.001 || seconds > 120) {
    fail('listen --max-duration must be between 1ms and 120s', 'INVALID_ARG');
  }
  return seconds;
}

function parseSegmentDuration(value) {
  const match = /^(\d+(?:\.\d+)?)(ms|s)?$/.exec(value ?? '3s');
  if (!match) fail('listen --segment-duration must be a duration', 'INVALID_ARG');
  const amount = Number(match[1]);
  const seconds = match[2] === 'ms' ? amount / 1000 : amount;
  if (!Number.isFinite(seconds) || seconds < 0.5 || seconds > 5) {
    fail('listen --segment-duration must be between 500ms and 5s', 'INVALID_ARG');
  }
  return seconds;
}

function parseReadyCue(value) {
  if (value === undefined) return undefined;
  if (value !== 'none' && value !== 'chime') {
    fail('listen --ready-cue must be none or chime', 'INVALID_ARG');
  }
  return value;
}

function request(service, action, data, ref) {
  return `${JSON.stringify({ v: 1, service, action, data, ref })}\n`;
}

function readOneHandshakeJSON(socket, timeoutMs = 3000) {
  return new Promise((resolve) => {
    let buffer = '';
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onFailure);
      socket.off('close', onFailure);
      resolve(value);
    };
    const onFailure = () => finish(null);
    const onData = (chunk) => {
      buffer += chunk.toString('utf8');
      if (Buffer.byteLength(buffer) > MAX_LINE_BYTES) {
        finish(null);
        return;
      }
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      try {
        finish(JSON.parse(buffer.slice(0, newline)));
      } catch {
        finish(null);
      }
    };
    const timer = setTimeout(onFailure, timeoutMs);
    socket.on('data', onData);
    socket.once('error', onFailure);
    socket.once('close', onFailure);
  });
}

function monitorExternalDispatchParent(onDisconnect) {
  if (!externalDispatchParentAssertionValid || process.ppid !== externalDispatchParentPID) {
    onDisconnect();
    return null;
  }
  const timer = setInterval(() => {
    if (process.ppid === externalDispatchParentPID) return;
    clearInterval(timer);
    onDisconnect();
  }, 250);
  timer.unref();
  return timer;
}

// Lifecycle only: this narrows child lifetime to the native dispatch parent.
// The asserted PID is never sent to the daemon or used as authority evidence.
export function monitorExternalDispatchLifecycleOnly(onDisconnect) {
  return monitorExternalDispatchParent(onDisconnect);
}

function readSpeechInput() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let byteCount = 0;
    let settled = false;
    let parentMonitor = null;
    const cleanup = () => {
      if (parentMonitor) clearInterval(parentMonitor);
      process.stdin.off('data', onData);
      process.stdin.off('end', onEnd);
      process.stdin.off('error', onError);
    };
    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      process.stdin.pause();
      resolve(value);
    };
    const rejectInvalid = () => {
      if (settled) return;
      settled = true;
      cleanup();
      process.stdin.pause();
      const error = new Error('say --follow stdin must contain 1 to 65536 bytes');
      error.code = 'INVALID_SPEECH_TEXT';
      reject(error);
    };
    const onData = (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      byteCount += bytes.length;
      if (byteCount > MAX_SPEECH_BYTES) {
        rejectInvalid();
        return;
      }
      chunks.push(bytes);
    };
    const onEnd = () => finish(Buffer.concat(chunks, byteCount));
    const onError = () => rejectInvalid();

    process.stdin.on('data', onData);
    process.stdin.once('end', onEnd);
    process.stdin.once('error', onError);
    parentMonitor = monitorExternalDispatchParent(() => finish(null));
    process.stdin.resume();
  });
}

async function finalizeExternalSpawn(socket) {
  const ref = randomUUID();
  const reviewedDependencySetDigest = externalDispatchReviewedDependencySetDigest;
  if (!/^[0-9a-f]{64}$/.test(reviewedDependencySetDigest ?? '')) {
    fail('external microphone spawn dependency evidence is unavailable', 'EXTERNAL_SPAWN_FINALIZE_INVALID');
  }
  socket.write(request('operation', 'external_spawn_finalize', {
    schema_version: 'aos.operation.external-spawn-finalize-request.v1',
    request_id: ref,
  }, ref));
  const response = await readOneHandshakeJSON(socket);
  const payload = response?.data;
  if (response?.status === 'error' || response?.error) {
    fail('external microphone spawn binding was rejected', 'EXTERNAL_SPAWN_FINALIZE_FAILED');
  }
  if (
    !hasExactKeys(response, ['v', 'status', 'ref', 'data'])
    || !hasExactKeys(payload, [
      'schema_version',
      'request_id',
      'spawn_record_id',
      'operation_id',
      'operation_generation',
      'adapter_registration_id',
      'adapter_registration_revision',
      'outcome',
      'receipt',
    ])
    || !hasExactKeys(payload?.receipt, [
      'spawn_record_id',
      'operation_id',
      'operation_generation',
      'adapter_registration_id',
      'adapter_registration_revision',
      'resolved_executable_path_digest',
      'executable_identity_digest',
      'executable_file_digest',
      'platform_code_directory_hash',
      'platform_code_directory_hash_algorithm',
      'expected_script_identity_digest',
      'script_identity_digest',
      'script_digest',
      'canonical_argv_shape_digest',
      'reviewed_dependency_set_digest',
      'outcome',
    ])
    || !/^[0-9a-f]{40}$/.test(payload?.receipt?.platform_code_directory_hash ?? '')
    || payload?.receipt?.platform_code_directory_hash_algorithm !== 'sha256_truncated_cdhash_20_bytes'
    || response?.v !== 1
    || response?.status !== 'success'
    || response?.ref !== ref
    || payload?.schema_version !== 'aos.operation.external-spawn-finalize-response.v1'
    || payload?.request_id !== ref
    || !operationIdentifier(payload?.spawn_record_id)
    || !operationIdentifier(payload?.operation_id)
    || !operationGeneration(payload?.operation_generation)
    || payload?.adapter_registration_id !== 'microphone-capture-adapter'
    || !operationGeneration(payload?.adapter_registration_revision)
    || payload?.adapter_registration_revision !== 1
    || payload?.outcome !== 'generation_bound_spawn_record_finalized'
    || payload?.receipt?.outcome !== 'generation_bound_spawn_record_finalized'
    || payload?.receipt?.spawn_record_id !== payload?.spawn_record_id
    || payload?.receipt?.operation_id !== payload?.operation_id
    || payload?.receipt?.operation_generation !== payload?.operation_generation
    || payload?.receipt?.adapter_registration_id !== payload?.adapter_registration_id
    || payload?.receipt?.adapter_registration_revision !== payload?.adapter_registration_revision
    || payload?.receipt?.reviewed_dependency_set_digest !== reviewedDependencySetDigest
    || payload?.receipt?.script_identity_digest !== payload?.receipt?.expected_script_identity_digest
    || ![
      'resolved_executable_path_digest',
      'executable_identity_digest',
      'executable_file_digest',
      'expected_script_identity_digest',
      'script_identity_digest',
      'script_digest',
      'reviewed_dependency_set_digest',
      'canonical_argv_shape_digest',
    ].every((field) => /^[0-9a-f]{64}$/.test(payload?.receipt?.[field] ?? ''))
  ) {
    fail('external microphone spawn binding response was invalid', 'EXTERNAL_SPAWN_FINALIZE_INVALID');
  }
  return {
    operation_id: payload.operation_id,
    operation_generation: payload.operation_generation,
  };
}

export async function followDaemonLease({
  service,
  action,
  data,
  stopAction,
  cancelAction,
  eventService,
  terminalEvents,
  failureEvents,
  safeDaemonErrors,
  eventTooLargeCode,
  eventTooLargeMessage,
  invalidEventCode,
  invalidEventMessage,
  fallbackErrorCode,
  fallbackErrorMessage,
  transformEvent = (payload) => payload,
  requiresExternalSpawnBinding = false,
}) {
  const startupAbort = new AbortController();
  let startupCanceled = false;
  let ownedDaemon = null;
  let connection = null;
  let socket = null;
  const ref = randomUUID();
  let buffer = '';
  let settled = false;
  let controlSent = false;
  let shutdownRequested = false;
  let authorityRequestStarted = false;
  let parentMonitor = null;
  let cleanupPromise = null;

  const cleanup = (exitCode = 0) => {
    if (cleanupPromise) return cleanupPromise;
    settled = true;
    if (parentMonitor) clearInterval(parentMonitor);
    cleanupPromise = (async () => {
      if (socket && !socket.destroyed) socket.end();
      await stopManagedDaemon(ownedDaemon ?? connection?.daemon);
      process.exitCode = exitCode;
    })();
    return cleanupPromise;
  };

  const sendControl = (kind) => {
    if (controlSent || settled) return;
    controlSent = true;
    const control = kind === 'stop' ? stopAction : cancelAction;
    if (!control) {
      cleanup(0);
      return;
    }
    socket.write(request(control.service, control.action, {}, ref));
    setTimeout(() => cleanup(kind === 'stop' ? 0 : 143), 2000).unref();
  };

  const requestShutdown = (kind) => {
    if (settled) return;
    shutdownRequested = true;
    if (!connection) {
      startupCanceled = true;
      startupAbort.abort();
      return;
    }
    if (!authorityRequestStarted) {
      cleanup(0);
      return;
    }
    sendControl(kind);
  };

  process.once('SIGINT', () => requestShutdown('stop'));
  process.once('SIGTERM', () => requestShutdown('cancel'));
  parentMonitor = monitorExternalDispatchParent(() => requestShutdown('cancel'));
  connection = await connectWithAutoStart({
    managed: true,
    signal: startupAbort.signal,
    onManagedDaemon: (daemon) => { ownedDaemon = daemon; },
  });
  socket = connection?.socket ?? null;
  if (startupCanceled || startupAbort.signal.aborted || shutdownRequested) {
    await cleanup(0);
    return;
  }
  if (!socket) fail('Cannot connect to daemon', 'DAEMON_UNREACHABLE');
  if (requiresExternalSpawnBinding) {
    try {
      await finalizeExternalSpawn(socket);
    } catch (error) {
      await cleanup(shutdownRequested ? 0 : 1);
      if (shutdownRequested) return;
      throw error;
    }
  }
  if (shutdownRequested) {
    await cleanup(0);
    return;
  }

  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    if (Buffer.byteLength(buffer) > MAX_LINE_BYTES && !buffer.includes('\n')) {
      process.stderr.write(`${JSON.stringify({ code: eventTooLargeCode, error: eventTooLargeMessage })}\n`);
      cleanup(1);
      return;
    }
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (Buffer.byteLength(line) > MAX_LINE_BYTES) {
        process.stderr.write(`${JSON.stringify({ code: eventTooLargeCode, error: eventTooLargeMessage })}\n`);
        cleanup(1);
        return;
      }
      let payload;
      try {
        payload = JSON.parse(line);
      } catch {
        process.stderr.write(`${JSON.stringify({ code: invalidEventCode, error: invalidEventMessage })}\n`);
        cleanup(1);
        return;
      }
      if (payload.status === 'error' || payload.error) {
        const code = payload.code ?? fallbackErrorCode;
        process.stderr.write(`${JSON.stringify({ code, error: safeDaemonErrors.get(code) ?? fallbackErrorMessage })}\n`);
        cleanup(1);
        return;
      }
      if (payload.v !== 1 || payload.service !== eventService || typeof payload.event !== 'string') continue;
      let output;
      try {
        output = transformEvent(payload);
      } catch (error) {
        const code = error?.code ?? invalidEventCode;
        process.stderr.write(`${JSON.stringify({ code, error: safeDaemonErrors.get(code) ?? fallbackErrorMessage })}\n`);
        cleanup(1);
        return;
      }
      if (output !== null && output !== undefined) process.stdout.write(`${JSON.stringify(output)}\n`);
      if (terminalEvents.has(payload.event)) cleanup(failureEvents.has(payload.event) ? 1 : 0);
    }
  });
  socket.once('error', () => cleanup(1));
  socket.once('close', () => cleanup(controlSent ? 0 : 1));
  authorityRequestStarted = true;
  socket.write(request(service, action, data, ref));
}

function followVoice(options) {
  return followDaemonLease({
    ...options,
    eventService: 'voice',
    terminalEvents: options.terminalEvents ?? TERMINAL_EVENTS,
    failureEvents: FAILURE_EVENTS,
    safeDaemonErrors: SAFE_DAEMON_ERRORS,
    eventTooLargeCode: 'VOICE_EVENT_TOO_LARGE',
    eventTooLargeMessage: 'voice event exceeded the line limit',
    invalidEventCode: 'INVALID_VOICE_EVENT',
    invalidEventMessage: 'daemon returned malformed JSON',
    fallbackErrorCode: 'VOICE_TRANSPORT_FAILED',
    fallbackErrorMessage: 'voice transport failed',
  });
}

export async function listenVoice(args) {
  assertOnlyFlags(
    args,
    new Set([
      '--source', '--shortcut', '--output', '--segments', '--segment-duration', '--max-duration', '--ready-cue',
      ...ASSERTED_ATTRIBUTION_FLAGS,
    ]),
    new Set(['--follow']),
  );
  if (!args.includes('--follow')) fail('voice listen sources require --follow', 'MISSING_ARG');
  const source = valueAfter(args, '--source');
  if (source === 'hotkey') {
    if ([...ASSERTED_ATTRIBUTION_FLAGS].some((flag) => args.includes(flag))) {
      fail('asserted attribution is available only for microphone capture', 'INVALID_ARG');
    }
    if (
      args.includes('--output')
      || args.includes('--segments')
      || args.includes('--segment-duration')
      || args.includes('--max-duration')
      || args.includes('--ready-cue')
    ) fail('hotkey listen does not accept microphone flags', 'INVALID_ARG');
    const shortcut = valueAfter(args, '--shortcut') ?? 'Control+Option+Space';
    await followVoice({
      service: 'listen',
      action: 'hotkey',
      data: { shortcut },
      terminalEvents: new Set(),
    });
    return;
  }
  if (source === 'microphone') {
    // The native registered dispatcher consumes these same validated values
    // into the operation-creation envelope before this child is spawned.
    validateAssertedAttributionArguments(args);
    if (args.includes('--shortcut')) fail('microphone listen does not accept --shortcut', 'INVALID_ARG');
    const output = valueAfter(args, '--output');
    const segmentsDirectory = valueAfter(args, '--segments');
    if (!output && !segmentsDirectory) {
      fail('listen --source microphone requires --output or --segments', 'MISSING_ARG');
    }
    if (output && segmentsDirectory) {
      fail('listen --source microphone accepts only one of --output or --segments', 'INVALID_ARG');
    }
    if (output && args.includes('--segment-duration')) {
      fail('listen --segment-duration requires --segments', 'INVALID_ARG');
    }
    if (output && args.includes('--ready-cue')) {
      fail('listen --ready-cue requires --segments', 'INVALID_ARG');
    }
    if (segmentsDirectory) {
      await followVoice({
        service: 'listen',
        action: 'microphone_segmented',
        data: {
          segments_directory: segmentsDirectory,
          segment_duration_seconds: parseSegmentDuration(valueAfter(args, '--segment-duration')),
          max_duration_seconds: parseDuration(valueAfter(args, '--max-duration')),
          ready_cue: parseReadyCue(valueAfter(args, '--ready-cue')),
        },
        stopAction: { service: 'listen', action: 'stop' },
        cancelAction: { service: 'listen', action: 'cancel' },
        requiresExternalSpawnBinding: true,
      });
      return;
    }
    await followVoice({
      service: 'listen',
      action: 'microphone',
      data: {
        output,
        max_duration_seconds: parseDuration(valueAfter(args, '--max-duration')),
      },
      stopAction: { service: 'listen', action: 'stop' },
      cancelAction: { service: 'listen', action: 'cancel' },
      requiresExternalSpawnBinding: true,
    });
    return;
  }
  fail('listen --source must be hotkey or microphone', 'INVALID_ARG');
}

export async function sayFollow(args) {
  assertOnlyFlags(args, new Set(['--voice', '--rate']), new Set(['--follow']));
  if (!args.includes('--follow')) fail('say follow requires --follow', 'MISSING_ARG');
  if (process.stdin.isTTY) fail('say --follow reads speech text from stdin', 'MISSING_ARG');
  const bytes = await readSpeechInput();
  if (bytes === null || process.ppid !== externalDispatchParentPID) return;
  if (bytes.length === 0 || bytes.length > MAX_SPEECH_BYTES) {
    fail('say --follow stdin must contain 1 to 65536 bytes', 'INVALID_SPEECH_TEXT');
  }
  const text = bytes.toString('utf8');
  const rateValue = valueAfter(args, '--rate');
  const rate = rateValue === undefined ? undefined : Number(rateValue);
  if (rate !== undefined && (!Number.isFinite(rate) || rate < 80 || rate > 450)) {
    fail('say --rate requires a numeric value from 80 to 450 WPM', 'INVALID_SPEECH_RATE');
  }
  const data = { text };
  const voice = valueAfter(args, '--voice');
  if (voice) data.voice_id = voice;
  if (rate !== undefined) data.rate_wpm = rate;
  await followVoice({
    service: 'voice',
    action: 'speak',
    data,
    stopAction: { service: 'voice', action: 'cancel' },
    cancelAction: { service: 'voice', action: 'cancel' },
  });
}

export async function playAudioFollow(args) {
  assertOnlyFlags(args, new Set(['--audio']), new Set(['--follow']));
  if (!args.includes('--follow')) fail('audio playback requires --follow', 'MISSING_ARG');
  const audioPath = valueAfter(args, '--audio');
  if (!audioPath) fail('audio playback requires --audio', 'MISSING_ARG');
  if (!audioPath.startsWith('/')) fail('audio playback input must be absolute', 'INVALID_AUDIO_PATH');
  await followVoice({
    service: 'voice',
    action: 'playback',
    data: { audio_path: audioPath },
    stopAction: { service: 'voice', action: 'cancel' },
    cancelAction: { service: 'voice', action: 'cancel' },
  });
}

export function voiceCLIErrorEnvelope(error) {
  const candidate = typeof error?.code === 'string' ? error.code : '';
  const code = /^[A-Z][A-Z0-9_]{1,63}$/.test(candidate) ? candidate : 'VOICE_TRANSPORT_FAILED';
  return {
    code,
    error: SAFE_DAEMON_ERRORS.get(code) ?? SAFE_CLI_ERRORS.get(code) ?? 'voice transport failed',
  };
}

export function writeVoiceCLIError(error) {
  process.stderr.write(`${JSON.stringify(voiceCLIErrorEnvelope(error))}\n`);
  process.exitCode = 1;
}
