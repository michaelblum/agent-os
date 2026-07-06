import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  parseJSON,
  rejectJSONFile,
  run,
  validateJSONFile,
} from '../lib/pending-annotation-fixtures.mjs';

test('pending annotation schema accepts persisted records with required nullable source_capture', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-schema-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
  };
  const created = parseJSON(run([
    'create',
    '--id',
    'ann-schema-null-source-capture',
    '--target-kind',
    'region',
    '--target-summary',
    'Schema fixture target',
    '--json',
  ], env));
  const record = JSON.parse(await fs.readFile(created.annotation.path, 'utf8'));
  assert(Object.hasOwn(record, 'source_capture'));
  assert.equal(record.source_capture, null);
  validateJSONFile(created.annotation.path);
  delete record.source_capture;
  const invalidRecordPath = path.join(stateRoot, 'missing-source-capture.json');
  await fs.writeFile(invalidRecordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  rejectJSONFile(invalidRecordPath);
});

test('pending annotation schema rejects terminal lifecycle records without transition evidence', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-terminal-schema-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
  };
  const created = parseJSON(run([
    'create',
    '--id',
    'ann-schema-terminal',
    '--target-kind',
    'region',
    '--target-summary',
    'Terminal schema fixture',
    '--json',
  ], env));
  const record = JSON.parse(await fs.readFile(created.annotation.path, 'utf8'));

  const consumedWithoutEvidence = {
    ...record,
    lifecycle: {
      ...record.lifecycle,
      state: 'consumed',
      consumed_at: null,
      consumed_by: null,
    },
  };
  const consumedPath = path.join(stateRoot, 'consumed-without-evidence.json');
  await fs.writeFile(consumedPath, `${JSON.stringify(consumedWithoutEvidence, null, 2)}\n`, 'utf8');
  rejectJSONFile(consumedPath);

  const deletedWithoutEvidence = {
    ...record,
    lifecycle: {
      ...record.lifecycle,
      state: 'deleted',
      deleted_at: null,
    },
  };
  const deletedPath = path.join(stateRoot, 'deleted-without-evidence.json');
  await fs.writeFile(deletedPath, `${JSON.stringify(deletedWithoutEvidence, null, 2)}\n`, 'utf8');
  rejectJSONFile(deletedPath);
});
