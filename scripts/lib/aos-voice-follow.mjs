import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import {
  connectWithAutoStart,
  stopManagedDaemon,
} from './aos-daemon-client.mjs';

const MAX_LINE_BYTES = 16 * 1024;
const MAX_SPEECH_BYTES = 64 * 1024;
const EXTERNAL_DISPATCH_PARENT_PID_ENV = 'AOS_EXTERNAL_DISPATCH_PARENT_PID';
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

function monitorExternalDispatchParent(onDisconnect) {
  const parentPID = Number(process.env[EXTERNAL_DISPATCH_PARENT_PID_ENV]);
  if (!Number.isInteger(parentPID) || parentPID <= 1) return null;
  const testDelay = process.env.NODE_ENV === 'test'
    ? Number(process.env.AOS_TEST_PARENT_MONITOR_DELAY_MS ?? 0)
    : 0;
  const firstCheckAt = Date.now() + (Number.isFinite(testDelay) && testDelay > 0 ? Math.min(testDelay, 2_000) : 0);
  const timer = setInterval(() => {
    if (Date.now() < firstCheckAt) return;
    let alive = process.ppid === parentPID;
    if (alive) {
      try {
        process.kill(parentPID, 0);
      } catch {
        alive = false;
      }
    }
    if (!alive) onDisconnect();
  }, 250);
  timer.unref();
  return timer;
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
    if (!connection) {
      startupCanceled = true;
      startupAbort.abort();
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
  if (startupCanceled || startupAbort.signal.aborted) {
    await cleanup(0);
    return;
  }
  if (!socket) fail('Cannot connect to daemon', 'DAEMON_UNREACHABLE');

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
    new Set(['--source', '--shortcut', '--output', '--segments', '--segment-duration', '--max-duration', '--ready-cue']),
    new Set(['--follow']),
  );
  if (!args.includes('--follow')) fail('voice listen sources require --follow', 'MISSING_ARG');
  const source = valueAfter(args, '--source');
  if (source === 'hotkey') {
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
    });
    return;
  }
  fail('listen --source must be hotkey or microphone', 'INVALID_ARG');
}

export async function sayFollow(args) {
  assertOnlyFlags(args, new Set(['--voice', '--rate']), new Set(['--follow']));
  if (!args.includes('--follow')) fail('say follow requires --follow', 'MISSING_ARG');
  if (process.stdin.isTTY) fail('say --follow reads speech text from stdin', 'MISSING_ARG');
  const bytes = fs.readFileSync(0);
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
