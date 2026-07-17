import { spawn } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_SHORTCUT_NAME_BYTES = 256;

function failure(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function valueAfter(args, token) {
  const index = args.indexOf(token);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw failure(`${token} requires a value`, 'MISSING_ARG');
  return value;
}

function parseDuration(value) {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  const match = /^(\d+(?:\.\d+)?)(ms|s)?$/.exec(value);
  if (!match) throw failure('--timeout must be a duration from 1s to 120s', 'INVALID_TIMEOUT');
  const amount = Number(match[1]);
  const milliseconds = match[2] === 'ms' ? amount : amount * 1000;
  if (!Number.isFinite(milliseconds) || milliseconds < 1000 || milliseconds > MAX_TIMEOUT_MS) {
    throw failure('--timeout must be a duration from 1s to 120s', 'INVALID_TIMEOUT');
  }
  return Math.floor(milliseconds);
}

export function parseShortcutRunArgs(args) {
  const [command, ...rest] = args;
  if (command !== 'run') {
    throw failure(command ? `Unknown shortcut subcommand: ${command}` : 'shortcut requires a subcommand', command ? 'UNKNOWN_SUBCOMMAND' : 'MISSING_SUBCOMMAND');
  }

  const positionals = [];
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--json') continue;
    if (arg === '--timeout') {
      index += 1;
      if (index >= rest.length || rest[index].startsWith('--')) {
        throw failure('--timeout requires a value', 'MISSING_ARG');
      }
      continue;
    }
    if (arg.startsWith('--')) throw failure(`Unknown flag: ${arg}`, 'UNKNOWN_FLAG');
    positionals.push(arg);
  }

  if (positionals.length === 0) throw failure('shortcut run requires a shortcut name', 'MISSING_ARG');
  if (positionals.length > 1) throw failure('shortcut run accepts exactly one shortcut name', 'UNKNOWN_ARG');
  const name = positionals[0].trim();
  if (!name || name.includes('\0') || Buffer.byteLength(name) > MAX_SHORTCUT_NAME_BYTES) {
    throw failure('shortcut name must contain 1 to 256 UTF-8 bytes', 'INVALID_SHORTCUT_NAME');
  }
  return {
    name,
    timeoutMs: parseDuration(valueAfter(rest, '--timeout')),
  };
}

export async function runAppleShortcut({
  name,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal,
  executable = '/usr/bin/shortcuts',
  spawnImpl = spawn,
}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > MAX_TIMEOUT_MS) {
    throw failure('shortcut timeout must be from 1000 to 120000 milliseconds', 'INVALID_TIMEOUT');
  }

  const startedAt = Date.now();
  const child = spawnImpl(executable, ['run', name], {
    env: process.env,
    detached: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let outputExceeded = false;
  let timedOut = false;
  let aborted = false;
  let escalationTimer = null;

  const signalProcessGroup = (signalName) => {
    try {
      process.kill(-child.pid, signalName);
    } catch {
      child.kill(signalName);
    }
  };

  const terminate = () => {
    signalProcessGroup('SIGTERM');
    if (escalationTimer === null) {
      escalationTimer = setTimeout(() => signalProcessGroup('SIGKILL'), 1_000);
    }
  };

  const count = (stream, kind) => {
    stream?.on('data', (chunk) => {
      const bytes = Buffer.byteLength(chunk);
      if (kind === 'stdout') stdoutBytes += bytes;
      else stderrBytes += bytes;
      if (!outputExceeded && stdoutBytes + stderrBytes > MAX_OUTPUT_BYTES) {
        outputExceeded = true;
        terminate();
      }
    });
  };
  count(child.stdout, 'stdout');
  count(child.stderr, 'stderr');

  const abort = () => {
    aborted = true;
    terminate();
  };
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });

  const timer = setTimeout(() => {
    timedOut = true;
    terminate();
  }, timeoutMs);
  timer.unref();

  try {
    const result = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, childSignal) => resolve({ code, signal: childSignal }));
    });
    if (aborted) throw failure('Apple Shortcut execution was canceled', 'SHORTCUT_CANCELED');
    if (timedOut) throw failure('Apple Shortcut execution timed out', 'SHORTCUT_TIMEOUT');
    if (outputExceeded) throw failure('Apple Shortcut output exceeded the limit', 'SHORTCUT_OUTPUT_LIMIT');
    if (result.code !== 0) throw failure('Apple Shortcut execution failed', 'SHORTCUT_FAILED');
    return {
      status: 'ok',
      duration_ms: Date.now() - startedAt,
      output: {
        stdout_bytes: stdoutBytes,
        stderr_bytes: stderrBytes,
      },
    };
  } finally {
    clearTimeout(timer);
    if (escalationTimer !== null) clearTimeout(escalationTimer);
    signal?.removeEventListener('abort', abort);
  }
}
