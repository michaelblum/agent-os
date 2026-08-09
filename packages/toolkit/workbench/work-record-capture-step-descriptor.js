import {
  workRecordSubjectId,
} from './work-record-adapter.js';
import validateStepDescriptorV1 from './step-descriptor-v1-validator.generated.js';
import {
  WORK_RECORD_REPORT_ONLY_PROFILE,
} from './work-record-verifier.js';
import {
  buildWorkRecordV1FromAosActionEvidence,
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
  stepDescriptorContractMismatches,
  stepDescriptorEvidenceMismatches,
  stepDescriptorEvidenceSource,
  stepDescriptorRunId,
  text,
  workRecordHandleSubjectId,
} from './work-record-capture-helpers.js';

export function buildWorkRecordV1FromStepDescriptorEvidence(stepDescriptor = {}, source = {}, {
  verifierProfile = WORK_RECORD_REPORT_ONLY_PROFILE,
} = {}) {
  const step = objectValue(stepDescriptor);
  const evidenceSource = objectValue(source);
  if (!validateStepDescriptorV1(step)) {
    const details = arrayValue(validateStepDescriptorV1.errors)
      .map((error) => `${text(objectValue(error).instancePath, '/')} ${text(objectValue(error).message, 'is invalid')}`)
      .join('; ');
    throw new TypeError(`Step Descriptor V1 schema validation failed: ${details}`);
  }
  const contractMismatches = stepDescriptorContractMismatches(step);
  if (contractMismatches.length > 0) {
    throw new TypeError(`Step Descriptor V1 contract failed: ${contractMismatches[0].message}`);
  }
  const evidenceMismatches = stepDescriptorEvidenceMismatches(step, evidenceSource);
  if (evidenceMismatches.length > 0) {
    throw new TypeError(`Step Descriptor V1 evidence binding failed: ${evidenceMismatches[0].message}`);
  }
  const stepId = requireText(step.id, 'step_descriptor.id');
  const workflowRef = requireText(step.workflow_ref, 'step_descriptor.workflow_ref');
  const promotions = arrayValue(step.claim_promotions).map((promotion) => objectValue(promotion));
  const promotionRefs = promotions.map((promotion) => text(promotion.id)).filter(Boolean);

  const record = buildWorkRecordV1FromAosActionEvidence(
    stepDescriptorEvidenceSource(step, evidenceSource),
    { verifierProfile },
  );
  const descriptorPreconditionId = text(objectValue(arrayValue(step.preconditions)[0]).id);
  const beforePostcondition = arrayValue(record.execution_map.postconditions)
    .find((postcondition) => text(objectValue(postcondition).id) === descriptorPreconditionId);
  const runStep = objectValue(arrayValue(record.execution_map.steps)[0]);

  record.id = workRecordSubjectId(`workflow-${slug(workRecordHandleSubjectId(workflowRef).replace(/^workflow:/, ''))}-${workRecordHandleSubjectId(record.id)}`);
  record.origin = {
    kind: 'workflow',
    ref: workflowRef,
    run_id: text(evidenceSource.run_id, stepDescriptorRunId(step, evidenceSource)),
    version: text(step.version, 'v1'),
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
    descriptor_action: cloneJson(objectValue(step.action)),
    workflow_ref: workflowRef,
    step_descriptor_id: stepId,
    target_resolution: cloneJson(objectValue(step.target_resolution)),
    claim_promotion_refs: promotionRefs,
  };
  runStep.repair_hints = [
    ...arrayValue(runStep.repair_hints).map((hint) => cloneJson(hint)),
    ...arrayValue(step.repair_hints).map((hint) => cloneJson(hint)),
  ];

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
        metadata: cloneJson(objectValue(promotion.metadata)),
      },
      promotion_boundary: 'postcondition_to_work_record_claim',
    };
  }

  record.metadata = {
    ...objectValue(record.metadata),
    generated_by: WORK_RECORD_STEP_DESCRIPTOR_CAPTURE_BUILDER_VERSION,
    action_evidence_builder: WORK_RECORD_AOS_ACTION_CAPTURE_BUILDER_VERSION,
    workflow_ref: workflowRef,
    step_descriptor_id: stepId,
    step_descriptor_schema_version: text(step.schema_version),
    step_descriptor_version: text(step.version),
    claim_promotion_refs: promotionRefs,
    step_descriptor_evidence_requirements: cloneJson(arrayValue(step.evidence_requirements)),
    step_descriptor_evidence_requirement_results: arrayValue(step.evidence_requirements).map((requirement) => {
      const item = objectValue(requirement);
      const phaseSource = item.phase === 'before'
        ? objectValue(evidenceSource.before_perception)
        : (item.phase === 'after' ? objectValue(evidenceSource.after_perception) : objectValue(evidenceSource.action));
      const evidenceId = text(phaseSource.evidence_id);
      return {
        evidence_requirement_id: text(item.id),
        kind: text(item.kind),
        phase: text(item.phase),
        required: item.required === true,
        status: evidenceId ? 'satisfied' : 'not_supplied',
        evidence_refs: evidenceId ? [evidenceId] : [],
      };
    }),
  };

  return record;
}
