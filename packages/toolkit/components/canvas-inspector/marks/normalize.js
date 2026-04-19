const MIN_DIM = 4;
const MAX_DIM = 128;
const DEFAULT_DIM = 20;

const warnedMissingIdByCanvas = new Set(); // `missing-id:${canvas_id}` one-shot warn
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

function clampDim(n, fallback = DEFAULT_DIM) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(MIN_DIM, Math.min(MAX_DIM, Math.round(v)));
}

function normBool(v, fallback) {
  if (v === undefined || v === null) return fallback;
  return Boolean(v);
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
      w: clampDim(raw.w),
      h: clampDim(raw.h),
      color: typeof raw.color === 'string' && raw.color.length ? raw.color : stableColorForId(id),
      name: typeof raw.name === 'string' && raw.name.length ? raw.name : id,
      rect: normBool(raw.rect, true),
      ellipse: normBool(raw.ellipse, true),
      cross: normBool(raw.cross, true),
    });
  }
  return out;
}

// test-only: reset the one-shot warn memo
export function __resetWarnMemo() {
  warnedMissingIdByCanvas.clear();
  warnedDupByKey.clear();
}
