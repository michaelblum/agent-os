// Inspector tree model: a hierarchical view of where each canvas and mark
// lives on the desktop. Groups canvases under the display that contains them;
// canvases that track 'union' or span multiple displays sit directly under a
// synthetic 'union' root. Single-display setups skip the union root.
//
// Pure function — no DOM, no side effects. Rendering is a separate concern.

const UNION_ID = '__union__';

function canvasRect(canvas) {
  const at = Array.isArray(canvas?.at) && canvas.at.length >= 4 ? canvas.at : null;
  if (!at) return null;
  const [x, y, w, h] = at.map(Number);
  if (![x, y, w, h].every(Number.isFinite)) return null;
  return { x, y, w, h };
}

function displayContains(display, rect) {
  const b = display.bounds;
  if (!b) return false;
  return rect.x >= b.x
      && rect.y >= b.y
      && rect.x + rect.w <= b.x + b.w
      && rect.y + rect.h <= b.y + b.h;
}

function findOwningDisplay(canvas, displays) {
  const rect = canvasRect(canvas);
  if (!rect) return null;
  for (const d of displays) {
    if (displayContains(d, rect)) return d;
  }
  return null;
}

// Canvas belongs to the union root when:
//   - the consumer tracked it to 'union', or
//   - its rect spans (or lies outside) every display's bounds, or
//   - it has no resolvable rect at all.
function canvasBelongsToUnion(canvas, displays) {
  if (canvas?.track === 'union') return true;
  if (!canvasRect(canvas)) return true;
  return findOwningDisplay(canvas, displays) == null;
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
  const sortedDisplays = [...displays].sort((a, b) => {
    const ay = a?.bounds?.y ?? 0;
    const by = b?.bounds?.y ?? 0;
    if (ay !== by) return ay - by;
    return (a?.bounds?.x ?? 0) - (b?.bounds?.x ?? 0);
  });

  // First non-main display is "extended"; additional get numbered from 2.
  let extendedCount = 0;
  const labeled = sortedDisplays.map(d => {
    const isMain = Boolean(d.is_main);
    let label;
    if (isMain) {
      label = 'main';
    } else {
      extendedCount++;
      label = extendedCount === 1 ? 'extended' : `extended ${extendedCount}`;
    }
    return { display: d, label, isMain };
  });

  const singleDisplay = displays.length === 1;
  const perDisplay = new Map();
  const unionCanvases = [];

  for (const c of canvases) {
    if (!singleDisplay && canvasBelongsToUnion(c, displays)) {
      unionCanvases.push(c);
      continue;
    }
    const owner = findOwningDisplay(c, displays) || displays[0];
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
