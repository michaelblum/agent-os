function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function rectFromAt(at) {
  if (!Array.isArray(at) || at.length < 4) return null;
  const [x, y, w, h] = at.map(asNumber);
  if ([x, y, w, h].some((value) => value == null)) return null;
  return { x, y, w, h };
}

export function normalizeDisplays(list = []) {
  return list.map((display = {}) => {
    const bounds = display.bounds || {};
    const visible = display.visible_bounds || display.visibleBounds || bounds;
    const width = asNumber(display.width ?? bounds.w ?? bounds.width ?? visible.w ?? visible.width) ?? 0;
    const height = asNumber(display.height ?? bounds.h ?? bounds.height ?? visible.h ?? visible.height) ?? 0;
    return {
      ...display,
      id: display.id ?? display.ordinal ?? display.display_id ?? display.cgID,
      is_main: Boolean(display.is_main),
      scale_factor: asNumber(display.scale_factor ?? display.scaleFactor),
      bounds: {
        x: asNumber(bounds.x) ?? 0,
        y: asNumber(bounds.y) ?? 0,
        w: asNumber(bounds.w ?? bounds.width) ?? width,
        h: asNumber(bounds.h ?? bounds.height) ?? height,
      },
      visibleBounds: {
        x: asNumber(visible.x) ?? asNumber(bounds.x) ?? 0,
        y: asNumber(visible.y) ?? asNumber(bounds.y) ?? 0,
        w: asNumber(visible.w ?? visible.width) ?? width,
        h: asNumber(visible.h ?? visible.height) ?? height,
      },
    };
  });
}

export function labelDisplays(list = []) {
  const displays = normalizeDisplays(list).sort((a, b) => {
    if (a.bounds.y !== b.bounds.y) return a.bounds.y - b.bounds.y;
    return a.bounds.x - b.bounds.x;
  });
  let extendedOrdinal = 0;
  return displays.map((display) => {
    if (display.is_main) {
      return { id: display.id, label: 'main', display };
    }
    extendedOrdinal += 1;
    return { id: display.id, label: `extended [${extendedOrdinal}]`, display };
  });
}

export function computeUnionBounds(displays = []) {
  const normalized = displays.map((entry) => entry.display || entry).filter(Boolean);
  if (normalized.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const display of normalized) {
    minX = Math.min(minX, display.bounds.x);
    minY = Math.min(minY, display.bounds.y);
    maxX = Math.max(maxX, display.bounds.x + display.bounds.w);
    maxY = Math.max(maxY, display.bounds.y + display.bounds.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function translatePoint(point, originRect) {
  if (!point || !originRect) return null;
  const x = asNumber(point.x);
  const y = asNumber(point.y);
  if (x == null || y == null) return null;
  return {
    x: x - originRect.x,
    y: y - originRect.y,
  };
}

export function translateRect(rect, originRect) {
  if (!rect || !originRect) return null;
  return {
    x: rect.x - originRect.x,
    y: rect.y - originRect.y,
    w: rect.w,
    h: rect.h,
  };
}

function pointInDisplay(point, display) {
  if (!point || !display) return false;
  return point.x >= display.bounds.x
    && point.y >= display.bounds.y
    && point.x < display.bounds.x + display.bounds.w
    && point.y < display.bounds.y + display.bounds.h;
}

function rectInDisplay(rect, display) {
  if (!rect || !display) return false;
  return rect.x >= display.bounds.x
    && rect.y >= display.bounds.y
    && rect.x + rect.w <= display.bounds.x + display.bounds.w
    && rect.y + rect.h <= display.bounds.y + display.bounds.h;
}

function ownerLabelForPoint(point, labeledDisplays) {
  const owner = labeledDisplays.find(({ display }) => pointInDisplay(point, display));
  return owner?.label ?? 'union';
}

function ownerLabelForRect(rect, labeledDisplays) {
  const owner = labeledDisplays.find(({ display }) => rectInDisplay(rect, display));
  return owner?.label ?? 'union';
}

function marksEntries(marksByCanvas) {
  if (!marksByCanvas) return [];
  if (typeof marksByCanvas.entries === 'function') {
    return [...marksByCanvas.entries()];
  }
  return Object.entries(marksByCanvas);
}

export function formatPoint(point) {
  if (!point) return '—';
  return `${Math.round(point.x)},${Math.round(point.y)}`;
}

export function formatRect(rect) {
  if (!rect) return '—';
  return `${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.w)},${Math.round(rect.h)}`;
}

export function buildSpatialTelemetrySnapshot({
  displays = [],
  canvases = [],
  cursor = { valid: false },
  marksByCanvas = new Map(),
} = {}) {
  const labeledDisplays = labelDisplays(displays);
  const union = computeUnionBounds(labeledDisplays);
  const displayColumns = labeledDisplays.map(({ id, label, display }) => ({
    id,
    label,
    bounds: display.bounds,
  }));
  const canvasById = new Map((canvases || []).map((canvas) => [canvas.id, canvas]));

  const displayRows = labeledDisplays.map(({ label, display }) => ({
    id: String(display.id),
    label,
    scale_factor: display.scale_factor,
    bounds: display.bounds,
    boundsUnionLocal: union ? translateRect(display.bounds, union) : null,
    visibleBounds: display.visibleBounds,
    visibleUnionLocal: union ? translateRect(display.visibleBounds, union) : null,
  }));

  const canvasRows = (canvases || []).map((canvas) => {
    const globalRect = rectFromAt(canvas.at);
    const parentRect = rectFromAt(canvas.parent ? canvasById.get(canvas.parent)?.at : null);
    const parentLocal = globalRect && parentRect ? translateRect(globalRect, parentRect) : null;
    const perDisplay = Object.fromEntries(displayColumns.map((column) => [
      column.id,
      globalRect ? translateRect(globalRect, column.bounds) : null,
    ]));
    return {
      id: canvas.id,
      parent: canvas.parent || null,
      track: canvas.track || null,
      interactive: Boolean(canvas.interactive),
      scope: canvas.scope || null,
      globalRect,
      unionLocal: union ? translateRect(globalRect, union) : null,
      parentLocal,
      owner: ownerLabelForRect(globalRect, labeledDisplays),
      perDisplay,
    };
  });

  const markRows = [];
  for (const [canvasId, entry] of marksEntries(marksByCanvas)) {
    const ownerCanvas = canvasById.get(canvasId);
    const canvasRect = rectFromAt(ownerCanvas?.at);
    for (const mark of entry?.marks || []) {
      const point = {
        x: asNumber(mark.x) ?? 0,
        y: asNumber(mark.y) ?? 0,
      };
      const perDisplay = Object.fromEntries(displayColumns.map((column) => [
        column.id,
        translatePoint(point, column.bounds),
      ]));
      markRows.push({
        canvasId,
        id: mark.id,
        name: mark.name || mark.id,
        globalPoint: point,
        unionLocal: union ? translatePoint(point, union) : null,
        canvasLocal: canvasRect ? translatePoint(point, canvasRect) : null,
        owner: ownerLabelForPoint(point, labeledDisplays),
        perDisplay,
      });
    }
  }

  const cursorPoint = cursor?.valid ? {
    x: asNumber(cursor.x) ?? 0,
    y: asNumber(cursor.y) ?? 0,
  } : null;

  const cursorRow = cursorPoint ? {
    globalPoint: cursorPoint,
    unionLocal: union ? translatePoint(cursorPoint, union) : null,
    owner: ownerLabelForPoint(cursorPoint, labeledDisplays),
    perDisplay: Object.fromEntries(displayColumns.map((column) => [
      column.id,
      translatePoint(cursorPoint, column.bounds),
    ])),
  } : null;

  return {
    union,
    displayColumns,
    displayRows,
    canvasRows,
    markRows,
    cursorRow,
  };
}
