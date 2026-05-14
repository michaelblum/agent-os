import { ownerDocument } from './_events.js';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatMs(ms) {
  const remaining = Math.max(0, ms);
  if (remaining < 10000) return `${(remaining / 1000).toFixed(1)}s`;
  const totalSeconds = Math.ceil(remaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function createTimerBar(config = {}) {
  const doc = ownerDocument(config);
  const win = doc.defaultView || globalThis;
  const totalMs = Math.max(0, Number(config.totalMs ?? 0));
  const direction = config.direction === 'countUp' ? 'countUp' : 'countDown';
  const display = config.display === 'pie' ? 'pie' : 'digital';
  const flashThresholdMs = Number(config.flashThresholdMs ?? 0);
  const flashIntervalMs = Math.max(1, Number(config.flashIntervalMs ?? 600));
  const el = doc.createElement('div');
  const digital = doc.createElement('span');
  const svg = doc.createElementNS?.('http://www.w3.org/2000/svg', 'svg') || doc.createElement('svg');
  const circle = doc.createElementNS?.('http://www.w3.org/2000/svg', 'circle') || doc.createElement('circle');
  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  let rafId = null;
  let running = false;
  let elapsedMs = direction === 'countDown' ? 0 : 0;
  let startedAt = 0;
  let expired = false;

  el.classList.add('aos-timer-bar');
  el.style.setProperty?.('--aos-timer-flash-interval', `${flashIntervalMs}ms`);
  digital.classList.add('aos-timer-digital');
  svg.classList.add('aos-timer-pie');
  svg.setAttribute('viewBox', '0 0 20 20');
  circle.setAttribute('cx', '10');
  circle.setAttribute('cy', '10');
  circle.setAttribute('r', String(radius));
  circle.setAttribute('pathLength', String(circumference));
  circle.style.strokeDasharray = String(circumference);
  svg.appendChild(circle);
  el.append(display === 'pie' ? svg : digital);

  const now = () => {
    if (typeof config.now === 'function') return config.now();
    return win.performance?.now?.() ?? Date.now();
  };
  const requestFrame = (callback) => (win.requestAnimationFrame || globalThis.requestAnimationFrame)(callback);
  const cancelFrame = (id) => (win.cancelAnimationFrame || globalThis.cancelAnimationFrame)?.(id);

  const remainingForElapsed = () => direction === 'countDown'
    ? clamp(totalMs - elapsedMs, 0, totalMs)
    : clamp(totalMs - elapsedMs, 0, totalMs);

  const render = () => {
    const remaining = remainingForElapsed();
    const progress = totalMs === 0 ? 1 : clamp(elapsedMs / totalMs, 0, 1);
    digital.textContent = formatMs(direction === 'countDown' ? remaining : elapsedMs);
    circle.style.strokeDashoffset = String(circumference * (direction === 'countDown' ? progress : 1 - progress));
    el.classList.toggle('flash', flashThresholdMs > 0 && remaining <= flashThresholdMs && remaining > 0);
  };

  const expireIfNeeded = () => {
    if (expired || elapsedMs < totalMs) return;
    expired = true;
    running = false;
    if (rafId !== null) {
      cancelFrame(rafId);
      rafId = null;
    }
    config.onExpire?.();
  };

  const tick = (time) => {
    if (!running) return;
    elapsedMs = clamp(time - startedAt, 0, totalMs);
    render();
    expireIfNeeded();
    if (running) rafId = requestFrame(tick);
  };

  const start = () => {
    if (running) return;
    expired = false;
    running = true;
    startedAt = now() - elapsedMs;
    rafId = requestFrame(tick);
  };

  const pause = () => {
    if (!running) return;
    running = false;
    if (rafId !== null) cancelFrame(rafId);
    rafId = null;
  };

  const reset = () => {
    pause();
    elapsedMs = 0;
    expired = false;
    render();
  };

  render();

  return {
    el,
    start,
    pause,
    resume: start,
    reset,
    getRemainingMs() {
      return remainingForElapsed();
    },
    destroy() {
      pause();
      el.classList.remove('flash');
    },
  };
}
