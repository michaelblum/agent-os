import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquirePidLock, PeerAliveError } from '../src/singleton.js';

let tmpDir: string;
let pidPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'gateway-singleton-test-'));
  pidPath = join(tmpDir, 'gateway.pid');
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('acquirePidLock', () => {
  test('creates pidfile with pid + timestamp', () => {
    const lock = acquirePidLock(pidPath);
    const contents = readFileSync(pidPath, 'utf8');
    const [pidStr, tsStr] = contents.split('\n');
    assert.equal(parseInt(pidStr, 10), process.pid);
    assert.ok(Number.isFinite(parseInt(tsStr, 10)));
    lock.release();
    assert.equal(existsSync(pidPath), false);
  });

  test('release is idempotent', () => {
    const lock = acquirePidLock(pidPath);
    lock.release();
    lock.release();
    assert.equal(existsSync(pidPath), false);
  });

  test('throws PeerAliveError when pidfile holder is a live peer', () => {
    // PID 1 is always alive on POSIX; kill(1, 0) yields EPERM which we treat as alive.
    writeFileSync(pidPath, `1\n${Date.now()}\n`);
    assert.throws(
      () => acquirePidLock(pidPath),
      (err: any) => {
        assert.ok(err instanceof PeerAliveError);
        assert.equal(err.code, 'EPEERLIVE');
        assert.equal(err.holder.pid, 1);
        return true;
      },
    );
    // Pidfile still intact (we did not steal it).
    assert.equal(existsSync(pidPath), true);
  });

  test('reclaims stale pidfile when holder is dead', () => {
    // PID 999999 vanishingly unlikely to be live; on EPERM we also treat as alive,
    // so pick an obviously-dead high PID that will return ESRCH.
    writeFileSync(pidPath, `999999\n1000000000000\n`);
    const lock = acquirePidLock(pidPath);
    const contents = readFileSync(pidPath, 'utf8');
    assert.equal(parseInt(contents.split('\n')[0], 10), process.pid);
    lock.release();
  });

  test('reclaims pidfile with malformed contents', () => {
    writeFileSync(pidPath, 'garbage\n');
    const lock = acquirePidLock(pidPath);
    lock.release();
  });
});
