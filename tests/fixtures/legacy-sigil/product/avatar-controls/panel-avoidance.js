import { toolkitSpecifier } from '../renderer/live-modules/content-roots.js';

const {
  avoidAnchorPanelOverlap,
  rectOverlapArea,
} = await import(toolkitSpecifier('panel/placement.js', {
  local: '../../../packages/toolkit/panel/placement.js',
}));

export function displayVisibleBoundsForPoint(displays = [], point) {
  return displays.find((entry) => {
    const rect = entry.visibleBounds || entry.visible_bounds || entry.bounds;
    return rect
      && point.x >= rect.x
      && point.y >= rect.y
      && point.x < rect.x + rect.w
      && point.y < rect.y + rect.h;
  })?.visibleBounds
    || displays.find((entry) => {
      const rect = entry.visible_bounds || entry.bounds;
      return rect
        && point.x >= rect.x
        && point.y >= rect.y
        && point.x < rect.x + rect.w
        && point.y < rect.y + rect.h;
    })?.visible_bounds
    || displays.find((entry) => {
      const rect = entry.bounds;
      return rect
        && point.x >= rect.x
        && point.y >= rect.y
        && point.x < rect.x + rect.w
        && point.y < rect.y + rect.h;
    })?.bounds
    || null;
}

export function overlapArea(a, b) {
  return rectOverlapArea(a, b);
}

export function frameToBounds(frame) {
  if (!Array.isArray(frame) || frame.length < 4) return null;
  const [x, y, w, h] = frame.map(Number);
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

export function resolveAvatarPanelAvoidancePosition({
  avatarRect,
  panelRect,
  viewport,
  margin = 12,
} = {}) {
  return avoidAnchorPanelOverlap({
    anchorRect: avatarRect,
    panelRect,
    viewport,
    margin,
  });
}
