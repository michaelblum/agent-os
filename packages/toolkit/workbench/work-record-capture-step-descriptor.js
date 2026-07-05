import {
  workRecordSubjectId,
} from './work-record-adapter.js';
import {
  WORK_RECORD_REPORT_ONLY_PROFILE,
} from './work-record-verifier.js';
import {
  buildWorkRecordV0FromAosActionEvidence,
} from './work-record-capture-aos-action.js';
import {
  WORK_RECORD_AOS_ACTION_CAPTURE_BUILDER_VERSION,
  WORK_RECORD_STEP_DESCRIPTOR_CAPTURE_BUILDER_VERSION,
} from './work-record-capture-versions.js';
import {
  arrayValue,
  cloneJson,
  mergeReferences,
  objectValue,
  requireText,
  slug,
  stepDescriptorEvidenceSource,
  stepDescriptorRunId,
  text,
  uniqueStrings,
  workRecordHandleSubjectId,
} from './work-record-capture-helpers.js';

export function buildWorkRecordV0FromStepDescriptorEvidence(stepDescriptor = {}, source = {}, {
  verifierProfile = WORK_RECORD_REPORT_ONLY_PROFILE,
} = {}) {
  const step = objectValue(stepDescriptor);
  const evidenceSource = objectValue(source);
  const stepId = requireText(step.id, 'step_descriptor.id');
  const workflowRef = requireText(step.workflow_ref, 'step_descriptor.workflow_ref');
  const gates = objectValue(step.workflow_gates);
  const gateRefs = uniqueStrings(arrayValue(gates.gate_refs));
  const promotions = arrayValue(step.claim_promotions).map((promotion) => objectValue(promotion));
  const promotionRefs = promotions.map((promotion) => text(promotion.id)).filter(Boolean);

  const record = buildWorkRecordV0FromAosActionEvidence(
    stepDescriptorEvidenceSource(step, evidenceSource),
    { verifierProfile },
  );
  const beforePostcondition = arrayValue(record.execution_map.postconditions)
    .find((postcondition) => text(objectValue(postcondition).kind) === 'aos_see_before');
  const runStep = objectValue(arrayValue(record.execution_map.steps)[0]);

  record.id = workRecordSubjectId(`workflow-${slug(workRecordHandleSubjectId(workflowRef).replace(/^workflow:/, ''))}-${workRecordHandleSubjectId(record.id)}`);
  record.origin = {
    kind: 'workflow',
    ref: workflowRef,
    run_id: text(evidenceSource.run_id, stepDescriptorRunId(step, evidenceSource)),
    version: text(step.version, 'v0'),
    subject_type: 'aos.workflow',
    description: text(
      objectValue(step.intent).summary,
      'Generated from a reusable Step descriptor and saved AOS action evidence.',
    ),
  };

  record.references = mergeReferences(
    [
      {
        id: 'origin-workflow-subject',
        relationship: 'origin_subject',
        ref: workflowRef,
        subject_type: 'aos.workflow',
        layer: 'execution_map',
        role: 'emitter',
      },
      {
        id: 'origin-step-descriptor',
        relationship: 'origin_step',
        ref: stepId,
        subject_type: 'aos.step_descriptor',
        layer: 'execution_map',
        role: 'step_template',
      },
    ],
    arrayValue(step.references),
    arrayValue(evidenceSource.references),
  );

  if (beforePostcondition && arrayValue(step.preconditions).length > 0) {
    runStep.precondition_refs = [beforePostcondition.id];
  }
  runStep.action.args = {
    ...objectValue(runStep.action.args),
    workflow_ref: workflowRef,
    step_descriptor_id: stepId,
    target_resolution: cloneJson(objectValue(step.target_resolution)),
    claim_promotion_refs: promotionRefs,
  };
  runStep.repair_hints = [
    ...arrayValue(runStep.repair_hints).map((hint) => cloneJson(hint)),
    ...arrayValue(step.repair_hints).map((hint) => cloneJson(hint)),
  ];

  record.execution_map.replay_policy = {
    mode: text(gates.mode, 'report_only'),
    replay_requires_workflow_gate: true,
    repair_requires_workflow_gate: true,
    gate_refs: gateRefs,
    notes: text(
      gates.notes,
      'This Workflow-origin Work Record is report-only and does not authorize autonomous replay or repair.',
    ),
  };

  for (const promotion of promotions) {
    const postconditionRef = text(promotion.postcondition_ref);
    const promotedClaim = arrayValue(record.claims).find((claim) => {
      const value = objectValue(claim);
      const refs = arrayValue(value.postcondition_refs).map((ref) => text(ref));
      return refs.length === 1 && refs[0] === postconditionRef;
    });
    if (!promotedClaim) continue;
    promotedClaim.metadata = {
      ...objectValue(promotedClaim.metadata),
      promoted_from: {
        workflow_ref: workflowRef,
        step_descriptor_id: stepId,
        claim_promotion_id: text(promotion.id),
        postcondition_ref: postconditionRef,
      },
      promotion_boundary: 'postcondition_to_work_record_claim',
    };
  }

  record.health.repair_gate_refs = gateRefs;
  record.health.replay_gate_refs = gateRefs;
  record.metadata = {
    ...objectValue(record.metadata),
    generated_by: WORK_RECORD_STEP_DESCRIPTOR_CAPTURE_BUILDER_VERSION,
    action_evidence_builder: WORK_RECORD_AOS_ACTION_CAPTURE_BUILDER_VERSION,
    workflow_ref: workflowRef,
    step_descriptor_id: stepId,
    step_descriptor_schema_version: text(step.schema_version),
    step_descriptor_version: text(step.version),
    claim_promotion_refs: promotionRefs,
    workflow_gate_refs: gateRefs,
  };

  return record;
}
