import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  clampFrameToWorkArea,
  chipFrameFromWindow,
  createDragController,
  createMaximizeController,
  createMinimizeController,
  createPanelWindowController,
  createResizeController,
  dragFrameFromPointer,
  frameFromWindow,
  normalizeResizeEdge,
  resizeFrame,
  stageLayerFrameFromNativeFrame,
  syncMaximizeButton,
  wireDrag,
  wireResize,
  workAreaForFrameTopLeft,
  workAreaFromWindow,
} from '../../packages/toolkit/panel/chrome.js';
import {
  resizeFrameFromTopLeft,
  restoredPanelFrameForChip,
  workAreaForPoint,
} from '../../packages/toolkit/panel/placement.js';

test('stock panel defaults make hosted documents fill the WebView viewport', async () => {
  const css = await readFile(new URL('../../packages/toolkit/panel/defaults.css', import.meta.url), 'utf8');
  const documentRule = css.match(/html,\s*\nbody\s*\{[^}]*\}/s)?.[0] || '';

  assert.match(documentRule, /width:\s*100%/);
  assert.match(documentRule, /height:\s*100%/);
  assert.match(documentRule, /min-height:\s*0/);
  assert.match(documentRule, /margin:\s*0/);
  assert.match(documentRule, /overflow:\s*hidden/);
});

class FakeNode {}

class FakeElement extends FakeNode {
  constructor() {
    super();
    this.dataset = {};
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.capturedPointers = new Set();
    this.className = '';
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name);
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) ?? [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  removeEventListener(type, handler) {
    const handlers = this.listeners.get(type) ?? [];
    this.listeners.set(type, handlers.filter((entry) => entry !== handler));
  }

  contains(node) {
    return node === this;
  }

  setPointerCapture(pointerId) {
    this.capturedPointers.add(pointerId);
  }

  hasPointerCapture(pointerId) {
    return this.capturedPointers.has(pointerId);
  }

  releasePointerCapture(pointerId) {
    this.capturedPointers.delete(pointerId);
  }

  dispatch(type, overrides = {}) {
    const event = {
      button: 0,
      pointerId: 1,
      clientX: 0,
      clientY: 0,
      screenX: 0,
      screenY: 0,
      target: this,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      ...overrides,
    };
    for (const handler of this.listeners.get(type) ?? []) {
      handler(event);
    }
    return event;
  }
}

class FakeDocument {
  createElement() {
    return new FakeElement();
  }
}

class FakeButton {
  constructor() {
    this.attributes = new Map();
    this.dataset = {};
    this.title = '';
    this.textContent = '';
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name);
  }
}

const panelDisplays = [
  {
    id: 'main',
    native_bounds: { x: 0, y: 0, w: 1512, h: 982 },
    native_visible_bounds: { x: 0, y: 33, w: 1512, h: 949 },
    is_main: true,
  },
  {
    id: 'extended',
    native_bounds: { x: 1512, y: 0, w: 1920, h: 1080 },
    native_visible_bounds: { x: 1512, y: 0, w: 1920, h: 1040 },
  },
];

const stackedDisplays = [
  {
    id: 'extended-bottom',
    native_bounds: { x: -207, y: 982, w: 1920, h: 1080 },
    native_visible_bounds: { x: -207, y: 1012, w: 1920, h: 976 },
  },
  {
    id: 'main-top',
    native_bounds: { x: 0, y: 0, w: 1512, h: 982 },
    native_visible_bounds: { x: 0, y: 33, w: 1512, h: 949 },
    is_main: true,
  },
];

test('frame and work area helpers normalize current window geometry', () => {
  const view = {
    screenX: 22.3,
    screenY: 44.8,
    innerWidth: 640.2,
    innerHeight: 420.6,
    screen: {
      availLeft: -1440,
      availTop: 25,
      availWidth: 1440,
      availHeight: 875,
    },
  };

  assert.deepEqual(frameFromWindow(view), [22, 45, 640, 421]);
  assert.deepEqual(workAreaFromWindow(view), [-1440, 25, 1440, 875]);
  assert.deepEqual(workAreaFromWindow({
    screenX: 300,
    screenY: 140,
    innerWidth: 500,
    innerHeight: 320,
    screen: { availWidth: 1200, availHeight: 800 },
  }), [300, 140, 1200, 800]);
});

test('chip frame helper avoids menu bar and clamps to available work area', () => {
  assert.deepEqual(chipFrameFromWindow({
    screenX: 0,
    screenY: 0,
    innerWidth: 1200,
    innerHeight: 760,
    screen: {
      availLeft: 0,
      availTop: 33,
      availWidth: 1512,
      availHeight: 949,
    },
  }), [10, 43, 280, 38]);

  assert.deepEqual(chipFrameFromWindow({
    screenX: 1500,
    screenY: 1016,
    innerWidth: 400,
    innerHeight: 240,
    screen: {
      availLeft: -207,
      availTop: 1012,
      availWidth: 1920,
      availHeight: 976,
    },
  }), [1500, 1022, 180, 38]);
});

test('panel work area inference uses the frame top-left display', () => {
  assert.deepEqual(
    workAreaForFrameTopLeft([1510, 80, 640, 420], panelDisplays, [0, 0, 1, 1]),
    [0, 33, 1512, 949],
  );
  assert.deepEqual(
    workAreaForFrameTopLeft([1512, 80, 640, 420], panelDisplays, [0, 0, 1, 1]),
    [1512, 0, 1920, 1040],
  );
});

test('pointer work area inference keeps stacked-display drags on the cursor display', () => {
  assert.deepEqual(
    workAreaForFrameTopLeft([100, 980, 320, 480], stackedDisplays, [0, 0, 1, 1]),
    [0, 33, 1512, 949],
  );
  assert.deepEqual(
    workAreaForPoint({ x: 120, y: 2050 }, stackedDisplays, [0, 0, 1, 1]),
    [-207, 1012, 1920, 976],
  );
});

test('chip frame helper uses top-left display inference when display geometry is available', () => {
  assert.deepEqual(chipFrameFromWindow({
    screenX: 1520,
    screenY: 5,
    innerWidth: 500,
    innerHeight: 240,
    screen: {
      availLeft: 0,
      availTop: 33,
      availWidth: 1512,
      availHeight: 949,
    },
  }, { displays: panelDisplays }), [1522, 10, 210, 38]);
});

test('stageLayerFrameFromNativeFrame maps native chip frames into DesktopWorld coordinates', () => {
  const displays = [{
    id: 1,
    nativeBounds: { x: 0, y: 0, w: 1512, h: 982 },
    desktopWorldBounds: { x: 207, y: 0, w: 1512, h: 982 },
    visibleBounds: { x: 207, y: 33, w: 1512, h: 949 },
    nativeVisibleBounds: { x: 0, y: 33, w: 1512, h: 949 },
  }];

  assert.deepEqual(
    stageLayerFrameFromNativeFrame([520, 120, 180, 38], displays),
    [727, 120, 180, 38],
  );
});

test('createMaximizeController toggles work-area frame and restores previous frame', () => {
  const updates = [];
  const states = [];
  const controller = createMaximizeController({
    getFrame: () => [40, 70, 500, 360],
    getWorkArea: () => [0, 24, 1280, 776],
    updateFrame(frame) {
      updates.push(frame);
    },
    onStateChange(state) {
      states.push(state);
    },
  });

  assert.deepEqual(controller.getState(), { maximized: false, restoreFrame: null });

  assert.deepEqual(controller.maximize(), {
    maximized: true,
    restoreFrame: [40, 70, 500, 360],
  });
  assert.deepEqual(updates, [[0, 24, 1280, 776]]);
  assert.deepEqual(states, [{
    maximized: true,
    restoreFrame: [40, 70, 500, 360],
  }]);

  assert.deepEqual(controller.restore(), { maximized: false, restoreFrame: null });
  assert.deepEqual(updates, [
    [0, 24, 1280, 776],
    [40, 70, 500, 360],
  ]);
  assert.deepEqual(states.at(-1), { maximized: false, restoreFrame: null });
});

test('createMaximizeController can use top-left inferred display work area', () => {
  let frame = [1520, 80, 600, 420];
  const controller = createMaximizeController({
    getFrame: () => frame,
    getWorkArea: () => workAreaForFrameTopLeft(frame, panelDisplays),
    updateFrame(nextFrame) {
      frame = nextFrame;
    },
  });

  assert.deepEqual(controller.maximize(), {
    maximized: true,
    restoreFrame: [1520, 80, 600, 420],
  });
  assert.deepEqual(frame, [1512, 0, 1920, 1040]);
  controller.restore();
  assert.deepEqual(frame, [1520, 80, 600, 420]);
});

test('createPanelWindowController composes the canonical drag resize maximize and minimize policy', async () => {
  let frame = [1520, 80, 600, 420];
  const calls = [];
  const controller = createPanelWindowController({
    getCanvasId: () => 'panel-a',
    getFrame: () => frame,
    getWorkArea: (nextFrame) => workAreaForFrameTopLeft(nextFrame, panelDisplays),
    getDragWorkArea: (nextFrame, pointer) => (
      workAreaForPoint(pointer, panelDisplays, workAreaForFrameTopLeft(nextFrame, panelDisplays))
    ),
    getChipFrame: () => [1522, 90, 220, 38],
    updateFrame(nextFrame) {
      frame = nextFrame;
      calls.push(['updateFrame', nextFrame]);
    },
    move(screenX, screenY, offsetX, offsetY) {
      frame = [screenX - offsetX, screenY - offsetY, frame[2], frame[3]];
      calls.push(['move', screenX, screenY, offsetX, offsetY]);
    },
    drag: { clampOnEnd: true, transfer: false },
    resize: { minWidth: 300, minHeight: 240 },
    maximize: true,
    minimize: {
      useStageChips: false,
      makeChipUrl: () => 'chip-url',
      async spawn(opts) { calls.push(['spawn', opts]); },
      async suspend(id) { calls.push(['suspend', id]); },
      async resume(id) { calls.push(['resume', id]); },
      now: () => 1000,
    },
  });

  assert.equal(typeof controller.dragController.start, 'function');
  assert.equal(typeof controller.resizeController.resize, 'function');
  assert.equal(typeof controller.maximizeController.toggle, 'function');
  assert.equal(typeof controller.minimizeController.minimize, 'function');

  controller.dragController.start({ pointerId: 1, clientX: 20, clientY: 20 });
  controller.dragController.move({ pointerId: 1, screenX: 3500, screenY: 1200 });
  controller.dragController.end({ pointerId: 1, screenX: 3500, screenY: 1200 });
  assert.deepEqual(frame, [2832, 620, 600, 420]);

  controller.resizeController.resize('se', 2000, 2000);
  assert.deepEqual(frame, [2832, 620, 600, 420]);

  controller.maximize();
  assert.deepEqual(frame, [1512, 0, 1920, 1040]);

  const result = await controller.minimize({ title: 'Panel' });
  assert.equal(result.status, 'success');
  assert.equal(result.mode, 'fallback_webview');
  assert.deepEqual(result.restoreFrame, [2832, 620, 600, 420]);
  assert.deepEqual(calls.slice(-3).map((entry) => entry[0]), ['spawn', 'suspend', 'resume']);
});

test('createPanelWindowController prewarms the shared stage before minimize click', async (t) => {
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
  let resolveEnsure;
  const ensurePromise = new Promise((resolve) => {
    resolveEnsure = resolve;
  });
  const controller = createPanelWindowController({
    getCanvasId: () => 'panel-a',
    getFrame: () => [40, 70, 500, 360],
    getChipFrame: () => [10, 43, 220, 38],
    drag: false,
    minimize: {
      ensureStage(opts) {
        calls.push(['ensureStage', opts.id]);
        return ensurePromise;
      },
      sendStageMessage(message) { calls.push(['stage', message.type]); },
      async registerRegion(region) { calls.push(['registerRegion', region.id]); },
      async suspend(id) { calls.push(['suspend', id]); },
      now: () => 1000,
    },
  });

  await Promise.resolve();
  assert.deepEqual(calls, [['ensureStage', 'aos-desktop-world-stage']]);

  const minimized = controller.minimize({ title: 'Panel' });
  await Promise.resolve();
  assert.equal(calls.filter((entry) => entry[0] === 'ensureStage').length, 1);

  resolveEnsure({ ok: true, status: 'created', id: 'aos-desktop-world-stage', created: true });
  const result = await minimized;

  assert.equal(result.status, 'success');
  assert.equal(result.mode, 'stage');
  assert.deepEqual(calls.map((entry) => entry[0]), [
    'ensureStage',
    'stage',
    'registerRegion',
    'registerRegion',
    'registerRegion',
    'suspend',
  ]);
});

test('createMinimizeController prewarm reuses promises and retries only when requested', async () => {
  const calls = [];
  const controller = createMinimizeController({
    ensureStage(opts) {
      calls.push(['ensureStage', opts.id]);
      return calls.length === 1
        ? { ok: false, status: 'create_failed', id: opts.id, created: false }
        : { ok: true, status: 'created', id: opts.id, created: true };
    },
    now: () => 1000,
  });

  assert.equal((await controller.prewarmStage()).ok, false);
  assert.equal((await controller.prewarmStage()).ok, false);
  assert.equal(calls.length, 1);

  const retried = await controller.prewarmStage({ retry: true });
  assert.equal(retried.ok, true);
  assert.equal(calls.length, 2);
});

test('createMinimizeController creates a stage chip and input regions before suspending source', async (t) => {
  const previousWindow = globalThis.window;
  const previousAtob = globalThis.atob;
  globalThis.window = {
    headsup: {},
    webkit: {
      messageHandlers: {
        headsup: {
          postMessage() {},
        },
      },
    },
  };
  globalThis.atob = (value) => Buffer.from(value, 'base64').toString('utf8');
  t.after(() => {
    globalThis.window = previousWindow;
    globalThis.atob = previousAtob;
  });

  let frame = [40, 70, 500, 360];
  const maximize = createMaximizeController({
    getFrame: () => frame,
    getWorkArea: () => [0, 33, 1512, 949],
    updateFrame(nextFrame) {
      frame = nextFrame;
    },
  });
  maximize.maximize();
  assert.deepEqual(frame, [0, 33, 1512, 949]);
  assert.deepEqual(maximize.getState().restoreFrame, [40, 70, 500, 360]);

  const calls = [];
  const ticks = [0, 1000, 1010, 1020, 1030, 1040, 1050, 1060, 1070, 1080, 1090, 1100];
  const nextTick = () => ticks.shift() ?? 1100;
  const controller = createMinimizeController({
    getCanvasId: () => 'panel-a',
    getFrame: () => frame,
    getChipFrame: () => [10, 43, 220, 38],
    async ensureStage(opts) {
      calls.push(['ensureStage', opts.id]);
      return { ok: true, status: 'created', id: opts.id, created: true };
    },
    sendStageMessage(message) {
      calls.push(['stage', message]);
    },
    async registerRegion(region) {
      calls.push(['registerRegion', region]);
    },
    async removeRegion(id) {
      calls.push(['removeRegion', id]);
    },
    async spawn(opts) {
      calls.push(['spawn', opts]);
    },
    async suspend(id) {
      calls.push(['suspend', id]);
    },
    async resume(id) {
      calls.push(['resume', id]);
    },
    async remove(id) {
      calls.push(['remove', id]);
    },
    getStageLayerFrame(frame) {
      return [frame[0] + 1000, frame[1] + 2000, frame[2], frame[3]];
    },
    maximizeController: maximize,
    now: nextTick,
  });

  const result = await controller.minimize({ title: 'Surface Inspector' });

  assert.equal(result.status, 'success');
  assert.equal(result.mode, 'stage');
  assert.equal(result.inFlight, false);
  assert.equal(controller.getState().inFlight, false);
  assert.equal(controller.getState().targetSuspendSucceeded, true);
  assert.equal(controller.getState().rollbackRemovedChip, false);
  assert.equal(controller.getState().chipCanvasId, null);
  assert.equal(controller.getState().chipLayerId, 'aos-chip-panel-a-rs');
  assert.equal(controller.getState().stageLayerUpsertSent, true);
  assert.deepEqual(controller.getState().registeredRegionIds, [
    'aos-chip-panel-a-rs:body',
    'aos-chip-panel-a-rs:restore',
    'aos-chip-panel-a-rs:close',
  ]);
  assert.deepEqual(controller.getState().stageEnsureStatus, {
    ok: true,
    status: 'created',
    id: 'aos-desktop-world-stage',
    url: 'aos://toolkit/components/desktop-world-stage/index.html',
    created: true,
    error: null,
  });
  assert.deepEqual(controller.getState().timing, {
    handlerStart: 0,
    stageEnsureStart: 1010,
    stageEnsureEnd: 1020,
    stageEnsureDurationMs: 10,
    stageLayerUpsertSentAt: 1030,
    inputRegionRegistrationStart: 1040,
    inputRegionRegistrationCount: 3,
    inputRegionRegistrationEnd: 1070,
    inputRegionRegistrationDurationMs: 30,
    sourceSuspendStart: 1080,
    sourceSuspendEnd: 1090,
    sourceSuspendDurationMs: 10,
    totalElapsedMs: 1100,
  });
  assert.deepEqual(controller.getState().regionIds, {
    restore: 'aos-chip-panel-a-rs:restore',
    close: 'aos-chip-panel-a-rs:close',
    body: 'aos-chip-panel-a-rs:body',
  });
  assert.deepEqual(controller.getState().restoreFrame, [40, 70, 500, 360]);
  assert.deepEqual(calls.map((entry) => entry[0]), [
    'ensureStage',
    'stage',
    'registerRegion',
    'registerRegion',
    'registerRegion',
    'suspend',
  ]);
  assert.equal(calls[0][1], 'aos-desktop-world-stage');
  assert.deepEqual(calls[1][1], {
    type: 'desktop_world_stage.layer.upsert',
    payload: {
      id: 'aos-chip-panel-a-rs',
      kind: 'chip',
      label: 'Surface Inspector',
      frame: [1010, 2043, 220, 38],
      zIndex: 20000,
      style: {
        color: 'rgba(245, 247, 250, 0.96)',
        fill: 'rgba(27, 31, 38, 0.92)',
        strokeWidth: 1,
      },
      metadata: {
        toolkit_role: 'minimized_panel_chip',
        toolkit_affordance_id: 'aos-chip-panel-a-rs',
        resource_scope_id: 'aos-chip-panel-a-rs',
        owner_canvas_id: 'panel-a',
        source_canvas_id: 'panel-a',
        target_canvas_id: 'aos-desktop-world-stage',
        stage_affordance_mode: 'minimized_panel_chip',
      },
    },
  });
  assert.deepEqual(calls.slice(2, 5).map((entry) => [entry[1].id, entry[1].frame, entry[1].semantic_label, entry[1].consume_policy, entry[1].remove_on_owner_suspend]), [
    ['aos-chip-panel-a-rs:body', [10, 43, 220, 38], 'drag', 'captured', false],
    ['aos-chip-panel-a-rs:restore', [10, 43, 186, 38], 'restore', 'captured', false],
    ['aos-chip-panel-a-rs:close', [196, 43, 34, 38], 'close', 'down_only', false],
  ]);
  assert.deepEqual(calls[5], ['suspend', 'panel-a']);
  assert.deepEqual(maximize.getState(), { maximized: false, restoreFrame: null });

  window.headsup.receive(Buffer.from(JSON.stringify({
    type: 'input_region.event',
    region_id: 'aos-chip-panel-a-rs:restore',
    phase: 'down',
    native: { x: 32, y: 52 },
  })).toString('base64'));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls.some((entry) => entry[0] === 'resume'), false);

  window.headsup.receive(Buffer.from(JSON.stringify({
    type: 'input_region.event',
    region_id: 'aos-chip-panel-a-rs:restore',
    phase: 'up',
    native: { x: 32, y: 52 },
  })).toString('base64'));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(calls.slice(6).map((entry) => entry[0]), [
    'removeRegion',
    'removeRegion',
    'removeRegion',
    'stage',
    'resume',
  ]);
  assert.deepEqual(calls.slice(6, 9).map((entry) => entry[1]), [
    'aos-chip-panel-a-rs:restore',
    'aos-chip-panel-a-rs:close',
    'aos-chip-panel-a-rs:body',
  ]);
  assert.deepEqual(calls[9][1], {
    type: 'desktop_world_stage.layer.remove',
    payload: { id: 'aos-chip-panel-a-rs' },
  });
  assert.deepEqual(calls[10], ['resume', 'panel-a']);
});

test('createMinimizeController keeps stage mode for a prewarmed stage owned by another canvas', async (t) => {
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
  const controller = createMinimizeController({
    getCanvasId: () => 'surface-inspector',
    getFrame: () => [40, 70, 500, 360],
    getChipFrame: () => [10, 43, 220, 38],
    async ensureStage(opts) {
      calls.push(['ensureStage', opts.id]);
      return {
        ok: true,
        status: 'already_exists',
        id: opts.id,
        url: 'aos://toolkit/components/desktop-world-stage/index.html',
        created: false,
      };
    },
    sendStageMessage(message) { calls.push(['stage', message.type]); },
    async registerRegion(region) { calls.push(['registerRegion', region.id]); },
    async spawn(opts) { calls.push(['spawn', opts.id]); },
    async suspend(id) { calls.push(['suspend', id]); },
    async resume(id) { calls.push(['resume', id]); },
    getStageLayerFrame(frame) {
      return [frame[0] + 1000, frame[1] + 2000, frame[2], frame[3]];
    },
    now: () => 1000,
  });

  const result = await controller.minimize({ title: 'Surface Inspector' });

  assert.equal(result.status, 'success');
  assert.equal(result.mode, 'stage');
  assert.equal(result.stageEnsureStatus.ok, true);
  assert.equal(result.stageEnsureStatus.status, 'already_exists');
  assert.equal(result.stageLayerUpsertSent, true);
  assert.deepEqual(result.registeredRegionIds, [
    'aos-chip-surface-inspector-rs:body',
    'aos-chip-surface-inspector-rs:restore',
    'aos-chip-surface-inspector-rs:close',
  ]);
  assert.equal(calls.some((entry) => entry[0] === 'spawn'), false);
  assert.deepEqual(calls.map((entry) => entry[0]), [
    'ensureStage',
    'stage',
    'registerRegion',
    'registerRegion',
    'registerRegion',
    'suspend',
  ]);
});

test('createMinimizeController can intentionally fall back to a WebView chip', async () => {
  const calls = [];
  const controller = createMinimizeController({
    getCanvasId: () => 'panel-a',
    getFrame: () => [40, 70, 500, 360],
    getChipFrame: () => [10, 43, 220, 38],
    makeChipUrl({ target, title, chipId, chipFrame }) {
      assert.equal(target, 'panel-a');
      assert.equal(title, 'Surface Inspector');
      assert.equal(chipId, 'aos-chip-panel-a-rs');
      assert.deepEqual(chipFrame, [10, 43, 220, 38]);
      return 'aos://toolkit/panel/minimized-chip.html?target=panel-a';
    },
    async spawn(opts) {
      calls.push(['spawn', opts]);
    },
    async suspend(id) {
      calls.push(['suspend', id]);
    },
    async resume(id) {
      calls.push(['resume', id]);
    },
    useStageChips: false,
    now: () => 1000,
  });

  const result = await controller.minimize({ title: 'Surface Inspector' });

  assert.equal(result.status, 'success');
  assert.equal(result.mode, 'fallback_webview');
  assert.deepEqual(calls.map((entry) => entry[0]), ['spawn', 'suspend', 'resume']);
  assert.deepEqual(calls[0][1], {
    id: 'aos-chip-panel-a-rs',
    url: 'aos://toolkit/panel/minimized-chip.html?target=panel-a',
    frame: [10, 43, 220, 38],
    interactive: true,
    focus: false,
    parent: 'panel-a',
    cascade: false,
    suspended: true,
  });
  assert.deepEqual(calls[1], ['suspend', 'panel-a']);
  assert.deepEqual(calls[2], ['resume', 'aos-chip-panel-a-rs']);
});

test('createMinimizeController falls back to WebView when the stage path is unavailable', async () => {
  const calls = [];
  const controller = createMinimizeController({
    getCanvasId: () => 'panel-a',
    getFrame: () => [40, 70, 500, 360],
    getChipFrame: () => [10, 43, 220, 38],
    makeChipUrl: () => 'chip-url',
    async ensureStage() {
      calls.push(['ensureStage']);
      return false;
    },
    sendStageMessage(message) {
      calls.push(['stage', message]);
    },
    async removeRegion(id) {
      calls.push(['removeRegion', id]);
    },
    async spawn(opts) {
      calls.push(['spawn', opts.id]);
    },
    async suspend(id) {
      calls.push(['suspend', id]);
    },
    async resume(id) {
      calls.push(['resume', id]);
    },
    now: () => 1000,
  });

  const result = await controller.minimize({ title: 'Panel' });

  assert.equal(result.status, 'success');
  assert.equal(result.mode, 'fallback_webview');
  assert.equal(result.fallbackChipCreated, true);
  assert.equal(result.fallbackChipResumed, true);
  assert.equal(result.stageLayerUpsertSent, false);
  assert.deepEqual(result.registeredRegionIds, []);
  assert.deepEqual(result.stageEnsureStatus, {
    ok: false,
    status: 'unavailable',
    id: 'aos-desktop-world-stage',
    url: 'aos://toolkit/components/desktop-world-stage/index.html',
    created: false,
    error: null,
  });
  assert.match(result.error, /STAGE_UNAVAILABLE: unavailable/);
  assert.deepEqual(calls.map((entry) => entry[0]), [
    'ensureStage',
    'removeRegion',
    'removeRegion',
    'removeRegion',
    'stage',
    'spawn',
    'suspend',
    'resume',
  ]);
  assert.deepEqual(calls[5], ['spawn', 'aos-chip-panel-a-rs']);
  assert.deepEqual(calls[6], ['suspend', 'panel-a']);
  assert.deepEqual(calls[7], ['resume', 'aos-chip-panel-a-rs']);
});

test('createMinimizeController falls back before source suspend when stage ensure is unknown', async () => {
  const calls = [];
  const controller = createMinimizeController({
    getCanvasId: () => 'panel-a',
    getFrame: () => [40, 70, 500, 360],
    getChipFrame: () => [10, 43, 220, 38],
    makeChipUrl: () => 'chip-url',
    async ensureStage() {
      calls.push(['ensureStage']);
    },
    sendStageMessage(message) { calls.push(['stage', message.type]); },
    async removeRegion(id) { calls.push(['removeRegion', id]); },
    async spawn(opts) { calls.push(['spawn', opts.id]); },
    async suspend(id) { calls.push(['suspend', id]); },
    async resume(id) { calls.push(['resume', id]); },
    now: () => 1000,
  });

  const result = await controller.minimize({ title: 'Panel' });

  assert.equal(result.status, 'success');
  assert.equal(result.mode, 'fallback_webview');
  assert.match(result.error, /STAGE_UNAVAILABLE: unknown/);
  assert.deepEqual(result.stageEnsureStatus, {
    ok: false,
    status: 'unknown',
    id: 'aos-desktop-world-stage',
    url: 'aos://toolkit/components/desktop-world-stage/index.html',
    created: false,
    error: null,
  });
  assert.deepEqual(calls.map((entry) => entry[0]), [
    'ensureStage',
    'removeRegion',
    'removeRegion',
    'removeRegion',
    'stage',
    'spawn',
    'suspend',
    'resume',
  ]);
  assert.ok(calls.findIndex((entry) => entry[0] === 'spawn') < calls.findIndex((entry) => entry[0] === 'suspend'));
});

test('createMinimizeController leaves source active when fallback chip creation fails', async () => {
  const calls = [];
  const controller = createMinimizeController({
    getCanvasId: () => 'panel-a',
    getFrame: () => [40, 70, 500, 360],
    getChipFrame: () => [10, 43, 220, 38],
    makeChipUrl: () => 'chip-url',
    async ensureStage() {
      calls.push(['ensureStage']);
      return false;
    },
    sendStageMessage(message) { calls.push(['stage', message.type]); },
    async removeRegion(id) { calls.push(['removeRegion', id]); },
    async spawn(opts) {
      calls.push(['spawn', opts.id]);
      throw new Error('CREATE_FAILED');
    },
    async suspend(id) { calls.push(['suspend', id]); },
    async resume(id) { calls.push(['resume', id]); },
    async remove(id) { calls.push(['remove', id]); },
    now: () => 1000,
  });

  await assert.rejects(() => controller.minimize({ title: 'Panel' }), /CREATE_FAILED/);

  assert.equal(controller.getState().status, 'failed');
  assert.equal(controller.getState().targetSuspendSucceeded, false);
  assert.equal(controller.getState().fallbackChipCreated, false);
  assert.equal(controller.getState().fallbackCleanupAttempted, true);
  assert.equal(controller.getState().fallbackCleanupAttempts, 1);
  assert.equal(controller.getState().rollbackRemovedChip, true);
  assert.equal(calls.some((entry) => entry[0] === 'suspend'), false);
  assert.equal(calls.some((entry) => entry[0] === 'resume'), false);
  assert.equal(calls.some((entry) => entry[0] === 'remove' && entry[1] === 'aos-chip-panel-a-rs'), true);
});

test('createMinimizeController retries fallback cleanup when create failure races delayed materialization', async () => {
  const calls = [];
  let removeAttempts = 0;
  const controller = createMinimizeController({
    getCanvasId: () => 'panel-a',
    getFrame: () => [40, 70, 500, 360],
    getChipFrame: () => [10, 43, 220, 38],
    makeChipUrl: () => 'chip-url',
    async ensureStage() {
      calls.push(['ensureStage']);
      return false;
    },
    sendStageMessage(message) { calls.push(['stage', message.type]); },
    async removeRegion(id) { calls.push(['removeRegion', id]); },
    async spawn(opts) {
      calls.push(['spawn', opts.id]);
      throw new Error('TIMEOUT: canvas.create');
    },
    async suspend(id) { calls.push(['suspend', id]); },
    async resume(id) { calls.push(['resume', id]); },
    async remove(id) {
      calls.push(['remove', id]);
      removeAttempts += 1;
      if (removeAttempts === 1) throw new Error('NOT_FOUND');
    },
    now: () => 1000,
  });

  await assert.rejects(() => controller.minimize({ title: 'Panel' }), /TIMEOUT: canvas\.create/);

  assert.equal(controller.getState().status, 'failed');
  assert.equal(controller.getState().targetSuspendSucceeded, false);
  assert.equal(controller.getState().fallbackChipCreated, false);
  assert.equal(controller.getState().fallbackCleanupAttempted, true);
  assert.equal(controller.getState().fallbackCleanupAttempts, 2);
  assert.equal(controller.getState().rollbackRemovedChip, true);
  assert.deepEqual(calls.filter((entry) => entry[0] === 'remove'), [
    ['remove', 'aos-chip-panel-a-rs'],
    ['remove', 'aos-chip-panel-a-rs'],
  ]);
  assert.equal(calls.some((entry) => entry[0] === 'suspend'), false);
  assert.equal(calls.some((entry) => entry[0] === 'resume'), false);
});

test('createMinimizeController resumes source and removes fallback chip when fallback resume fails', async () => {
  const calls = [];
  const controller = createMinimizeController({
    getCanvasId: () => 'panel-a',
    getFrame: () => [40, 70, 500, 360],
    getChipFrame: () => [10, 43, 220, 38],
    makeChipUrl: () => 'chip-url',
    async ensureStage() {
      calls.push(['ensureStage']);
      return false;
    },
    sendStageMessage(message) { calls.push(['stage', message.type]); },
    async removeRegion(id) { calls.push(['removeRegion', id]); },
    async spawn(opts) { calls.push(['spawn', opts.id]); },
    async suspend(id) { calls.push(['suspend', id]); },
    async resume(id) {
      calls.push(['resume', id]);
      if (id === 'aos-chip-panel-a-rs') throw new Error('RESUME_FAILED');
    },
    async remove(id, opts) { calls.push(['remove', id, opts]); },
    now: () => 1000,
  });

  await assert.rejects(() => controller.minimize({ title: 'Panel' }), /RESUME_FAILED/);

  assert.equal(controller.getState().status, 'failed');
  assert.equal(controller.getState().targetSuspendSucceeded, true);
  assert.equal(controller.getState().fallbackChipCreated, true);
  assert.equal(controller.getState().fallbackChipResumed, false);
  assert.equal(controller.getState().rollbackRemovedChip, true);
  assert.deepEqual(calls.slice(-3), [
    ['resume', 'aos-chip-panel-a-rs'],
    ['remove', 'aos-chip-panel-a-rs', { orphan_children: true }],
    ['resume', 'panel-a'],
  ]);
});

test('createMinimizeController close region removes the stage chip and source panel', async (t) => {
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
  const controller = createMinimizeController({
    getCanvasId: () => 'panel-a',
    getFrame: () => [40, 70, 500, 360],
    getChipFrame: () => [10, 43, 220, 38],
    async ensureStage() { return true; },
    sendStageMessage(message) { calls.push(['stage', message]); },
    async registerRegion(region) { calls.push(['registerRegion', region.id]); },
    async removeRegion(id) { calls.push(['removeRegion', id]); },
    async suspend(id) { calls.push(['suspend', id]); },
    async remove(id, opts) { calls.push(['remove', id, opts]); },
    now: () => 1000,
  });

  await controller.minimize({ title: 'Panel' });
  window.headsup.receive(Buffer.from(JSON.stringify({
    type: 'input_region.event',
    region_id: 'aos-chip-panel-a-rs:close',
    phase: 'down',
  })).toString('base64'));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(calls.slice(5).map((entry) => entry[0]), [
    'removeRegion',
    'removeRegion',
    'removeRegion',
    'stage',
    'remove',
  ]);
  assert.deepEqual(calls.at(-1), ['remove', 'panel-a', { orphan_children: true }]);
});

test('createMinimizeController drags the stage chip body without restoring the source', async (t) => {
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
  const controller = createMinimizeController({
    getCanvasId: () => 'panel-a',
    getFrame: () => [40, 70, 500, 360],
    getChipFrame: () => [10, 43, 220, 38],
    async ensureStage() { return true; },
    sendStageMessage(message) { calls.push(['stage', message]); },
    async registerRegion(region) { calls.push(['registerRegion', region]); },
    async updateRegion(region) { calls.push(['updateRegion', region]); },
    async removeRegion(id) { calls.push(['removeRegion', id]); },
    async suspend(id) { calls.push(['suspend', id]); },
    async resume(id) { calls.push(['resume', id]); },
    getStageLayerFrame(frame) {
      return [frame[0] + 1000, frame[1] + 2000, frame[2], frame[3]];
    },
    now: () => 1000,
  });

  await controller.minimize({ title: 'Panel' });
  window.headsup.receive(Buffer.from(JSON.stringify({
    type: 'input_region.event',
    region_id: 'aos-chip-panel-a-rs:body',
    phase: 'down',
    native: { x: 40, y: 55 },
  })).toString('base64'));
  window.headsup.receive(Buffer.from(JSON.stringify({
    type: 'input_region.event',
    region_id: 'aos-chip-panel-a-rs:body',
    phase: 'drag',
    native: { x: 64, y: 75 },
  })).toString('base64'));
  await new Promise((resolve) => setImmediate(resolve));
  window.headsup.receive(Buffer.from(JSON.stringify({
    type: 'input_region.event',
    region_id: 'aos-chip-panel-a-rs:body',
    phase: 'up',
    native: { x: 64, y: 75 },
  })).toString('base64'));
  await new Promise((resolve) => setImmediate(resolve));

  const upserts = calls.filter((entry) => entry[0] === 'stage' && entry[1].type === 'desktop_world_stage.layer.upsert');
  assert.deepEqual(upserts[0][1].payload.frame, [1010, 2043, 220, 38]);
  assert.deepEqual(upserts.at(-1)[1].payload.frame, [1034, 2063, 220, 38]);
  assert.deepEqual(upserts.at(-1)[1].payload.metadata, {
    toolkit_role: 'minimized_panel_chip',
    toolkit_affordance_id: 'aos-chip-panel-a-rs',
    resource_scope_id: 'aos-chip-panel-a-rs',
    owner_canvas_id: 'panel-a',
    source_canvas_id: 'panel-a',
    target_canvas_id: 'aos-desktop-world-stage',
    stage_affordance_mode: 'minimized_panel_chip',
  });
  assert.deepEqual(calls.filter((entry) => entry[0] === 'updateRegion').map((entry) => [
    entry[1].id,
    entry[1].frame,
    entry[1].semantic_label,
    entry[1].priority,
    entry[1].consume_policy,
  ]), [
    ['aos-chip-panel-a-rs:body', [34, 63, 220, 38], 'drag', 1150, 'captured'],
    ['aos-chip-panel-a-rs:restore', [34, 63, 186, 38], 'restore', 1100, 'captured'],
    ['aos-chip-panel-a-rs:close', [220, 63, 34, 38], 'close', 1200, 'down_only'],
  ]);
  assert.equal(calls.some((entry) => entry[0] === 'resume'), false);
  assert.equal(calls.some((entry) => entry[0] === 'removeRegion'), false);
});

test('createMinimizeController owner removal clears the orphaned stage chip', async (t) => {
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
  const controller = createMinimizeController({
    getCanvasId: () => 'panel-a',
    getFrame: () => [40, 70, 500, 360],
    getChipFrame: () => [10, 43, 220, 38],
    async ensureStage() { return true; },
    sendStageMessage(message) { calls.push(['stage', message]); },
    async registerRegion(region) { calls.push(['registerRegion', region.id]); },
    async removeRegion(id) { calls.push(['removeRegion', id]); },
    async suspend(id) { calls.push(['suspend', id]); },
    async resume(id) { calls.push(['resume', id]); },
    async remove(id) { calls.push(['remove', id]); },
    now: () => 1000,
  });

  await controller.minimize({ title: 'Panel' });
  window.headsup.receive(Buffer.from(JSON.stringify({
    type: 'canvas_lifecycle',
    payload: {
      action: 'removed',
      canvas_id: 'panel-a',
    },
  })).toString('base64'));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(calls.slice(5).map((entry) => entry[0]), [
    'removeRegion',
    'removeRegion',
    'removeRegion',
    'stage',
  ]);
  assert.equal(calls.some((entry) => entry[0] === 'resume'), false);
  assert.equal(calls.some((entry) => entry[0] === 'remove'), false);
});

test('createMinimizeController ignores duplicate minimize while a source suspend is in flight', async () => {
  let resolveSuspend;
  const calls = [];
  const controller = createMinimizeController({
    getCanvasId: () => 'panel-a',
    getFrame: () => [40, 70, 500, 360],
    getChipFrame: () => [10, 43, 220, 38],
    makeChipUrl: () => 'chip-url',
    async spawn(opts) {
      calls.push(['spawn', opts.id]);
    },
    suspend(id) {
      calls.push(['suspend', id]);
      return new Promise((resolve) => {
        resolveSuspend = resolve;
      });
    },
    async resume(id) {
      calls.push(['resume', id]);
    },
    useStageChips: false,
    now: () => 1000,
  });

  const first = controller.minimize({ title: 'Panel' });
  const duplicate = await controller.minimize({ title: 'Panel' });
  assert.equal(duplicate.status, 'ignored_in_flight');
  assert.equal(controller.getState().inFlight, true);
  assert.equal(calls.filter((entry) => entry[0] === 'spawn').length, 1);
  assert.equal(calls.filter((entry) => entry[0] === 'suspend').length, 1);

  resolveSuspend();
  await first;

  assert.deepEqual(calls.map((entry) => entry[0]), ['spawn', 'suspend', 'resume']);
  assert.equal(controller.getState().status, 'success');
  assert.equal(controller.getState().inFlight, false);
});

test('createMinimizeController removes the hidden chip when source suspend fails', async () => {
  const calls = [];
  const controller = createMinimizeController({
    getCanvasId: () => 'panel-a',
    getFrame: () => [40, 70, 500, 360],
    getChipFrame: () => [10, 43, 220, 38],
    makeChipUrl: () => 'chip-url',
    async spawn(opts) {
      calls.push(['spawn', opts.id, opts.suspended]);
    },
    async suspend(id) {
      calls.push(['suspend', id]);
      throw new Error('SUSPEND_FAILED');
    },
    async resume(id) {
      calls.push(['resume', id]);
    },
    async remove(id, opts) {
      calls.push(['remove', id, opts]);
    },
    useStageChips: false,
    now: () => 1000,
  });

  await assert.rejects(() => controller.minimize({ title: 'Panel' }), /SUSPEND_FAILED/);

  assert.deepEqual(calls, [
    ['spawn', 'aos-chip-panel-a-rs', true],
    ['suspend', 'panel-a'],
    ['remove', 'aos-chip-panel-a-rs', { orphan_children: true }],
  ]);
  assert.equal(controller.getState().status, 'failed');
  assert.equal(controller.getState().targetSuspendSucceeded, false);
  assert.equal(controller.getState().rollbackRemovedChip, true);
  assert.equal(controller.getState().inFlight, false);
  assert.match(controller.getState().error, /SUSPEND_FAILED/);
});

test('minimized chip restore keeps saved frame when chip and panel share a display', () => {
  assert.deepEqual(
    restoredPanelFrameForChip({
      restoreFrame: [40, 70, 500, 360],
      chipFrame: [42, 80, 220, 38],
      displays: panelDisplays,
    }),
    [40, 70, 500, 360],
  );
});

test('minimized chip restore follows the chip display when moved across displays', () => {
  assert.deepEqual(
    restoredPanelFrameForChip({
      restoreFrame: [40, 70, 500, 360],
      chipFrame: [1520, 80, 220, 38],
      displays: panelDisplays,
    }),
    [1520, 80, 500, 360],
  );
});

test('minimized chip restore clamps to the chip display visible work area', () => {
  assert.deepEqual(
    restoredPanelFrameForChip({
      restoreFrame: [40, 70, 500, 360],
      chipFrame: [3390, 1020, 220, 38],
      displays: panelDisplays,
    }),
    [2932, 680, 500, 360],
  );
});

test('resizeFrameFromTopLeft preserves panel origin and clamps resized frame', () => {
  assert.deepEqual(
    resizeFrameFromTopLeft([40, 70, 500, 360], { height: 620 }),
    [40, 70, 500, 620],
  );
  assert.deepEqual(
    resizeFrameFromTopLeft([40, 70, 500, 360], {
      height: 2000,
      maxHeight: 900,
      workArea: [0, 33, 1512, 949],
    }),
    [40, 70, 500, 900],
  );
});

test('resize geometry handles edges, corners, constraints, and work-area clamp', () => {
  assert.equal(normalizeResizeEdge('bottom-right'), 'se');
  assert.deepEqual(resizeFrame([100, 100, 400, 300], 'se', 50, 60), [100, 100, 450, 360]);
  assert.deepEqual(resizeFrame([100, 100, 400, 300], 'nw', 80, 40), [180, 140, 320, 260]);
  assert.deepEqual(resizeFrame([100, 100, 400, 300], 'w', 390, 0, {
    minWidth: 240,
  }), [260, 100, 240, 300]);
  assert.deepEqual(resizeFrame([100, 100, 400, 300], 'e', 1000, 0, {
    workArea: [0, 0, 800, 600],
  }), [100, 100, 700, 300]);
  assert.deepEqual(clampFrameToWorkArea([740, 560, 200, 120], {
    workArea: [0, 0, 800, 600],
  }), [600, 480, 200, 120]);
});

test('work-area clamp covers off-left off-right and off-bottom panel drops', () => {
  const workArea = [100, 50, 800, 600];

  assert.deepEqual(clampFrameToWorkArea([-260, 120, 240, 160], {
    workArea,
  }), [100, 120, 240, 160]);
  assert.deepEqual(clampFrameToWorkArea([840, 120, 240, 160], {
    workArea,
  }), [660, 120, 240, 160]);
  assert.deepEqual(clampFrameToWorkArea([240, 620, 240, 160], {
    workArea,
  }), [240, 490, 240, 160]);
});

test('drag geometry derives pointer frames and clamps final placement', () => {
  assert.deepEqual(dragFrameFromPointer(
    { screenX: 640, screenY: 420 },
    40,
    20,
    [100, 100, 360, 240],
  ), [600, 400, 360, 240]);

  let frame = [700, 560, 240, 160];
  const updates = [];
  const moves = [];
  const states = [];
  const controller = createDragController({
    move(screenX, screenY, offsetX, offsetY) {
      moves.push({ screenX, screenY, offsetX, offsetY });
      frame = [screenX - offsetX, screenY - offsetY, frame[2], frame[3]];
    },
    getFrame: () => frame,
    getWorkArea: () => [0, 0, 800, 600],
    updateFrame(nextFrame) {
      frame = nextFrame;
      updates.push(nextFrame);
    },
    clampOnEnd: true,
    onStateChange(state) {
      states.push(state);
    },
  });

  controller.start({ pointerId: 1, clientX: 40, clientY: 20 });
  controller.move({ pointerId: 1, screenX: 770, screenY: 620 });
  assert.deepEqual(moves, [{ screenX: 770, screenY: 620, offsetX: 40, offsetY: 20 }]);
  controller.end();

  assert.deepEqual(updates.at(-1), [560, 440, 240, 160]);
  assert.deepEqual(frame, [560, 440, 240, 160]);
  assert.deepEqual(states.map((state) => state.phase), ['start', 'move', 'end']);
});

test('drag end clamps to the cursor display instead of a seam-adjacent top-left display', () => {
  let frame = [100, 980, 320, 480];
  const updates = [];
  const controller = createDragController({
    move(screenX, screenY, offsetX, offsetY) {
      frame = [screenX - offsetX, screenY - offsetY, frame[2], frame[3]];
    },
    getFrame: () => frame,
    getWorkArea: (nextFrame) => workAreaForFrameTopLeft(nextFrame, stackedDisplays),
    getDragWorkArea: (nextFrame, pointer) => (
      workAreaForPoint(pointer, stackedDisplays, workAreaForFrameTopLeft(nextFrame, stackedDisplays))
    ),
    updateFrame(nextFrame) {
      frame = nextFrame;
      updates.push(nextFrame);
    },
    clampOnEnd: true,
  });

  controller.start({ pointerId: 1, clientX: 20, clientY: 1070, screenX: 120, screenY: 1000 });
  controller.move({ pointerId: 1, screenX: 120, screenY: 2050 });
  controller.end({ pointerId: 1, screenX: 120, screenY: 2050 });

  assert.deepEqual(updates.at(-1), [100, 1012, 320, 480]);
  assert.deepEqual(frame, [100, 1012, 320, 480]);
});

test('drag end clamps daemon-reported frame instead of stale display-local WebKit pointer frame', () => {
  let frame = [1333, 1130, 360, 230];
  const updates = [];
  const controller = createDragController({
    move() {
      // Native move_abs uses the real AppKit mouse position. On lower
      // displays, WebKit can still report display-local screenY to JS.
      frame = [1300, 1550, 360, 230];
    },
    getFrame: () => frame,
    getWorkArea: (nextFrame) => workAreaForFrameTopLeft(nextFrame, stackedDisplays),
    getDragWorkArea: (nextFrame, pointer) => (
      workAreaForPoint(pointer, stackedDisplays, workAreaForFrameTopLeft(nextFrame, stackedDisplays))
    ),
    updateFrame(nextFrame) {
      frame = nextFrame;
      updates.push(nextFrame);
    },
    clampOnEnd: true,
  });

  controller.start({ pointerId: 1, clientX: 60, clientY: 20, screenX: 1393, screenY: 1150 });
  controller.move({ pointerId: 1, screenX: 1360, screenY: 80 });
  controller.end({ pointerId: 1, screenX: 1360, screenY: 1570 });

  assert.deepEqual(updates, []);
  assert.deepEqual(frame, [1300, 1550, 360, 230]);
});

test('createResizeController updates frames from pointer deltas', () => {
  let frame = [100, 100, 400, 300];
  const updates = [];
  const states = [];
  const controller = createResizeController({
    getFrame: () => frame,
    getWorkArea: () => [0, 0, 900, 700],
    updateFrame(nextFrame) {
      frame = nextFrame;
      updates.push(nextFrame);
    },
    onStateChange(state) {
      states.push(state);
    },
  });

  controller.start('se', { screenX: 10, screenY: 10 });
  assert.equal(controller.getState().active, true);
  controller.move({ screenX: 60, screenY: 80 });
  assert.deepEqual(updates.at(-1), [100, 100, 450, 370]);
  controller.end();

  assert.equal(controller.getState().active, false);
  assert.deepEqual(states.map((state) => state.phase), ['start', 'move', 'end']);
});

test('syncMaximizeButton reports maximize and restore state accessibly', () => {
  const button = new FakeButton();

  syncMaximizeButton(button, { maximized: false });
  assert.equal(button.getAttribute('aria-label'), 'Maximize panel');
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  assert.equal(button.title, 'Maximize');
  assert.equal(button.textContent, '+');
  assert.equal(button.dataset.maximized, 'false');

  syncMaximizeButton(button, { maximized: true });
  assert.equal(button.getAttribute('aria-label'), 'Restore panel');
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  assert.equal(button.title, 'Restore');
  assert.equal(button.textContent, '[]');
  assert.equal(button.dataset.maximized, 'true');
});

test('wireDrag emits absolute drag updates with the original pointer offset', async (t) => {
  const previousNode = globalThis.Node;
  const previousWindow = globalThis.window;
  globalThis.Node = FakeNode;
  const emitted = [];
  globalThis.window = {
    webkit: {
      messageHandlers: {
        headsup: {
          postMessage(message) {
            emitted.push(message);
          },
        },
      },
    },
  };
  t.after(() => {
    globalThis.Node = previousNode;
    globalThis.window = previousWindow;
  });

  const header = new FakeElement();
  const controls = new FakeElement();
  const moves = [];
  const controller = wireDrag(header, controls, {
    globalInput: false,
    move(screenX, screenY, offsetX, offsetY) {
      moves.push({ screenX, screenY, offsetX, offsetY });
    },
  });
  assert.equal(controller.getState().active, false);

  const down = header.dispatch('pointerdown', {
    button: 0,
    pointerId: 7,
    clientX: 24,
    clientY: 10,
    target: header,
  });
  assert.equal(down.defaultPrevented, true);
  assert.equal(header.dataset.dragging, 'true');
  assert.equal(header.hasPointerCapture(7), true);
  assert.deepEqual(emitted, [{ type: 'drag_start' }]);

  header.dispatch('pointermove', { pointerId: 8, screenX: 111, screenY: 222 });
  assert.equal(moves.length, 0);

  header.dispatch('pointermove', { pointerId: 7, screenX: 300, screenY: 400 });
  assert.deepEqual(moves, [
    { screenX: 300, screenY: 400, offsetX: 24, offsetY: 10 },
  ]);

  header.dispatch('pointerup', { pointerId: 7 });
  assert.equal('dragging' in header.dataset, false);
  assert.equal(controller.getState().active, false);
  assert.equal(header.hasPointerCapture(7), false);
  assert.deepEqual(emitted, [{ type: 'drag_start' }, { type: 'drag_end' }]);
});

test('wireDrag ignores pointerdown events originating from controls', async (t) => {
  const previousNode = globalThis.Node;
  const previousWindow = globalThis.window;
  globalThis.Node = FakeNode;
  const emitted = [];
  globalThis.window = {
    webkit: {
      messageHandlers: {
        headsup: {
          postMessage(message) {
            emitted.push(message);
          },
        },
      },
    },
  };
  t.after(() => {
    globalThis.Node = previousNode;
    globalThis.window = previousWindow;
  });

  const header = new FakeElement();
  const controls = new FakeElement();
  const moves = [];
  wireDrag(header, controls, {
    globalInput: false,
    move(...args) {
      moves.push(args);
    },
  });

  header.dispatch('pointerdown', {
    button: 0,
    pointerId: 3,
    clientX: 12,
    clientY: 8,
    target: controls,
  });
  header.dispatch('pointermove', { pointerId: 3, screenX: 200, screenY: 300 });
  assert.equal(moves.length, 0);
  assert.equal('dragging' in header.dataset, false);
  assert.equal(emitted.length, 0);
});

test('wireDrag follows daemon input events while the cursor leaves the canvas', async (t) => {
  const previousNode = globalThis.Node;
  const previousWindow = globalThis.window;
  const previousAtob = globalThis.atob;
  globalThis.Node = FakeNode;
  const emitted = [];
  globalThis.window = {
    headsup: {},
    webkit: {
      messageHandlers: {
        headsup: {
          postMessage(message) {
            emitted.push(message);
          },
        },
      },
    },
  };
  globalThis.atob = (value) => Buffer.from(value, 'base64').toString('utf8');
  t.after(() => {
    globalThis.Node = previousNode;
    globalThis.window = previousWindow;
    globalThis.atob = previousAtob;
  });

  const header = new FakeElement();
  const controls = new FakeElement();
  const moves = [];
  const controller = wireDrag(header, controls, {
    move(screenX, screenY, offsetX, offsetY) {
      moves.push({ screenX, screenY, offsetX, offsetY });
    },
  });

  header.dispatch('pointerdown', {
    button: 0,
    pointerId: 7,
    clientX: 24,
    clientY: 10,
    target: header,
  });
  assert.equal(controller.getState().active, true);

  const sendInput = (message) => {
    window.headsup.receive(Buffer.from(JSON.stringify(message)).toString('base64'));
  };
  sendInput({ type: 'input_event', payload: { type: 'left_mouse_dragged', x: 500, y: 1040 } });
  assert.deepEqual(moves, [{ screenX: 500, screenY: 1040, offsetX: 24, offsetY: 10 }]);

  sendInput({ type: 'input_event', payload: { type: 'left_mouse_up', x: 500, y: 1040 } });
  assert.equal(controller.getState().active, false);
  assert.equal('dragging' in header.dataset, false);
  assert.deepEqual(emitted.map((message) => message.type), [
    'drag_start',
    'subscribe',
    'drag_end',
    'unsubscribe',
  ]);
});

test('wireDrag does not use DOM pointermove coordinates for global panel placement', async (t) => {
  const previousNode = globalThis.Node;
  const previousWindow = globalThis.window;
  const previousAtob = globalThis.atob;
  globalThis.Node = FakeNode;
  const emitted = [];
  globalThis.window = {
    headsup: {},
    webkit: {
      messageHandlers: {
        headsup: {
          postMessage(message) {
            emitted.push(message);
          },
        },
      },
    },
  };
  globalThis.atob = (value) => Buffer.from(value, 'base64').toString('utf8');
  t.after(() => {
    globalThis.Node = previousNode;
    globalThis.window = previousWindow;
    globalThis.atob = previousAtob;
  });

  const header = new FakeElement();
  const controls = new FakeElement();
  const starts = [];
  const moves = [];
  const ends = [];
  const controller = {
    start(pointer) {
      starts.push(pointer);
      return { active: true };
    },
    move(pointer) {
      moves.push(pointer);
      return { active: true };
    },
    end(pointer) {
      ends.push(pointer);
      return { active: false };
    },
    getState() {
      return { active: starts.length > ends.length };
    },
  };
  wireDrag(header, controls, { controller });

  header.dispatch('pointerdown', {
    button: 0,
    pointerId: 7,
    clientX: 24,
    clientY: 10,
    screenX: 1393,
    screenY: 1150,
    target: header,
  });
  header.dispatch('pointermove', { pointerId: 7, screenX: 1360, screenY: 80 });

  const sendInput = (message) => {
    window.headsup.receive(Buffer.from(JSON.stringify(message)).toString('base64'));
  };
  sendInput({ type: 'input_event', payload: { type: 'left_mouse_dragged', x: 1360, y: 1570 } });
  header.dispatch('pointerup', { pointerId: 7, screenX: 1360, screenY: 80 });

  assert.equal(starts.length, 1);
  assert.deepEqual(moves, [{ pointerId: 7, screenX: 1360, screenY: 1570, source: 'input_event' }]);
  assert.deepEqual(ends, [{ pointerId: 7, screenX: 1360, screenY: 1570, source: 'input_event' }]);
  assert.deepEqual(emitted.map((message) => message.type), [
    'drag_start',
    'subscribe',
    'drag_end',
    'unsubscribe',
  ]);
});

test('wireResize creates edge handles and emits resize lifecycle messages', async (t) => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = new FakeDocument();
  const emitted = [];
  globalThis.window = {
    webkit: {
      messageHandlers: {
        headsup: {
          postMessage(message) {
            emitted.push(message);
          },
        },
      },
    },
  };
  t.after(() => {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  });

  let frame = [100, 100, 400, 300];
  const panel = new FakeElement();
  const resize = wireResize(panel, {
    edges: ['se'],
    controller: createResizeController({
      getFrame: () => frame,
      getWorkArea: () => [0, 0, 900, 700],
      updateFrame(nextFrame) {
        frame = nextFrame;
      },
    }),
  });

  assert.equal(resize.handles.length, 1);
  const handle = resize.handles[0];
  assert.equal(handle.dataset.edge, 'se');
  assert.equal(handle.getAttribute('aria-hidden'), 'true');

  handle.dispatch('pointerdown', { pointerId: 11, screenX: 10, screenY: 10 });
  handle.dispatch('pointermove', { pointerId: 11, screenX: 50, screenY: 60 });
  assert.deepEqual(frame, [100, 100, 440, 350]);
  handle.dispatch('pointerup', { pointerId: 11 });

  assert.deepEqual(emitted, [
    { type: 'resize_start', payload: { edge: 'se' } },
    { type: 'resize_end', payload: { edge: 'se' } },
  ]);
});
