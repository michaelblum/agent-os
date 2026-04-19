import {
  computeUnionBounds,
  labelDisplays,
  normalizeDisplays,
  ownerLabelForPoint,
  ownerLabelForRect,
  rectFromAt,
  translatePoint,
  translateRect,
} from '../../runtime/spatial.js';

export {
  computeUnionBounds,
  labelDisplays,
  normalizeDisplays,
  rectFromAt,
  translatePoint,
  translateRect,
} from '../../runtime/spatial.js';

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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
