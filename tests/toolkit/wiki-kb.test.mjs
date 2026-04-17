import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyGraphUpdate,
  buildAdjacency,
  deriveGraphViewData,
  findShortestPath,
  normalizeGraphViewConfig,
  normalizeGraphPayload,
  pickPrimaryNodeId,
  renderMarkdown,
  safeExternalHref,
} from '../../packages/toolkit/components/wiki-kb/views/shared.js';

test('normalizeGraphPayload dedupes nodes and drops invalid links', () => {
  const graph = normalizeGraphPayload({
    nodes: [
      {
        id: 'alpha',
        path: 'aos/entities/alpha.md',
        name: 'Alpha',
        type: 'entity',
        tags: ['one', 'one'],
        plugin: 'demo-plugin',
        markdown: '# Alpha',
      },
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
    {
      id: 'alpha',
      path: 'aos/entities/alpha.md',
      name: 'Alpha',
      type: 'entity',
      description: '',
      tags: ['one'],
      plugin: 'demo-plugin',
    },
    {
      id: 'beta',
      path: 'beta',
      name: 'Beta',
      type: 'concept',
      description: '',
      tags: [],
      plugin: '',
    },
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
    { id: 'beta', path: 'beta', name: 'Beta', type: 'concept', description: '', tags: [], plugin: '' },
    { id: 'gamma', path: 'gamma', name: 'Gamma', type: 'plugin', description: '', tags: [], plugin: '' },
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

test('normalizeGraphPayload includes configurable graph defaults', () => {
  const graph = normalizeGraphPayload({
    nodes: [{ id: 'alpha', name: 'Alpha', type: 'entity' }],
    config: {
      graphView: {
        controls: { collapsed: true },
        defaults: {
          mode: 'local',
          depth: 3,
          labelMode: 'selection',
          highlightNeighbors: false,
          activeTypes: ['entity'],
          frozen: true,
        },
        limits: { maxDepth: 6 },
      },
    },
  });

  assert.equal(graph.config.graphView.controls.collapsed, true);
  assert.equal(graph.config.graphView.defaults.mode, 'local');
  assert.equal(graph.config.graphView.defaults.depth, 3);
  assert.equal(graph.config.graphView.defaults.labelMode, 'selection');
  assert.equal(graph.config.graphView.defaults.highlightNeighbors, false);
  assert.deepEqual(graph.config.graphView.defaults.activeTypes, ['entity']);
  assert.equal(graph.config.graphView.defaults.frozen, true);
  assert.equal(graph.config.graphView.limits.maxDepth, 6);
});

test('applyGraphUpdate merges graph config updates', () => {
  const base = normalizeGraphPayload({
    nodes: [{ id: 'alpha', name: 'Alpha', type: 'entity' }],
  });

  const updated = applyGraphUpdate(base, {
    config: {
      graphView: {
        features: { tags: false },
        defaults: { mode: 'local', depth: 4 },
      },
    },
  });

  assert.equal(updated.config.graphView.features.tags, false);
  assert.equal(updated.config.graphView.defaults.mode, 'local');
  assert.equal(updated.config.graphView.defaults.depth, 4);
  assert.equal(updated.config.graphView.features.search, true);
});

test('deriveGraphViewData supports local depth, tag filters, and isolated-node hiding', () => {
  const graph = normalizeGraphPayload({
    nodes: [
      { id: 'alpha', name: 'Alpha', type: 'entity', tags: ['core'] },
      { id: 'beta', name: 'Beta', type: 'concept', tags: ['core', 'docs'] },
      { id: 'gamma', name: 'Gamma', type: 'plugin', tags: ['docs'] },
      { id: 'delta', name: 'Delta', type: 'concept', tags: ['extra'] },
    ],
    links: [
      { source: 'alpha', target: 'beta' },
      { source: 'beta', target: 'gamma' },
    ],
  });

  const local = deriveGraphViewData(graph, {
    mode: 'local',
    anchorId: 'beta',
    depth: 1,
    showIsolated: false,
    activeTypes: ['entity', 'concept', 'plugin'],
    activeTags: ['docs'],
  });

  assert.deepEqual(local.nodes.map((node) => node.id), ['beta', 'gamma']);
  assert.deepEqual(local.links, [{ source: 'beta', target: 'gamma' }]);
  assert.equal(local.anchorId, 'beta');
  assert.equal(local.anchorName, 'Beta');
  assert.deepEqual(local.availableTags.map((entry) => entry.value), ['core', 'docs', 'extra']);
});

test('normalizeGraphViewConfig clamps invalid defaults', () => {
  const config = normalizeGraphViewConfig({
    defaults: {
      mode: 'weird',
      depth: 99,
      labelMode: 'loud',
      highlightNeighbors: 'yes',
      tagMatchMode: 'invalid',
    },
    features: { labels: false, neighbors: false, path: false, focus: false },
    limits: { minDepth: 3, maxDepth: 2 },
  });

  assert.equal(config.defaults.mode, 'global');
  assert.equal(config.defaults.depth, 3);
  assert.equal(config.defaults.labelMode, 'all');
  assert.equal(config.defaults.highlightNeighbors, true);
  assert.equal(config.defaults.tagMatchMode, 'any');
  assert.equal(config.features.labels, false);
  assert.equal(config.features.neighbors, false);
  assert.equal(config.features.path, false);
  assert.equal(config.features.focus, false);
  assert.equal(config.limits.minDepth, 3);
  assert.equal(config.limits.maxDepth, 3);
});

test('findShortestPath returns the shortest visible route when one exists', () => {
  const adjacency = buildAdjacency(
    [
      { id: 'alpha' },
      { id: 'beta' },
      { id: 'gamma' },
      { id: 'delta' },
      { id: 'epsilon' },
    ],
    [
      { source: 'alpha', target: 'beta' },
      { source: 'beta', target: 'gamma' },
      { source: 'alpha', target: 'delta' },
      { source: 'delta', target: 'epsilon' },
      { source: 'epsilon', target: 'gamma' },
    ]
  );

  assert.deepEqual(findShortestPath(adjacency, 'alpha', 'gamma'), ['alpha', 'beta', 'gamma']);
  assert.deepEqual(findShortestPath(adjacency, 'gamma', 'gamma'), ['gamma']);
  assert.deepEqual(findShortestPath(adjacency, 'alpha', 'missing'), []);
});
