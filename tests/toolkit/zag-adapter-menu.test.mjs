import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAosZagMenu } from '../../packages/toolkit/adapters/zag/menu.js';
import { createDocument, flushMachine, patchSpreadSupport } from './zag-adapter-test-utils.mjs';

function createMenuAdapter(extra = {}) {
  const document = createDocument();
  const adapter = createAosZagMenu({
    id: 'test-menu',
    getRootNode: () => document,
    ...extra,
  });
  return { adapter, document };
}

function appendMenuItem(document, root, attrs, text = 'Item') {
  const item = patchSpreadSupport(document.createElement('button'));
  for (const [name, value] of Object.entries(attrs)) item.setAttribute(name, value);
  item.textContent = text;
  root.appendChild(item);
  return item;
}

test('generic menu defaults bind neutral data-value and data-aos-menu-item entries', () => {
  const { adapter, document } = createMenuAdapter();
  const root = patchSpreadSupport(document.createElement('div'));
  const alpha = appendMenuItem(document, root, { 'data-value': 'alpha' }, 'Alpha');
  const beta = appendMenuItem(document, root, { 'data-aos-menu-item': '', 'aria-label': 'Beta label' }, 'Beta');
  const sigil = appendMenuItem(document, root, { 'data-sigil-action': 'toggle-log' }, 'Sigil');
  document.body.appendChild(root);

  assert.equal(adapter.bind(root).open, false);

  assert.equal(alpha.dataset.aosZagMenuItem, '');
  assert.equal(beta.dataset.aosZagMenuItem, '');
  assert.equal(sigil.dataset.aosZagMenuItem, undefined);
  assert.equal(alpha.getAttribute('role'), 'menuitem');
  assert.equal(beta.getAttribute('role'), 'menuitem');

  adapter.destroy();
});

test('consumer supplied selector and value mapping bind product-owned attributes', () => {
  const { adapter, document } = createMenuAdapter({
    itemSelector: '[data-sigil-action]',
    getItemValue(element, index = 0) {
      return element?.dataset?.sigilAction || `fallback-${index}`;
    },
  });
  const root = patchSpreadSupport(document.createElement('div'));
  const action = appendMenuItem(document, root, { 'data-sigil-action': 'toggle-log' }, 'Toggle Log');
  document.body.appendChild(root);

  assert.equal(adapter.bindItems(root), 1);

  assert.equal(action.dataset.aosZagMenuItem, '');
  assert.match(action.id, /toggle-log/);

  adapter.destroy();
});

test('binding cleanup clears item markers on destroy and rebind', () => {
  const { adapter, document } = createMenuAdapter();
  const firstRoot = patchSpreadSupport(document.createElement('div'));
  const secondRoot = patchSpreadSupport(document.createElement('div'));
  const first = appendMenuItem(document, firstRoot, { 'data-value': 'first' }, 'First');
  const second = appendMenuItem(document, secondRoot, { 'data-value': 'second' }, 'Second');
  document.body.append(firstRoot, secondRoot);

  adapter.bind(firstRoot);
  assert.equal(first.dataset.aosZagMenuItem, '');

  adapter.bind(secondRoot);
  assert.equal(first.dataset.aosZagMenuItem, undefined);
  assert.equal(second.dataset.aosZagMenuItem, '');

  adapter.destroy();
  assert.equal(second.dataset.aosZagMenuItem, undefined);
});

test('open and close report menu state through connect and onStateChange', async () => {
  const states = [];
  const { adapter, document } = createMenuAdapter({
    onStateChange(snapshot) {
      states.push(snapshot.open);
    },
  });
  const root = patchSpreadSupport(document.createElement('div'));
  appendMenuItem(document, root, { 'data-value': 'alpha' }, 'Alpha');
  document.body.appendChild(root);
  adapter.bind(root);

  adapter.open();
  await flushMachine();
  assert.equal(adapter.connect().open, true);
  assert.equal(states.at(-1), true);

  adapter.close();
  await flushMachine();
  assert.equal(adapter.connect().open, false);
  assert.equal(states.at(-1), false);

  adapter.destroy();
});
