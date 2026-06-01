// Inspector tree model: a hierarchical view of where each canvas and mark
// lives on the desktop. Groups canvases under the display that contains them;
// canvases that track 'union' or span multiple displays sit directly under a
// synthetic 'union' root. Single-display setups skip the union root.
//
// Pure function — no DOM, no side effects. Rendering is a separate concern.

import {
  findContainingDisplayForRect,
  labelDisplays,
  normalizeCanvasFrameToDesktopWorld,
} from '../../runtime/spatial.js';

const UNION_ID = '__union__';

// Canvas belongs to the union root when:
//   - the consumer tracked it to 'union', or
//   - its rect spans (or lies outside) every display's bounds, or
//   - it has no resolvable rect at all.
function canvasBelongsToUnion(canvas, displays) {
  const rect = canvasDesktopWorldRect(canvas, displays);
  if (canvas?.track === 'union') return true;
  if (!rect) return true;
  return findContainingDisplayForRect(rect, displays) == null;
}

function canvasDesktopWorldRect(canvas, displays) {
  return normalizeCanvasFrameToDesktopWorld(canvas, displays)?.rect ?? null;
}

function getMarks(marksByCanvas, canvasId) {
  if (!marksByCanvas) return [];
  const entry = typeof marksByCanvas.get === 'function'
    ? marksByCanvas.get(canvasId)
    : marksByCanvas[canvasId];
  return entry?.marks ?? [];
}

function surfaceResourcesForCanvas(surfaceResources, canvasId) {
  if (!surfaceResources) return []
  const affordances = (surfaceResources.affordances || [])
    .filter((affordance) => affordance.ownerCanvasId === canvasId)
    .map((affordance) => ({
      type: 'surface_affordance',
      id: affordance.id,
      label: affordance.id,
      affordance,
      children: [
        ...(surfaceResources.stageLayers || [])
          .filter((layer) => affordance.stageLayerIds.includes(layer.id))
          .map((layer) => ({
            type: 'stage_layer',
            id: layer.id,
            label: layer.label || layer.id,
            stageLayer: layer,
            children: [],
          })),
        ...(surfaceResources.inputRegions || [])
          .filter((region) => affordance.inputRegionIds.includes(region.id))
          .map((region) => ({
            type: 'input_region',
            id: region.id,
            label: region.semanticLabel || region.id,
            inputRegion: region,
            children: [],
          })),
      ],
    }))

  const groupedLayerIds = new Set(affordances.flatMap((affordance) => affordance.affordance.stageLayerIds))
  const groupedRegionIds = new Set(affordances.flatMap((affordance) => affordance.affordance.inputRegionIds))
  return [
    ...affordances,
    ...(surfaceResources.stageLayers || [])
      .filter((layer) => layer.ownerCanvasId === canvasId && !groupedLayerIds.has(layer.id))
      .map((layer) => ({
        type: 'stage_layer',
        id: layer.id,
        label: layer.label || layer.id,
        stageLayer: layer,
        children: [],
      })),
    ...(surfaceResources.inputRegions || [])
      .filter((region) => region.ownerCanvasId === canvasId && !groupedRegionIds.has(region.id))
      .map((region) => ({
        type: 'input_region',
        id: region.id,
        label: region.semanticLabel || region.id,
        inputRegion: region,
        children: [],
      })),
  ]
}

function orphanSurfaceResourceNodes(surfaceResources, canvases = []) {
  if (!surfaceResources) return []
  const canvasIds = new Set(canvases.map((canvas) => canvas.id))
  const orphanAffordances = (surfaceResources.affordances || [])
    .filter((affordance) => affordance.ownerCanvasId && !canvasIds.has(affordance.ownerCanvasId))
    .map((affordance) => ({
      type: 'surface_affordance',
      id: affordance.id,
      label: affordance.id,
      affordance,
      children: [
        ...(surfaceResources.stageLayers || [])
          .filter((layer) => affordance.stageLayerIds.includes(layer.id))
          .map((layer) => ({
            type: 'stage_layer',
            id: layer.id,
            label: layer.label || layer.id,
            stageLayer: layer,
            children: [],
          })),
        ...(surfaceResources.inputRegions || [])
          .filter((region) => affordance.inputRegionIds.includes(region.id))
          .map((region) => ({
            type: 'input_region',
            id: region.id,
            label: region.semanticLabel || region.id,
            inputRegion: region,
            children: [],
          })),
      ],
    }))
  const groupedLayerIds = new Set(orphanAffordances.flatMap((affordance) => affordance.affordance.stageLayerIds))
  const groupedRegionIds = new Set(orphanAffordances.flatMap((affordance) => affordance.affordance.inputRegionIds))
  const orphanLayers = (surfaceResources.stageLayers || [])
    .filter((layer) => layer.ownerCanvasId && !canvasIds.has(layer.ownerCanvasId) && !groupedLayerIds.has(layer.id))
    .map((layer) => ({
      type: 'stage_layer',
      id: layer.id,
      label: layer.label || layer.id,
      stageLayer: layer,
      children: [],
    }))
  const orphanRegions = (surfaceResources.inputRegions || [])
    .filter((region) => region.ownerCanvasId && !canvasIds.has(region.ownerCanvasId) && !groupedRegionIds.has(region.id))
    .map((region) => ({
      type: 'input_region',
      id: region.id,
      label: region.semanticLabel || region.id,
      inputRegion: region,
      children: [],
    }))
  const children = [...orphanAffordances, ...orphanLayers, ...orphanRegions]
  return children.length
    ? [{
      type: 'surface_resource_group',
      id: '__surface_resources__',
      label: 'surface resources',
      children,
    }]
    : []
}

function canvasNode(canvas, marksByCanvas, surfaceResources) {
  const marks = getMarks(marksByCanvas, canvas.id);
  return {
    type: 'canvas',
    id: canvas.id,
    label: canvas.id,
    canvas,
    children: [
      ...surfaceResourcesForCanvas(surfaceResources, canvas.id),
      ...marks.map(mark => ({
        type: 'mark',
        id: mark.id,
        label: mark.name,
        mark,
        children: [],
      })),
    ],
  };
}

export function computeInspectorTree({
  displays = [],
  canvases = [],
  marksByCanvas = new Map(),
  surfaceResources = null,
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
    const owner = findContainingDisplayForRect(canvasDesktopWorldRect(c, displays), displays) || displays[0];
    if (!perDisplay.has(owner.id)) perDisplay.set(owner.id, []);
    perDisplay.get(owner.id).push(c);
  }

  const displayNodes = labeled.map(({ display, label }) => ({
    type: 'display',
    id: display.id,
    label,
    display,
    children: (perDisplay.get(display.id) || []).map(c => canvasNode(c, marksByCanvas, surfaceResources)),
  }));

  const orphanResources = orphanSurfaceResourceNodes(surfaceResources, canvases)

  if (singleDisplay) {
    return {
      ...displayNodes[0],
      children: [
        ...displayNodes[0].children,
        ...orphanResources,
      ],
    };
  }

  return {
    type: 'union',
    id: UNION_ID,
    label: 'union',
    children: [
      ...displayNodes,
      ...orphanResources,
      ...unionCanvases.map(c => canvasNode(c, marksByCanvas, surfaceResources)),
    ],
  };
}
