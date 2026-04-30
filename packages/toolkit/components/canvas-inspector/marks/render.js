// Primitive composition renderer for marks.
//
// A mark is drawn as an SVG composed of up to three layers:
//   - outer rect outline (rect: true)
//   - inscribed ellipse (ellipse: true)
//   - corner-to-corner X crosshair (cross: true)
// Layers are drawn in that order so cross appears on top.
// Stroke is centered inside a (w × h) bounding box so outer pixels fit.

import { canvasInspectorAosRef, semanticAttrString } from '../semantics.js';

const STROKE = 1;

function escAttr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escText(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function markSemanticAttrs(mark, canvasId) {
  return semanticAttrString({
    id: `mark-${canvasId}-${mark.id}`,
    role: 'AXImage',
    name: mark.name || mark.id,
    aosRef: canvasInspectorAosRef('mark', canvasId, mark.id),
    parentCanvasId: canvasId,
  });
}

// Build the inner layer SVG for a mark given its bounding size + color.
// Exported for unit tests; consumers should prefer renderMinimapMark().
export function buildMarkLayers(mark) {
  const { w, h, color, rect, ellipse, cross } = mark;
  const halfStroke = STROKE / 2;
  const layers = [];
  const col = escAttr(color);

  if (rect) {
    layers.push(
      `<rect x="${halfStroke}" y="${halfStroke}"`
      + ` width="${w - STROKE}" height="${h - STROKE}"`
      + ` fill="none" stroke="${col}" stroke-width="${STROKE}"/>`
    );
  }
  if (ellipse) {
    layers.push(
      `<ellipse cx="${w / 2}" cy="${h / 2}"`
      + ` rx="${(w - STROKE) / 2}" ry="${(h - STROKE) / 2}"`
      + ` fill="none" stroke="${col}" stroke-width="${STROKE}"/>`
    );
  }
  if (cross) {
    layers.push(
      `<line x1="0" y1="0" x2="${w}" y2="${h}" stroke="${col}" stroke-width="${STROKE}"/>`
    );
    layers.push(
      `<line x1="${w}" y1="0" x2="0" y2="${h}" stroke="${col}" stroke-width="${STROKE}"/>`
    );
  }
  return layers.join('');
}

// Render an indented text-only list row for a mark. No swatch, no thumbnail,
// no action buttons — per the object-marks pivot.
export function renderMarkListRow(mark, { showCoords = false } = {}) {
  const coords = showCoords
    ? `<span class="mark-coords">${Math.round(mark.x)},${Math.round(mark.y)}</span>`
    : '';
  return (
    `<div class="mark-row" data-mark-id="${escAttr(mark.id)}">`
    + `<span class="mark-name">${escText(mark.name)}</span>`
    + coords
    + `</div>`
  );
}

// Render a minimap-placed mark as a positioned SVG element.
// `projected` is the center point from projectPointToMinimap.
export function renderMinimapMark(mark, projected, { canvasId = mark.canvasId || 'unknown' } = {}) {
  const { id, name, w, h } = mark;
  const left = Math.round(projected.x - w / 2);
  const top = Math.round(projected.y - h / 2);
  const inner = buildMarkLayers(mark);
  return (
    `<svg class="minimap-mark" ${markSemanticAttrs(mark, canvasId)}`
    + ` data-canvas-id="${escAttr(canvasId)}" data-mark-id="${escAttr(id)}"`
    + ` data-mark-x="${escAttr(mark.x)}" data-mark-y="${escAttr(mark.y)}"`
    + ` style="left:${left}px;top:${top}px;width:${w}px;height:${h}px"`
    + ` viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"`
    + ` xmlns="http://www.w3.org/2000/svg">`
    + `<title>${escText(name)}</title>`
    + inner
    + `</svg>`
  );
}
