import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampSplitPaneState,
  createSplitPane,
  SplitPane,
} from '../../packages/toolkit/panel/layouts/split-pane.js';

class FakeNode {}

class FakeClassList {
  constructor(owner) {
    this.owner = owner;
    this.names = new Set();
  }

  setFromString(value) {
    this.names = new Set(String(value || '').split(/\s+/).filter(Boolean));
  }

  add(...names) {
    for (const name of names) this.names.add(name);
    this.owner._className = Array.from(this.names).join(' ');
  }

  contains(name) {
    return this.names.has(name);
  }
}

class FakeStyle {
  setProperty(name, value) {
    this[name] = String(value);
  }
}

class FakeElement extends FakeNode {
  constructor(tagName = 'div') {
    super();
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.listeners = new Map();
    this.dataset = {};
    this.attributes = {};
    this.style = new FakeStyle();
    this.classList = new FakeClassList(this);
    this._className = '';
    this.innerHTML = '';
    this.textContent = '';
    this.rect = { left: 0, top: 0, width: 1000, height: 600 };
    this.capturedPointers = new Set();
  }

  get className() {
    return this._className;
  }

  set className(value) {
    this._className = String(value);
    this.classList.setFromString(this._className);
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  insertBefore(child, reference) {
    child.parentNode = this;
    const index = this.children.indexOf(reference);
    if (index < 0) this.children.push(child);
    else this.children.splice(index, 0, child);
    return child;
  }

  contains(target) {
    if (target === this) return true;
    return this.children.some((child) => child === target || child.contains?.(target));
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'id') this.id = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
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

  dispatch(type, overrides = {}) {
    const event = {
      button: 0,
      pointerId: 1,
      clientX: 0,
      clientY: 0,
      key: '',
      target: this,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      ...overrides,
    };
    for (const handler of this.listeners.get(type) ?? []) handler(event);
    return event;
  }

  getBoundingClientRect() {
    return { ...this.rect };
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
}

class FakeDocument {
  createElement(tagName) {
    return new FakeElement(tagName);
  }
}

class FakeStorage {
  constructor(seed = {}) {
    this.values = new Map(Object.entries(seed));
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }
}

function makeContent(name) {
  return () => ({
    manifest: {
      name,
      channelPrefix: name,
      accepts: ['ping'],
      emits: ['pong'],
    },
    render() {
      const element = new FakeElement('section');
      element.textContent = name;
      return element;
    },
  });
}

test('clampSplitPaneState enforces min and max pane constraints', () => {
  assert.deepEqual(clampSplitPaneState({
    ratio: 0.1,
    size: 1000,
    dividerSize: 8,
    minStart: 240,
    minEnd: 300,
  }), {
    ratio: 240 / 992,
    startSize: 240,
    endSize: 752,
    availableSize: 992,
  });

  assert.deepEqual(clampSplitPaneState({
    ratio: 0.95,
    size: 1000,
    dividerSize: 8,
    minStart: 240,
    minEnd: 300,
    maxStart: 620,
  }), {
    ratio: 620 / 992,
    startSize: 620,
    endSize: 372,
    availableSize: 992,
  });
});

test('createSplitPane wires existing panes with separator semantics and restored state', () => {
  const documentRef = new FakeDocument();
  const root = documentRef.createElement('main');
  const startPane = documentRef.createElement('section');
  const endPane = documentRef.createElement('aside');
  root.appendChild(startPane);
  root.appendChild(endPane);
  root.rect = { left: 0, top: 0, width: 1008, height: 600 };

  const split = createSplitPane({
    root,
    startPane,
    endPane,
    document: documentRef,
    restoreState: { ratio: 0.6 },
    minStart: 200,
    minEnd: 240,
    dividerSize: 8,
    ariaLabel: 'Resize preview and controls panes',
  });

  assert.equal(root.classList.contains('aos-split-pane'), true);
  assert.equal(startPane.classList.contains('aos-split-pane-start'), true);
  assert.equal(endPane.classList.contains('aos-split-pane-end'), true);
  assert.equal(root.children[1], split.divider);
  assert.equal(split.divider.getAttribute('role'), 'separator');
  assert.equal(split.divider.getAttribute('aria-orientation'), 'vertical');
  assert.equal(split.divider.getAttribute('aria-label'), 'Resize preview and controls panes');
  assert.equal(split.divider.getAttribute('aria-valuenow'), '60');
  assert.deepEqual(split.getState(), {
    orientation: 'horizontal',
    ratio: 0.6,
    startSize: 600,
    endSize: 400,
    availableSize: 1000,
    closedPane: null,
  });
});

test('split pane pointer and keyboard updates emit constrained persisted ratios', () => {
  const documentRef = new FakeDocument();
  const storage = new FakeStorage({ split: JSON.stringify({ ratio: 0.5 }) });
  const changes = [];
  const split = createSplitPane({
    document: documentRef,
    storage,
    storageKey: 'split',
    minStart: 120,
    minEnd: 160,
    dividerSize: 8,
    keyboardStep: 40,
    onChange(state) {
      changes.push(state);
    },
  });
  split.root.rect = { left: 0, top: 0, width: 808, height: 500 };
  split.setRatio(0.5, { notify: false, persist: false });

  split.divider.dispatch('pointerdown', { pointerId: 9, clientX: 400 });
  assert.equal(split.divider.dataset.dragging, 'true');
  assert.equal(split.root.dataset.dragging, 'true');
  split.divider.dispatch('pointermove', { pointerId: 9, clientX: 604 });
  split.divider.dispatch('pointerup', { pointerId: 9 });

  assert.equal(split.divider.dataset.dragging, undefined);
  assert.equal(split.getState().startSize, 600);
  assert.equal(changes.at(-1).startSize, 600);
  assert.deepEqual(JSON.parse(storage.getItem('split')), { ratio: 0.75, closedPane: null });

  split.divider.dispatch('keydown', { key: 'ArrowLeft' });
  assert.equal(split.getState().startSize, 560);
  split.divider.dispatch('keydown', { key: 'Home' });
  assert.equal(split.getState().startSize, 120);
  split.divider.dispatch('keydown', { key: 'End' });
  assert.equal(split.getState().startSize, 640);
});

test('split pane can close and reopen a sidebar while preserving prior ratio', () => {
  const documentRef = new FakeDocument();
  const storage = new FakeStorage();
  const changes = [];
  const split = createSplitPane({
    document: documentRef,
    storage,
    storageKey: 'dock',
    initialRatio: 0.55,
    minStart: 120,
    minEnd: 160,
    dividerSize: 8,
    onChange(state) {
      changes.push(state);
    },
  });
  split.root.rect = { left: 0, top: 0, width: 808, height: 500 };
  split.setRatio(0.55, { notify: false, persist: false });

  const closed = split.closePane('end');
  assert.equal(closed.closedPane, 'end');
  assert.equal(closed.startSize, 808);
  assert.equal(closed.endSize, 0);
  assert.equal(split.endPane.hidden, true);
  assert.equal(split.divider.hidden, true);
  assert.equal(split.isPaneOpen('end'), false);
  assert.equal(split.root.dataset.closedPane, 'end');
  assert.deepEqual(JSON.parse(storage.getItem('dock')), { ratio: 0.55, closedPane: 'end' });

  const reopened = split.openPane('end');
  assert.equal(reopened.closedPane, null);
  assert.equal(reopened.startSize, 440);
  assert.equal(reopened.endSize, 360);
  assert.equal(split.endPane.hidden, false);
  assert.equal(split.divider.hidden, false);
  assert.equal(split.isPaneOpen('end'), true);
  assert.equal(split.root.dataset.closedPane, undefined);
  assert.deepEqual(changes.map((state) => state.closedPane), ['end', null]);
});

test('SplitPane layout mounts two content factories into start and end panes', async (t) => {
  const previousNode = globalThis.Node;
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousAtob = globalThis.atob;

  globalThis.Node = FakeNode;
  globalThis.document = new FakeDocument();
  const outbound = [];
  globalThis.window = {
    headsup: {},
    webkit: {
      messageHandlers: {
        headsup: {
          postMessage(message) {
            outbound.push(message);
          },
        },
      },
    },
  };
  globalThis.atob = (value) => Buffer.from(value, 'base64').toString('utf8');

  t.after(() => {
    globalThis.Node = previousNode;
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    globalThis.atob = previousAtob;
  });

  const layout = SplitPane(makeContent('preview'), makeContent('controls'), {
    initialRatio: 0.58,
    minStart: 200,
    minEnd: 200,
  });
  const chrome = {
    contentEl: new FakeElement('div'),
    titleEl: { textContent: 'Split Smoke' },
  };
  const split = layout.mount(chrome);

  assert.equal(chrome.contentEl.children[0], split.root);
  assert.equal(split.startPane.children[0].textContent, 'preview');
  assert.equal(split.endPane.children[0].textContent, 'controls');
  assert.deepEqual(window.headsup.manifest.layout, {
    kind: 'split-pane',
    orientation: 'horizontal',
  });
  assert.deepEqual(window.headsup.manifest.contents, [
    { pane: 'start', name: 'preview', prefix: 'preview' },
    { pane: 'end', name: 'controls', prefix: 'controls' },
  ]);
  assert.equal(outbound.some((message) => message.type === 'ready'), true);
});
