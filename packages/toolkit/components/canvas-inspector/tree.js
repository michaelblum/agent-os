// Inspector tree model: a hierarchical view of where each canvas and mark
// lives on the desktop. Groups canvases under the display that contains them;
// canvases that track 'union' or span multiple displays sit directly under a
// synthetic 'union' root. Single-display setups skip the union root.
//
// Pure function — no DOM, no side effects. Rendering is a separate concern.

import {
  findContainingDisplayForRect,
  labelDisplays,
  rectFromAt,
} from '../../runtime/spatial.js';

const UNION_ID = '__union__';

// Canvas belongs to the union root when:
//   - the consumer tracked it to 'union', or
//   - its rect spans (or lies outside) every display's bounds, or
//   - it has no resolvable rect at all.
function canvasBelongsToUnion(canvas, displays) {
  if (canvas?.track === 'union') return true;
  if (!rectFromAt(canvas?.at)) return true;
  return findContainingDisplayForRect(rectFromAt(canvas.at), displays) == null;
}

function getMarks(marksByCanvas, canvasId) {
  if (!marksByCanvas) return [];
  const entry = typeof marksByCanvas.get === 'function'
    ? marksByCanvas.get(canvasId)
    : marksByCanvas[canvasId];
  return entry?.marks ?? [];
}

function canvasNode(canvas, marksByCanvas) {
  const marks = getMarks(marksByCanvas, canvas.id);
  return {
    type: 'canvas',
    id: canvas.id,
    label: canvas.id,
    canvas,
    children: marks.map(mark => ({
      type: 'mark',
      id: mark.id,
      label: mark.name,
      mark,
      children: [],
    })),
  };
}

export function computeInspectorTree({
  displays = [],
  canvases = [],
  marksByCanvas = new Map(),
} = {}) {
  if (displays.length === 0) {
    return { type: 'empty', id: null, label: '', children: [] };
  }

  // Spatial ordering: top-to-bottom (y ascending), then left-to-right (x).
  const labeled = labelDisplays(displays);

  const singleDisplay = displays.length === 1;
  const perDisplay = new Map();
  const unionCanvases = [];

  for (const c of canvases) {
    if (!singleDisplay && canvasBelongsToUnion(c, displays)) {
      unionCanvases.push(c);
      continue;
    }
    const owner = findContainingDisplayForRect(rectFromAt(c.at), displays) || displays[0];
    if (!perDisplay.has(owner.id)) perDisplay.set(owner.id, []);
    perDisplay.get(owner.id).push(c);
  }

  const displayNodes = labeled.map(({ display, label }) => ({
    type: 'display',
    id: display.id,
    label,
    display,
    children: (perDisplay.get(display.id) || []).map(c => canvasNode(c, marksByCanvas)),
  }));

  if (singleDisplay) return displayNodes[0];

  return {
    type: 'union',
    id: UNION_ID,
    label: 'union',
    children: [
      ...displayNodes,
      ...unionCanvases.map(c => canvasNode(c, marksByCanvas)),
    ],
  };
}
