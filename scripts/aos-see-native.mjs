#!/usr/bin/env node

import { spawn } from 'node:child_process';
import {
  emitAgentWorkspaceError,
  isAgentWorkspaceError,
  parseCaptureArgs,
  savedCaptureCommand,
} from './lib/aos-agent-workspace.mjs';
import {
  aosSeeChildRunnerPath,
  aosSeeGuardianEnvironment,
  retireAosSeeProcessGroup,
} from './lib/aos-see-supervision.mjs';

function error(message, code) {
  process.stderr.write(`${JSON.stringify({ code, error: message })}\n`);
  process.exit(1);
}

function aosPath() {
  return process.env.AOS_PATH || './aos';
}

const SIGNAL_EXIT_CODES = new Map([
  ['SIGHUP', 129],
  ['SIGINT', 130],
  ['SIGTERM', 143],
]);
const GUARDIAN_SHUTDOWN_GRACE_MS = 2_500;
const PARENT_LIVENESS_POLL_MS = 250;

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return cause?.code !== 'ESRCH';
  }
}

async function runNativePrimitive(primitive, args) {
  const ownerPid = process.ppid;
  const child = spawn(process.execPath, [aosSeeChildRunnerPath, primitive, ...args], {
    detached: true,
    env: aosSeeGuardianEnvironment(process.env, ownerPid, aosPath()),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);

  let closed = false;
  let requestedSignal = null;
  let escalationTimer = null;
  const requestShutdown = (signal) => {
    if (closed || requestedSignal !== null) return;
    requestedSignal = signal;
    child.kill(signal);
    escalationTimer = setTimeout(() => {
      if (!closed) retireAosSeeProcessGroup(child.pid);
    }, GUARDIAN_SHUTDOWN_GRACE_MS);
  };
  const signalHandlers = new Map(
    [...SIGNAL_EXIT_CODES.keys()].map((signal) => {
      const handler = () => requestShutdown(signal);
      process.once(signal, handler);
      return [signal, handler];
    }),
  );
  const releaseOnParentExit = () => {
    if (!closed) retireAosSeeProcessGroup(child.pid);
  };
  process.once('exit', releaseOnParentExit);
  const parentMonitor = setInterval(() => {
    if (ownerPid <= 1 || process.ppid !== ownerPid || !processExists(ownerPid)) requestShutdown('SIGTERM');
  }, PARENT_LIVENESS_POLL_MS);

  const result = await new Promise((resolve) => {
    child.once('error', (cause) => resolve({ cause, code: null, signal: null }));
    child.once('close', (code, signal) => resolve({ cause: null, code, signal }));
  });
  closed = true;
  clearInterval(parentMonitor);
  if (escalationTimer !== null) clearTimeout(escalationTimer);
  for (const [signal, handler] of signalHandlers) process.off(signal, handler);
  process.off('exit', releaseOnParentExit);

  if (result.signal !== null || result.cause) retireAosSeeProcessGroup(child.pid);

  if (result.cause) {
    process.stderr.write(`${JSON.stringify({
      code: 'NATIVE_CAPTURE_LAUNCH_FAILED',
      error: result.cause instanceof Error ? result.cause.message : String(result.cause),
    })}\n`);
    return 1;
  }
  if (requestedSignal !== null) return SIGNAL_EXIT_CODES.get(requestedSignal) ?? 1;
  if (result.signal !== null) return SIGNAL_EXIT_CODES.get(result.signal) ?? 1;
  return result.code ?? 1;
}

function parseNoArgPrimitive(primitive, args) {
  for (const arg of args) {
    if (arg === '--json') continue;
    if (String(arg).startsWith('--')) error(`Unknown see ${primitive} flag: ${arg}`, 'UNKNOWN_FLAG');
    error(`Unknown see ${primitive} argument: ${arg}`, 'UNKNOWN_ARG');
  }
}

try {
  const [primitive, ...args] = process.argv.slice(2);
  if (!primitive) error('see native wrapper requires a primitive', 'MISSING_ARG');
  if (!['capture', 'cursor', 'list', 'selection'].includes(primitive)) {
    error(`Unknown see native primitive: ${primitive}`, 'UNKNOWN_SUBCOMMAND');
  }
  let savedCapture = null;
  if (primitive === 'capture') {
    savedCapture = parseCaptureArgs(args);
    if (savedCapture.errors.length) {
      const first = savedCapture.errors[0];
      error(first.error, first.code);
    }
  }
  if (['cursor', 'list', 'selection'].includes(primitive)) parseNoArgPrimitive(primitive, args);

  if (primitive === 'capture' && savedCapture?.options.save) {
    await savedCaptureCommand(args, savedCapture);
    process.exit(0);
  }

  process.exitCode = await runNativePrimitive(primitive, args);
} catch (err) {
  if (isAgentWorkspaceError(err)) emitAgentWorkspaceError(err);
  throw err;
}
