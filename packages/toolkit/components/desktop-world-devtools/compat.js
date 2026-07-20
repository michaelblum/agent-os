import { normalizeDesktopWorldDevToolsSnapshot } from '../../scene/desktop-world-devtools.js';

const STAGE_CANVAS_ID = 'aos-desktop-world-stage';

function rectObject(frame) {
  return { x: frame[0], y: frame[1], w: frame[2], h: frame[3] };
}

export function projectDesktopWorldDevToolsPerformance(input, { now = Date.now() } = {}) {
  const snapshot = normalizeDesktopWorldDevToolsSnapshot(input);
  const performance = snapshot.stage.performance;
  return Object.freeze({
    sequence: snapshot.stage.sequence,
    sample: Object.freeze({
      source: 'desktop-world',
      ts: now,
      fps: performance.currentFps,
      frameMs: performance.currentFps ? 1000 / performance.currentFps : performance.avgFrameMs,
      renderMs: performance.avgRenderMs,
      updateMs: performance.avgUpdateMs,
      gpuMs: performance.avgGpuMs,
      drawCalls: performance.drawCalls,
      triangles: performance.triangles,
      geometries: performance.geometries,
      textures: performance.textures,
      programs: performance.programs,
      backingPixels: performance.backingPixels,
      label: 'DesktopWorld stage',
    }),
  });
}

export function projectDesktopWorldDevToolsSpatial(input) {
  const snapshot = normalizeDesktopWorldDevToolsSnapshot(input);
  const { stage } = snapshot;
  const displays = stage.world.displays.flatMap((display) => {
    const bounds = rectObject(display.bounds);
    if (!display.nativeBounds) return [];
    const nativeBounds = rectObject(display.nativeBounds);
    return [Object.freeze({
      id: display.id,
      is_main: display.index === 0,
      scale_factor: 1,
      bounds: nativeBounds,
      visible_bounds: nativeBounds,
      native_bounds: nativeBounds,
      native_visible_bounds: nativeBounds,
      desktop_world_bounds: bounds,
      visible_desktop_world_bounds: bounds,
    })];
  });
  const canvases = stage.world.hitRegions.map((region) => Object.freeze({
    id: `scene-hit:${region.resourceId}:${region.id}`,
    at: [...region.frame],
    atResolved: [...region.frame],
    at_resolved_coordinate_space: 'desktop_world',
    interactive: region.registered,
    scope: region.resourceId,
    track: 'desktop-world',
  }));
  const marksByCanvas = new Map();
  for (const node of stage.world.nodes) {
    const canvasId = `scene-resource:${node.resourceId}`;
    if (!marksByCanvas.has(canvasId)) marksByCanvas.set(canvasId, { marks: [] });
    marksByCanvas.get(canvasId).marks.push(Object.freeze({
      id: node.id,
      name: node.implementation || node.kind,
      x: node.position[0],
      y: node.position[1],
    }));
  }
  return Object.freeze({ sequence: stage.sequence, displays: Object.freeze(displays), canvases: Object.freeze(canvases), marksByCanvas });
}

export function projectDesktopWorldDevToolsSurfaceResources(input) {
  const snapshot = normalizeDesktopWorldDevToolsSnapshot(input);
  const { stage } = snapshot;
  const regionByAffordance = new Map(stage.world.hitRegions.map((region) => [region.affordanceId, region]));
  const nodeById = new Map(stage.world.nodes.map((node) => [node.id, node]));
  const stageLayers = stage.world.affordances.map((affordance) => {
    const region = regionByAffordance.get(affordance.id);
    const node = nodeById.get(affordance.objectId);
    return Object.freeze({
      id: `scene-affordance:${affordance.resourceId}:${affordance.id}`,
      objectId: affordance.objectId,
      kind: node?.kind || 'scene_affordance',
      label: node?.implementation || affordance.objectId,
      frame: region ? [...region.frame] : null,
      zIndex: affordance.priority,
      ownerCanvasId: STAGE_CANVAS_ID,
      sourceCanvasId: STAGE_CANVAS_ID,
      affordanceId: affordance.id,
      metadata: Object.freeze({
        toolkit_affordance_id: affordance.id,
        desktop_world_resource_id: affordance.resourceId,
      }),
      raw: Object.freeze({}),
    });
  });
  const inputRegions = stage.world.hitRegions.map((region) => Object.freeze({
    id: `scene-hit:${region.resourceId}:${region.id}`,
    ownerCanvasId: STAGE_CANVAS_ID,
    semanticLabel: region.affordanceId,
    consumePolicy: 'captured',
    coordinateSpace: 'desktop_world',
    frame: [...region.frame],
    enabled: region.registered,
    affordanceId: region.affordanceId,
    metadata: Object.freeze({
      toolkit_affordance_id: region.affordanceId,
      desktop_world_resource_id: region.resourceId,
    }),
    raw: Object.freeze({}),
  }));
  return Object.freeze({ sequence: stage.sequence, stageLayers: Object.freeze(stageLayers), inputRegions: Object.freeze(inputRegions) });
}
