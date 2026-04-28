import Stats from './vendor/stats.module.js';

const DEFAULT_OPTIONS = {
  panel: 0,
  mode: 'auto',
  position: 'top-left',
  top: 0,
  left: 0,
  right: null,
  bottom: null,
  zIndex: 2147483000,
  opacity: 0.9,
  scale: 1,
};

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeOptions(options = {}) {
  const next = { ...DEFAULT_OPTIONS };
  if (options && typeof options === 'object') Object.assign(next, options);
  next.panel = Math.max(0, Math.floor(finiteNumber(next.panel) ?? DEFAULT_OPTIONS.panel));
  next.mode = next.mode === 'manual' ? 'manual' : 'auto';
  next.position = typeof next.position === 'string' ? next.position : DEFAULT_OPTIONS.position;
  next.top = finiteNumber(next.top);
  next.left = finiteNumber(next.left);
  next.right = finiteNumber(next.right);
  next.bottom = finiteNumber(next.bottom);
  next.zIndex = Math.floor(finiteNumber(next.zIndex) ?? DEFAULT_OPTIONS.zIndex);
  next.opacity = Math.max(0.1, Math.min(1, finiteNumber(next.opacity) ?? DEFAULT_OPTIONS.opacity));
  next.scale = Math.max(0.25, Math.min(4, finiteNumber(next.scale) ?? DEFAULT_OPTIONS.scale));
  return next;
}

function applyPosition(dom, options) {
  dom.style.position = 'fixed';
  dom.style.zIndex = String(options.zIndex);
  dom.style.opacity = String(options.opacity);
  dom.style.transform = `scale(${options.scale})`;
  dom.style.transformOrigin = 'top left';
  dom.style.pointerEvents = 'auto';
  dom.style.top = '';
  dom.style.left = '';
  dom.style.right = '';
  dom.style.bottom = '';

  const top = options.top ?? 0;
  const left = options.left ?? 0;
  const right = options.right ?? 0;
  const bottom = options.bottom ?? 0;
  if (options.position.includes('bottom')) {
    dom.style.bottom = `${bottom}px`;
  } else {
    dom.style.top = `${top}px`;
  }
  if (options.position.includes('right')) {
    dom.style.right = `${right}px`;
  } else {
    dom.style.left = `${left}px`;
  }
}

function attachCanvasStats(controller = globalThis.window?.aosStats || {}) {
  if (controller.__aosStatsAttached) return controller;

  let stats = null;
  let rafId = null;
  let enabled = false;
  let options = normalizeOptions(controller.__aosStatsOptions || {});
  let lastFrameAt = null;
  let lastBeginAt = null;
  let fpsWindowStartedAt = null;
  let fpsWindowFrames = 0;
  let latestSample = null;

  function ensureStats() {
    if (stats) return stats;
    stats = new Stats();
    stats.dom.dataset.aosStats = 'true';
    stats.dom.dataset.aosStatsCanvasId = controller.canvasId || '';
    stats.dom.setAttribute('aria-label', 'AOS canvas stats');
    stats.dom.title = 'AOS canvas stats';
    applyPosition(stats.dom, options);
    stats.showPanel(options.panel);
    return stats;
  }

  function frame() {
    if (!enabled || options.mode !== 'auto') return;
    const now = performance.now();
    if (lastFrameAt != null) recordSample(now, now - lastFrameAt);
    lastFrameAt = now;
    ensureStats().update();
    rafId = requestAnimationFrame(frame);
  }

  function recordSample(now, frameMs) {
    if (!Number.isFinite(frameMs) || frameMs <= 0) return;
    fpsWindowStartedAt ??= now;
    fpsWindowFrames += 1;
    let fps = latestSample?.fps ?? (1000 / frameMs);
    if (now >= fpsWindowStartedAt + 1000) {
      fps = (fpsWindowFrames * 1000) / (now - fpsWindowStartedAt);
      fpsWindowStartedAt = now;
      fpsWindowFrames = 0;
    }
    latestSample = {
      ts: Date.now(),
      frameMs,
      fps,
      mode: options.mode,
    };
  }

  function startLoop() {
    if (options.mode !== 'auto' || rafId != null) return;
    rafId = requestAnimationFrame(frame);
  }

  function stopLoop() {
    if (rafId == null) return;
    cancelAnimationFrame(rafId);
    rafId = null;
    lastFrameAt = null;
  }

  Object.assign(controller, {
    __aosStatsAttached: true,
    available: true,
    error: null,
    configure(nextOptions = {}) {
      options = normalizeOptions({ ...options, ...(nextOptions || {}) });
      controller.__aosStatsOptions = { ...options };
      if (stats) {
        applyPosition(stats.dom, options);
        stats.showPanel(options.panel);
      }
      if (enabled) {
        stopLoop();
        startLoop();
      }
      return controller.status();
    },
    enable(nextOptions = {}) {
      controller.configure(nextOptions);
      enabled = true;
      const instance = ensureStats();
      if (!instance.dom.isConnected) document.documentElement.appendChild(instance.dom);
      startLoop();
      return controller.status();
    },
    disable() {
      enabled = false;
      stopLoop();
      if (stats?.dom?.isConnected) stats.dom.remove();
      return controller.status();
    },
    toggle(nextOptions = {}) {
      if (typeof nextOptions === 'boolean') return nextOptions ? controller.enable() : controller.disable();
      return enabled ? controller.disable() : controller.enable(nextOptions);
    },
    begin() {
      if (!enabled) return null;
      lastBeginAt = performance.now();
      return ensureStats().begin();
    },
    end() {
      if (!enabled) return null;
      const endedAt = ensureStats().end();
      const startedAt = lastBeginAt ?? endedAt;
      recordSample(endedAt, endedAt - startedAt);
      lastBeginAt = endedAt;
      return endedAt;
    },
    update() {
      if (!enabled) return null;
      return ensureStats().update();
    },
    showPanel(panel) {
      return controller.configure({ panel });
    },
    status() {
      return {
        available: true,
        enabled,
        mode: options.mode,
        panel: options.panel,
        canvasId: controller.canvasId || null,
        segmentDisplayId: controller.segmentDisplayId ?? null,
        connected: !!stats?.dom?.isConnected,
        sample: latestSample ? { ...latestSample } : null,
      };
    },
  });

  if (Array.isArray(controller.__aosStatsQueue)) {
    const queued = controller.__aosStatsQueue.splice(0);
    for (const [method, args] of queued) {
      if (typeof controller[method] === 'function') controller[method](...(args || []));
    }
  }

  return controller;
}

const controller = attachCanvasStats();

export { attachCanvasStats };
export default controller;
