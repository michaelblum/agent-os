import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildWorkRecordGateRequestFromRepairPlan,
  checkWorkRecordGateAuthorizationFromRepairPlan,
  planWorkRecordRepair,
  repairPlanIdentity,
  WORK_RECORD_WORKFLOW_GATE_AUTHORIZATION_SCHEMA_VERSION,
} from '../../packages/toolkit/workbench/work-record.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixtureRoot = path.join(repoRoot, 'shared/schemas/fixtures/aos-work-record-v0/valid');
const repairableFixture = path.join(fixtureRoot, 'repairable-stale-saved-ref.json');
const validFixture = path.join(fixtureRoot, 'workflow-origin.json');

function runAos(args) {
  return spawnSync('./aos', args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function approvedRecord(request) {
  return {
    schema_version: 'aos.gate.record.v1',
    gate_id: request.gate_request.id,
    request_schema_version: 'aos.gate.request.v1',
    prompt_title: request.gate_request.prompt.title,
    source: { surface: 'work_record.repair_plan', session_id: null, agent: null },
    receptor: 'test',
    ui_variant: 'approve_deny',
    field_kinds: ['exclusive_choice'],
    timeout_ms: 0,
    created_at: '2026-07-04T00:00:00.000Z',
    presented_at: '2026-07-04T00:00:00.000Z',
    resolved_at: '2026-07-04T00:00:01.000Z',
    elapsed_ms: 1000,
    resolution: 'answered',
    status: null,
    response_stored: true,
    response: { authorization: 'approve' },
  };
}

function resumeEvent(request, response = { decision: 'approve' }) {
  return {
    schema_version: 'aos.gate.resume-event.v1',
    event_id: 'gate-resume-11111111-1111-4111-8111-111111111111',
    continuation_id: 'gate-cont-11111111-1111-4111-8111-111111111111',
    gate_id: request.gate_request.id,
    session_id: 'codex-test',
    harness: 'codex',
    provider: 'codex',
    authored_by: { role: 'human', user: 'tester' },
    authored_role: 'human',
    created_at: '2026-07-04T00:00:01.000Z',
    resolution: 'answered',
    status: null,
    answer_summary: { kind: 'object', keys: Object.keys(response).sort() },
    response_stored: true,
    response,
    adapter: {
      hint: 'codex_exec',
      suggested_command: 'codex exec <human-authored-resume-message>',
    },
  };
}

function assertNonExecutingAuthorization(envelope) {
  assert.equal(envelope.schema_version, WORK_RECORD_WORKFLOW_GATE_AUTHORIZATION_SCHEMA_VERSION);
  assert.equal(envelope.executes_repair, false);
  assert.equal(envelope.mutates_record, false);
  assert.equal(envelope.automatic_replay_allowed, false);
  assert.equal(envelope.authorizes_future_attempt, envelope.status === 'authorized');
}

test('Work Record repair plan builds a deterministic approve/deny gate request without executing repair', () => {
  const before = fs.readFileSync(repairableFixture, 'utf8');
  const plan = planWorkRecordRepair(repairableFixture, { repoRoot });
  const first = buildWorkRecordGateRequestFromRepairPlan(plan);
  const second = buildWorkRecordGateRequestFromRepairPlan(plan);
  const after = fs.readFileSync(repairableFixture, 'utf8');

  assert.equal(before, after, 'gate request generation must not mutate the source Work Record');
  assert.equal(first.status, 'pending');
  assert.deepEqual(first.gate_request, second.gate_request);
  assert.equal(first.gate_request.schema_version, 'aos.gate.request.v1');
  assert.equal(first.gate_request.ui.variant, 'approve_deny');
  assert.equal(first.gate_request.record_response, true);
  assert.equal(first.gate_request.metadata.record_response, true);
  assert.equal(first.gate_request.metadata.source, 'work_record.repair_plan');
  assert.equal(first.gate_request.metadata.source_work_record.id, 'work-record:repairable-stale-saved-ref-2026-07-04');
  assert.equal(first.gate_request.metadata.repair_plan.schema_version, '2026-07-work-record-repair-plan-v0');
  assert.equal(first.gate_request.metadata.repair_plan.digest, repairPlanIdentity(plan).digest);
  assert.deepEqual(first.gate_request.metadata.candidate_patch_ids, ['candidate_patch:execution_map_refs']);
  assert.ok(first.gate_request.metadata.step_ids.includes('step:prepare-candidate-patch'));
  assert.equal(first.gate_request.metadata.authorizes_future_attempt_only, true);
  assert.equal(first.gate_request.metadata.executes_repair, false);
  assert.equal(first.gate_request.metadata.mutates_record, false);
  assert.match(first.gate_request.prompt.body, /does not execute repair/);
  assertNonExecutingAuthorization(first);
});

test('Work Record gate authorization distinguishes terminal outcomes and fails closed', () => {
  const plan = planWorkRecordRepair(repairableFixture, { repoRoot });
  const request = buildWorkRecordGateRequestFromRepairPlan(plan);
  const approved = approvedRecord(request);

  const authorized = checkWorkRecordGateAuthorizationFromRepairPlan(plan, approved);
  assert.equal(authorized.status, 'authorized');
  assert.equal(authorized.result, 'approved');
  assert.equal(authorized.authorizes_future_attempt, true);
  assertNonExecutingAuthorization(authorized);

  const denied = checkWorkRecordGateAuthorizationFromRepairPlan(plan, {
    ...approved,
    response: { authorization: 'deny' },
  });
  assert.equal(denied.status, 'denied');
  assert.equal(denied.result, 'denied');
  assertNonExecutingAuthorization(denied);

  const dismissed = checkWorkRecordGateAuthorizationFromRepairPlan(plan, {
    ...approved,
    resolution: 'dismissed',
    status: 'dismissed',
    response_stored: false,
  });
  assert.equal(dismissed.status, 'dismissed');
  assert.equal(dismissed.result, 'dismissed');

  const timeout = checkWorkRecordGateAuthorizationFromRepairPlan(plan, {
    ...approved,
    resolution: 'timeout',
    status: 'timeout',
    response_stored: false,
  });
  assert.equal(timeout.status, 'timeout');
  assert.equal(timeout.result, 'timeout');

  const missingResponse = checkWorkRecordGateAuthorizationFromRepairPlan(plan, {
    ...approved,
    response_stored: false,
  });
  assert.equal(missingResponse.status, 'insufficient_evidence');
  assert.ok(missingResponse.diagnostics.some((diagnostic) => diagnostic.code === 'APPROVAL_RESPONSE_NOT_STORED'));

  const ambiguous = checkWorkRecordGateAuthorizationFromRepairPlan(plan, {
    ...approved,
    response: { decision: 'later' },
  });
  assert.equal(ambiguous.status, 'insufficient_evidence');
  assert.ok(ambiguous.diagnostics.some((diagnostic) => diagnostic.code === 'APPROVAL_RESPONSE_AMBIGUOUS'));

  const mismatch = checkWorkRecordGateAuthorizationFromRepairPlan(plan, {
    ...approved,
    gate_id: 'gate:wrong-record-or-gate',
  });
  assert.equal(mismatch.status, 'mismatch');
  assert.ok(mismatch.diagnostics.some((diagnostic) => diagnostic.code === 'GATE_ID_MISMATCH'));

  const stale = checkWorkRecordGateAuthorizationFromRepairPlan(plan, {
    ...approved,
    gate_id: 'work-record-gate:aaaaaaaaaaaaaaaaaaaaaaaa',
  });
  assert.equal(stale.status, 'stale');
  assert.ok(stale.diagnostics.some((diagnostic) => diagnostic.code === 'STALE_REPAIR_PLAN_GATE_ID'));

  const unsupported = checkWorkRecordGateAuthorizationFromRepairPlan(plan, {
    schema_version: 'unknown',
    gate_id: approved.gate_id,
  });
  assert.equal(unsupported.status, 'unsupported');
});

test('Work Record gate authorization accepts stored positive resume events', () => {
  const plan = planWorkRecordRepair(repairableFixture, { repoRoot });
  const request = buildWorkRecordGateRequestFromRepairPlan(plan);
  const result = checkWorkRecordGateAuthorizationFromRepairPlan(plan, resumeEvent(request));

  assert.equal(result.status, 'authorized');
  assert.equal(result.resume_event.event_id, 'gate-resume-11111111-1111-4111-8111-111111111111');
  assert.equal(result.terminal_gate_record_or_resume_event_id, 'gate-resume-11111111-1111-4111-8111-111111111111');
  assertNonExecutingAuthorization(result);
});

test('valid Work Records do not request repair authorization when no mutating gated step exists', () => {
  const plan = planWorkRecordRepair(validFixture, { repoRoot });
  const request = buildWorkRecordGateRequestFromRepairPlan(plan);

  assert.equal(request.status, 'not_required');
  assert.equal(request.gate_request, null);
  assert.equal(request.authorizes_future_attempt, false);
  assertNonExecutingAuthorization(request);
});

test('aos work-record gate-request and gate-check expose stable read-only public JSON', () => {
  const help = runAos(['help', 'work-record', '--json']);
  assert.equal(help.status, 0, help.stderr);
  const helpJson = JSON.parse(help.stdout);
  for (const id of ['work-record-gate-request', 'work-record-gate-check']) {
    const form = helpJson.forms.find((item) => item.id === id);
    assert.ok(form, `help should expose ${id}`);
    assert.equal(form.execution.read_only, true);
    assert.equal(form.execution.mutates_state, false);
    assert.equal(form.execution.requires_permissions, false);
    assert.equal(form.execution.auto_starts_daemon, false);
  }

  const before = fs.readFileSync(repairableFixture, 'utf8');
  const requestResult = runAos(['work-record', 'gate-request', repairableFixture, '--json']);
  assert.equal(requestResult.status, 0, requestResult.stderr);
  const request = JSON.parse(requestResult.stdout);
  assert.equal(request.status, 'pending');
  assert.equal(request.gate_request.metadata.executes_repair, false);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-gate-check-'));
  const recordPath = path.join(dir, 'gate-record.json');
  fs.writeFileSync(recordPath, `${JSON.stringify(approvedRecord(request), null, 2)}\n`);

  const checkResult = runAos([
    'work-record',
    'gate-check',
    repairableFixture,
    '--gate-record',
    recordPath,
    '--json',
  ]);
  assert.equal(checkResult.status, 0, checkResult.stderr);
  const check = JSON.parse(checkResult.stdout);
  assert.equal(check.status, 'authorized');
  assert.equal(check.authorizes_future_attempt, true);
  assert.equal(check.executes_repair, false);
  assert.equal(check.mutates_record, false);
  assert.equal(fs.readFileSync(repairableFixture, 'utf8'), before);
});
