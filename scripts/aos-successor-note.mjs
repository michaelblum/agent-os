import fs from 'node:fs';
import path from 'node:path';

export const successorNoteMaxBytes = 4096;
const maxStringLength = 360;
const maxSideMissions = 5;
const rolePattern = /^[a-z][a-z0-9_-]{0,31}$/;
const sideMissionStatuses = new Set(['active', 'parked', 'blocked']);

const topLevelFields = new Set([
  'role',
  'active_epic',
  'current_slice',
  'next_step',
  'side_missions',
  'expires_when',
]);
const activeEpicFields = new Set(['id', 'source', 'why']);
const sideMissionFields = new Set([
  'id',
  'status',
  'why_started',
  'current_ref',
  'enough_for_now',
  'return_condition',
  'next_step',
]);

export function successorNoteRelativePath(role) {
  return path.join('.runtime', 'dev', 'successor', `${role}.json`);
}

export function successorNotePath(repoRoot, role) {
  return path.join(repoRoot, successorNoteRelativePath(role));
}

export function normalizeRole(role) {
  const value = compactString(role);
  if (!rolePattern.test(value)) {
    throw new Error(`role must match ${rolePattern}`);
  }
  return value;
}

export function validateSuccessorNote(value, options = {}) {
  const errors = [];
  if (!isPlainObject(value)) {
    return { ok: false, errors: ['note must be a JSON object'], note: null };
  }
  for (const key of Object.keys(value)) {
    if (!topLevelFields.has(key)) errors.push(`.${key}: unknown field`);
  }

  const note = {};
  note.role = requiredString(value, 'role', errors);
  if (note.role && !rolePattern.test(note.role)) errors.push('.role: invalid role');
  if (options.expectedRole && note.role && note.role !== options.expectedRole) {
    errors.push(`.role: must match --role ${options.expectedRole}`);
  }

  note.active_epic = validateActiveEpic(value.active_epic, errors);
  note.current_slice = requiredString(value, 'current_slice', errors);
  note.next_step = requiredString(value, 'next_step', errors);
  note.side_missions = validateSideMissions(value.side_missions, errors);
  note.expires_when = requiredString(value, 'expires_when', errors);

  return {
    ok: errors.length === 0,
    errors,
    note: errors.length === 0 ? note : null,
  };
}

export function parseSuccessorNote(raw, options = {}) {
  const bytes = Buffer.byteLength(raw, 'utf8');
  if (bytes > successorNoteMaxBytes) {
    return {
      ok: false,
      status: 'oversized',
      bytes,
      max_bytes: successorNoteMaxBytes,
      errors: [`note is ${bytes} bytes; max is ${successorNoteMaxBytes}`],
      note: null,
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      status: 'invalid',
      bytes,
      max_bytes: successorNoteMaxBytes,
      errors: [`invalid JSON: ${err.message}`],
      note: null,
    };
  }
  const validated = validateSuccessorNote(parsed, options);
  return {
    ok: validated.ok,
    status: validated.ok ? 'valid' : 'invalid',
    bytes,
    max_bytes: successorNoteMaxBytes,
    errors: validated.errors,
    note: validated.note,
  };
}

export function readSuccessorNote(repoRoot, role, context = {}) {
  const normalizedRole = normalizeRole(role);
  const notePath = successorNotePath(repoRoot, normalizedRole);
  const relativePath = successorNoteRelativePath(normalizedRole);
  if (!fs.existsSync(notePath)) {
    return baseReadResult('missing', normalizedRole, relativePath, { note: null });
  }

  const stat = fs.statSync(notePath);
  if (stat.size > successorNoteMaxBytes) {
    return baseReadResult('oversized', normalizedRole, relativePath, {
      bytes: stat.size,
      max_bytes: successorNoteMaxBytes,
      note: null,
      errors: [`note is ${stat.size} bytes; max is ${successorNoteMaxBytes}`],
    });
  }

  const parsed = parseSuccessorNote(fs.readFileSync(notePath, 'utf8'), { expectedRole: normalizedRole });
  if (!parsed.ok) {
    return baseReadResult(parsed.status, normalizedRole, relativePath, {
      bytes: parsed.bytes,
      max_bytes: parsed.max_bytes,
      note: null,
      errors: parsed.errors,
    });
  }

  const expiry = evaluateExpiresWhen(parsed.note.expires_when, context);
  return baseReadResult(expiry.status === 'stale' ? 'stale' : 'valid', normalizedRole, relativePath, {
    bytes: parsed.bytes,
    max_bytes: parsed.max_bytes,
    note: parsed.note,
    expires: expiry,
  });
}

export function writeSuccessorNote(repoRoot, role, raw) {
  const normalizedRole = normalizeRole(role);
  const parsed = parseSuccessorNote(raw, { expectedRole: normalizedRole });
  if (!parsed.ok) return parsed;

  const notePath = successorNotePath(repoRoot, normalizedRole);
  fs.mkdirSync(path.dirname(notePath), { recursive: true });
  const body = `${JSON.stringify(parsed.note, null, 2)}\n`;
  fs.writeFileSync(notePath, body, 'utf8');
  return {
    ok: true,
    status: 'ok',
    role: normalizedRole,
    path: successorNoteRelativePath(normalizedRole),
    bytes: Buffer.byteLength(body, 'utf8'),
    max_bytes: successorNoteMaxBytes,
    note: parsed.note,
  };
}

export function evaluateExpiresWhen(value, context = {}) {
  const text = compactString(value);
  const headMatch = text.match(/^(?:git\.)?head\s*==\s*([0-9a-f]{7,40})$/i);
  if (headMatch) {
    const expected = headMatch[1].toLowerCase();
    const actual = String(context.gitHead || '').toLowerCase();
    if (!actual) return { status: 'unknown', kind: 'git.head', expected, actual: null };
    return {
      status: actual.startsWith(expected) || expected.startsWith(actual) ? 'current' : 'stale',
      kind: 'git.head',
      expected,
      actual,
    };
  }

  const branchMatch = text.match(/^(?:git\.)?branch\s*==\s*(\S.+)$/i);
  if (branchMatch) {
    const expected = branchMatch[1].trim();
    const actual = context.gitBranch || null;
    if (!actual) return { status: 'unknown', kind: 'git.branch', expected, actual };
    return {
      status: actual === expected ? 'current' : 'stale',
      kind: 'git.branch',
      expected,
      actual,
    };
  }

  return {
    status: 'unverified',
    kind: 'human_readable',
    condition: text,
  };
}

function baseReadResult(status, role, relativePath, extra = {}) {
  return {
    status,
    authority: 'local_breadcrumb',
    role,
    path: relativePath,
    ...extra,
  };
}

function validateActiveEpic(value, errors) {
  if (!isPlainObject(value)) {
    errors.push('.active_epic: required object');
    return null;
  }
  for (const key of Object.keys(value)) {
    if (!activeEpicFields.has(key)) errors.push(`.active_epic.${key}: unknown field`);
  }
  return {
    id: requiredString(value, 'id', errors, '.active_epic'),
    source: requiredString(value, 'source', errors, '.active_epic'),
    why: requiredString(value, 'why', errors, '.active_epic'),
  };
}

function validateSideMissions(value, errors) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push('.side_missions: must be an array');
    return null;
  }
  if (value.length > maxSideMissions) errors.push(`.side_missions: max ${maxSideMissions} items`);
  return value.map((item, index) => validateSideMission(item, index, errors));
}

function validateSideMission(value, index, errors) {
  const prefix = `.side_missions[${index}]`;
  if (!isPlainObject(value)) {
    errors.push(`${prefix}: must be an object`);
    return null;
  }
  for (const key of Object.keys(value)) {
    if (!sideMissionFields.has(key)) errors.push(`${prefix}.${key}: unknown field`);
  }
  const mission = {
    id: requiredString(value, 'id', errors, prefix),
    status: requiredString(value, 'status', errors, prefix),
    why_started: requiredString(value, 'why_started', errors, prefix),
    current_ref: requiredString(value, 'current_ref', errors, prefix),
    enough_for_now: requiredString(value, 'enough_for_now', errors, prefix),
    return_condition: requiredString(value, 'return_condition', errors, prefix),
    next_step: requiredString(value, 'next_step', errors, prefix),
  };
  if (mission.status && !sideMissionStatuses.has(mission.status)) {
    errors.push(`${prefix}.status: must be active, parked, or blocked`);
  }
  return mission;
}

function requiredString(object, key, errors, prefix = '') {
  const pathName = `${prefix}.${key}`;
  if (!Object.prototype.hasOwnProperty.call(object, key)) {
    errors.push(`${pathName}: required`);
    return null;
  }
  const value = compactString(object[key]);
  if (!value) {
    errors.push(`${pathName}: required non-empty string`);
  } else if (value.length > maxStringLength) {
    errors.push(`${pathName}: max ${maxStringLength} characters`);
  }
  return value || null;
}

function compactString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
