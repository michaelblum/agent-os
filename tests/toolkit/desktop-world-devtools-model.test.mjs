import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DESKTOP_WORLD_DEVTOOLS_LIMITS,
  DESKTOP_WORLD_PERFORMANCE_ACCEPTANCE_THRESHOLDS,
  DESKTOP_WORLD_DEVTOOLS_SNAPSHOT_CONTRACT_ID,
  DESKTOP_WORLD_DEVTOOLS_STAGE_CONTRACT_ID,
  buildDesktopWorldMinimapLayout,
  createDesktopWorldGpuTimer,
  createDesktopWorldDevToolsStageProbe,
  evaluateDesktopWorldPerformanceAcceptance,
  normalizeDesktopWorldDevToolsSnapshot,
  normalizeDesktopWorldDevToolsStageSnapshot,
} from '../../packages/toolkit/scene/desktop-world-devtools.js';

test('DesktopWorld acceptance thresholds are hardware-independent and bounded', () => {
  assert.deepEqual(DESKTOP_WORLD_PERFORMANCE_ACCEPTANCE_THRESHOLDS, {
    prewarmedTransitionStartMs: 250,
    projectionReadyMs: 750,
    inputToVisualP95Ms: 50,
    minInputToVisualSamples: 20,
    targetFps: 60,
    minFrameSamples: 120,
    p95FrameBudgetMultiplier: 1.1,
    maxSteadyFrameMs: 100,
    maxCrossDisplayGapFrames: 2,
    stabilityCycles: 100,
    maxWarmCycleRssGrowthBytes: 16 * 1024 * 1024,
  });
});

function performanceAcceptanceInput(overrides = {}) {
  return {
    prewarmedTransitionStartMs: 120,
    projectionReadyMs: 480,
    inputToVisualSamplesMs: Array.from(
      { length: DESKTOP_WORLD_PERFORMANCE_ACCEPTANCE_THRESHOLDS.minInputToVisualSamples },
      () => 42,
    ),
    frameSamplesMs: Array.from(
      { length: DESKTOP_WORLD_PERFORMANCE_ACCEPTANCE_THRESHOLDS.minFrameSamples },
      () => 18,
    ),
    backingPixelsPerSegment: [1_440_000, 2_073_600],
    backingDimensionsPerSegment: [[1200, 1200], [1920, 1080]],
    requestedDevicePixelRatios: [2, 1],
    effectiveDevicePixelRatios: [2, 1],
    estimatedBackingBytesPerSegment: [57_600_000, 82_944_000],
    msaaSamplesPerSegment: [4, 4],
    damagedPixelPercentages: [12, 18, 24],
    crossDisplayGapFrames: 1,
    warmCycleCount: 100,
    warmCycleRssDeltaBytes: 8 * 1024 * 1024,
    resourceDeltas: { geometries: 0, materials: 0, programs: 0, textures: 0 },
    ...overrides,
  };
}

test('DesktopWorld performance acceptance evaluates current public thresholds', () => {
  const result = evaluateDesktopWorldPerformanceAcceptance(performanceAcceptanceInput());

  assert.equal(result.valid, true);
  assert.equal(result.ok, true);
  assert.equal(result.observed.inputToVisualP95Ms, 42);
  assert.equal(result.observed.frameP95Ms, 18);
  assert.equal(result.observed.maxBackingPixelsPerSegment, 2_073_600);
  assert.equal(result.observed.nativeDevicePixelRatioExact, true);
  assert.equal(result.observed.estimatedTopologyBackingBytes, 140_544_000);
  assert.equal(result.observed.avgDamagedPixelPercentage, 18);
  assert.ok(result.checks.every((check) => check.ok));
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.observed), true);
  assert.equal(Object.isFrozen(result.checks), true);
});

test('DesktopWorld performance acceptance reports every failed bounded invariant', () => {
  const result = evaluateDesktopWorldPerformanceAcceptance(performanceAcceptanceInput({
    prewarmedTransitionStartMs: 251,
    projectionReadyMs: 751,
    inputToVisualSamplesMs: Array.from(
      { length: DESKTOP_WORLD_PERFORMANCE_ACCEPTANCE_THRESHOLDS.minInputToVisualSamples },
      () => 51,
    ),
    frameSamplesMs: Array.from(
      { length: DESKTOP_WORLD_PERFORMANCE_ACCEPTANCE_THRESHOLDS.minFrameSamples },
      () => 101,
    ),
    requestedDevicePixelRatios: [2, 1],
    effectiveDevicePixelRatios: [1, 1],
    crossDisplayGapFrames: 3,
    warmCycleCount: 100,
    warmCycleRssDeltaBytes: 16 * 1024 * 1024 + 1,
    resourceDeltas: { geometries: 1, materials: 1, programs: 1, textures: 1 },
  }));

  assert.equal(result.valid, true);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.checks.filter((check) => !check.ok).map((check) => check.id),
    [
      'prewarmed_transition_start',
      'projection_ready',
      'input_to_visual_p95',
      'frame_p95',
      'frame_max',
      'native_device_pixel_ratio',
      'cross_display_gap',
      'warm_cycle_rss_growth',
      'resource_geometries_growth',
      'resource_materials_growth',
      'resource_programs_growth',
      'resource_textures_growth',
    ],
  );
});

test('DesktopWorld performance acceptance fails closed on malformed or unbounded input', () => {
  const sparseInputSamples = Array.from(
    { length: DESKTOP_WORLD_PERFORMANCE_ACCEPTANCE_THRESHOLDS.minInputToVisualSamples },
    () => 12,
  );
  delete sparseInputSamples[7];
  const nonFiniteFrameSamples = Array.from(
    { length: DESKTOP_WORLD_PERFORMANCE_ACCEPTANCE_THRESHOLDS.minFrameSamples },
    () => 16,
  );
  nonFiniteFrameSamples[11] = Number.NaN;
  const malformed = [
    null,
    performanceAcceptanceInput({ inputToVisualSamplesMs: [] }),
    performanceAcceptanceInput({ inputToVisualSamplesMs: [12] }),
    performanceAcceptanceInput({ frameSamplesMs: [16] }),
    performanceAcceptanceInput({ inputToVisualSamplesMs: sparseInputSamples }),
    performanceAcceptanceInput({ frameSamplesMs: nonFiniteFrameSamples }),
    performanceAcceptanceInput({ backingPixelsPerSegment: [1.5] }),
    performanceAcceptanceInput({ backingDimensionsPerSegment: [[1200, 0], [1920, 1080]] }),
    performanceAcceptanceInput({ requestedDevicePixelRatios: [2] }),
    performanceAcceptanceInput({ effectiveDevicePixelRatios: [2, 0] }),
    performanceAcceptanceInput({ estimatedBackingBytesPerSegment: [1] }),
    performanceAcceptanceInput({ msaaSamplesPerSegment: [4.5, 4] }),
    performanceAcceptanceInput({ damagedPixelPercentages: [101] }),
    performanceAcceptanceInput({ warmCycleCount: 99 }),
    performanceAcceptanceInput({ resourceDeltas: { geometries: 0, materials: 0, programs: 0 } }),
    performanceAcceptanceInput({ transcript: 'must not be accepted' }),
    performanceAcceptanceInput({
      frameSamplesMs: Array.from(
        { length: DESKTOP_WORLD_DEVTOOLS_LIMITS.performanceSamples + 1 },
        () => 16,
      ),
    }),
  ];

  for (const input of malformed) {
    assert.deepEqual(evaluateDesktopWorldPerformanceAcceptance(input), {
      ok: false,
      valid: false,
      observed: null,
      checks: [{ id: 'input_valid', observed: null, limit: null, operator: 'valid', ok: false }],
    });
  }
});

function stageSnapshot(overrides = {}) {
  const performance = { enabled: true, recording: false, currentFps: 60 }
  return {
    contract: DESKTOP_WORLD_DEVTOOLS_STAGE_CONTRACT_ID,
    canvasGeneration: 3,
    topologyGeneration: 4,
    sequence: 7,
    status: 'available',
    native: {
      desktopFrameWarm: {
        displayCount: 2,
        errorCode: null,
        generation: 4,
        state: 'ready',
      },
      nativeEffect: {
        activeInstanceCount: 0,
        activeSheetCount: 0,
        acceptedCount: 2,
        attemptedCount: 3,
        completedCount: 1,
        disposedCount: 1,
        failedCount: 1,
        lastErrorCode: 'NATIVE_EFFECT_CAPTURE_TIMEOUT',
        lastExecution: {
          ownerId: 'example.consumer',
          programDigest: 'a'.repeat(64),
          programId: 'example.ripple',
          programRevision: 1,
          resourceId: 'companion/main',
          resourceRevision: 3,
        },
        lastPresentationLatencyMs: 31,
        lastRenderBackingPixelCount: 480_000,
        lastRenderBackingPixelPercentage: 8.25,
        lastRenderTriangleCount: 12_000,
        presentedCount: 1,
        rejectedCount: 1,
        retainedBufferCount: 0,
        retainedTextureCount: 0,
        retainedViewCount: 0,
        state: 'ready',
      },
    },
    world: {
      displays: [
        { id: 'left', index: 0, bounds: [0, 0, 1920, 1080], nativeBounds: [-1920, 0, 1920, 1080], scaleFactor: 1 },
        { id: 'main', index: 1, bounds: [1920, 0, 2560, 1440], nativeBounds: [0, 0, 2560, 1440], scaleFactor: 2 },
      ],
      nodes: [{ id: 'node', resourceId: 'resource', position: [1280, 720, 0] }],
      hitRegions: [{ id: 'hit', resourceId: 'resource', affordanceId: 'drag', frame: [1200, 640, 160, 160], registered: true }],
      affordances: [{ id: 'drag', resourceId: 'resource', objectId: 'node' }],
      gestures: [{ id: 'gesture', resourceId: 'resource', affordanceId: 'drag', kind: 'drag', phase: 'update' }],
      routes: [{ resourceId: 'resource', kind: 'line', active: true, progress: 0.5, origin: [0, 0], destination: [1280, 720] }],
    },
    resources: [{ id: 'resource', owner: 'consumer', sceneId: 'scene', objectCount: 1 }],
    interactions: [{ id: 'consumer:resource', resourceId: 'resource', active: true, recognizers: ['drag'] }],
    displayPerformance: [{
      displayId: 'left', displayIndex: 0, scope: 'stage-segment', performance,
    }, {
      displayId: 'main', displayIndex: 1, scope: 'stage-segment', performance,
    }],
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
  assert.equal(normalized.world.displays[0].scaleFactor, 1);
  assert.equal(normalized.world.displays[1].scaleFactor, 2);
  assert.deepEqual(normalized.native.desktopFrameWarm, {
    displayCount: 2,
    errorCode: null,
    generation: 4,
    state: 'ready',
  });
  assert.deepEqual(normalized.native.nativeEffect, {
    activeInstanceCount: 0,
    activeSheetCount: 0,
    acceptedCount: 2,
    attemptedCount: 3,
    completedCount: 1,
    disposedCount: 1,
    failedCount: 1,
    lastErrorCode: 'NATIVE_EFFECT_CAPTURE_TIMEOUT',
    lastExecution: {
      ownerId: 'example.consumer',
      programDigest: 'a'.repeat(64),
      programId: 'example.ripple',
      programRevision: 1,
      resourceId: 'companion/main',
      resourceRevision: 3,
    },
    lastPresentationLatencyMs: 31,
    lastRenderBackingPixelCount: 480_000,
    lastRenderBackingPixelPercentage: 8.25,
    lastRenderTriangleCount: 12_000,
    presentedCount: 1,
    rejectedCount: 1,
    retainedBufferCount: 0,
    retainedTextureCount: 0,
    retainedViewCount: 0,
    state: 'ready',
  });
});

test('DesktopWorld DevTools bounds native warm status without exposing capture content', () => {
  const normalized = normalizeDesktopWorldDevToolsStageSnapshot(stageSnapshot({
    native: {
      desktopFrameWarm: {
        displayCount: 99,
        errorCode: 'x'.repeat(100),
        generation: -1,
        state: 'unknown',
        pixels: 'not allowed',
      },
      nativeEffect: {
        activeInstanceCount: 99,
        activeSheetCount: -1,
        acceptedCount: -1,
        attemptedCount: 1e12,
        completedCount: 2,
        disposedCount: 1e12,
        failedCount: 3,
        lastErrorCode: 'y'.repeat(100),
        lastExecution: {
          ownerId: 'owner',
          programDigest: 'z'.repeat(100),
          programId: 'program',
          programRevision: -1,
          resourceId: 'resource',
          resourceRevision: 3e9,
        },
        lastPresentationLatencyMs: -1,
        lastRenderBackingPixelCount: 1e12,
        lastRenderBackingPixelPercentage: 101,
        lastRenderTriangleCount: -1,
        parameters: 'not allowed',
        presentedCount: 4,
        rejectedCount: 5,
        retainedBufferCount: 99,
        retainedTextureCount: 99,
        retainedViewCount: 99,
        state: 'unknown',
      },
      frame: 'not allowed',
    },
  }));

  assert.deepEqual(normalized.native, {
    desktopFrameWarm: {
      displayCount: 16,
      errorCode: 'x'.repeat(64),
      generation: 0,
      state: 'idle',
    },
    nativeEffect: {
      activeInstanceCount: 1,
      activeSheetCount: 0,
      acceptedCount: 0,
      attemptedCount: 1e9,
      completedCount: 2,
      disposedCount: 1e9,
      failedCount: 3,
      lastErrorCode: 'y'.repeat(64),
      lastExecution: null,
      lastPresentationLatencyMs: 0,
      lastRenderBackingPixelCount: 1e9,
      lastRenderBackingPixelPercentage: 100,
      lastRenderTriangleCount: 0,
      presentedCount: 4,
      rejectedCount: 5,
      retainedBufferCount: 32,
      retainedTextureCount: 16,
      retainedViewCount: 16,
      state: 'unavailable',
    },
  });
});

test('DesktopWorld DevTools rejects noncanonical native-effect execution identity', () => {
  const malformed = stageSnapshot();
  malformed.native.nativeEffect.lastExecution = {
    ownerId: '../consumer',
    programDigest: 'A'.repeat(64),
    programId: 'example.effect',
    programRevision: 1,
    resourceId: 'companion/main',
    resourceRevision: 3,
  };
  const normalized = normalizeDesktopWorldDevToolsStageSnapshot(malformed);
  assert.equal(normalized.native.nativeEffect.lastExecution, null);
});

test('browser-authored stage snapshots do not invent daemon-owned native state', () => {
  const browser = stageSnapshot();
  delete browser.native;
  const normalized = normalizeDesktopWorldDevToolsStageSnapshot(browser);

  assert.equal('native' in normalized, false);
});

test('DesktopWorld DevTools keeps older display facts readable without inventing native geometry', () => {
  const legacy = stageSnapshot();
  legacy.world.displays = [{ id: 'main', index: 0, bounds: [0, 0, 1440, 900] }];
  const normalized = normalizeDesktopWorldDevToolsStageSnapshot(legacy);

  assert.deepEqual(normalized.world.displays[0], {
    id: 'main',
    index: 0,
    bounds: [0, 0, 1440, 900],
    scaleFactor: 1,
  });
  assert.equal('nativeBounds' in normalized.world.displays[0], false);
});

test('DesktopWorld DevTools preserves numeric physical display identity as a public string', () => {
  const numeric = stageSnapshot();
  numeric.world.displays[0].id = 69_733_382;
  numeric.displayPerformance[0].displayId = 69_733_382;

  const normalized = normalizeDesktopWorldDevToolsStageSnapshot(numeric);

  assert.equal(normalized.world.displays[0].id, '69733382');
  assert.equal(normalized.displayPerformance[0].displayId, '69733382');
  assert.notEqual(normalized.world.displays[0].id, 'display-0');
});

test('DesktopWorld DevTools session normalization validates host and filters', () => {
  const snapshot = normalizeDesktopWorldDevToolsSnapshot({
    contract: DESKTOP_WORLD_DEVTOOLS_SNAPSHOT_CONTRACT_ID,
    stageSnapshotRevision: 7,
    session: {
      id: 'session',
      revision: 3,
      stageSnapshotReady: true,
      activeTab: 'performance',
      selectedResource: 'resource',
      filters: { query: 'route', eventKinds: ['gesture', 'gesture'], errorsOnly: true },
      recording: true,
      host: { kind: 'panel', id: 'canvas', state: 'active' },
    },
    stage: stageSnapshot(),
  });

  assert.equal(snapshot.session.activeTab, 'performance');
  assert.equal(snapshot.stageSnapshotRevision, 7);
  assert.equal(snapshot.session.stageSnapshotReady, true);
  assert.deepEqual(snapshot.session.filters.eventKinds, ['gesture']);
  assert.deepEqual(snapshot.session.host, { kind: 'panel', id: 'canvas', state: 'active' });
});

test('unavailable performance metrics remain unavailable instead of becoming zero', () => {
  const snapshot = normalizeDesktopWorldDevToolsStageSnapshot(stageSnapshot({
    displayPerformance: [{
      displayId: 'left', displayIndex: 0, scope: 'stage-segment', performance: {
        enabled: true,
        recording: false,
        avgGpuMs: null,
        currentFps: null,
      },
    }],
  }));

  assert.equal(snapshot.displayPerformance[0].performance.avgGpuMs, null);
  assert.equal(snapshot.displayPerformance[0].performance.currentFps, null);
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
    getPerformanceDisplay: () => ({ displayId: 'left', displayIndex: 0 }),
    getStageIdentity: () => ({ canvasGeneration: 3, topologyGeneration: 4 }),
    emit: (snapshot, metadata) => emitted.push({ metadata, snapshot }),
  });

  probe.configure({ enabled: true });
  probe.setIdentityReady({
    canvasGeneration: 3, topologyGeneration: 4, displayId: 'left', displayIndex: 0,
  });
  probe.recordEvent({ kind: 'scene.mounted', resourceId: 'resource' });
  probe.sampleFrame({
    frameMs: 16,
    renderMs: 4,
    backingPixels: 2073600,
    backingWidth: 1920,
    backingHeight: 1080,
    damagedPixelPercentage: 10,
    requestedDevicePixelRatio: 1,
    effectiveDevicePixelRatio: 1,
    estimatedBackingBytes: 82_944_000,
    msaaSamples: 4,
  });
  clock = 100;
  probe.sampleFrame({ frameMs: 17, renderMs: 5, backingPixels: 2073600 });
  assert.equal(probe.state().sampleCount, 1);

  clock = 600;
  probe.sampleFrame({
    frameMs: 18,
    renderMs: 6,
    backingPixels: 2073600,
    backingWidth: 1920,
    backingHeight: 1080,
    damagedPixelPercentage: 20,
    requestedDevicePixelRatio: 1,
    effectiveDevicePixelRatio: 1,
    estimatedBackingBytes: 82_944_000,
    msaaSamples: 4,
  });
  assert.equal(probe.state().sampleCount, 2);
  const segmentPerformance = emitted.at(-1).snapshot.displayPerformance[0].performance;
  assert.equal(segmentPerformance.backingPixels, 2073600);
  assert.equal(emitted.at(-1).snapshot.displayPerformance[0].displayId, 'left');
  assert.equal(emitted.at(-1).snapshot.displayPerformance[0].scope, 'stage-segment');
  assert.equal(segmentPerformance.backingWidth, 1920);
  assert.equal(segmentPerformance.backingHeight, 1080);
  assert.equal(segmentPerformance.damagedPixelPercentage, 20);
  assert.equal(segmentPerformance.avgDamagedPixelPercentage, 15);
  assert.equal(segmentPerformance.requestedDevicePixelRatio, 1);
  assert.equal(segmentPerformance.effectiveDevicePixelRatio, 1);
  assert.equal(segmentPerformance.estimatedBackingBytes, 82_944_000);
  assert.equal(segmentPerformance.msaaSamples, 4);
  assert.equal(segmentPerformance.targetFps, 60);
  assert.ok(segmentPerformance.budgetMs > 16);
  assert.equal(segmentPerformance.maxFrameMs, 18);

  probe.emitSnapshot('requested', undefined, { request_id: 'request-1' });
  assert.deepEqual(emitted.at(-1).metadata, { request_id: 'request-1' });

  probe.configure({ enabled: true, recording: true });
  probe.setIdentityReady({
    canvasGeneration: 3, topologyGeneration: 4, displayId: 'left', displayIndex: 0,
  });
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

test('DesktopWorld DevTools probe rolls samples on exact display identity changes', () => {
  let clock = 0;
  let identity = {
    canvasGeneration: 3,
    topologyGeneration: 4,
    displayId: 'left',
    displayIndex: 0,
  };
  const facts = () => {
    const value = stageSnapshot();
    value.world = {
      ...value.world,
      displays: value.world.displays.map((display) => (
        display.index === identity.displayIndex
          ? { ...display, id: identity.displayId }
          : display
      )),
    };
    return value;
  };
  const probe = createDesktopWorldDevToolsStageProbe({
    now: () => clock,
    getStageFacts: facts,
    getPerformanceDisplay: () => ({
      displayId: identity.displayId,
      displayIndex: identity.displayIndex,
    }),
    getStageIdentity: () => ({
      canvasGeneration: identity.canvasGeneration,
      topologyGeneration: identity.topologyGeneration,
    }),
  });

  probe.configure({ enabled: true, recording: true });
  probe.setIdentityReady(identity);
  probe.sampleFrame({ frameMs: 12, renderMs: 8, drawCalls: 9 });
  assert.equal(probe.snapshot().displayPerformance[0].performance.sampleCount, 1);

  identity = {
    canvasGeneration: 3,
    topologyGeneration: 5,
    displayId: 'reassigned',
    displayIndex: 0,
  };
  probe.setIdentityReady(identity);
  assert.equal(probe.recordEvent({ kind: 'topology.changed' }), true);
  const rolled = probe.snapshot();
  assert.equal(rolled.displayPerformance[0].displayId, 'reassigned');
  assert.equal(rolled.displayPerformance[0].performance.sampleCount, 0);
  assert.equal(rolled.displayPerformance[0].performance.currentFps, null);
  assert.equal(rolled.displayPerformance[0].performance.avgFrameMs, null);
  assert.equal(rolled.displayPerformance[0].performance.maxFrameMs, null);
  assert.equal(rolled.displayPerformance[0].performance.drawCalls, null);

  clock = 1;
  probe.sampleFrame({ frameMs: 30, renderMs: 2, drawCalls: 2 });
  const reassigned = probe.snapshot().displayPerformance[0];
  assert.equal(reassigned.performance.sampleCount, 1);
  assert.ok(Math.abs(reassigned.performance.currentFps - (1000 / 30)) < 0.001);
  assert.equal(reassigned.performance.avgFrameMs, 30);
  assert.equal(reassigned.performance.maxFrameMs, 30);
  assert.equal(reassigned.performance.avgRenderMs, 2);
  assert.equal(reassigned.performance.drawCalls, 2);
});

test('DesktopWorld DevTools probe rejects intervening frames until same-size reassignment is ready', () => {
  let identity = {
    canvasGeneration: 3,
    topologyGeneration: 4,
    displayId: '100',
    displayIndex: 0,
  };
  const probe = createDesktopWorldDevToolsStageProbe({
    getStageFacts: () => {
      const value = stageSnapshot();
      value.world = {
        ...value.world,
        displays: value.world.displays.map((display) => (
          display.index === 0 ? { ...display, id: identity.displayId } : display
        )),
      };
      return value;
    },
    getPerformanceDisplay: () => ({
      displayId: identity.displayId,
      displayIndex: identity.displayIndex,
    }),
    getStageIdentity: () => ({
      canvasGeneration: identity.canvasGeneration,
      topologyGeneration: identity.topologyGeneration,
    }),
  });

  probe.configure({ enabled: true, recording: true });
  const originalIdentity = identity;
  probe.setIdentityReady(originalIdentity);
  assert.equal(probe.sampleFrame({ backingWidth: 1920, drawCalls: 1, frameMs: 16 }), true);

  probe.setIdentityReady(false);
  identity = {
    canvasGeneration: 3,
    topologyGeneration: 5,
    displayId: '101',
    displayIndex: 0,
  };
  assert.equal(probe.setIdentityReady(originalIdentity), true);
  assert.equal(
    probe.sampleFrame({ backingWidth: 1920, drawCalls: 99, frameMs: 16 }),
    false,
  );

  probe.setIdentityReady(identity);
  const ready = probe.snapshot().displayPerformance[0];
  assert.equal(ready.displayId, '101');
  assert.equal(ready.performance.sampleCount, 0);
  assert.equal(ready.performance.drawCalls, null);
  assert.equal(ready.performance.backingWidth, null);

  assert.equal(probe.sampleFrame({ backingWidth: 1920, drawCalls: 2, frameMs: 17 }), true);
  const reassigned = probe.snapshot().displayPerformance[0];
  assert.equal(reassigned.performance.sampleCount, 1);
  assert.equal(reassigned.performance.drawCalls, 2);
  assert.equal(reassigned.performance.backingWidth, 1920);
});
