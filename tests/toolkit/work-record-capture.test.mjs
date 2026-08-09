import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildWorkRecordV1FromAosActionEvidence,
  buildWorkRecordV1FromCommandEvidence,
  buildWorkRecordV1FromStepDescriptorEvidence,
} from '../../packages/toolkit/workbench/work-record-capture.js';
import { runWorkRecordVerifierProfile } from '../../packages/toolkit/workbench/work-record-verifier.js';
import { validateJsonSchema } from '../lib/json-schema-validation.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => JSON.parse(fs.readFileSync(path.join(repoRoot, relative), 'utf8'));
const schemaPath = path.join(repoRoot, 'shared/schemas/aos-work-record-v1.schema.json');
const forbidden = /workflow_gates|authorization|approval_required|risk_level|allowed_operations|operation_allowlist|automatic_replay/;

test('AOS action evidence builder emits neutral schema-valid Work Record V1', () => {
  const source = read('shared/schemas/fixtures/aos-work-record-v1/evidence/aos-browser-click-status.json');
  const record = buildWorkRecordV1FromAosActionEvidence(source);
  assert.equal(record.schema_version, '2026-08-work-record-v1');
  assert.deepEqual(validateJsonSchema(schemaPath, record), []);
  assert.doesNotMatch(JSON.stringify(record), forbidden);
  assert.equal(runWorkRecordVerifierProfile(record).status, 'passed');
});

test('capture builders preserve caller label and command bytes exactly', () => {
  const actionSource = read('shared/schemas/fixtures/aos-work-record-v1/evidence/aos-browser-click-status.json');
  actionSource.label = 'Browser  action  evidence';
  actionSource.before_perception.artifact_uri = 'artifact:/tmp/before  exact.json';
  actionSource.action.artifact_uri = 'artifact:/tmp/action  exact.json';
  actionSource.after_perception.artifact_uri = 'artifact:/tmp/after  exact.json';
  const actionRecord = buildWorkRecordV1FromAosActionEvidence(actionSource);
  assert.equal(actionRecord.label, actionSource.label);
  for (const phase of ['before_perception', 'action', 'after_perception']) {
    const uri = actionSource[phase].artifact_uri;
    assert.ok(actionRecord.execution_map.artifact_routes.some((route) => route.destination === uri));
    assert.ok(actionRecord.evidence.some((item) => item.uri === uri));
  }

  const commandSource = {
    id: 'command-source:raw-fidelity',
    label: 'Command  evidence  label',
    command: 'node  --test  exact-command.test.mjs',
    cwd: '/tmp/aos  command  root',
    created_at: '2026-08-06T00:00:00.000Z',
    exit_code: 0,
    intent: { summary: 'Capture exact command evidence.' },
  };
  const commandRecord = buildWorkRecordV1FromCommandEvidence(commandSource);
  assert.equal(commandRecord.label, commandSource.label);
  assert.equal(commandRecord.evidence[0].metadata.command, commandSource.command);
  assert.equal(commandRecord.execution_map.steps[0].action.args.command, commandSource.command);
  assert.equal(commandRecord.execution_map.steps[0].action.args.cwd, commandSource.cwd);
  assert.equal(commandRecord.execution_map.steps[0].action.target, `command:${commandSource.command}`);
});

test('Step Descriptor V1 capture requires no authority input and preserves workflow provenance only', () => {
  const step = read('shared/schemas/fixtures/aos-step-descriptor-v1/valid/browser-click-status.json');
  const source = read('shared/schemas/fixtures/aos-work-record-v1/evidence/aos-browser-click-status.json');
  const record = buildWorkRecordV1FromStepDescriptorEvidence(step, source);
  assert.equal(record.origin.kind, 'workflow');
  assert.equal(record.origin.ref, step.workflow_ref);
  assert.deepEqual(validateJsonSchema(schemaPath, record), []);
  assert.doesNotMatch(JSON.stringify(record), forbidden);
});

test('Step Descriptor capture rejects malformed V1 and frozen V0 before projection', () => {
  const source = read('shared/schemas/fixtures/aos-work-record-v1/evidence/aos-browser-click-status.json');
  assert.throws(
    () => buildWorkRecordV1FromStepDescriptorEvidence({ id: 'step:malformed', workflow_ref: 'workflow:malformed' }, source),
    /Step Descriptor V1 schema validation failed/,
  );
  const historical = read('shared/schemas/fixtures/aos-step-descriptor-v0/valid/browser-click-status.json');
  assert.throws(
    () => buildWorkRecordV1FromStepDescriptorEvidence(historical, source),
    /Step Descriptor V1 schema validation failed/,
  );
});

test('Step Descriptor capture rejects evidence that does not exactly match descriptor identity', () => {
  const step = read('shared/schemas/fixtures/aos-step-descriptor-v1/valid/browser-click-status.json');
  const source = read('shared/schemas/fixtures/aos-work-record-v1/evidence/aos-browser-click-status.json');
  source.action.verb = 'type';
  assert.throws(
    () => buildWorkRecordV1FromStepDescriptorEvidence(step, source),
    /Step Descriptor V1 evidence binding failed/,
  );
});
