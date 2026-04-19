import { sweepExpired } from './reconcile.js';

// Drives periodic TTL sweeps. Auto-stops when state is empty so idle inspectors
// don't burn a 100ms tick forever. Callers should call start() after
// applySnapshot so a fresh emission re-arms the tick.

const DEFAULT_TTL_MS = 10_000;
const DEFAULT_INTERVAL_MS = 100;

export function createScheduler({
  state,
  onChange,
  ttlMs = DEFAULT_TTL_MS,
  intervalMs = DEFAULT_INTERVAL_MS,
  setInterval: si = setInterval,
  clearInterval: ci = clearInterval,
  now = Date.now,
} = {}) {
  if (!state) throw new Error('createScheduler: state is required');

  let handle = null;

  function tick() {
    const evicted = sweepExpired(state, now(), ttlMs);
    if (evicted.length > 0 && typeof onChange === 'function') onChange(evicted);
    if (state.marksByCanvas.size === 0) stop();
  }

  function start() {
    if (handle != null) return;
    handle = si(tick, intervalMs);
  }

  function stop() {
    if (handle == null) return;
    ci(handle);
    handle = null;
  }

  function isRunning() {
    return handle != null;
  }

  return { tick, start, stop, isRunning };
}
