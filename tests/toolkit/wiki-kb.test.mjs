import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyGraphUpdate,
  buildAdjacency,
  normalizeGraphPayload,
  pickPrimaryNodeId,
  renderMarkdown,
  safeExternalHref,
} from '../../packages/toolkit/components/wiki-kb/views/shared.js';

test('normalizeGraphPayload dedupes nodes and drops invalid links', () => {
  const graph = normalizeGraphPayload({
    nodes: [
      { id: 'alpha', name: 'Alpha', type: 'entity', tags: ['one', 'one'], markdown: '# Alpha' },
      { id: 'alpha', name: 'Duplicate' },
      { id: 'beta', title: 'Beta', type: 'concept' },
    ],
    links: [
      { source: 'alpha', target: 'beta' },
      { source: 'beta', target: 'alpha' },
      { source: 'alpha', target: 'missing' },
    ],
  });

  assert.deepEqual(graph.nodes, [
    { id: 'alpha', name: 'Alpha', type: 'entity', description: '', tags: ['one'] },
    { id: 'beta', name: 'Beta', type: 'concept', description: '', tags: [] },
  ]);
  assert.deepEqual(graph.links, [
    { source: 'alpha', target: 'beta' },
  ]);
  assert.deepEqual(graph.raw, {
    alpha: '# Alpha',
  });
});

test('applyGraphUpdate supports upserts and removals', () => {
  const base = normalizeGraphPayload({
    nodes: [
      { id: 'alpha', name: 'Alpha', type: 'entity' },
      { id: 'beta', name: 'Beta', type: 'concept' },
    ],
    links: [{ source: 'alpha', target: 'beta' }],
    raw: { alpha: 'alpha raw' },
  });

  const updated = applyGraphUpdate(base, {
    nodes: [{ id: 'gamma', name: 'Gamma', type: 'plugin', raw: 'gamma raw' }],
    links: [{ source: 'beta', target: 'gamma' }],
    removeNodes: ['alpha'],
  });

  assert.deepEqual(updated.nodes, [
    { id: 'beta', name: 'Beta', type: 'concept', description: '', tags: [] },
    { id: 'gamma', name: 'Gamma', type: 'plugin', description: '', tags: [] },
  ]);
  assert.deepEqual(updated.links, [
    { source: 'beta', target: 'gamma' },
  ]);
  assert.deepEqual(updated.raw, {
    gamma: 'gamma raw',
  });
});

test('renderMarkdown escapes HTML and strips unsafe links', () => {
  const html = renderMarkdown('Hello <script>alert(1)</script>\n[good](https://example.com)\n[bad](javascript:alert(1))')
  assert.match(html, /Hello &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /href="https:\/\/example\.com"/);
  assert.doesNotMatch(html, /javascript:/);
  assert.match(html, />bad</);
});

test('safeExternalHref allows explicit safe protocols only', () => {
  assert.equal(safeExternalHref('https://example.com/test'), 'https://example.com/test');
  assert.equal(safeExternalHref('aos://toolkit/components/wiki-kb/index.html'), 'aos://toolkit/components/wiki-kb/index.html');
  assert.equal(safeExternalHref('/wiki/aos/page.md'), '/wiki/aos/page.md');
  assert.equal(safeExternalHref('javascript:alert(1)'), '');
});

test('mindmap helpers prefer the highest-degree node as the root', () => {
  const nodes = normalizeGraphPayload({
    nodes: [
      { id: 'alpha', name: 'Alpha', type: 'entity' },
      { id: 'beta', name: 'Beta', type: 'concept' },
      { id: 'gamma', name: 'Gamma', type: 'plugin' },
    ],
    links: [
      { source: 'alpha', target: 'beta' },
      { source: 'beta', target: 'gamma' },
    ],
  }).nodes;
  const adjacency = buildAdjacency(nodes, [
    { source: 'alpha', target: 'beta' },
    { source: 'beta', target: 'gamma' },
  ]);

  assert.equal(pickPrimaryNodeId(nodes, adjacency), 'beta');
});
