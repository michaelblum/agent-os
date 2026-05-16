import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export const GATE_RECORD_SCHEMA_VERSION = 'aos.gate.record.v1';

function runtimeMode(env = process.env) {
  const mode = String(env.AOS_RUNTIME_MODE || '').toLowerCase();
  return mode === 'installed' ? 'installed' : 'repo';
}

export function gateRecordPath({ env = process.env, stateRoot = null } = {}) {
  const root = stateRoot || env.AOS_STATE_ROOT || join(homedir(), '.config', 'aos');
  return join(root, runtimeMode(env), 'gate', 'records.jsonl');
}

function publicSource(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
  const output = {};
  for (const key of ['surface', 'session_id', 'agent']) {
    if (source[key] !== undefined) output[key] = source[key];
  }
  return output;
}

function statusFor(resolution, value) {
  if (value && typeof value === 'object' && value.result === null && typeof value.status === 'string') {
    return value.status;
  }
  if (resolution === 'dismissed' || resolution === 'timeout') return resolution;
  return null;
}

function errorFields(error) {
  if (!error) return {};
  return {
    error_code: error.code || 'AOS_GATE_ERROR',
    error_message: error.message || String(error),
  };
}

export function shouldStoreGateResponse(request) {
  return request?.record_response === true || request?.metadata?.record_response === true;
}

export function createGateRecord({
  request,
  receptorName,
  presentedAt = null,
  resolvedAt = new Date(),
  elapsedMs,
  resolution,
  value = null,
  error = null,
}) {
  const responseStored = resolution === 'answered' && shouldStoreGateResponse(request);
  const record = {
    schema_version: GATE_RECORD_SCHEMA_VERSION,
    gate_id: request.id,
    request_schema_version: request.schema_version,
    prompt_title: request.prompt?.title ?? null,
    source: publicSource(request.source),
    receptor: receptorName ?? null,
    ui_variant: request.ui?.variant ?? null,
    field_kinds: Array.isArray(request.fields) ? request.fields.map((field) => field.kind) : [],
    timeout_ms: request.timeout_ms,
    created_at: request.created_at ?? null,
    presented_at: presentedAt ? presentedAt.toISOString() : null,
    resolved_at: resolvedAt.toISOString(),
    elapsed_ms: elapsedMs,
    resolution,
    status: statusFor(resolution, value),
    response_stored: responseStored,
    ...errorFields(error),
  };
  if (responseStored) record.response = value;
  return record;
}

export class GateRecordStore {
  constructor({ path = null, env = process.env, stateRoot = null } = {}) {
    this.path = path || gateRecordPath({ env, stateRoot });
  }

  async append(record) {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(record)}\n`, 'utf8');
  }

  async list({ limit = 20, gateId = null, status = null } = {}) {
    let text = '';
    try {
      text = await readFile(this.path, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    const records = text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const filtered = records.filter((record) => {
      if (gateId && record.gate_id !== gateId) return false;
      if (status && record.resolution !== status && record.status !== status) return false;
      return true;
    });
    if (!Number.isFinite(limit) || limit <= 0) return filtered;
    return filtered.slice(-limit);
  }
}

export function createDefaultGateRecordStore() {
  return new GateRecordStore();
}
