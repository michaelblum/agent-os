import crypto from 'node:crypto';
import {
  CAPABILITY_STATUSES,
  LIFECYCLE_STATES,
  SCHEMA_VERSION,
  TARGET_KINDS,
  array,
  fail,
  isObject,
  localIDOrNull,
  nowISO,
  requiredText,
  text,
} from './pending-annotations-constants.mjs';
import {
  normalizeRecommendedNext,
} from './pending-annotations-recommendations.mjs';
import {
  normalizeSavedRef,
  projectCaptureInput,
  uniqueArtifactRefs,
} from './pending-annotations-projection.mjs';
import {
  annotationSummary,
  pendingRoot,
  recordPath,
  runtimeMode,
} from './pending-annotations-store.mjs';

export function sessionMetadata(env = process.env) {
  const clean = (value) => (typeof value === 'string' && value && !value.startsWith('$') ? value : null);
  const sessionID = clean(env.AOS_SESSION_ID) || clean(env.CODEX_THREAD_ID) || clean(env.CLAUDE_CODE_SSE_PORT);
  return {
    id: sessionID,
    mode: sessionID ? 'session_scoped' : 'anonymous_global',
    harness: env.AOS_SESSION_HARNESS || (env.CODEX_THREAD_ID ? 'codex' : (env.CLAUDE_CODE_SSE_PORT ? 'claude-code' : 'unknown')),
  };
}

export function compactResult(record, status = 'success', env = process.env) {
  return {
    status,
    schema_version: SCHEMA_VERSION,
    runtime_mode: record.runtime_mode,
    annotation: annotationSummary(record, env),
  };
}

export function normalizeArtifactRefs(items) {
  return uniqueArtifactRefs(items);
}

function normalizeFallbackEvidence(items, targetSummary, savedRef) {
  const fallback = array(items).map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      fail(`fallback_evidence[${index}] must be an object`, 'INVALID_ARG');
    }
    return {
      kind: requiredText(item.kind || 'region', `fallback_evidence[${index}].kind`),
      reason: requiredText(item.reason || 'semantic_ref_unavailable', `fallback_evidence[${index}].reason`),
      summary: requiredText(item.summary || targetSummary, `fallback_evidence[${index}].summary`),
      artifact_refs: normalizeArtifactRefs(item.artifact_refs ?? []),
    };
  });
  return fallback;
}

export function normalizeWorkRecordLink(input, index = 0) {
  if (typeof input === 'string') {
    return {
      ref: requiredText(input, `work_record_links[${index}].ref`),
      relationship: 'annotation_evidence',
      status: 'linked',
      artifact_refs: [],
    };
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail(`work_record_links[${index}] must be an object`, 'INVALID_ARG');
  }
  return {
    ...input,
    ref: requiredText(input.ref || input.work_record || input.id, `work_record_links[${index}].ref`),
    relationship: requiredText(input.relationship || 'annotation_evidence', `work_record_links[${index}].relationship`),
    status: requiredText(input.status || 'linked', `work_record_links[${index}].status`),
    artifact_refs: normalizeArtifactRefs(input.artifact_refs ?? []),
  };
}

function normalizeWorkRecordLinks(items) {
  return array(items).map((item, index) => normalizeWorkRecordLink(item, index));
}

function normalizeCapability(input, savedRef, fallbackEvidence) {
  const explicit = input.capability ?? {};
  const status = explicit.status || (savedRef ? 'saved_ref' : 'fallback_only');
  if (!CAPABILITY_STATUSES.has(status)) fail(`Unsupported capability status: ${status}`, 'INVALID_ARG');
  const savedRefAvailable = Boolean(savedRef);
  if (status === 'saved_ref' && !savedRefAvailable) {
    fail('capability.status saved_ref requires target.saved_ref', 'INVALID_ARG');
  }
  if (
    Object.hasOwn(explicit, 'saved_ref_available')
    && explicit.saved_ref_available !== savedRefAvailable
  ) {
    fail('capability.saved_ref_available must match target.saved_ref availability', 'INVALID_ARG');
  }
  return {
    status,
    reasons: array(explicit.reasons).map((item) => requiredText(item, 'capability reason')),
    fallback_used: fallbackEvidence.length > 0,
    saved_ref_available: savedRefAvailable,
  };
}

function optionalNullableText(input, key) {
  if (!Object.hasOwn(input, key)) return {};
  const value = input[key];
  if (value !== null && typeof value !== 'string') {
    fail(`source_capture.${key} must be a string or null`, 'INVALID_ARG');
  }
  return { [key]: value };
}

function requiredNullableText(input, key) {
  if (!Object.hasOwn(input, key)) fail(`source_capture.${key} is required`, 'INVALID_ARG');
  const value = input[key];
  if (value !== null && typeof value !== 'string') {
    fail(`source_capture.${key} must be a string or null`, 'INVALID_ARG');
  }
  return value;
}

export function normalizeSourceCapture(value) {
  if (value === null || value === undefined) return null;
  if (!isObject(value)) fail('source_capture must be an object or null', 'INVALID_ARG');
  if (value.kind !== 'saved_capture') fail('source_capture.kind must be saved_capture', 'INVALID_ARG');
  const schemaVersion = requiredText(value.schema_version, 'source_capture.schema_version');
  const status = requiredText(value.status, 'source_capture.status');
  if (!Number.isInteger(value.ref_count) || value.ref_count < 0) {
    fail('source_capture.ref_count must be an integer >= 0', 'INVALID_ARG');
  }
  return {
    kind: 'saved_capture',
    schema_version: schemaVersion,
    status,
    workspace_id: requiredNullableText(value, 'workspace_id'),
    snapshot_id: requiredNullableText(value, 'snapshot_id'),
    selected_ref: requiredNullableText(value, 'selected_ref'),
    ref_count: value.ref_count,
    ...optionalNullableText(value, 'capture_target'),
    ...optionalNullableText(value, 'capture_mode'),
    ...optionalNullableText(value, 'query'),
    ...optionalNullableText(value, 'selected_backend'),
    ...optionalNullableText(value, 'selected_resolution_class'),
  };
}

export function normalizeRecordInput(input, env = process.env) {
  input = projectCaptureInput(input);
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('Annotation input must be a JSON object', 'INVALID_ARG');
  }
  const id = localIDOrNull(input.id, 'annotation id') || `ann-${crypto.randomUUID()}`;
  const created = text(input.created_at || input.lifecycle?.created_at, nowISO());
  const state = input.lifecycle?.state || input.state || 'pending';
  if (!LIFECYCLE_STATES.has(state)) fail(`Unsupported annotation state: ${state}`, 'INVALID_ARG');
  const targetKind = input.target?.kind || input.target_kind;
  if (!TARGET_KINDS.has(targetKind)) fail(`Unsupported target kind: ${targetKind || '<missing>'}`, 'INVALID_ARG');
  const targetSummary = requiredText(input.target?.summary || input.target_summary, 'target summary');
  const savedRef = normalizeSavedRef(input.target?.saved_ref ?? input.saved_ref ?? input);
  const fallbackEvidence = normalizeFallbackEvidence(input.fallback_evidence, targetSummary, savedRef);
  const capability = normalizeCapability(input, savedRef, fallbackEvidence);
  const workspaceForNext = savedRef?.workspace_id || localIDOrNull(input.workspace_id ?? input.workspace, 'workspace id') || 'default';
  const recommendedNext = normalizeRecommendedNext(input.recommended_next, {
    savedRef,
    fallbackOnly: capability.status !== 'saved_ref',
    workspace: workspaceForNext,
  });
  return {
    schema_version: SCHEMA_VERSION,
    id,
    runtime_mode: runtimeMode(env),
    lifecycle: {
      state,
      created_at: created,
      updated_at: created,
      consumed_at: null,
      consumed_by: null,
      deleted_at: null,
    },
    actor: {
      source: text(input.actor?.source || input.source, 'cli'),
      session: input.actor?.session || sessionMetadata(env),
    },
    comment: {
      text: input.comment?.text ?? input.comment ?? null,
    },
    target: {
      kind: targetKind,
      summary: targetSummary,
      saved_ref: savedRef,
    },
    capability,
    fallback_evidence: fallbackEvidence,
    artifact_refs: normalizeArtifactRefs(input.artifact_refs ?? []),
    recommended_next: recommendedNext,
    source_capture: normalizeSourceCapture(input.source_capture),
    work_record_links: normalizeWorkRecordLinks(input.work_record_links),
    paths: {
      root: pendingRoot(env),
      record: recordPath(id, env),
    },
  };
}
