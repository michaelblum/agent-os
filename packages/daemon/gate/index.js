import { randomUUID } from 'node:crypto';
import { LocalCanvasReceptor } from './LocalCanvasReceptor.js';

const MIN_TIMEOUT_MS = 5000;
const MAX_TIMEOUT_MS = 120000;
const PRESETS = new Set([
  'yes_no_with_escape',
  'approve_deny',
  'single_choice',
  'multi_choice',
  'freetext',
]);
const FIELD_KINDS = new Set(['boolean', 'exclusive_choice', 'multi_choice', 'text', 'number']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clampTimeout(timeoutMs) {
  const numeric = Number(timeoutMs);
  if (!Number.isFinite(numeric)) return 20000;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, numeric));
}

function presetFields(variant, request = {}) {
  const choices = Array.isArray(request.choices)
    ? request.choices
    : Array.isArray(request.ui?.options)
      ? request.ui.options
      : [];

  if (variant === 'yes_no_with_escape') {
    return [
      { id: 'decision', kind: 'exclusive_choice', style: 'buttons', options: [
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No' },
        { value: 'other', label: 'Something else' },
      ] },
      { id: 'other_text', kind: 'text', placeholder: 'Something else...', visible_when: { field: 'decision', equals: 'other' } },
    ];
  }
  if (variant === 'approve_deny') {
    return [
      { id: 'decision', kind: 'exclusive_choice', style: 'buttons', options: [
        { value: 'approve', label: 'Approve' },
        { value: 'deny', label: 'Deny', danger: true },
      ] },
      { id: 'other_text', kind: 'text', placeholder: 'Reason...', visible_when: { field: 'decision', equals: 'deny' } },
    ];
  }
  if (variant === 'single_choice') return [{ id: 'decision', kind: 'exclusive_choice', style: 'buttons', options: choices }];
  if (variant === 'multi_choice') return [{ id: 'decisions', kind: 'multi_choice', options: choices }];
  return [{ id: 'text', kind: 'text', placeholder: 'Your response...' }];
}

function validateFields(fields, { path = 'fields' } = {}) {
  if (!Array.isArray(fields) || fields.length === 0) throw new Error(`${path} must be a non-empty array`);
  for (const [index, field] of fields.entries()) {
    if (!isObject(field)) throw new Error(`${path}[${index}] must be an object`);
    if (typeof field.id !== 'string' || field.id.length === 0) throw new Error(`${path}[${index}].id is required`);
    if (!FIELD_KINDS.has(field.kind)) throw new Error(`${path}[${index}].kind is unsupported`);
    if ((field.kind === 'exclusive_choice' || field.kind === 'multi_choice') && (!Array.isArray(field.options) || field.options.length === 0)) {
      throw new Error(`${path}[${index}].options must be non-empty`);
    }
  }
}

export function normalizeGateRequest(input, { source = { surface: 'aos-cli' } } = {}) {
  if (!isObject(input)) throw new Error('gate request must be an object');
  const prompt = isObject(input.prompt) ? input.prompt : null;
  if (!prompt || typeof prompt.title !== 'string' || prompt.title.length === 0) {
    throw new Error('prompt.title is required');
  }

  const ui = isObject(input.ui) ? { ...input.ui } : {};
  const variant = ui.variant ?? (Array.isArray(input.fields) ? null : 'freetext');
  if (variant !== null && variant !== undefined && !PRESETS.has(variant)) throw new Error(`unsupported ui.variant: ${variant}`);

  const fields = Array.isArray(input.fields)
    ? input.fields
    : Array.isArray(ui.fields)
      ? ui.fields
      : presetFields(variant || 'freetext', input);
  validateFields(fields);

  return {
    ...input,
    schema_version: 'aos.gate.request.v1',
    id: typeof input.id === 'string' && input.id.length > 0 ? input.id : `gate-${randomUUID()}`,
    prompt: {
      title: prompt.title,
      body: prompt.body ?? null,
    },
    fields,
    ui: {
      ...ui,
      variant,
      fields,
    },
    timeout_ms: clampTimeout(input.timeout_ms),
    source: isObject(input.source) ? input.source : source,
  };
}

export function validateGateRequest(input) {
  normalizeGateRequest(input);
  return true;
}

export function createGateService({
  receptor = null,
  receptorFactory = null,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  logger = null,
} = {}) {
  const pending = new Map();

  function log(event, payload) {
    logger?.({ event, ...payload });
  }

  async function settle(id, resolution, value, rejectError = null) {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    clearTimeoutFn(entry.timer);
    try {
      await entry.receptor.dismiss(entry.handle);
    } finally {
      log('gate.resolved', { gate_id: id, resolution, elapsed_ms: Date.now() - entry.startedAt });
      if (rejectError) entry.reject(rejectError);
      else entry.resolve(value);
    }
  }

  const callbacks = {
    onResolve(id, values) {
      settle(id, values === null ? 'dismiss' : 'user', values);
    },
    onReject(id, reason) {
      settle(id, 'error', null, reason instanceof Error ? reason : new Error(String(reason || 'gate rejected')));
    },
  };

  async function ask(gateRequest) {
    const request = normalizeGateRequest(gateRequest);
    const selectedReceptor = receptor || (receptorFactory ? receptorFactory(callbacks) : new LocalCanvasReceptor(callbacks));
    for (const field of request.fields) {
      if (!selectedReceptor.supports(field.kind)) throw new Error(`no receptor support for field kind: ${field.kind}`);
    }

    log('gate.requested', {
      gate_id: request.id,
      variant: request.ui?.variant ?? null,
      timeout_ms: request.timeout_ms,
    });

    return new Promise((resolve, reject) => {
      const entry = {
        request,
        receptor: selectedReceptor,
        handle: null,
        resolve,
        reject,
        startedAt: Date.now(),
        timer: setTimeoutFn(() => {
          settle(request.id, 'timeout', null);
        }, request.timeout_ms),
      };
      pending.set(request.id, entry);

      selectedReceptor.receive(request)
        .then((handle) => {
          if (!pending.has(request.id)) {
            selectedReceptor.dismiss(handle);
            return;
          }
          entry.handle = handle;
          log('gate.presented', { gate_id: request.id, receptor: selectedReceptor.constructor.name });
        })
        .catch((error) => {
          settle(request.id, 'error', null, error);
        });
    });
  }

  return {
    pending,
    ask,
    resolve(id, values) {
      return settle(id, values === null ? 'dismiss' : 'user', values);
    },
    reject(id, reason) {
      return settle(id, 'error', null, reason instanceof Error ? reason : new Error(String(reason || 'gate rejected')));
    },
  };
}

export const gateService = createGateService();
export { GateReceptor } from './GateReceptor.js';
export { LocalCanvasReceptor } from './LocalCanvasReceptor.js';
