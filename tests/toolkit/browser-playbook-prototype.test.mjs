import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BROWSER_CLICK_STATUS_PROTOTYPE_ID,
  BROWSER_PLAYBOOK_PROTOTYPE_VERSION,
  createBrowserPlaybookPrototype,
  createBrowserPlaybookPrototypeWorkRecordOpenMessage,
  runBrowserPlaybookPrototype,
  subjectContracts,
  subjectFacets,
  WORK_RECORD_REPORT_ONLY_PROFILE_ID,
} from '../../packages/toolkit/workbench/index.js';
import {
  buildWorkRecordPatchRequest,
  createWorkRecordWorkbenchState,
  openWorkRecord,
  updateWorkRecordIntent,
  workRecordIsReadOnly,
  workRecordWorkbenchSnapshot,
} from '../../packages/toolkit/components/work-record-workbench/model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const workRecordFixtureRoot = path.join(repoRoot, 'shared/schemas/fixtures/aos-work-record-v0');
const playbookStepFixtureRoot = path.join(repoRoot, 'shared/schemas/fixtures/aos-playbook-step-v0');
const subjectSchemaPath = path.join(repoRoot, 'shared/schemas/aos-workbench-subject.schema.json');

function fixture(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function playbookStep() {
  return fixture(playbookStepFixtureRoot, 'valid/browser-click-status.json');
}

function evidenceSource() {
  return fixture(workRecordFixtureRoot, 'evidence/aos-browser-click-status.json');
}

function expectedWorkRecord() {
  return fixture(workRecordFixtureRoot, 'valid/playbook-browser-click-status.json');
}

function workflowGate() {
  return {
    ref: 'workflow-gate:playbook-browser-click-status-replay',
    token: 'workflow-gate-token:browser-prototype-test',
  };
}

function prototype() {
  return createBrowserPlaybookPrototype({
    playbookStep: playbookStep(),
    evidenceSource: evidenceSource(),
    workflowGateRef: workflowGate().ref,
  });
}

function validateSubject(subject) {
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
      subjectSchemaPath,
    ],
    {
      encoding: 'utf8',
      input: JSON.stringify(subject),
    },
  );
}

function assertNoReplayOrRepairControls(subject) {
  const contracts = [
    ...subjectContracts(subject),
    ...subjectFacets(subject).flatMap((facet) => facet.contracts || []),
  ].join(' ');
  assert.doesNotMatch(contracts, /replay|repair|macro|background/i);
  assert.equal('controls' in subject, false);
  assert.equal(subject.state.autonomous_replay_allowed, false);
  assert.equal(subject.state.autonomous_repair_allowed, false);
  assert.equal(subject.state.macro_playback_allowed, false);
  assert.equal(subject.state.background_loop_allowed, false);
  assert.equal(subject.state.broad_cli_surface_added, false);
}

test('browser Playbook prototype exposes a browser-compatible one-step subject descriptor', () => {
  const candidate = prototype();
  const validation = validateSubject(candidate.subject);

  assert.equal(candidate.type, 'aos.browser_playbook_prototype');
  assert.equal(candidate.schema_version, BROWSER_PLAYBOOK_PROTOTYPE_VERSION);
  assert.equal(candidate.id, BROWSER_CLICK_STATUS_PROTOTYPE_ID);
  assert.equal(candidate.run_policy.mode, 'simulate');
  assert.equal(candidate.run_policy.one_step_only, true);
  assert.equal(candidate.run_policy.explicit_workflow_gate_required, true);
  assert.equal(candidate.run_policy.autonomous_replay_allowed, false);
  assert.equal(candidate.run_policy.autonomous_repair_allowed, false);
  assert.equal(candidate.subject.subject_type, 'aos.playbook_prototype');
  assert.deepEqual(candidate.subject.capabilities, ['inspectable', 'verifier-target', 'exportable']);
  assert.ok(subjectContracts(candidate.subject).includes('playbook_step.simulate.once'));
  assert.ok(subjectContracts(candidate.subject).includes('work_record.open.read_only'));
  assert.ok(subjectFacets(candidate.subject).some((facet) => facet.key === 'playbook-simulate-controls'));
  assert.equal('views' in candidate.subject, false);
  assert.equal('controls' in candidate.subject, false);
  assert.equal(candidate.subject.state.target_dialect, 'browser');
  assert.equal(candidate.subject.state.target_with_ref, 'browser:work-record-live-action/e2');
  assert.equal(candidate.subject.metadata.is_wiki_subject_browser, false);
  assert.equal(candidate.subject.metadata.is_general_playbook_ui, false);
  assert.equal(candidate.subject.metadata.adds_public_cli_surface, false);
  assertNoReplayOrRepairControls(candidate.subject);
  assert.equal(validation.status, 0, `${validation.stdout}${validation.stderr}`);
});

test('browser Playbook prototype rejects ungated simulation without emitting a Work Record', () => {
  const result = runBrowserPlaybookPrototype(prototype());

  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'workflow_gate_required');
  assert.equal(result.mode, 'simulate');
  assert.equal(result.record, null);
  assert.equal(result.verifier, null);
  assert.equal(result.workbench_open_message, null);
  assert.equal(result.diagnostics[0].code, 'workflow_gate_required');
  assertNoReplayOrRepairControls(result.subject);
});

test('browser Playbook prototype simulates one gated step through the harness', () => {
  const result = runBrowserPlaybookPrototype(prototype(), {
    workflowGate: workflowGate(),
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.reason, 'record_verified');
  assert.equal(result.mode, 'simulate');
  assert.equal(result.harness.type, 'aos.playbook_step_harness.result');
  assert.equal(result.harness.mode, 'simulate');
  assert.equal(result.harness.workflow_gate_ref, workflowGate().ref);
  assert.equal(result.harness.playbook_step_id, 'playbook-step:browser-click-status');
  assert.deepEqual(result.record, expectedWorkRecord());
  assert.equal(result.record.origin.kind, 'playbook');
  assert.equal(result.record.verifier_report.verifier.id, WORK_RECORD_REPORT_ONLY_PROFILE_ID);
  assert.equal(result.verifier.status, 'passed');
  assert.equal(result.verifier.profile_id, WORK_RECORD_REPORT_ONLY_PROFILE_ID);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.subject.state.record_id, 'work-record:aos-browser-click-status-2026-05-06');
  assert.equal(result.subject.state.verifier_status, 'passed');
  assert.equal(result.record.execution_map.replay_policy.mode, 'report_only');
  assert.equal(result.record.execution_map.replay_policy.replay_requires_workflow_gate, true);
  assert.equal(result.record.execution_map.replay_policy.repair_requires_workflow_gate, true);
  assertNoReplayOrRepairControls(result.subject);
});

test('browser Playbook prototype enforces the one-step harness boundary', () => {
  const step = playbookStep();
  const candidate = createBrowserPlaybookPrototype({
    playbookStep: {
      ...step,
      steps: [step],
    },
    evidenceSource: evidenceSource(),
    workflowGateRef: workflowGate().ref,
  });
  const result = runBrowserPlaybookPrototype(candidate, {
    workflowGate: workflowGate(),
  });

  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'one_step_only');
  assert.equal(result.record, null);
  assert.equal(result.harness.record, null);
  assert.equal(result.diagnostics[0].code, 'one_step_only');
});

test('emitted browser Playbook Work Record opens read-only through the existing workbench model', () => {
  const result = runBrowserPlaybookPrototype(prototype(), {
    workflowGate: workflowGate(),
  });
  const message = createBrowserPlaybookPrototypeWorkRecordOpenMessage(result.record, {
    prototype: prototype(),
  });
  const state = createWorkRecordWorkbenchState();
  const opened = openWorkRecord(state, message);
  const snapshot = workRecordWorkbenchSnapshot(state);

  assert.equal(message.type, 'work_record.open');
  assert.equal(message.source.kind, 'browser_playbook_prototype');
  assert.equal(message.source.read_only, true);
  assert.equal(opened.status, 'opened');
  assert.equal(workRecordIsReadOnly(state.record), true);
  assert.equal(snapshot.source.kind, 'browser_playbook_prototype');
  assert.equal(snapshot.subject.subject_type, 'aos.work_record');
  assert.equal(snapshot.subject.source.origin.kind, 'playbook');
  assert.equal(snapshot.subject.persistence, null);
  assert.ok(subjectFacets(snapshot.subject).some((facet) => facet.key === 'work_record.verifier_report'));
  assert.equal('views' in snapshot.subject, false);
  assert.equal('controls' in snapshot.subject, false);
  assert.equal(snapshot.diagnostics.read_only, true);
  assert.equal(snapshot.diagnostics.verifier_status, 'passed');

  const rejectedIntent = updateWorkRecordIntent(state, { summary: 'mutate prototype record' });
  assert.equal(rejectedIntent.status, 'rejected');
  assert.equal(rejectedIntent.reason, 'read_only');
  assert.throws(() => buildWorkRecordPatchRequest(state), /read-only/);
});
