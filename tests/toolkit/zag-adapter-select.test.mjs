import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collection } from '../../packages/toolkit/node_modules/@zag-js/select/dist/index.js';
import { createAosZagSelect } from '../../packages/toolkit/adapters/zag/select.js';
import { FakeElement, createFakeDocument } from './dom-fixture.mjs';

globalThis.requestAnimationFrame ??= (callback) => {
  callback();
  return 0;
};
globalThis.cancelAnimationFrame ??= () => {};

async function flushMachine() {
  await Promise.resolve();
  await Promise.resolve();
}

function patchSpreadSupport(element) {
  element.getRootNode ??= function getRootNode() {
    return this.ownerDocument;
  };
  element.scrollTo ??= () => {};
  element.style.setProperty ??= function setProperty(name, value) {
    this[name] = value;
  };
  element.style.removeProperty ??= function removeProperty(name) {
    delete this[name];
  };
  element.removeAttribute ??= function removeAttribute(name) {
    this.attributes.delete(name);
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      delete this.dataset[key];
    }
  };
  element.toggleAttribute ??= function toggleAttribute(name, enabled) {
    if (enabled) this.setAttribute(name, '');
    else this.removeAttribute(name);
  };
  for (const child of element.children || []) patchSpreadSupport(child);
  return element;
}

function createDocument() {
  const document = createFakeDocument();
  document.defaultView.requestAnimationFrame = globalThis.requestAnimationFrame;
  document.defaultView.cancelAnimationFrame = globalThis.cancelAnimationFrame;
  document.defaultView.document = document;
  document.defaultView.HTMLElement = FakeElement;
  document.defaultView.Element = FakeElement;
  document.defaultView.Node = FakeElement;
  document.defaultView.HTMLInputElement = FakeElement;
  document.defaultView.HTMLTextAreaElement = FakeElement;
  document.defaultView.KeyboardEvent = class KeyboardEvent {};
  document.defaultView.MutationObserver = class MutationObserver {
    observe() {}
    disconnect() {}
  };
  document.defaultView.addEventListener ??= document.addEventListener;
  document.defaultView.removeEventListener ??= document.removeEventListener;
  const findById = (node, id) => {
    if (node.id === id) return node;
    for (const child of node.children || []) {
      const match = findById(child, id);
      if (match) return match;
    }
    return null;
  };
  document.getElementById = (id) => {
    if (document.body.id === id) return document.body;
    return findById(document.body, id);
  };
  patchSpreadSupport(document.body);
  globalThis.document = document;
  globalThis.window = document.defaultView;
  return document;
}

function createCollection() {
  return collection({
    items: [
      { label: 'Alpha', value: 'a' },
      { label: 'Beta', value: 'b' },
      { label: 'Gamma', value: 'g', disabled: true },
    ],
    itemToValue: (item) => item.value,
    itemToString: (item) => item.label,
    isItemDisabled: (item) => !!item.disabled,
  });
}

function createSelectAdapter(extra = {}) {
  const document = createDocument();
  const adapter = createAosZagSelect({
    id: 'test-select',
    collection: createCollection(),
    getRootNode: () => document,
    ...extra,
  });
  return { adapter, document };
}

test('createAosZagSelect exposes Zag select API snapshot', () => {
  const { adapter } = createSelectAdapter({ value: ['b'], placeholder: 'Pick one' });
  const snapshot = adapter.connect();

  assert.equal(snapshot.open, false);
  assert.deepEqual(snapshot.value, ['b']);
  assert.deepEqual(snapshot.selectedItems.map((item) => item.value), ['b']);
  assert.equal(typeof snapshot.api, 'object');
  assert.equal(typeof snapshot.getTriggerProps, 'function');
  assert.equal(typeof snapshot.getContentProps, 'function');
  assert.equal(typeof snapshot.getItemProps, 'function');
  assert.equal(typeof snapshot.getLabelProps, 'function');

  adapter.destroy();
});

test('update refreshes controlled value and state change callback', async () => {
  const states = [];
  const { adapter } = createSelectAdapter({ value: ['a'] });

  assert.deepEqual(adapter.update({ value: ['b'] }).value, ['b']);
  adapter.update({ value: undefined, onStateChange: (snapshot) => states.push(snapshot.value) });
  adapter.connect().api.setValue(['a']);
  await flushMachine();

  assert.deepEqual(states.at(-1), ['a']);
  adapter.destroy();
});

test('bind wires trigger, content, and data-value items', () => {
  const { adapter, document } = createSelectAdapter({ value: ['a'] });
  const root = patchSpreadSupport(document.createElement('div'));
  const trigger = patchSpreadSupport(document.createElement('button'));
  const content = patchSpreadSupport(document.createElement('div'));
  const alpha = patchSpreadSupport(document.createElement('div'));
  const beta = patchSpreadSupport(document.createElement('div'));

  trigger.dataset.aosSelectTrigger = '';
  content.dataset.aosSelectContent = '';
  alpha.dataset.value = 'a';
  alpha.textContent = 'Alpha';
  beta.dataset.value = 'b';
  beta.textContent = 'Beta';
  root.append(trigger, content, alpha, beta);
  document.body.appendChild(root);

  const snapshot = adapter.bind(root);

  assert.equal(snapshot.value[0], 'a');
  assert.equal(trigger.getAttribute('role'), 'combobox');
  assert.equal(content.getAttribute('role'), 'listbox');
  assert.equal(alpha.dataset.aosSelectItem, '');
  assert.equal(beta.getAttribute('role'), 'option');
  assert.equal(adapter.bindItems(root), 2);

  adapter.destroy();
  assert.equal(alpha.dataset.aosSelectItem, undefined);
});

test('open and close control Zag open state', async () => {
  const { adapter, document } = createSelectAdapter();
  const root = patchSpreadSupport(document.createElement('div'));
  const trigger = patchSpreadSupport(document.createElement('button'));
  const content = patchSpreadSupport(document.createElement('div'));
  trigger.dataset.aosSelectTrigger = '';
  content.dataset.aosSelectContent = '';
  root.append(trigger, content);
  document.body.appendChild(root);
  adapter.bind(root);

  adapter.open();
  await flushMachine();
  assert.equal(adapter.connect().open, true);

  adapter.close();
  await flushMachine();
  assert.equal(adapter.connect().open, false);

  adapter.destroy();
});

test('constructor validates required id and collection', () => {
  assert.throws(() => createAosZagSelect({ collection: createCollection() }), /requires an id/);
  assert.throws(() => createAosZagSelect({ id: 'missing-collection' }), /requires a collection/);
});
