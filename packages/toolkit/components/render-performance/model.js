export const DEFAULT_TARGET_FPS = 60;
export const DEFAULT_SAMPLE_LIMIT = 240;

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function positiveNumber(value) {
  const n = finiteNumber(value);
  return n != null && n > 0 ? n : null;
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return null;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil((p / 100) * sortedValues.length) - 1));
  return sortedValues[index];
}

export function roundMetric(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function formatMetric(value, digits = 1, fallback = '--') {
  if (!Number.isFinite(value)) return fallback;
  return roundMetric(value, digits).toFixed(digits);
}

export function normalizeRenderSample(input = {}, options = {}) {
  const now = finiteNumber(options.now) ?? Date.now();
  const inputTs = finiteNumber(input.ts ?? input.time);
  const ts = inputTs != null && inputTs > 100000000000 ? inputTs : now;
  const source = typeof input.source === 'string' && input.source.trim()
    ? input.source.trim()
    : (typeof options.source === 'string' && options.source.trim() ? options.source.trim() : 'external');
  const fps = positiveNumber(input.fps);
  const frameMs = positiveNumber(input.frameMs)
    ?? positiveNumber(input.deltaMs)
    ?? positiveNumber(input.dt)
    ?? positiveNumber(input.duration)
    ?? (fps ? 1000 / fps : null);
  const renderMs = finiteNumber(input.renderMs);
  const updateMs = finiteNumber(input.updateMs);
  const gpuMs = finiteNumber(input.gpuMs);
  const droppedFrames = finiteNumber(input.droppedFrames);
  const memory = input.memory && typeof input.memory === 'object' ? input.memory : {};

  return {
    ts,
    source,
    frameMs,
    renderMs,
    updateMs,
    gpuMs,
    fps: fps ?? (frameMs ? 1000 / frameMs : null),
    droppedFrames: droppedFrames != null ? Math.max(0, droppedFrames) : null,
    drawCalls: finiteNumber(input.drawCalls ?? input.calls),
    triangles: finiteNumber(input.triangles),
    points: finiteNumber(input.points),
    lines: finiteNumber(input.lines),
    geometries: finiteNumber(input.geometries),
    textures: finiteNumber(input.textures),
    programs: finiteNumber(input.programs),
    heapUsed: finiteNumber(input.heapUsed ?? memory.usedJSHeapSize),
    heapLimit: finiteNumber(input.heapLimit ?? memory.jsHeapSizeLimit),
    label: typeof input.label === 'string' ? input.label : '',
  };
}

export function appendRenderSample(samples, sample, options = {}) {
  const limit = Math.max(1, Math.floor(finiteNumber(options.limit) ?? DEFAULT_SAMPLE_LIMIT));
  const normalized = normalizeRenderSample(sample, options);
  samples.push(normalized);
  while (samples.length > limit) samples.shift();
  return normalized;
}

export function summarizeRenderPerformance(samples = [], options = {}) {
  const targetFps = positiveNumber(options.targetFps) ?? DEFAULT_TARGET_FPS;
  const budgetMs = positiveNumber(options.budgetMs) ?? (1000 / targetFps);
  const longFrameMs = positiveNumber(options.longFrameMs) ?? Math.max(50, budgetMs * 3);
  const overBudgetFrameMs = positiveNumber(options.overBudgetFrameMs) ?? (budgetMs * 1.05);
  const now = finiteNumber(options.now) ?? Date.now();
  const liveWindowMs = positiveNumber(options.liveWindowMs) ?? 4000;
  const recent = samples.filter((sample) => sample && sample.frameMs != null && now - sample.ts <= liveWindowMs);
  const usable = recent.length > 0 ? recent : samples.filter((sample) => sample && sample.frameMs != null);
  const frameValues = usable.map((sample) => sample.frameMs).filter(Number.isFinite);
  const sortedFrameValues = [...frameValues].sort((a, b) => a - b);
  const latest = [...samples].reverse().find((sample) => sample && sample.frameMs != null) ?? null;
  const sum = frameValues.reduce((acc, value) => acc + value, 0);
  const avgFrameMs = frameValues.length ? sum / frameValues.length : null;
  const currentFrameMs = latest?.frameMs ?? null;
  const avgFps = avgFrameMs ? 1000 / avgFrameMs : null;
  const currentFps = Number.isFinite(latest?.fps) ? latest.fps : (currentFrameMs ? 1000 / currentFrameMs : null);
  const p95FrameMs = percentile(sortedFrameValues, 95);
  const maxFrameMs = sortedFrameValues.length ? sortedFrameValues[sortedFrameValues.length - 1] : null;
  const overBudget = frameValues.filter((value) => value > overBudgetFrameMs).length;
  const longFrames = frameValues.filter((value) => value >= longFrameMs).length;
  const estimatedDropped = usable.reduce((acc, sample) => {
    if (Number.isFinite(sample.droppedFrames)) return acc + sample.droppedFrames;
    const over = Math.max(0, Math.floor((sample.frameMs ?? 0) / budgetMs) - 1);
    return acc + over;
  }, 0);
  const renderValues = usable.map((sample) => sample.renderMs).filter(Number.isFinite);
  const updateValues = usable.map((sample) => sample.updateMs).filter(Number.isFinite);
  const gpuValues = usable.map((sample) => sample.gpuMs).filter(Number.isFinite);

  return {
    sampleCount: samples.length,
    liveSampleCount: usable.length,
    targetFps,
    budgetMs,
    currentFps,
    avgFps,
    currentFrameMs,
    avgFrameMs,
    p95FrameMs,
    maxFrameMs,
    overBudget,
    overBudgetPct: frameValues.length ? (overBudget / frameValues.length) * 100 : null,
    longFrames,
    estimatedDropped,
    avgRenderMs: renderValues.length ? renderValues.reduce((a, b) => a + b, 0) / renderValues.length : null,
    avgUpdateMs: updateValues.length ? updateValues.reduce((a, b) => a + b, 0) / updateValues.length : null,
    avgGpuMs: gpuValues.length ? gpuValues.reduce((a, b) => a + b, 0) / gpuValues.length : null,
    latest,
    state: classifyPerformance({ currentFps, p95FrameMs, budgetMs, overBudgetPct: frameValues.length ? (overBudget / frameValues.length) * 100 : null }),
  };
}

export function classifyPerformance({ currentFps, p95FrameMs, budgetMs, overBudgetPct } = {}) {
  if (!Number.isFinite(currentFps) && !Number.isFinite(p95FrameMs)) return 'idle';
  if ((Number.isFinite(p95FrameMs) && p95FrameMs > budgetMs * 2.2)
    || (Number.isFinite(overBudgetPct) && overBudgetPct > 55 && Number.isFinite(p95FrameMs) && p95FrameMs > budgetMs * 1.75)) {
    return 'hot';
  }
  if ((Number.isFinite(p95FrameMs) && p95FrameMs > budgetMs * 1.35)
    || (Number.isFinite(overBudgetPct) && overBudgetPct > 25 && Number.isFinite(p95FrameMs) && p95FrameMs > budgetMs * 1.1)) {
    return 'warn';
  }
  return 'stable';
}

export function buildSparkline(samples = [], options = {}) {
  const limit = Math.max(1, Math.floor(finiteNumber(options.limit) ?? 48));
  const targetFps = positiveNumber(options.targetFps) ?? DEFAULT_TARGET_FPS;
  const budgetMs = positiveNumber(options.budgetMs) ?? (1000 / targetFps);
  const values = samples
    .filter((sample) => sample && Number.isFinite(sample.frameMs))
    .slice(-limit)
    .map((sample) => sample.frameMs);
  const ceiling = Math.max(budgetMs * 3, ...values, 1);
  return values.map((value) => ({
    value,
    ratio: Math.max(0.04, Math.min(1, value / ceiling)),
    state: value > budgetMs * 2 ? 'hot' : (value > budgetMs ? 'warn' : 'stable'),
  }));
}
