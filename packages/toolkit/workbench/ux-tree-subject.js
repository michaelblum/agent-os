import { createWorkbenchSubject } from './subject.js';

export const UX_TREE_SUBJECT_TYPE = 'aos.ux_tree';
export const UX_TREE_RESOURCE_FACETS = Object.freeze({
  overview: 'ux-tree-overview',
  bindings: 'ux-tree-bindings',
  commands: 'ux-tree-commands',
  settings: 'ux-tree-settings',
  rawJson: 'ux-tree-json',
});

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function list(values = []) {
  return Array.isArray(values) ? values.filter(Boolean) : [];
}

function canvasHost(canvasId = 'ux-tree-workbench', { facet, preferred = false } = {}) {
  return {
    kind: 'canvas',
    target_dialect: 'canvas',
    entry: {
      kind: 'canvas-id',
      value: text(canvasId, 'ux-tree-workbench'),
      ...(facet ? { facet } : {}),
    },
    ...(preferred ? { preferred: true } : {}),
    browser_compatible: true,
  };
}

function facet({ key, layer, label, contracts = [], capabilities = ['inspectable'], hosts = [], metadata = {} }) {
  return {
    key,
    layer,
    label,
    capabilities,
    contracts,
    hosts,
    metadata: cloneJson(metadata),
  };
}

export function uxTreeSubjectId(treeOrId = {}) {
  const id = typeof treeOrId === 'string' ? treeOrId : treeOrId?.id;
  return `aos.ux_tree:${text(id, 'default')}`;
}

export function createUxTreeWorkbenchSubject({
  tree = {},
  owner = 'toolkit',
  canvasId = 'ux-tree-workbench',
  source = null,
  extraFacets = [],
  metadata = {},
  state = {},
} = {}) {
  const subjectId = uxTreeSubjectId(tree);
  const hostsFor = (facetKey, options = {}) => [
    canvasHost(canvasId, { facet: facetKey, ...options }),
  ];
  return createWorkbenchSubject({
    id: subjectId,
    type: UX_TREE_SUBJECT_TYPE,
    label: text(tree.label, text(tree.id, 'UX Tree')),
    owner,
    source,
    capabilities: ['inspectable'],
    contracts: [
      'aos.ux_tree',
      'aos.ux_tree.bindings',
      'aos.ux_tree.commands',
      'aos.ux_tree.settings',
    ],
    facets: [
      facet({
        key: UX_TREE_RESOURCE_FACETS.overview,
        layer: 'model',
        label: 'UX Tree Overview',
        contracts: ['aos.ux_tree'],
        hosts: hostsFor(UX_TREE_RESOURCE_FACETS.overview, { preferred: true }),
        metadata: {
          node_count: list(tree.nodes).length,
          binding_count: list(tree.bindings).length,
          command_count: list(tree.commands).length,
        },
      }),
      facet({
        key: UX_TREE_RESOURCE_FACETS.bindings,
        layer: 'model',
        label: 'Bindings',
        contracts: ['aos.ux_tree.bindings'],
        hosts: hostsFor(UX_TREE_RESOURCE_FACETS.bindings),
      }),
      facet({
        key: UX_TREE_RESOURCE_FACETS.commands,
        layer: 'model',
        label: 'Commands',
        contracts: ['aos.ux_tree.commands'],
        hosts: hostsFor(UX_TREE_RESOURCE_FACETS.commands),
      }),
      facet({
        key: UX_TREE_RESOURCE_FACETS.settings,
        layer: 'resource',
        label: 'Settings JSON',
        contracts: ['aos.ux_tree.settings'],
        hosts: hostsFor(UX_TREE_RESOURCE_FACETS.settings),
      }),
      facet({
        key: UX_TREE_RESOURCE_FACETS.rawJson,
        layer: 'resource',
        label: 'Raw UX Tree JSON',
        contracts: ['aos.ux_tree.json'],
        hosts: hostsFor(UX_TREE_RESOURCE_FACETS.rawJson),
      }),
      ...list(extraFacets).map((entry) => cloneJson(entry)),
    ],
    persistence: {
      kind: 'read_only',
    },
    state: {
      tree_id: text(tree.id, 'default'),
      schema: tree.schema || 'aos_ux_tree',
      version: tree.version || null,
      node_count: list(tree.nodes).length,
      binding_count: list(tree.bindings).length,
      command_count: list(tree.commands).length,
      bindings: cloneJson(list(tree.bindings)),
      commands: cloneJson(list(tree.commands)),
      settings: cloneJson(tree.settings || {}),
      raw_tree: cloneJson(tree),
      ...cloneJson(state),
    },
    metadata: {
      runtime_state: 'read_only_shadow',
      editor_cutover: 'future',
      ...cloneJson(metadata),
    },
  });
}
