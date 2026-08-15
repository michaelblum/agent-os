import fs from 'node:fs';
import path from 'node:path';

import { inspectStore, readPrivateRecord } from './store-paths.mjs';
import { exactLockOwner } from './store-lock-state.mjs';
import { managedRuntimeBinding, readSession } from './session-store.mjs';
import { runWorkerProcessGroup } from './worker-process-group.mjs';
import {
  GUARDIAN_ACTIVATION_SCHEMA,
  GUARDIAN_CONTROL_SCHEMA,
  GUARDIAN_REQUEST_SCHEMA,
  MAX_GUARDIAN_CONTROL_BYTES,
  MAX_GUARDIAN_CONTROL_TOTAL,
  MAX_GUARDIAN_REQUEST_BYTES,
  guardianLockIdentity,
  guardianOperationLimits,
  guardianRecord,
  recoverGuardianRecordPublication,
  transitionGuardianRecord,
  validateGuardianBinding,
} from './worker-guardian-state.mjs';

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function control(binding, event, fields = {}) {
  return Object.freeze({ schema_version: GUARDIAN_CONTROL_SCHEMA, event, ...binding, guardian_pid: process.pid, ...fields });
}

function writeControl(value) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  if (bytes.length > MAX_GUARDIAN_CONTROL_BYTES) throw new Error('guardian control exceeds limit');
  fs.writeSync(3, bytes);
}

function lossSignal(stream) {
  let lose;
  const lost = new Promise((resolve) => { lose = resolve; });
  stream.once('end', lose);
  stream.once('close', lose);
  stream.once('error', lose);
  stream.resume();
  return lost;
}

function framedReader(stream) {
  let buffer = Buffer.alloc(0);
  let total = 0;
  let ended = false;
  let failure = null;
  const queue = [];
  const waiters = [];
  const flush = () => {
    while (waiters.length > 0 && (queue.length > 0 || ended || failure)) {
      const waiter = waiters.shift();
      if (failure) waiter.reject(failure);
      else waiter.resolve(queue.shift() ?? null);
    }
  };
  stream.on('data', (chunk) => {
    total += chunk.length;
    if (total > MAX_GUARDIAN_CONTROL_TOTAL) {
      failure = new Error('guardian activation control exceeds limit');
      flush();
      return;
    }
    buffer = Buffer.concat([buffer, chunk]);
    while (!failure) {
      const newline = buffer.indexOf(0x0a);
      if (newline < 0) break;
      if (newline === 0 || newline > MAX_GUARDIAN_CONTROL_BYTES) {
        failure = new Error('guardian activation frame differs');
        break;
      }
      try {
        queue.push(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, newline))));
      } catch (error) { failure = error; }
      buffer = buffer.subarray(newline + 1);
    }
    flush();
  });
  stream.once('end', () => {
    if (buffer.length !== 0) failure = new Error('guardian activation control is truncated');
    ended = true;
    flush();
  });
  stream.once('error', (error) => { failure = error; flush(); });
  return Object.freeze({
    next() {
      if (failure) return Promise.reject(failure);
      if (queue.length > 0) return Promise.resolve(queue.shift());
      if (ended) return Promise.resolve(null);
      return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
    },
  });
}

function readOneRequest(stream, lost) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    stream.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_GUARDIAN_REQUEST_BYTES) return finish(reject, new Error('guardian request exceeds limit'));
      chunks.push(chunk);
    });
    stream.once('end', () => {
      if (settled) return;
      try {
        const combined = Buffer.concat(chunks);
        if (combined.length === 0) return finish(resolve, null);
        const newline = combined.indexOf(0x0a);
        if (newline < 0 || newline !== combined.length - 1) throw new Error('guardian request framing differs');
        const text = new TextDecoder('utf-8', { fatal: true }).decode(combined.subarray(0, newline));
        finish(resolve, JSON.parse(text));
      } catch (error) { finish(reject, error); }
    });
    stream.once('error', (error) => finish(reject, error));
    lost.then(() => {
      if (bytes === 0) finish(resolve, null);
      else finish(reject, new Error('guardian request was truncated'));
    });
  });
}

function exactActivation(value, binding, event) {
  if (!exactKeys(value, ['schema_version', 'event', 'binding'])
    || value.schema_version !== GUARDIAN_ACTIVATION_SCHEMA || value.event !== event
    || JSON.stringify(validateGuardianBinding(value.binding)) !== JSON.stringify(binding)) {
    throw new Error('guardian activation control differs');
  }
  return value;
}

function validateRequest(value, binding, outputBytes) {
  const keys = ['schema_version', 'binding', 'entrypoint', 'argv', 'cwd', 'env', 'max_output_bytes'];
  if (!exactKeys(value, keys) || value.schema_version !== GUARDIAN_REQUEST_SCHEMA
    || JSON.stringify(validateGuardianBinding(value.binding)) !== JSON.stringify(binding)
    || value.max_output_bytes !== outputBytes
    || typeof value.entrypoint !== 'string' || !path.isAbsolute(value.entrypoint) || value.entrypoint.length > 4096
    || typeof value.cwd !== 'string' || !path.isAbsolute(value.cwd) || value.cwd.length > 4096
    || !Array.isArray(value.argv) || value.argv.length > 64
    || value.argv.some((item) => typeof item !== 'string' || Buffer.byteLength(item) > 64 * 1024)
    || !value.env || typeof value.env !== 'object' || Array.isArray(value.env)
    || Object.keys(value.env).length > 32
    || Object.entries(value.env).some(([key, item]) => !/^[A-Z][A-Z0-9_]{0,63}$/u.test(key)
      || typeof item !== 'string' || Buffer.byteLength(item) > 64 * 1024)) {
    throw new Error('guardian request shape differs');
  }
  return value;
}

function openReservation(options) {
  const binding = validateGuardianBinding(options.binding);
  const store = inspectStore(options.env);
  if (!store.exists || store.owner.store_id !== binding.store_id) throw new Error('guardian store binding differs');
  const lockOwner = readPrivateRecord(path.join(store.paths.lock, 'owner.json'));
  if (!exactLockOwner(lockOwner, store.owner) || lockOwner.token !== binding.lock_token) {
    throw new Error('guardian lock binding differs');
  }
  const record = recoverGuardianRecordPublication(store, lockOwner).value;
  const expected = guardianRecord(binding, process.pid, 'armed');
  if (!record) return Object.freeze({ store, lockOwner, binding, record: null, expected, lockIdentity: null });
  if (JSON.stringify(record) !== JSON.stringify(expected)) throw new Error('guardian reservation differs');
  const session = readSession(store, binding.session_id);
  if (!session || session.generation !== binding.generation) throw new Error('guardian session binding differs');
  const runtime = managedRuntimeBinding(store, session);
  return Object.freeze({
    store, lockOwner, binding, record, expected,
    lockIdentity: guardianLockIdentity(store, lockOwner),
    outputBytes: runtime.max_captured_output_bytes,
  });
}

function finishWithoutSpawn(opened, kind = 'no_spawn') {
  if (!opened.record) return null;
  const record = transitionGuardianRecord(
    opened.store, opened.lockOwner, opened.record,
    guardianRecord(opened.binding, process.pid, 'complete', { kind, worker_spawned: false }),
    opened.lockIdentity,
  );
  try { writeControl(control(opened.binding, 'terminal', {
    terminal_kind: record.terminal_kind,
    worker_spawned: false,
    exit_code: null,
    stdout_bytes: 0,
    stderr_bytes: 0,
  })); } catch {}
  return record;
}

export async function runGuardianProcess(options) {
  const binding = validateGuardianBinding(options.binding);
  const lifetime = fs.createReadStream(null, { fd: 4, autoClose: false });
  const activation = fs.createReadStream(null, { fd: 5, autoClose: false });
  const parentLost = lossSignal(lifetime);
  const activationLost = lossSignal(activation);
  const activationFrames = framedReader(activation);
  let opened = null;
  let first;
  try { first = await Promise.race([activationFrames.next(), parentLost.then(() => null)]); }
  catch { first = null; }
  if (first === null) {
    opened = openReservation(options);
    finishWithoutSpawn(opened);
    return;
  }
  exactActivation(first, binding, 'activate');
  opened = openReservation(options);
  if (!opened.record) throw new Error('guardian activation lacks a reservation');
  try { writeControl(control(binding, 'armed')); } catch { finishWithoutSpawn(opened); return; }

  let request;
  try { request = await readOneRequest(process.stdin, Promise.race([parentLost, activationLost])); }
  catch { finishWithoutSpawn(opened, 'protocol_error'); return; }
  if (request === null) { finishWithoutSpawn(opened); return; }
  try { request = validateRequest(request, binding, opened.outputBytes); }
  catch { finishWithoutSpawn(opened, 'protocol_error'); return; }
  let record = transitionGuardianRecord(
    opened.store, opened.lockOwner, opened.record,
    guardianRecord(binding, process.pid, 'request_accepted'), opened.lockIdentity,
  );
  try { writeControl(control(binding, 'request_accepted')); }
  catch { finishWithoutSpawn({ ...opened, record }); return; }
  let execute;
  try { execute = await Promise.race([activationFrames.next(), parentLost.then(() => null)]); }
  catch { execute = null; }
  if (execute === null) {
    finishWithoutSpawn({ ...opened, record });
    return;
  }
  try { exactActivation(execute, binding, 'execute'); }
  catch {
    finishWithoutSpawn({ ...opened, record }, 'protocol_error');
    return;
  }
  const terminal = await runWorkerProcessGroup(request, guardianOperationLimits(binding.operation, opened.outputBytes), {
    stdout: process.stdout,
    stderr: process.stderr,
    parentLost,
    controlLost: activationLost,
    onGroupReady: (groupPid) => {
      record = transitionGuardianRecord(
        opened.store, opened.lockOwner, record,
        guardianRecord(binding, process.pid, 'group_armed', { group_pid: groupPid }),
        opened.lockIdentity,
      );
    },
    onSpawned: () => {
      record = transitionGuardianRecord(
        opened.store, opened.lockOwner, record,
        guardianRecord(binding, process.pid, 'worker_spawned', {
          group_pid: record.group_pid, worker_spawned: true,
        }),
        opened.lockIdentity,
      );
      writeControl(control(binding, 'spawned'));
    },
  });
  record = transitionGuardianRecord(
    opened.store, opened.lockOwner, record,
    guardianRecord(binding, process.pid, 'complete', {
      ...terminal, group_pid: terminal.group_pid ?? record.group_pid,
    }), opened.lockIdentity,
  );
  try { writeControl(control(binding, 'terminal', {
    terminal_kind: record.terminal_kind, worker_spawned: terminal.worker_spawned,
    exit_code: terminal.exit_code, stdout_bytes: terminal.stdout_bytes, stderr_bytes: terminal.stderr_bytes,
  })); } catch {}
  await Promise.race([parentLost, new Promise((resolve) => setTimeout(resolve, 2_000))]);
}
