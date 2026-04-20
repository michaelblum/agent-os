import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wireDrag } from '../../packages/toolkit/panel/chrome.js';

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
