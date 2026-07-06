import crypto from 'node:crypto';
import path from 'node:path';
import {
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

export const SCHEMA_VERSION = 'aos.pending-annotation.v0';
export const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
export const LIFECYCLE_STATES = new Set(['pending', 'consumed', 'resolved', 'deleted', 'stale', 'unsupported', 'blocked']);
export const CREATE_LIFECYCLE_STATES = new Set(['pending', 'stale', 'unsupported', 'blocked']);
export const TARGET_KINDS = new Set(['desktop', 'display', 'window', 'browser', 'canvas', 'native_ax', 'region', 'fallback']);
export const CAPABILITY_STATUSES = new Set(['saved_ref', 'fallback_only', 'unsupported', 'ambiguous', 'blocked']);

export function validateID(value, label = 'id') {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    fail(`${label} must match ${SAFE_ID.source}`, 'INVALID_ID');
  }
  return value;
}

export function sessionMetadata(env = process.env) {
  const clean = (value) => (typeof value === 'string' && value && !value.startsWith('$') ? value : null);
  const sessionID = clean(env.AOS_SESSION_ID) || clean(env.CODEX_THREAD_ID) || clean(env.CLAUDE_CODE_SSE_PORT);
  return {
    id: sessionID,
    mode: sessionID ? 'session_scoped' : 'anonymous_global',
    harness: env.AOS_SESSION_HARNESS || (env.CODEX_THREAD_ID ? 'codex' : (env.CLAUDE_CODE_SSE_PORT ? 'claude-code' : 'unknown')),
  };
}

function normalizeArtifactRefList(items) {
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
    if (!isObject(item)) {
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
  for (const item of normalizeArtifactRefList(items)) {
    const key = `${item.role}\0${item.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(item);
  }
  return refs;
}

export function normalizeArtifactRefs(items) {
  return uniqueArtifactRefs(items);
}

export function normalizeSavedRef(input = {}) {
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

function normalizeFallbackEvidence(items, targetSummary) {
  return array(items).map((item, index) => {
    if (!isObject(item)) fail(`fallback_evidence[${index}] must be an object`, 'INVALID_ARG');
    return {
      kind: requiredText(item.kind || 'region', `fallback_evidence[${index}].kind`),
      reason: requiredText(item.reason || 'semantic_ref_unavailable', `fallback_evidence[${index}].reason`),
      summary: requiredText(item.summary || targetSummary, `fallback_evidence[${index}].summary`),
      artifact_refs: normalizeArtifactRefs(item.artifact_refs ?? []),
    };
  });
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
  if (!isObject(input)) fail(`work_record_links[${index}] must be an object`, 'INVALID_ARG');
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

export function normalizeCapability(input, savedRef, fallbackEvidence) {
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

function recordContext(context = {}) {
  return {
    runtime_mode: requiredText(context.runtime_mode, 'record context runtime_mode'),
    pending_root: requiredText(context.pending_root, 'record context pending_root'),
    record_path_for_id: typeof context.record_path_for_id === 'function'
      ? context.record_path_for_id
      : (id) => path.join(context.pending_root, 'records', `${validateID(id, 'annotation id')}.json`),
  };
}

export function normalizeRecordInput(input, context = {}) {
  if (!isObject(input)) fail('Annotation input must be a JSON object', 'INVALID_ARG');
  const ctx = recordContext(context);
  const id = localIDOrNull(input.id, 'annotation id') || `ann-${crypto.randomUUID()}`;
  const created = text(input.created_at || input.lifecycle?.created_at, nowISO());
  const state = input.lifecycle?.state || input.state || 'pending';
  if (!LIFECYCLE_STATES.has(state)) fail(`Unsupported annotation state: ${state}`, 'INVALID_ARG');
  if (!CREATE_LIFECYCLE_STATES.has(state)) {
    fail(`Annotation create cannot import terminal lifecycle state: ${state}`, 'INVALID_ARG', {
      state,
      status: 'terminal_state_requires_transition',
    });
  }
  const targetKind = input.target?.kind || input.target_kind;
  if (!TARGET_KINDS.has(targetKind)) fail(`Unsupported target kind: ${targetKind || '<missing>'}`, 'INVALID_ARG');
  const targetSummary = requiredText(input.target?.summary || input.target_summary, 'target summary');
  const savedRef = normalizeSavedRef(input.target?.saved_ref ?? input.saved_ref ?? input);
  const fallbackEvidence = normalizeFallbackEvidence(input.fallback_evidence, targetSummary);
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
    runtime_mode: ctx.runtime_mode,
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
      session: input.actor?.session || sessionMetadata(context.env),
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
      root: ctx.pending_root,
      record: ctx.record_path_for_id(id),
    },
  };
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function nullableString(value) {
  return value === null || nonEmptyString(value);
}

function hasNullableString(value, key) {
  return Object.hasOwn(value, key) && nullableString(value[key]);
}

function optionalNullableString(value, key) {
  return !Object.hasOwn(value, key) || nullableString(value[key]);
}

function assertStringArray(value) {
  return Array.isArray(value) && value.every(nonEmptyString);
}

function assertActor(value) {
  return isObject(value)
    && nonEmptyString(value.source)
    && isObject(value.session)
    && (value.session.id === null || typeof value.session.id === 'string')
    && nonEmptyString(value.session.mode)
    && nonEmptyString(value.session.harness);
}

function assertArtifactRefs(value) {
  return Array.isArray(value) && value.every((item) => (
    isObject(item)
    && nonEmptyString(item.role)
    && nonEmptyString(item.path)
    && (item.media_type === undefined || nonEmptyString(item.media_type))
    && (item.bytes === undefined || item.bytes === null || (Number.isInteger(item.bytes) && item.bytes >= 0))
  ));
}

function assertSavedRef(value) {
  return value === null || (
    isObject(value)
    && SAFE_ID.test(value.workspace_id)
    && SAFE_ID.test(value.snapshot_id)
    && SAFE_ID.test(value.ref)
    && nullableString(value.action_target)
  );
}

function assertSourceCapture(value) {
  return value === null || (
    isObject(value)
    && value.kind === 'saved_capture'
    && nonEmptyString(value.schema_version)
    && nonEmptyString(value.status)
    && hasNullableString(value, 'workspace_id')
    && hasNullableString(value, 'snapshot_id')
    && hasNullableString(value, 'selected_ref')
    && Number.isInteger(value.ref_count)
    && value.ref_count >= 0
    && optionalNullableString(value, 'capture_target')
    && optionalNullableString(value, 'capture_mode')
    && optionalNullableString(value, 'query')
    && optionalNullableString(value, 'selected_backend')
    && optionalNullableString(value, 'selected_resolution_class')
  );
}

export function validateCapabilityInvariants(value) {
  const savedRefAvailable = value.target.saved_ref !== null;
  if (value.capability.saved_ref_available !== savedRefAvailable) return false;
  if (value.capability.status === 'saved_ref') {
    return savedRefAvailable && value.capability.saved_ref_available === true;
  }
  return true;
}

export function validateLifecycleInvariants(value) {
  if (value.lifecycle.state === 'consumed') {
    return nonEmptyString(value.lifecycle.consumed_at) && assertActor(value.lifecycle.consumed_by);
  }
  if (value.lifecycle.state === 'deleted') {
    return nonEmptyString(value.lifecycle.deleted_at);
  }
  return true;
}

export function isPendingAnnotationRecord(value) {
  if (
    !isObject(value)
    || value.schema_version !== SCHEMA_VERSION
    || !SAFE_ID.test(value.id)
    || !['repo', 'installed'].includes(value.runtime_mode)
    || !isObject(value.lifecycle)
    || !LIFECYCLE_STATES.has(value.lifecycle.state)
    || !nonEmptyString(value.lifecycle.created_at)
    || !nonEmptyString(value.lifecycle.updated_at)
    || !nullableString(value.lifecycle.consumed_at)
    || !(value.lifecycle.consumed_by === null || assertActor(value.lifecycle.consumed_by))
    || !nullableString(value.lifecycle.deleted_at)
    || !assertActor(value.actor)
    || !isObject(value.comment)
    || !nullableString(value.comment.text)
    || !isObject(value.target)
    || !TARGET_KINDS.has(value.target.kind)
    || !nonEmptyString(value.target.summary)
    || !assertSavedRef(value.target.saved_ref)
    || !isObject(value.capability)
    || !CAPABILITY_STATUSES.has(value.capability.status)
    || !assertStringArray(value.capability.reasons)
    || typeof value.capability.fallback_used !== 'boolean'
    || typeof value.capability.saved_ref_available !== 'boolean'
    || !Array.isArray(value.fallback_evidence)
    || !assertArtifactRefs(value.artifact_refs)
    || !Array.isArray(value.recommended_next)
    || value.recommended_next.length < 1
    || !Object.hasOwn(value, 'source_capture')
    || !assertSourceCapture(value.source_capture)
    || !Array.isArray(value.work_record_links)
    || !isObject(value.paths)
    || !nonEmptyString(value.paths.root)
    || !nonEmptyString(value.paths.record)
  ) {
    return false;
  }
  if (!validateCapabilityInvariants(value)) return false;
  if (!validateLifecycleInvariants(value)) return false;
  if (!value.fallback_evidence.every((item) => (
    isObject(item)
    && nonEmptyString(item.kind)
    && nonEmptyString(item.reason)
    && nonEmptyString(item.summary)
    && assertArtifactRefs(item.artifact_refs)
  ))) return false;
  for (const item of value.recommended_next) {
    if (!isObject(item) || !nonEmptyString(item.kind) || !nonEmptyString(item.reason) || !assertStringArray(item.argv)) {
      return false;
    }
  }
  if (!value.work_record_links.every((item) => (
    isObject(item)
    && nonEmptyString(item.ref)
    && nonEmptyString(item.relationship)
    && nonEmptyString(item.status)
    && assertArtifactRefs(item.artifact_refs)
    && (item.linked_at === undefined || nonEmptyString(item.linked_at))
    && (item.linked_by === undefined || assertActor(item.linked_by))
  ))) return false;
  return true;
}

export function validatePendingAnnotationRecord(value, { file, runtime_mode, pending_root, record_path_for_id } = {}) {
  const ctx = recordContext({ runtime_mode, pending_root, record_path_for_id });
  if (!isPendingAnnotationRecord(value) || value.runtime_mode !== ctx.runtime_mode) {
    fail(`Pending annotation record is schema-invalid: ${file}`, 'PENDING_ANNOTATION_STATE_CORRUPT', {
      path: file,
      storage_status: 'invalid_record_shape',
    });
  }
  const expectedRecord = ctx.record_path_for_id(value.id);
  const expectedName = `${value.id}.json`;
  const resolvedRoot = path.resolve(ctx.pending_root);
  const resolvedRecord = path.resolve(value.paths.record);
  const resolvedExpectedRecord = path.resolve(expectedRecord);
  const resolvedFile = path.resolve(file);
  if (
    path.basename(file) !== expectedName
    || resolvedFile !== resolvedExpectedRecord
    || value.paths.root !== ctx.pending_root
    || value.paths.record !== expectedRecord
    || resolvedRecord !== resolvedExpectedRecord
    || (resolvedRecord !== resolvedRoot && !resolvedRecord.startsWith(`${resolvedRoot}${path.sep}`))
  ) {
    fail(`Pending annotation record has invalid path invariants: ${file}`, 'PENDING_ANNOTATION_STATE_CORRUPT', {
      path: file,
      id: value.id,
      storage_status: 'invalid_record_shape',
    });
  }
  return value;
}

export function annotationSummary(record, { path: recordFile } = {}) {
  return {
    id: record.id,
    state: record.lifecycle.state,
    created_at: record.lifecycle.created_at,
    updated_at: record.lifecycle.updated_at,
    consumed_at: record.lifecycle.consumed_at ?? null,
    target_kind: record.target.kind,
    target_summary: record.target.summary,
    comment_text: record.comment?.text ?? null,
    capability_status: record.capability.status,
    saved_ref: record.target.saved_ref ?? null,
    fallback_count: record.fallback_evidence.length,
    recommended_next_count: record.recommended_next.length,
    work_record_link_count: Array.isArray(record.work_record_links) ? record.work_record_links.length : 0,
    path: recordFile,
  };
}

export function assertConsumableCapability(record, id) {
  if (record.capability?.status !== 'saved_ref') return;
  if (record.target?.saved_ref && record.capability.saved_ref_available === true) return;
  fail(`Pending annotation saved_ref capability is corrupt: ${id}`, 'PENDING_ANNOTATION_STATE_CORRUPT', {
    id,
    status: 'corrupt',
    capability_status: record.capability?.status || null,
  });
}

export function compactResult(record, status = 'success', summaryContext = {}) {
  return {
    status,
    schema_version: SCHEMA_VERSION,
    runtime_mode: record.runtime_mode,
    annotation: annotationSummary(record, summaryContext),
  };
}
