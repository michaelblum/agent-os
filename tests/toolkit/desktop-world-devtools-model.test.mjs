import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DESKTOP_WORLD_DEVTOOLS_LIMITS,
  DESKTOP_WORLD_DEVTOOLS_SNAPSHOT_CONTRACT_ID,
  DESKTOP_WORLD_DEVTOOLS_STAGE_CONTRACT_ID,
  buildDesktopWorldMinimapLayout,
  createDesktopWorldGpuTimer,
  createDesktopWorldDevToolsStageProbe,
  normalizeDesktopWorldDevToolsSnapshot,
  normalizeDesktopWorldDevToolsStageSnapshot,
} from '../../packages/toolkit/scene/desktop-world-devtools.js';

function stageSnapshot(overrides = {}) {
  return {
    contract: DESKTOP_WORLD_DEVTOOLS_STAGE_CONTRACT_ID,
    sequence: 7,
    status: 'available',
    world: {
      displays: [
        { id: 'left', index: 0, bounds: [0, 0, 1920, 1080], nativeBounds: [-1920, 0, 1920, 1080] },
        { id: 'main', index: 1, bounds: [1920, 0, 2560, 1440], nativeBounds: [0, 0, 2560, 1440] },
      ],
      nodes: [{ id: 'node', resourceId: 'resource', position: [1280, 720, 0] }],
      hitRegions: [{ id: 'hit', resourceId: 'resource', affordanceId: 'drag', frame: [1200, 640, 160, 160], registered: true }],
      affordances: [{ id: 'drag', resourceId: 'resource', objectId: 'node' }],
      gestures: [{ id: 'gesture', resourceId: 'resource', affordanceId: 'drag', kind: 'drag', phase: 'update' }],
      routes: [{ resourceId: 'resource', kind: 'line', active: true, progress: 0.5, origin: [0, 0], destination: [1280, 720] }],
    },
    resources: [{ id: 'resource', owner: 'consumer', sceneId: 'scene', objectCount: 1 }],
    interactions: [{ id: 'consumer:resource', resourceId: 'resource', active: true, recognizers: ['drag'] }],
    performance: { enabled: true, recording: false, currentFps: 60 },
    events: [{ sequence: 1, kind: 'scene.mounted', resourceId: 'resource', at: 100 }],
    ...overrides,
  };
}

test('DesktopWorld DevTools stage normalization is strict, bounded, and content-free', () => {
  assert.throws(
    () => normalizeDesktopWorldDevToolsStageSnapshot({ contract: 'wrong' }),
    /Invalid DesktopWorld DevTools stage contract/,
  );

  const nodes = Array.from({ length: DESKTOP_WORLD_DEVTOOLS_LIMITS.nodes + 10 }, (_, index) => ({
    id: `node-${index}`,
    resourceId: 'resource',
    position: [index, index, 0],
  }));
  const normalized = normalizeDesktopWorldDevToolsStageSnapshot(stageSnapshot({
    world: { ...stageSnapshot().world, nodes },
    interactions: [{
      id: 'interaction',
      errorCode: 'x'.repeat(100),
      html: '<secret>',
      transcript: 'secret',
    }],
  }));

  assert.equal(normalized.world.nodes.length, DESKTOP_WORLD_DEVTOOLS_LIMITS.nodes);
  assert.equal(normalized.interactions[0].errorCode.length, 64);
  assert.equal('html' in normalized.interactions[0], false);
  assert.equal('transcript' in normalized.interactions[0], false);
  assert.equal(normalized.counters.activeGestures, 1);
  assert.equal(normalized.counters.activeRoutes, 1);
  assert.deepEqual(normalized.world.displays[0].nativeBounds, [-1920, 0, 1920, 1080]);
});

test('DesktopWorld DevTools keeps older display facts readable without inventing native geometry', () => {
  const legacy = stageSnapshot();
  legacy.world.displays = [{ id: 'main', index: 0, bounds: [0, 0, 1440, 900] }];
  const normalized = normalizeDesktopWorldDevToolsStageSnapshot(legacy);

  assert.deepEqual(normalized.world.displays[0], {
    id: 'main',
    index: 0,
    bounds: [0, 0, 1440, 900],
  });
  assert.equal('nativeBounds' in normalized.world.displays[0], false);
});

test('DesktopWorld DevTools session normalization validates host and filters', () => {
  const snapshot = normalizeDesktopWorldDevToolsSnapshot({
    contract: DESKTOP_WORLD_DEVTOOLS_SNAPSHOT_CONTRACT_ID,
    session: {
      id: 'session',
      revision: 3,
      activeTab: 'performance',
      selectedResource: 'resource',
      filters: { query: 'route', eventKinds: ['gesture', 'gesture'], errorsOnly: true },
      recording: true,
      host: { kind: 'panel', id: 'canvas', state: 'active' },
    },
    stage: stageSnapshot(),
  });

  assert.equal(snapshot.session.activeTab, 'performance');
  assert.deepEqual(snapshot.session.filters.eventKinds, ['gesture']);
  assert.deepEqual(snapshot.session.host, { kind: 'panel', id: 'canvas', state: 'active' });
});

test('unavailable performance metrics remain unavailable instead of becoming zero', () => {
  const snapshot = normalizeDesktopWorldDevToolsStageSnapshot(stageSnapshot({
    performance: {
      enabled: true,
      recording: false,
      avgGpuMs: null,
      currentFps: null,
    },
  }));

  assert.equal(snapshot.performance.avgGpuMs, null);
  assert.equal(snapshot.performance.currentFps, null);
});

test('GPU timer reuses a bounded query pool and disposes it exactly once', () => {
  let created = 0;
  let deleted = 0;
  const context = {
    QUERY_RESULT: 1,
    QUERY_RESULT_AVAILABLE: 2,
    beginQuery() {},
    createQuery() { created += 1; return { id: created }; },
    deleteQuery() { deleted += 1; },
    endQuery() {},
    getExtension(name) {
      return name === 'EXT_disjoint_timer_query_webgl2'
        ? { GPU_DISJOINT_EXT: 3, TIME_ELAPSED_EXT: 4 }
        : null;
    },
    getParameter() { return false; },
    getQueryParameter(_query, key) {
      return key === this.QUERY_RESULT_AVAILABLE ? true : 5_000_000;
    },
  };
  const timer = createDesktopWorldGpuTimer(context);

  assert.equal(timer.state().supported, true);
  assert.equal(timer.begin(), true);
  assert.equal(timer.end(), 5);
  assert.equal(timer.begin(), true);
  assert.equal(timer.end(), 5);
  assert.equal(created, 4);
  assert.equal(timer.dispose(), true);
  assert.equal(timer.dispose(), false);
  assert.equal(deleted, 4);
});

test('DesktopWorld minimap projects multi-display world geometry consistently', () => {
  const stage = normalizeDesktopWorldDevToolsStageSnapshot(stageSnapshot());
  const minimap = buildDesktopWorldMinimapLayout(stage, { width: 480, height: 240, padding: 12 });

  assert.deepEqual(minimap.bounds, [0, 0, 4480, 1440]);
  assert.equal(minimap.displays.length, 2);
  assert.equal(minimap.nodes.length, 1);
  assert.ok(minimap.displays.every((display) => display.frame.every(Number.isFinite)));
  assert.ok(minimap.nodes[0].point.every(Number.isFinite));
});

test('disabled DesktopWorld DevTools probe has no frame loop or stage reads', () => {
  let reads = 0;
  let emits = 0;
  const probe = createDesktopWorldDevToolsStageProbe({
    getStageFacts() {
      reads += 1;
      return stageSnapshot();
    },
    emit() { emits += 1; },
  });

  assert.equal(probe.sampleFrame({ frameMs: 16 }), false);
  assert.equal(probe.recordEvent({ kind: 'ignored' }), false);
  assert.equal(reads, 0);
  assert.equal(emits, 0);
  assert.deepEqual(probe.state(), {
    disposed: false,
    enabled: false,
    recording: false,
    eventCount: 0,
    sampleCount: 0,
    hasOwnFrameLoop: false,
  });
});

test('DesktopWorld DevTools probe throttles idle samples and records bounded telemetry', () => {
  let clock = 0;
  const emitted = [];
  const probe = createDesktopWorldDevToolsStageProbe({
    now: () => clock,
    getStageFacts: () => stageSnapshot(),
    emit: (snapshot) => emitted.push(snapshot),
  });

  probe.configure({ enabled: true });
  probe.recordEvent({ kind: 'scene.mounted', resourceId: 'resource' });
  probe.sampleFrame({ frameMs: 16, renderMs: 4, backingPixels: 2073600 });
  clock = 100;
  probe.sampleFrame({ frameMs: 17, renderMs: 5, backingPixels: 2073600 });
  assert.equal(probe.state().sampleCount, 1);

  clock = 600;
  probe.sampleFrame({ frameMs: 18, renderMs: 6, backingPixels: 2073600 });
  assert.equal(probe.state().sampleCount, 2);
  assert.equal(emitted.at(-1).performance.backingPixels, 2073600);

  probe.configure({ enabled: true, recording: true });
  clock = 601;
  probe.sampleFrame({ frameMs: 19 });
  assert.equal(probe.state().sampleCount, 3);

  for (let index = 0; index < DESKTOP_WORLD_DEVTOOLS_LIMITS.events + 20; index += 1) {
    probe.recordEvent({ kind: `event-${index}` });
  }
  assert.equal(probe.state().eventCount, DESKTOP_WORLD_DEVTOOLS_LIMITS.events);
  assert.equal(probe.dispose(), true);
  assert.equal(probe.dispose(), false);
  assert.equal(probe.sampleFrame({ frameMs: 16 }), false);
});
