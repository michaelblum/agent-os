import { sessionFail } from './session-model.mjs';

function objectWithKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function boundedFile(value) {
  return typeof value === 'string' && Buffer.byteLength(value) > 0 && Buffer.byteLength(value) <= 4096;
}

function nullableText(value, maximum = 4096) {
  return value === null || (typeof value === 'string' && Buffer.byteLength(value) <= maximum);
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
}

function snapshotResult(value) {
  return objectWithKeys(value, ['snapshot']) && objectWithKeys(value.snapshot, ['file'])
    && boundedFile(value.snapshot.file);
}

export function validateStartEnvelope(value, session, input) {
  const attached = session.ownership === 'attached';
  const keys = attached ? ['endpoint', 'pid', 'result', 'session'] : ['pid', 'result', 'session'];
  if (!objectWithKeys(value, keys) || value.session !== session.upstream_session_id
    || !Number.isSafeInteger(value.pid) || value.pid <= 0
    || !snapshotResult(value.result)) {
    sessionFail('BROWSER_SESSION_OUTPUT_INVALID', 'worker start acknowledgement differs');
  }
  if (attached) {
    const expected = session.attach_kind === 'extension' ? 'chrome' : input?.cdp_url;
    if (value.endpoint !== expected) sessionFail('BROWSER_SESSION_OUTPUT_INVALID', 'worker attach binding differs');
  }
  return Object.freeze({ acknowledged: true });
}

export function validateCleanupEnvelope(value, session) {
  if (!objectWithKeys(value, ['session', 'status']) || value.session !== session.upstream_session_id) {
    sessionFail('BROWSER_SESSION_OUTPUT_INVALID', 'worker cleanup acknowledgement differs');
  }
  const completed = session.cleanup_operation === 'close' ? 'closed' : 'detached';
  const missing = session.cleanup_operation === 'close' ? 'not-open' : 'not-attached';
  if (value.status === completed) return Object.freeze({ state: 'completed' });
  if (value.status === missing) return Object.freeze({ state: 'missing' });
  sessionFail('BROWSER_SESSION_OUTPUT_INVALID', 'worker cleanup status differs');
}

export function exactEvalResult(value) {
  if (!objectWithKeys(value, ['result']) || typeof value.result !== 'string') {
    sessionFail('BROWSER_SESSION_OUTPUT_INVALID', 'worker evaluation envelope differs');
  }
  let parsed;
  try { parsed = JSON.parse(value.result); } catch {
    sessionFail('BROWSER_SESSION_OUTPUT_INVALID', 'worker evaluation result is invalid');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    sessionFail('BROWSER_SESSION_OUTPUT_INVALID', 'worker evaluation result shape differs');
  }
  return parsed;
}

export function validatePageIdentityResult(value) {
  if (!objectWithKeys(value, ['document_title', 'frame_url', 'page_url', 'schema', 'top_frame_url'])
    || value.schema !== 'aos.agent-workspace.browser-identity.v1'
    || !nullableText(value.page_url) || !nullableText(value.frame_url)
    || !nullableText(value.top_frame_url) || !nullableText(value.document_title, 16 * 1024)) {
    sessionFail('BROWSER_SESSION_OUTPUT_INVALID', 'worker page identity differs');
  }
  return Object.freeze(value);
}

function evidenceCandidate(value) {
  return objectWithKeys(value, ['error', 'kind', 'match_count', 'value'])
    && ['css', 'xpath'].includes(value.kind)
    && typeof value.value === 'string' && Buffer.byteLength(value.value) > 0
    && Buffer.byteLength(value.value) <= 4096
    && Number.isSafeInteger(value.match_count) && value.match_count >= 0
    && value.match_count <= 1_000_000
    && [null, 'invalid_locator'].includes(value.error);
}

function evidenceUsed(value) {
  return objectWithKeys(value, ['index', 'kind', 'match_count', 'value'])
    && ['css', 'xpath'].includes(value.kind)
    && typeof value.value === 'string' && Buffer.byteLength(value.value) > 0
    && Buffer.byteLength(value.value) <= 4096
    && value.index === 0 && Number.isSafeInteger(value.match_count)
    && value.match_count > 0 && value.match_count <= 1_000_000;
}

export function validateEvidenceResult(value, input) {
  if (!objectWithKeys(value, ['bounding_box', 'extracted_text', 'selector_resolution', 'status', 'visible'])
    || !['captured', 'missing_selector'].includes(value.status)
    || !objectWithKeys(value.selector_resolution, ['candidates', 'strategy', 'used'])
    || !Array.isArray(value.selector_resolution.candidates)
    || value.selector_resolution.candidates.length < 1 || value.selector_resolution.candidates.length > 2
    || value.selector_resolution.candidates.some((candidate) => !evidenceCandidate(candidate))) {
    sessionFail('BROWSER_SESSION_OUTPUT_INVALID', 'worker evidence result differs');
  }
  const requested = (input?.candidates ?? []).map(({ kind, value: locator }) => ({ kind, value: String(locator) }));
  const observed = value.selector_resolution.candidates.map(({ kind, value: locator }) => ({ kind, value: locator }));
  const strategy = requested.map(({ kind }) => kind).join('_then_');
  if (JSON.stringify(requested) !== JSON.stringify(observed)
    || value.selector_resolution.strategy !== strategy) {
    sessionFail('BROWSER_SESSION_OUTPUT_INVALID', 'worker evidence binding differs');
  }
  if (value.status === 'missing_selector') {
    if (value.extracted_text !== null || value.bounding_box !== null || value.visible !== false
      || value.selector_resolution.used !== null) {
      sessionFail('BROWSER_SESSION_OUTPUT_INVALID', 'worker missing evidence result differs');
    }
  } else if (typeof value.extracted_text !== 'string' || Buffer.byteLength(value.extracted_text) > 1024 * 1024
    || !objectWithKeys(value.bounding_box, ['height', 'width', 'x', 'y'])
    || !Object.values(value.bounding_box).every(finiteNumber)
    || typeof value.visible !== 'boolean' || !evidenceUsed(value.selector_resolution.used)
    || !requested.some(({ kind, value: locator }) => (
      kind === value.selector_resolution.used.kind && locator === value.selector_resolution.used.value
    ))) {
    sessionFail('BROWSER_SESSION_OUTPUT_INVALID', 'worker captured evidence result differs');
  }
  return Object.freeze(value);
}

export function validateOperationEnvelope(value, operation, artifact = null) {
  if (['navigate', 'type', 'key', 'scroll', 'snapshot'].includes(operation)) {
    if (!snapshotResult(value)) sessionFail('BROWSER_SESSION_OUTPUT_INVALID', 'worker snapshot acknowledgement differs');
    if (operation === 'snapshot' && value.snapshot.file !== artifact) {
      sessionFail('BROWSER_SESSION_OUTPUT_INVALID', 'worker snapshot artifact binding differs');
    }
    return Object.freeze({ acknowledged: true });
  }
  if (operation === 'screenshot') {
    if (!objectWithKeys(value, ['screenshot']) || !objectWithKeys(value.screenshot, ['file'])
      || value.screenshot.file !== artifact) {
      sessionFail('BROWSER_SESSION_OUTPUT_INVALID', 'worker screenshot artifact binding differs');
    }
    return Object.freeze({ acknowledged: true });
  }
  sessionFail('BROWSER_SESSION_OUTPUT_INVALID', 'worker operation acknowledgement differs');
}

export function validateLivenessEnvelope(value) {
  const parsed = exactEvalResult(value);
  if (!objectWithKeys(parsed, ['status']) || parsed.status !== 'alive') {
    sessionFail('BROWSER_SESSION_OUTPUT_INVALID', 'worker liveness acknowledgement differs');
  }
  return parsed;
}
