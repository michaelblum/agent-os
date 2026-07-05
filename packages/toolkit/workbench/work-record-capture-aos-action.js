import {
  WORK_RECORD_V0_SCHEMA_VERSION,
} from './work-record-adapter.js';
import {
  deriveWorkRecordClaimIndexes,
  WORK_RECORD_REPORT_ONLY_PROFILE,
} from './work-record-verifier.js';
import {
  WORK_RECORD_AOS_ACTION_CAPTURE_BUILDER_VERSION,
} from './work-record-capture-versions.js';
import {
  normalizeAosActionEvidencePhases,
} from './work-record-capture-aos-phases.js';
import {
  arrayValue,
  claimResultForPostconditions,
  cloneJson,
  evidenceDigest,
  healthReasonForVerdict,
  healthVerdictForSource,
  objectValue,
  requireText,
  resultFor,
  slug,
  text,
} from './work-record-capture-helpers.js';

export function buildWorkRecordV0FromAosActionEvidence(source = {}, {
  verifierProfile = WORK_RECORD_REPORT_ONLY_PROFILE,
} = {}) {
  const phaseModel = normalizeAosActionEvidencePhases(source);
  const {
    evidenceSource,
    sourceIdentity,
    targetResolution,
    beforePerception,
    dryRun: dryRunPhase,
    dispatchAction,
    afterReadback,
    cleanup: cleanupPhase,
    postconditions,
    savedRefState,
    evidenceIds,
  } = phaseModel;
  const { sourceId, createdAt, completedAt, baseId, recordId } = sourceIdentity;
  const { targetDialect, target, targetWithRef, selectedSavedRef, resolvedTarget } = targetResolution;
  const before = beforePerception.source;
  const dryRun = dryRunPhase.source;
  const action = dispatchAction.source;
  const after = afterReadback.source;
  const cleanup = cleanupPhase.source;
  const postconditionSource = postconditions.source;
  const beforeStateId = beforePerception.stateId;
  const actionStateId = dispatchAction.stateId;
  const afterStateId = afterReadback.stateId;
  const actionVerb = dispatchAction.verb;
  const actionCommand = dispatchAction.command;
  const dryRunCommand = dryRunPhase.command;
  const dryRunStatusValue = dryRunPhase.status;
  const dryRunPassed = dryRunPhase.passed;
  const actionStatusValue = dispatchAction.status;
  const actionPassed = dispatchAction.passed;
  const cleanupCommand = cleanupPhase.command;
  const cleanupStatusValue = cleanupPhase.status;
  const cleanupPassed = cleanupPhase.passed;
  const postconditionPassed = postconditions.passed;
  const beforeEvidenceId = beforePerception.evidenceId;
  const dryRunEvidenceId = dryRunPhase.evidenceId;
  const actionEvidenceId = dispatchAction.evidenceId;
  const afterEvidenceId = afterReadback.evidenceId;
  const cleanupEvidenceId = cleanupPhase.evidenceId;
  const beforePayload = beforePerception.payload;
  const dryRunPayload = dryRunPhase.payload;
  const actionPayload = dispatchAction.payload;
  const afterPayload = afterReadback.payload;
  const cleanupPayload = cleanupPhase.payload;
  const { currentValidation, recommendedNext, recommendedNextCommand, hasSavedRefLane } = savedRefState;

  const beforePostcondition = {
    id: `postcondition:${baseId}-before-perception`,
    kind: 'aos_see_before',
    description: 'The before perception captured the target scope and State ID used for the action premise.',
    target,
    state_id: beforeStateId,
    check: {
      kind: 'perception_state_captured',
      expected: beforeStateId,
      path: 'before_perception.state_id',
    },
    evidence_refs: [beforeEvidenceId],
    repair_policy: {
      mode: 'manual_review',
      notes: 'Before perception drift should be reviewed against the immutable see evidence before patching the execution map.',
    },
  };
  const actionPostcondition = {
    id: `postcondition:${baseId}-action-executed`,
    kind: 'aos_do_action',
    description: `The bounded AOS action completed successfully: ${actionCommand}`,
    target: targetWithRef,
    state_id: actionStateId,
    check: {
      kind: 'action_status_equals',
      expected: 'success',
      path: 'action.status',
    },
    evidence_refs: [actionEvidenceId],
    repair_policy: {
      mode: 'manual_review',
      notes: 'Action failures require an explicit workflow-gated re-run or execution-map review.',
    },
  };
  const dryRunPostcondition = dryRunCommand ? {
    id: `postcondition:${baseId}-dry-run`,
    kind: 'aos_do_dry_run',
    description: `The saved-ref dry-run resolved before mutation: ${dryRunCommand}`,
    target: selectedSavedRef || targetWithRef,
    state_id: actionStateId,
    check: {
      kind: 'dry_run_status_allows_dispatch',
      expected: 'reacquired_or_resolved',
      path: 'dry_run.status',
    },
    evidence_refs: [dryRunEvidenceId],
    repair_policy: {
      mode: dryRunPassed ? 'manual_review' : 'patch_execution_map',
      notes: 'Dry-run failures must re-perceive and re-resolve the saved ref under an explicit workflow gate before dispatch.',
    },
  } : null;
  const afterPostcondition = {
    id: text(postconditionSource.id, `postcondition:${baseId}-after-state`),
    kind: text(postconditionSource.kind, `${targetDialect}_post_action_state`),
    description: requireText(
      postconditionSource.description,
      'postcondition.description',
    ),
    target: text(postconditionSource.target, targetWithRef),
    state_id: text(postconditionSource.state_id, afterStateId),
    check: {
      kind: requireText(objectValue(postconditionSource.check).kind, 'postcondition.check.kind'),
      ...cloneJson(objectValue(postconditionSource.check)),
    },
    evidence_refs: [afterEvidenceId],
    repair_policy: {
      mode: text(objectValue(postconditionSource.repair_policy).mode, 'manual_review'),
      notes: text(
        objectValue(postconditionSource.repair_policy).notes,
        'Patch target refs or post-action checks only under an explicit workflow gate.',
      ),
    },
  };
  const cleanupPostcondition = cleanupCommand ? {
    id: text(cleanup.postcondition_id, `postcondition:${baseId}-cleanup`),
    kind: text(cleanup.kind, 'aos_cleanup'),
    description: text(cleanup.description, `Cleanup completed for ${target}.`),
    target,
    state_id: text(cleanup.state_id, afterStateId),
    check: {
      kind: 'cleanup_status_equals',
      expected: 'success',
      path: 'cleanup.status',
    },
    evidence_refs: [cleanupEvidenceId],
    repair_policy: {
      mode: cleanupPassed ? 'manual_review' : 'manual_review',
      notes: 'Cleanup failures are recorded as immutable evidence and require explicit follow-up; do not rewrite action evidence.',
    },
  } : null;
  const allPostconditions = [
    beforePostcondition,
    dryRunPostcondition,
    actionPostcondition,
    afterPostcondition,
    cleanupPostcondition,
  ].filter(Boolean);

  const claims = [
    {
      id: `claim:${baseId}-see-do-see-captured`,
      text: 'The bounded AOS action source captured before perception, action metadata, and after perception as immutable evidence.',
      scope: 'run',
      acceptance: 'Before, action, and after evidence refs are present and immutable.',
      postcondition_refs: [
        beforePostcondition.id,
        ...(dryRunPostcondition ? [dryRunPostcondition.id] : []),
        actionPostcondition.id,
        afterPostcondition.id,
        ...(cleanupPostcondition ? [cleanupPostcondition.id] : []),
      ],
    },
    {
      id: `claim:${baseId}-post-action-state-observed`,
      text: text(
        evidenceSource.claim_text,
        'The post-action AOS perception shows the expected target state.',
      ),
      scope: 'run',
      acceptance: text(
        evidenceSource.acceptance,
        text(postconditionSource.description),
      ),
      postcondition_refs: [afterPostcondition.id],
    },
  ];

  const capturePassed = dryRunPassed && actionPassed && postconditionPassed && cleanupPassed;
  const beforeResult = resultFor(beforePostcondition, {
    passed: true,
    evidenceRefs: [beforeEvidenceId],
    reason: 'Before perception includes a State ID and target-scope evidence.',
  });
  const dryRunResult = dryRunPostcondition ? resultFor(dryRunPostcondition, {
    passed: dryRunPassed,
    evidenceRefs: [dryRunEvidenceId],
    reason: dryRunPassed
      ? 'The saved-ref dry-run allowed dispatch under current validation.'
      : `The saved-ref dry-run reported ${dryRunStatusValue}.`,
  }) : null;
  const actionResult = resultFor(actionPostcondition, {
    passed: actionPassed,
    evidenceRefs: [actionEvidenceId],
    reason: actionPassed
      ? 'The AOS do action reported success with execution metadata.'
      : `The AOS do action reported ${actionStatusValue}.`,
  });
  const afterResult = resultFor(afterPostcondition, {
    passed: postconditionPassed,
    evidenceRefs: [afterEvidenceId],
    reason: text(
      postconditionSource.reason,
      postconditionPassed
        ? 'The after perception evidence satisfies the expected post-action state.'
        : 'The after perception evidence did not satisfy the expected post-action state.',
    ),
  });
  const cleanupResult = cleanupPostcondition ? resultFor(cleanupPostcondition, {
    passed: cleanupPassed,
    evidenceRefs: [cleanupEvidenceId],
    reason: cleanupPassed
      ? 'Cleanup evidence reports success.'
      : `Cleanup evidence reports ${cleanupStatusValue}.`,
  }) : null;
  const captureResults = [
    beforeResult,
    dryRunResult,
    actionResult,
    afterResult,
    cleanupResult,
  ].filter(Boolean);
  const claimResults = [
    claimResultForPostconditions({
      claim: claims[0],
      passed: capturePassed,
      evidenceRefs: evidenceIds,
      postconditionResults: captureResults,
      reason: capturePassed
        ? 'The see/do/see action evidence is complete and internally correlated.'
        : 'The see/do/see action evidence did not satisfy every capture postcondition.',
      confidence: capturePassed ? 0.97 : 0.35,
    }),
    claimResultForPostconditions({
      claim: claims[1],
      passed: postconditionPassed,
      evidenceRefs: [afterEvidenceId],
      postconditionResults: [afterResult],
      reason: text(
        postconditionSource.reason,
        postconditionPassed
          ? 'The expected post-action target state was observed in after perception evidence.'
          : 'The expected post-action target state was not observed in after perception evidence.',
      ),
      confidence: postconditionPassed ? 0.96 : 0.35,
    }),
  ];
  const allClaimsVerified = claimResults.every((result) => result.status === 'verified');
  const derivedIndexes = deriveWorkRecordClaimIndexes({ claim_results: claimResults });
  const verifierReportId = `verifier-report:${baseId}`;
  const healthVerdict = healthVerdictForSource({
    evidenceSource,
    actionPassed,
    postconditionPassed,
    cleanupPassed,
  });

  return {
    type: 'aos.work_record',
    schema_version: WORK_RECORD_V0_SCHEMA_VERSION,
    id: recordId,
    label: text(evidenceSource.label, `AOS action evidence: ${actionCommand}`),
    created_at: createdAt,
    origin: {
      kind: 'ad_hoc',
      ref: null,
      description: 'Generated from bounded AOS see/do/see action evidence.',
    },
    references: arrayValue(evidenceSource.references).map((reference) => cloneJson(reference)),
    intent: {
      summary: requireText(objectValue(evidenceSource.intent).summary, 'intent.summary'),
      purpose: text(objectValue(evidenceSource.intent).purpose),
      acceptance: text(objectValue(evidenceSource.intent).acceptance),
      constraints: arrayValue(objectValue(evidenceSource.intent).constraints).map((item) => text(item)).filter(Boolean),
      claim_refs: claims.map((claim) => claim.id),
    },
    execution_map: {
      targets: [
        {
          id: `target:${baseId}-${targetDialect}-scope`,
          target,
          dialect: targetDialect,
          state_id: beforeStateId,
          description: 'Target scope captured by AOS see before the action.',
          candidates: arrayValue(before.semantic_targets).map((candidate) => cloneJson(candidate)),
        },
        {
          id: `target:${baseId}-action-ref`,
          target: targetWithRef,
          dialect: targetDialect,
          state_id: actionStateId,
          description: 'Target-with-Ref selected from before perception and acted on by AOS do.',
          candidates: arrayValue(action.target_candidates).map((candidate) => cloneJson(candidate)),
        },
        {
          id: `target:${baseId}-postcondition-ref`,
          target: afterPostcondition.target,
          dialect: targetDialect,
          state_id: afterPostcondition.state_id,
          description: 'Post-action target checked against after perception evidence.',
          candidates: arrayValue(after.semantic_targets).map((candidate) => cloneJson(candidate)),
        },
      ],
      steps: [
        {
          id: `step:${baseId}-${slug(actionVerb)}`,
          intent: text(action.intent, `Execute ${actionVerb} against ${targetWithRef} and verify the post-action state.`),
          action: {
            verb: actionVerb,
            target: targetWithRef,
            state_id: actionStateId,
          args: {
            command: actionCommand,
            target_dialect: targetDialect,
            target_with_ref: targetWithRef,
            ...(selectedSavedRef ? { selected_saved_ref: selectedSavedRef } : {}),
            ...(hasSavedRefLane ? { resolved_target: resolvedTarget } : {}),
            before_state_id: beforeStateId,
            after_state_id: afterStateId,
            ...(dryRunCommand ? {
              dry_run_command: dryRunCommand,
              dry_run_status: dryRunStatusValue,
            } : {}),
            execution: cloneJson(objectValue(action.execution)),
            ...(Object.keys(currentValidation).length > 0 ? { current_validation: cloneJson(currentValidation) } : {}),
            ...(Object.keys(recommendedNext).length > 0 ? { recommended_next: cloneJson(recommendedNext) } : {}),
            ...(recommendedNextCommand ? { recommended_next_command: recommendedNextCommand } : {}),
          },
        },
          postcondition_refs: [afterPostcondition.id],
          repair_hints: [
            {
              kind: 'patch_target_ref_or_check',
              note: 'If the target ref drifts, re-run see under an explicit workflow gate and patch the execution map rather than replaying automatically.',
            },
          ],
        },
      ],
      postconditions: allPostconditions,
      artifact_routes: [
        {
          id: `artifact-route:${baseId}-before-see`,
          kind: 'aos_see_capture',
          destination: requireText(before.artifact_uri, 'before_perception.artifact_uri'),
          evidence_ref: beforeEvidenceId,
        },
        ...(dryRunCommand ? [{
          id: `artifact-route:${baseId}-dry-run`,
          kind: 'aos_do_dry_run',
          destination: requireText(dryRun.artifact_uri, 'dry_run.artifact_uri'),
          evidence_ref: dryRunEvidenceId,
        }] : []),
        {
          id: `artifact-route:${baseId}-do-action`,
          kind: 'aos_do_action',
          destination: requireText(action.artifact_uri, 'action.artifact_uri'),
          evidence_ref: actionEvidenceId,
        },
        {
          id: `artifact-route:${baseId}-after-see`,
          kind: 'aos_see_capture',
          destination: requireText(after.artifact_uri, 'after_perception.artifact_uri'),
          evidence_ref: afterEvidenceId,
        },
        ...(cleanupCommand ? [{
          id: `artifact-route:${baseId}-cleanup`,
          kind: 'aos_cleanup',
          destination: requireText(cleanup.artifact_uri, 'cleanup.artifact_uri'),
          evidence_ref: cleanupEvidenceId,
        }] : []),
      ],
      replay_policy: {
        mode: 'report_only',
        replay_requires_workflow_gate: true,
        repair_requires_workflow_gate: true,
        gate_refs: [],
        notes: 'This Work Record records and verifies AOS action evidence only; it does not authorize autonomous replay or repair.',
      },
    },
    evidence: [
      {
        id: beforeEvidenceId,
        kind: 'aos_see_capture',
        created_at: requireText(before.captured_at, 'before_perception.captured_at'),
        uri: requireText(before.artifact_uri, 'before_perception.artifact_uri'),
        digest: evidenceDigest(beforePayload),
        state_id: beforeStateId,
        target,
        immutable: true,
        summary: text(before.summary, 'Before perception captured the target scope.'),
        metadata: {
          builder: WORK_RECORD_AOS_ACTION_CAPTURE_BUILDER_VERSION,
          phase: 'before',
          command: text(before.command),
          target_dialect: targetDialect,
          target_with_ref: targetWithRef,
          ...(hasSavedRefLane ? { resolved_target: resolvedTarget } : {}),
          ...(selectedSavedRef ? { selected_saved_ref: selectedSavedRef } : {}),
          element_count: Number.isFinite(before.element_count) ? before.element_count : arrayValue(before.elements).length,
          semantic_targets: arrayValue(before.semantic_targets).map((candidate) => cloneJson(candidate)),
          source: {
            type: text(evidenceSource.type, 'aos.action_evidence'),
            id: sourceId,
          },
          ...cloneJson(objectValue(before.metadata)),
        },
      },
      ...(dryRunCommand ? [{
        id: dryRunEvidenceId,
        kind: 'aos_do_dry_run',
        created_at: requireText(dryRun.executed_at, 'dry_run.executed_at'),
        uri: requireText(dryRun.artifact_uri, 'dry_run.artifact_uri'),
        digest: evidenceDigest(dryRunPayload),
        state_id: actionStateId,
        target: selectedSavedRef || targetWithRef,
        immutable: true,
        summary: text(dryRun.summary, `AOS do ${actionVerb} dry-run reported ${dryRunStatusValue}.`),
        metadata: {
          builder: WORK_RECORD_AOS_ACTION_CAPTURE_BUILDER_VERSION,
          phase: 'dry_run',
          command: dryRunCommand,
          verb: actionVerb,
          status: dryRunStatusValue,
          target_dialect: targetDialect,
          target_with_ref: targetWithRef,
          ...(selectedSavedRef ? { selected_saved_ref: selectedSavedRef } : {}),
          resolved_target: resolvedTarget,
          ...(Object.keys(currentValidation).length > 0 ? { current_validation: cloneJson(currentValidation) } : {}),
          ...(Object.keys(recommendedNext).length > 0 ? { recommended_next: cloneJson(recommendedNext) } : {}),
          ...(recommendedNextCommand ? { recommended_next_command: recommendedNextCommand } : {}),
          source: {
            type: text(evidenceSource.type, 'aos.action_evidence'),
            id: sourceId,
          },
          ...cloneJson(objectValue(dryRun.metadata)),
        },
      }] : []),
      {
        id: actionEvidenceId,
        kind: 'aos_do_action',
        created_at: requireText(action.executed_at, 'action.executed_at'),
        uri: requireText(action.artifact_uri, 'action.artifact_uri'),
        digest: evidenceDigest(actionPayload),
        state_id: actionStateId,
        target: targetWithRef,
        immutable: true,
        summary: text(action.summary, `AOS do ${actionVerb} reported ${actionStatusValue}.`),
        metadata: {
          builder: WORK_RECORD_AOS_ACTION_CAPTURE_BUILDER_VERSION,
          phase: 'action',
          command: actionCommand,
          verb: actionVerb,
          status: actionStatusValue,
          target_dialect: targetDialect,
          target_with_ref: targetWithRef,
          ...(hasSavedRefLane ? { resolved_target: resolvedTarget } : {}),
          ...(selectedSavedRef ? { selected_saved_ref: selectedSavedRef } : {}),
          ...(Object.keys(currentValidation).length > 0 ? { current_validation: cloneJson(currentValidation) } : {}),
          execution: cloneJson(objectValue(action.execution)),
          ...(Object.keys(recommendedNext).length > 0 ? { recommended_next: cloneJson(recommendedNext) } : {}),
          ...(recommendedNextCommand ? { recommended_next_command: recommendedNextCommand } : {}),
          source: {
            type: text(evidenceSource.type, 'aos.action_evidence'),
            id: sourceId,
          },
          ...cloneJson(objectValue(action.metadata)),
        },
      },
      {
        id: afterEvidenceId,
        kind: 'aos_see_capture',
        created_at: requireText(after.captured_at, 'after_perception.captured_at'),
        uri: requireText(after.artifact_uri, 'after_perception.artifact_uri'),
        digest: evidenceDigest(afterPayload),
        state_id: afterStateId,
        target,
        immutable: true,
        summary: text(after.summary, 'After perception captured the post-action target state.'),
        metadata: {
          builder: WORK_RECORD_AOS_ACTION_CAPTURE_BUILDER_VERSION,
          phase: 'after',
          command: text(after.command),
          target_dialect: targetDialect,
          target_with_ref: targetWithRef,
          ...(hasSavedRefLane ? { resolved_target: resolvedTarget } : {}),
          ...(selectedSavedRef ? { selected_saved_ref: selectedSavedRef } : {}),
          element_count: Number.isFinite(after.element_count) ? after.element_count : arrayValue(after.elements).length,
          semantic_targets: arrayValue(after.semantic_targets).map((candidate) => cloneJson(candidate)),
          source: {
            type: text(evidenceSource.type, 'aos.action_evidence'),
            id: sourceId,
          },
          ...cloneJson(objectValue(after.metadata)),
        },
      },
      ...(cleanupCommand ? [{
        id: cleanupEvidenceId,
        kind: 'aos_cleanup',
        created_at: requireText(cleanup.completed_at || cleanup.executed_at, 'cleanup.completed_at'),
        uri: requireText(cleanup.artifact_uri, 'cleanup.artifact_uri'),
        digest: evidenceDigest(cleanupPayload),
        state_id: text(cleanup.state_id, afterStateId),
        target,
        immutable: true,
        summary: text(cleanup.summary, `Cleanup reported ${cleanupStatusValue}.`),
        metadata: {
          builder: WORK_RECORD_AOS_ACTION_CAPTURE_BUILDER_VERSION,
          phase: 'cleanup',
          command: cleanupCommand,
          status: cleanupStatusValue,
          target_dialect: targetDialect,
          target_with_ref: targetWithRef,
          ...(hasSavedRefLane ? { resolved_target: resolvedTarget } : {}),
          ...(selectedSavedRef ? { selected_saved_ref: selectedSavedRef } : {}),
          source: {
            type: text(evidenceSource.type, 'aos.action_evidence'),
            id: sourceId,
          },
          ...cloneJson(objectValue(cleanup.metadata)),
        },
      }] : []),
    ],
    claims,
    claim_results: claimResults,
    verifier_report: {
      id: verifierReportId,
      generated_at: completedAt,
      verifier: {
        id: verifierProfile.id,
        kind: verifierProfile.kind,
        version: verifierProfile.version,
      },
      claim_results_ref: 'claim_results',
      derived_indexes: derivedIndexes,
      evidence_refs: evidenceIds,
      feedback: allClaimsVerified
        ? []
        : [hasSavedRefLane
          ? 'Review failed AOS saved-ref action evidence before relying on this Work Record.'
          : 'Review failed AOS action evidence before relying on this Work Record.'],
    },
    health: {
      verdict: healthVerdict,
      reason: hasSavedRefLane
        ? healthReasonForVerdict(healthVerdict, objectValue(evidenceSource.health).reason)
        : (allClaimsVerified
          ? 'All run Claims verified against immutable AOS see/do/see evidence.'
          : 'One or more run Claims failed against the AOS action evidence.'),
      evaluated_at: completedAt,
      verifier_report_id: verifierReportId,
      confidence: Math.min(...claimResults.map((result) => result.confidence)),
      repair_gate_refs: [],
      replay_gate_refs: [],
    },
    metadata: {
      generated_by: WORK_RECORD_AOS_ACTION_CAPTURE_BUILDER_VERSION,
      evidence_source_id: sourceId,
      verifier_profile_id: verifierProfile.id,
      target_dialect: targetDialect,
      target_with_ref: targetWithRef,
      ...(selectedSavedRef ? { selected_saved_ref: selectedSavedRef } : {}),
      ...(hasSavedRefLane ? { resolved_target: resolvedTarget } : {}),
      ...(hasSavedRefLane ? { health_verdict: healthVerdict } : {}),
    },
  };
}
