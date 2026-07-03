import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeAnnotationAnchor } from './annotation-session.js';
import {
  normalizeUserSignalRedaction,
  runtimeMode,
  stateRoot,
  runtimeStatePath,
  writeJsonAtomic,
} from '../../../shared/user-signal/service-policy.mjs';

export const GUIDED_USER_SIGNAL_SESSION_SCHEMA_VERSION = 'aos.guided-user-signal.session.v1';
export const GUIDED_USER_SIGNAL_STORE_READBACK_SCHEMA_VERSION = 'aos.guided-user-signal.sessions.readback.v1';

export const GUIDED_USER_SIGNAL_CAPTURE_KINDS = new Set(['click', 'point', 'region', 'annotation']);
export const GUIDED_USER_SIGNAL_GUIDANCE_KINDS = new Set(['callout', 'highlight', 'arrow', 'label', 'overlay']);
export const GUIDED_USER_SIGNAL_TERMINAL_STATES = new Set([
  'captured',
  'gate_submitted',
  'dismissed',
  'cancelled',
  'expired',
  'error',
]);
const INPUT_AUTHORITY_PRIMITIVES = new Set(['input_region', 'native_input_stream', 'daemon_native_full_screen_input_capture']);
const INPUT_AUTHORITY_SCOPES = new Set(['point', 'region', 'display', 'desktop']);

const SESSION_ID_RE = /^guided-signal-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function isoNow(now = Date.now()) {
  if (typeof now === 'string') return now;
  const date = now instanceof Date ? now : new Date(now);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function normalizeRect(rect = null) {
  if (!rect || typeof rect !== 'object') return null;
  const x = Number(rect.x ?? rect.left);
  const y = Number(rect.y ?? rect.top);
  const width = Number(rect.width ?? rect.w);
  const height = Number(rect.height ?? rect.h);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  return { x, y, width, height };
}

function normalizePoint(point = null) {
  if (!point || typeof point !== 'object') return null;
  const x = Number(point.x);
  const y = Number(point.y);
  if (![x, y].every(Number.isFinite)) return null;
  return { x, y };
}

function normalizeSourceOperation(source = {}) {
  const input = object(source);
  return {
    operation_id: text(input.operation_id || input.id, 'unknown-operation'),
    operation_kind: text(input.operation_kind || input.kind, 'unknown'),
    session_id: text(input.session_id),
    harness: text(input.harness || input.provider),
    agent: text(input.agent),
  };
}

function normalizeSubject(subject = {}) {
  const input = object(subject);
  return {
    reference: text(input.reference || input.subject_ref || input.address, 'subject:unknown'),
    kind: text(input.kind || input.subject_kind, 'unknown'),
    surface: {
      id: text(input.surface?.id || input.surface_id || input.canvas_id || input.display_id, 'unknown-surface'),
      kind: text(input.surface?.kind || input.surface_kind || input.surface_type, 'surface'),
      runtime_mode: text(input.surface?.runtime_mode || input.runtime_mode),
    },
    source_identity: {
      canvas_id: text(input.canvas_id || input.source_identity?.canvas_id),
      display_id: text(input.display_id || input.source_identity?.display_id),
      window_id: text(input.window_id || input.source_identity?.window_id),
      url: text(input.url || input.source_url || input.source_identity?.url),
      path: text(input.path || input.source_path || input.source_identity?.path),
    },
    projection: clone(input.projection || null),
  };
}

function normalizeGuidanceItem(item = {}, index = 0) {
  const input = object(item);
  const kind = GUIDED_USER_SIGNAL_GUIDANCE_KINDS.has(input.kind) ? input.kind : 'callout';
  return {
    id: text(input.id, `guidance-${index + 1}`),
    kind,
    text: text(input.text || input.label),
    target_ref: text(input.target_ref || input.subject_ref || input.address),
    rect: normalizeRect(input.rect || input.bounds),
    point: normalizePoint(input.point),
    style: clone(input.style || {}),
    overlay: clone(input.overlay || {}),
  };
}

function normalizeCaptureRequest(request = {}, redaction = normalizeRedaction()) {
  const input = object(request);
  const kind = GUIDED_USER_SIGNAL_CAPTURE_KINDS.has(input.kind) ? input.kind : 'click';
  const primitive = text(input.input_authority?.primitive || input.primitive, 'input_region');
  const scope = text(input.input_authority?.scope || input.scope, kind === 'region' ? 'region' : 'point');
  return {
    kind,
    prompt: redaction.prompt_bodies === 'store' ? text(input.prompt) : '',
    required: input.required !== false,
    coordinate_space: text(input.coordinate_space, 'native_display'),
    input_authority: {
      owner: 'daemon',
      primitive: INPUT_AUTHORITY_PRIMITIVES.has(primitive) ? primitive : 'input_region',
      scope: INPUT_AUTHORITY_SCOPES.has(scope) ? scope : (kind === 'region' ? 'region' : 'point'),
      future_full_screen_primitive: text(
        input.input_authority?.future_full_screen_primitive,
        'daemon_native_full_screen_input_capture',
      ),
    },
  };
}

function normalizeCaptureResult(result = null, redaction = normalizeRedaction()) {
  if (!result) return null;
  const input = object(result);
  const kind = GUIDED_USER_SIGNAL_CAPTURE_KINDS.has(input.kind) ? input.kind : 'click';
  const annotation = input.annotation ? normalizeAnnotationAnchor(input.annotation) : null;
  if (annotation && redaction.free_text_answers !== 'store') {
    annotation.comment_text = '';
  }
  const output = {
    kind,
    captured_at: isoNow(input.captured_at || input.updated_at || Date.now()),
    point: normalizePoint(input.point || input.native),
    region: normalizeRect(input.region || input.rect || input.bounds),
    input_event: clone(input.input_event || null),
    annotation,
    free_text: redaction.free_text_answers === 'store' ? text(input.free_text || input.note) : '',
  };
  return output;
}

function normalizeLinks(links = {}) {
  const input = object(links);
  return {
    gate_record_id: text(input.gate_record_id || input.gate_id),
    continuation_id: text(input.continuation_id),
    resume_event_id: text(input.resume_event_id || input.event_id),
    resume_event_path: text(input.resume_event_path || input.event_path),
  };
}

function normalizeRedaction(redaction = {}) {
  return normalizeUserSignalRedaction(redaction);
}

function storageFor(sessionId, { env = process.env, root = null } = {}) {
  const mode = runtimeMode(env);
  return {
    runtime_mode: mode,
    state_root: root || stateRoot(env),
    session_path: runtimeStatePath(['guided-user-signal', 'sessions', `${sessionId}.json`], { env, root }),
  };
}

export function guidedUserSignalSessionDir({ env = process.env, root = null } = {}) {
  return runtimeStatePath(['guided-user-signal', 'sessions'], { env, root });
}

export function assertGuidedUserSignalSessionId(id) {
  if (typeof id !== 'string' || !SESSION_ID_RE.test(id)) {
    throw new Error(`invalid guided user signal session id: ${id}`);
  }
}

export function createGuidedUserSignalSession(input = {}, options = {}) {
  const now = isoNow(options.now || Date.now());
  const createdAt = isoNow(input.lifecycle?.created_at || input.created_at || now);
  const sessionId = text(input.session_id, `guided-signal-${randomUUID()}`);
  assertGuidedUserSignalSessionId(sessionId);
  const state = GUIDED_USER_SIGNAL_TERMINAL_STATES.has(input.lifecycle?.state)
    ? input.lifecycle.state
    : 'pending';
  const redaction = normalizeRedaction(input.redaction);
  return {
    schema_version: GUIDED_USER_SIGNAL_SESSION_SCHEMA_VERSION,
    session_id: sessionId,
    source_operation: normalizeSourceOperation(input.source_operation || input.operation || input.source),
    subject: normalizeSubject(input.subject),
    guidance: (Array.isArray(input.guidance) ? input.guidance : []).map(normalizeGuidanceItem),
    capture_request: normalizeCaptureRequest(input.capture_request || input.capture, redaction),
    capture_result: normalizeCaptureResult(input.capture_result || input.result, redaction),
    linked_artifacts: normalizeLinks(input.linked_artifacts || input.links),
    lifecycle: {
      state,
      created_at: createdAt,
      updated_at: isoNow(input.lifecycle?.updated_at || input.updated_at || now),
      terminal_at: input.lifecycle?.terminal_at || (GUIDED_USER_SIGNAL_TERMINAL_STATES.has(state) ? now : null),
      terminal_outcome: input.lifecycle?.terminal_outcome || (GUIDED_USER_SIGNAL_TERMINAL_STATES.has(state) ? state : null),
    },
    redaction,
    storage: storageFor(sessionId, options),
  };
}

export function completeGuidedUserSignalSession(session = {}, terminal = {}, options = {}) {
  const current = normalizeGuidedUserSignalSession(session, options);
  if (GUIDED_USER_SIGNAL_TERMINAL_STATES.has(current.lifecycle.state)) {
    return { session: current, duplicate: true };
  }
  const state = GUIDED_USER_SIGNAL_TERMINAL_STATES.has(terminal.state) ? terminal.state : 'captured';
  const now = isoNow(options.now || terminal.terminal_at || Date.now());
  return {
    session: normalizeGuidedUserSignalSession({
      ...current,
      capture_result: terminal.capture_result ?? current.capture_result,
      linked_artifacts: { ...current.linked_artifacts, ...object(terminal.linked_artifacts || terminal.links) },
      lifecycle: {
        ...current.lifecycle,
        state,
        updated_at: now,
        terminal_at: now,
        terminal_outcome: text(terminal.terminal_outcome, state),
      },
    }, options),
    duplicate: false,
  };
}

export function normalizeGuidedUserSignalSession(input = {}, options = {}) {
  return createGuidedUserSignalSession(input, options);
}

export function buildGuidedUserSignalShellPlan(session = {}, options = {}) {
  const record = normalizeGuidedUserSignalSession(session, options);
  const guidance = record.guidance.map((item) => ({
    id: item.id,
    kind: item.kind,
    text: item.text,
    target_ref: item.target_ref || record.subject.reference,
    rect: item.rect,
    point: item.point,
    style: item.style,
    overlay: item.overlay,
  }));
  return {
    schema: 'aos_guided_user_signal_shell_plan',
    version: '0.1.0',
    session_id: record.session_id,
    subject: record.subject,
    guidance,
    capture_request: record.capture_request,
    input_boundary: {
      toolkit_policy: 'render_guidance_and_collect_one_response',
      authoritative_input_owner: record.capture_request.input_authority.owner,
      daemon_primitive: record.capture_request.input_authority.primitive,
      full_screen_capture_extension: record.capture_request.input_authority.future_full_screen_primitive,
    },
    gate: record.linked_artifacts.continuation_id
      ? { submit_helper: 'submitGateContinuation', continuation_id: record.linked_artifacts.continuation_id }
      : null,
  };
}

export class GuidedUserSignalSessionStore {
  constructor({ env = process.env, root = null } = {}) {
    this.env = env;
    this.root = root;
    this.dir = guidedUserSignalSessionDir({ env, root });
  }

  sessionPath(id) {
    assertGuidedUserSignalSessionId(id);
    return join(this.dir, `${id}.json`);
  }

  async create(input = {}, options = {}) {
    const record = createGuidedUserSignalSession(input, { ...options, env: this.env, root: this.root });
    await writeJsonAtomic(this.sessionPath(record.session_id), record);
    return record;
  }

  async read(id) {
    assertGuidedUserSignalSessionId(id);
    return JSON.parse(await readFile(this.sessionPath(id), 'utf8'));
  }

  async complete(id, terminal = {}, options = {}) {
    const existing = await this.read(id);
    const result = completeGuidedUserSignalSession(existing, terminal, { ...options, env: this.env, root: this.root });
    if (!result.duplicate) await writeJsonAtomic(this.sessionPath(id), result.session);
    return result;
  }
}
