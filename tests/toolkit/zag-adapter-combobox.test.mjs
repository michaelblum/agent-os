import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collection } from '../../packages/toolkit/node_modules/@zag-js/combobox/dist/index.js';
import { createAosZagCombobox } from '../../packages/toolkit/adapters/zag/combobox.js';
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

function createCollection(items = [
  { label: 'Alpha', value: 'a' },
  { label: 'Beta', value: 'b' },
  { label: 'Gamma', value: 'g', disabled: true },
]) {
  return collection({
    items,
    itemToValue: (item) => item.value,
    itemToString: (item) => item.label,
    isItemDisabled: (item) => !!item.disabled,
  });
}

function createComboboxAdapter(extra = {}) {
  const document = createDocument();
  const adapter = createAosZagCombobox({
    id: 'test-combobox',
    collection: createCollection(),
    getRootNode: () => document,
    ...extra,
  });
  return { adapter, document };
}

test('createAosZagCombobox exposes Zag combobox API snapshot', () => {
  const { adapter } = createComboboxAdapter({
    value: ['b'],
    inputValue: 'Beta',
    placeholder: 'Pick one',
  });
  const snapshot = adapter.connect();

  assert.equal(snapshot.open, false);
  assert.deepEqual(snapshot.value, ['b']);
  assert.equal(snapshot.inputValue, 'Beta');
  assert.deepEqual(snapshot.selectedItems.map((item) => item.value), ['b']);
  assert.equal(snapshot.highlightedValue, null);
  assert.equal(typeof snapshot.api, 'object');
  assert.equal(typeof snapshot.getInputProps, 'function');
  assert.equal(typeof snapshot.getTriggerProps, 'function');
  assert.equal(typeof snapshot.getContentProps, 'function');
  assert.equal(typeof snapshot.getItemProps, 'function');
  assert.equal(typeof snapshot.getLabelProps, 'function');

  adapter.destroy();
});

test('update refreshes controlled value, input value, collection, and state change callback', async () => {
  const states = [];
  const { adapter } = createComboboxAdapter({ value: ['a'], inputValue: 'Alpha' });
  const filtered = createCollection([{ label: 'Beta', value: 'b' }]);

  let snapshot = adapter.update({
    value: ['b'],
    inputValue: 'Beta',
    collection: filtered,
  });
  assert.deepEqual(snapshot.value, ['b']);
  assert.equal(snapshot.inputValue, 'Beta');
  assert.equal(snapshot.api.collection.find('b')?.label, 'Beta');

  adapter.update({
    value: undefined,
    inputValue: undefined,
    onStateChange: (nextSnapshot) => states.push(nextSnapshot.inputValue),
  });
  adapter.connect().api.setInputValue('Bet');
  await flushMachine();

  assert.equal(states.at(-1), 'Bet');
  adapter.destroy();
});

test('bind wires root, input, trigger, content, and data-value items', () => {
  const { adapter, document } = createComboboxAdapter({ value: ['a'], inputValue: 'Alpha' });
  const root = patchSpreadSupport(document.createElement('div'));
  const input = patchSpreadSupport(document.createElement('input'));
  const trigger = patchSpreadSupport(document.createElement('button'));
  const content = patchSpreadSupport(document.createElement('div'));
  const alpha = patchSpreadSupport(document.createElement('div'));
  const beta = patchSpreadSupport(document.createElement('div'));

  input.dataset.aosComboboxInput = '';
  trigger.dataset.aosComboboxTrigger = '';
  content.dataset.aosComboboxContent = '';
  alpha.dataset.value = 'a';
  alpha.textContent = 'Alpha';
  beta.dataset.value = 'b';
  beta.textContent = 'Beta';
  root.append(input, trigger, content, alpha, beta);
  document.body.appendChild(root);

  const snapshot = adapter.bind(root);

  assert.equal(snapshot.value[0], 'a');
  assert.equal(root.dataset.scope, 'combobox');
  assert.equal(input.getAttribute('role'), 'combobox');
  assert.equal(trigger.getAttribute('aria-haspopup'), 'listbox');
  assert.equal(content.getAttribute('role'), 'listbox');
  assert.equal(alpha.dataset.aosComboboxItem, '');
  assert.equal(beta.getAttribute('role'), 'option');
  assert.equal(adapter.bindItems(root), 2);

  adapter.destroy();
  assert.equal(alpha.dataset.aosComboboxItem, undefined);
});

test('bind helpers wire individual elements', () => {
  const { adapter, document } = createComboboxAdapter();
  const input = patchSpreadSupport(document.createElement('input'));
  const trigger = patchSpreadSupport(document.createElement('button'));
  const content = patchSpreadSupport(document.createElement('div'));
  const item = patchSpreadSupport(document.createElement('div'));
  item.dataset.value = 'b';

  adapter.bindInput(input);
  adapter.bindTrigger(trigger);
  adapter.bindContent(content);
  adapter.bindItem(item);

  assert.equal(input.getAttribute('role'), 'combobox');
  assert.equal(trigger.getAttribute('type'), 'button');
  assert.equal(content.getAttribute('role'), 'listbox');
  assert.equal(item.dataset.aosComboboxItem, '');

  adapter.destroy();
  assert.equal(item.dataset.aosComboboxItem, undefined);
});

test('open and close control Zag open state', async () => {
  const { adapter, document } = createComboboxAdapter();
  const root = patchSpreadSupport(document.createElement('div'));
  const input = patchSpreadSupport(document.createElement('input'));
  const trigger = patchSpreadSupport(document.createElement('button'));
  const content = patchSpreadSupport(document.createElement('div'));
  input.dataset.aosComboboxInput = '';
  trigger.dataset.aosComboboxTrigger = '';
  content.dataset.aosComboboxContent = '';
  root.append(input, trigger, content);
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
  assert.throws(() => createAosZagCombobox({ collection: createCollection() }), /requires an id/);
  assert.throws(() => createAosZagCombobox({ id: 'missing-collection' }), /requires a collection/);
});
