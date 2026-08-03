import { esc } from '../../runtime/bridge.js';
import {
  appendRenderSample,
  buildSparkline,
  formatMetric,
  normalizeRenderSample,
  summarizeRenderPerformance,
} from './model.js';
import {
  canonicalDesktopWorldPerformanceSource,
  DESKTOP_WORLD_PERFORMANCE_IDENTITY_LIMITS,
  isCanonicalDesktopWorldPerformanceSource,
  projectDesktopWorldDevToolsPerformance,
} from '../desktop-world-devtools/compat.js';

const BASE_TITLE = 'Render Performance';
const DEFAULT_SOURCE = 'panel';
const DESKTOP_WORLD_STATE_VERSION = 2;
const SAMPLE_LIMIT = 360;
const RENDER_INTERVAL_MS = 250;

function nowMs() {
  return performance?.now ? performance.now() : Date.now();
}

function wallTime() {
  return Date.now();
}

function bytesToMiB(value) {
  if (!Number.isFinite(value)) return '--';
  return `${formatMetric(value / 1048576, 1)} MiB`;
}

function memorySnapshot() {
  const memory = performance?.memory;
  if (!memory) return null;
  return {
    usedJSHeapSize: memory.usedJSHeapSize,
    totalJSHeapSize: memory.totalJSHeapSize,
    jsHeapSizeLimit: memory.jsHeapSizeLimit,
  };
}

function mergeLatestStats(samples) {
  const latest = [...samples].reverse().find((sample) => sample && (
    sample.drawCalls != null
    || sample.triangles != null
    || sample.geometries != null
    || sample.textures != null
    || sample.programs != null
    || sample.heapUsed != null
  ));
  return latest || {};
}

function renderSparkline(samples, targetFps) {
  const bars = buildSparkline(samples, { targetFps, limit: 64 });
  if (bars.length === 0) return '<div class="perf-empty">Waiting for frames</div>';
  return `<div class="perf-sparkline" role="img" aria-label="Frame-time sparkline">${
    bars.map((bar) => (
      `<span class="perf-bar ${esc(bar.state)}" style="height:${Math.round(bar.ratio * 100)}%"></span>`
    )).join('')
  }</div>`;
}

function renderMetric(label, value, unit = '', className = '') {
  return (
    `<div class="perf-metric ${esc(className)}">`
      + `<div class="perf-metric-label">${esc(label)}</div>`
      + `<div class="perf-metric-value">${esc(value)}${unit ? `<span>${esc(unit)}</span>` : ''}</div>`
      + `</div>`
  );
}

function renderSourceSummary(source, samples, options) {
  const summary = summarizeRenderPerformance(samples, options);
  const stats = mergeLatestStats(samples);
  return (
    `<section class="perf-source">`
      + `<header>`
        + `<div><strong>${esc(source)}</strong><span>${summary.liveSampleCount} live / ${summary.sampleCount} samples</span></div>`
        + `<em class="${esc(summary.state)}">${esc(summary.state)}</em>`
      + `</header>`
      + `<div class="perf-grid">`
        + renderMetric('FPS', formatMetric(summary.currentFps, 1), '', 'primary')
        + renderMetric('Frame', formatMetric(summary.currentFrameMs, 1), 'ms')
        + renderMetric('Avg', formatMetric(summary.avgFrameMs, 1), 'ms')
        + renderMetric('P95', formatMetric(summary.p95FrameMs, 1), 'ms')
        + renderMetric('Max', formatMetric(summary.maxFrameMs, 1), 'ms')
        + renderMetric('Over budget', Number.isFinite(summary.overBudgetPct) ? formatMetric(summary.overBudgetPct, 0) : '--', '%')
        + renderMetric('Long frames', String(summary.longFrames ?? 0))
        + renderMetric('Dropped est', String(Math.round(summary.estimatedDropped ?? 0)))
      + `</div>`
      + renderSparkline(samples, summary.targetFps)
      + `<div class="perf-coarse">`
        + `<span>render ${esc(formatMetric(summary.avgRenderMs, 1))} ms</span>`
        + `<span>update ${esc(formatMetric(summary.avgUpdateMs, 1))} ms</span>`
        + `<span>gpu ${esc(formatMetric(summary.avgGpuMs, 1))} ms</span>`
        + `<span>calls ${stats.drawCalls == null ? '--' : esc(String(Math.round(stats.drawCalls)))}</span>`
        + `<span>tris ${stats.triangles == null ? '--' : esc(String(Math.round(stats.triangles)))}</span>`
        + `<span>geo ${stats.geometries == null ? '--' : esc(String(Math.round(stats.geometries)))}</span>`
        + `<span>tex ${stats.textures == null ? '--' : esc(String(Math.round(stats.textures)))}</span>`
      + `</div>`
    + `</section>`
  );
}

function renderEventLog(events) {
  if (events.length === 0) return '<div class="perf-empty">No render marks</div>';
  return (
    `<div class="perf-events" role="log" aria-label="Render marks" aria-live="polite">`
      + events.slice(-24).reverse().map((entry) => (
        `<div class="perf-event">`
          + `<span>${esc(entry.ts)}</span>`
          + `<strong>${esc(entry.type)}</strong>`
          + `<em>${esc(entry.text)}</em>`
        + `</div>`
      )).join('')
    + `</div>`
  );
}

function clockTime(ts) {
  const date = new Date(ts);
  return String(date.getHours()).padStart(2, '0') + ':'
    + String(date.getMinutes()).padStart(2, '0') + ':'
    + String(date.getSeconds()).padStart(2, '0');
}

function restoredDesktopWorldState(value, restoredSources) {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || value.version !== DESKTOP_WORLD_STATE_VERSION
    || !value.publication
    || typeof value.publication !== 'object'
    || Array.isArray(value.publication)
    || !Array.isArray(value.bindings)
    || value.bindings.length > DESKTOP_WORLD_PERFORMANCE_IDENTITY_LIMITS.displays
  ) return null;

  const publication = {};
  for (const field of ['canvasGeneration', 'topologyGeneration', 'sequence', 'stageSnapshotRevision']) {
    const entry = value.publication[field];
    if (!Number.isSafeInteger(entry) || entry < 0) return null;
    publication[field] = entry;
  }

  const bindings = new Map();
  const displayIds = new Set();
  const displayIndexes = new Set();
  for (const binding of value.bindings) {
    if (!binding || typeof binding !== 'object' || Array.isArray(binding)) return null;
    const source = binding.source;
    const canonicalSource = canonicalDesktopWorldPerformanceSource(binding);
    if (
      typeof source !== 'string'
      || source.length < 1
      || source.length > DESKTOP_WORLD_PERFORMANCE_IDENTITY_LIMITS.source
      || source !== canonicalSource
      || bindings.has(source)
      || displayIds.has(binding.displayId)
      || displayIndexes.has(binding.displayIndex)
      || !restoredSources.has(source)
    ) return null;
    bindings.set(source, {
      source,
      displayId: binding.displayId,
      displayIndex: binding.displayIndex,
    });
    displayIds.add(binding.displayId);
    displayIndexes.add(binding.displayIndex);
  }
  return { publication, bindings };
}

export default function RenderPerformance(options = {}) {
  let host = null;
  let root = null;
  let rafId = null;
  let lastFrameAt = null;
  let lastRenderAt = 0;
  let targetFps = Number.isFinite(options.targetFps) ? options.targetFps : 60;
  let desktopWorldPublication = null;
  const sources = new Map();
  const desktopWorldBindings = new Map();
  const events = [];
  const bootAt = wallTime();

  function sourceSamples(source = DEFAULT_SOURCE) {
    if (!sources.has(source)) sources.set(source, []);
    return sources.get(source);
  }

  function appendSample(sample, source = DEFAULT_SOURCE) {
    const normalized = appendRenderSample(sourceSamples(source), sample, {
      source,
      limit: SAMPLE_LIMIT,
      now: wallTime(),
    });
    return normalized;
  }

  function appendGenericSample(sample, source) {
    if (isCanonicalDesktopWorldPerformanceSource(source)) return false;
    appendSample(sample, source);
    return true;
  }

  function appendEvent(type, text) {
    events.push({ ts: clockTime(wallTime()), type, text });
    while (events.length > 80) events.shift();
  }

  function isNewerDesktopWorldPublication(projection) {
    if (!desktopWorldPublication) return true;
    if (
      desktopWorldPublication.stageSnapshotRevision > 0
      || projection.stageSnapshotRevision > 0
    ) {
      return projection.stageSnapshotRevision > desktopWorldPublication.stageSnapshotRevision;
    }
    const sameLifecycle = projection.canvasGeneration === desktopWorldPublication.canvasGeneration
      && projection.topologyGeneration === desktopWorldPublication.topologyGeneration;
    if (!sameLifecycle) return true;
    return projection.sequence > desktopWorldPublication.sequence;
  }

  function recordPanelFrame(ts) {
    if (lastFrameAt != null) {
      appendSample({
        source: DEFAULT_SOURCE,
        ts: wallTime(),
        frameMs: ts - lastFrameAt,
        memory: memorySnapshot(),
      }, DEFAULT_SOURCE);
    }
    lastFrameAt = ts;
    if (ts - lastRenderAt >= RENDER_INTERVAL_MS) {
      lastRenderAt = ts;
      renderState();
    }
    rafId = requestAnimationFrame(recordPanelFrame);
  }

  function start() {
    if (rafId != null) return;
    lastFrameAt = null;
    rafId = requestAnimationFrame(recordPanelFrame);
  }

  function stop() {
    if (rafId == null) return;
    cancelAnimationFrame(rafId);
    rafId = null;
    lastFrameAt = null;
  }

  function updateTitle() {
    if (!host) return;
    const panel = summarizeRenderPerformance(sourceSamples(DEFAULT_SOURCE), { targetFps });
    const fps = Number.isFinite(panel.currentFps) ? `${formatMetric(panel.currentFps, 0)} fps` : 'idle';
    host.setTitle(`${BASE_TITLE} - ${fps}`);
  }

  function coarseRows() {
    const memory = memorySnapshot();
    const nav = typeof navigator !== 'undefined' ? navigator : {};
    return [
      ['visibility', document.visibilityState || 'visible'],
      ['device pixel ratio', formatMetric(window.devicePixelRatio || 1, 2)],
      ['viewport', `${window.innerWidth} x ${window.innerHeight}`],
      ['uptime', `${Math.round((wallTime() - bootAt) / 1000)}s`],
      ['sources', String(sources.size)],
      ['heap used', memory ? bytesToMiB(memory.usedJSHeapSize) : '--'],
      ['heap total', memory ? bytesToMiB(memory.totalJSHeapSize) : '--'],
      ['heap limit', memory ? bytesToMiB(memory.jsHeapSizeLimit) : '--'],
      ['cores', nav.hardwareConcurrency == null ? '--' : String(nav.hardwareConcurrency)],
    ];
  }

  function renderState() {
    if (!root) return;
    const entries = [...sources.entries()];
    const panelSummary = summarizeRenderPerformance(sourceSamples(DEFAULT_SOURCE), { targetFps });
    root.innerHTML = (
      `<div class="render-performance-body">`
        + `<header class="perf-header">`
          + `<div><span>Live FPS</span><strong>${esc(formatMetric(panelSummary.currentFps, 1))}</strong></div>`
          + `<div><span>Frame budget</span><strong>${esc(formatMetric(panelSummary.budgetMs, 2))}<em>ms</em></strong></div>`
          + `<div><span>Health</span><strong class="${esc(panelSummary.state)}">${esc(panelSummary.state)}</strong></div>`
        + `</header>`
        + `<div class="perf-sources">`
          + entries.map(([source, samples]) => renderSourceSummary(source, samples, { targetFps })).join('')
        + `</div>`
        + `<section class="perf-section">`
          + `<h3>Coarse Telemetry</h3>`
          + `<div class="perf-kv">${coarseRows().map(([key, value]) => `<span>${esc(key)}</span><strong>${esc(value)}</strong>`).join('')}</div>`
        + `</section>`
        + `<section class="perf-section">`
          + `<h3>Render Marks</h3>`
          + renderEventLog(events)
        + `</section>`
      + `</div>`
    );
    updateTitle();
    window.__renderPerformanceState = serializeState();
  }

  function serializeState() {
    return {
      targetFps,
      sources: Object.fromEntries([...sources.entries()].map(([source, samples]) => [
        source,
        {
          summary: summarizeRenderPerformance(samples, { targetFps }),
          samples: samples.slice(-SAMPLE_LIMIT),
        },
      ])),
      desktopWorld: desktopWorldPublication ? {
        version: DESKTOP_WORLD_STATE_VERSION,
        publication: { ...desktopWorldPublication },
        bindings: [...desktopWorldBindings.values()].map((binding) => ({ ...binding })),
      } : null,
      events: [...events],
    };
  }

  return {
    manifest: {
      name: 'render-performance',
      title: BASE_TITLE,
      accepts: ['sample', 'frame', 'metrics', 'mark', 'reset', 'target_fps', 'desktop_world_devtools.snapshot'],
      emits: [],
      channelPrefix: 'render-performance',
      defaultSize: { w: 520, h: 520 },
    },

    render(host_) {
      host = host_;
      host.contentEl.style.overflow = 'hidden';
      root = document.createElement('div');
      root.className = 'render-performance-root';
      root.setAttribute('role', 'region');
      root.setAttribute('aria-label', BASE_TITLE);
      root.innerHTML = '<div class="perf-empty">Waiting for frames</div>';
      window.__renderPerformanceDebug = {
        sample(payload = {}) {
          const source = payload.source || 'debug';
          if (appendGenericSample(normalizeRenderSample(payload, { source }), source)) renderState();
        },
        reset() {
          sources.clear();
          events.length = 0;
          renderState();
        },
      };
      document.addEventListener('visibilitychange', () => {
        appendEvent('visibility', document.visibilityState || 'visible');
        if (document.visibilityState === 'hidden') stop();
        else start();
        renderState();
      });
      start();
      renderState();
      return root;
    },

    onMessage(msg) {
      const payload = msg.payload || msg;
      if (msg.type === 'desktop_world_devtools.snapshot') {
        const projection = projectDesktopWorldDevToolsPerformance(payload);
        if (!isNewerDesktopWorldPublication(projection)) return;
        const nextBindings = new Map(projection.displays.map((display) => [
          display.sample.source,
          {
            source: display.sample.source,
            displayId: display.displayId,
            displayIndex: display.displayIndex,
          },
        ]));
        for (const source of nextBindings.keys()) {
          if (sources.has(source) && !desktopWorldBindings.has(source)) return;
        }
        desktopWorldPublication = {
          canvasGeneration: projection.canvasGeneration,
          topologyGeneration: projection.topologyGeneration,
          sequence: projection.sequence,
          stageSnapshotRevision: projection.stageSnapshotRevision,
        };
        for (const source of desktopWorldBindings.keys()) {
          if (!nextBindings.has(source)) sources.delete(source);
        }
        desktopWorldBindings.clear();
        for (const display of projection.displays) {
          desktopWorldBindings.set(display.sample.source, nextBindings.get(display.sample.source));
          appendSample(display.sample, display.sample.source);
        }
        renderState();
        return;
      }
      if (msg.type === 'sample' || msg.type === 'frame' || msg.type === 'metrics') {
        const source = payload.source || 'external';
        if (!appendGenericSample(payload, source)) return;
        if (msg.type === 'metrics' && !payload.frameMs && !payload.fps) {
          appendEvent('metrics', `updated ${source}`);
        }
        renderState();
        return;
      }
      if (msg.type === 'mark') {
        appendEvent(payload.type || 'mark', payload.text || payload.label || '');
        renderState();
        return;
      }
      if (msg.type === 'target_fps') {
        const next = Number(payload.value ?? payload.targetFps ?? payload);
        if (Number.isFinite(next) && next > 0) targetFps = next;
        renderState();
        return;
      }
      if (msg.type === 'reset') {
        sources.clear();
        desktopWorldBindings.clear();
        desktopWorldPublication = null;
        events.length = 0;
        renderState();
      }
    },

    serialize: serializeState,

    restore(state) {
      if (!state || typeof state !== 'object') return;
      if (Number.isFinite(state.targetFps) && state.targetFps > 0) targetFps = state.targetFps;
      sources.clear();
      for (const [source, entry] of Object.entries(state.sources || {})) {
        const samples = Array.isArray(entry?.samples) ? entry.samples.slice(-SAMPLE_LIMIT) : [];
        sources.set(source, samples);
      }
      desktopWorldBindings.clear();
      desktopWorldPublication = null;
      const restoredDesktopWorld = restoredDesktopWorldState(state.desktopWorld, sources);
      if (restoredDesktopWorld) {
        desktopWorldPublication = restoredDesktopWorld.publication;
        for (const [source, binding] of restoredDesktopWorld.bindings) {
          desktopWorldBindings.set(source, binding);
        }
      }
      events.length = 0;
      if (Array.isArray(state.events)) events.push(...state.events.slice(-80));
      renderState();
    },
  };
}
