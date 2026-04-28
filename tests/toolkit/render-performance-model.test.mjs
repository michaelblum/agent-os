import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appendRenderSample,
  buildSparkline,
  classifyPerformance,
  normalizeRenderSample,
  summarizeRenderPerformance,
} from '../../packages/toolkit/components/render-performance/model.js';

test('normalizeRenderSample accepts common frame timing aliases', () => {
  const sample = normalizeRenderSample({
    source: 'sigil',
    deltaMs: 20,
    renderMs: 8,
    calls: 42,
    memory: { usedJSHeapSize: 1024 },
  }, { now: 1000 });

  assert.equal(sample.source, 'sigil');
  assert.equal(sample.frameMs, 20);
  assert.equal(sample.fps, 50);
  assert.equal(sample.renderMs, 8);
  assert.equal(sample.drawCalls, 42);
  assert.equal(sample.heapUsed, 1024);
  assert.equal(sample.ts, 1000);
});

test('normalizeRenderSample derives frame time from fps', () => {
  const sample = normalizeRenderSample({ fps: 30 }, { now: 2000, source: 'renderer' });

  assert.equal(sample.source, 'renderer');
  assert.equal(Math.round(sample.frameMs), 33);
  assert.equal(sample.fps, 30);
});

test('appendRenderSample enforces the configured sample limit', () => {
  const samples = [];
  appendRenderSample(samples, { frameMs: 10 }, { now: 1, limit: 2 });
  appendRenderSample(samples, { frameMs: 20 }, { now: 2, limit: 2 });
  appendRenderSample(samples, { frameMs: 30 }, { now: 3, limit: 2 });

  assert.deepEqual(samples.map((sample) => sample.frameMs), [20, 30]);
});

test('summarizeRenderPerformance reports fps, p95, budget pressure, and drops', () => {
  const samples = [
    { ts: 1000, frameMs: 16 },
    { ts: 1016, frameMs: 17 },
    { ts: 1033, frameMs: 40 },
    { ts: 1073, frameMs: 80 },
  ];
  const summary = summarizeRenderPerformance(samples, {
    now: 1100,
    targetFps: 60,
    liveWindowMs: 1000,
  });

  assert.equal(Math.round(summary.currentFps), 13);
  assert.equal(Math.round(summary.avgFrameMs), 38);
  assert.equal(summary.p95FrameMs, 80);
  assert.equal(summary.maxFrameMs, 80);
  assert.equal(summary.overBudget, 2);
  assert.equal(summary.longFrames, 1);
  assert.equal(summary.estimatedDropped, 4);
  assert.equal(summary.state, 'hot');
});

test('summarizeRenderPerformance carries renderer-side coarse timing averages', () => {
  const summary = summarizeRenderPerformance([
    { ts: 1000, frameMs: 16, renderMs: 4, updateMs: 2, gpuMs: 5 },
    { ts: 1016, frameMs: 16, renderMs: 6, updateMs: 4, gpuMs: 7 },
  ], { now: 1200 });

  assert.equal(summary.avgRenderMs, 5);
  assert.equal(summary.avgUpdateMs, 3);
  assert.equal(summary.avgGpuMs, 6);
});

test('summarizeRenderPerformance preserves source-provided current fps', () => {
  const summary = summarizeRenderPerformance([
    { ts: 1000, frameMs: 18, fps: 60 },
  ], { now: 1100 });

  assert.equal(summary.currentFps, 60);
  assert.equal(summary.currentFrameMs, 18);
});

test('buildSparkline classifies bar states by frame budget', () => {
  const bars = buildSparkline([
    { frameMs: 10 },
    { frameMs: 20 },
    { frameMs: 40 },
  ], { targetFps: 60 });

  assert.deepEqual(bars.map((bar) => bar.state), ['stable', 'warn', 'hot']);
  assert.ok(bars.every((bar) => bar.ratio > 0 && bar.ratio <= 1));
});

test('classifyPerformance handles idle, warning, and stable states', () => {
  assert.equal(classifyPerformance({}), 'idle');
  assert.equal(classifyPerformance({ currentFps: 60, p95FrameMs: 16, budgetMs: 16.67, overBudgetPct: 2 }), 'stable');
  assert.equal(classifyPerformance({ currentFps: 45, p95FrameMs: 24, budgetMs: 16.67, overBudgetPct: 30 }), 'warn');
});
