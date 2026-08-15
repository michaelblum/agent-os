import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  WORKER_GROUP_ACTIVATION_SCHEMA,
  WORKER_GROUP_CONTROL_SCHEMA,
} from './worker-group-sentinel.mjs';

const SENTINEL_ENTRYPOINT = fileURLToPath(new URL('../../aos-browser-worker-group.mjs', import.meta.url));
const TERM_GRACE_MS = 1_000;
const RETIREMENT_PROOF_MS = 2_000;
const MAX_CONTROL_BYTES = 4 * 1024;
const MAX_CONTROL_TOTAL = 32 * 1024;
const TERMINAL_KINDS = new Set(['no_spawn', 'spawn_failed', 'exited', 'worker_failed']);

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function deferred() {
  let resolve;
  const promise = new Promise((accept) => { resolve = accept; });
  return Object.freeze({ promise, resolve });
}

function writeFrame(stream, value) {
  return new Promise((resolve, reject) => {
    try {
      stream.write(`${JSON.stringify(value)}\n`, (error) => error ? reject(error) : resolve());
    } catch (error) { reject(error); }
  });
}

function endBytes(stream, bytes) {
  return new Promise((resolve, reject) => {
    try { stream.end(bytes, (error) => error ? reject(error) : resolve()); }
    catch (error) { reject(error); }
  });
}

function boundedWitness(promise, invalid, message) {
  return Promise.race([
    promise,
    invalid.promise.then((error) => { throw error; }),
    delay(RETIREMENT_PROOF_MS).then(() => { throw new Error(message); }),
  ]);
}

async function retireProcessGroup(command, witness, streams) {
  await writeFrame(command, {
    schema_version: WORKER_GROUP_ACTIVATION_SCHEMA,
    event: 'retire',
    nonce: witness.nonce,
  });
  await boundedWitness(witness.termArmed.promise, witness.invalid, 'worker group TERM witness is absent');
  await boundedWitness(delay(TERM_GRACE_MS), witness.invalid, 'worker group TERM grace did not complete');
  writeFrame(command, {
    schema_version: WORKER_GROUP_ACTIVATION_SCHEMA,
    event: 'kill_group',
    nonce: witness.nonce,
  }).catch((error) => { witness.state.commandError ??= error; });
  try {
    await boundedWitness(witness.preKill.promise, witness.invalid, 'worker group pre-kill witness is absent');
  } catch (error) { throw witness.state.commandError ?? error; }
  const [exited] = await boundedWitness(Promise.all([
    streams.exited,
    streams.controlEnd,
    streams.stdoutEnd,
    streams.stderrEnd,
  ]), witness.invalid, 'worker group terminal stream closure is unproven');
  if (exited.code !== null || exited.signal !== 'SIGKILL') {
    throw new Error('worker group sentinel forced exit differs');
  }
}

function requestFrame(request, limits) {
  return `${JSON.stringify({
    entrypoint: request.entrypoint, argv: request.argv, cwd: request.cwd,
    env: request.env, max_output_bytes: limits.output_bytes,
  })}\n`;
}

export function runWorkerProcessGroup(request, limits, channels) {
  return new Promise((resolve, reject) => {
    let sentinel;
    try {
      sentinel = (channels.spawnSentinel ?? spawn)(process.execPath, [SENTINEL_ENTRYPOINT], {
        cwd: request.cwd, env: request.env, detached: true,
        stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
      });
    } catch {
      resolve(Object.freeze({ kind: 'spawn_failed', worker_spawned: false, exit_code: null, stdout_bytes: 0, stderr_bytes: 0, group_pid: null }));
      return;
    }
    let spawned = false;
    let ready = false;
    let terminal = null;
    let forcedKind = null;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let controlBytes = 0;
    let controlBuffer = Buffer.alloc(0);
    let retirement = null;
    let retirementWitness = null;
    let requestAuthoritative = true;
    let commandAuthoritative = true;
    let discardRaw = false;
    let rawCapped = false;
    let settled = false;
    let deadline;
    const sentinelExited = deferred();
    const stdoutEnd = deferred();
    const stderrEnd = deferred();
    const controlEnd = deferred();
    const rawSources = [sentinel.stdout, sentinel.stderr];
    const resumeRawSources = () => {
      for (const source of rawSources) if (source.isPaused()) source.resume();
    };
    const retireInput = () => {
      requestAuthoritative = false;
      try { sentinel.stdin.destroy(); } catch {}
    };
    const retireCommand = () => {
      commandAuthoritative = false;
      try { sentinel.stdio[4].end(); } catch {}
      try { sentinel.stdio[4].destroy(); } catch {}
    };
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve(Object.freeze({ ...value, group_pid: sentinel.pid }));
    };
    const force = (kind) => {
      if (settled) return;
      discardRaw = true;
      resumeRawSources();
      forcedKind ??= kind;
      if (!sentinel.pid || retirement) return;
      retirementWitness = Object.freeze({
        nonce: crypto.randomBytes(16).toString('hex'),
        termArmed: deferred(),
        preKill: deferred(),
        invalid: deferred(),
        state: {
          termArmed: false, preKill: false, commandRetired: false, commandError: null,
        },
      });
      retirement = retireProcessGroup(sentinel.stdio[4], retirementWitness, {
        exited: sentinelExited.promise,
        controlEnd: controlEnd.promise,
        stdoutEnd: stdoutEnd.promise,
        stderrEnd: stderrEnd.promise,
      }).then(
        () => finish({ kind: forcedKind, worker_spawned: spawned, exit_code: null, stdout_bytes: stdoutBytes, stderr_bytes: stderrBytes }),
        (error) => { settled = true; clearTimeout(deadline); reject(error); },
      );
    };
    const requestFailure = () => {
      if (!requestAuthoritative) return;
      retireInput();
      force('protocol_error');
    };
    const protocolFailure = (message = 'worker group protocol differs') => {
      const error = message instanceof Error ? message : new Error(message);
      if (retirementWitness) retirementWitness.invalid.resolve(error);
      else force('protocol_error');
    };
    const sinkLost = () => {
      if (settled || discardRaw) return;
      discardRaw = true;
      resumeRawSources();
      force('parent_lost');
    };
    const forward = (source, destination, stream) => source.on('data', (chunk) => {
      if (rawCapped) return;
      if (stdoutBytes + stderrBytes + chunk.length > limits.output_bytes) {
        rawCapped = true;
        discardRaw = true;
        force('output_cap');
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
    for (const destination of [channels.stdout, channels.stderr]) {
      destination.once('error', sinkLost);
      destination.once('close', sinkLost);
    }
    forward(sentinel.stdout, channels.stdout, 'stdout');
    forward(sentinel.stderr, channels.stderr, 'stderr');
    sentinel.stdout.once('end', stdoutEnd.resolve);
    sentinel.stderr.once('end', stderrEnd.resolve);
    sentinel.stdout.once('error', protocolFailure);
    sentinel.stderr.once('error', protocolFailure);
    sentinel.stdin.once('error', requestFailure);
    sentinel.once('spawn', () => {
      try { channels.beforeRequestWrite?.(sentinel.stdin); }
      catch { requestFailure(); return; }
      (channels.writeRequest ?? endBytes)(sentinel.stdin, requestFrame(request, limits)).then(
        () => {
          try { channels.afterRequestWrite?.(sentinel.stdin); }
          catch { requestFailure(); }
        },
        () => requestFailure(),
      );
    });
    sentinel.once('error', () => { if (!sentinel.pid) finish({ kind: 'spawn_failed', worker_spawned: false, exit_code: null, stdout_bytes: 0, stderr_bytes: 0 }); else force('worker_failed'); });
    sentinel.once('exit', (code, signal) => {
      sentinelExited.resolve(Object.freeze({ code, signal }));
    });
    sentinel.once('close', (code, signal) => {
      if (retirement) return;
      if (!terminal) return force('protocol_error');
      if (terminal.stdout_bytes !== stdoutBytes || terminal.stderr_bytes !== stderrBytes || code !== 0) return force('protocol_error');
      finish({ ...terminal, worker_spawned: spawned });
    });
    const control = (value) => {
      const base = ['schema_version', 'event', 'sentinel_pid'];
      const terminalKeys = ['kind', 'worker_spawned', 'exit_code', 'stdout_bytes', 'stderr_bytes'];
      const retirementKeys = ['nonce'];
      const keys = value?.event === 'terminal' ? [...base, ...terminalKeys]
        : ['term_armed', 'pre_kill'].includes(value?.event) ? [...base, ...retirementKeys]
          : value?.event === 'retirement_required' ? [...base, 'reason'] : base;
      if (!exactKeys(value, keys)
        || value.schema_version !== WORKER_GROUP_CONTROL_SCHEMA || value.sentinel_pid !== sentinel.pid
        || !['ready', 'spawned', 'retirement_required', 'term_armed', 'pre_kill', 'terminal'].includes(value.event)) {
        return protocolFailure();
      }
      if (value.event === 'ready') {
        if (ready || spawned || terminal) return protocolFailure();
        ready = true;
        retireInput();
        try { channels.afterRequestReady?.(sentinel.stdin); }
        catch { requestFailure(); }
        try {
          channels.onGroupReady(sentinel.pid);
          sentinel.stdio[4].write(`${JSON.stringify({ schema_version: WORKER_GROUP_ACTIVATION_SCHEMA, event: 'execute' })}\n`);
        } catch { force('parent_lost'); }
      } else if (value.event === 'spawned') {
        if (!ready || spawned || terminal) return protocolFailure();
        spawned = true;
        try { channels.onSpawned(); } catch { force('parent_lost'); }
      } else if (value.event === 'retirement_required') {
        if (!ready || !spawned || terminal || !['output_cap', 'transport_lost'].includes(value.reason)) {
          return protocolFailure();
        }
        if (!retirement) force(value.reason === 'output_cap' ? 'output_cap' : 'parent_lost');
      } else if (value.event === 'term_armed') {
        if (!retirementWitness || retirementWitness.state.termArmed
          || value.nonce !== retirementWitness.nonce) return protocolFailure();
        retirementWitness.state.termArmed = true;
        retirementWitness.termArmed.resolve(true);
        try { channels.afterTermArmed?.(sentinel.stdio[4]); }
        catch (error) { protocolFailure(error); }
      } else if (value.event === 'pre_kill') {
        if (!retirementWitness || !retirementWitness.state.termArmed
          || retirementWitness.state.preKill || value.nonce !== retirementWitness.nonce) return protocolFailure();
        retirementWitness.state.preKill = true;
        retirementWitness.state.commandRetired = true;
        commandAuthoritative = false;
        retirementWitness.preKill.resolve(true);
        try { channels.afterPreKill?.(sentinel.stdio[4]); }
        catch (error) { protocolFailure(error); }
        retireCommand();
      } else if (value.event === 'terminal') {
        if (retirement || !ready || terminal || value.worker_spawned !== spawned
          || !TERMINAL_KINDS.has(value.kind)
          || !(value.exit_code === null || Number.isInteger(value.exit_code))
          || !Number.isSafeInteger(value.stdout_bytes) || value.stdout_bytes < 0
          || !Number.isSafeInteger(value.stderr_bytes) || value.stderr_bytes < 0
          || value.stdout_bytes + value.stderr_bytes > limits.output_bytes) return protocolFailure();
        terminal = Object.freeze({
          kind: value.kind,
          worker_spawned: value.worker_spawned,
          exit_code: value.exit_code,
          stdout_bytes: value.stdout_bytes,
          stderr_bytes: value.stderr_bytes,
        });
        retireCommand();
      } else protocolFailure();
    };
    sentinel.stdio[3].on('data', (chunk) => {
      controlBytes += chunk.length;
      if (controlBytes > MAX_CONTROL_TOTAL) return protocolFailure();
      controlBuffer = Buffer.concat([controlBuffer, chunk]);
      while (true) {
        const newline = controlBuffer.indexOf(0x0a);
        if (newline < 0) break;
        if (newline <= 0 || newline > MAX_CONTROL_BYTES) return protocolFailure();
        try { control(JSON.parse(controlBuffer.subarray(0, newline).toString('utf8'))); }
        catch { protocolFailure(); }
        controlBuffer = controlBuffer.subarray(newline + 1);
      }
    });
    sentinel.stdio[3].once('end', () => {
      if (controlBuffer.length !== 0) protocolFailure('worker group control is truncated');
      controlEnd.resolve(true);
    });
    sentinel.stdio[3].once('error', protocolFailure);
    sentinel.stdio[4].once('error', (error) => {
      if (commandAuthoritative) protocolFailure(error);
    });
    sentinel.stdio[4].once('close', () => {
      if (commandAuthoritative) protocolFailure('worker group command channel closed while authoritative');
    });
    channels.parentLost.then(() => force('parent_lost'));
    channels.controlLost.then(() => force('parent_lost'));
    deadline = setTimeout(() => force('timeout'), limits.timeout_ms);
  });
}

export { SENTINEL_ENTRYPOINT };
