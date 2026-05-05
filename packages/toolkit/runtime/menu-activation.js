export const MENU_ACTIVATION_SCHEMA_VERSION = '2026-05-04';
export const MENU_ACTIVATION_PHASES = Object.freeze([
  'requested',
  'item_transition',
  'menu_transition',
  'surface_transition',
  'completed',
  'cancelled',
  'failed',
]);
export const MENU_ACTIVATION_TERMINAL_PHASES = Object.freeze([
  'completed',
  'cancelled',
  'failed',
]);

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function stableId(prefix = 'activation') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function isMenuActivationPhase(phase) {
  return MENU_ACTIVATION_PHASES.includes(String(phase || ''));
}

export function isTerminalMenuActivationPhase(phase) {
  return MENU_ACTIVATION_TERMINAL_PHASES.includes(String(phase || ''));
}

export function normalizeMenuActivationPhase(phase = 'requested') {
  const normalized = text(phase, 'requested');
  if (!isMenuActivationPhase(normalized)) {
    throw new TypeError(`unknown menu activation phase: ${normalized}`);
  }
  return normalized;
}

export function normalizeMenuActivationInput(input = 'unknown', source = 'menu') {
  const object = input && typeof input === 'object' ? cloneJson(input) : {};
  const rawKind = input && typeof input === 'object'
    ? object.kind ?? object.type ?? object.input
    : input;
  return {
    ...object,
    kind: text(rawKind, 'unknown'),
    source: text(object.source ?? source, 'menu'),
  };
}

export function normalizeMenuActivationSurface(surface = null) {
  if (!surface) return null;
  return cloneJson(surface);
}

export function normalizeMenuActivationTransition(transition = null) {
  if (!transition) return null;
  if (typeof transition === 'string') return { preset: text(transition) };
  return cloneJson(transition);
}

export function createMenuActivationRequest({
  id,
  menuId,
  item,
  input = 'unknown',
  source = 'menu',
  phase = 'requested',
  surface = null,
  targetSurface = null,
  transition = null,
  metadata = {},
} = {}) {
  const itemId = text(item?.id || item?.action);
  if (!itemId) throw new TypeError('menu activation requires an item id or action');
  const now = Date.now();
  const inputSource = normalizeMenuActivationInput(input, source);
  const target = normalizeMenuActivationSurface(targetSurface ?? surface);
  const normalizedPhase = normalizeMenuActivationPhase(phase);

  return {
    type: 'aos.menu.activation',
    schema_version: MENU_ACTIVATION_SCHEMA_VERSION,
    id: text(id, stableId('menu-activation')),
    menu_id: text(menuId, 'menu'),
    phase: normalizedPhase,
    input: inputSource.kind,
    source: inputSource.source,
    input_source: inputSource,
    action: text(item?.action || itemId),
    item: {
      id: itemId,
      label: text(item?.label, itemId),
      action: text(item?.action || itemId),
    },
    surface: target ? cloneJson(target) : null,
    target_surface: target ? cloneJson(target) : null,
    transition: normalizeMenuActivationTransition(transition),
    metadata: cloneJson(metadata) || {},
    lifecycle: [{ phase: normalizedPhase, at: now }],
    created_at: now,
  };
}

export function advanceMenuActivation(request = {}, phase = 'completed', extra = {}) {
  if (request.type !== 'aos.menu.activation') {
    throw new TypeError('advanceMenuActivation requires an aos.menu.activation request');
  }
  const now = Date.now();
  const normalizedPhase = normalizeMenuActivationPhase(phase);
  const lifecycle = Array.isArray(request.lifecycle) ? cloneJson(request.lifecycle) : [];
  lifecycle.push({ phase: normalizedPhase, at: now });
  return {
    ...cloneJson(request),
    ...cloneJson(extra),
    previous_phase: text(request.phase, 'requested'),
    phase: normalizedPhase,
    lifecycle,
    updated_at: now,
  };
}
