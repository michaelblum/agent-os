import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkPlaybookHarnessGate,
  runOneStepPlaybookHarness,
  PLAYBOOK_STEP_HARNESS_VERSION,
  WORK_RECORD_REPORT_ONLY_PROFILE_ID,
} from '../../packages/toolkit/workbench/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const workRecordFixtureRoot = path.join(repoRoot, 'shared/schemas/fixtures/aos-work-record-v0');
const playbookStepFixtureRoot = path.join(repoRoot, 'shared/schemas/fixtures/aos-playbook-step-v0');
const workRecordSchemaPath = path.join(repoRoot, 'shared/schemas/aos-work-record-v0.schema.json');

function fixture(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function playbookStep() {
  return fixture(playbookStepFixtureRoot, 'valid/browser-click-status.json');
}

function evidenceSource() {
  return fixture(workRecordFixtureRoot, 'evidence/aos-browser-click-status.json');
}

function workflowGate() {
  return {
    ref: 'workflow-gate:playbook-browser-click-status-replay',
    token: 'workflow-gate-token:test-deterministic-run',
  };
}

function validateWorkRecord(record) {
  return spawnSync(
    'python3',
    [
      '-c',
      `
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator

schema = json.loads(Path(sys.argv[1]).read_text())
instance = json.loads(sys.stdin.read())
Draft202012Validator.check_schema(schema)
validator = Draft202012Validator(schema)
errors = sorted(validator.iter_errors(instance), key=lambda e: list(e.path))
if errors:
    for error in errors[:8]:
        print(error.message)
    sys.exit(1)
`,
      workRecordSchemaPath,
    ],
    {
      encoding: 'utf8',
      input: JSON.stringify(record),
    },
  );
}

test('one-step Playbook harness rejects ungated simulated execution', () => {
  const result = runOneStepPlaybookHarness(playbookStep(), {
    mode: 'simulate',
    evidenceSource: evidenceSource(),
  });

  assert.equal(result.schema_version, PLAYBOOK_STEP_HARNESS_VERSION);
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'workflow_gate_required');
  assert.equal(result.record, null);
  assert.equal(result.verifier, null);
  assert.equal(result.diagnostics[0].code, 'workflow_gate_required');
});

test('one-step Playbook harness rejects ungated execution before the action adapter runs', () => {
  let actionPathReached = false;
  const result = runOneStepPlaybookHarness(playbookStep(), {
    mode: 'execute',
    executeStep: () => {
      actionPathReached = true;
      return evidenceSource();
    },
  });

  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'workflow_gate_required');
  assert.equal(actionPathReached, false);
  assert.equal(result.record, null);
});

test('one-step Playbook harness rejects undeclared workflow gate refs', () => {
  const result = runOneStepPlaybookHarness(playbookStep(), {
    workflowGate: {
      ref: 'workflow-gate:other',
      token: 'workflow-gate-token:test',
    },
    evidenceSource: evidenceSource(),
  });

  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'workflow_gate_ref_not_allowed');
  assert.deepEqual(result.diagnostics[0].allowed_gate_refs, playbookStep().workflow_gates.gate_refs);
});

test('gated deterministic harness run emits a validated Playbook-origin Work Record', () => {
  const step = playbookStep();
  const source = evidenceSource();
  const gate = workflowGate();
  const stepBefore = JSON.stringify(step);
  const sourceBefore = JSON.stringify(source);

  const result = runOneStepPlaybookHarness(step, {
    workflowGate: gate,
    mode: 'simulate',
    evidenceSource: source,
  });
  const validation = validateWorkRecord(result.record);

  assert.equal(result.status, 'passed');
  assert.equal(result.reason, 'record_verified');
  assert.equal(result.mode, 'simulate');
  assert.equal(result.workflow_gate_ref, gate.ref);
  assert.equal(result.record.origin.kind, 'playbook');
  assert.equal(result.record.origin.ref, 'playbook:browser-live-action-status');
  assert.equal(result.record.metadata.playbook_step_id, 'playbook-step:browser-click-status');
  assert.equal(result.record.verifier_report.verifier.id, WORK_RECORD_REPORT_ONLY_PROFILE_ID);
  assert.equal(result.verifier.profile_id, WORK_RECORD_REPORT_ONLY_PROFILE_ID);
  assert.equal(result.verifier.status, 'passed');
  assert.deepEqual(result.diagnostics, []);
  assert.equal(validation.status, 0, `${validation.stdout}${validation.stderr}`);
  assert.equal(JSON.stringify(step), stepBefore);
  assert.equal(JSON.stringify(source), sourceBefore);
});

test('gated execute-mode harness calls the caller-supplied action adapter once', () => {
  let callCount = 0;
  const gate = workflowGate();
  const result = runOneStepPlaybookHarness(playbookStep(), {
    workflowGate: gate,
    mode: 'execute',
    executeStep: ({ playbookStep: step, workflowGate: adapterGate }) => {
      callCount += 1;
      assert.equal(step.id, 'playbook-step:browser-click-status');
      assert.equal(adapterGate.ref, gate.ref);
      return evidenceSource();
    },
  });

  assert.equal(callCount, 1);
  assert.equal(result.status, 'passed');
  assert.equal(result.mode, 'execute');
  assert.equal(result.record.origin.kind, 'playbook');
});

test('Playbook harness gate check requires both gate ref and token', () => {
  const missingToken = checkPlaybookHarnessGate(playbookStep(), {
    ref: 'workflow-gate:playbook-browser-click-status-replay',
  });

  assert.equal(missingToken.ok, false);
  assert.equal(missingToken.diagnostic.code, 'workflow_gate_required');
});
