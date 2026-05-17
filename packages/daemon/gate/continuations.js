import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir, userInfo } from 'node:os';
import { execFileSync } from 'node:child_process';
import { normalizeGateRequest } from './index.js';
import { createGateRecord, shouldStoreGateResponse } from './records.js';

export const GATE_CONTINUATION_SCHEMA_VERSION = 'aos.gate.continuation.v1';
export const GATE_RESUME_EVENT_SCHEMA_VERSION = 'aos.gate.resume-event.v1';
export const GATE_CONTINUATIONS_READBACK_SCHEMA_VERSION = 'aos.gate.continuations.readback.v1';
export const GATE_DEFER_CREATE_RESPONSE_SCHEMA_VERSION = 'aos.gate.defer.create-response.v1';
export const GATE_SUBMIT_RESPONSE_SCHEMA_VERSION = 'aos.gate.submit.response.v1';

const TERMINAL_STATES = new Set(['submitted', 'cancelled', 'expired']);

function runtimeMode(env = process.env) {
  const mode = String(env.AOS_RUNTIME_MODE || '').toLowerCase();
  return mode === 'installed' ? 'installed' : 'repo';
}

function stateRoot(env = process.env) {
  return env.AOS_STATE_ROOT || join(homedir(), '.config', 'aos');
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function gateContinuationDir({ env = process.env, root = null } = {}) {
  return join(root || stateRoot(env), runtimeMode(env), 'gate', 'continuations');
}

export function gateResumeEventDir({ env = process.env, root = null } = {}) {
  return join(root || stateRoot(env), runtimeMode(env), 'gate', 'resume-events');
}

export function gateContinuationPath(id, options = {}) {
  return join(gateContinuationDir(options), `${id}.json`);
}

export function gateResumeEventPath(id, options = {}) {
  return join(gateResumeEventDir(options), `${id}.json`);
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(tmp, path);
}

function publicSource(source) {
  if (!isObject(source)) return {};
  const output = {};
  for (const key of ['surface', 'session_id', 'agent']) {
    if (source[key] !== undefined) output[key] = source[key];
  }
  return output;
}

function gitValue(args, { cwd }) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

function defaultSessionMetadata({ sessionId, harness, dock = null, cwd = process.cwd(), env = process.env }) {
  const branch = gitValue(['branch', '--show-current'], { cwd });
  const headSha = gitValue(['rev-parse', 'HEAD'], { cwd });
  const dirtyText = gitValue(['status', '--short'], { cwd });
  return {
    session_id: sessionId,
    harness,
    provider: harness,
    dock: dock || env.AOS_DOCK || env.CODEX_DOCK || null,
    cwd,
    branch,
    head_sha: headSha,
    dirty_summary: dirtyText ? {
      dirty: true,
      line_count: dirtyText.split('\n').filter(Boolean).length,
    } : { dirty: false, line_count: 0 },
  };
}

function redactedAnswerSummary(response) {
  if (!isObject(response)) return { kind: response === null ? 'null' : typeof response };
  if (response.result === null && typeof response.status === 'string') {
    return { kind: 'no_answer', status: response.status };
  }
  return {
    kind: 'object',
    keys: Object.keys(response).sort(),
  };
}

function resolutionFor(response) {
  if (isObject(response) && response.result === null && typeof response.status === 'string') {
    return response.status;
  }
  return 'answered';
}

function submittedBy(value = null) {
  if (isObject(value)) return value;
  let username = null;
  try {
    username = userInfo().username;
  } catch {
    username = null;
  }
  return { role: 'human', user: username || 'local-user' };
}

export class GateContinuationStore {
  constructor({ env = process.env, root = null, recordStore = null } = {}) {
    this.env = env;
    this.root = root;
    this.recordStore = recordStore;
    this.continuationDir = gateContinuationDir({ env, root });
    this.resumeEventDir = gateResumeEventDir({ env, root });
  }

  continuationPath(id) {
    return join(this.continuationDir, `${id}.json`);
  }

  resumeEventPath(id) {
    return join(this.resumeEventDir, `${id}.json`);
  }

  async create({ request, sessionId, harness, dock = null, cwd = process.cwd(), resumePolicy = 'manual', adapterHint = 'codex_exec' } = {}) {
    if (!sessionId) throw new Error('--session-id is required');
    if (!harness) throw new Error('--harness is required');
    const normalized = normalizeGateRequest(request);
    const continuationId = `gate-cont-${randomUUID()}`;
    const now = new Date().toISOString();
    const record = {
      schema_version: GATE_CONTINUATION_SCHEMA_VERSION,
      continuation_id: continuationId,
      gate_id: normalized.id,
      request_schema_version: normalized.schema_version,
      prompt_title: normalized.prompt?.title ?? null,
      source: publicSource(normalized.source),
      session: defaultSessionMetadata({ sessionId, harness, dock, cwd, env: this.env }),
      lifecycle: {
        state: 'pending',
        created_at: now,
        submitted_at: null,
        submitted_by: null,
      },
      storage: {
        continuation_path: this.continuationPath(continuationId),
      },
      response_stored: false,
      resume: {
        mode: 'new_agent_turn',
        policy: resumePolicy,
        adapter_hint: adapterHint,
        event_id: null,
        event_path: null,
      },
    };
    await writeJsonAtomic(this.continuationPath(continuationId), record);
    return record;
  }

  async read(id) {
    return JSON.parse(await readFile(this.continuationPath(id), 'utf8'));
  }

  async list({ id = null, status = null, limit = 50 } = {}) {
    if (id) {
      try {
        const record = await this.read(id);
        if (status && record.lifecycle?.state !== status) return [];
        return [record];
      } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
      }
    }
    let names = [];
    try {
      names = await readdir(this.continuationDir);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    const records = [];
    for (const name of names.filter((entry) => entry.endsWith('.json')).sort()) {
      const record = JSON.parse(await readFile(join(this.continuationDir, name), 'utf8'));
      if (!status || record.lifecycle?.state === status) records.push(record);
    }
    if (!Number.isFinite(limit) || limit <= 0) return records;
    return records.slice(-limit);
  }

  async submit({ continuationId, response, submittedBy: actor = null, storeResponse = false } = {}) {
    const record = await this.read(continuationId);
    if (record.lifecycle?.state === 'submitted') {
      const event = record.resume?.event_path
        ? JSON.parse(await readFile(record.resume.event_path, 'utf8'))
        : null;
      return { record, event, duplicate: true };
    }
    if (TERMINAL_STATES.has(record.lifecycle?.state)) {
      throw new Error(`continuation ${continuationId} is ${record.lifecycle.state} and cannot be submitted`);
    }

    const now = new Date().toISOString();
    const eventId = `gate-resume-${randomUUID()}`;
    const eventPath = this.resumeEventPath(eventId);
    const responseStored = storeResponse === true;
    const resolution = resolutionFor(response);
    const event = {
      schema_version: GATE_RESUME_EVENT_SCHEMA_VERSION,
      event_id: eventId,
      continuation_id: record.continuation_id,
      gate_id: record.gate_id,
      session_id: record.session.session_id,
      harness: record.session.harness,
      provider: record.session.provider ?? record.session.harness,
      authored_by: submittedBy(actor),
      authored_role: 'human',
      created_at: now,
      resolution,
      status: resolution === 'answered' ? null : resolution,
      answer_summary: redactedAnswerSummary(response),
      response_stored: responseStored,
      adapter: {
        hint: record.resume.adapter_hint,
        suggested_command: record.resume.adapter_hint === 'codex_exec'
          ? 'codex exec <human-authored-resume-message>'
          : null,
      },
    };
    if (responseStored) event.response = response;

    const nextRecord = {
      ...record,
      lifecycle: {
        ...record.lifecycle,
        state: 'submitted',
        submitted_at: now,
        submitted_by: event.authored_by,
      },
      response_stored: responseStored,
      resume: {
        ...record.resume,
        event_id: eventId,
        event_path: eventPath,
      },
    };
    if (responseStored) nextRecord.response = response;

    await writeJsonAtomic(eventPath, event);
    await writeJsonAtomic(this.continuationPath(continuationId), nextRecord);

    if (this.recordStore) {
      await this.recordStore.append(createGateRecord({
        request: {
          schema_version: record.request_schema_version,
          id: record.gate_id,
          prompt: { title: record.prompt_title },
          source: record.source,
          fields: [],
          timeout_ms: 0,
          metadata: { record_response: responseStored },
        },
        receptorName: 'DeferredGateContinuation',
        presentedAt: null,
        resolvedAt: new Date(now),
        elapsedMs: 0,
        resolution,
        value: response,
      }));
    }

    return { record: nextRecord, event, duplicate: false };
  }

  async markTerminal(id, state) {
    if (!['cancelled', 'expired'].includes(state)) throw new Error(`unsupported terminal state: ${state}`);
    const record = await this.read(id);
    if (TERMINAL_STATES.has(record.lifecycle?.state)) return record;
    const nextRecord = {
      ...record,
      lifecycle: {
        ...record.lifecycle,
        state,
        [`${state}_at`]: new Date().toISOString(),
      },
    };
    await writeJsonAtomic(this.continuationPath(id), nextRecord);
    return nextRecord;
  }
}

export function createDeferResponse(record) {
  return {
    schema_version: GATE_DEFER_CREATE_RESPONSE_SCHEMA_VERSION,
    continuation_id: record.continuation_id,
    gate_id: record.gate_id,
    state: record.lifecycle.state,
    path: record.storage?.continuation_path ?? gateContinuationPath(record.continuation_id),
    storage: record.storage,
    session: record.session,
    resume: record.resume,
    next_action: {
      human: 'Submit a response later with aos gate submit --continuation-id <id> --request submission.json --json.',
      adapter: 'Read the resume event after submit and route it to the provider-specific resume backend.',
    },
  };
}

export function createSubmitResponse(result) {
  return {
    schema_version: GATE_SUBMIT_RESPONSE_SCHEMA_VERSION,
    continuation_id: result.record.continuation_id,
    gate_id: result.record.gate_id,
    state: result.record.lifecycle.state,
    duplicate: result.duplicate,
    resume_event: result.event,
  };
}

export function shouldStoreContinuationResponse(request, cliStoreResponse = false) {
  return cliStoreResponse || shouldStoreGateResponse(request);
}
