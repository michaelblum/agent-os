import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import PlaybookWorkbench from '../../packages/toolkit/components/playbook-workbench/index.js';
import {
  PLAYBOOK_WORKBENCH_MESSAGE_TYPES,
  PLAYBOOK_WORKBENCH_SURFACE,
  PLAYBOOK_WORKBENCH_URL,
  PLAYBOOK_WORKBENCH_WORK_RECORD_CANVAS_ID,
  createPlaybookWorkbenchState,
  loadPlaybookWorkbenchFixture,
  openPlaybookWorkbenchWorkRecord,
  playbookWorkbenchForbiddenControls,
  playbookWorkbenchSnapshot,
  setPlaybookWorkbenchWorkflowGate,
  simulatePlaybookWorkbench,
} from '../../packages/toolkit/components/playbook-workbench/model.js';
import {
  playbookWorkbenchAosRef,
  playbookWorkbenchSemanticRefs,
} from '../../packages/toolkit/components/playbook-workbench/semantics.js';
import {
  workRecordIsReadOnly,
} from '../../packages/toolkit/components/work-record-workbench/model.js';
import {
  subjectFacets,
} from '../../packages/toolkit/workbench/subject.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const workRecordFixtureRoot = path.join(repoRoot, 'shared/schemas/fixtures/aos-work-record-v0');
const playbookStepFixtureRoot = path.join(repoRoot, 'shared/schemas/fixtures/aos-playbook-step-v0');

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
    token: 'workflow-gate-token:playbook-workbench-test',
  };
}

function loadedState() {
  return createPlaybookWorkbenchState({
    playbookStep: playbookStep(),
    evidenceSource: evidenceSource(),
  });
}

async function repoText(relativePath) {
  return readFile(path.join(repoRoot, relativePath), 'utf8');
}

function assertNoForbiddenControls(subject) {
  const forbidden = playbookWorkbenchForbiddenControls(subject);
  assert.deepEqual(forbidden, {
    replay: false,
    repair: false,
    macro: false,
    background_loop: false,
  });
}

test('Playbook Workbench V0 starts as a named fixture-backed report-only shell state', () => {
  const state = loadedState();
  const snapshot = playbookWorkbenchSnapshot(state);

  assert.equal(snapshot.surface, PLAYBOOK_WORKBENCH_SURFACE);
  assert.equal(snapshot.url, PLAYBOOK_WORKBENCH_URL);
  assert.equal(snapshot.fixture_loaded, true);
  assert.equal(snapshot.status, 'ready');
  assert.equal(snapshot.step_summary.id, 'playbook-step:browser-click-status');
  assert.equal(snapshot.step_summary.target_dialect, 'browser');
  assert.equal(snapshot.step_summary.target_with_ref, 'browser:work-record-live-action/e2');
  assert.equal(snapshot.gate_status.status, 'blocked');
  assert.equal(snapshot.gate_status.reason, 'workflow_gate_required');
  assert.equal(snapshot.gate_status.token_present, false);
  assert.equal(snapshot.work_record_summary.id, '');
  assert.equal(snapshot.boundaries.fixture_backed, true);
  assert.equal(snapshot.boundaries.report_only, true);
  assert.equal(snapshot.boundaries.one_step_only, true);
  assert.equal(snapshot.boundaries.live_browser_execution_allowed, false);
  assert.equal(snapshot.boundaries.autonomous_replay_allowed, false);
  assert.equal(snapshot.boundaries.autonomous_repair_allowed, false);
  assert.equal(snapshot.boundaries.macro_playback_allowed, false);
  assert.equal(snapshot.boundaries.background_loop_allowed, false);
  assert.equal(snapshot.boundaries.public_cli_surface_added, false);
  assert.equal(snapshot.boundaries.second_work_record_viewer, false);
  assertNoForbiddenControls(snapshot.subject);
});

test('Playbook Workbench V0 loads fixtures through its launch/message contract', () => {
  const state = createPlaybookWorkbenchState();
  const result = loadPlaybookWorkbenchFixture(state, {
    playbook_step: playbookStep(),
    evidence_source: evidenceSource(),
    work_record_workbench_url: 'aos://toolkit_test/components/work-record-workbench/index.html',
  });
  const snapshot = playbookWorkbenchSnapshot(state);

  assert.equal(result.type, PLAYBOOK_WORKBENCH_MESSAGE_TYPES.load);
  assert.equal(result.status, 'loaded');
  assert.equal(snapshot.fixture_loaded, true);
  assert.equal(snapshot.step_summary.playbook_ref, 'playbook:browser-live-action-status');
  assert.equal(
    snapshot.work_record_workbench_url,
    'aos://toolkit_test/components/work-record-workbench/index.html',
  );
});

test('Playbook Workbench V0 rejects simulation until an explicit gate ref and token are present', () => {
  const state = loadedState();
  const result = simulatePlaybookWorkbench(state);
  const snapshot = playbookWorkbenchSnapshot(state);

  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'workflow_gate_required');
  assert.equal(result.record_id, null);
  assert.equal(snapshot.status, 'rejected');
  assert.equal(snapshot.work_record_summary.id, '');
  assert.equal(snapshot.diagnostics[0].code, 'workflow_gate_required');
});

test('Playbook Workbench V0 rejects undeclared workflow gate refs', () => {
  const state = loadedState();
  setPlaybookWorkbenchWorkflowGate(state, {
    ref: 'workflow-gate:not-declared',
    token: 'workflow-gate-token:test',
  });

  const result = simulatePlaybookWorkbench(state);

  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'workflow_gate_ref_not_allowed');
  assert.equal(result.record_id, null);
  assert.equal(result.diagnostics[0].allowed_gate_refs[0], workflowGate().ref);
});

test('Playbook Workbench V0 simulates exactly one gated saved-evidence step', () => {
  const state = loadedState();
  setPlaybookWorkbenchWorkflowGate(state, workflowGate());
  const result = simulatePlaybookWorkbench(state);
  const snapshot = playbookWorkbenchSnapshot(state);

  assert.equal(result.status, 'passed');
  assert.equal(result.reason, 'record_verified');
  assert.equal(result.workflow_gate_ref, workflowGate().ref);
  assert.equal(result.record_id, 'work-record:aos-browser-click-status-2026-05-06');
  assert.equal(snapshot.status, 'simulated');
  assert.equal(snapshot.gate_status.status, 'ready');
  assert.equal(snapshot.verifier_summary.status, 'passed');
  assert.equal(snapshot.verifier_summary.profile_id, 'aos.verifier.work-record.v0.report-only');
  assert.equal(snapshot.verifier_summary.mutates_record, false);
  assert.equal(snapshot.work_record_summary.id, 'work-record:aos-browser-click-status-2026-05-06');
  assert.equal(snapshot.work_record_summary.origin_kind, 'playbook');
  assert.equal(snapshot.work_record_summary.steps, 1);
  assert.equal(snapshot.work_record_summary.replay_policy.mode, 'report_only');
  assert.equal(snapshot.work_record_summary.replay_policy.replay_requires_workflow_gate, true);
  assert.equal(snapshot.work_record_summary.replay_policy.repair_requires_workflow_gate, true);
  assert.equal(state.result.harness.mode, 'simulate');
  assert.equal(state.record.origin.kind, 'playbook');
  assert.equal(state.record.execution_map.steps.length, 1);
  assertNoForbiddenControls(snapshot.subject);
});

test('Playbook Workbench V0 hands off emitted records to the existing read-only Work Record workbench model', () => {
  const state = loadedState();
  setPlaybookWorkbenchWorkflowGate(state, workflowGate());
  simulatePlaybookWorkbench(state);

  const openResult = openPlaybookWorkbenchWorkRecord(state);
  const snapshot = playbookWorkbenchSnapshot(state);

  assert.equal(openResult.type, PLAYBOOK_WORKBENCH_MESSAGE_TYPES.workRecordOpenResult);
  assert.equal(openResult.status, 'opened');
  assert.equal(openResult.record_id, 'work-record:aos-browser-click-status-2026-05-06');
  assert.equal(openResult.read_only, true);
  assert.equal(openResult.work_record_canvas_id, PLAYBOOK_WORKBENCH_WORK_RECORD_CANVAS_ID);
  assert.equal(snapshot.work_record_open.open_message.type, 'work_record.open');
  assert.equal(snapshot.work_record_open.open_message.source.kind, 'browser_playbook_prototype');
  assert.equal(snapshot.work_record_open.workbench_snapshot.subject.subject_type, 'aos.work_record');
  assert.equal(snapshot.work_record_open.workbench_snapshot.diagnostics.read_only, true);
  assert.equal(snapshot.work_record_open.workbench_snapshot.diagnostics.verifier_status, 'passed');
  assert.equal(workRecordIsReadOnly(snapshot.work_record_open.workbench_snapshot.record), true);
  assert.ok(subjectFacets(snapshot.work_record_open.workbench_snapshot.subject)
    .some((facet) => facet.key === 'work_record.verifier_report'));
  assert.equal('controls' in snapshot.work_record_open.workbench_snapshot.subject, false);
});

test('Playbook Workbench V0 exposes stable semantic refs and no replay/repair/macro controls', async () => {
  const shell = PlaybookWorkbench();
  const refs = playbookWorkbenchSemanticRefs();
  const indexHtml = await repoText('packages/toolkit/components/playbook-workbench/index.html');
  const indexJs = await repoText('packages/toolkit/components/playbook-workbench/index.js');
  const launch = await repoText('packages/toolkit/components/playbook-workbench/launch.sh');

  assert.equal(shell.manifest.name, PLAYBOOK_WORKBENCH_SURFACE);
  assert.equal(refs.root, playbookWorkbenchAosRef('root'));
  assert.equal(refs.gateRef, playbookWorkbenchAosRef('gate-ref'));
  assert.equal(refs.gateToken, playbookWorkbenchAosRef('gate-token'));
  assert.equal(refs.simulate, playbookWorkbenchAosRef('simulate'));
  assert.equal(refs.openWorkRecord, playbookWorkbenchAosRef('open-work-record'));
  assert.ok(shell.manifest.accepts.includes(PLAYBOOK_WORKBENCH_MESSAGE_TYPES.load));
  assert.ok(shell.manifest.accepts.includes(PLAYBOOK_WORKBENCH_MESSAGE_TYPES.workflowGateSet));
  assert.ok(shell.manifest.accepts.includes(PLAYBOOK_WORKBENCH_MESSAGE_TYPES.simulateRequested));
  assert.ok(shell.manifest.accepts.includes(PLAYBOOK_WORKBENCH_MESSAGE_TYPES.workRecordOpenRequested));
  assert.match(indexHtml, /Playbook Workbench V0/);
  assert.match(indexJs, /data-action="simulate"/);
  assert.match(indexJs, /data-action="open-work-record"/);
  assert.match(indexJs, /id: 'gate-ref'/);
  assert.match(indexJs, /id: 'gate-token'/);
  assert.match(indexJs, /frame: \[80, 92, 1180, 720\]/);
  assert.match(indexJs, /if \(result === expectedRecordId\) return true;/);
  assert.doesNotMatch(indexJs, /result !== 'false'/);
  assert.match(launch, /--manifest playbook-workbench-v0/);
  assert.match(launch, /playbook_workbench\.load/);
  assert.doesNotMatch(indexJs, /data-action="[^"]*(replay|repair|macro)[^"]*"/i);
});
