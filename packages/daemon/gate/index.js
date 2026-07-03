import { randomUUID } from 'node:crypto';
import {
  GATE_FIELD_KIND_SET,
  GATE_PRESET_SET,
  GATE_SCHEMA_VERSION,
  clampGateTimeout,
  expandGatePresetFields,
  stripUiFields,
} from '../../../shared/gate/presets.mjs';
import { GATE_ERROR_CODES, createGateError, ensureGateError } from '../../../shared/gate/errors.mjs';
import { LocalCanvasReceptor } from './LocalCanvasReceptor.js';
import { createGateRecord } from './records.js';

const NO_ANSWER_STATUSES = new Set(['dismissed', 'timeout']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateFields(fields, { path = 'fields' } = {}) {
  if (!Array.isArray(fields) || fields.length === 0) {
    throw createGateError(GATE_ERROR_CODES.invalidRequest, `${path} must be a non-empty array`);
  }
  for (const [index, field] of fields.entries()) {
    if (!isObject(field)) throw createGateError(GATE_ERROR_CODES.invalidRequest, `${path}[${index}] must be an object`);
    if (typeof field.id !== 'string' || field.id.length === 0) {
      throw createGateError(GATE_ERROR_CODES.invalidRequest, `${path}[${index}].id is required`);
    }
    if (!GATE_FIELD_KIND_SET.has(field.kind)) {
      throw createGateError(GATE_ERROR_CODES.unsupportedField, `${path}[${index}].kind is unsupported`);
    }
    if ((field.kind === 'exclusive_choice' || field.kind === 'multi_choice') && (!Array.isArray(field.options) || field.options.length === 0)) {
      throw createGateError(GATE_ERROR_CODES.invalidRequest, `${path}[${index}].options must be non-empty`);
    }
  }
}

function noAnswer(status) {
  return { result: null, status };
}

function resolvedValue(values) {
  if (isObject(values) && values.result === null && NO_ANSWER_STATUSES.has(values.status)) {
    return { resolution: values.status, value: noAnswer(values.status) };
  }
  if (values === null) return { resolution: 'dismissed', value: noAnswer('dismissed') };
  return { resolution: 'answered', value: values };
}

export function normalizeGateRequest(input, { source = { surface: 'aos-cli' } } = {}) {
  if (!isObject(input)) throw createGateError(GATE_ERROR_CODES.invalidRequest, 'gate request must be an object');
  const prompt = isObject(input.prompt) ? input.prompt : null;
  if (!prompt || typeof prompt.title !== 'string' || prompt.title.length === 0) {
    throw createGateError(GATE_ERROR_CODES.invalidRequest, 'prompt.title is required');
  }

  const ui = stripUiFields(input.ui);
  const variant = ui.variant ?? (Array.isArray(input.fields) ? null : 'freetext');
  if (variant !== null && variant !== undefined && !GATE_PRESET_SET.has(variant)) {
    throw createGateError(GATE_ERROR_CODES.invalidRequest, `unsupported ui.variant: ${variant}`);
  }

  const fields = Array.isArray(input.fields)
    ? input.fields
    : expandGatePresetFields(variant || 'freetext', { ...input, ui });
  validateFields(fields);

  return {
    ...input,
    schema_version: GATE_SCHEMA_VERSION,
    id: typeof input.id === 'string' && input.id.length > 0 ? input.id : `gate-${randomUUID()}`,
    created_at: typeof input.created_at === 'string' ? input.created_at : new Date().toISOString(),
    prompt: {
      title: prompt.title,
      body: prompt.body ?? null,
    },
    fields,
    ui: {
      ...ui,
      variant,
    },
    timeout_ms: clampGateTimeout(input.timeout_ms),
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
  recordStore = null,
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
    const resolvedAt = new Date();
    const elapsedMs = Date.now() - entry.startedAt;
    try {
      await entry.receptor.dismiss(entry.handle);
    } catch (error) {
      log('gate.dismiss_failed', { gate_id: id, error: error instanceof Error ? error.message : String(error) });
    }
    log('gate.resolved', { gate_id: id, resolution, elapsed_ms: elapsedMs });
    if (recordStore) {
      try {
        await recordStore.append(createGateRecord({
          request: entry.request,
          receptorName: entry.receptor.constructor?.name ?? null,
          presentedAt: entry.presentedAt,
          resolvedAt,
          elapsedMs,
          resolution,
          value,
          error: rejectError,
        }));
      } catch (error) {
        const recordError = createGateError(
          GATE_ERROR_CODES.recordWriteFailed,
          `failed to write gate record: ${error.message}`,
          { cause: error },
        );
        if (rejectError) entry.reject(rejectError);
        else entry.reject(recordError);
        return;
      }
    }
    if (rejectError) entry.reject(rejectError);
    else entry.resolve(value);
  }

  const callbacks = {
    onResolve(id, values) {
      const result = resolvedValue(values);
      settle(id, result.resolution, result.value);
    },
    onReject(id, reason) {
      settle(id, 'error', null, ensureGateError(reason));
    },
  };

  async function ask(gateRequest) {
    const request = normalizeGateRequest(gateRequest);
    const selectedReceptor = receptor || (receptorFactory ? receptorFactory(callbacks) : new LocalCanvasReceptor(callbacks));
    for (const field of request.fields) {
      if (!selectedReceptor.supports(field.kind)) {
        const error = createGateError(GATE_ERROR_CODES.unsupportedField, `no receptor support for field kind: ${field.kind}`);
        if (recordStore) {
          await recordStore.append(createGateRecord({
            request,
            receptorName: selectedReceptor.constructor?.name ?? null,
            presentedAt: null,
            resolvedAt: new Date(),
            elapsedMs: 0,
            resolution: 'error',
            error,
          }));
        }
        throw error;
      }
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
        presentedAt: null,
        timer: setTimeoutFn(() => {
          settle(request.id, 'timeout', noAnswer('timeout'));
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
          entry.presentedAt = new Date();
          log('gate.presented', { gate_id: request.id, receptor: selectedReceptor.constructor.name });
        })
        .catch((error) => {
          settle(request.id, 'error', null, ensureGateError(error));
        });
    });
  }

  return {
    pending,
    ask,
    resolve(id, values) {
      const result = resolvedValue(values);
      return settle(id, result.resolution, result.value);
    },
    reject(id, reason) {
      return settle(id, 'error', null, ensureGateError(reason));
    },
  };
}

export const gateService = createGateService();
export { GateReceptor } from './GateReceptor.js';
export { LocalCanvasReceptor } from './LocalCanvasReceptor.js';
