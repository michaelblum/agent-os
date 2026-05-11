import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampFrameToWorkArea,
  chipFrameFromWindow,
  createDragController,
  createMaximizeController,
  createMinimizeController,
  createResizeController,
  dragFrameFromPointer,
  frameFromWindow,
  normalizeResizeEdge,
  resizeFrame,
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

test('createMinimizeController creates a hidden chip, suspends source, then shows the chip with pre-maximize restore frame', async () => {
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
  const controller = createMinimizeController({
    getCanvasId: () => 'panel-a',
    getFrame: () => frame,
    getChipFrame: () => [10, 43, 220, 38],
    makeChipUrl({ target, title, restoreFrame, chipId, chipFrame }) {
      assert.equal(target, 'panel-a');
      assert.equal(title, 'Surface Inspector');
      assert.equal(chipId, 'aos-chip-panel-a-rs');
      assert.deepEqual(restoreFrame, [40, 70, 500, 360]);
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
    async remove(id) {
      calls.push(['remove', id]);
    },
    maximizeController: maximize,
    now: () => 1000,
  });

  const result = await controller.minimize({ title: 'Surface Inspector' });

  assert.equal(result.status, 'success');
  assert.equal(result.inFlight, false);
  assert.equal(controller.getState().inFlight, false);
  assert.equal(controller.getState().targetSuspendSucceeded, true);
  assert.equal(controller.getState().rollbackRemovedChip, false);
  assert.deepEqual(controller.getState().restoreFrame, [40, 70, 500, 360]);
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
  assert.deepEqual(maximize.getState(), { maximized: false, restoreFrame: null });
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
