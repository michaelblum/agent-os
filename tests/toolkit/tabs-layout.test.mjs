import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Tabs } from '../../packages/toolkit/panel/layouts/tabs.js';

function encodeMessage(message) {
  return Buffer.from(JSON.stringify(message), 'utf8').toString('base64');
}

class FakeNode {}

class FakeClassList {
  constructor(owner) {
    this.owner = owner;
    this.names = new Set();
  }

  setFromString(value) {
    this.names = new Set(String(value || '').split(/\s+/).filter(Boolean));
  }

  toggle(name, force) {
    if (force === undefined) {
      if (this.names.has(name)) this.names.delete(name);
      else this.names.add(name);
      return this.names.has(name);
    }
    if (force) this.names.add(name);
    else this.names.delete(name);
    return force;
  }

  contains(name) {
    return this.names.has(name);
  }
}

class FakeElement extends FakeNode {
  constructor(tagName = 'div') {
    super();
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.listeners = new Map();
    this.dataset = {};
    this.attributes = {};
    this.hidden = false;
    this.textContent = '';
    this.innerHTML = '';
    this.classList = new FakeClassList(this);
    this._className = '';
  }

  get className() {
    return this._className;
  }

  set className(value) {
    this._className = String(value);
    this.classList.setFromString(this._className);
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) ?? [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  dispatch(type, overrides = {}) {
    const event = { target: this, ...overrides };
    for (const handler of this.listeners.get(type) ?? []) {
      handler(event);
    }
    return event;
  }
}

class FakeDocument {
  createElement(tagName) {
    return new FakeElement(tagName);
  }
}

function makeContent(title) {
  return () => ({
    manifest: {
      name: title.toLowerCase(),
      title,
    },
    render() {
      return new FakeElement('section');
    },
  });
}

test('Tabs onActivate fires for initial mount and active-tab changes only', async (t) => {
  const previousNode = globalThis.Node;
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousAtob = globalThis.atob;

  globalThis.Node = FakeNode;
  globalThis.document = new FakeDocument();
  const outbound = [];
  globalThis.window = {
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

  const activations = [];
  const layout = Tabs([
    makeContent('Alpha'),
    makeContent('Beta'),
    makeContent('Gamma'),
  ], {
    onActivate(info) {
      activations.push({
        index: info.index,
        title: info.title,
        name: info.manifest?.name ?? null,
      });
    },
  });

  const chrome = {
    controlsEl: new FakeElement('div'),
    contentEl: new FakeElement('div'),
    titleEl: { textContent: 'tabs smoke' },
  };

  layout.mount(chrome);

  assert.deepEqual(activations, [
    { index: 0, title: 'Alpha', name: 'alpha' },
  ]);

  const tabStrip = chrome.controlsEl.children[0];
  const [alphaBtn, betaBtn, gammaBtn] = tabStrip.children;
  const [alphaPanel, betaPanel, gammaPanel] = chrome.contentEl.children;

  assert.equal(alphaBtn.classList.contains('active'), true);
  assert.equal(betaBtn.classList.contains('active'), false);
  assert.equal(alphaPanel.hidden, false);
  assert.equal(betaPanel.hidden, true);
  assert.equal(gammaPanel.hidden, true);

  betaBtn.dispatch('click');

  assert.deepEqual(activations, [
    { index: 0, title: 'Alpha', name: 'alpha' },
    { index: 1, title: 'Beta', name: 'beta' },
  ]);
  assert.equal(alphaBtn.classList.contains('active'), false);
  assert.equal(betaBtn.classList.contains('active'), true);
  assert.equal(alphaPanel.hidden, true);
  assert.equal(betaPanel.hidden, false);

  betaBtn.dispatch('click');
  gammaBtn.dispatch('click');

  assert.deepEqual(activations, [
    { index: 0, title: 'Alpha', name: 'alpha' },
    { index: 1, title: 'Beta', name: 'beta' },
    { index: 2, title: 'Gamma', name: 'gamma' },
  ]);
  assert.equal(gammaBtn.classList.contains('active'), true);
  assert.equal(betaPanel.hidden, true);
  assert.equal(gammaPanel.hidden, false);

  window.headsup.receive(encodeMessage({
    type: 'tabs/activate',
    payload: { name: 'beta' },
  }));

  assert.deepEqual(activations, [
    { index: 0, title: 'Alpha', name: 'alpha' },
    { index: 1, title: 'Beta', name: 'beta' },
    { index: 2, title: 'Gamma', name: 'gamma' },
    { index: 1, title: 'Beta', name: 'beta' },
  ]);
  assert.equal(betaBtn.classList.contains('active'), true);
  assert.equal(gammaBtn.classList.contains('active'), false);
  assert.equal(betaPanel.hidden, false);
  assert.equal(gammaPanel.hidden, true);

  const tabEvents = outbound.filter((message) => message.type === 'tabs/activated');
  assert.deepEqual(tabEvents.map((message) => message.payload), [
    { index: 0, title: 'Alpha', name: 'alpha' },
    { index: 1, title: 'Beta', name: 'beta' },
    { index: 2, title: 'Gamma', name: 'gamma' },
    { index: 1, title: 'Beta', name: 'beta' },
  ]);
  assert.equal(outbound.some((message) => message.type === 'ready'), true);
});
