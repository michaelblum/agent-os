import { mergeProps, normalizeProps } from './shared.js';

const DEFAULT_ITEM_SELECTOR = '[data-value]';
const TRIGGER_SELECTOR = '[data-aos-select-trigger]';
const CONTENT_SELECTOR = '[data-aos-select-content]';

function arrayValue(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

function compactProps(props = {}) {
  return Object.fromEntries(Object.entries(props).filter(([, value]) => value !== undefined));
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
    if (value === false || value === undefined || value === null) {
      element.removeAttribute?.(attr);
      if (value === false && attr in element) element[attr] = false;
    } else if (value === true) {
      element.setAttribute?.(attr, '');
      if (attr in element) element[attr] = true;
    } else {
      element.setAttribute?.(attr, String(value));
    }
  }
  return () => {
    for (const [key, value] of previous) {
      if (typeof value === 'function') value();
      else if (value === null || value === undefined) element.removeAttribute?.(key);
      else element.setAttribute?.(key, value);
    }
  };
}

function collectionItems(collection) {
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection?.items)) return collection.items;
  if (Array.isArray(collection?.options)) return collection.options;
  if (typeof collection?.toArray === 'function') return collection.toArray();
  return [];
}

function valueForItem(item = {}) {
  return String(item.value ?? item.id ?? item.name ?? '');
}

function labelForItem(item = {}) {
  return item.label ?? item.name ?? valueForItem(item);
}

function findItem(collection, value) {
  const textValue = String(value ?? '');
  return collection?.find?.(textValue)
    || collectionItems(collection).find((item) => valueForItem(item) === textValue)
    || null;
}

function valueForElement(element, index = 0) {
  return element?.dataset?.value
    || element?.getAttribute?.('data-value')
    || element?.value
    || String(index);
}

function itemText(element, item, value) {
  return element?.getAttribute?.('aria-label')
    || element?.getAttribute?.('title')
    || element?.textContent?.trim()
    || item?.label
    || item?.name
    || value;
}

export function createAosZagSelect(context = {}) {
  if (!context.id) throw new Error('createAosZagSelect requires an id');
  if (!context.collection) throw new Error('createAosZagSelect requires a collection');

  const itemSelector = context.itemSelector || DEFAULT_ITEM_SELECTOR;
  let currentProps = compactProps({
    id: context.id,
    collection: context.collection,
    value: context.value,
    defaultValue: context.defaultValue,
    placeholder: context.placeholder,
    disabled: context.disabled,
    multiple: context.multiple,
    open: context.open,
    defaultOpen: context.defaultOpen,
    name: context.name,
    form: context.form,
    invalid: context.invalid,
    readOnly: context.readOnly,
    required: context.required,
    closeOnSelect: context.closeOnSelect ?? true,
    highlightedValue: context.highlightedValue,
    defaultHighlightedValue: context.defaultHighlightedValue,
    onSelect: context.onSelect,
    onHighlightChange: context.onHighlightChange,
    onValueChange: context.onValueChange,
    onOpenChange: context.onOpenChange,
    onStateChange: context.onStateChange,
  });
  let values = arrayValue(currentProps.value ?? currentProps.defaultValue);
  let open = !!(currentProps.open ?? currentProps.defaultOpen);
  let highlightedValue = currentProps.highlightedValue
    ?? currentProps.defaultHighlightedValue
    ?? null;
  const cleanups = new Set();
  const itemCleanups = new Set();

  function disabled() {
    return !!currentProps.disabled;
  }

  function selectedItems() {
    return values.map((value) => findItem(currentProps.collection, value)).filter(Boolean);
  }

  function highlightedItem() {
    return highlightedValue ? findItem(currentProps.collection, highlightedValue) : null;
  }

  function getTriggerProps(extra = {}) {
    return mergeProps({
      id: `${currentProps.id}-trigger`,
      role: 'combobox',
      type: 'button',
      'aria-controls': `${currentProps.id}-content`,
      'aria-expanded': String(open),
      'aria-haspopup': 'listbox',
      'aria-disabled': disabled() ? 'true' : undefined,
      disabled: disabled() ? true : undefined,
      'data-scope': 'select',
      'data-part': 'trigger',
      'data-state': open ? 'open' : 'closed',
      onClick: () => setOpen(!open),
    }, extra);
  }

  function getContentProps(extra = {}) {
    return mergeProps({
      id: `${currentProps.id}-content`,
      role: 'listbox',
      hidden: !open,
      'data-scope': 'select',
      'data-part': 'content',
      'data-state': open ? 'open' : 'closed',
    }, extra);
  }

  function getItemProps({ item } = {}, extra = {}) {
    const value = valueForItem(item);
    const selected = values.includes(value);
    return mergeProps({
      id: `${currentProps.id}-item-${value}`,
      role: 'option',
      'aria-selected': String(selected),
      'data-scope': 'select',
      'data-part': 'item',
      'data-value': value,
      'data-selected': selected ? '' : undefined,
      'aria-disabled': item?.disabled ? 'true' : undefined,
      onClick: () => {
        if (item?.disabled || disabled()) return;
        selectValue(value);
      },
    }, extra);
  }

  function getLabelProps(extra = {}) {
    return mergeProps({
      id: `${currentProps.id}-label`,
      'data-scope': 'select',
      'data-part': 'label',
    }, extra);
  }

  function stateName() {
    return open ? 'open' : 'idle';
  }

  function api() {
    return {
      open,
      value: [...values],
      selectedItems: selectedItems(),
      highlightedValue,
      highlightedItem: highlightedItem(),
      getTriggerProps,
      getContentProps,
      getItemProps,
      getLabelProps,
      setOpen,
      setValue,
      selectValue,
      clearValue,
    };
  }

  function snapshot() {
    const selectApi = api();
    return {
      api: selectApi,
      service: {
        state: {
          get: stateName,
        },
      },
      open,
      value: [...values],
      selectedItems: selectApi.selectedItems,
      highlightedValue,
      highlightedItem: selectApi.highlightedItem,
      state: stateName(),
      send: () => {},
      getTriggerProps,
      getContentProps,
      getItemProps,
      getLabelProps,
      setOpen,
      setValue,
      selectValue,
      clearValue,
    };
  }

  function notifyState() {
    const next = snapshot();
    currentProps.onStateChange?.(next);
    return next;
  }

  function setOpen(nextOpen) {
    const previous = open;
    open = disabled() ? false : !!nextOpen;
    if (previous !== open) currentProps.onOpenChange?.({ open });
    return notifyState();
  }

  function setValue(nextValue) {
    values = arrayValue(nextValue);
    currentProps.onValueChange?.({ value: [...values], items: selectedItems() });
    return notifyState();
  }

  function selectValue(value) {
    const textValue = String(value ?? '');
    if (currentProps.multiple) {
      values = values.includes(textValue)
        ? values.filter((item) => item !== textValue)
        : [...values, textValue];
    } else {
      values = [textValue];
    }
    const item = findItem(currentProps.collection, textValue)
      || { value: textValue, label: textValue };
    currentProps.onSelect?.({ value: textValue, item });
    currentProps.onValueChange?.({ value: [...values], items: selectedItems() });
    const previousOpen = open;
    if (currentProps.closeOnSelect !== false) open = false;
    if (previousOpen !== open) currentProps.onOpenChange?.({ open });
    return notifyState();
  }

  function clearValue() {
    values = [];
    currentProps.onValueChange?.({ value: [], items: [] });
    return notifyState();
  }

  function cleanupBindings() {
    for (const cleanup of cleanups) cleanup();
    cleanups.clear();
    itemCleanups.clear();
  }

  function cleanupItemBindings() {
    for (const cleanup of itemCleanups) {
      cleanup();
      cleanups.delete(cleanup);
    }
    itemCleanups.clear();
  }

  function bindPart(element, props, bucket = null) {
    const cleanup = setAttrs(element, props);
    cleanups.add(cleanup);
    bucket?.add(cleanup);
    return cleanup;
  }

  function bindTrigger(element, extra = {}) {
    return bindPart(element, getTriggerProps(extra));
  }

  function bindContent(element, extra = {}) {
    return bindPart(element, getContentProps(extra));
  }

  function bindItems(root, selector = itemSelector, getProps = null) {
    cleanupItemBindings();
    const elements = Array.from(root?.querySelectorAll?.(selector) || []);
    elements.forEach((element, index) => {
      const value = valueForElement(element, index);
      const item = findItem(currentProps.collection, value) || {
        value,
        label: itemText(element, null, value),
        disabled: element?.disabled || element?.getAttribute?.('aria-disabled') === 'true',
      };
      bindPart(element, getItemProps({ item }, {
        'data-aos-select-item': '',
        ...(getProps?.(element, index) || {}),
      }), itemCleanups);
    });
    return elements.length;
  }

  let boundRoot = null;
  let boundOptions = {};

  function bind(root, options = {}) {
    cleanupBindings();
    boundRoot = root;
    boundOptions = options;
    bindTrigger(options.trigger || root?.querySelector?.(TRIGGER_SELECTOR), options.triggerProps || {});
    bindContent(options.content || root?.querySelector?.(CONTENT_SELECTOR), options.contentProps || {});
    bindItems(root, options.itemSelector || itemSelector, options.getItemProps || null);
    return snapshot();
  }

  function refreshBindings() {
    if (boundRoot) bind(boundRoot, boundOptions);
  }

  return {
    bind,
    bindTrigger,
    bindContent,
    bindItems,
    cleanupBindings,
    connect: snapshot,
    destroy() {
      cleanupBindings();
    },
    open() {
      return setOpen(true);
    },
    close() {
      return setOpen(false);
    },
    send: () => {},
    service: null,
    spreadProps: setAttrs,
    update(nextContext = {}) {
      currentProps = compactProps({ ...currentProps, ...nextContext });
      if (nextContext.value !== undefined) values = arrayValue(nextContext.value);
      if (nextContext.open !== undefined) open = !!nextContext.open;
      if (nextContext.highlightedValue !== undefined) highlightedValue = nextContext.highlightedValue;
      return snapshot();
    },
    setOpen,
    setValue,
    selectValue,
    clearValue,
  };
}

export { mergeProps, normalizeProps };
