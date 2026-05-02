import assert from 'node:assert/strict';
import test from 'node:test';

import {
  makeLifecycleDelivery,
  makeLifecycleEvent,
  makeTelemetry,
  makeTelemetryDelivery,
  normalizeLabState,
  summarizeSessionVitality,
} from '../../apps/sigil/tests/session-vitality/lab.js';

test('session vitality lab builds ratio telemetry with provenance', () => {
  const telemetry = makeTelemetry({
    provider: 'codex',
    mode: 'ratio',
    usedRatio: 0.82,
    precision: 'derived',
  }, '2026-05-02T12:00:00.000Z');

  assert.equal(telemetry.type, 'agent.session.telemetry');
  assert.equal(telemetry.provider, 'codex');
  assert.equal(telemetry.context.used_ratio.value, 0.82);
  assert.equal(telemetry.context.remaining_ratio.value, 0.18000000000000005);
  assert.equal(telemetry.context.used_ratio.source.provider_surface, 'sigil-session-vitality-lab');
  assert.equal(telemetry.context.used_ratio.source.precision, 'derived');
});

test('session vitality lab can emit token-only telemetry', () => {
  const telemetry = makeTelemetry({
    mode: 'tokens',
    usedTokens: 75000,
    windowTokens: 100000,
  });

  assert.equal(telemetry.context.used_ratio, undefined);
  assert.equal(telemetry.context.remaining_ratio, undefined);
  assert.equal(telemetry.context.used_tokens.value, 75000);
  assert.equal(telemetry.context.window_tokens.value, 100000);
});

test('session vitality lab can emit unknown telemetry', () => {
  const telemetry = makeTelemetry({ mode: 'unknown' });

  assert.deepEqual(telemetry.context, {});
});

test('session vitality lab wraps telemetry in the Agent Terminal envelope by default', () => {
  const telemetry = makeTelemetry({ usedRatio: 0.9 });
  const delivery = makeTelemetryDelivery({
    targetCanvasId: 'avatar-main',
    terminalCanvasId: 'sigil-codex-terminal',
  }, telemetry);

  assert.equal(delivery.target, 'avatar-main');
  assert.equal(delivery.message.type, 'canvas_message');
  assert.equal(delivery.message.id, 'sigil-codex-terminal');
  assert.equal(delivery.message.payload.type, 'agent_terminal.session_telemetry');
  assert.equal(delivery.message.payload.payload.telemetry, telemetry);
});

test('session vitality lab supports direct session event delivery', () => {
  const telemetry = makeTelemetry({ usedRatio: 0.9 });
  const delivery = makeTelemetryDelivery({
    delivery: 'direct',
    targetCanvasId: 'avatar-main',
  }, telemetry);

  assert.equal(delivery.target, 'avatar-main');
  assert.equal(delivery.message, telemetry);
});

test('session vitality lab wraps lifecycle events for Agent Terminal delivery', () => {
  const event = makeLifecycleEvent('context_compacted', {
    provider: 'claude-code',
  }, '2026-05-02T12:00:00.000Z');
  const delivery = makeLifecycleDelivery({
    targetCanvasId: 'avatar-main',
  }, event);

  assert.equal(event.type, 'agent.session.lifecycle');
  assert.equal(event.provider, 'claude-code');
  assert.equal(delivery.message.payload.payload.lifecycle_events[0], event);
});

test('session vitality lab normalizes ratios and token counts', () => {
  const state = normalizeLabState({
    usedRatio: 12,
    usedTokens: 200000,
    windowTokens: 100000,
    precision: 'not-real',
  });

  assert.equal(state.usedRatio, 1);
  assert.equal(state.usedTokens, 100000);
  assert.equal(state.windowTokens, 100000);
  assert.equal(state.precision, 'exact');
});

test('session vitality lab summarizes renderer vitality snapshots', () => {
  const summary = summarizeSessionVitality({
    factors: {
      pressure: 0.88,
      remainingRatio: 0.12,
      confidence: 1,
      scaleMultiplier: 'bad',
    },
  });

  assert.equal(summary.pressure, 0.88);
  assert.equal(summary.remainingRatio, 0.12);
  assert.equal(summary.confidence, 1);
  assert.equal(summary.scaleMultiplier, null);
});
