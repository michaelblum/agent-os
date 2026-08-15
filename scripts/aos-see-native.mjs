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
import {
  TargetHandleError,
  emitTargetHandleError,
  recordBrowserCaptureGeneration,
} from './lib/target-handle-runtime.mjs';
import { managedSessionIdentity } from './lib/browser-companion/session-lifecycle.mjs';
import {
  BrowserCaptureOptionError,
  validateBrowserCaptureOptions,
} from './lib/browser-companion/see-capture-options.mjs';
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

async function reviewedBrowserRuntime(session) {
  try { return await managedSessionIdentity(session); }
  catch (error) { throw new TargetHandleError(error?.code || 'TARGET_ACTION_UNSUPPORTED', 'managed browser backend unavailable'); }
}

async function runNativePrimitive(primitive, args, browserSession = null, backendIdentity = null) {
  const ownerPid = process.ppid;
  const child = spawn(process.execPath, [aosSeeChildRunnerPath, primitive, ...args], {
    detached: true,
    env: aosSeeGuardianEnvironment(process.env, ownerPid, aosPath()),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const captureChunks = [];
  let captureBytes = 0;
  const maxCaptureBytes = 32 * 1024 * 1024;
  child.stdout.on('data', (chunk) => {
    if (browserSession && captureBytes <= maxCaptureBytes) {
      captureBytes += chunk.length;
      if (captureBytes <= maxCaptureBytes) captureChunks.push(chunk);
    }
  });
  if (!browserSession) child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);

  const flushBrowserStdout = () => {
    if (browserSession && captureBytes <= maxCaptureBytes && captureChunks.length > 0) {
      process.stdout.write(Buffer.concat(captureChunks));
    }
  };

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
    flushBrowserStdout();
    process.stderr.write(`${JSON.stringify({
      code: 'NATIVE_CAPTURE_LAUNCH_FAILED',
      error: result.cause instanceof Error ? result.cause.message : String(result.cause),
    })}\n`);
    return 1;
  }
  if (requestedSignal !== null) {
    flushBrowserStdout();
    return SIGNAL_EXIT_CODES.get(requestedSignal) ?? 1;
  }
  if (result.signal !== null) {
    flushBrowserStdout();
    return SIGNAL_EXIT_CODES.get(result.signal) ?? 1;
  }
  if ((result.code ?? 1) === 0 && browserSession) {
    try {
      if (captureBytes > maxCaptureBytes) {
        throw new TargetHandleError('TARGET_HANDLE_INVALID', 'browser capture exceeds the bounded generation output limit');
      }
      const verifiedAfterCapture = (await reviewedBrowserRuntime(browserSession)).backend_identity;
      if (JSON.stringify(verifiedAfterCapture) !== JSON.stringify(backendIdentity)) {
        throw new TargetHandleError('TARGET_STATE_STALE', 'browser backend identity changed while capture was running');
      }
      recordBrowserCaptureGeneration(
        browserSession,
        JSON.parse(Buffer.concat(captureChunks).toString('utf8')),
        process.env,
        backendIdentity,
      );
      flushBrowserStdout();
    } catch (error) {
      emitTargetHandleError(error);
      return 1;
    }
  }
  if ((result.code ?? 1) !== 0) flushBrowserStdout();
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
  const browserCapture = primitive === 'capture'
    ? validateBrowserCaptureOptions(savedCapture)
    : null;
  if (['cursor', 'list', 'selection'].includes(primitive)) parseNoArgPrimitive(primitive, args);

  if (primitive === 'capture' && savedCapture?.options.save) {
    await savedCaptureCommand(args, savedCapture);
    process.exit(0);
  }

  const browserSession = browserCapture?.session ?? null;
  const backendIdentity = browserSession ? (await reviewedBrowserRuntime(browserSession)).backend_identity : null;
  process.exitCode = await runNativePrimitive(primitive, args, browserSession, backendIdentity);
} catch (err) {
  if (isAgentWorkspaceError(err)) emitAgentWorkspaceError(err);
  else if (err instanceof TargetHandleError) {
    emitTargetHandleError(err);
    process.exitCode = 1;
  }
  else if (err instanceof BrowserCaptureOptionError) error(err.message, err.code);
  else throw err;
}
