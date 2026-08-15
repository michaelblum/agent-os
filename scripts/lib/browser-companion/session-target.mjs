import { sessionFail, validateSessionId } from './session-model.mjs';

const REF = /^(?:f\d+)?e\d+$/u;

export function parseManagedBrowserTarget(input) {
  const text = String(input ?? '');
  if (!text.startsWith('browser:')) sessionFail('BROWSER_SESSION_INVALID', 'browser target prefix is invalid');
  const remainder = text.slice('browser:'.length);
  if (!remainder || remainder.startsWith('/')) sessionFail('BROWSER_SESSION_INVALID', 'browser target session is required');
  const parts = remainder.split('/');
  if (parts.length > 2) sessionFail('BROWSER_SESSION_INVALID', 'browser target has too many segments');
  const session = validateSessionId(parts[0]);
  const ref = parts[1] ?? null;
  if (ref !== null && !REF.test(ref)) sessionFail('BROWSER_SESSION_INVALID', 'browser ref is invalid');
  return Object.freeze({ session, ref });
}

export function requireSessionOnlyTarget(input) {
  const target = parseManagedBrowserTarget(input);
  if (target.ref) sessionFail('BROWSER_SESSION_OPERATION_UNSUPPORTED', 'browser Observation Ref actions remain unsupported');
  return target;
}
