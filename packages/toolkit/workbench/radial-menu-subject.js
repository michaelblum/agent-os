import { createWorkbenchSubject } from './subject.js';
import { formatSubjectEntryHandle } from './subject-entry-handle.js';

export const RADIAL_MENU_SUBJECT_TYPE = 'aos.radial_menu.3d';
export const RADIAL_MENU_ITEM_RESOURCE_TYPE = 'aos.radial_menu.item_resource';
export const RADIAL_MENU_RESOURCE_FACETS = Object.freeze({
  overview: 'menu-overview',
  config: 'menu-config',
  itemConfig: 'item-config',
  sourceNotes: 'source-notes',
  preview: 'radial-preview',
  objectRegistry: 'object-registry',
  objectControls: 'object-controls',
  animationControls: 'animation-controls',
  exportLockIn: 'export-lock-in',
});

const RADIAL_MENU_CONTRACTS = Object.freeze([
  'aos.radial_menu.logical_items',
  'aos.radial_menu.config',
  'aos.radial_menu.expression_3d',
  'aos.radial_menu.preview',
  'canvas_object.registry',
  'canvas_object.transform.patch',
  'canvas_object.effects.patch',
  'canvas_object.visibility.patch',
  'aos.radial_menu.export',
]);

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

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

function itemLogical(item = {}) {
  const logical = isPlainObject(item.logical) ? item.logical : item;
  return {
    id: text(logical.id || item.id),
    label: text(logical.label || item.label || item.id),
    action: logical.action ?? item.action ?? null,
    disabled: !!logical.disabled,
    hidden: !!logical.hidden,
    checked: !!logical.checked,
    current: !!logical.current,
    role: text(logical.role || item.role, 'menuitem'),
    shortcut: logical.shortcut || item.shortcut || null,
    typeahead: text(logical.typeahead || item.typeahead, logical.label || item.label || item.id),
    close_on_select: logical.close_on_select !== false,
    target_surface: cloneJson(logical.target_surface || item.target_surface || null),
    action_payload: cloneJson(logical.action_payload || item.action_payload || null),
    submenu_ref: logical.submenu_ref || item.submenu_ref || null,
    children: list(logical.children || item.children).map((child) => itemLogical(child)),
  };
}

export function radialMenuLogicalItems(menu = {}) {
  const items = Array.isArray(menu.logical_items)
    ? menu.logical_items
    : list(menu.items).map((item) => itemLogical(item));
  return items
    .map((item) => itemLogical(item))
    .filter((item) => item.id && !item.hidden);
}

export function radialMenuSubjectId(menuOrId = {}) {
  const id = typeof menuOrId === 'string' ? menuOrId : menuOrId?.id;
  return `aos.radial_menu:${text(id, 'default')}`;
}

export function radialMenuResourceSubjectId(menuOrId = {}, resourcePath = '') {
  return `${radialMenuSubjectId(menuOrId)}/${text(resourcePath, 'resource')}`;
}

export function radialMenuEntryHandle(menuOrId = {}, facetKey = RADIAL_MENU_RESOURCE_FACETS.overview) {
  return formatSubjectEntryHandle(facetKey, radialMenuSubjectId(menuOrId));
}

export function radialMenuResourceEntryHandle(menuOrId = {}, resourcePath = '', facetKey = RADIAL_MENU_RESOURCE_FACETS.itemConfig) {
  return formatSubjectEntryHandle(facetKey, radialMenuResourceSubjectId(menuOrId, resourcePath));
}

function canvasHost(canvasId = 'radial-menu-workbench', {
  facet,
  preferred = false,
  resourcePath = '',
} = {}) {
  return {
    kind: 'canvas',
    target_dialect: 'canvas',
    entry: {
      kind: 'canvas-id',
      value: text(canvasId, 'radial-menu-workbench'),
      ...(facet ? { facet } : {}),
      ...(resourcePath ? { resource_path: resourcePath } : {}),
    },
    ...(preferred ? { preferred: true } : {}),
    browser_compatible: true,
  };
}

function facet({ key, layer, label, contracts = [], capabilities = ['inspectable'], source = null, hosts = [], metadata = {} }) {
  return {
    key,
    layer,
    label,
    capabilities,
    contracts,
    source: source ? cloneJson(source) : null,
    hosts,
    metadata: cloneJson(metadata),
  };
}

export function createRadialMenuWorkbenchSubject({
  menu = {},
  owner = 'toolkit',
  canvasId = 'radial-menu-workbench',
  source = null,
  selectedItemId = '',
  itemResourcePrefix = 'item',
  extraFacets = [],
  metadata = {},
  state = {},
} = {}) {
  const subjectId = radialMenuSubjectId(menu);
  const logicalItems = radialMenuLogicalItems(menu);
  const selectedItem = logicalItems.find((item) => item.id === selectedItemId) || logicalItems[0] || null;
  const selectedResourcePath = selectedItem ? `${itemResourcePrefix}/${selectedItem.id}` : '';
  const hostsFor = (facetKey, options = {}) => [
    canvasHost(canvasId, { facet: facetKey, ...options }),
  ];
  const subject = createWorkbenchSubject({
    id: subjectId,
    type: RADIAL_MENU_SUBJECT_TYPE,
    label: text(menu.label, text(menu.id, 'Radial Menu')),
    owner,
    source,
    capabilities: ['inspectable', 'editable', 'exportable'],
    contracts: RADIAL_MENU_CONTRACTS,
    subject_references: selectedItem ? [{
      id: `radial-menu-item-${selectedItem.id}`,
      relationship: 'selected-resource',
      handle: radialMenuResourceEntryHandle(menu, selectedResourcePath, RADIAL_MENU_RESOURCE_FACETS.itemConfig),
      subject_id: radialMenuResourceSubjectId(menu, selectedResourcePath),
      subject_type: RADIAL_MENU_ITEM_RESOURCE_TYPE,
      facet_key: RADIAL_MENU_RESOURCE_FACETS.itemConfig,
      layer: 'resource',
      role: 'resource-path',
      metadata: {
        graph_node: false,
        resource_path: selectedResourcePath,
      },
    }] : [],
    facets: [
      facet({
        key: RADIAL_MENU_RESOURCE_FACETS.overview,
        layer: 'model',
        label: 'Menu Overview',
        contracts: ['aos.radial_menu.logical_items'],
        hosts: hostsFor(RADIAL_MENU_RESOURCE_FACETS.overview, { preferred: true }),
        metadata: { item_count: logicalItems.length },
      }),
      facet({
        key: RADIAL_MENU_RESOURCE_FACETS.config,
        layer: 'resource',
        label: 'Config JSON',
        contracts: ['aos.radial_menu.config'],
        hosts: hostsFor(RADIAL_MENU_RESOURCE_FACETS.config),
      }),
      facet({
        key: RADIAL_MENU_RESOURCE_FACETS.itemConfig,
        layer: 'resource',
        label: 'Selected Item Config',
        contracts: ['aos.radial_menu.item_config'],
        hosts: hostsFor(RADIAL_MENU_RESOURCE_FACETS.itemConfig, { resourcePath: selectedResourcePath }),
        metadata: {
          resource_path: selectedResourcePath || null,
          graph_node: false,
        },
      }),
      facet({
        key: RADIAL_MENU_RESOURCE_FACETS.sourceNotes,
        layer: 'notes',
        label: 'Source Notes',
        contracts: ['aos.radial_menu.source_notes'],
        hosts: hostsFor(RADIAL_MENU_RESOURCE_FACETS.sourceNotes),
      }),
      facet({
        key: RADIAL_MENU_RESOURCE_FACETS.preview,
        layer: 'artifacts',
        label: '3D Expression Preview',
        contracts: ['aos.radial_menu.preview', 'aos.radial_menu.expression_3d'],
        hosts: hostsFor(RADIAL_MENU_RESOURCE_FACETS.preview),
      }),
      facet({
        key: RADIAL_MENU_RESOURCE_FACETS.objectRegistry,
        layer: 'descriptor',
        label: 'Object Registry',
        contracts: ['canvas_object.registry'],
        hosts: hostsFor(RADIAL_MENU_RESOURCE_FACETS.objectRegistry),
      }),
      facet({
        key: RADIAL_MENU_RESOURCE_FACETS.objectControls,
        layer: 'controls',
        label: 'Object Controls',
        capabilities: ['editable'],
        contracts: [
          'canvas_object.transform.patch',
          'canvas_object.effects.patch',
          'canvas_object.visibility.patch',
        ],
        hosts: hostsFor(RADIAL_MENU_RESOURCE_FACETS.objectControls, { resourcePath: selectedResourcePath }),
      }),
      facet({
        key: RADIAL_MENU_RESOURCE_FACETS.animationControls,
        layer: 'controls',
        label: 'Animation Controls',
        capabilities: ['editable'],
        contracts: ['aos.radial_menu.animation.patch', 'aos.radial_menu.effect.patch'],
        hosts: hostsFor(RADIAL_MENU_RESOURCE_FACETS.animationControls, { resourcePath: selectedResourcePath }),
      }),
      facet({
        key: RADIAL_MENU_RESOURCE_FACETS.exportLockIn,
        layer: 'actions',
        label: 'Export / Lock In',
        capabilities: ['exportable'],
        contracts: ['aos.radial_menu.export'],
        hosts: hostsFor(RADIAL_MENU_RESOURCE_FACETS.exportLockIn, { resourcePath: selectedResourcePath }),
      }),
      ...list(extraFacets).map((entry) => cloneJson(entry)),
    ],
    persistence: {
      kind: 'consumer-owned',
      request: 'aos.radial_menu.export',
      result: 'source.patch.result',
    },
    state: {
      menu_id: text(menu.id, 'default'),
      selected_item_id: selectedItem?.id || null,
      selected_resource_path: selectedResourcePath || null,
      logical_item_count: logicalItems.length,
      logical_items: logicalItems,
      ...cloneJson(state),
    },
    metadata: {
      graph_node_policy: 'resources_and_facets_not_menu_item_nodes_by_default',
      zag_role: 'dom_ax_2d_projection_only',
      ...cloneJson(metadata),
    },
  });
  return subject;
}
