import {
  array,
  fail,
  isObject,
  localIDOrNull,
  requiredText,
  text,
} from './pending-annotations-constants.mjs';
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

function normalizeArtifactRefs(items) {
  return array(items).map((item, index) => {
    if (typeof item === 'string') {
      const split = item.indexOf('=');
      if (split <= 0 || split === item.length - 1) {
        fail('--artifact must use <role>=<path>', 'INVALID_ARG');
      }
      return {
        role: requiredText(item.slice(0, split), `artifact[${index}].role`),
        path: requiredText(item.slice(split + 1), `artifact[${index}].path`),
      };
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      fail(`artifact_refs[${index}] must be an object`, 'INVALID_ARG');
    }
    return {
      ...item,
      role: requiredText(item.role, `artifact_refs[${index}].role`),
      path: requiredText(item.path, `artifact_refs[${index}].path`),
    };
  });
}

export function uniqueArtifactRefs(items) {
  const seen = new Set();
  const refs = [];
  for (const item of normalizeArtifactRefs(items)) {
    const key = `${item.role}\0${item.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(item);
  }
  return refs;
}

export function normalizeSavedRef(input) {
  const workspace = localIDOrNull(input.workspace_id ?? input.workspace, 'workspace id');
  const snapshot = localIDOrNull(input.snapshot_id ?? input.snapshot, 'snapshot id');
  const ref = localIDOrNull(input.ref, 'ref id');
  if (!snapshot && !ref) return null;
  if (!snapshot || !ref) fail('saved_ref requires both snapshot_id and ref', 'INVALID_ARG');
  return {
    workspace_id: workspace || 'default',
    snapshot_id: snapshot,
    ref,
    action_target: input.action_target ?? null,
    ...(input.backend ? { backend: input.backend } : {}),
    ...(input.resolution_class ? { resolution_class: input.resolution_class } : {}),
    ...(input.confidence ? { confidence: input.confidence } : {}),
  };
}

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
    return {
      ...overrides,
      state: 'stale',
      target_kind: overrides.target_kind || 'fallback',
      target_summary: targetSummary,
      capability: { status: 'blocked', reasons: ['source_capture_stale'] },
      fallback_evidence: [{
        kind: 'saved_capture',
        reason: 'source_capture_stale',
        summary: targetSummary,
        artifact_refs: captureArtifacts,
      }],
      artifact_refs: captureArtifacts,
      recommended_next: captureRefreshNext(workspace),
      source_capture: sourceCapture,
    };
  }

  if (ambiguous) {
    return {
      ...overrides,
      state: 'blocked',
      target_kind: overrides.target_kind || 'fallback',
      target_summary: targetSummary,
      capability: { status: 'ambiguous', reasons: ['multiple_capture_refs_without_selection'] },
      fallback_evidence: [{
        kind: 'saved_capture',
        reason: 'multiple_capture_refs_without_selection',
        summary: targetSummary,
        artifact_refs: captureArtifacts,
      }],
      artifact_refs: captureArtifacts,
      recommended_next: nextFromCapture,
      source_capture: sourceCapture,
    };
  }

  if (!refRecord) {
    return {
      ...overrides,
      target_kind: overrides.target_kind || 'fallback',
      target_summary: targetSummary,
      capability: { status: 'fallback_only', reasons: ['saved_ref_unavailable'] },
      fallback_evidence: [{
        kind: 'saved_capture',
        reason: 'saved_ref_unavailable',
        summary: targetSummary,
        artifact_refs: captureArtifacts,
      }],
      artifact_refs: captureArtifacts,
      recommended_next: captureRefreshNext(workspace),
      source_capture: sourceCapture,
    };
  }

  const refCapability = annotationCapabilityFromSavedRef(refRecord);
  const targetKind = refCapability.target_kind;
  if (refCapability.status === 'unsupported') {
    return {
      ...overrides,
      state: 'unsupported',
      target_kind: overrides.target_kind || targetKind || 'fallback',
      target_summary: targetSummary,
      capability: { status: 'unsupported', reasons: refCapability.reasons },
      fallback_evidence: [{
        kind: 'saved_capture',
        reason: 'saved_ref_unsupported',
        summary: targetSummary,
        artifact_refs: captureArtifacts,
      }],
      artifact_refs: captureArtifacts,
      recommended_next: nextFromCapture,
      source_capture: sourceCapture,
    };
  }

  if (refCapability.status === 'fallback_only') {
    return {
      ...overrides,
      target_kind: overrides.target_kind || targetKind,
      target_summary: targetSummary,
      capability: { status: 'fallback_only', reasons: refCapability.reasons },
      fallback_evidence: [{
        kind: 'saved_capture',
        reason: 'saved_ref_not_actionable',
        summary: targetSummary,
        artifact_refs: captureArtifacts,
      }],
      artifact_refs: captureArtifacts,
      recommended_next: captureRefreshNext(workspace),
      source_capture: sourceCapture,
    };
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
