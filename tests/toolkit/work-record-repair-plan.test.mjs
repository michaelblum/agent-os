import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  planWorkRecordRepair,
  validateWorkRecordRepairPlan,
  WORK_RECORD_REPAIR_PLAN_SCHEMA_VERSION,
} from '../../packages/toolkit/workbench/work-record.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixtureRoot = path.join(repoRoot, 'shared/schemas/fixtures/aos-work-record-v0/valid');

function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, name), 'utf8'));
}

function writeJSON(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function tempRecord(verdict, mutate = (record) => record) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `aos-work-record-plan-${verdict}-`));
  const record = mutate(structuredClone(readFixture('workflow-origin.json')));
  record.id = `work-record:repair-plan-${verdict}-fixture`;
  record.label = `Repair Plan ${verdict} fixture`;
  record.health.verdict = verdict;
  record.health.reason = `Deterministic ${verdict} repair-plan fixture.`;
  const file = path.join(dir, `${verdict}.json`);
  writeJSON(file, record);
  return file;
}

function runAos(args) {
  return spawnSync('./aos', args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function assertReadOnlyEnvelope(plan) {
  assert.equal(plan.type, 'work_record.repair_plan');
  assert.equal(plan.schema_version, WORK_RECORD_REPAIR_PLAN_SCHEMA_VERSION);
  assert.equal(plan.mutates_record, false);
  assert.equal(plan.executes_actions, false);
  assert.equal(plan.automatic_replay_allowed, false);
  assert.equal(validateWorkRecordRepairPlan(plan).status, 'passed');
  assert.ok(plan.recommended_commands.every((command) => command.executes_in_plan === false));
  assert.ok(plan.candidate_patches.every((patch) => patch.applied === false));
  assert.ok(plan.plan_steps
    .filter((step) => step.read_only === false)
    .every((step) => step.requires_workflow_gate === true));
}

test('Work Record Repair Plan maps all health verdicts to gated read-only planning statuses', () => {
  const cases = [
    {
      verdict: 'valid',
      file: path.join(fixtureRoot, 'workflow-origin.json'),
      status: 'no_repair_needed',
      expected: (plan) => {
        assert.deepEqual(plan.workflow_gates, []);
        assert.equal(plan.followup.should_create_new_work_record, false);
        assert.ok(plan.recommended_commands.some((command) => command.command.includes('work-record read')));
      },
    },
    {
      verdict: 'stale',
      file: tempRecord('stale'),
      status: 'planned',
      expected: (plan) => {
        assert.ok(plan.workflow_gates.some((gate) => gate.required === true));
        assert.equal(plan.followup.should_create_new_work_record, true);
      },
    },
    {
      verdict: 'repairable',
      file: path.join(fixtureRoot, 'repairable-stale-saved-ref.json'),
      status: 'planned',
      expected: (plan) => {
        assert.ok(plan.workflow_gates.some((gate) => gate.id === 'workflow_gate_required:repair_work_record_execution_map'));
        assert.equal(plan.candidate_patches.length, 1);
        assert.equal(plan.followup.should_create_new_work_record, true);
      },
    },
    {
      verdict: 'blocked',
      file: path.join(fixtureRoot, 'cleanup-or-postcondition-failed.json'),
      status: 'blocked',
      expected: (plan) => {
        assert.ok(plan.workflow_gates.some((gate) => gate.id === 'workflow_gate_required:blocker_triage'));
        assert.ok(plan.plan_steps.some((step) => step.kind === 'blocker_resolution'));
      },
    },
    {
      verdict: 'impossible',
      file: tempRecord('impossible'),
      status: 'not_repairable',
      expected: (plan) => {
        assert.equal(plan.recommended_commands.length, 0);
        assert.ok(plan.plan_steps.some((step) => step.kind === 'prohibit_replay'));
      },
    },
    {
      verdict: 'superseded',
      file: tempRecord('superseded', (record) => {
        record.references.push({
          id: 'replacement-work-record',
          relationship: 'superseded_by',
          ref: 'work-record:replacement-record',
          subject_type: 'aos.work_record',
        });
        return record;
      }),
      status: 'superseded',
      expected: (plan) => {
        assert.deepEqual(plan.followup.replacement_refs, ['work-record:replacement-record']);
        assert.ok(plan.recommended_commands.some((command) => command.command.includes('work-record:replacement-record')));
      },
    },
    {
      verdict: 'retired',
      file: tempRecord('retired'),
      status: 'retired',
      expected: (plan) => {
        assert.equal(plan.recommended_commands.length, 0);
        assert.ok(plan.plan_steps.some((step) => step.kind === 'historical_only'));
      },
    },
  ];

  for (const item of cases) {
    const before = fs.readFileSync(item.file, 'utf8');
    const plan = planWorkRecordRepair(item.file, { repoRoot });
    const after = fs.readFileSync(item.file, 'utf8');

    assert.equal(plan.status, item.status, item.verdict);
    assert.equal(plan.current_health, item.verdict);
    assert.equal(plan.health_verdict, item.verdict);
    assert.equal(plan.embedded_health, item.verdict);
    assert.equal(before, after, `${item.verdict} source Work Record should stay byte-identical`);
    assertReadOnlyEnvelope(plan);
    item.expected(plan);
  }
});

test('Work Record Repair Plan validation fails closed on mutation or replay claims', () => {
  const plan = planWorkRecordRepair(path.join(fixtureRoot, 'repairable-stale-saved-ref.json'), { repoRoot });
  const invalid = structuredClone(plan);
  invalid.mutates_record = true;
  invalid.executes_actions = true;
  invalid.automatic_replay_allowed = true;
  invalid.plan_steps.push({
    id: 'step:bad-mutation',
    read_only: false,
    requires_workflow_gate: false,
  });
  invalid.candidate_patches[0].applied = true;
  invalid.recommended_commands.push({
    command: './aos do click browser:x/e1',
    mutates_state: true,
    requires_workflow_gate: false,
    executes_in_plan: true,
  });

  const validation = validateWorkRecordRepairPlan(invalid);
  assert.equal(validation.status, 'failed');
  assert.ok(validation.diagnostics.some((diagnostic) => diagnostic.code === 'REPAIR_PLAN_MUTATES_RECORD'));
  assert.ok(validation.diagnostics.some((diagnostic) => diagnostic.code === 'REPAIR_PLAN_EXECUTES_ACTIONS'));
  assert.ok(validation.diagnostics.some((diagnostic) => diagnostic.code === 'REPAIR_PLAN_ALLOWS_AUTOMATIC_REPLAY'));
  assert.ok(validation.diagnostics.some((diagnostic) => diagnostic.code === 'MUTATING_STEP_WITHOUT_WORKFLOW_GATE'));
  assert.ok(validation.diagnostics.some((diagnostic) => diagnostic.code === 'CANDIDATE_PATCH_APPLIED'));
  assert.ok(validation.diagnostics.some((diagnostic) => diagnostic.code === 'MUTATING_COMMAND_WITHOUT_WORKFLOW_GATE'));
});

test('aos work-record plan-repair exposes stable public JSON without running commands', () => {
  const help = runAos(['help', 'work-record', '--json']);
  assert.equal(help.status, 0, help.stderr);
  const helpJson = JSON.parse(help.stdout);
  const form = helpJson.forms.find((item) => item.id === 'work-record-plan-repair');
  assert.ok(form, 'help should expose work-record-plan-repair');
  assert.equal(form.execution.read_only, true);
  assert.equal(form.execution.mutates_state, false);
  assert.equal(form.execution.requires_permissions, false);
  assert.equal(form.execution.auto_starts_daemon, false);

  const result = runAos([
    'work-record',
    'plan-repair',
    path.join(fixtureRoot, 'repairable-stale-saved-ref.json'),
    '--json',
  ]);
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.type, 'work_record.repair_plan');
  assert.equal(plan.status, 'planned');
  assert.equal(plan.current_health, 'repairable');
  assertReadOnlyEnvelope(plan);
  assert.ok(plan.recommended_commands.some((command) => (
    command.command === './aos see capture browser:work-record-saved-ref-demo --save --workspace work-record-proof --mode ax'
    && command.executes_in_plan === false
  )));
});
