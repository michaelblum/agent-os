import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createMaximizeController,
  frameFromWindow,
  syncMaximizeButton,
  wireDrag,
  workAreaFromWindow,
} from '../../packages/toolkit/panel/chrome.js';

class FakeNode {}

class FakeElement extends FakeNode {
  constructor() {
    super();
    this.dataset = {};
    this.listeners = new Map();
    this.capturedPointers = new Set();
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
  wireDrag(header, controls, {
    move(screenX, screenY, offsetX, offsetY) {
      moves.push({ screenX, screenY, offsetX, offsetY });
    },
  });

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
