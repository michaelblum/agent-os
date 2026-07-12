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
  'speech_finished',
  'speech_canceled',
  'speech_failed',
]);
const FAILURE_EVENTS = new Set(['capture_failed', 'speech_failed']);
const SAFE_DAEMON_ERRORS = new Map([
  ['MICROPHONE_PERMISSION_DENIED', 'microphone permission is not granted'],
  ['MICROPHONE_UNAVAILABLE', 'microphone input is unavailable'],
  ['HOTKEY_LEASE_BUSY', 'a voice hotkey listener is already active'],
  ['CAPTURE_LEASE_BUSY', 'microphone capture is already active'],
  ['SPEECH_LEASE_BUSY', 'speech playback is already active'],
  ['CAPTURE_ACTIVE', 'speech cannot start during microphone capture'],
  ['INVALID_SHORTCUT', 'unsupported voice shortcut'],
  ['INVALID_OUTPUT_PATH', 'voice capture output path is invalid'],
  ['UNSAFE_OUTPUT_PARENT', 'voice capture output parent is unsafe'],
  ['OUTPUT_EXISTS', 'voice capture output must not already exist'],
  ['OUTPUT_CREATE_FAILED', 'voice capture output could not be created'],
  ['INVALID_SPEECH_TEXT', 'speech input is invalid'],
  ['INVALID_SPEECH_RATE', 'speech rate is invalid'],
  ['INVALID_VOICE_ID', 'voice identifier is malformed'],
  ['INVALID_VOICE_PROVIDER', 'streamed speech requires a system voice'],
  ['VOICE_NOT_FOUND', 'requested system voice is unavailable'],
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
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 120) {
    fail('listen --max-duration must be between 1ms and 120s', 'INVALID_ARG');
  }
  return seconds;
}

function request(service, action, data, ref) {
  return `${JSON.stringify({ v: 1, service, action, data, ref })}\n`;
}

function monitorExternalDispatchParent(onDisconnect) {
  const parentPID = Number(process.env[EXTERNAL_DISPATCH_PARENT_PID_ENV]);
  if (!Number.isInteger(parentPID) || parentPID <= 1) return null;
  const timer = setInterval(() => {
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

async function followVoice({ service, action, data, stopAction, cancelAction, terminalEvents = TERMINAL_EVENTS }) {
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
      process.stderr.write(`${JSON.stringify({ code: 'VOICE_EVENT_TOO_LARGE', error: 'voice event exceeded the line limit' })}\n`);
      cleanup(1);
      return;
    }
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (Buffer.byteLength(line) > MAX_LINE_BYTES) {
        process.stderr.write(`${JSON.stringify({ code: 'VOICE_EVENT_TOO_LARGE', error: 'voice event exceeded the line limit' })}\n`);
        cleanup(1);
        return;
      }
      let payload;
      try {
        payload = JSON.parse(line);
      } catch {
        process.stderr.write(`${JSON.stringify({ code: 'INVALID_VOICE_EVENT', error: 'daemon returned malformed JSON' })}\n`);
        cleanup(1);
        return;
      }
      if (payload.status === 'error' || payload.error) {
        const code = payload.code ?? 'VOICE_TRANSPORT_FAILED';
        process.stderr.write(`${JSON.stringify({ code, error: SAFE_DAEMON_ERRORS.get(code) ?? 'voice transport failed' })}\n`);
        cleanup(1);
        return;
      }
      if (payload.v !== 1 || payload.service !== 'voice' || typeof payload.event !== 'string') continue;
      process.stdout.write(`${JSON.stringify(payload)}\n`);
      if (terminalEvents.has(payload.event)) cleanup(FAILURE_EVENTS.has(payload.event) ? 1 : 0);
    }
  });
  socket.once('error', () => cleanup(1));
  socket.once('close', () => cleanup(controlSent ? 0 : 1));
  socket.write(request(service, action, data, ref));
}

export async function listenVoice(args) {
  assertOnlyFlags(
    args,
    new Set(['--source', '--shortcut', '--output', '--max-duration']),
    new Set(['--follow']),
  );
  if (!args.includes('--follow')) fail('voice listen sources require --follow', 'MISSING_ARG');
  const source = valueAfter(args, '--source');
  if (source === 'hotkey') {
    if (args.includes('--output') || args.includes('--max-duration')) fail('hotkey listen does not accept microphone flags', 'INVALID_ARG');
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
    if (!output) fail('listen --source microphone requires --output', 'MISSING_ARG');
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

export function writeVoiceCLIError(error) {
  process.stderr.write(`${JSON.stringify({ code: error?.code ?? 'VOICE_TRANSPORT_FAILED', error: error?.message ?? 'voice transport failed' })}\n`);
  process.exitCode = 1;
}
