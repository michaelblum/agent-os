import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const CONTROL_SCHEMA = 'aos.browser.worker-group-control.v1';
const ACTIVATION_SCHEMA = 'aos.browser.worker-group-activation.v1';
const MAX_CONTROL_BYTES = 4 * 1024;
const MAX_REQUEST_BYTES = 256 * 1024;
const TERM_GRACE_MS = 1_000;
const RETIREMENT_NONCE = /^[a-f0-9]{32}$/u;

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function writeControl(event, fields = {}) {
  const bytes = Buffer.from(`${JSON.stringify({ schema_version: CONTROL_SCHEMA, event, sentinel_pid: process.pid, ...fields })}\n`);
  if (bytes.length > MAX_CONTROL_BYTES) throw new Error('worker group control exceeds limit');
  if (fs.writeSync(3, bytes) !== bytes.length) throw new Error('worker group control write is short');
}

export function readOneJSON(stream, maximum) {
  return new Promise((resolve, reject) => {
    let combined = Buffer.alloc(0);
    let settled = false;
    const cleanup = () => {
      stream.off('data', onData);
      stream.off('error', onError);
      stream.off('end', onEnd);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onError = (error) => fail(error);
    const onEnd = () => {
      if (settled) return;
      try {
        const newline = combined.indexOf(0x0a);
        if (newline <= 0 || newline !== combined.length - 1) throw new Error('worker group frame differs');
        const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(combined.subarray(0, newline)));
        settled = true;
        cleanup();
        resolve(value);
      } catch (error) { fail(error); }
    };
    const onData = (chunk) => {
      if (settled) return;
      combined = Buffer.concat([combined, chunk]);
      if (combined.length > maximum) return fail(new Error('worker group frame exceeds limit'));
    };
    stream.on('data', onData);
    stream.once('error', onError);
    stream.once('end', onEnd);
    stream.resume();
  });
}

function activationReader(stream, onFrame, onLost) {
  let buffer = Buffer.alloc(0);
  let total = 0;
  stream.on('data', (chunk) => {
    total += chunk.length;
    if (total > MAX_CONTROL_BYTES * 4) return onLost();
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const newline = buffer.indexOf(0x0a);
      if (newline < 0) break;
      if (newline <= 0 || newline > MAX_CONTROL_BYTES) return onLost();
      try { onFrame(JSON.parse(buffer.subarray(0, newline).toString('utf8'))); }
      catch { onLost(); }
      buffer = buffer.subarray(newline + 1);
    }
  });
  stream.once('end', onLost);
  stream.once('close', onLost);
  stream.once('error', onLost);
  stream.resume();
}

function validateRequest(value) {
  const keys = ['entrypoint', 'argv', 'cwd', 'env', 'max_output_bytes'];
  if (!exactKeys(value, keys) || typeof value.entrypoint !== 'string'
    || !path.isAbsolute(value.entrypoint) || value.entrypoint.length > 4096
    || !Array.isArray(value.argv) || value.argv.length > 64
    || value.argv.some((item) => typeof item !== 'string' || Buffer.byteLength(item) > 64 * 1024)
    || typeof value.cwd !== 'string' || !path.isAbsolute(value.cwd) || value.cwd.length > 4096
    || !value.env || typeof value.env !== 'object'
    || Array.isArray(value.env) || !Number.isSafeInteger(value.max_output_bytes)
    || Object.keys(value.env).length > 32
    || Object.entries(value.env).some(([key, item]) => !/^[A-Z][A-Z0-9_]{0,63}$/u.test(key)
      || typeof item !== 'string' || Buffer.byteLength(item) > 64 * 1024)
    || value.max_output_bytes <= 0 || value.max_output_bytes > 64 * 1024) {
    throw new Error('worker group request differs');
  }
  return value;
}

export async function runWorkerGroupSentinel(options = {}) {
  process.on('SIGTERM', () => {});
  const activation = fs.createReadStream(null, { fd: 4, autoClose: false });
  let forced = false;
  let completed = false;
  let executed = false;
  let child = null;
  let workerSpawned = false;
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let retirementNonce = null;
  let retirementRequested = false;
  let retirementReason = null;
  let discardRaw = false;
  let rawCapped = false;
  let emergencyScheduled = false;
  const emergencyKill = () => {
    if (emergencyScheduled) return;
    emergencyScheduled = true;
    forced = true;
    try { process.kill(0, 'SIGTERM'); } catch {}
    setTimeout(() => {
      try { process.kill(0, 'SIGKILL'); } catch { process.exit(1); }
    }, TERM_GRACE_MS);
  };
  const publishControl = (event, fields = {}) => {
    try { writeControl(event, fields); return true; }
    catch { emergencyKill(); return false; }
  };
  const resumeChildRaw = () => {
    for (const source of [child?.stdout, child?.stderr]) if (source?.isPaused()) source.resume();
  };
  const requestRetirement = (reason) => {
    if (retirementRequested || forced) return;
    retirementRequested = true;
    retirementReason = reason;
    discardRaw = true;
    resumeChildRaw();
    if (!publishControl('retirement_required', { reason })) emergencyKill();
  };
  const retire = (nonce) => {
    if (forced || !RETIREMENT_NONCE.test(nonce)) return emergencyKill();
    forced = true;
    discardRaw = true;
    resumeChildRaw();
    retirementNonce = nonce;
    if (!publishControl('term_armed', { nonce })) return emergencyKill();
    try { process.kill(0, 'SIGTERM'); } catch { process.exit(1); }
  };
  const killGroup = (nonce) => {
    if (!forced || nonce !== retirementNonce) return emergencyKill();
    try { writeControl('pre_kill', { nonce }); }
    finally {
      try {
        process.kill(0, 'SIGKILL');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
      } catch { process.exit(1); }
    }
  };
  const request = validateRequest(await readOneJSON(process.stdin, MAX_REQUEST_BYTES));
  const execute = new Promise((resolve) => {
    activationReader(activation, (value) => {
      const keys = ['retire', 'kill_group'].includes(value?.event)
        ? ['schema_version', 'event', 'nonce'] : ['schema_version', 'event'];
      if (!exactKeys(value, keys) || value.schema_version !== ACTIVATION_SCHEMA) return emergencyKill();
      if (value.event === 'retire') return retire(value.nonce);
      if (value.event === 'kill_group') return killGroup(value.nonce);
      if (value.event !== 'execute' || executed || forced) return emergencyKill();
      executed = true;
      resolve(true);
    }, () => { if (!completed) emergencyKill(); resolve(false); });
  });
  if (!publishControl('ready')) await new Promise(() => {});
  if (!await execute || forced) {
    if (!forced) {
      completed = true;
      publishControl('terminal', { kind: 'no_spawn', worker_spawned: false, exit_code: null, stdout_bytes: 0, stderr_bytes: 0 });
    }
    return;
  }
  const previousUmask = process.umask(0o077);
  try {
    child = (options.spawnWorker ?? spawn)(process.execPath, [request.entrypoint, ...request.argv], {
      cwd: request.cwd, env: request.env, detached: false,
      stdio: ['ignore', 'pipe', 'pipe', 'ignore', 'ignore'],
    });
  } finally {
    process.umask(previousUmask);
  }
  const sinkLost = () => {
    if (completed || forced) return;
    discardRaw = true;
    resumeChildRaw();
    if (!workerSpawned) { emergencyKill(); return; }
    requestRetirement('transport_lost');
  };
  process.stdout.once('error', sinkLost);
  process.stderr.once('error', sinkLost);
  process.stdout.once('close', sinkLost);
  process.stderr.once('close', sinkLost);
  const forward = (source, destination, stream) => source.on('data', (chunk) => {
    if (rawCapped) return;
    if (stdoutBytes + stderrBytes + chunk.length > request.max_output_bytes) {
      rawCapped = true;
      discardRaw = true;
      requestRetirement('output_cap');
      return;
    }
    if (stream === 'stdout') stdoutBytes += chunk.length;
    else stderrBytes += chunk.length;
    if (discardRaw) return;
    try {
      const accepted = destination.write(chunk, (error) => { if (error) sinkLost(); });
      if (!accepted && !discardRaw) {
        source.pause();
        destination.once('drain', () => { if (!discardRaw) source.resume(); });
      }
    }
    catch { sinkLost(); }
  });
  forward(child.stdout, process.stdout, 'stdout');
  forward(child.stderr, process.stderr, 'stderr');
  child.stdout.once('error', sinkLost);
  child.stderr.once('error', sinkLost);
  child.once('spawn', () => {
    workerSpawned = true;
    if (!publishControl('spawned')) emergencyKill();
  });
  child.once('error', () => {
    if (!forced && !retirementRequested && !workerSpawned) {
      completed = true;
      if (!publishControl('terminal', {
        kind: 'spawn_failed', worker_spawned: false, exit_code: null,
        stdout_bytes: stdoutBytes, stderr_bytes: stderrBytes,
      })) emergencyKill();
    }
  });
  await new Promise((resolve) => child.once('close', (code) => {
    if (!forced && !retirementRequested && !completed) {
      completed = true;
      if (!publishControl('terminal', {
        kind: code === 0 ? 'exited' : 'worker_failed', worker_spawned: workerSpawned,
        exit_code: Number.isInteger(code) ? code : null, stdout_bytes: stdoutBytes, stderr_bytes: stderrBytes,
      })) emergencyKill();
    }
    resolve();
  }));
  if (forced || retirementRequested || retirementReason) await new Promise(() => {});
}

export { ACTIVATION_SCHEMA as WORKER_GROUP_ACTIVATION_SCHEMA, CONTROL_SCHEMA as WORKER_GROUP_CONTROL_SCHEMA };
