import {
  actionStatus,
  cloneJson,
  evidenceEventPayload,
  evidenceTarget,
  objectValue,
  requireText,
  slug,
  text,
  workRecordCaptureBaseId,
  workRecordCaptureRecordId,
} from './work-record-capture-helpers.js';

export function normalizeAosActionEvidencePhases(source = {}) {
  const evidenceSource = objectValue(source);
  const sourceId = requireText(evidenceSource.id, 'id');
  const createdAt = requireText(evidenceSource.created_at, 'created_at');
  const completedAt = text(evidenceSource.completed_at, createdAt);
  const requestedRecordId = text(evidenceSource.record_id);
  const baseId = workRecordCaptureBaseId(requestedRecordId, sourceId);
  const recordId = workRecordCaptureRecordId(requestedRecordId, baseId);
  const targetDialect = requireText(evidenceSource.target_dialect, 'target_dialect');
  const target = evidenceTarget(evidenceSource.target);
  const targetWithRef = evidenceTarget(evidenceSource.target_with_ref || objectValue(evidenceSource.action).target);

  const before = objectValue(evidenceSource.before_perception);
  const dryRun = objectValue(evidenceSource.dry_run);
  const action = objectValue(evidenceSource.action);
  const after = objectValue(evidenceSource.after_perception);
  const cleanup = objectValue(evidenceSource.cleanup);
  const postconditionSource = objectValue(evidenceSource.postcondition);

  const beforeStateId = requireText(before.state_id || evidenceSource.state_id, 'before_perception.state_id');
  const actionStateId = text(action.state_id, beforeStateId);
  const afterStateId = requireText(after.state_id, 'after_perception.state_id');
  const actionVerb = requireText(action.verb, 'action.verb');
  const actionCommand = requireText(action.command, 'action.command');
  const dryRunCommand = text(dryRun.command);
  const dryRunStatusValue = dryRunCommand ? actionStatus(dryRun) : '';
  const dryRunPassed = !dryRunCommand || ['success', 'reacquired', 'resolved', 'direct_ax_ready'].includes(dryRunStatusValue);
  const actionStatusValue = actionStatus(action);
  const actionPassed = actionStatusValue === 'success';
  const cleanupCommand = text(cleanup.command);
  const cleanupStatusValue = cleanupCommand ? actionStatus(cleanup) : '';
  const cleanupPassed = !cleanupCommand || cleanupStatusValue === 'success';
  if (typeof postconditionSource.passed !== 'boolean') {
    throw new TypeError('postcondition.passed is required');
  }
  const postconditionPassed = postconditionSource.passed === true;

  const beforeEvidenceId = text(before.evidence_id, `evidence:${baseId}-before-see`);
  const dryRunEvidenceId = dryRunCommand ? text(dryRun.evidence_id, `evidence:${baseId}-dry-run`) : '';
  const actionEvidenceId = text(action.evidence_id, `evidence:${baseId}-do-${slug(actionVerb)}`);
  const afterEvidenceId = text(after.evidence_id, `evidence:${baseId}-after-see`);
  const cleanupEvidenceId = cleanupCommand ? text(cleanup.evidence_id, `evidence:${baseId}-cleanup`) : '';
  const evidenceIds = [
    beforeEvidenceId,
    dryRunEvidenceId,
    actionEvidenceId,
    afterEvidenceId,
    cleanupEvidenceId,
  ].filter(Boolean);

  const selectedSavedRef = text(evidenceSource.selected_saved_ref || action.saved_ref || dryRun.saved_ref);
  const resolvedTarget = text(
    evidenceSource.resolved_target
      || objectValue(action.target_resolution).target_with_ref
      || objectValue(dryRun.target_resolution).target_with_ref
      || targetWithRef,
  );
  const currentValidation = {
    ...cloneJson(objectValue(evidenceSource.current_validation)),
    ...cloneJson(objectValue(dryRun.current_validation)),
    ...cloneJson(objectValue(action.current_validation)),
  };
  const recommendedNext = objectValue(evidenceSource.recommended_next);
  const recommendedNextCommand = text(
    evidenceSource.recommended_next_command
      || action.recommended_next_command
      || dryRun.recommended_next_command,
  );
  const hasSavedRefLane = Boolean(
    selectedSavedRef
      || dryRunCommand
      || cleanupCommand
      || Object.keys(currentValidation).length > 0
      || Object.keys(recommendedNext).length > 0
      || recommendedNextCommand,
  );

  const sharedTargetMetadata = {
    target_dialect: targetDialect,
    target_with_ref: targetWithRef,
    ...(hasSavedRefLane ? { resolved_target: resolvedTarget } : {}),
    ...(selectedSavedRef ? { selected_saved_ref: selectedSavedRef } : {}),
  };
  const beforePayload = evidenceEventPayload(before, {
    phase: 'before',
    ...sharedTargetMetadata,
    source_id: sourceId,
  });
  const dryRunPayload = dryRunCommand ? evidenceEventPayload(dryRun, {
    phase: 'dry_run',
    verb: actionVerb,
    status: dryRunStatusValue,
    target_dialect: targetDialect,
    target_with_ref: targetWithRef,
    ...(hasSavedRefLane ? { resolved_target: resolvedTarget } : {}),
    ...(selectedSavedRef ? { selected_saved_ref: selectedSavedRef } : {}),
    ...(Object.keys(currentValidation).length > 0 ? { current_validation: cloneJson(currentValidation) } : {}),
    source_id: sourceId,
  }) : null;
  const actionPayload = evidenceEventPayload(action, {
    phase: 'action',
    verb: actionVerb,
    status: actionStatusValue,
    ...sharedTargetMetadata,
    ...(Object.keys(currentValidation).length > 0 ? { current_validation: cloneJson(currentValidation) } : {}),
    execution: cloneJson(objectValue(action.execution)),
    source_id: sourceId,
  });
  const afterPayload = evidenceEventPayload(after, {
    phase: 'after',
    ...sharedTargetMetadata,
    source_id: sourceId,
  });
  const cleanupPayload = cleanupCommand ? evidenceEventPayload(cleanup, {
    phase: 'cleanup',
    status: cleanupStatusValue,
    target_dialect: targetDialect,
    target_with_ref: targetWithRef,
    selected_saved_ref: selectedSavedRef,
    resolved_target: resolvedTarget,
    source_id: sourceId,
  }) : null;

  return {
    evidenceSource,
    sourceIdentity: { sourceId, createdAt, completedAt, requestedRecordId, baseId, recordId },
    targetResolution: { targetDialect, target, targetWithRef, selectedSavedRef, resolvedTarget },
    beforePerception: { source: before, stateId: beforeStateId, evidenceId: beforeEvidenceId, payload: beforePayload },
    dryRun: {
      source: dryRun,
      command: dryRunCommand,
      status: dryRunStatusValue,
      passed: dryRunPassed,
      evidenceId: dryRunEvidenceId,
      payload: dryRunPayload,
    },
    dispatchAction: {
      source: action,
      verb: actionVerb,
      command: actionCommand,
      stateId: actionStateId,
      status: actionStatusValue,
      passed: actionPassed,
      evidenceId: actionEvidenceId,
      payload: actionPayload,
    },
    afterReadback: { source: after, stateId: afterStateId, evidenceId: afterEvidenceId, payload: afterPayload },
    cleanup: {
      source: cleanup,
      command: cleanupCommand,
      status: cleanupStatusValue,
      passed: cleanupPassed,
      evidenceId: cleanupEvidenceId,
      payload: cleanupPayload,
    },
    postconditions: { source: postconditionSource, passed: postconditionPassed },
    savedRefState: { currentValidation, recommendedNext, recommendedNextCommand, hasSavedRefLane },
    evidenceIds,
  };
}
