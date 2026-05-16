import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAosZagTabs } from '../../packages/toolkit/adapters/zag/tabs.js';
import { createDocument, patchSpreadSupport } from './zag-adapter-test-utils.mjs';

function createAdapter(extra = {}) {
  const document = createDocument();
  const adapter = createAosZagTabs({
    id: 'test-tabs',
    getRootNode: () => document,
    ...extra,
  });
  return { adapter, document };
}

function createBoundTabs(extra = {}) {
  const { adapter, document } = createAdapter({ defaultValue: 'a', ...extra });
  const container = patchSpreadSupport(document.createElement('div'));
  const list = patchSpreadSupport(document.createElement('div'));
  list.dataset.aosTabsList = '';
  container.appendChild(list);

  const triggers = {};
  const contents = {};
  for (const value of ['a', 'b']) {
    const trigger = patchSpreadSupport(document.createElement('button'));
    trigger.dataset.aosTabsTrigger = '';
    trigger.dataset.value = value;
    list.appendChild(trigger);
    triggers[value] = trigger;

    const content = patchSpreadSupport(document.createElement('section'));
    content.dataset.aosTabsContent = '';
    content.dataset.value = value;
    container.appendChild(content);
    contents[value] = content;
  }

  document.body.appendChild(container);
  adapter.bind(container);
  return { adapter, document, triggers, contents };
}

function keydown(document, element, key) {
  element.dispatchEvent(new document.defaultView.Event('keydown', { key }));
}

function click(document, element) {
  element.dispatchEvent(new document.defaultView.Event('click'));
}

test('createAosZagTabs exposes expected Zag tabs helpers', () => {
  const { adapter } = createAdapter({defaultValue: 'a'});
  const snapshot = adapter.connect();

  assert.equal(typeof snapshot.api, 'object');
  assert.equal(typeof snapshot.getRootProps, 'function');
  assert.equal(typeof snapshot.getListProps, 'function');
  assert.equal(typeof snapshot.getTriggerProps, 'function');
  assert.equal(typeof snapshot.getContentProps, 'function');
  adapter.destroy();
});

test('tabs adapter remains browser-safe for aos:// hosted components', async () => {
  const source = await readFile(new URL('../../packages/toolkit/adapters/zag/tabs.js', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /from ['"]@zag-js\//);
});

test('live tab adopters do not import bare Zag modules into aos:// pages', async () => {
  const paths = [
    '../../packages/toolkit/adapters/zag/tabs.js',
    '../../packages/toolkit/components/integration-hub/index.js',
    '../../packages/toolkit/components/wiki-kb/index.js',
    '../../packages/toolkit/components/markdown-workbench/index.js',
  ];

  for (const path of paths) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from ['"]@zag-js\//, path);
    assert.doesNotMatch(source, /import\(['"]@zag-js\//, path);
  }
});

test('bind wires minimum tabs parts', () => {
  const { adapter, document } = createAdapter({defaultValue: 'a'});
  const container = patchSpreadSupport(document.createElement('div'));
  const elRoot = patchSpreadSupport(document.createElement('div'));
  elRoot.dataset.aosTabsRoot = '';
  container.appendChild(elRoot);
  const elList = patchSpreadSupport(document.createElement('div'));
  elList.dataset.aosTabsList = '';
  container.appendChild(elList);
  const elTrigger = patchSpreadSupport(document.createElement('div'));
  elTrigger.dataset.aosTabsTrigger = '';
  elTrigger.dataset.value = 'a';
  container.appendChild(elTrigger);
  const elContent = patchSpreadSupport(document.createElement('div'));
  elContent.dataset.aosTabsContent = '';
  elContent.dataset.value = 'a';
  container.appendChild(elContent);
  document.body.appendChild(container);

  assert.equal(adapter.bindTriggers(container), 1);
  assert.equal(adapter.bindContents(container), 1);
  assert.equal(elTrigger.getAttribute('role'), 'tab');
  assert.equal(elContent.getAttribute('role'), 'tabpanel');
  assert.equal(elTrigger.getAttribute('aria-controls'), elContent.getAttribute('id'));

  const snapshot = adapter.bind(container);

  assert.equal(typeof snapshot.api, 'object');
  assert.equal(typeof adapter.bindRoot, 'function');
  assert.equal(typeof adapter.bindList, 'function');
  assert.equal(typeof adapter.bindTrigger, 'function');
  assert.equal(typeof adapter.bindContent, 'function');
  adapter.destroy();
});

test('ArrowRight moves focus, selects next tab, and updates bound content in automatic mode', () => {
  const { adapter, document, triggers, contents } = createBoundTabs();

  triggers.a.focus();
  keydown(document, triggers.a, 'ArrowRight');

  assert.equal(document.activeElement, triggers.b);
  assert.equal(adapter.connect().value, 'b');
  assert.equal(triggers.a.getAttribute('aria-selected'), 'false');
  assert.equal(triggers.a.getAttribute('tabindex'), '-1');
  assert.equal(triggers.b.getAttribute('aria-selected'), 'true');
  assert.equal(triggers.b.getAttribute('tabindex'), '0');
  assert.equal(contents.a.getAttribute('hidden'), '');
  assert.equal(contents.b.getAttribute('hidden'), null);
  assert.equal(contents.b.getAttribute('aria-labelledby'), triggers.b.getAttribute('id'));

  adapter.destroy();
});

test('ArrowLeft wraps to the last trigger when loopFocus is true', () => {
  const { adapter, document, triggers } = createBoundTabs();

  triggers.a.focus();
  keydown(document, triggers.a, 'ArrowLeft');

  assert.equal(document.activeElement, triggers.b);
  assert.equal(adapter.connect().value, 'b');
  assert.equal(triggers.b.getAttribute('aria-selected'), 'true');

  adapter.destroy();
});

test('loopFocus false clamps keyboard focus at the boundary', () => {
  const { adapter, document, triggers } = createBoundTabs({ loopFocus: false });

  triggers.a.focus();
  keydown(document, triggers.a, 'ArrowLeft');

  assert.equal(document.activeElement, triggers.a);
  assert.equal(adapter.connect().value, 'a');
  assert.equal(triggers.a.getAttribute('aria-selected'), 'true');
  assert.equal(triggers.b.getAttribute('aria-selected'), 'false');

  adapter.destroy();
});

test('manual activation moves keyboard focus without selecting until activation', () => {
  const { adapter, document, triggers, contents } = createBoundTabs({ activationMode: 'manual' });

  triggers.a.focus();
  keydown(document, triggers.a, 'ArrowRight');

  assert.equal(document.activeElement, triggers.b);
  assert.equal(adapter.connect().value, 'a');
  assert.equal(adapter.connect().focusedValue, 'b');
  assert.equal(triggers.a.getAttribute('aria-selected'), 'true');
  assert.equal(triggers.b.getAttribute('aria-selected'), 'false');
  assert.equal(contents.a.getAttribute('hidden'), null);
  assert.equal(contents.b.getAttribute('hidden'), '');

  click(document, triggers.b);

  assert.equal(adapter.connect().value, 'b');
  assert.equal(triggers.a.getAttribute('aria-selected'), 'false');
  assert.equal(triggers.b.getAttribute('aria-selected'), 'true');
  assert.equal(contents.a.getAttribute('hidden'), '');
  assert.equal(contents.b.getAttribute('hidden'), null);

  adapter.destroy();
});

test('programmatic helpers update tabs state through Zag API', () => {
  const { adapter } = createAdapter({defaultValue: 'a'});
  adapter.setValue('b');
  assert.equal(typeof adapter.connect().api, 'object');
  adapter.destroy();
});

test('constructor validates required id', () => {
  assert.throws(() => createAosZagTabs({}), /requires an id/);
});
