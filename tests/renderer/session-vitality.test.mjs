import assert from 'node:assert/strict';
import test from 'node:test';

import {
  contextRatiosFromTelemetry,
  createSessionVitalityController,
  factorsFromTelemetry,
  refreshFactors,
} from '../../apps/sigil/renderer/session-vitality.js';

function metric(value, source = {}) {
  return {
    value,
    unit: 'ratio',
    source: {
      kind: 'provider_statusline',
      provider_surface: 'test',
      stability: 'documented',
      precision: 'exact',
      ...source,
    },
  };
}

test('unknown context telemetry stays neutral', () => {
  const factors = factorsFromTelemetry({
    type: 'agent.session.telemetry',
    context: {},
  });

  assert.equal(factors.pressure, null);
  assert.equal(factors.confidence, 0);
  assert.equal(factors.auraReachMultiplier, 1);
  assert.equal(factors.rotationMultiplier, 1);
  assert.equal(factors.scaleMultiplier, 1);
});

test('context ratios derive from raw ratio metrics before visual factors', () => {
  const telemetry = {
    type: 'agent.session.telemetry',
    context: {
      used_ratio: metric(0.84),
    },
  };

  const ratios = contextRatiosFromTelemetry(telemetry);
  assert.equal(ratios.usedRatio, 0.84);
  assert.equal(ratios.remainingRatio, 0.16000000000000003);
  assert.equal(ratios.confidence, 1);

  const factors = factorsFromTelemetry(telemetry);
  assert.equal(factors.pressure, 0.84);
  assert.ok(factors.auraReachMultiplier < 1);
  assert.ok(factors.auraIntensityMultiplier < 1);
  assert.ok(factors.rotationMultiplier < 1);
  assert.ok(factors.flickerAmount > 0);
});

test('context ratios can derive from token counts when ratios are absent', () => {
  const ratios = contextRatiosFromTelemetry({
    type: 'agent.session.telemetry',
    context: {
      used_tokens: metric(75, { precision: 'derived' }),
      window_tokens: metric(100),
    },
  });

  assert.equal(ratios.usedRatio, 0.75);
  assert.equal(ratios.remainingRatio, 0.25);
  assert.equal(ratios.confidence, 0.78);
});

test('context confidence follows the metric used for pressure', () => {
  const ratios = contextRatiosFromTelemetry({
    type: 'agent.session.telemetry',
    context: {
      used_ratio: metric(0.5),
      used_tokens: metric(80, { precision: 'estimated' }),
      window_tokens: metric(100, { precision: 'estimated' }),
    },
  });

  assert.equal(ratios.usedRatio, 0.5);
  assert.equal(ratios.confidence, 1);
});

test('refresh lifecycle produces collapse and rebound scale factors', () => {
  const collapse = refreshFactors(240, 1200);
  assert.equal(collapse.active, true);
  assert.ok(collapse.scaleMultiplier < 1);
  assert.ok(collapse.auraReachBoost > 0);

  const rebound = refreshFactors(840, 1200);
  assert.equal(rebound.active, true);
  assert.ok(rebound.scaleMultiplier > collapse.scaleMultiplier);

  const complete = refreshFactors(1400, 1200);
  assert.equal(complete.active, false);
  assert.equal(complete.scaleMultiplier, 1);
});

test('controller accepts raw telemetry and lifecycle events without shared phase names', () => {
  let now = 1000;
  const controller = createSessionVitalityController({
    now: () => now,
    refreshDurationMs: 1000,
  });

  controller.applyTelemetry({
    type: 'agent.session.telemetry',
    context: {
      remaining_ratio: metric(0.1),
    },
  });
  let frame = controller.tick(0, now);
  assert.equal(frame.usedRatio, 0.9);
  assert.ok(frame.rotationMultiplier < 0.5);
  assert.equal('phase' in frame, false);

  controller.applyLifecycle({
    type: 'agent.session.lifecycle',
    event: 'context_compacted',
    observed_at: '2026-05-02T12:00:00.000Z',
  });
  now += 250;
  frame = controller.tick(0, now);
  assert.ok(frame.scaleMultiplier < 1);
  assert.notEqual(frame.refreshProgress, null);

  now += 1200;
  frame = controller.tick(0, now);
  assert.equal(frame.scaleMultiplier, 1);
  assert.equal(frame.pressure, null);
  assert.equal(frame.auraReachMultiplier, 1);
  assert.equal(frame.rotationMultiplier, 1);
});

test('refresh start preserves pressure until refresh completion resets visual vitality', () => {
  let now = 2000;
  const controller = createSessionVitalityController({
    now: () => now,
    refreshDurationMs: 1000,
  });

  controller.applyTelemetry({
    type: 'agent.session.telemetry',
    context: {
      used_ratio: metric(0.95),
    },
  });
  let frame = controller.tick(0, now);
  assert.equal(frame.pressure, 0.95);
  assert.ok(frame.auraReachMultiplier < 0.5);
  assert.ok(frame.rotationMultiplier < 0.35);

  controller.applyLifecycle({
    type: 'agent.session.lifecycle',
    event: 'context_compaction_started',
    observed_at: '2026-05-02T12:00:00.000Z',
  });
  now += 100;
  frame = controller.tick(0, now);
  assert.equal(frame.pressure, 0.95);
  assert.ok(frame.refreshProgress > 0);

  controller.applyLifecycle({
    type: 'agent.session.lifecycle',
    event: 'context_compacted',
    observed_at: '2026-05-02T12:00:01.000Z',
  });
  now += 1200;
  frame = controller.tick(0, now);
  assert.equal(frame.pressure, null);
  assert.equal(frame.auraReachMultiplier, 1);
  assert.equal(frame.rotationMultiplier, 1);
  assert.equal(frame.brightnessMultiplier, 1);
});
