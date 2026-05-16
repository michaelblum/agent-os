export const RADIAL_MENU_3D_KIND = 'aos.radial_menu_3d';
export const RADIAL_MENU_3D_SCHEMA_VERSION = '2026-05-16';

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function cloneRadialMenuConfig(value) {
  if (Array.isArray(value)) return value.map((entry) => cloneRadialMenuConfig(entry));
  if (!isPlainObject(value)) return value;
  const next = {};
  for (const [key, entry] of Object.entries(value)) {
    next[key] = cloneRadialMenuConfig(entry);
  }
  return next;
}

export function mergeRadialMenuConfig(base, override) {
  if (override === undefined) return cloneRadialMenuConfig(base);
  if (!isPlainObject(base) || !isPlainObject(override)) return cloneRadialMenuConfig(override);
  const next = cloneRadialMenuConfig(base);
  for (const [key, value] of Object.entries(override)) {
    next[key] = isPlainObject(next[key]) && isPlainObject(value)
      ? mergeRadialMenuConfig(next[key], value)
      : cloneRadialMenuConfig(value);
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

function keyedMergeItems(baseItems = [], overrideItems = []) {
  const result = [];
  const indexes = new Map();
  for (const item of Array.isArray(baseItems) ? baseItems : []) {
    if (!isPlainObject(item)) continue;
    indexes.set(item.id, result.length);
    result.push(cloneRadialMenuConfig(item));
  }
  for (const item of Array.isArray(overrideItems) ? overrideItems : []) {
    if (!isPlainObject(item)) continue;
    const id = text(item.id, null);
    if (!id || !indexes.has(id)) {
      indexes.set(id, result.length);
      result.push(cloneRadialMenuConfig(item));
      continue;
    }
    const index = indexes.get(id);
    result[index] = mergeRadialMenuConfig(result[index], item);
  }
  return result;
}

export function mergeRadialMenuDefinitions(base = {}, override = {}) {
  const merged = mergeRadialMenuConfig(base, override);
  merged.items = keyedMergeItems(base.items, override.items);
  return merged;
}

function normalizeHoverTransform(item = {}, menuDefaults = {}) {
  const defaultHover = menuDefaults?.three?.item?.hover || {};
  const itemHover = item?.three?.item?.hover || {};
  const hover = mergeRadialMenuConfig(defaultHover, itemHover);
  const progress = hover.progress || {};
  const transform = hover.transform || {};
  const scale = transform.scale || {};
  const rotate = transform.rotate || {};
  const spin = rotate.spin || {};
  return {
    ...hover,
    progress: {
      approach: text(progress.approach, 'exponential'),
      factor: Math.max(0, numberOr(progress.factor, 0.22)),
    },
    transform: {
      ...transform,
      scale: {
        from: numberOr(scale.from, 1),
        to: numberOr(scale.to, 1.08),
      },
      rotate: {
        ...rotate,
        spin: spin === false ? false : {
          axis: text(spin.axis, 'y'),
          rate: Math.max(0, numberOr(spin.rate, 1.45)),
        },
        degrees: {
          x: numberOr(rotate.degrees?.x, 0.12),
          y: numberOr(rotate.degrees?.y, 0),
          z: numberOr(rotate.degrees?.z, 0.055),
        },
      },
    },
  };
}

function normalizeGeometry(item = {}, menu = {}) {
  const geometry = item.geometry;
  if (!isPlainObject(geometry)) return geometry;
  const modelDefaults = menu.defaults?.three?.model || {};
  const partDefaults = menu.defaults?.three?.part || {};
  const next = mergeRadialMenuConfig(modelDefaults, geometry);
  if (Array.isArray(next.parts)) {
    next.parts = next.parts.map((part) => (
      isPlainObject(part)
        ? mergeRadialMenuConfig(partDefaults, part)
        : cloneRadialMenuConfig(part)
    ));
  }
  return next;
}

function normalizeEffects(item = {}, menu = {}) {
  if (!Array.isArray(item.effects)) return item.effects;
  const effectDefaults = menu.defaults?.three?.effect || {};
  return item.effects.map((effect) => (
    isPlainObject(effect)
      ? mergeRadialMenuConfig(effectDefaults, effect)
      : cloneRadialMenuConfig(effect)
  ));
}

function normalizeItem(item = {}, menu = {}) {
  const itemDefaults = menu.defaults?.item || {};
  const threeItemDefaults = menu.defaults?.three?.item || {};
  const base = mergeRadialMenuConfig(itemDefaults, item);
  base.three = mergeRadialMenuConfig(
    { item: threeItemDefaults },
    base.three || {}
  );
  base.geometry = normalizeGeometry(base, menu);
  base.effects = normalizeEffects(base, menu);
  base.three.item.hover = normalizeHoverTransform(base, menu.defaults || {});
  const children = (Array.isArray(base.children) ? base.children : [])
    .filter((child) => isPlainObject(child))
    .map((child) => normalizeItem(child, menu));
  if (children.length > 0) base.children = children;

  base.logical = {
    id: base.id,
    label: base.label,
    action: base.action ?? null,
    disabled: !!base.disabled,
    hidden: !!base.hidden,
    checked: !!base.checked,
    current: !!base.current,
    role: text(base.role, 'menuitem'),
    shortcut: base.shortcut || null,
    typeahead: text(base.typeahead, base.label || base.id),
    close_on_select: base.close_on_select !== false,
    target_surface: cloneRadialMenuConfig(base.target_surface || null),
    action_payload: cloneRadialMenuConfig(base.action_payload || null),
    submenu_ref: base.submenu_ref || null,
    children: children.map((child) => cloneRadialMenuConfig(child.logical)),
  };
  return base;
}

export function validateRadialMenuDefinition(menu = {}) {
  const errors = [];
  if (!isPlainObject(menu)) errors.push('menu must be an object');
  if (menu.kind !== RADIAL_MENU_3D_KIND) errors.push(`kind must be ${RADIAL_MENU_3D_KIND}`);
  if (!text(menu.id)) errors.push('id is required');
  if (!Array.isArray(menu.items)) errors.push('items must be an array');
  for (const [index, item] of (Array.isArray(menu.items) ? menu.items : []).entries()) {
    if (!text(item?.id)) errors.push(`items[${index}].id is required`);
    if (!text(item?.label)) errors.push(`items[${index}].label is required`);
  }
  return { ok: errors.length === 0, errors };
}

export function resolveRadialMenuConfig(menu = {}, {
  base = null,
  allowExtends = {},
  strict = true,
} = {}) {
  const source = cloneRadialMenuConfig(menu);
  let inherited = base;
  if (!inherited && source.extends) inherited = allowExtends[source.extends] || null;
  const merged = inherited
    ? mergeRadialMenuDefinitions(inherited, source)
    : cloneRadialMenuConfig(source);
  merged.kind = text(merged.kind, RADIAL_MENU_3D_KIND);
  merged.schema_version = text(merged.schema_version, RADIAL_MENU_3D_SCHEMA_VERSION);
  merged.items = (Array.isArray(merged.items) ? merged.items : [])
    .map((item) => normalizeItem(item, merged));
  merged.logical_items = merged.items.map((item) => cloneRadialMenuConfig(item.logical));
  const validation = validateRadialMenuDefinition(merged);
  if (strict && !validation.ok) {
    throw new Error(`Invalid radial menu config: ${validation.errors.join('; ')}`);
  }
  merged.validation = validation;
  return merged;
}

export function radialMenuGeometryConfig(menu = {}) {
  return cloneRadialMenuConfig(menu.geometry || {});
}
