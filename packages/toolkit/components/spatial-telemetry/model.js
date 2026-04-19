import {
  computeDesktopWorldBounds,
  computeNativeDesktopBounds,
  computeVisibleDesktopWorldBounds,
  computeUnionBounds,
  nativeToDesktopWorldPoint,
  nativeToDesktopWorldRect,
  labelDisplays,
  normalizeDisplays,
  ownerLabelForPoint,
  ownerLabelForRect,
  rectFromAt,
  resolveCanvasFrames,
  translatePoint,
  translateRect,
} from '../../runtime/spatial.js';

export {
  computeDesktopWorldBounds,
  computeNativeDesktopBounds,
  computeVisibleDesktopWorldBounds,
  computeUnionBounds,
  labelDisplays,
  nativeToDesktopWorldPoint,
  nativeToDesktopWorldRect,
  normalizeDisplays,
  rectFromAt,
  resolveCanvasFrames,
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
  const normalizedDisplays = normalizeDisplays(displays);
  const labeledDisplays = labelDisplays(normalizedDisplays);
  const desktopWorld = computeDesktopWorldBounds(labeledDisplays);
  const visibleDesktopWorld = computeVisibleDesktopWorldBounds(labeledDisplays);
  const nativeDesktopBounds = computeNativeDesktopBounds(labeledDisplays);
  const displayColumns = labeledDisplays.map(({ id, label, display }) => ({
    id,
    label,
    bounds: display.bounds,
  }));
  const resolvedCanvases = resolveCanvasFrames(canvases || []).map((canvas) => ({
    ...canvas,
    worldRect: nativeToDesktopWorldRect(rectFromAt(canvas.atResolved ?? canvas.at), nativeDesktopBounds),
  }));
  const canvasById = new Map(resolvedCanvases.map((canvas) => [canvas.id, canvas]));

  const displayRows = labeledDisplays.map(({ label, display }) => ({
    id: String(display.id),
    label,
    scale_factor: display.scale_factor,
    bounds: display.bounds,
    boundsDesktopWorld: desktopWorld ? translateRect(display.bounds, desktopWorld) : null,
    visibleBounds: display.visibleBounds,
    visibleDesktopWorld: visibleDesktopWorld ? translateRect(display.visibleBounds, visibleDesktopWorld) : null,
    nativeBounds: display.nativeBounds,
    nativeVisibleBounds: display.nativeVisibleBounds,
  }));

  const canvasRows = resolvedCanvases.map((canvas) => {
    const worldRect = canvas.worldRect;
    const parentRect = canvas.parent ? canvasById.get(canvas.parent)?.worldRect : null;
    const parentLocal = worldRect && parentRect ? translateRect(worldRect, parentRect) : null;
    const perDisplay = Object.fromEntries(displayColumns.map((column) => [
      column.id,
      worldRect ? translateRect(worldRect, column.bounds) : null,
    ]));
    return {
      id: canvas.id,
      parent: canvas.parent || null,
      track: canvas.track || null,
      interactive: Boolean(canvas.interactive),
      scope: canvas.scope || null,
      worldRect,
      desktopWorldLocal: desktopWorld ? translateRect(worldRect, desktopWorld) : null,
      parentLocal,
      owner: ownerLabelForRect(worldRect, labeledDisplays),
      perDisplay,
    };
  });

  const markRows = [];
  for (const [canvasId, entry] of marksEntries(marksByCanvas)) {
    const ownerCanvas = canvasById.get(canvasId);
    const canvasRect = ownerCanvas?.worldRect ?? null;
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
        worldPoint: point,
        desktopWorldLocal: desktopWorld ? translatePoint(point, desktopWorld) : null,
        canvasLocal: canvasRect ? translatePoint(point, canvasRect) : null,
        owner: ownerLabelForPoint(point, labeledDisplays),
        perDisplay,
      });
    }
  }

  const rawCursorPoint = cursor?.valid ? {
    x: asNumber(cursor.x) ?? 0,
    y: asNumber(cursor.y) ?? 0,
  } : null;
  const cursorPoint = rawCursorPoint ? nativeToDesktopWorldPoint(rawCursorPoint, nativeDesktopBounds) : null;

  const cursorRow = cursorPoint ? {
    worldPoint: cursorPoint,
    desktopWorldLocal: desktopWorld ? translatePoint(cursorPoint, desktopWorld) : null,
    owner: ownerLabelForPoint(cursorPoint, labeledDisplays),
    perDisplay: Object.fromEntries(displayColumns.map((column) => [
      column.id,
      translatePoint(cursorPoint, column.bounds),
    ])),
  } : null;

  return {
    desktopWorld,
    visibleDesktopWorld,
    nativeDesktopBounds,
    displayColumns,
    displayRows,
    canvasRows,
    markRows,
    cursorRow,
  };
}
