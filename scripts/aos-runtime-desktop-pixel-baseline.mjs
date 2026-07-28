#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { aosPath, currentMode } from './lib/aos-cli.mjs';

const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_RUNTIME_MS = 20_000;
const TERMINATION_GRACE_MS = 1_000;

function fail(message, code) {
  process.stderr.write(`${JSON.stringify({ code, error: message }, null, 2)}\n`);
  process.exit(1);
}

function parseArgs(args) {
  const forwarded = [];
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      if (seen.has(arg)) fail('--json may be provided only once', 'DUPLICATE_FLAG');
      seen.add(arg);
      forwarded.push(arg);
      continue;
    }
    if (arg === '--hold-ms') {
      if (seen.has(arg)) fail('--hold-ms may be provided only once', 'DUPLICATE_FLAG');
      seen.add(arg);
      const value = args[index + 1];
      if (!/^\d+$/.test(value ?? '') || Number(value) < 50 || Number(value) > 5000) {
        fail('--hold-ms must be an integer from 50 through 5000', 'INVALID_ARG');
      }
      forwarded.push(arg, value);
      index += 1;
      continue;
    }
    if (arg === '--presentation') {
      if (seen.has(arg)) fail('--presentation may be provided only once', 'DUPLICATE_FLAG');
      seen.add(arg);
      const value = args[index + 1];
      if (!['identity', 'inverted'].includes(value)) {
        fail('--presentation must be identity or inverted', 'INVALID_ARG');
      }
      forwarded.push(arg, value);
      index += 1;
      continue;
    }
    fail(`Unknown argument: ${arg}`, 'UNKNOWN_ARG');
  }
  if (!seen.has('--json')) fail('--json is required', 'MISSING_ARG');
  return forwarded;
}

function appendBounded(chunks, chunk, currentBytes) {
  const remaining = MAX_OUTPUT_BYTES - currentBytes;
  if (remaining <= 0) return { bytes: currentBytes, exceeded: true };
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  chunks.push(buffer.subarray(0, remaining));
  return {
    bytes: currentBytes + Math.min(buffer.length, remaining),
    exceeded: buffer.length > remaining,
  };
}

async function runNativeBaseline(args) {
  const child = spawn(aosPath(), ['__desktop-pixel-native-baseline', ...args], {
    detached: true,
    env: { ...process.env, AOS_RUNTIME_MODE: currentMode() },
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = [];
  const stderr = [];
  let outputBytes = 0;
  let outputExceeded = false;
  let terminationReason = null;
  let escalationTimer = null;

  const signalChildGroup = (signal) => {
    try {
      process.kill(-child.pid, signal);
    } catch {
      child.kill(signal);
    }
  };
  const terminate = (reason, signal = 'SIGTERM') => {
    if (terminationReason !== null) return;
    terminationReason = reason;
    signalChildGroup(signal);
    escalationTimer = setTimeout(() => signalChildGroup('SIGKILL'), TERMINATION_GRACE_MS);
  };
  const collect = (chunks) => (chunk) => {
    const result = appendBounded(chunks, chunk, outputBytes);
    outputBytes = result.bytes;
    if (result.exceeded && !outputExceeded) {
      outputExceeded = true;
      terminate('output_limit');
    }
  };
  child.stdout.on('data', collect(stdout));
  child.stderr.on('data', collect(stderr));

  const requestInterrupt = () => terminate('SIGINT', 'SIGINT');
  const requestTermination = () => terminate('SIGTERM', 'SIGTERM');
  process.once('SIGINT', requestInterrupt);
  process.once('SIGTERM', requestTermination);

  const expectedParent = Number(process.env.AOS_EXTERNAL_DISPATCH_PARENT_PID);
  const parentMonitor = Number.isInteger(expectedParent) && expectedParent > 1
    ? setInterval(() => {
      try {
        if (process.ppid !== expectedParent) throw new Error('parent changed');
        process.kill(expectedParent, 0);
      } catch {
        terminate('parent_lost');
      }
    }, 250)
    : null;
  parentMonitor?.unref();
  const runtimeTimer = setTimeout(() => terminate('timeout'), MAX_RUNTIME_MS);

  let result;
  try {
    result = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
  } finally {
    clearTimeout(runtimeTimer);
    if (escalationTimer !== null) clearTimeout(escalationTimer);
    if (parentMonitor !== null) clearInterval(parentMonitor);
    process.off('SIGINT', requestInterrupt);
    process.off('SIGTERM', requestTermination);
  }

  const stdoutBuffer = Buffer.concat(stdout);
  const stderrBuffer = Buffer.concat(stderr);
  if (stdoutBuffer.length > 0) process.stdout.write(stdoutBuffer);
  if (stderrBuffer.length > 0) process.stderr.write(stderrBuffer);
  if (outputExceeded) fail('Native desktop-pixel proof output exceeded 64 KiB', 'DESKTOP_PIXEL_BASELINE_OUTPUT_LIMIT');
  if (terminationReason === 'timeout') fail('Native desktop-pixel proof exceeded 20 seconds', 'DESKTOP_PIXEL_BASELINE_TIMEOUT');
  if (terminationReason === 'parent_lost') fail('Native desktop-pixel proof lost its dispatch owner', 'DESKTOP_PIXEL_BASELINE_PARENT_LOST');
  if (terminationReason === 'SIGINT') process.exit(130);
  if (terminationReason === 'SIGTERM') process.exit(143);
  process.exit(result.code ?? (result.signal ? 1 : 0));
}

await runNativeBaseline(parseArgs(process.argv.slice(2)));
