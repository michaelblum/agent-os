import { parseManagedBrowserTarget } from './session-target.mjs';

export class BrowserCaptureOptionError extends Error {
  constructor(message, code = 'INVALID_ARG') {
    super(message);
    this.name = 'BrowserCaptureOptionError';
    this.code = code;
  }
}

function invalid(message, code) {
  throw new BrowserCaptureOptionError(message, code);
}

function sessionTarget(value) {
  let parsed;
  try { parsed = parseManagedBrowserTarget(value); }
  catch { invalid('browser capture target is invalid'); }
  if (parsed.ref) invalid('browser ref capture remains unsupported', 'TARGET_ACTION_UNSUPPORTED');
  return parsed.session;
}

export function validateBrowserCaptureOptions(parsed) {
  if (!String(parsed?.target ?? '').startsWith('browser:')) return null;
  const session = sessionTarget(parsed.target);
  const passthrough = parsed.passthrough ?? [];
  let targetCount = 0;
  let outCount = 0;
  let xrayCount = 0;
  for (let index = 0; index < passthrough.length; index += 1) {
    const token = passthrough[index];
    if (token === parsed.target) {
      targetCount += 1;
      continue;
    }
    if (token === '--out') {
      outCount += 1;
      const value = passthrough[++index];
      if (!value || value !== parsed.requested_out) invalid('--out requires one path', 'MISSING_ARG');
      continue;
    }
    if (token === '--xray') {
      xrayCount += 1;
      continue;
    }
    invalid(`browser capture does not support ${String(token).startsWith('--') ? token : 'extra arguments'}`);
  }
  if (targetCount !== 1 || outCount > 1 || xrayCount > 1) invalid('browser capture arguments differ');
  if (parsed.options.save) {
    if (outCount || xrayCount) invalid('saved browser capture mode owns screenshot or xray selection');
  } else if (outCount && xrayCount) {
    invalid('--out and --xray cannot be combined for browser capture');
  }
  return Object.freeze({ session, save: parsed.options.save, xray: xrayCount === 1 });
}
