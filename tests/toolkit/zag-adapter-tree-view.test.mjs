import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  collapseTreeViewPathFragments,
  createAosZagTreeView,
} from '../../packages/toolkit/adapters/zag/tree-view.js';
import { createDocument, patchSpreadSupport } from './zag-adapter-test-utils.mjs';

function createItems() {
  return [
    { id: 'root', label: 'main', depth: 0, hasChildren: true },
    { id: 'frame-a', label: 'Frame A', parentId: 'root', depth: 1, hasChildren: true },
    { id: 'comment-a', label: 'Comment A', parentId: 'frame-a', depth: 2 },
    { id: 'frame-b', label: 'Frame B', parentId: 'root', depth: 1 },
  ];
}

function createBoundTree(extra = {}) {
  const document = createDocument();
  const renderAllItems = extra.renderAllItems === true;
  delete extra.renderAllItems;
  const adapter = createAosZagTreeView({
    id: 'test-tree',
    getRootNode: () => document,
    items: createItems(),
    defaultExpandedIds: ['root'],
    ...extra,
  });
  const container = patchSpreadSupport(document.createElement('div'));
  container.dataset.aosTreeViewRoot = '';
  const renderedItems = renderAllItems ? createItems() : adapter.connect().visibleItems;
  for (const item of renderedItems) {
    const row = patchSpreadSupport(document.createElement('div'));
    row.dataset.aosTreeViewItem = '';
    row.dataset.itemId = item.id;
    if (item.id === 'frame-a') {
      const button = patchSpreadSupport(document.createElement('button'));
      button.classList.add('annotation-pin-reveal');
      row.appendChild(button);
    }
    container.appendChild(row);
  }
  document.body.appendChild(container);
  adapter.bind(container);
  return { adapter, container, document };
}

function treeItem(container, id) {
  return Array.from(container.querySelectorAll('[data-aos-tree-view-item]'))
    .find((element) => element.dataset.itemId === id);
}

function keydown(document, element, key) {
  element.dispatchEvent(new document.defaultView.Event('keydown', { key }));
}

test('tree view adapter remains browser-safe for aos:// hosted components', async () => {
  const source = await readFile(new URL('../../packages/toolkit/adapters/zag/tree-view.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from ['"]@zag-js\//);
});

test('toolkit package metadata includes the tree-view Zag dependency', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../../packages/toolkit/package.json', import.meta.url), 'utf8'));
  const packageLock = JSON.parse(await readFile(new URL('../../packages/toolkit/package-lock.json', import.meta.url), 'utf8'));
  const packageName = ['@zag-js', 'tree-view'].join('/');

  assert.equal(packageJson.dependencies?.[packageName], '^1.40.0');
  assert.equal(packageLock.packages?.['']?.dependencies?.[packageName], '^1.40.0');
  assert.ok(packageLock.packages?.[`node_modules/${packageName}`]);
});

test('mount and cleanup lifecycle binds and removes tree item listeners', () => {
  const { adapter, container } = createBoundTree();
  const first = treeItem(container, 'root');

  assert.equal(first.getAttribute('role'), 'treeitem');
  assert.equal(first.getAttribute('tabindex'), '0');

  adapter.cleanupBindings();

  assert.equal(first.getAttribute('role'), null);
  assert.equal(first.getAttribute('tabindex'), null);
  adapter.destroy();
});

test('collapse preserves nested action controls and restores reachability on expand', () => {
  const { adapter, container } = createBoundTree({
    defaultExpandedIds: ['root'],
    renderAllItems: true,
  });
  const frameA = treeItem(container, 'frame-a');
  const reveal = frameA.querySelector('.annotation-pin-reveal');

  assert.ok(reveal);
  assert.equal(frameA.getAttribute('hidden'), null);

  adapter.collapse('root');
  assert.equal(frameA.getAttribute('hidden'), '');
  assert.ok(frameA.querySelector('.annotation-pin-reveal'));

  adapter.expand('root');
  assert.equal(frameA.getAttribute('hidden'), null);
  assert.ok(frameA.querySelector('.annotation-pin-reveal'));
  adapter.destroy();
});

test('expand and collapse state round-trips through the adapter snapshot', () => {
  const { adapter } = createBoundTree();

  adapter.expand('frame-a');
  assert.deepEqual(adapter.connect().expandedIds.sort(), ['frame-a', 'root']);

  adapter.collapse('root');
  assert.deepEqual(adapter.connect().expandedIds, ['frame-a']);
  adapter.destroy();
});

test('collapse and expand update descendant DOM visibility', () => {
  const { adapter, container } = createBoundTree({
    defaultExpandedIds: ['root', 'frame-a'],
    renderAllItems: true,
  });
  const frameA = treeItem(container, 'frame-a');
  const commentA = treeItem(container, 'comment-a');

  assert.equal(frameA.getAttribute('aria-expanded'), 'true');
  assert.equal(commentA.getAttribute('hidden'), null);
  assert.equal(commentA.getAttribute('aria-hidden'), null);

  adapter.collapse('frame-a');

  assert.equal(frameA.getAttribute('aria-expanded'), 'false');
  assert.equal(commentA.getAttribute('hidden'), '');
  assert.equal(commentA.getAttribute('aria-hidden'), 'true');
  assert.equal(adapter.connect().visibleItems.some((item) => item.id === 'comment-a'), false);

  adapter.expand('frame-a');

  assert.equal(frameA.getAttribute('aria-expanded'), 'true');
  assert.equal(commentA.getAttribute('hidden'), null);
  assert.equal(commentA.getAttribute('aria-hidden'), null);
  adapter.destroy();
});

test('update preserves supplied expansion state instead of resetting descendants visible', () => {
  const { adapter, container } = createBoundTree({
    defaultExpandedIds: ['root', 'frame-a'],
    renderAllItems: true,
  });
  const commentA = treeItem(container, 'comment-a');

  adapter.collapse('frame-a');
  assert.equal(commentA.getAttribute('hidden'), '');

  adapter.update({ items: createItems(), expandedIds: ['root'] });

  assert.deepEqual(adapter.connect().expandedIds, ['root']);
  assert.equal(commentA.getAttribute('hidden'), '');
  adapter.destroy();
});

test('path-fragment collapsing compacts consecutive branch-only nodes', () => {
  const rows = collapseTreeViewPathFragments([
    { id: 'root', label: 'main', depth: 0, hasChildren: true },
    { id: 'a', label: 'section', parentId: 'root', depth: 1, hasChildren: true },
    { id: 'b', label: 'panel', parentId: 'a', depth: 2, hasChildren: true },
    { id: 'c', label: 'button', parentId: 'b', depth: 3, data: { hasContent: true } },
  ]);

  assert.equal(rows[0].label, 'main / section / panel');
  assert.deepEqual(rows[0].collapsedIds, ['root', 'a', 'b']);
  assert.equal(rows[1].label, 'button');
  assert.equal(rows[1].parentId, 'b');
});

test('keyboard navigation moves focus, expands, collapses, and selects', () => {
  const { adapter, container, document } = createBoundTree();
  const root = treeItem(container, 'root');
  const frameA = treeItem(container, 'frame-a');

  keydown(document, root, 'ArrowDown');
  assert.equal(adapter.connect().focusedId, 'frame-a');

  keydown(document, frameA, 'ArrowRight');
  assert.ok(adapter.connect().expandedIds.includes('frame-a'));

  keydown(document, frameA, ' ');
  assert.equal(adapter.connect().selectedId, 'frame-a');

  keydown(document, frameA, 'ArrowLeft');
  assert.equal(adapter.connect().expandedIds.includes('frame-a'), false);
  adapter.destroy();
});

test('rendered tree items expose required ARIA attributes', () => {
  const { adapter, container } = createBoundTree();
  const root = treeItem(container, 'root');
  const frameA = treeItem(container, 'frame-a');

  assert.equal(container.getAttribute('role'), 'tree');
  assert.equal(root.getAttribute('role'), 'treeitem');
  assert.equal(root.getAttribute('aria-expanded'), 'true');
  assert.equal(root.getAttribute('aria-selected'), 'false');
  assert.equal(root.getAttribute('aria-level'), '1');
  assert.equal(root.getAttribute('aria-setsize'), '1');
  assert.equal(root.getAttribute('aria-posinset'), '1');
  assert.equal(frameA.getAttribute('aria-level'), '2');
  adapter.destroy();
});

test('constructor validates required id', () => {
  assert.throws(() => createAosZagTreeView({}), /requires an id/);
});
