export const GATE_ERROR_CODES = Object.freeze({
  invalidRequest: 'AOS_GATE_INVALID_REQUEST',
  unsupportedField: 'AOS_GATE_UNSUPPORTED_FIELD',
  presentFailed: 'AOS_GATE_PRESENT_FAILED',
  receptorError: 'AOS_GATE_RECEPTOR_ERROR',
  recordWriteFailed: 'AOS_GATE_RECORD_WRITE_FAILED',
});

export function createGateError(code, message, options = {}) {
  const error = new Error(message || code, options.cause ? { cause: options.cause } : undefined);
  error.code = code;
  return error;
}

export function ensureGateError(error, code = GATE_ERROR_CODES.receptorError) {
  if (error instanceof Error && error.code) return error;
  const message = error instanceof Error ? error.message : String(error || code);
  return createGateError(code, message, { cause: error instanceof Error ? error : undefined });
}
