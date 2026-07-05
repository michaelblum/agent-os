import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const SCHEMA_VERSION = 'aos.pending-annotation.v0';
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const JSON_SPACING = 2;
const LIFECYCLE_STATES = new Set(['pending', 'consumed', 'resolved', 'deleted', 'stale', 'unsupported', 'blocked']);
const TARGET_KINDS = new Set(['desktop', 'display', 'window', 'browser', 'canvas', 'native_ax', 'region', 'fallback']);
const CAPABILITY_STATUSES = new Set(['saved_ref', 'fallback_only', 'unsupported', 'ambiguous', 'blocked']);
const CAPTURE_SCHEMA_VERSION = 'aos.agent-workspace.v0';
const SAVED_REF_BACKEND_TARGETS = new Map([
  ['browser', 'browser'],
  ['aos_canvas', 'canvas'],
  ['native_ax', 'native_ax'],
]);
const ACTIONABLE_REF_CLASSES = new Set(['stable', 'reacquirable', 'snapshot_scoped']);

export class PendingAnnotationError extends Error {
  constructor(message, code, extra = {}) {
    super(message);
    this.name = 'PendingAnnotationError';
    this.code = code;
    this.extra = extra;
  }

  toJSON() {
    return {
      code: this.code,
      error: this.message,
      ...this.extra,
    };
  }
}

export function isPendingAnnotationError(error) {
  return error instanceof PendingAnnotationError || (
    error?.name === 'PendingAnnotationError' && typeof error?.code === 'string'
  );
}

export function emitPendingAnnotationError(error) {
  if (!isPendingAnnotationError(error)) throw error;
  process.stderr.write(`${JSON.stringify(error.toJSON(), null, JSON_SPACING)}\n`);
  process.exit(1);
}

function fail(message, code, extra = {}) {
  throw new PendingAnnotationError(message, code, extra);
}

function runtimeMode(env = process.env) {
  return env.AOS_RUNTIME_MODE?.toLowerCase() === 'installed' ? 'installed' : 'repo';
}

function stateRoot(env = process.env) {
  return path.resolve(env.AOS_STATE_ROOT || path.join(os.homedir(), '.config/aos'));
}

function pendingRoot(env = process.env) {
  return path.join(stateRoot(env), runtimeMode(env), 'pending-annotations');
}

function indexPath(env = process.env) {
  return path.join(pendingRoot(env), 'index.json');
}

function recordsDir(env = process.env) {
  return path.join(pendingRoot(env), 'records');
}

function recordPath(id, env = process.env) {
  return path.join(recordsDir(env), `${validateID(id, 'annotation id')}.json`);
}

function nowISO() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])]));
  }
  return value;
}

function writeJSONAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomUUID()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(sortObject(value), null, JSON_SPACING)}\n`);
  fs.renameSync(tmp, file);
}

function readJSONExisting(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    fail(`Pending annotation state is corrupt or unreadable: ${file}`, 'PENDING_ANNOTATION_STATE_CORRUPT', { path: file });
  }
}

function validateID(value, label = 'id') {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    fail(`${label} must match ${SAFE_ID.source}`, 'INVALID_ID');
  }
  return value;
}

function localIDOrNull(value, label) {
  if (value === null || value === undefined || value === '') return null;
  return validateID(String(value), label);
}

function text(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function requiredText(value, label) {
  const normalized = text(value).trim();
  if (!normalized) fail(`${label} is required`, 'MISSING_ARG');
  return normalized;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function sessionMetadata(env = process.env) {
  const clean = (value) => (typeof value === 'string' && value && !value.startsWith('$') ? value : null);
  const sessionID = clean(env.AOS_SESSION_ID) || clean(env.CODEX_THREAD_ID) || clean(env.CLAUDE_CODE_SSE_PORT);
  return {
    id: sessionID,
    mode: sessionID ? 'session_scoped' : 'anonymous_global',
    harness: env.AOS_SESSION_HARNESS || (env.CODEX_THREAD_ID ? 'codex' : (env.CLAUDE_CODE_SSE_PORT ? 'claude-code' : 'unknown')),
  };
}

function defaultIndex(env = process.env) {
  const now = nowISO();
  return {
    schema_version: SCHEMA_VERSION,
    runtime_mode: runtimeMode(env),
    state_root: stateRoot(env),
    created_at: now,
    updated_at: now,
    annotations: [],
  };
}

function assertIndex(value, file, env = process.env) {
  if (!value) return defaultIndex(env);
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || value.schema_version !== SCHEMA_VERSION
    || value.runtime_mode !== runtimeMode(env)
    || !Array.isArray(value.annotations)
  ) {
    fail(`Pending annotation index is schema-invalid: ${file}`, 'PENDING_ANNOTATION_STATE_CORRUPT', { path: file });
  }
  for (const entry of value.annotations) {
    if (
      !entry
      || typeof entry !== 'object'
      || Array.isArray(entry)
      || !SAFE_ID.test(entry.id)
      || !LIFECYCLE_STATES.has(entry.state)
      || typeof entry.updated_at !== 'string'
    ) {
      fail(`Pending annotation index is schema-invalid: ${file}`, 'PENDING_ANNOTATION_STATE_CORRUPT', { path: file });
    }
  }
  return value;
}

function loadIndex(env = process.env) {
  return assertIndex(readJSONExisting(indexPath(env)), indexPath(env), env);
}

function saveIndex(index, env = process.env) {
  writeJSONAtomic(indexPath(env), {
    ...index,
    updated_at: nowISO(),
  });
}

function upsertIndexEntry(record, env = process.env) {
  const index = loadIndex(env);
  const entry = annotationSummary(record);
  const next = index.annotations.filter((item) => item.id !== record.id);
  next.push(entry);
  saveIndex({ ...index, annotations: next.sort((a, b) => a.created_at.localeCompare(b.created_at)) }, env);
}

function assertRecord(value, file, env = process.env) {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || value.schema_version !== SCHEMA_VERSION
    || !SAFE_ID.test(value.id)
    || value.runtime_mode !== runtimeMode(env)
    || !value.lifecycle
    || !LIFECYCLE_STATES.has(value.lifecycle.state)
    || !value.target
    || !TARGET_KINDS.has(value.target.kind)
    || !value.capability
    || !CAPABILITY_STATUSES.has(value.capability.status)
    || !Array.isArray(value.recommended_next)
    || !Array.isArray(value.artifact_refs)
  ) {
    fail(`Pending annotation record is schema-invalid: ${file}`, 'PENDING_ANNOTATION_STATE_CORRUPT', { path: file });
  }
  for (const item of value.recommended_next) {
    if (!item || typeof item !== 'object' || !Array.isArray(item.argv) || item.argv.some((arg) => typeof arg !== 'string' || arg.length === 0)) {
      fail(`Pending annotation record has invalid recommended argv: ${file}`, 'PENDING_ANNOTATION_STATE_CORRUPT', { path: file });
    }
  }
  return value;
}

function loadRecord(id, env = process.env) {
  const file = recordPath(id, env);
  const record = readJSONExisting(file);
  if (!record) fail(`Pending annotation not found: ${id}`, 'PENDING_ANNOTATION_NOT_FOUND', { id });
  return assertRecord(record, file, env);
}

function annotationSummary(record) {
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
    work_record_link_count: array(record.work_record_links).length,
    path: record.paths.record,
  };
}

function compactResult(record, status = 'success') {
  return {
    status,
    schema_version: SCHEMA_VERSION,
    runtime_mode: record.runtime_mode,
    annotation: annotationSummary(record),
  };
}

function defaultRecommendedNext({ savedRef, fallbackOnly, workspace }, env = process.env) {
  if (savedRef) {
    return [{
      kind: 'inspect_saved_ref',
      reason: 'Review compact saved ref context before acting.',
      argv: [
        'aos',
        'see',
        'refs',
        '--workspace',
        savedRef.workspace_id,
        '--snapshot',
        savedRef.snapshot_id,
        '--json',
      ],
    }];
  }
  return [{
    kind: fallbackOnly ? 'refresh_saved_perception' : 'inspect_current_perception',
    reason: fallbackOnly
      ? 'Target has fallback evidence only; capture saved perception before mutation.'
      : 'No saved perception ref was attached to this annotation.',
    argv: ['aos', 'see', 'capture', 'main', '--save', '--workspace', workspace, '--mode', 'som'],
  }];
}

function normalizeRecommendedNext(items, context, env = process.env) {
  const raw = array(items);
  if (!raw.length) return defaultRecommendedNext(context, env);
  return raw.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      fail(`recommended_next[${index}] must be an object`, 'INVALID_ARG');
    }
    const argv = array(item.argv);
    if (!argv.length || argv.some((arg) => typeof arg !== 'string' || arg.length === 0)) {
      fail(`recommended_next[${index}].argv must be a non-empty string array`, 'INVALID_ARG');
    }
    return {
      kind: requiredText(item.kind || 'follow_up', `recommended_next[${index}].kind`),
      reason: requiredText(item.reason || 'Follow-up command for this annotation.', `recommended_next[${index}].reason`),
      argv,
    };
  });
}

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

function uniqueArtifactRefs(items) {
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

function normalizeSavedRef(input) {
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

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function isSavedCaptureResult(value) {
  return isObject(value) && (
    value.schema_version === CAPTURE_SCHEMA_VERSION
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
    schema_version: capture.schema_version || CAPTURE_SCHEMA_VERSION,
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

function captureInspectNext(workspace, snapshot) {
  if (workspace && snapshot) {
    return [{
      kind: 'inspect_saved_ref',
      reason: 'Inspect saved refs for the captured selection before acting.',
      argv: ['aos', 'see', 'refs', '--workspace', workspace, '--snapshot', snapshot, '--json'],
    }];
  }
  return [];
}

function captureRefreshNext(workspace) {
  return [{
    kind: 'refresh_saved_perception',
    reason: 'Capture fresh saved perception before acting from this annotation.',
    argv: ['aos', 'see', 'capture', 'main', '--save', '--workspace', workspace || 'default', '--mode', 'som'],
  }];
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

function projectCaptureInput(input, env = process.env) {
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

  const targetKind = SAVED_REF_BACKEND_TARGETS.get(refRecord.backend);
  if (!targetKind || refRecord.resolution_class === 'unsupported') {
    return {
      ...overrides,
      state: 'unsupported',
      target_kind: overrides.target_kind || targetKind || 'fallback',
      target_summary: targetSummary,
      capability: { status: 'unsupported', reasons: [`unsupported_saved_ref:${refRecord.backend || 'unknown'}:${refRecord.resolution_class || 'unknown'}`] },
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

  if (!ACTIONABLE_REF_CLASSES.has(refRecord.resolution_class)) {
    return {
      ...overrides,
      target_kind: overrides.target_kind || targetKind,
      target_summary: targetSummary,
      capability: { status: 'fallback_only', reasons: [`saved_ref_not_actionable:${refRecord.resolution_class || 'unknown'}`] },
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
  if (!savedRef && !fallback.length) {
    fallback.push({
      kind: 'operator_target',
      reason: 'semantic_ref_unavailable',
      summary: targetSummary,
      artifact_refs: [],
    });
  }
  return fallback;
}

function normalizeWorkRecordLink(input, index = 0) {
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
  return {
    status,
    reasons: array(explicit.reasons).map((item) => requiredText(item, 'capability reason')),
    fallback_used: status !== 'saved_ref' || fallbackEvidence.length > 0,
    saved_ref_available: Boolean(savedRef),
  };
}

function normalizeRecordInput(input, env = process.env) {
  input = projectCaptureInput(input, env);
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
  }, env);
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
    source_capture: isObject(input.source_capture) ? input.source_capture : null,
    work_record_links: normalizeWorkRecordLinks(input.work_record_links),
    paths: {
      root: pendingRoot(env),
      record: recordPath(id, env),
    },
  };
}

export function createPendingAnnotation(input, env = process.env) {
  const record = normalizeRecordInput(input, env);
  const file = recordPath(record.id, env);
  if (fs.existsSync(file)) fail(`Pending annotation already exists: ${record.id}`, 'PENDING_ANNOTATION_EXISTS', { id: record.id });
  writeJSONAtomic(file, record);
  upsertIndexEntry(record, env);
  return compactResult(record, 'created');
}

export function listPendingAnnotations(options = {}, env = process.env) {
  const state = options.state || null;
  if (state && !LIFECYCLE_STATES.has(state)) fail(`Unsupported annotation state: ${state}`, 'INVALID_ARG');
  const index = loadIndex(env);
  const annotations = index.annotations.filter((item) => !state || item.state === state);
  return {
    status: 'success',
    schema_version: SCHEMA_VERSION,
    runtime_mode: runtimeMode(env),
    state_root: stateRoot(env),
    pending_annotations_root: pendingRoot(env),
    count: annotations.length,
    annotations,
  };
}

export function readPendingAnnotation(id, env = process.env) {
  return {
    status: 'success',
    schema_version: SCHEMA_VERSION,
    runtime_mode: runtimeMode(env),
    annotation: loadRecord(id, env),
  };
}

export function consumePendingAnnotation(id, options = {}, env = process.env) {
  const record = loadRecord(id, env);
  const status = record.capability?.status || 'blocked';
  if (record.lifecycle.state !== 'pending' || status === 'unsupported' || status === 'ambiguous' || status === 'blocked') {
    fail(`Pending annotation is not consumable: ${id}`, 'PENDING_ANNOTATION_NOT_CONSUMABLE', {
      id,
      state: record.lifecycle.state,
      capability_status: status,
      status: 'not_consumable',
    });
  }
  const now = nowISO();
  const consumed = {
    ...record,
    lifecycle: {
      ...record.lifecycle,
      state: 'consumed',
      updated_at: now,
      consumed_at: now,
      consumed_by: {
        source: text(options.actor, 'agent'),
        session: sessionMetadata(env),
      },
    },
  };
  writeJSONAtomic(recordPath(id, env), consumed);
  upsertIndexEntry(consumed, env);
  return {
    ...compactResult(consumed, 'consumed'),
    consumed_annotation: consumed,
  };
}

export function linkPendingAnnotationWorkRecord(id, input = {}, env = process.env) {
  const record = loadRecord(id, env);
  if (record.lifecycle.state === 'deleted') {
    fail(`Pending annotation is deleted and cannot be linked: ${id}`, 'PENDING_ANNOTATION_NOT_LINKABLE', {
      id,
      state: record.lifecycle.state,
      status: 'not_linkable',
    });
  }
  const now = nowISO();
  const link = {
    ...normalizeWorkRecordLink(input, array(record.work_record_links).length),
    linked_at: now,
    linked_by: {
      source: text(input.actor || input.source, 'agent'),
      session: sessionMetadata(env),
    },
  };
  const linked = {
    ...record,
    lifecycle: {
      ...record.lifecycle,
      updated_at: now,
    },
    work_record_links: [...array(record.work_record_links), link],
  };
  writeJSONAtomic(recordPath(id, env), linked);
  upsertIndexEntry(linked, env);
  return {
    ...compactResult(linked, 'linked'),
    work_record_link: link,
    linked_annotation: linked,
  };
}

export function deletePendingAnnotation(id, env = process.env) {
  const record = loadRecord(id, env);
  if (record.lifecycle.state === 'deleted') {
    fail(`Pending annotation is already deleted: ${id}`, 'PENDING_ANNOTATION_NOT_CONSUMABLE', {
      id,
      state: record.lifecycle.state,
      status: 'not_consumable',
    });
  }
  const now = nowISO();
  const deleted = {
    ...record,
    lifecycle: {
      ...record.lifecycle,
      state: 'deleted',
      updated_at: now,
      deleted_at: now,
    },
  };
  writeJSONAtomic(recordPath(id, env), deleted);
  upsertIndexEntry(deleted, env);
  return compactResult(deleted, 'deleted');
}

export function schemaVersion() {
  return SCHEMA_VERSION;
}
