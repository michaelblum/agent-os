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

function rectsOverlap(a, b) {
  return !!(a && b
    && a.x < b.x + b.w
    && a.x + a.w > b.x
    && a.y < b.y + b.h
    && a.y + a.h > b.y);
}

export function overlapArea(a, b) {
  if (!rectsOverlap(a, b)) return 0;
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return x * y;
}

function rectCenter(rect) {
  if (!rect) return null;
  return {
    x: rect.x + rect.w / 2,
    y: rect.y + rect.h / 2,
  };
}

export function frameToBounds(frame) {
  if (!Array.isArray(frame) || frame.length < 4) return null;
  const [x, y, w, h] = frame.map(Number);
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clampCenterToViewport(center, size, viewport) {
  if (!center || !viewport) return center;
  const halfW = size.w / 2;
  const halfH = size.h / 2;
  return {
    x: clamp(center.x, viewport.x + halfW, viewport.x + Math.max(halfW, viewport.w - halfW)),
    y: clamp(center.y, viewport.y + halfH, viewport.y + Math.max(halfH, viewport.h - halfH)),
  };
}

export function resolveAvatarPanelAvoidancePosition({
  avatarRect,
  panelRect,
  viewport,
  margin = 12,
} = {}) {
  if (!avatarRect || !panelRect || !viewport) return null;
  if (!rectsOverlap(avatarRect, panelRect)) return null;
  const size = { w: avatarRect.w, h: avatarRect.h };
  const current = rectCenter(avatarRect);
  const candidates = [
    { side: 'left', x: panelRect.x - margin - size.w / 2, y: current.y },
    { side: 'right', x: panelRect.x + panelRect.w + margin + size.w / 2, y: current.y },
    { side: 'above', x: current.x, y: panelRect.y - margin - size.h / 2 },
    { side: 'below', x: current.x, y: panelRect.y + panelRect.h + margin + size.h / 2 },
  ].map((candidate, index) => {
    const center = clampCenterToViewport(candidate, size, viewport);
    const rect = {
      x: center.x - size.w / 2,
      y: center.y - size.h / 2,
      w: size.w,
      h: size.h,
    };
    const dx = center.x - current.x;
    const dy = center.y - current.y;
    return {
      ...center,
      side: candidate.side,
      index,
      rect,
      overlap: overlapArea(rect, panelRect),
      distanceSquared: dx * dx + dy * dy,
    };
  });
  const separated = candidates.filter((candidate) => candidate.overlap === 0);
  const best = (separated.length > 0 ? separated : candidates)
    .sort((a, b) => (
      (a.overlap - b.overlap)
      || (a.distanceSquared - b.distanceSquared)
      || (a.index - b.index)
    ))[0];
  return best ? {
    x: best.x,
    y: best.y,
    side: best.side,
    overlap: best.overlap,
  } : null;
}
