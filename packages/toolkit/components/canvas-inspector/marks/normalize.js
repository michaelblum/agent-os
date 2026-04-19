const MIN_SIZE = 4;
const MAX_SIZE = 128;

const warnedMissingIdByCanvas = new Set(); // `${canvas_id}` one-shot warn
const warnedDupByKey = new Set();          // `${canvas_id}:${id}` one-shot warn

export function stableColorForId(id) {
  // djb2 hash → hue → hsl → hex
  let h = 5381;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) + h + id.charCodeAt(i)) | 0;
  }
  const hue = ((h >>> 0) % 360);
  return hslToHex(hue, 70, 55);
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const c = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return '#' + f(0) + f(8) + f(4);
}

function clampSize(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 20;
  return Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(v)));
}

export function normalizeMarks(canvasId, objects, { warn = console.warn } = {}) {
  if (!Array.isArray(objects)) return [];
  const out = [];
  const seen = new Set();
  let sawMissingId = false;
  for (const raw of objects) {
    if (!raw || typeof raw !== 'object') continue;
    const id = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : null;
    if (!id) {
      if (!sawMissingId) {
        sawMissingId = true;
        const key = `missing-id:${canvasId}`;
        if (!warnedMissingIdByCanvas.has(key)) {
          warnedMissingIdByCanvas.add(key);
          warn(`[canvas-inspector] mark dropped: missing id in canvas ${canvasId}`);
        }
      }
      continue;
    }
    if (seen.has(id)) {
      const key = `${canvasId}:${id}`;
      if (!warnedDupByKey.has(key)) {
        warnedDupByKey.add(key);
        warn(`[canvas-inspector] duplicate mark id dropped: ${canvasId}:${id}`);
      }
      continue;
    }
    seen.add(id);

    const x = Number(raw.x);
    const y = Number(raw.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

    out.push({
      id,
      x, y,
      size: clampSize(raw.size ?? 20),
      color: typeof raw.color === 'string' && raw.color.length ? raw.color : stableColorForId(id),
      name: typeof raw.name === 'string' && raw.name.length ? raw.name : id,
      shape: typeof raw.shape === 'string' ? raw.shape : null,
      icon: typeof raw.icon === 'string' ? raw.icon : null,
      icon_region: raw.icon_region && typeof raw.icon_region === 'object' ? {
        x: Number(raw.icon_region.x),
        y: Number(raw.icon_region.y),
        w: Number(raw.icon_region.w),
        h: Number(raw.icon_region.h),
      } : null,
      icon_hz: clampHz(raw.icon_hz),
    });
  }
  return out;
}

function clampHz(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 1;
  return Math.max(0.1, Math.min(10, v));
}

// test-only: reset the one-shot warn memo
export function __resetWarnMemo() {
  warnedMissingIdByCanvas.clear();
  warnedDupByKey.clear();
}

const UNSAFE_TAG = /<script\b[^>]*>[\s\S]*?<\/script>|<script\b[^>]*\/>/gi;
const UNSAFE_ATTR = /\s(on[a-z]+|xmlns:xlink)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi;
const HREF_ATTR = /\s(xlink:href|href)\s*=\s*("([^"]*)"|'([^']*)')/gi;

export function sanitizeSvg(src) {
  if (typeof src !== 'string') return null;
  const trimmed = src.trim();
  if (!/^<svg\b/i.test(trimmed)) return null;
  let out = trimmed
    .replace(UNSAFE_TAG, '')
    .replace(UNSAFE_ATTR, '');
  out = out.replace(HREF_ATTR, (match, attr, _q, dq, sq) => {
    const val = dq ?? sq ?? '';
    if (/^data:/i.test(val)) return match;
    return '';
  });
  return out;
}
