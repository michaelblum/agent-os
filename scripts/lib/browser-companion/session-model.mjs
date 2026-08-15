import {
  isBoundedPackageEntrypoint,
  isBoundedPackageVersion,
} from './package-version.mjs';

const SESSION_SCHEMA = 'aos.browser.companion-session.v1';
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
const GENERATION = /^[a-f0-9]{32}$/u;
const UPSTREAM_ID = /^aos-[a-f0-9]{32}$/u;
const VERSION_KEY = /^[0-9A-Za-z.-]+-[a-f0-9]{64}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const ISO_TIME = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T.*Z$/u;
const OPERATION_NONCE = /^[a-f0-9]{32}$/u;
const SESSION_OPERATIONS = Object.freeze([
  'navigate', 'type', 'key', 'scroll', 'snapshot', 'screenshot',
  'page_identity', 'evidence_capture', 'liveness', 'cleanup',
]);
const SESSION_KEYS = [
  'schema_version', 'session_id', 'generation', 'upstream_session_id', 'state',
  'ownership', 'attach_kind', 'headless', 'persistent', 'version_key', 'version',
  'descriptor_sha256', 'closure_sha256', 'entrypoint', 'workspace',
    'cleanup_operation', 'pending_operation', 'operation_nonce',
    'created_at', 'updated_at',
];

export const SESSION_STATES = Object.freeze([
  'starting', 'active', 'operating', 'operation_committed',
  'cleanup_required', 'closing', 'cleanup_committed', 'closed',
]);

export class ManagedSessionError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'ManagedSessionError';
    this.code = code;
  }
}

export function sessionFail(code, message) {
  throw new ManagedSessionError(code, message);
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

export function validateSessionId(value) {
  if (!SESSION_ID.test(String(value ?? ''))) sessionFail('BROWSER_SESSION_INVALID', 'session id is invalid');
  return String(value);
}

export function validateSessionRecord(value, filename = null) {
  if (!exactKeys(value, SESSION_KEYS)) sessionFail('COMPANION_STORE_CORRUPT', 'managed session shape differs');
  if (
    value.schema_version !== SESSION_SCHEMA
    || !SESSION_ID.test(value.session_id ?? '')
    || (filename !== null && filename !== `${value.session_id}.json`)
    || !GENERATION.test(value.generation ?? '')
    || !UPSTREAM_ID.test(value.upstream_session_id ?? '')
    || !SESSION_STATES.includes(value.state)
    || !['launched', 'attached'].includes(value.ownership)
    || ![null, 'cdp', 'extension'].includes(value.attach_kind)
    || !VERSION_KEY.test(value.version_key ?? '')
    || !isBoundedPackageVersion(value.version)
    || !SHA256.test(value.descriptor_sha256 ?? '')
    || value.version_key !== `${value.version}-${value.descriptor_sha256}`
    || !SHA256.test(value.closure_sha256 ?? '')
    || !isBoundedPackageEntrypoint(value.entrypoint)
    || value.workspace !== `${value.session_id}-${value.generation}`
    || ![null, 'close', 'detach'].includes(value.cleanup_operation)
    || ![null, ...SESSION_OPERATIONS].includes(value.pending_operation)
    || !(value.operation_nonce === null || OPERATION_NONCE.test(value.operation_nonce ?? ''))
    || !ISO_TIME.test(value.created_at ?? '') || !ISO_TIME.test(value.updated_at ?? '')
  ) sessionFail('COMPANION_STORE_CORRUPT', 'managed session identity differs');
  if (value.ownership === 'launched') {
    if (value.attach_kind !== null || typeof value.headless !== 'boolean' || typeof value.persistent !== 'boolean' || value.cleanup_operation !== 'close') {
      sessionFail('COMPANION_STORE_CORRUPT', 'launched session ownership differs');
    }
  } else if (!['cdp', 'extension'].includes(value.attach_kind) || value.headless !== null || value.persistent !== false || value.cleanup_operation !== 'detach') {
    sessionFail('COMPANION_STORE_CORRUPT', 'attached session ownership differs');
  }
  const operationState = ['operating', 'operation_committed'].includes(value.state);
  const cleanupState = ['closing', 'cleanup_committed'].includes(value.state);
  if (operationState && (!SESSION_OPERATIONS.slice(0, -1).includes(value.pending_operation) || !value.operation_nonce)) {
    sessionFail('COMPANION_STORE_CORRUPT', 'managed session operation intent differs');
  }
  if (cleanupState && (value.pending_operation !== 'cleanup' || !value.operation_nonce)) {
    sessionFail('COMPANION_STORE_CORRUPT', 'managed session cleanup intent differs');
  }
  if (!operationState && !cleanupState && (value.pending_operation !== null || value.operation_nonce !== null)) {
    sessionFail('COMPANION_STORE_CORRUPT', 'managed session has unexpected operation intent');
  }
  return Object.freeze(value);
}

export function backendIdentity(record) {
  const session = validateSessionRecord(record);
  return Object.freeze({
    schema_version: 'aos.browser-backend-identity.v2',
    adapter: '@playwright/cli',
    version: session.version,
    descriptor_sha256: session.descriptor_sha256,
    closure_sha256: session.closure_sha256,
    entrypoint: session.entrypoint,
    session_generation: session.generation,
  });
}

export function publicSession(record) {
  const session = validateSessionRecord(record);
  const state = session.state === 'operating'
    ? 'cleanup_required'
    : session.state === 'operation_committed'
      ? 'active'
      : session.state === 'cleanup_committed'
        ? 'closed'
        : session.state;
  return Object.freeze({
    id: session.session_id,
    generation: session.generation,
    state,
    ownership: session.ownership,
    attach_kind: session.attach_kind,
    headless: session.headless,
    persistent: session.persistent,
    updated_at: session.updated_at,
  });
}

export function sessionErrorReceipt(error, operation) {
  const known = new Set([
    'BROWSER_SESSION_INVALID', 'BROWSER_SESSION_NOT_FOUND', 'BROWSER_SESSION_EXISTS',
    'BROWSER_SESSION_LIMIT', 'BROWSER_SESSION_EXTENSION_UNAVAILABLE',
    'BROWSER_SESSION_EXTENSION_BLOCKED',
    'BROWSER_SESSION_NOT_ACTIVE', 'BROWSER_SESSION_CLEANUP_REQUIRED',
    'BROWSER_SESSION_MIGRATION_REQUIRED', 'BROWSER_SESSION_OPERATION_UNSUPPORTED',
    'BROWSER_SESSION_WORKER_FAILED', 'BROWSER_SESSION_WORKER_TIMEOUT',
    'BROWSER_SESSION_OUTPUT_INVALID', 'BROWSER_SESSION_OUTPUT_LIMIT',
    'COMPANION_STORE_BLOCKED', 'COMPANION_STORE_CORRUPT', 'COMPANION_STORE_BUSY',
    'COMPANION_UPDATE_REQUIRED',
  ]);
  const code = known.has(error?.code) ? error.code : 'BROWSER_SESSION_INTERNAL';
  const messages = {
    BROWSER_SESSION_INVALID: 'Browser session arguments are invalid.',
    BROWSER_SESSION_NOT_FOUND: 'The managed browser session was not found.',
    BROWSER_SESSION_EXISTS: 'The managed browser session already exists.',
    BROWSER_SESSION_LIMIT: 'The managed browser session limit has been reached.',
    BROWSER_SESSION_EXTENSION_UNAVAILABLE: 'The Playwright Extension is unavailable in system Chrome.',
    BROWSER_SESSION_EXTENSION_BLOCKED: 'The system Chrome extension profile is blocked.',
    BROWSER_SESSION_NOT_ACTIVE: 'The managed browser session is not active.',
    BROWSER_SESSION_CLEANUP_REQUIRED: 'The managed browser session requires cleanup.',
    BROWSER_SESSION_MIGRATION_REQUIRED: 'Legacy browser session state must be retired manually.',
    BROWSER_SESSION_OPERATION_UNSUPPORTED: 'The browser session operation is unsupported.',
    BROWSER_SESSION_WORKER_FAILED: 'The managed browser worker operation failed.',
    BROWSER_SESSION_WORKER_TIMEOUT: 'The managed browser worker operation timed out.',
    BROWSER_SESSION_OUTPUT_INVALID: 'The managed browser worker returned invalid output.',
    BROWSER_SESSION_OUTPUT_LIMIT: 'The managed browser worker output exceeded its limit.',
    COMPANION_STORE_BLOCKED: 'The browser companion store is blocked.',
    COMPANION_STORE_CORRUPT: 'The browser companion store is corrupt.',
    COMPANION_STORE_BUSY: 'The browser companion store is busy.',
    COMPANION_UPDATE_REQUIRED: 'The installed browser companion requires update.',
    BROWSER_SESSION_INTERNAL: 'The managed browser session operation failed.',
  };
  return Object.freeze({
    schema_version: 'aos.browser.session.error.v1',
    operation,
    status: 'error',
    code,
    error: messages[code],
  });
}

export { SESSION_OPERATIONS, SESSION_SCHEMA };
