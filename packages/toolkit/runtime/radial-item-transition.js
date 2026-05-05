export const RADIAL_ITEM_ACTIVATION_TRANSITION_SCHEMA_VERSION = '2026-05-04';
export const DEFAULT_RADIAL_ITEM_ACTIVATION_TRANSITION_PRESET = 'radial-3d-vanilla';

export const RADIAL_ITEM_ACTIVATION_TRANSITION_PRESETS = Object.freeze({
  [DEFAULT_RADIAL_ITEM_ACTIVATION_TRANSITION_PRESET]: Object.freeze({
    schema_version: RADIAL_ITEM_ACTIVATION_TRANSITION_SCHEMA_VERSION,
    preset: DEFAULT_RADIAL_ITEM_ACTIVATION_TRANSITION_PRESET,
    item: Object.freeze({
      focus: Object.freeze({
        mode: 'item-center',
        zoom: 'fit-item',
        scale: 1.08,
      }),
      fade: Object.freeze({
        from: 1,
        to: 1,
      }),
      hold: true,
      duration_ms: 220,
      easing: 'ease-out',
    }),
    menu: Object.freeze({
      hold_active_item: true,
      dissolve: false,
      fade: Object.freeze({
        from: 1,
        to: 0.18,
      }),
      duration_ms: 180,
      easing: 'ease-out',
    }),
    surface: Object.freeze({
      fade: 'in',
      opacity: Object.freeze({
        from: 0,
        to: 1,
      }),
      starts: 'with-menu',
      duration_ms: 180,
      easing: 'ease-out',
    }),
    cancel: Object.freeze({
      item: Object.freeze({
        focus: 'restore',
        fade: Object.freeze({
          to: 1,
        }),
      }),
      menu: Object.freeze({
        fade: Object.freeze({
          to: 1,
        }),
        dissolve: false,
      }),
      surface: null,
      duration_ms: 140,
      easing: 'ease-out',
    }),
  }),
});

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function mergeJson(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return cloneJson(override === undefined ? base : override);
  }
  const next = cloneJson(base);
  for (const [key, value] of Object.entries(override)) {
    next[key] = isPlainObject(next[key]) && isPlainObject(value)
      ? mergeJson(next[key], value)
      : cloneJson(value);
  }
  return next;
}

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeDuration(block) {
  if (!isPlainObject(block)) return block;
  const next = cloneJson(block);
  if (next.duration_ms !== undefined) {
    next.duration_ms = Math.max(0, numberOr(next.duration_ms, 0));
  }
  return next;
}

export function radialItemActivationTransitionPreset(preset = DEFAULT_RADIAL_ITEM_ACTIVATION_TRANSITION_PRESET) {
  const key = text(preset, DEFAULT_RADIAL_ITEM_ACTIVATION_TRANSITION_PRESET);
  return cloneJson(
    RADIAL_ITEM_ACTIVATION_TRANSITION_PRESETS[key]
    || RADIAL_ITEM_ACTIVATION_TRANSITION_PRESETS[DEFAULT_RADIAL_ITEM_ACTIVATION_TRANSITION_PRESET]
  );
}

export function normalizeRadialItemActivationTransition(transition = {}) {
  if (transition === false) return null;
  const source = typeof transition === 'string' ? { preset: transition } : transition;
  const override = isPlainObject(source) ? cloneJson(source) : {};
  const requestedPreset = text(override.preset, DEFAULT_RADIAL_ITEM_ACTIVATION_TRANSITION_PRESET);
  const base = radialItemActivationTransitionPreset(requestedPreset);
  const merged = mergeJson(base, override);
  const preset = text(merged.preset, requestedPreset);

  return {
    ...merged,
    schema_version: text(merged.schema_version, RADIAL_ITEM_ACTIVATION_TRANSITION_SCHEMA_VERSION),
    preset,
    item: normalizeDuration(merged.item),
    menu: normalizeDuration(merged.menu),
    surface: normalizeDuration(merged.surface),
    cancel: normalizeDuration(merged.cancel),
  };
}

export function resolveRadialItemActivationTransition(item = {}, options = {}) {
  const source = item?.activationTransition ?? options.activationTransition ?? {};
  if (source === false) return null;
  const fallbackPreset = options.preset || DEFAULT_RADIAL_ITEM_ACTIVATION_TRANSITION_PRESET;
  const requested = isPlainObject(source) || typeof source === 'string'
    ? source
    : {};
  const transition = normalizeRadialItemActivationTransition({
    preset: fallbackPreset,
    ...(typeof requested === 'string' ? { preset: requested } : requested),
  });
  if (!transition) return null;
  return {
    ...transition,
    item_id: text(item?.id, null),
  };
}
