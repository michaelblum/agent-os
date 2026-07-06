import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  parseError,
  parseJSON,
  run,
  runAsync,
  validateJSONFile,
  writeJSON,
} from '../lib/pending-annotation-fixtures.mjs';

test('pending annotation concurrent consume succeeds exactly once', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-concurrent-consume-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
    AOS_PENDING_ANNOTATION_LOCK_TIMEOUT_MS: '10000',
  };
  parseJSON(run([
    'create',
    '--id',
    'ann-race',
    '--target-kind',
    'browser',
    '--target-summary',
    'Race target',
    '--workspace',
    'ws1',
    '--snapshot',
    'snap1',
    '--ref',
    'r1',
    '--json',
  ], env));

  const attempts = await Promise.all(Array.from({ length: 16 }, (_, index) => runAsync([
    'consume',
    'ann-race',
    '--actor',
    `consumer-${index}`,
    '--json',
  ], env)));
  const successes = attempts.filter((result) => result.status === 0).map((result) => JSON.parse(result.stdout));
  const failures = attempts.filter((result) => result.status !== 0).map((result) => JSON.parse(result.stderr));
  assert.equal(successes.length, 1, attempts);
  assert.equal(successes[0].status, 'consumed');
  assert.equal(failures.length, 15);
  assert(failures.every((failure) => failure.code === 'PENDING_ANNOTATION_NOT_CONSUMABLE'), failures);
  assert(failures.every((failure) => failure.state === 'consumed'), failures);

  const listed = parseJSON(run(['list', '--state', 'consumed', '--json'], env));
  assert.equal(listed.count, 1);
  assert.equal(listed.annotations[0].id, 'ann-race');
});

test('pending annotation lock with live owner PID fails closed instead of reaping by age', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-live-lock-'));
  const lockDir = path.join(stateRoot, 'repo', 'pending-annotations', '.mutation.lock');
  await fs.mkdir(lockDir, { recursive: true });
  await writeJSON(lockDir, 'owner.json', {
    pid: process.pid,
    acquired_at: '2026-07-05T12:00:00Z',
  });
  const old = new Date(Date.now() - 60_000);
  await fs.utimes(lockDir, old, old);
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
    AOS_PENDING_ANNOTATION_LOCK_TIMEOUT_MS: '0',
    AOS_PENDING_ANNOTATION_STALE_LOCK_MS: '0',
  };

  const result = run([
    'create',
    '--id',
    'ann-live-lock',
    '--target-kind',
    'region',
    '--target-summary',
    'Live lock target',
    '--json',
  ], env);
  assert.notEqual(result.status, 0);
  const err = JSON.parse(result.stderr);
  assert.equal(err.code, 'PENDING_ANNOTATION_LOCKED');
  assert.equal((await fs.stat(lockDir)).isDirectory(), true);
});

test('pending annotation stale ownerless lock is reaped before mutation', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-stale-lock-'));
  const lockDir = path.join(stateRoot, 'repo', 'pending-annotations', '.mutation.lock');
  await fs.mkdir(lockDir, { recursive: true });
  await writeJSON(lockDir, 'owner.json', {
    pid: 'not-a-pid',
    acquired_at: '2026-07-05T12:00:00Z',
  });
  const old = new Date(Date.now() - 60_000);
  await fs.utimes(lockDir, old, old);
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
    AOS_PENDING_ANNOTATION_LOCK_TIMEOUT_MS: '1000',
    AOS_PENDING_ANNOTATION_STALE_LOCK_MS: '0',
  };

  const created = parseJSON(run([
    'create',
    '--id',
    'ann-stale-lock',
    '--target-kind',
    'region',
    '--target-summary',
    'Stale lock target',
    '--json',
  ], env));
  assert.equal(created.annotation.id, 'ann-stale-lock');
  await assert.rejects(fs.stat(lockDir), /ENOENT/);
});
