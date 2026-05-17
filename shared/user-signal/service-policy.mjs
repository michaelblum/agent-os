import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export const USER_SIGNAL_DEFAULT_REDACTION = Object.freeze({
  prompt_bodies: 'redact',
  free_text_answers: 'redact',
  answer_payloads: 'redact',
});

export function runtimeMode(env = process.env) {
  const mode = String(env.AOS_RUNTIME_MODE || '').toLowerCase();
  return mode === 'installed' ? 'installed' : 'repo';
}

export function stateRoot(env = process.env) {
  return env.AOS_STATE_ROOT || join(homedir(), '.config', 'aos');
}

export function runtimeStatePath(segments = [], { env = process.env, root = null } = {}) {
  return join(root || stateRoot(env), runtimeMode(env), ...segments);
}

export function publicUserSignalSource(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
  const output = {};
  for (const key of ['surface', 'session_id', 'agent']) {
    if (source[key] !== undefined) output[key] = source[key];
  }
  return output;
}

export function normalizeUserSignalRedaction(redaction = {}) {
  const input = redaction && typeof redaction === 'object' && !Array.isArray(redaction) ? redaction : {};
  return {
    prompt_bodies: input.prompt_bodies === 'store' ? 'store' : USER_SIGNAL_DEFAULT_REDACTION.prompt_bodies,
    free_text_answers: input.free_text_answers === 'store' ? 'store' : USER_SIGNAL_DEFAULT_REDACTION.free_text_answers,
    answer_payloads: input.answer_payloads === 'store' ? 'store' : USER_SIGNAL_DEFAULT_REDACTION.answer_payloads,
  };
}

export async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(tmp, path);
}

export async function writeJsonExclusive(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
}
