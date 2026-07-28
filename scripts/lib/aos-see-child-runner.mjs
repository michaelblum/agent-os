#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';

const ALLOWED_PRIMITIVES = new Set(['capture', 'cursor', 'list', 'selection']);
const SIGNAL_EXIT_CODES = new Map([
  ['SIGHUP', 129],
  ['SIGINT', 130],
  ['SIGTERM', 143],
]);
const CHILD_SHUTDOWN_GRACE_MS = 1_000;
const OWNER_LIVENESS_POLL_MS = 250;

function fail(message, code) {
  process.stderr.write(`${JSON.stringify({ code, error: message })}\n`);
  process.exit(1);
}

function positivePID(value) {
  if (!/^[1-9][0-9]*$/u.test(String(value ?? ''))) return null;
  const pid = Number(value);
  return Number.isSafeInteger(pid) && pid > 1 ? pid : null;
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return cause?.code !== 'ESRCH';
  }
}

function parentPID(pid) {
  const result = spawnSync('/bin/ps', ['-p', String(pid), '-o', 'ppid='], {
    encoding: 'utf8',
    timeout: 500,
  });
  if (result.status !== 0) return null;
  return positivePID(result.stdout.trim());
}

const [primitive, ...args] = process.argv.slice(2);
if (!ALLOWED_PRIMITIVES.has(primitive)) fail('native see child runner received an invalid primitive', 'INVALID_ARGUMENT');
const wrapperPID = process.ppid;
const ownerPID = positivePID(process.env.AOS_INTERNAL_SEE_OWNER_PID);
if (wrapperPID <= 1 || ownerPID === null) fail('native see child runner requires an exact owner relationship', 'INVALID_OWNER');

const childEnv = { ...process.env };
delete childEnv.AOS_INTERNAL_SEE_OWNER_PID;
const child = spawn(process.env.AOS_PATH || './aos', ['__see', primitive, ...args], {
  env: childEnv,
  stdio: 'inherit',
});

let closed = false;
let requestedSignal = null;
let escalationTimer = null;
const requestShutdown = (signal) => {
  if (closed || requestedSignal !== null) return;
  requestedSignal = signal;
  child.kill(signal);
  escalationTimer = setTimeout(() => {
    if (!closed) child.kill('SIGKILL');
  }, CHILD_SHUTDOWN_GRACE_MS);
};
const signalHandlers = new Map(
  [...SIGNAL_EXIT_CODES.keys()].map((signal) => {
    const handler = () => requestShutdown(signal);
    process.once(signal, handler);
    return [signal, handler];
  }),
);
const releaseOnExit = () => {
  if (!closed) child.kill('SIGKILL');
};
process.once('exit', releaseOnExit);
const ownerMonitor = setInterval(() => {
  if (
    process.ppid !== wrapperPID
    || !processExists(wrapperPID)
    || !processExists(ownerPID)
    || parentPID(wrapperPID) !== ownerPID
  ) requestShutdown('SIGTERM');
}, OWNER_LIVENESS_POLL_MS);

const result = await new Promise((resolve) => {
  child.once('error', (cause) => resolve({ cause, code: null, signal: null }));
  child.once('close', (code, signal) => resolve({ cause: null, code, signal }));
});
closed = true;
clearInterval(ownerMonitor);
if (escalationTimer !== null) clearTimeout(escalationTimer);
for (const [signal, handler] of signalHandlers) process.off(signal, handler);
process.off('exit', releaseOnExit);

if (result.cause) {
  process.stderr.write(`${JSON.stringify({
    code: 'NATIVE_CAPTURE_LAUNCH_FAILED',
    error: result.cause instanceof Error ? result.cause.message : String(result.cause),
  })}\n`);
  process.exitCode = 1;
} else if (requestedSignal !== null) {
  process.exitCode = SIGNAL_EXIT_CODES.get(requestedSignal) ?? 1;
} else if (result.signal !== null) {
  process.exitCode = SIGNAL_EXIT_CODES.get(result.signal) ?? 1;
} else {
  process.exitCode = result.code ?? 1;
}
