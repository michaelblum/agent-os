export const SCHEMA_VERSION = 'aos.pending-annotation.v0';
export const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
export const JSON_SPACING = 2;
export const LIFECYCLE_STATES = new Set(['pending', 'consumed', 'resolved', 'deleted', 'stale', 'unsupported', 'blocked']);
export const TARGET_KINDS = new Set(['desktop', 'display', 'window', 'browser', 'canvas', 'native_ax', 'region', 'fallback']);
export const CAPABILITY_STATUSES = new Set(['saved_ref', 'fallback_only', 'unsupported', 'ambiguous', 'blocked']);

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

export function fail(message, code, extra = {}) {
  throw new PendingAnnotationError(message, code, extra);
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

export function nowISO() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function validateID(value, label = 'id') {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    fail(`${label} must match ${SAFE_ID.source}`, 'INVALID_ID');
  }
  return value;
}

export function localIDOrNull(value, label) {
  if (value === null || value === undefined || value === '') return null;
  return validateID(String(value), label);
}

export function text(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

export function requiredText(value, label) {
  const normalized = text(value).trim();
  if (!normalized) fail(`${label} is required`, 'MISSING_ARG');
  return normalized;
}

export function array(value) {
  return Array.isArray(value) ? value : [];
}

export function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}
