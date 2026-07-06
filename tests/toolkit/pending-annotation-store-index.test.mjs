import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  commitPendingAnnotationRecordMutation,
  pendingAnnotationStoreStatus,
} from '../../scripts/lib/pending-annotations-store.mjs';
import {
  parseError,
  parseJSON,
  readTextIfExists,
  run,
  runAsync,
  validateJSONFile,
} from '../lib/pending-annotation-fixtures.mjs';

test('pending annotation consume fails closed on corrupt saved-ref capability', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-corrupt-capability-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
  };
  const created = parseJSON(run([
    'create',
    '--id',
    'ann-corrupt-capability',
    '--target-kind',
    'region',
    '--target-summary',
    'Corrupt capability target',
    '--json',
  ], env));
  validateJSONFile(created.annotation.path);
  const record = JSON.parse(await fs.readFile(created.annotation.path, 'utf8'));
  record.capability.status = 'saved_ref';
  await fs.writeFile(created.annotation.path, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

  const err = parseError(run(['consume', 'ann-corrupt-capability', '--json'], env));
  assert.equal(err.code, 'PENDING_ANNOTATION_STATE_CORRUPT');
});

test('pending annotation corrupt record read fails closed', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-corrupt-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
  };
  const created = parseJSON(run([
    'create',
    '--id',
    'ann-corrupt',
    '--target-kind',
    'region',
    '--target-summary',
    'Corrupt me',
    '--json',
  ], env));
  await fs.writeFile(created.annotation.path, '{not json', 'utf8');
  const result = run(['read', 'ann-corrupt', '--json'], env);
  const err = parseError(result);
  assert.equal(err.code, 'PENDING_ANNOTATION_STATE_CORRUPT');
});

test('pending annotation store status validates record JSON before reporting initialized', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-status-corrupt-record-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
  };
  const recordPath = path.join(stateRoot, 'repo', 'pending-annotations', 'records', 'ann-bad-json.json');
  await fs.mkdir(path.dirname(recordPath), { recursive: true });
  await fs.writeFile(recordPath, '{bad json', 'utf8');

  const status = pendingAnnotationStoreStatus(env);
  assert.equal(status.status, 'corrupt');
  assert.equal(status.records_status, 'corrupt');
  assert.equal(status.record_count, 0);
  assert.equal(status.records_error_status, 'corrupt');
  assert.equal(status.records_error_storage_status, 'corrupt_json');
  assert.equal(status.records_error_path, recordPath);
  assert.notEqual(status.status, 'initialized');
});

test('pending annotation durable ids containing .tmp- stay visible while atomic temp writes are ignored', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-status-tmp-id-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
  };

  const created = parseJSON(run([
    'create',
    '--id',
    'ann.tmp-final',
    '--target-kind',
    'region',
    '--target-summary',
    'Durable id containing tmp marker',
    '--json',
  ], env));
  assert.equal(created.annotation.id, 'ann.tmp-final');
  validateJSONFile(created.annotation.path);

  const atomicTempPath = `${created.annotation.path}.tmp-12345-abc123xy`;
  await fs.writeFile(atomicTempPath, '{incomplete', 'utf8');

  const read = parseJSON(run(['read', 'ann.tmp-final', '--json'], env));
  assert.equal(read.annotation.id, 'ann.tmp-final');

  const listed = parseJSON(run(['list', '--json'], env));
  assert.equal(listed.count, 1);
  assert.deepEqual(listed.annotations.map((item) => item.id), ['ann.tmp-final']);

  const status = pendingAnnotationStoreStatus(env);
  assert.equal(status.status, 'initialized');
  assert.equal(status.records_status, 'exists');
  assert.equal(status.record_count, 1);
  assert.equal(await readTextIfExists(atomicTempPath), '{incomplete');
});

test('pending annotation invalid durable record filename is corrupt state, not input error', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-status-invalid-filename-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
  };
  const recordPath = path.join(stateRoot, 'repo', 'pending-annotations', 'records', 'bad name.json');
  await fs.mkdir(path.dirname(recordPath), { recursive: true });
  await fs.writeFile(recordPath, '{"schema_version":"aos.pending-annotation.v0"}\n', 'utf8');
  const beforeText = await fs.readFile(recordPath, 'utf8');
  const indexPath = path.join(stateRoot, 'repo', 'pending-annotations', 'index.json');

  const err = parseError(run(['list', '--json'], env));
  assert.equal(err.code, 'PENDING_ANNOTATION_STATE_CORRUPT');
  assert.equal(err.storage_status, 'invalid_record_filename');
  assert.equal(err.path_status, 'corrupt');
  assert.equal(err.path, recordPath);
  assert.notEqual(err.code, 'INVALID_ID');
  assert.equal(await fs.readFile(recordPath, 'utf8'), beforeText);
  assert.equal(await readTextIfExists(indexPath), null);

  const status = pendingAnnotationStoreStatus(env);
  assert.equal(status.status, 'corrupt');
  assert.equal(status.records_status, 'corrupt');
  assert.equal(status.records_error_status, 'corrupt');
  assert.equal(status.records_error_storage_status, 'invalid_record_filename');
  assert.equal(status.records_error_path_status, 'corrupt');
  assert.equal(status.records_error_path, recordPath);
  assert.equal(status.record_count, 0);
});

test('pending annotation record id must match its filename', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-wrong-id-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
  };
  const created = parseJSON(run([
    'create',
    '--id',
    'ann-wrong-id',
    '--target-kind',
    'region',
    '--target-summary',
    'Wrong id target',
    '--json',
  ], env));
  const record = JSON.parse(await fs.readFile(created.annotation.path, 'utf8'));
  record.id = 'ann-other-id';
  record.paths.record = path.join(stateRoot, 'repo', 'pending-annotations', 'records', 'ann-other-id.json');
  await fs.writeFile(created.annotation.path, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

  const err = parseError(run(['read', 'ann-wrong-id', '--json'], env));
  assert.equal(err.code, 'PENDING_ANNOTATION_STATE_CORRUPT');
});

test('pending annotation record root must match the canonical runtime root', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-wrong-root-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
  };
  const created = parseJSON(run([
    'create',
    '--id',
    'ann-wrong-root',
    '--target-kind',
    'region',
    '--target-summary',
    'Wrong root target',
    '--json',
  ], env));
  const record = JSON.parse(await fs.readFile(created.annotation.path, 'utf8'));
  record.paths.root = path.join(stateRoot, 'installed', 'pending-annotations');
  await fs.writeFile(created.annotation.path, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

  const err = parseError(run(['list', '--json'], env));
  assert.equal(err.code, 'PENDING_ANNOTATION_STATE_CORRUPT');
});

test('pending annotation record path must equal the canonical record path', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-wrong-record-path-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
  };
  const created = parseJSON(run([
    'create',
    '--id',
    'ann-wrong-path',
    '--target-kind',
    'region',
    '--target-summary',
    'Wrong path target',
    '--json',
  ], env));
  const record = JSON.parse(await fs.readFile(created.annotation.path, 'utf8'));
  record.paths.record = path.join(stateRoot, 'repo', 'pending-annotations', 'records', 'ann-other-path.json');
  await fs.writeFile(created.annotation.path, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

  const err = parseError(run(['read', 'ann-wrong-path', '--json'], env));
  assert.equal(err.code, 'PENDING_ANNOTATION_STATE_CORRUPT');
});

test('pending annotation record path escapes fail closed', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-path-escape-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
  };
  const created = parseJSON(run([
    'create',
    '--id',
    'ann-path-escape',
    '--target-kind',
    'region',
    '--target-summary',
    'Path escape target',
    '--json',
  ], env));
  const record = JSON.parse(await fs.readFile(created.annotation.path, 'utf8'));
  record.paths.record = path.join(stateRoot, 'repo', 'pending-annotations', '..', 'outside.json');
  await fs.writeFile(created.annotation.path, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

  const err = parseError(run(['list', '--json'], env));
  assert.equal(err.code, 'PENDING_ANNOTATION_STATE_CORRUPT');
});

test('pending annotation store rejects symlinked records directory before read or write', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-symlink-state-'));
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-symlink-outside-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
  };
  const pendingRoot = path.join(stateRoot, 'repo', 'pending-annotations');
  const recordsDir = path.join(pendingRoot, 'records');
  await fs.mkdir(pendingRoot, { recursive: true });
  await fs.symlink(outsideRoot, recordsDir);

  const create = run([
    'create',
    '--id',
    'ann-symlink-write',
    '--target-kind',
    'region',
    '--target-summary',
    'Symlink write target',
    '--json',
  ], env);
  assert.notEqual(create.status, 0);
  assert.equal(JSON.parse(create.stderr).code, 'PENDING_ANNOTATION_STATE_CORRUPT');

  const outsideNames = await fs.readdir(outsideRoot);
  assert.deepEqual(outsideNames.filter((name) => /^ann-.*\.json$/.test(name)), []);

  await fs.writeFile(path.join(outsideRoot, 'ann-symlink-read.json'), JSON.stringify({
    schema_version: 'aos.pending-annotation.v0',
    id: 'ann-symlink-read',
  }), 'utf8');
  assert.equal(parseError(run(['read', 'ann-symlink-read', '--json'], env)).code, 'PENDING_ANNOTATION_STATE_CORRUPT');
  assert.equal(parseError(run(['list', '--json'], env)).code, 'PENDING_ANNOTATION_STATE_CORRUPT');
});

test('pending annotation store status rejects symlinked root before inspecting lock owner', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-root-symlink-'));
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-root-outside-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
  };
  const pendingRoot = path.join(stateRoot, 'repo', 'pending-annotations');
  await fs.mkdir(path.dirname(pendingRoot), { recursive: true });
  await fs.mkdir(path.join(outsideRoot, '.mutation.lock'), { recursive: true });
  await fs.writeFile(path.join(outsideRoot, '.mutation.lock', 'owner.json'), `${JSON.stringify({
    pid: process.pid,
  })}\n`, 'utf8');
  await fs.symlink(outsideRoot, pendingRoot);

  const status = pendingAnnotationStoreStatus(env);
  assert.equal(status.status, 'corrupt');
  assert.equal(status.root_status, 'symlink');
  assert.equal(status.records_status, 'unknown');
  assert.equal(status.index_status, 'unknown');
  assert.equal(status.root_error_storage_status, 'symlink');
  assert.equal(status.root_error_path_status, 'symlink');
  assert.equal(status.lock.status, 'unknown');
  assert.equal(Object.hasOwn(status.lock, 'owner_pid'), false);
});

test('pending annotation store status classifies symlinked index without following it', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-index-symlink-'));
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-index-outside-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
  };
  const pendingRoot = path.join(stateRoot, 'repo', 'pending-annotations');
  await fs.mkdir(path.join(pendingRoot, 'records'), { recursive: true });
  const outsideIndex = path.join(outsideRoot, 'index.json');
  await fs.writeFile(outsideIndex, JSON.stringify({
    schema_version: 'aos.pending-annotation.v0',
    runtime_mode: 'repo',
    state_root: stateRoot,
    created_at: '2026-07-06T00:00:00Z',
    updated_at: '2026-07-06T00:00:00Z',
    annotations: [],
  }), 'utf8');
  await fs.symlink(outsideIndex, path.join(pendingRoot, 'index.json'));

  const status = pendingAnnotationStoreStatus(env);
  assert.equal(status.status, 'corrupt');
  assert.equal(status.root_status, 'exists');
  assert.equal(status.records_status, 'exists');
  assert.equal(status.index_status, 'symlink');
  assert.equal(status.index_error_storage_status, 'symlink');
  assert.equal(status.index_error_path_status, 'symlink');
  assert.equal(status.record_count, 0);
});

test('pending annotation create preflights existing records before writing new durable state', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-create-preflight-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
  };
  const existing = parseJSON(run([
    'create',
    '--id',
    'ann-existing-corrupt',
    '--target-kind',
    'region',
    '--target-summary',
    'Existing corrupt target',
    '--json',
  ], env));
  const record = JSON.parse(await fs.readFile(existing.annotation.path, 'utf8'));
  record.paths.root = path.join(stateRoot, 'installed', 'pending-annotations');
  const corruptText = `${JSON.stringify(record, null, 2)}\n`;
  await fs.writeFile(existing.annotation.path, corruptText, 'utf8');

  const created = run([
    'create',
    '--id',
    'ann-new-after-corrupt',
    '--target-kind',
    'region',
    '--target-summary',
    'Should not be written',
    '--json',
  ], env);
  assert.notEqual(created.status, 0);
  assert.equal(JSON.parse(created.stderr).code, 'PENDING_ANNOTATION_STATE_CORRUPT');
  assert.equal(await readTextIfExists(path.join(stateRoot, 'repo', 'pending-annotations', 'records', 'ann-new-after-corrupt.json')), null);
  assert.equal(await fs.readFile(existing.annotation.path, 'utf8'), corruptText);
});

test('pending annotation mutations preflight existing records before changing target record', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-mutation-preflight-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
  };
  const target = parseJSON(run([
    'create',
    '--id',
    'ann-target-healthy',
    '--target-kind',
    'browser',
    '--target-summary',
    'Healthy target',
    '--workspace',
    'ws1',
    '--snapshot',
    'snap1',
    '--ref',
    'r1',
    '--json',
  ], env));
  const corrupt = parseJSON(run([
    'create',
    '--id',
    'ann-other-corrupt',
    '--target-kind',
    'region',
    '--target-summary',
    'Other corrupt target',
    '--json',
  ], env));
  const corruptRecord = JSON.parse(await fs.readFile(corrupt.annotation.path, 'utf8'));
  corruptRecord.paths.record = path.join(stateRoot, 'repo', 'pending-annotations', 'records', 'ann-other-name.json');
  await fs.writeFile(corrupt.annotation.path, `${JSON.stringify(corruptRecord, null, 2)}\n`, 'utf8');

  const beforeConsume = await fs.readFile(target.annotation.path, 'utf8');
  assert.equal(parseError(run(['consume', 'ann-target-healthy', '--json'], env)).code, 'PENDING_ANNOTATION_STATE_CORRUPT');
  assert.equal(await fs.readFile(target.annotation.path, 'utf8'), beforeConsume);

  const beforeLink = await fs.readFile(target.annotation.path, 'utf8');
  assert.equal(parseError(run([
    'link-work-record',
    'ann-target-healthy',
    '--work-record',
    'work-record:should-not-link',
    '--json',
  ], env)).code, 'PENDING_ANNOTATION_STATE_CORRUPT');
  assert.equal(await fs.readFile(target.annotation.path, 'utf8'), beforeLink);

  const beforeDelete = await fs.readFile(target.annotation.path, 'utf8');
  assert.equal(parseError(run(['delete', 'ann-target-healthy', '--json'], env)).code, 'PENDING_ANNOTATION_STATE_CORRUPT');
  assert.equal(await fs.readFile(target.annotation.path, 'utf8'), beforeDelete);
});

test('pending annotation store rejects multi-record mutation plans', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-multi-record-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
  };
  const first = parseJSON(run([
    'create',
    '--id',
    'ann-multi-first',
    '--target-kind',
    'region',
    '--target-summary',
    'First target',
    '--json',
  ], env));
  const second = parseJSON(run([
    'create',
    '--id',
    'ann-multi-second',
    '--target-kind',
    'region',
    '--target-summary',
    'Second target',
    '--json',
  ], env));
  const firstBefore = await fs.readFile(first.annotation.path, 'utf8');
  const secondBefore = await fs.readFile(second.annotation.path, 'utf8');

  assert.throws(() => commitPendingAnnotationRecordMutation(env, ({ recordsByID }) => {
    const nextFirst = {
      ...recordsByID.get('ann-multi-first'),
      lifecycle: {
        ...recordsByID.get('ann-multi-first').lifecycle,
        updated_at: '2099-01-01T00:00:00Z',
      },
    };
    const nextSecond = {
      ...recordsByID.get('ann-multi-second'),
      lifecycle: {
        ...recordsByID.get('ann-multi-second').lifecycle,
        updated_at: '2099-01-01T00:00:00Z',
      },
    };
    return {
      changedRecords: [nextFirst, nextSecond],
      result: { status: 'should-not-write' },
    };
  }), /Pending annotation mutations support one changed record plus index only/);
  assert.equal(await fs.readFile(first.annotation.path, 'utf8'), firstBefore);
  assert.equal(await fs.readFile(second.annotation.path, 'utf8'), secondBefore);
});

test('pending annotation mutation succeeds when disposable index write fails', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-index-disposable-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
  };
  const pendingRoot = path.join(stateRoot, 'repo', 'pending-annotations');
  const indexPath = path.join(pendingRoot, 'index.json');
  await fs.mkdir(indexPath, { recursive: true });

  const created = parseJSON(run([
    'create',
    '--id',
    'ann-index-disposable',
    '--target-kind',
    'region',
    '--target-summary',
    'Index cache write failure target',
    '--json',
  ], env));

  assert.equal(created.status, 'created');
  assert.equal((await fs.stat(indexPath)).isDirectory(), true);
  validateJSONFile(created.annotation.path);
  assert.equal(await readTextIfExists(created.annotation.path), await fs.readFile(created.annotation.path, 'utf8'));

  const listed = parseJSON(run(['list', '--json'], env));
  assert.equal(listed.count, 1);
  assert.equal(listed.annotations[0].id, 'ann-index-disposable');
  assert.equal((await fs.stat(indexPath)).isDirectory(), true);
});

test('pending annotation list stays read-only while mutations repair stale index', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-index-recovery-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
    AOS_PENDING_ANNOTATION_LOCK_TIMEOUT_MS: '10000',
  };
  const created = await Promise.all(Array.from({ length: 8 }, (_, index) => runAsync([
    'create',
    '--id',
    `ann-index-${index}`,
    '--target-kind',
    'region',
    '--target-summary',
    `Serialized target ${index}`,
    '--json',
  ], env)));
  assert(created.every((result) => result.status === 0), created);

  const linked = await Promise.all(Array.from({ length: 8 }, (_, index) => runAsync([
    'link-work-record',
    `ann-index-${index}`,
    '--work-record',
    `work-record:index-${index}`,
    '--json',
  ], env)));
  assert(linked.every((result) => result.status === 0), linked);

  const deleted = await Promise.all(Array.from({ length: 4 }, (_, index) => runAsync([
    'delete',
    `ann-index-${index}`,
    '--json',
  ], env)));
  assert(deleted.every((result) => result.status === 0), deleted);

  const all = parseJSON(run(['list', '--json'], env));
  assert.equal(all.count, 8);
  assert.equal(all.annotations.filter((item) => item.state === 'deleted').length, 4);
  assert.equal(all.annotations.filter((item) => item.work_record_link_count === 1).length, 8);

  const indexPath = path.join(stateRoot, 'repo', 'pending-annotations', 'index.json');
  const staleIndex = JSON.parse(await fs.readFile(indexPath, 'utf8'));
  staleIndex.annotations[0].state = 'pending';
  staleIndex.annotations[0].work_record_link_count = 0;
  await fs.writeFile(indexPath, `${JSON.stringify(staleIndex, null, 2)}\n`, 'utf8');
  const staleText = await fs.readFile(indexPath, 'utf8');
  const staleStat = await fs.stat(indexPath);
  const listedStale = parseJSON(run(['list', '--json'], env));
  assert.equal(listedStale.annotations.filter((item) => item.state === 'deleted').length, 4);
  assert.equal(listedStale.annotations.filter((item) => item.work_record_link_count === 1).length, 8);
  assert.equal(await fs.readFile(indexPath, 'utf8'), staleText);
  assert.equal((await fs.stat(indexPath)).mtimeMs, staleStat.mtimeMs);

  const consumedRepair = parseJSON(run(['consume', 'ann-index-4', '--actor', 'test-agent', '--json'], env));
  assert.equal(consumedRepair.annotation.state, 'consumed');
  const repairedStaleIndex = JSON.parse(await fs.readFile(indexPath, 'utf8'));
  assert.equal(repairedStaleIndex.annotations.find((item) => item.id === 'ann-index-0').state, 'deleted');
  assert.equal(repairedStaleIndex.annotations.find((item) => item.id === 'ann-index-0').work_record_link_count, 1);
  assert.equal(repairedStaleIndex.annotations.find((item) => item.id === 'ann-index-4').state, 'consumed');

  await fs.writeFile(indexPath, '{partial', 'utf8');
  const corruptText = await fs.readFile(indexPath, 'utf8');
  const corruptStat = await fs.stat(indexPath);
  const listedCorrupt = parseJSON(run(['list', '--state', 'deleted', '--json'], env));
  assert.equal(listedCorrupt.count, 4);
  assert.equal(await fs.readFile(indexPath, 'utf8'), corruptText);
  assert.equal((await fs.stat(indexPath)).mtimeMs, corruptStat.mtimeMs);

  const linkedRepair = parseJSON(run([
    'link-work-record',
    'ann-index-5',
    '--work-record',
    'work-record:index-repair-after-corrupt',
    '--json',
  ], env));
  assert.equal(linkedRepair.status, 'linked');
  const recoveredIndex = JSON.parse(await fs.readFile(indexPath, 'utf8'));
  assert.equal(recoveredIndex.annotations.length, 8);
  assert.equal(recoveredIndex.annotations.find((item) => item.id === 'ann-index-5').work_record_link_count, 2);
});

test('pending annotation list computes records without creating a missing index', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-missing-index-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
  };
  const created = parseJSON(run([
    'create',
    '--id',
    'ann-missing-index',
    '--target-kind',
    'region',
    '--target-summary',
    'Missing index target',
    '--json',
  ], env));
  const indexPath = path.join(stateRoot, 'repo', 'pending-annotations', 'index.json');
  await fs.unlink(indexPath);
  assert.equal(await readTextIfExists(indexPath), null);

  const listed = parseJSON(run(['list', '--json'], env));
  assert.equal(listed.count, 1);
  assert.equal(listed.annotations[0].id, 'ann-missing-index');
  assert.equal(await readTextIfExists(indexPath), null);
  validateJSONFile(created.annotation.path);
});

test('pending annotation corrupt index rebuild fails closed on invalid records', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-index-invalid-record-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
  };
  const created = parseJSON(run([
    'create',
    '--id',
    'ann-index-invalid',
    '--target-kind',
    'region',
    '--target-summary',
    'Invalid record during rebuild',
    '--json',
  ], env));
  const indexPath = path.join(stateRoot, 'repo', 'pending-annotations', 'index.json');
  const record = JSON.parse(await fs.readFile(created.annotation.path, 'utf8'));
  record.paths.root = path.join(stateRoot, 'installed', 'pending-annotations');
  await fs.writeFile(created.annotation.path, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  await fs.writeFile(indexPath, '{partial', 'utf8');

  const err = parseError(run(['list', '--json'], env));
  assert.equal(err.code, 'PENDING_ANNOTATION_STATE_CORRUPT');
});
