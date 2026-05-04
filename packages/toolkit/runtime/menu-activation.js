export const MENU_ACTIVATION_SCHEMA_VERSION = '2026-05-04';

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

export function createMenuActivationRequest({
  id,
  menuId,
  item,
  input = 'unknown',
  source = 'menu',
  phase = 'requested',
  surface = null,
  transition = null,
  metadata = {},
} = {}) {
  const itemId = text(item?.id || item?.action);
  if (!itemId) throw new TypeError('menu activation requires an item id or action');

  return {
    type: 'aos.menu.activation',
    schema_version: MENU_ACTIVATION_SCHEMA_VERSION,
    id: text(id, stableId('menu-activation')),
    menu_id: text(menuId, 'menu'),
    phase: text(phase, 'requested'),
    input: text(input, 'unknown'),
    source: text(source, 'menu'),
    action: text(item?.action || itemId),
    item: {
      id: itemId,
      label: text(item?.label, itemId),
      action: text(item?.action || itemId),
    },
    surface: surface ? cloneJson(surface) : null,
    transition: transition ? cloneJson(transition) : null,
    metadata: cloneJson(metadata) || {},
    created_at: Date.now(),
  };
}

export function advanceMenuActivation(request = {}, phase = 'completed', extra = {}) {
  if (request.type !== 'aos.menu.activation') {
    throw new TypeError('advanceMenuActivation requires an aos.menu.activation request');
  }
  return {
    ...cloneJson(request),
    ...cloneJson(extra),
    phase: text(phase, 'completed'),
    updated_at: Date.now(),
  };
}
