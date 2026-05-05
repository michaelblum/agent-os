import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampFrameToWorkArea,
  createDragController,
  createMaximizeController,
  createResizeController,
  dragFrameFromPointer,
  frameFromWindow,
  normalizeResizeEdge,
  resizeFrame,
  syncMaximizeButton,
  wireDrag,
  wireResize,
  workAreaFromWindow,
} from '../../packages/toolkit/panel/chrome.js';

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
