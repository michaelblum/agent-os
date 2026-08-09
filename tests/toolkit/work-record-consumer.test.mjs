import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  discoverWorkRecords,
  explainWorkRecordStatus,
  exportWorkRecordBundle,
  readWorkRecord,
  verifyWorkRecord,
} from '../../packages/toolkit/workbench/work-record-consumer.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const activeRoot = path.join(repoRoot, 'shared/schemas/fixtures/aos-work-record-v1/valid');
const active = path.join(activeRoot, 'repairable-stale-saved-ref.json');
const historical = path.join(repoRoot, 'shared/schemas/fixtures/aos-work-record-v0/valid/workflow-origin.json');

test('consumer discovers and reads active V1 records only', () => {
  const discovery = discoverWorkRecords({ roots: [activeRoot], repoRoot });
  assert.ok(discovery.records.length >= 3);
  assert.ok(discovery.records.every((record) => record.schema_version === '2026-08-work-record-v1'));
  assert.equal(readWorkRecord(active, { repoRoot }).status, 'success');
});

test('historical V0 is rejected for active read, verify, and export', () => {
  for (const operation of [readWorkRecord, verifyWorkRecord, exportWorkRecordBundle]) {
    const result = operation(historical, { repoRoot });
    assert.equal(result.status, 'failed');
    assert.equal(result.diagnostics[0].code, 'UNSUPPORTED_WORK_RECORD_SCHEMA');
  }
});

test('active reader rejects a discriminator-only malformed V1 record', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-malformed-work-record-v1-'));
  const malformed = path.join(root, 'malformed.json');
  fs.writeFileSync(malformed, `${JSON.stringify({
    type: 'aos.work_record',
    schema_version: '2026-08-work-record-v1',
    id: 'work-record:malformed',
  })}\n`);
  const result = readWorkRecord(malformed, { repoRoot });
  assert.equal(result.status, 'failed');
  assert.ok(result.diagnostics.some((item) => item.code === 'WORK_RECORD_V1_SCHEMA_INVALID'));
});

test('status reports neutral recovery evidence without authority state', () => {
  const status = explainWorkRecordStatus(active, { repoRoot });
  assert.equal(status.health_verdict, 'repairable');
  assert.equal(status.recovery.action, 'repair_proposal_available');
  assert.equal(status.recovery.mutates_record, false);
  assert.doesNotMatch(JSON.stringify(status), /authorization|approval|required_gate|automatic_replay|allowed_operations/);
});

test('consumer export resolves repeated-space evidence paths without rewriting them', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-consumer-evidence-v1-'));
  const artifactPath = path.join(root, 'caller  evidence.json');
  fs.writeFileSync(artifactPath, '{"ok":true}\n');
  const record = JSON.parse(fs.readFileSync(active, 'utf8'));
  record.evidence[0].uri = artifactPath;
  const recordPath = path.join(root, 'work-record.json');
  fs.writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  const result = exportWorkRecordBundle(recordPath, { roots: [root], repoRoot });
  assert.equal(result.status, 'success');
  assert.equal(result.evidence[0].uri, artifactPath);
  assert.equal(result.evidence[0].artifact_path, artifactPath);
  assert.equal(result.evidence[0].exists, true);
});

test('recovery guidance preserves exact caller command bytes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-consumer-command-v1-'));
  const record = JSON.parse(fs.readFileSync(active, 'utf8'));
  const command = './aos  see capture  browser:work-record-saved-ref-demo --save';
  record.execution_map.steps[0].action.args.recommended_next_command = command;
  const recordPath = path.join(root, 'work-record.json');
  fs.writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  const result = explainWorkRecordStatus(recordPath, { roots: [root], repoRoot });
  assert.deepEqual(result.recovery.next_commands, [command]);
});
