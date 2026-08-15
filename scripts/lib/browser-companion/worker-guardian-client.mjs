import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import {
  GUARDIAN_ACTIVATION_SCHEMA,
  GUARDIAN_CONTROL_SCHEMA,
  GUARDIAN_REQUEST_SCHEMA,
  MAX_GUARDIAN_CONTROL_BYTES,
  MAX_GUARDIAN_CONTROL_TOTAL,
  guardianOperationLimits,
  guardianRecord,
  reserveGuardianRecord,
  validateGuardianBinding,
} from './worker-guardian-state.mjs';

const GUARDIAN_ENTRYPOINT = fileURLToPath(new URL('../../aos-browser-worker-guardian.mjs', import.meta.url));
const TERMINAL_KINDS = new Set([
  'no_spawn', 'spawn_failed', 'exited', 'worker_failed', 'timeout',
  'output_cap', 'parent_lost', 'protocol_error',
]);

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function exactControl(value, binding, guardianPid) {
  const base = ['schema_version', 'event', 'store_id', 'lock_token', 'session_id', 'generation', 'nonce', 'operation', 'guardian_pid'];
  const extras = value?.event === 'terminal'
    ? ['terminal_kind', 'worker_spawned', 'exit_code', 'stdout_bytes', 'stderr_bytes'] : [];
  if (!exactKeys(value, [...base, ...extras]) || value.schema_version !== GUARDIAN_CONTROL_SCHEMA
    || value.guardian_pid !== guardianPid || JSON.stringify(validateGuardianBinding(value)) !== JSON.stringify(binding)
    || !['armed', 'request_accepted', 'spawned', 'terminal'].includes(value.event)) {
    throw new Error('guardian control differs');
  }
  if (value.event === 'terminal' && (typeof value.worker_spawned !== 'boolean'
    || !(value.exit_code === null || Number.isInteger(value.exit_code))
    || !Number.isSafeInteger(value.stdout_bytes) || value.stdout_bytes < 0
    || !Number.isSafeInteger(value.stderr_bytes) || value.stderr_bytes < 0
    || !TERMINAL_KINDS.has(value.terminal_kind))) {
    throw new Error('guardian terminal control differs');
  }
  return value;
}

function guardianArgs(store, lockOwner, binding) {
  return [
    GUARDIAN_ENTRYPOINT,
    '--state-root', store.paths.stateRoot,
    '--runtime-mode', store.paths.mode,
    '--store-id', binding.store_id,
    '--lock-token', lockOwner.token,
    '--session-id', binding.session_id,
    '--generation', binding.generation,
    '--nonce', binding.nonce,
    '--operation', binding.operation,
  ];
}

function guardianEnvironment() {
  return Object.freeze({
    HOME: '/', PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    LANG: process.env.LANG ?? 'C', LC_ALL: process.env.LC_ALL ?? 'C',
    NO_UPDATE_NOTIFIER: '1', CI: '1',
  });
}

function activationFrame(binding, event) {
  return `${JSON.stringify({ schema_version: GUARDIAN_ACTIVATION_SCHEMA, event, binding })}\n`;
}

function writeFrame(stream, bytes) {
  return new Promise((resolve, reject) => {
    try { stream.write(bytes, (error) => error ? reject(error) : resolve()); }
    catch (error) { reject(error); }
  });
}

export function runGuardedWorker(request) {
  return new Promise((resolve) => {
    const limits = guardianOperationLimits(request.operation, request.maxOutputBytes);
    const binding = validateGuardianBinding({
      store_id: request.store.owner.store_id,
      lock_token: request.lockOwner.token,
      session_id: request.session.session_id,
      generation: request.session.generation,
      nonce: request.guardianNonce,
      operation: request.operation,
    });
    let guardian;
    try {
      guardian = (request.spawnGuardian ?? spawn)(process.execPath, guardianArgs(request.store, request.lockOwner, binding), {
        cwd: request.cwd, env: guardianEnvironment(), detached: true,
        stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolve({ spawned: false, error, exitCode: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), timedOut: false, exceeded: false, authorityPossible: false });
      return;
    }
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let controlBytes = 0;
    let controlBuffer = Buffer.alloc(0);
    let armed = false;
    let requestAccepted = false;
    let workerSpawned = false;
    let terminal = null;
    let failure = null;
    let settled = false;
    let requestAuthoritative = true;
    let reservation = null;
    let protocolDeadline;

    const closeAuthorityChannels = () => {
      try { guardian.stdio[4].end(); } catch {}
      try { guardian.stdio[5].end(); } catch {}
    };
    const protocolFailure = (error) => {
      if (!failure) failure = error;
      closeAuthorityChannels();
    };
    const requestFailure = (error) => {
      if (!requestAuthoritative) return;
      requestAuthoritative = false;
      try { guardian.stdin.destroy(); } catch {}
      protocolFailure(error);
    };
    protocolDeadline = setTimeout(
      () => protocolFailure(new Error('guardian protocol deadline expired')),
      limits.timeout_ms + 5_000,
    );
    const append = (chunks, chunk, stream) => {
      if (stdoutBytes + stderrBytes + chunk.length > limits.output_bytes) {
        protocolFailure(new Error('guardian aggregate output exceeds limit'));
        return;
      }
      if (stream === 'stdout') stdoutBytes += chunk.length;
      else stderrBytes += chunk.length;
      chunks.push(chunk);
    };
    guardian.stdout.on('data', (chunk) => append(stdout, chunk, 'stdout'));
    guardian.stderr.on('data', (chunk) => append(stderr, chunk, 'stderr'));
    guardian.stdin.on('error', requestFailure);
    guardian.stdio[3].once('error', protocolFailure);
    guardian.stdio[4].once('error', protocolFailure);
    guardian.stdio[5].once('error', protocolFailure);

    const sendRequest = async () => {
      const value = {
        schema_version: GUARDIAN_REQUEST_SCHEMA, binding,
        entrypoint: request.entrypoint, argv: request.argv,
        cwd: request.cwd, env: request.env,
        max_output_bytes: limits.output_bytes,
      };
      await new Promise((accept, reject) => {
        try { guardian.stdin.end(`${JSON.stringify(value)}\n`, (error) => error ? reject(error) : accept()); }
        catch (error) { reject(error); }
      });
    };

    const handleControl = (raw) => {
      let value;
      try { value = exactControl(JSON.parse(raw), binding, guardian.pid); }
      catch (error) { protocolFailure(error); return; }
      if (value.event === 'armed') {
        if (!reservation || armed || requestAccepted || workerSpawned || terminal) return protocolFailure(new Error('guardian armed order differs'));
        armed = true;
        try { request.beforeGuardianRequest?.(guardian); }
        catch (error) { protocolFailure(error); return; }
        sendRequest().catch(requestFailure);
      } else if (value.event === 'request_accepted') {
        if (!armed || requestAccepted || terminal) return protocolFailure(new Error('guardian request order differs'));
        requestAuthoritative = false;
        requestAccepted = true;
        try { request.beforeGuardianExecute?.(); }
        catch (error) { protocolFailure(error); return; }
        writeFrame(guardian.stdio[5], activationFrame(binding, 'execute')).catch(protocolFailure);
      } else if (value.event === 'spawned') {
        if (!requestAccepted || workerSpawned || terminal) return protocolFailure(new Error('guardian spawn order differs'));
        workerSpawned = true;
      } else {
        if (!armed || terminal || value.worker_spawned !== workerSpawned
          || value.stdout_bytes + value.stderr_bytes > limits.output_bytes) {
          return protocolFailure(new Error('guardian terminal order differs'));
        }
        requestAuthoritative = false;
        terminal = value;
        closeAuthorityChannels();
      }
    };

    guardian.stdio[3].on('data', (chunk) => {
      controlBytes += chunk.length;
      if (controlBytes > MAX_GUARDIAN_CONTROL_TOTAL) return protocolFailure(new Error('guardian control exceeds limit'));
      controlBuffer = Buffer.concat([controlBuffer, chunk]);
      while (true) {
        const newline = controlBuffer.indexOf(0x0a);
        if (newline < 0) break;
        if (newline > MAX_GUARDIAN_CONTROL_BYTES) return protocolFailure(new Error('guardian control frame exceeds limit'));
        const raw = controlBuffer.subarray(0, newline).toString('utf8');
        controlBuffer = controlBuffer.subarray(newline + 1);
        handleControl(raw);
      }
    });
    guardian.once('spawn', () => {
      try {
        request.afterGuardianSpawn?.(guardian.pid);
        reservation = reserveGuardianRecord(
          request.store, request.lockOwner,
          guardianRecord(binding, guardian.pid, 'armed'),
          { hooks: request.guardianPublicationHooks },
        );
        request.afterGuardianReservation?.(reservation.record);
      } catch (error) { protocolFailure(error); return; }
      writeFrame(guardian.stdio[5], activationFrame(binding, 'activate')).catch(protocolFailure);
    });
    guardian.once('error', protocolFailure);
    guardian.once('close', (guardianExitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(protocolDeadline);
      if (controlBuffer.length !== 0 && !failure) failure = new Error('guardian control is truncated');
      if (!terminal && !failure) failure = new Error('guardian terminal control is missing');
      if (terminal && (terminal.stdout_bytes !== stdoutBytes || terminal.stderr_bytes !== stderrBytes) && !failure) {
        failure = new Error('guardian raw stream counts differ');
      }
      const terminalKind = terminal?.terminal_kind ?? null;
      resolve({
        spawned: workerSpawned,
        error: failure ?? (guardianExitCode === 0 ? null : new Error('guardian process failed')),
        exitCode: terminalKind === 'exited' ? terminal.exit_code : null,
        stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr),
        timedOut: terminalKind === 'timeout',
        exceeded: terminalKind === 'output_cap',
        guardianTerminal: terminalKind,
        guardianCompletion: terminal && !failure ? Object.freeze({
          binding,
          guardian_pid: guardian.pid,
          terminal_kind: terminal.terminal_kind,
          worker_spawned: terminal.worker_spawned,
        }) : null,
        authorityPossible: terminal ? terminal.worker_spawned : (workerSpawned || requestAccepted),
      });
    });
  });
}

export { GUARDIAN_ENTRYPOINT };
