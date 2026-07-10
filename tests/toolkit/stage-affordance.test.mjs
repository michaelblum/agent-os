import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createStageAffordance,
  insetFrame,
  isStageAffordanceInputEvent,
  stageAffordanceRegionId,
} from '../../packages/toolkit/panel/stage-affordance.js';
import { canonicalInputRegionEvent } from '../lib/input-event-fixtures.mjs';

function inputRegionEvent(regionId, phase = 'down') {
  return canonicalInputRegionEvent({
    type: phase === 'down' ? 'left_mouse_down' : (phase === 'up' ? 'left_mouse_up' : 'left_mouse_dragged'),
    phase,
    x: 20,
    y: 30,
    regionId,
    ownerCanvasId: 'panel-a',
  });
}

test('stage affordance sets up stage layer, input regions, and exposes inspector state', async (t) => {
  const previousWindow = globalThis.window;
  const previousAtob = globalThis.atob;
  globalThis.window = {
    headsup: {},
    webkit: { messageHandlers: { headsup: { postMessage() {} } } },
  };
  globalThis.atob = (value) => Buffer.from(value, 'base64').toString('utf8');
  t.after(() => {
    globalThis.window = previousWindow;
    globalThis.atob = previousAtob;
  });

  const calls = [];
  const events = [];
  const affordance = createStageAffordance({
    id: 'chip-a',
    ownerCanvasId: 'panel-a',
    sourceCanvasId: 'panel-a',
    targetCanvasId: 'aos-desktop-world-stage',
    mode: 'minimized_panel_chip',
    layer: {
      id: 'chip-a',
      kind: 'chip',
      label: 'Panel',
      frame: [10, 20, 220, 38],
    },
    regions: [
      {
        id: stageAffordanceRegionId('chip-a', 'restore'),
        frame: insetFrame([10, 20, 220, 38], { insetRight: 34 }),
        semantic_label: 'restore',
      },
      {
        id: stageAffordanceRegionId('chip-a', 'close'),
        frame: insetFrame([10, 20, 220, 38], { insetLeft: 186 }),
        semantic_label: 'close',
      },
    ],
    async ensureStage(options) {
      calls.push(['ensureStage', options.id]);
      return { ok: true, status: 'created', id: options.id, created: true };
    },
    sendStageMessage(message) { calls.push(['stage', message]); },
    async registerRegion(region) { calls.push(['register', region]); },
    async removeRegion(id) { calls.push(['remove', id]); },
    subscribeEvents(events, options) { calls.push(['subscribe', events, options]); },
    unsubscribeEvents(events) { calls.push(['unsubscribe', events]); },
    onInputRegionEvent(event) { events.push(['input', event.input.regionId]); },
    onSourceRemoved() { events.push(['removed']); },
  });

  const setupState = await affordance.setup();

  assert.equal(setupState.setupComplete, true);
  assert.equal(setupState.mode, 'minimized_panel_chip');
  assert.deepEqual(setupState.layerIds, ['chip-a']);
  assert.deepEqual(setupState.regionIds, ['chip-a:restore', 'chip-a:close']);
  assert.equal(setupState.ownerCanvasId, 'panel-a');
  assert.equal(setupState.sourceCanvasId, 'panel-a');
  assert.equal(setupState.targetCanvasId, 'aos-desktop-world-stage');
  assert.deepEqual(setupState.stageEnsureStatus, {
    ok: true,
    status: 'created',
    id: 'aos-desktop-world-stage',
    url: 'aos://toolkit/components/desktop-world-stage/index.html',
    created: true,
    error: null,
  });
  assert.equal(setupState.stageLayerUpsertSent, true);
  assert.deepEqual(setupState.registeredRegionIds, ['chip-a:restore', 'chip-a:close']);
  assert.deepEqual(calls.map((entry) => entry[0]), [
    'ensureStage',
    'stage',
    'register',
    'register',
    'subscribe',
  ]);
  assert.equal(calls[2][1].owner_canvas_id, 'panel-a');
  assert.equal(calls[2][1].coordinate_space, 'native');
  assert.equal(calls[2][1].metadata.toolkit_affordance_id, 'chip-a');

  window.headsup.receive(Buffer.from(JSON.stringify(inputRegionEvent('chip-a:restore'))).toString('base64'));
  window.headsup.receive(Buffer.from(JSON.stringify({
    type: 'canvas_lifecycle',
    payload: { action: 'removed', canvas_id: 'panel-a' },
  })).toString('base64'));
  assert.deepEqual(events, [
    ['input', 'chip-a:restore'],
    ['removed'],
  ]);

  const cleanupState = await affordance.cleanup();
  const duplicateCleanupState = await affordance.cleanup();

  assert.equal(cleanupState.cleanupComplete, true);
  assert.equal(cleanupState.cleanupStatus.removedRegions, true);
  assert.equal(cleanupState.cleanupStatus.removedLayer, true);
  assert.equal(cleanupState.cleanupStatus.unsubscribed, false);
  assert.equal(cleanupState.cleanupStatus.subscriptionRetained, true);
  assert.deepEqual(duplicateCleanupState, cleanupState);
  assert.deepEqual(calls.slice(5).map((entry) => entry[0]), [
    'remove',
    'remove',
    'stage',
  ]);
});

test('stage affordance supports explicit exclusive subscription cleanup opt-in', async () => {
  const calls = [];
  const affordance = createStageAffordance({
    id: 'exclusive-a',
    ownerCanvasId: 'panel-a',
    layer: { id: 'exclusive-a', frame: [0, 0, 10, 10] },
    regions: [],
    async ensureStage() {
      calls.push(['ensureStage']);
      return true;
    },
    sendStageMessage(message) { calls.push(['stage', message]); },
    subscribeEvents(events, options) { calls.push(['subscribe', events, options]); },
    unsubscribeEvents(events) { calls.push(['unsubscribe', events]); },
    unsubscribeOnCleanup: true,
  });

  await affordance.setup();
  const cleanupState = await affordance.cleanup();

  assert.equal(cleanupState.cleanupStatus.unsubscribed, true);
  assert.equal(cleanupState.cleanupStatus.subscriptionRetained, false);
  assert.deepEqual(calls.map((entry) => entry[0]), [
    'ensureStage',
    'stage',
    'subscribe',
    'stage',
    'unsubscribe',
  ]);
});

test('stage affordance cleans up registered resources after setup failure', async () => {
  const calls = [];
  const affordance = createStageAffordance({
    id: 'chip-a',
    ownerCanvasId: 'panel-a',
    layer: { id: 'chip-a', frame: [0, 0, 10, 10] },
    regions: [
      { id: 'chip-a:restore', frame: [0, 0, 10, 10] },
      { id: 'chip-a:close', frame: [8, 0, 2, 10] },
    ],
    async ensureStage() {
      calls.push(['ensureStage']);
      return true;
    },
    sendStageMessage(message) { calls.push(['stage', message]); },
    async registerRegion(region) {
      calls.push(['register', region.id]);
      if (region.id === 'chip-a:close') throw new Error('REGISTER_FAILED');
    },
    async removeRegion(id) { calls.push(['remove', id]); },
    subscribeEvents() { calls.push(['subscribe']); },
    unsubscribeEvents() { calls.push(['unsubscribe']); },
  });

  await assert.rejects(() => affordance.setup(), /REGISTER_FAILED/);

  assert.equal(affordance.getState().cleanupComplete, true);
  assert.deepEqual(calls.map((entry) => entry[0]), [
    'ensureStage',
    'stage',
    'register',
    'register',
    'remove',
    'stage',
  ]);
});

test('stage affordance rejects falsey stage ensure before layer upsert and region registration', async () => {
  const calls = [];
  const affordance = createStageAffordance({
    id: 'chip-a',
    ownerCanvasId: 'panel-a',
    layer: { id: 'chip-a', frame: [0, 0, 10, 10] },
    regions: [
      { id: 'chip-a:restore', frame: [0, 0, 10, 10] },
    ],
    async ensureStage() {
      calls.push(['ensureStage']);
      return false;
    },
    sendStageMessage(message) { calls.push(['stage', message]); },
    async registerRegion(region) { calls.push(['register', region.id]); },
    async removeRegion(id) { calls.push(['remove', id]); },
  });

  await assert.rejects(() => affordance.setup(), /STAGE_UNAVAILABLE: unavailable/);

  assert.equal(affordance.getState().setupComplete, false);
  assert.equal(affordance.getState().stageLayerUpsertSent, false);
  assert.deepEqual(affordance.getState().registeredRegionIds, []);
  assert.deepEqual(affordance.getState().stageEnsureStatus, {
    ok: false,
    status: 'unavailable',
    id: 'aos-desktop-world-stage',
    url: 'aos://toolkit/components/desktop-world-stage/index.html',
    created: false,
    error: null,
  });
  assert.deepEqual(calls.map((entry) => entry[0]), [
    'ensureStage',
    'stage',
  ]);
  assert.equal(calls[1][1].type, 'desktop_world_stage.layer.remove');
});

test('stage affordance input event matcher only accepts owned region events', () => {
  const state = {
    regionIds: ['chip-a:restore', 'chip-a:close'],
  };
  assert.equal(isStageAffordanceInputEvent(state, inputRegionEvent('chip-a:restore')), true);
  assert.equal(isStageAffordanceInputEvent(state, inputRegionEvent('other:restore')), false);
  assert.equal(isStageAffordanceInputEvent(state, {
    type: 'canvas_lifecycle',
    region_id: 'chip-a:restore',
  }), false);
});
