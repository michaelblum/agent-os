function boundedSegments(segments) {
  return Array.isArray(segments) ? segments.slice(0, 16) : []
}

function sceneDisplay(segment) {
  return {
    displayId: segment?.display_id ?? null,
    index: segment?.index ?? null,
    bounds: Array.isArray(segment?.dw_bounds) ? segment.dw_bounds.slice(0, 4) : null,
  }
}

export function projectSceneEventTopology(segments) {
  return {
    displays: boundedSegments(segments).map(sceneDisplay),
  }
}

export function projectDesktopWorldDevToolsTopology(segments) {
  return {
    displays: boundedSegments(segments).map((segment) => ({
      ...sceneDisplay(segment),
      nativeBounds: Array.isArray(segment?.native_bounds) ? segment.native_bounds.slice(0, 4) : null,
    })),
  }
}
