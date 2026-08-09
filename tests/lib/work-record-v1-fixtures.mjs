import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  buildWorkRecordReplacementProposal,
  buildWorkRecordRepairAttemptArtifact,
  planWorkRecordRepair,
  planWorkRecordRepairAttempt,
} from '../../packages/toolkit/workbench/work-record.js';
import { digestJson as digestArtifactJson } from '../../packages/toolkit/workbench/work-record-repair-attempt-artifact.js';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const repairableWorkRecordPath = path.join(repoRoot, 'shared/schemas/fixtures/aos-work-record-v1/valid/repairable-stale-saved-ref.json');

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function repairPlan() {
  return planWorkRecordRepair(repairableWorkRecordPath, { repoRoot });
}

export function attemptPlan() {
  const plan = repairPlan();
  return planWorkRecordRepairAttempt(repairableWorkRecordPath, { repoRoot, repairPlan: plan });
}

export function successfulAttemptArtifact(plan = attemptPlan()) {
  const sourceRecord = readJson(repairableWorkRecordPath);
  const proposedExecutionMap = structuredClone(sourceRecord.execution_map);
  const currentStateId = 'state_current_repaired_0806';
  for (const target of proposedExecutionMap.targets) {
    if (/action-ref|postcondition-ref/.test(target.id)) target.state_id = currentStateId;
    if (/postcondition-ref/.test(target.id)) {
      target.target = 'browser:work-record-saved-ref-demo/input.name';
      target.candidates = [{ ref: 'input.name', target: 'browser:work-record-saved-ref-demo/input.name', role: 'textbox', name: 'Name', value: 'Ada', enabled: true, data_aos_ref: 'work-record.demo.name' }];
    }
  }
  for (const step of proposedExecutionMap.steps) {
    step.action.state_id = currentStateId;
    step.action.args.selected_saved_ref = 'ref:snap_current_0806:input.name';
    step.action.args.before_state_id = currentStateId;
    step.action.args.after_state_id = currentStateId;
    step.action.args.dry_run_status = 'resolved';
    step.action.args.current_validation = {
      status: 'resolved',
      backend: 'browser',
      strategy: 'browser_current_target_validation',
      fallback_used: false,
      state_id: currentStateId,
    };
    step.action.args.execution = {
      backend: 'browser',
      strategy: 'saved_ref_browser_fill',
      fallback_used: false,
      state_id: currentStateId,
    };
  }
  for (const postcondition of proposedExecutionMap.postconditions) {
    if (/dry-run|action-executed|after-value/.test(postcondition.id)) postcondition.state_id = currentStateId;
  }
  const requirementIds = [...new Set([
    ...plan.evidence_requirements.filter((requirement) => requirement.required).map((requirement) => requirement.id),
    ...plan.planned_operations.flatMap((operation) => operation.evidence_requirement_refs || []),
  ])];
  const callerPostconditionEvidence = [
    {
      id: 'caller-evidence:before-perception',
      digest: 'sha256:caller-before-perception',
      path: 'artifact:caller-outcomes/before-perception.json',
      kind: 'aos_see_capture',
      metadata: {
        phase: 'before',
        semantic_targets: [{ ref: 'input.name', target: 'browser:work-record-saved-ref-demo/input.name', role: 'textbox', name: 'Name', value: '', enabled: true }],
      },
    },
    {
      id: 'caller-evidence:dry-run-resolved',
      digest: 'sha256:caller-dry-run-resolved',
      path: 'artifact:caller-outcomes/dry-run.json',
      kind: 'aos_do_dry_run',
      metadata: { phase: 'dry_run', status: 'resolved' },
    },
    {
      id: 'caller-evidence:action-succeeded',
      digest: 'sha256:caller-action-succeeded',
      path: 'artifact:caller-outcomes/action.json',
      kind: 'aos_do_action',
      metadata: { phase: 'action', status: 'success' },
    },
    {
      id: 'caller-evidence:after-value',
      digest: 'sha256:caller-after-value',
      path: 'artifact:caller-outcomes/after-value.json',
      kind: 'aos_see_capture',
      metadata: {
        phase: 'after',
        semantic_targets: [{ ref: 'input.name', target: 'browser:work-record-saved-ref-demo/input.name', role: 'textbox', name: 'Name', value: 'Ada', enabled: true }],
      },
    },
  ];
  const evidenceRefs = [
    ...requirementIds.map((id) => ({ id, digest: `sha256:test-${id}` })),
    ...callerPostconditionEvidence,
  ];
  const operationOutcomes = plan.planned_operations.map((operation, index) => ({
    id: `operation-outcome:${index + 1}`,
    planned_operation_id: operation.id,
    status: 'succeeded',
    evidence_ref_ids: operation.evidence_requirement_refs || [],
    cleanup_required: false,
    rollback_required: false,
  }));
  const cleanupResults = plan.planned_operations.flatMap((operation, operationIndex) => (
    (operation.cleanup_refs || []).map((cleanupRef, cleanupIndex) => ({
      id: `cleanup-result:${operationIndex + 1}:${cleanupIndex + 1}`,
      operation_outcome_id: operationOutcomes[operationIndex].id,
      cleanup_ref_id: cleanupRef,
      status: 'not_required',
    }))
  ));
  const rollbackResults = plan.planned_operations.flatMap((operation, operationIndex) => (
    (operation.rollback_refs || []).map((rollbackRef, rollbackIndex) => ({
      id: `rollback-result:${operationIndex + 1}:${rollbackIndex + 1}`,
      operation_outcome_id: operationOutcomes[operationIndex].id,
      rollback_ref_id: rollbackRef,
      status: 'not_required',
    }))
  ));
  return buildWorkRecordRepairAttemptArtifact({
    repair_attempt_plan: plan,
    status: 'succeeded',
    outcome_source: { id: 'test-caller', kind: 'caller_supplied', version: '1' },
    timing: {
      started_at: '2026-08-06T12:00:00.000Z',
      finished_at: '2026-08-06T12:00:01.000Z',
      source: 'caller_supplied',
    },
    operation_outcomes: operationOutcomes,
    candidate_patch_outcomes: [{
      id: 'candidate-patch-outcome:execution-map-refs',
      candidate_patch_id: 'candidate_patch:execution_map_refs',
      status: 'produced',
      source_work_record_digest: plan.source_work_record.digest,
      proposed_execution_map: proposedExecutionMap,
      proposed_execution_map_digest: digestArtifactJson(proposedExecutionMap),
      evidence_ref_ids: ['evidence_requirement:patch:candidate_patch:execution_map_refs'],
      applied_to_source: false,
    }],
    evidence_refs: evidenceRefs,
    verifier_before: { status: 'failed', health_verdict: 'repairable' },
    verifier_after: { status: 'passed', health_verdict: 'valid' },
    postcondition_results: [
      ...plan.postconditions.map((item) => ({ id: item.id, status: 'passed' })),
      {
        id: 'postcondition:repairable-stale-saved-ref-2026-07-04-before-perception',
        status: 'passed',
        evidence_ref_ids: ['caller-evidence:before-perception'],
      },
      {
        id: 'postcondition:repairable-stale-saved-ref-2026-07-04-dry-run',
        status: 'passed',
        evidence_ref_ids: ['caller-evidence:dry-run-resolved'],
      },
      {
        id: 'postcondition:repairable-stale-saved-ref-2026-07-04-action-executed',
        status: 'passed',
        evidence_ref_ids: ['caller-evidence:action-succeeded'],
      },
      {
        id: 'postcondition:repairable-stale-saved-ref-after-value',
        status: 'passed',
        evidence_ref_ids: ['caller-evidence:after-value'],
      },
    ],
    cleanup_results: cleanupResults,
    rollback_results: rollbackResults,
    source_work_record_mutation_check: {
      status: 'passed',
      before_digest: plan.source_work_record.digest,
      after_digest: plan.source_work_record.digest,
    },
    source_work_record_mutated: false,
  });
}

export function replacementProposal(plan = attemptPlan(), artifact = successfulAttemptArtifact(plan), sourcePath = repairableWorkRecordPath) {
  const record = readJson(sourcePath);
  const sourceDigest = crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex');
  return buildWorkRecordReplacementProposal({
    source_work_record: { ...plan.source_work_record, path: sourcePath, requested_ref: sourcePath, digest: sourceDigest, record },
    repair_attempt_plan: plan,
    repair_attempt_artifact: artifact,
    source_work_record_digest_after: sourceDigest,
    proposed_id_seed: 'work-record:repairable-stale-saved-ref-replacement-v1',
  });
}
