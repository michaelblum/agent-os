import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  isBoundedPackageEntrypoint,
  isBoundedPackageVersion,
} from './browser-companion/package-version.mjs';

const SESSION_PATTERN = /^[A-Za-z0-9_-]+$/;
const PLAYWRIGHT_REF_PATTERN = /^(?:f\d+)?e\d+$/;
const STATE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const NEAR_PATTERN = /^-?[0-9]+(?:\.[0-9]+)?,-?[0-9]+(?:\.[0-9]+)?$/;
const MAX_REFS_PER_GENERATION = 20_000;
export const NATIVE_AX_LOCATOR_MAX_DEPTH = 128;
export const NATIVE_AX_LOCATOR_MAX_TIMEOUT_MS = 30_000;
const BACKEND_IDENTITY_KEYS = [
  'schema_version', 'adapter', 'version', 'descriptor_sha256',
  'closure_sha256', 'entrypoint', 'session_generation',
];
const NATIVE_QUERY_KEYS = new Set([
  'pid', 'window_id', 'role', 'title', 'label', 'identifier',
  'index', 'near', 'match', 'depth', 'timeout_ms',
]);

export class TargetHandleError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'TargetHandleError';
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return { code: this.code, error: this.message, ...this.details };
  }
}

function runtimeMode(env) {
  return env.AOS_RUNTIME_MODE?.toLowerCase() === 'installed' ? 'installed' : 'repo';
}

function stateRoot(env) {
  return path.resolve(env.AOS_STATE_ROOT || path.join(os.homedir(), '.config/aos'));
}

function validateSession(session) {
  if (!SESSION_PATTERN.test(String(session ?? ''))) {
    throw new TargetHandleError('TARGET_HANDLE_INVALID', 'browser Observation Ref session is invalid');
  }
  return String(session);
}

function validateStateID(stateID) {
  if (!STATE_PATTERN.test(String(stateID ?? ''))) {
    throw new TargetHandleError('TARGET_HANDLE_INVALID', 'browser Observation Ref state_id is invalid');
  }
  return String(stateID);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function validOptionalString(query, key, { allowEmpty = false } = {}) {
  return !Object.hasOwn(query, key)
    || (typeof query[key] === 'string' && (allowEmpty || query[key].length > 0));
}

function validateBrowserBackendIdentity(identity) {
  const validHash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (
    !isPlainObject(identity)
    || !hasExactKeys(identity, BACKEND_IDENTITY_KEYS)
    || identity.schema_version !== 'aos.browser-backend-identity.v2'
    || identity.adapter !== '@playwright/cli'
    || !isBoundedPackageVersion(identity.version)
    || !validHash(identity.descriptor_sha256)
    || !validHash(identity.closure_sha256)
    || !isBoundedPackageEntrypoint(identity.entrypoint)
    || !/^[a-f0-9]{32}$/.test(identity.session_generation ?? '')
  ) {
    throw new TargetHandleError('TARGET_ACTION_UNSUPPORTED', 'browser Observation Ref backend identity is not independently verified');
  }
  return identity;
}

export function sameBrowserBackendIdentity(left, right) {
  return BACKEND_IDENTITY_KEYS.every((key) => left[key] === right[key]);
}

export function validatePlaywrightRef(ref) {
  if (!PLAYWRIGHT_REF_PATTERN.test(String(ref ?? ''))) {
    throw new TargetHandleError('TARGET_HANDLE_INVALID', 'browser Observation Ref ref is invalid');
  }
  return String(ref);
}

function generationPath(session, env) {
  const safeSession = validateSession(session);
  return path.join(stateRoot(env), runtimeMode(env), 'target-handles', 'browser', `${safeSession}.json`);
}

function atomicWriteJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function browserObservationHandle(session, stateID, ref) {
  return {
    kind: 'observation_ref',
    backend: 'browser',
    state_id: validateStateID(stateID),
    scope: { session: validateSession(session) },
    ref: validatePlaywrightRef(ref),
  };
}

export function canvasLocatorHandle(canvasID, ref) {
  if (!canvasID || !ref) throw new TargetHandleError('TARGET_HANDLE_INVALID', 'canvas Locator requires canvas_id and ref');
  return validateTargetHandle({
    kind: 'locator',
    backend: 'aos_canvas',
    query: { canvas_id: String(canvasID), ref: String(ref) },
  });
}

export function nativeAXLocatorHandle(query) {
  if (!Number.isInteger(Number(query?.pid)) || Number(query.pid) <= 0) {
    throw new TargetHandleError('TARGET_HANDLE_INVALID', 'native AX Locator requires a positive pid');
  }
  if (typeof query?.role !== 'string' || query.role.length === 0) {
    throw new TargetHandleError('TARGET_HANDLE_INVALID', 'native AX Locator requires a role');
  }
  const normalized = Object.fromEntries(Object.entries(query).filter(([, value]) => value !== null && value !== undefined && value !== ''));
  normalized.pid = Number(normalized.pid);
  return validateTargetHandle({ kind: 'locator', backend: 'native_ax', query: normalized });
}

export function validateTargetHandle(handle) {
  if (!isPlainObject(handle)) {
    throw new TargetHandleError('TARGET_HANDLE_INVALID', 'target handle must be an object');
  }
  if (handle.kind === 'observation_ref') {
    if (
      handle.backend !== 'browser'
      || !hasExactKeys(handle, ['kind', 'backend', 'state_id', 'scope', 'ref'])
      || !isPlainObject(handle.scope)
      || !hasExactKeys(handle.scope, ['session'])
    ) {
      throw new TargetHandleError('TARGET_HANDLE_INVALID', 'browser Observation Ref has an invalid shape');
    }
    validateStateID(handle.state_id);
    validateSession(handle.scope.session);
    validatePlaywrightRef(handle.ref);
    return handle;
  }
  if (handle.kind !== 'locator' || !hasExactKeys(handle, ['kind', 'backend', 'query']) || !isPlainObject(handle.query)) {
    throw new TargetHandleError('TARGET_HANDLE_INVALID', 'Locator has an invalid shape');
  }
  const query = handle.query;
  if (handle.backend === 'aos_canvas') {
    if (
      !hasExactKeys(query, ['canvas_id', 'ref'])
      || typeof query.canvas_id !== 'string' || query.canvas_id.length === 0
      || typeof query.ref !== 'string' || query.ref.length === 0
    ) {
      throw new TargetHandleError('TARGET_HANDLE_INVALID', 'canvas Locator query is invalid');
    }
    return handle;
  }
  if (handle.backend !== 'native_ax' || Object.keys(query).some((key) => !NATIVE_QUERY_KEYS.has(key))) {
    throw new TargetHandleError('TARGET_HANDLE_INVALID', 'native AX Locator query has an invalid shape');
  }
  if (
    !Number.isInteger(query.pid) || query.pid <= 0
    || typeof query.role !== 'string' || query.role.length === 0
    || (Object.hasOwn(query, 'window_id') && (!Number.isInteger(query.window_id) || query.window_id <= 0))
    || !validOptionalString(query, 'title')
    || !validOptionalString(query, 'label')
    || !validOptionalString(query, 'identifier')
    || (Object.hasOwn(query, 'index') && (!Number.isInteger(query.index) || query.index < 0 || query.index >= 1024))
    || (Object.hasOwn(query, 'near') && (typeof query.near !== 'string' || !NEAR_PATTERN.test(query.near)))
    || (Object.hasOwn(query, 'match') && !['exact', 'contains', 'regex'].includes(query.match))
    || (Object.hasOwn(query, 'depth') && (
      !Number.isInteger(query.depth) || query.depth < 0 || query.depth > NATIVE_AX_LOCATOR_MAX_DEPTH
    ))
    || (Object.hasOwn(query, 'timeout_ms') && (
      !Number.isInteger(query.timeout_ms)
      || query.timeout_ms <= 0
      || query.timeout_ms > NATIVE_AX_LOCATOR_MAX_TIMEOUT_MS
    ))
    || (Object.hasOwn(query, 'index') && Object.hasOwn(query, 'near'))
  ) {
    throw new TargetHandleError('TARGET_HANDLE_INVALID', 'native AX Locator query is invalid');
  }
  return handle;
}

export function recordBrowserCaptureGeneration(session, capture, env = process.env, backendIdentity = null) {
  const safeSession = validateSession(session);
  const stateID = validateStateID(capture?.state_id);
  const verifiedBackendIdentity = validateBrowserBackendIdentity(backendIdentity);
  const current = readBrowserCaptureGeneration(safeSession, env);
  if (current?.state_id === stateID) {
    throw new TargetHandleError('TARGET_HANDLE_INVALID', 'browser capture repeated the current state_id; generation was not replaced', {
      state_id: stateID,
      session: safeSession,
    });
  }
  const refs = [];
  const seen = new Set();
  for (const element of capture?.elements ?? []) {
    if (!element?.ref) continue;
    const ref = validatePlaywrightRef(element.ref);
    if (seen.has(ref)) {
      throw new TargetHandleError('TARGET_HANDLE_INVALID', `browser capture contains duplicate ref '${ref}'`, { state_id: stateID });
    }
    seen.add(ref);
    refs.push(ref);
    if (refs.length > MAX_REFS_PER_GENERATION) {
      throw new TargetHandleError('TARGET_HANDLE_INVALID', 'browser capture exceeds the bounded Observation Ref limit', {
        limit: MAX_REFS_PER_GENERATION,
      });
    }
  }
  atomicWriteJSON(generationPath(safeSession, env), {
    schema_version: 'aos.browser-observation-generation.v1',
    session: safeSession,
    state_id: stateID,
    backend_identity: verifiedBackendIdentity,
    refs,
  });
  return { state_id: stateID, refs };
}

export function readBrowserCaptureGeneration(session, env = process.env) {
  const file = generationPath(session, env);
  let value;
  try {
    value = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new TargetHandleError('TARGET_HANDLE_INVALID', 'browser Observation Ref generation is unreadable');
  }
  if (
    value?.schema_version !== 'aos.browser-observation-generation.v1'
    || value.session !== session
    || !STATE_PATTERN.test(String(value.state_id ?? ''))
    || !isPlainObject(value.backend_identity)
    || !Array.isArray(value.refs)
    || value.refs.length > MAX_REFS_PER_GENERATION
    || value.refs.some((ref) => !PLAYWRIGHT_REF_PATTERN.test(String(ref)))
    || new Set(value.refs).size !== value.refs.length
  ) {
    throw new TargetHandleError('TARGET_HANDLE_INVALID', 'browser Observation Ref generation is invalid');
  }
  validateBrowserBackendIdentity(value.backend_identity);
  return value;
}

export function validateBrowserObservationRef(handle, env = process.env, backendIdentity = null) {
  validateTargetHandle(handle);
  if (handle.kind !== 'observation_ref' || handle.backend !== 'browser') {
    throw new TargetHandleError('TARGET_HANDLE_INVALID', 'expected a browser Observation Ref handle');
  }
  const session = validateSession(handle?.scope?.session);
  const stateID = validateStateID(handle.state_id);
  const ref = validatePlaywrightRef(handle.ref);
  const verifiedBackendIdentity = validateBrowserBackendIdentity(backendIdentity);
  const current = readBrowserCaptureGeneration(session, env);
  if (!current || current.state_id !== stateID) {
    throw new TargetHandleError('TARGET_STATE_STALE', 'browser Observation Ref state_id is not the current capture generation', {
      state_id: stateID,
      current_state_id: current?.state_id ?? null,
      session,
    });
  }
  if (!sameBrowserBackendIdentity(current.backend_identity, verifiedBackendIdentity)) {
    throw new TargetHandleError('TARGET_STATE_STALE', 'browser Observation Ref backend identity no longer matches its capture generation', {
      state_id: stateID,
      session,
      reason: 'backend_identity_changed',
    });
  }
  if (!current.refs.includes(ref)) {
    throw new TargetHandleError('TARGET_HANDLE_INVALID', 'browser Observation Ref is not part of its capture generation', {
      state_id: stateID,
      session,
      ref,
    });
  }
  return { session, state_id: stateID, ref };
}

export function validateDirectBrowserRef(session, ref, stateID, env = process.env, backendIdentity = null) {
  if (!stateID) throw new TargetHandleError('TARGET_STATE_REQUIRED', 'browser Observation Ref actions require --state-id');
  return validateBrowserObservationRef(browserObservationHandle(session, stateID, ref), env, backendIdentity);
}

export function emitTargetHandleError(error) {
  const value = error instanceof TargetHandleError
    ? error.toJSON()
    : { code: 'TARGET_HANDLE_INVALID', error: error instanceof Error ? error.message : String(error) };
  process.stderr.write(`${JSON.stringify(value)}\n`);
}
