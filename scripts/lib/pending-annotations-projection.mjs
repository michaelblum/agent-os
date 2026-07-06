import {
  array,
  fail,
  isObject,
  localIDOrNull,
  requiredText,
  text,
} from './pending-annotations-constants.mjs';
import {
  uniqueArtifactRefs,
} from './pending-annotations-model.mjs';
import {
  captureInspectNext,
  captureRefreshNext,
} from './pending-annotations-recommendations.mjs';
import {
  AGENT_WORKSPACE_SCHEMA_VERSION,
} from './agent-workspace/contracts.mjs';
import {
  annotationCapabilityFromSavedRef,
} from './agent-workspace/refs.mjs';

function isSavedCaptureResult(value) {
  return isObject(value) && (
    value.schema_version === AGENT_WORKSPACE_SCHEMA_VERSION
    || (Array.isArray(value.refs) && value.workspace_id && value.snapshot_id)
  );
}

function captureResultEnvelope(input) {
  if (!isObject(input)) return null;
  if (isSavedCaptureResult(input)) {
    return {
      capture: input,
      selectedRef: input.selected_ref || input.ref || null,
      overrides: {},
    };
  }
  if (isSavedCaptureResult(input.capture_result)) {
    return {
      capture: input.capture_result,
      selectedRef: input.selected_ref || input.ref || input.capture_result.selected_ref || input.capture_result.ref || null,
      overrides: input,
    };
  }
  return null;
}

function compactSourceCapture(capture, selectedRef, selectedRecord = null) {
  return {
    kind: 'saved_capture',
    schema_version: capture.schema_version || AGENT_WORKSPACE_SCHEMA_VERSION,
    status: capture.status || 'success',
    workspace_id: capture.workspace_id ?? null,
    snapshot_id: capture.snapshot_id ?? null,
    selected_ref: selectedRef ?? selectedRecord?.ref ?? null,
    capture_target: capture.capture_target ?? null,
    capture_mode: capture.capture_mode ?? null,
    query: capture.query ?? null,
    ref_count: Array.isArray(capture.refs) ? capture.refs.length : 0,
    selected_backend: selectedRecord?.backend ?? null,
    selected_resolution_class: selectedRecord?.resolution_class ?? null,
  };
}

function selectedCaptureRef(capture, selectedRef) {
  const refs = array(capture.refs);
  if (selectedRef) {
    const match = refs.find((item) => item?.ref === selectedRef);
    if (!match) fail(`Capture result does not contain selected ref: ${selectedRef}`, 'INVALID_ARG', { ref: selectedRef });
    return { record: match, ambiguous: false };
  }
  if (refs.length === 1) return { record: refs[0], ambiguous: false };
  return { record: null, ambiguous: refs.length > 1 };
}

function targetSummaryFromCapture(capture, refRecord, overrides = {}) {
  return requiredText(
    overrides.target_summary
      || overrides.target?.summary
      || refRecord?.target_summary
      || refRecord?.summary
      || capture.target_summary
      || capture.target
      || capture.capture_target
      || 'captured operator selection',
    'target summary',
  );
}

function projectFallbackCapture({
  overrides,
  state,
  targetSummary,
  targetKind = 'fallback',
  capability,
  reason,
  artifactRefs,
  recommendedNext,
  sourceCapture,
}) {
  return {
    ...overrides,
    ...(state ? { state } : {}),
    target_kind: overrides.target_kind || targetKind || 'fallback',
    target_summary: targetSummary,
    capability,
    fallback_evidence: [{
      kind: 'saved_capture',
      reason,
      summary: targetSummary,
      artifact_refs: artifactRefs,
    }],
    artifact_refs: artifactRefs,
    recommended_next: recommendedNext,
    source_capture: sourceCapture,
  };
}

export function projectCaptureInput(input) {
  const envelope = captureResultEnvelope(input);
  if (!envelope) return input;

  const { capture, selectedRef, overrides } = envelope;
  const workspace = localIDOrNull(overrides.workspace_id ?? overrides.workspace ?? capture.workspace_id, 'workspace id') || 'default';
  const snapshot = localIDOrNull(overrides.snapshot_id ?? overrides.snapshot ?? capture.snapshot_id, 'snapshot id');
  const { record: refRecord, ambiguous } = selectedCaptureRef(capture, selectedRef);
  const captureArtifacts = uniqueArtifactRefs([
    ...array(capture.artifact_refs),
    ...array(refRecord?.artifact_refs),
    ...array(overrides.artifact_refs),
  ]);
  const targetSummary = targetSummaryFromCapture(capture, refRecord, overrides);
  const sourceCapture = compactSourceCapture(capture, selectedRef, refRecord);
  const captureStatus = text(capture.status, 'success');
  const nextFromCapture = snapshot ? captureInspectNext(workspace, snapshot) : captureRefreshNext(workspace);

  if (captureStatus === 'stale') {
    return projectFallbackCapture({
      overrides,
      state: 'stale',
      capability: { status: 'blocked', reasons: ['source_capture_stale'] },
      reason: 'source_capture_stale',
      targetSummary,
      artifactRefs: captureArtifacts,
      recommendedNext: captureRefreshNext(workspace),
      sourceCapture,
    });
  }

  if (ambiguous) {
    return projectFallbackCapture({
      overrides,
      state: 'blocked',
      capability: { status: 'ambiguous', reasons: ['multiple_capture_refs_without_selection'] },
      reason: 'multiple_capture_refs_without_selection',
      targetSummary,
      artifactRefs: captureArtifacts,
      recommendedNext: nextFromCapture,
      sourceCapture,
    });
  }

  if (!refRecord) {
    return projectFallbackCapture({
      overrides,
      capability: { status: 'fallback_only', reasons: ['saved_ref_unavailable'] },
      reason: 'saved_ref_unavailable',
      targetSummary,
      artifactRefs: captureArtifacts,
      recommendedNext: captureRefreshNext(workspace),
      sourceCapture,
    });
  }

  const refCapability = annotationCapabilityFromSavedRef(refRecord);
  const targetKind = refCapability.target_kind;
  if (refCapability.status === 'unsupported') {
    return projectFallbackCapture({
      overrides,
      state: 'unsupported',
      capability: { status: 'unsupported', reasons: refCapability.reasons },
      reason: 'saved_ref_unsupported',
      targetKind,
      targetSummary,
      artifactRefs: captureArtifacts,
      recommendedNext: nextFromCapture,
      sourceCapture,
    });
  }

  if (refCapability.status === 'fallback_only') {
    return projectFallbackCapture({
      overrides,
      capability: { status: 'fallback_only', reasons: refCapability.reasons },
      reason: 'saved_ref_not_actionable',
      targetKind,
      targetSummary,
      artifactRefs: captureArtifacts,
      recommendedNext: captureRefreshNext(workspace),
      sourceCapture,
    });
  }

  return {
    ...overrides,
    target_kind: overrides.target_kind || targetKind,
    target_summary: targetSummary,
    workspace,
    snapshot,
    ref: refRecord.ref,
    action_target: refRecord.action_target || refRecord.copyable_action_target || null,
    saved_ref: {
      workspace_id: workspace,
      snapshot_id: snapshot || refRecord.snapshot_id,
      ref: refRecord.ref,
      action_target: refRecord.action_target || refRecord.copyable_action_target || null,
      backend: refRecord.backend,
      resolution_class: refRecord.resolution_class,
      confidence: refRecord.confidence ?? null,
    },
    capability: { status: 'saved_ref', reasons: [] },
    fallback_evidence: array(overrides.fallback_evidence),
    artifact_refs: captureArtifacts,
    recommended_next: nextFromCapture.length ? nextFromCapture : undefined,
    source_capture: sourceCapture,
  };
}
