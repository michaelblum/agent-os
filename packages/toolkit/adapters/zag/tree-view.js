import { mergeProps } from './shared.js';

const ROOT_SELECTOR = '[data-aos-tree-view-root]';
const ITEM_SELECTOR = '[data-aos-tree-view-item]';
const TRANSIENT_BOOLEAN_PROPS = new Set(['hidden', 'disabled', 'checked', 'selected', 'open', 'multiple']);
const REFLECTED_STRING_PROPS = new Set(['id', 'role', 'title', 'tabIndex', 'tabindex', 'className', 'class']);

// AOS-owned tree-view adapter for aos:// hosted toolkit surfaces.
//
// This adapter intentionally implements the tree behavior needed by toolkit
// surfaces without claiming to run the upstream @zag-js/tree-view machine:
// item normalization, roving focus, selection, expansion state, visible item
// projection, ARIA tree roles/positions, bind/update/cleanup lifecycle, and
// bound-DOM descendant hiding. If the toolkit later needs full upstream Zag
// Tree View parity, add the dependency and replace this boundary with a real
// machine-backed adapter in the same public lifecycle shape.

function compactProps(props = {}) {
  return Object.fromEntries(Object.entries(props).filter(([, value]) => value !== undefined));
}

function applyAttr(element, key, value) {
  const attr = key === 'className' ? 'class' : key;
  const prop = attr === 'class' ? 'className' : attr === 'tabindex' ? 'tabIndex' : attr;
  if (value === false || value === undefined || value === null) {
    element.removeAttribute?.(attr);
    if ((TRANSIENT_BOOLEAN_PROPS.has(attr) || attr.includes('-')) && attr in element) element[attr] = false;
    else if (REFLECTED_STRING_PROPS.has(attr) && prop in element) element[prop] = '';
  } else if (value === true) {
    element.setAttribute?.(attr, '');
    if (TRANSIENT_BOOLEAN_PROPS.has(attr) && attr in element) element[attr] = true;
  } else {
    element.setAttribute?.(attr, String(value));
  }
}

function itemIdForElement(element, index = 0) {
  return element?.dataset?.itemId
    || element?.dataset?.id
    || element?.getAttribute?.('data-item-id')
    || element?.id
    || `item-${index}`;
}

function setAttrs(element, props = {}) {
  if (!element) return () => {};
  const previous = new Map();
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith('on') && typeof value === 'function') {
      const eventName = key.slice(2).toLowerCase();
      element.addEventListener?.(eventName, value);
      previous.set(key, () => element.removeEventListener?.(eventName, value));
      continue;
    }
    const attr = key === 'className' ? 'class' : key;
    previous.set(attr, element.getAttribute?.(attr));
    applyAttr(element, key, value);
  }
  return () => {
    for (const [key, value] of previous) {
      if (typeof value === 'function') value();
      else if (value === null || value === undefined) {
        element.removeAttribute?.(key);
        if ((TRANSIENT_BOOLEAN_PROPS.has(key) || key.includes('-')) && key in element) element[key] = false;
        else {
          const prop = key === 'class' ? 'className' : key === 'tabindex' ? 'tabIndex' : key;
          if (REFLECTED_STRING_PROPS.has(key) && prop in element) element[prop] = '';
        }
      }
      else element.setAttribute?.(key, value);
    }
  };
}

function normalizeItem(item = {}, index = 0) {
  const id = String(item.id ?? `item-${index}`);
  return {
    id,
    label: String(item.label ?? id),
    parentId: item.parentId ? String(item.parentId) : '',
    depth: Number.isFinite(Number(item.depth)) ? Number(item.depth) : 0,
    hasChildren: item.hasChildren === true,
    isExpanded: item.isExpanded === true,
    isSelected: item.isSelected === true,
    isFocused: item.isFocused === true,
    fullLabel: item.fullLabel ? String(item.fullLabel) : String(item.label ?? id),
    data: item.data,
  };
}

export function collapseTreeViewPathFragments(items = []) {
  const normalized = items.map(normalizeItem);
  const childrenByParent = new Map();
  for (const item of normalized) {
    const key = item.parentId || '';
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key).push(item);
  }
  const byId = new Map(normalized.map((item) => [item.id, item]));
  const consumed = new Set();
  const collapsed = [];

  for (const item of normalized) {
    if (consumed.has(item.id)) continue;
    const chain = [item];
    let cursor = item;
    while (cursor.hasChildren) {
      const children = childrenByParent.get(cursor.id) || [];
      if (children.length !== 1) break;
      const child = children[0];
      const childChildren = childrenByParent.get(child.id) || [];
      if (child.isSelected || child.data?.hasContent || (!child.hasChildren && childChildren.length === 0)) break;
      chain.push(child);
      cursor = child;
    }
    for (const node of chain) consumed.add(node.id);
    const last = chain.at(-1);
    collapsed.push({
      ...last,
      id: chain.map((node) => node.id).join('__'),
      sourceId: last.id,
      parentId: chain[0].parentId,
      depth: chain[0].depth,
      label: chain.map((node) => node.label).join(' / '),
      fullLabel: chain.map((node) => node.fullLabel || node.label).join(' / '),
      collapsedIds: chain.map((node) => node.id),
      hasChildren: (childrenByParent.get(last.id) || []).length > 0,
    });
  }

  return collapsed.filter((item) => {
    if (!item.parentId) return true;
    return !consumed.has(item.parentId) || byId.get(item.parentId)?.id === item.parentId;
  });
}

export function createAosZagTreeView(context = {}) {
  if (!context.id) throw new Error('createAosZagTreeView requires an id');

  let currentProps = compactProps({
    id: context.id,
    items: context.items || [],
    defaultExpandedIds: context.defaultExpandedIds || [],
    expandedIds: context.expandedIds,
    selectedId: context.selectedId,
    focusedId: context.focusedId,
    collapsePathFragments: context.collapsePathFragments ?? false,
    onExpandedChange: context.onExpandedChange,
    onSelectionChange: context.onSelectionChange,
    onFocusChange: context.onFocusChange,
  });
  let items = normalizeItems(currentProps.items);
  let expandedIds = new Set(currentProps.expandedIds || currentProps.defaultExpandedIds || items.filter((item) => item.isExpanded).map((item) => item.id));
  let selectedId = currentProps.selectedId || items.find((item) => item.isSelected)?.id || '';
  let focusedId = currentProps.focusedId || selectedId || items[0]?.id || '';
  const cleanups = new Set();
  const boundItems = new Map();
  let currentRoot = null;

  function normalizeItems(nextItems = []) {
    const normalized = nextItems.map(normalizeItem);
    const childCounts = new Map();
    for (const item of normalized) {
      if (!item.parentId) continue;
      childCounts.set(item.parentId, (childCounts.get(item.parentId) || 0) + 1);
    }
    return normalized.map((item) => ({ ...item, hasChildren: item.hasChildren || childCounts.has(item.id) }));
  }

  function itemById(id) {
    return items.find((item) => item.id === id || item.sourceId === id || item.collapsedIds?.includes(id));
  }

  function childrenOf(parentId) {
    return items.filter((item) => (item.parentId || '') === (parentId || ''));
  }

  function visibleItems() {
    const result = [];
    const visit = (parentId = '') => {
      for (const item of childrenOf(parentId)) {
        result.push(item);
        if (item.hasChildren && expandedIds.has(item.id)) visit(item.sourceId || item.id);
      }
    };
    visit('');
    return result;
  }

  function visibleItemIds() {
    return new Set(visibleItems().map((item) => item.id));
  }

  function treePosition(item) {
    const siblings = childrenOf(item.parentId);
    return {
      setsize: siblings.length,
      posinset: Math.max(1, siblings.findIndex((sibling) => sibling.id === item.id) + 1),
    };
  }

  function notifyExpanded() {
    currentProps.onExpandedChange?.({ expandedIds: Array.from(expandedIds) });
  }

  function setFocusedId(nextId) {
    const next = itemById(nextId);
    if (!next) return connect();
    focusedId = next.id;
    currentProps.onFocusChange?.({ focusedId });
    syncBoundParts();
    return connect();
  }

  function select(nextId) {
    const next = itemById(nextId);
    if (!next) return connect();
    selectedId = next.id;
    focusedId = next.id;
    currentProps.onSelectionChange?.({ selectedId });
    syncBoundParts();
    return connect();
  }

  function expand(nextId) {
    const item = itemById(nextId);
    if (!item?.hasChildren || expandedIds.has(item.id)) return connect();
    expandedIds.add(item.id);
    notifyExpanded();
    syncBoundParts();
    return connect();
  }

  function collapse(nextId) {
    const item = itemById(nextId);
    if (!item?.hasChildren || !expandedIds.has(item.id)) return connect();
    expandedIds.delete(item.id);
    notifyExpanded();
    syncBoundParts();
    return connect();
  }

  function handleKeyDown(event, itemId) {
    const visible = visibleItems();
    const current = itemById(itemId) || itemById(focusedId) || visible[0];
    const index = visible.findIndex((item) => item.id === current?.id);
    if (index < 0) return;
    let next = null;
    if (event.key === 'ArrowDown') next = visible[Math.min(visible.length - 1, index + 1)];
    else if (event.key === 'ArrowUp') next = visible[Math.max(0, index - 1)];
    else if (event.key === 'Home') next = visible[0];
    else if (event.key === 'End') next = visible.at(-1);
    else if (event.key === 'ArrowRight') {
      if (current.hasChildren && !expandedIds.has(current.id)) expand(current.id);
      else next = childrenOf(current.sourceId || current.id)[0];
    } else if (event.key === 'ArrowLeft') {
      if (current.hasChildren && expandedIds.has(current.id)) collapse(current.id);
      else next = itemById(current.parentId);
    } else if (event.key === 'Enter' || event.key === ' ') {
      select(current.id);
    } else {
      return;
    }
    event.preventDefault?.();
    if (next) {
      setFocusedId(next.id);
      itemElement(next.id)?.focus?.();
    }
  }

  function getRootProps(extra = {}) {
    return mergeProps({
      id: currentProps.id,
      role: 'tree',
      'data-scope': 'tree-view',
      'data-part': 'root',
    }, extra);
  }

  function getItemProps(props = {}, extra = {}) {
    const item = itemById(props.id);
    if (!item) return mergeProps({}, extra);
    const position = treePosition(item);
    return mergeProps({
      id: `${currentProps.id}-item-${item.id}`,
      role: 'treeitem',
      tabindex: item.id === focusedId ? '0' : '-1',
      'aria-expanded': item.hasChildren ? (expandedIds.has(item.id) ? 'true' : 'false') : undefined,
      'aria-selected': item.id === selectedId ? 'true' : 'false',
      'aria-level': String(item.depth + 1),
      'aria-setsize': String(position.setsize),
      'aria-posinset': String(position.posinset),
      'data-scope': 'tree-view',
      'data-part': 'item',
      'data-item-id': item.id,
      'data-focused': item.id === focusedId ? '' : undefined,
      'data-selected': item.id === selectedId ? '' : undefined,
      title: item.fullLabel,
      onClick: () => select(item.id),
      onFocus: () => setFocusedId(item.id),
      onKeyDown: (event) => handleKeyDown(event, item.id),
    }, extra);
  }

  function itemElement(itemId) {
    if (boundItems.has(itemId)) return boundItems.get(itemId);
    const root = currentRoot || context.getRootNode?.() || globalThis.document;
    return Array.from(root?.querySelectorAll?.(ITEM_SELECTOR) || [])
      .find((element, index) => itemIdForElement(element, index) === itemId) || null;
  }

  function syncBoundParts() {
    const visible = visibleItemIds();
    for (const [itemId, element] of boundItems) {
      const visibleItem = visible.has(itemId);
      const props = {
        ...Object.fromEntries(
        Object.entries(getItemProps({ id: itemId })).filter(([key]) => !key.startsWith('on'))
        ),
        hidden: visibleItem ? false : true,
        'aria-hidden': visibleItem ? undefined : 'true',
        'data-visible': visibleItem ? '' : undefined,
      };
      for (const [key, value] of Object.entries(props)) {
        applyAttr(element, key, value);
      }
    }
  }

  function cleanupBindings() {
    for (const cleanup of cleanups) cleanup();
    cleanups.clear();
    boundItems.clear();
  }

  function bindRoot(element, extraProps = {}) {
    const cleanup = setAttrs(element, getRootProps(extraProps));
    cleanups.add(cleanup);
    return cleanup;
  }

  function bindItem(element, extraProps = {}, index = 0) {
    const itemId = extraProps.id || itemIdForElement(element, index);
    const visible = visibleItemIds();
    const visibleItem = visible.has(itemId);
    const cleanup = setAttrs(element, {
      ...getItemProps({ id: itemId }, extraProps.extra || {}),
      hidden: visibleItem ? false : true,
      'aria-hidden': visibleItem ? undefined : 'true',
      'data-visible': visibleItem ? '' : undefined,
    });
    boundItems.set(itemId, element);
    cleanups.add(cleanup);
    return cleanup;
  }

  function bindItems(root, selector = ITEM_SELECTOR) {
    const elements = Array.from(root?.querySelectorAll?.(selector) || []);
    elements.forEach((element, index) => bindItem(element, {}, index));
    return elements.length;
  }

  function bind(root, options = {}) {
    currentRoot = root;
    cleanupBindings();
    bindRoot(options.root || root?.querySelector?.(options.rootSelector || ROOT_SELECTOR) || root, options.rootProps || {});
    bindItems(root, options.itemSelector || ITEM_SELECTOR);
    return connect();
  }

  function connect() {
    return {
      api: {
        getRootProps,
        getItemProps,
        expand,
        collapse,
        select,
        setFocusedId,
      },
      expandedIds: Array.from(expandedIds),
      focusedId,
      selectedId,
      visibleItems: visibleItems(),
      getRootProps,
      getItemProps,
    };
  }

  function update(nextContext = {}) {
    currentProps = compactProps({ ...currentProps, ...nextContext });
    if (nextContext.items) items = normalizeItems(currentProps.collapsePathFragments ? collapseTreeViewPathFragments(nextContext.items) : nextContext.items);
    if (nextContext.expandedIds) expandedIds = new Set(nextContext.expandedIds);
    if (nextContext.selectedId !== undefined) selectedId = nextContext.selectedId;
    if (nextContext.focusedId !== undefined) focusedId = nextContext.focusedId;
    syncBoundParts();
    return connect();
  }

  items = normalizeItems(currentProps.collapsePathFragments ? collapseTreeViewPathFragments(currentProps.items) : currentProps.items);

  return {
    bind,
    bindRoot,
    bindItem,
    bindItems,
    cleanupBindings,
    connect,
    destroy() {
      cleanupBindings();
    },
    update,
    expand,
    collapse,
    select,
    setFocusedId,
  };
}
