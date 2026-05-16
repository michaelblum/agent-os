export const GATE_SCHEMA_VERSION = 'aos.gate.request.v1';

export const DEFAULT_GATE_TIMEOUT_MS = 20000;
export const MIN_GATE_TIMEOUT_MS = 5000;
export const MAX_GATE_TIMEOUT_MS = 120000;

export const GATE_PRESET_VARIANTS = Object.freeze([
  'yes_no_with_escape',
  'approve_deny',
  'single_choice',
  'multi_choice',
  'freetext',
]);

export const GATE_FIELD_KINDS = Object.freeze([
  'boolean',
  'exclusive_choice',
  'multi_choice',
  'text',
  'number',
]);

export const GATE_PRESET_SET = new Set(GATE_PRESET_VARIANTS);
export const GATE_FIELD_KIND_SET = new Set(GATE_FIELD_KINDS);

export function clampGateTimeout(timeoutMs) {
  const numeric = Number(timeoutMs);
  if (!Number.isFinite(numeric)) return DEFAULT_GATE_TIMEOUT_MS;
  return Math.min(MAX_GATE_TIMEOUT_MS, Math.max(MIN_GATE_TIMEOUT_MS, numeric));
}

export function gateChoices(request = {}) {
  if (Array.isArray(request.choices)) return request.choices;
  if (Array.isArray(request.ui?.options)) return request.ui.options;
  return [];
}

export function expandGatePresetFields(variant = 'freetext', request = {}) {
  const choices = gateChoices(request);

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

  if (variant === 'single_choice') {
    return [{ id: 'decision', kind: 'exclusive_choice', style: 'buttons', options: choices }];
  }

  if (variant === 'multi_choice') {
    return [{ id: 'decisions', kind: 'multi_choice', options: choices }];
  }

  return [{ id: 'text', kind: 'text', placeholder: 'Your response...' }];
}

export function stripUiFields(ui = {}) {
  const normalized = ui && typeof ui === 'object' && !Array.isArray(ui) ? { ...ui } : {};
  delete normalized.fields;
  return normalized;
}
