import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { guideWorkRecordRepair } from '../../packages/toolkit/workbench/work-record-repair-guide.js';
import { planWorkRecordRepair, planWorkRecordRepairAttempt } from '../../packages/toolkit/workbench/work-record.js';
import { attemptPlan, repairableWorkRecordPath, repoRoot, successfulAttemptArtifact } from '../lib/work-record-v1-fixtures.mjs';

test('Repair Guide V1 exposes neutral non-executing mechanical handoff', () => {
  const guide = guideWorkRecordRepair({ sourceRef: repairableWorkRecordPath, repoRoot });
  assert.equal(guide.schema_version, '2026-08-work-record-repair-guided-recovery-v1');
  assert.equal(guide.current_stage, 'ready_for_attempt_outcomes');
  assert.equal(guide.safe_next_command.id, 'work-record-attempt-artifact-build');
  assert.deepEqual(guide.missing_inputs, ['caller_outcome_input']);
  assert.equal(guide.non_execution_flags.executes_actions, false);
  assert.doesNotMatch(JSON.stringify(guide), /workflow_gate|authorization|approval|required_risk|risk_level|allowlisted|controlled_fixture|continuation/);
});

test('Repair Guide V1 validates caller artifact and exact finalization preflight', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-guide-v1-'));
  const plan = attemptPlan();
  const artifact = successfulAttemptArtifact(plan);
  const attemptPlanPath = path.join(root, 'attempt-plan.json');
  const attemptArtifactPath = path.join(root, 'attempt-artifact.json');
  fs.writeFileSync(attemptPlanPath, `${JSON.stringify(plan, null, 2)}\n`);
  fs.writeFileSync(attemptArtifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
  const guide = guideWorkRecordRepair({
    sourceRef: repairableWorkRecordPath,
    attemptPlanPath,
    attemptArtifactPath,
    replacementRoot: path.join(root, 'records'),
    indexRoot: path.join(root, 'index'),
    repoRoot,
  });
  assert.equal(guide.current_stage, 'ready_to_finalize');
  assert.equal(guide.stage_status, 'ready');
  assert.equal(guide.safe_next_command.id, 'work-record-repair-finalize-dry-run');
  assert.equal(guide.finalization_dry_run_summary.status, 'dry_run');
});

test('Repair Guide rejects a valid Artifact bound to another source and Attempt Plan', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-guide-source-mismatch-v1-'));
  const source = JSON.parse(fs.readFileSync(repairableWorkRecordPath, 'utf8'));
  source.id = 'work-record:repairable-stale-saved-ref-other-source';
  const sourcePath = path.join(root, 'other-source.json');
  const artifactPath = path.join(root, 'attempt-artifact.json');
  fs.writeFileSync(sourcePath, `${JSON.stringify(source, null, 2)}\n`);
  fs.writeFileSync(artifactPath, `${JSON.stringify(successfulAttemptArtifact(), null, 2)}\n`);
  const guide = guideWorkRecordRepair({
    sourceRef: sourcePath,
    attemptArtifactPath: artifactPath,
    repoRoot,
  });
  assert.equal(guide.current_stage, 'attempt_artifact_invalid');
  assert.equal(guide.stage_status, 'blocked');
  assert.equal(guide.repair_attempt_artifact_validation.binding_status, 'failed');
  assert.ok(guide.blockers.some((item) => item.code === 'WORK_RECORD_REPAIR_GUIDE_ARTIFACT_SOURCE_MISMATCH'));
});

test('Repair Guide rejects a supplied valid Attempt Plan derived from an identical clone path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-guide-plan-clone-v1-'));
  const clonePath = path.join(root, 'source-clone.json');
  fs.copyFileSync(repairableWorkRecordPath, clonePath);
  const cloneRepairPlan = planWorkRecordRepair(clonePath, { repoRoot, roots: [root] });
  const cloneAttemptPlan = planWorkRecordRepairAttempt(clonePath, { repoRoot, roots: [root], repairPlan: cloneRepairPlan });
  const attemptPlanPath = path.join(root, 'clone-attempt-plan.json');
  const attemptArtifactPath = path.join(root, 'canonical-attempt-artifact.json');
  fs.writeFileSync(attemptPlanPath, `${JSON.stringify(cloneAttemptPlan, null, 2)}\n`);
  fs.writeFileSync(attemptArtifactPath, `${JSON.stringify(successfulAttemptArtifact(), null, 2)}\n`);
  const guide = guideWorkRecordRepair({
    sourceRef: repairableWorkRecordPath,
    attemptPlanPath,
    attemptArtifactPath,
    repoRoot,
  });
  assert.equal(guide.current_stage, 'attempt_plan_invalid');
  assert.equal(guide.stage_status, 'blocked');
  assert.ok(guide.blockers.some((item) => item.code === 'WORK_RECORD_REPAIR_GUIDE_ATTEMPT_PLAN_MISMATCH'));
});
