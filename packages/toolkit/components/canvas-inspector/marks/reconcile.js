// Per-canvas mark state with TTL + parent-canvas lifecycle eviction.
//
// Shape of state:
//   state = { marksByCanvas: Map<canvas_id, { marks: Mark[], lastSeenAt: number }> }
//
// `normalizedMarks` is expected to be the output of `normalizeMarks`.

export function createMarksState() {
  return { marksByCanvas: new Map() };
}

// Full-snapshot replace. Empty list drops the canvas entry entirely.
// Returns true if the entry set changed (for scheduler teardown signals).
export function applySnapshot(state, canvasId, normalizedMarks, now) {
  if (!normalizedMarks || normalizedMarks.length === 0) {
    return state.marksByCanvas.delete(canvasId);
  }
  state.marksByCanvas.set(canvasId, { marks: normalizedMarks, lastSeenAt: now });
  return true;
}

// Evict on `canvas_lifecycle action:"removed"`.
export function evictCanvas(state, canvasId) {
  return state.marksByCanvas.delete(canvasId);
}

// Drop entries whose lastSeenAt is older than ttlMs.
// Returns the canvas ids that were evicted.
export function sweepExpired(state, now, ttlMs) {
  const evicted = [];
  for (const [canvasId, entry] of state.marksByCanvas) {
    if (now - entry.lastSeenAt > ttlMs) evicted.push(canvasId);
  }
  for (const canvasId of evicted) state.marksByCanvas.delete(canvasId);
  return evicted;
}
