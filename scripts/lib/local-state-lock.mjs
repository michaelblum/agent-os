import fs from 'node:fs';
import path from 'node:path';
import {
  nowISO,
  writeJSONAtomic,
} from './agent-workspace/core.mjs';

function lockNumber(envValue, fallback) {
  const parsed = Number(envValue);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function sleep(ms) {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function ownerPID(lockDir) {
  try {
    const owner = JSON.parse(fs.readFileSync(path.join(lockDir, 'owner.json'), 'utf8'));
    const pid = Number(owner?.pid);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function processIsGone(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error?.code === 'ESRCH';
  }
}

function staleLockAgeMs(lockDir) {
  try {
    return Date.now() - fs.statSync(lockDir).mtimeMs;
  } catch {
    return 0;
  }
}

export function reapStaleLocalStateLock(lockDir, staleMs) {
  const pid = ownerPID(lockDir);
  if (pid) {
    if (!processIsGone(pid)) return false;
  } else if (staleLockAgeMs(lockDir) < staleMs) {
    return false;
  }
  fs.rmSync(lockDir, { recursive: true, force: true });
  return true;
}

export function withLocalStateMutationLock({
  lockDir,
  ensureDir,
  timeoutMs,
  staleMs,
  lockedError,
  owner,
}, mutate) {
  const deadline = Date.now() + lockNumber(timeoutMs, 5000);
  const staleThreshold = lockNumber(staleMs, 30000);
  if (ensureDir) fs.mkdirSync(ensureDir, { recursive: true });
  for (;;) {
    try {
      fs.mkdirSync(lockDir);
      try {
        writeJSONAtomic(path.join(lockDir, 'owner.json'), {
          pid: process.pid,
          acquired_at: nowISO(),
          ...(owner || {}),
        });
        break;
      } catch (ownerError) {
        fs.rmSync(lockDir, { recursive: true, force: true });
        throw ownerError;
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if (reapStaleLocalStateLock(lockDir, staleThreshold)) continue;
      if (Date.now() >= deadline) {
        lockedError();
      }
      sleep(Math.min(25, Math.max(1, deadline - Date.now())));
    }
  }
  try {
    return mutate();
  } finally {
    fs.rmSync(lockDir, { recursive: true, force: true });
  }
}
