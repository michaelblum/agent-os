const SAFE_MESSAGES = Object.freeze({
  COMPANION_INVALID_ARGUMENT: 'Browser companion arguments are invalid.',
  COMPANION_NODE_UNSUPPORTED: 'The current Node runtime is unsupported.',
  COMPANION_DESCRIPTOR_INVALID: 'The browser companion descriptor is invalid.',
  COMPANION_STORE_BLOCKED: 'The browser companion store is blocked.',
  COMPANION_STORE_CORRUPT: 'The browser companion store is corrupt.',
  COMPANION_STORE_BUSY: 'The browser companion store is busy.',
  COMPANION_DOWNLOAD_FAILED: 'Browser companion package acquisition failed.',
  COMPANION_DOWNLOAD_TIMEOUT: 'Browser companion package acquisition timed out.',
  COMPANION_DOWNLOAD_LIMIT: 'Browser companion package acquisition exceeded its limit.',
  COMPANION_INTEGRITY_MISMATCH: 'Browser companion package integrity did not match.',
  COMPANION_ARCHIVE_INVALID: 'A browser companion package archive is invalid.',
  COMPANION_ARCHIVE_LIMIT: 'A browser companion package archive exceeded its limit.',
  COMPANION_PACKAGE_INVALID: 'The browser companion package closure is invalid.',
  COMPANION_ACTIVATION_FAILED: 'Browser companion activation failed.',
  COMPANION_UPDATE_MISSING: 'The browser companion is not installed.',
  COMPANION_UPDATE_REQUIRED: 'The installed browser companion requires update.',
  COMPANION_LEASES_ACTIVE: 'Managed browser sessions still lease the companion.',
  COMPANION_INTERNAL: 'The browser companion operation failed.',
});

export class CompanionError extends Error {
  constructor(code, internalMessage = code, options = {}) {
    super(internalMessage, options);
    this.name = 'CompanionError';
    this.code = Object.hasOwn(SAFE_MESSAGES, code) ? code : 'COMPANION_INTERNAL';
  }
}

export function fail(code, internalMessage, options) {
  throw new CompanionError(code, internalMessage, options);
}

export function publicError(error, operation) {
  const code = error instanceof CompanionError ? error.code : 'COMPANION_INTERNAL';
  return Object.freeze({
    schema_version: 'aos.browser.companion.error.v1',
    operation,
    status: 'error',
    code,
    error: SAFE_MESSAGES[code],
  });
}

export function isCompanionError(error) {
  return error instanceof CompanionError;
}
