import { mergeProps } from './shared.js';

const ROOT_SELECTOR = '[data-aos-tabs-root]';
const LIST_SELECTOR = '[data-aos-tabs-list]';
const TRIGGER_SELECTOR = '[data-aos-tabs-trigger]';
const CONTENT_SELECTOR = '[data-aos-tabs-content]';

function valueForElement(element, index = 0, prefix = 'tab') {
  return element?.dataset?.value
    || element?.dataset?.id
    || element?.getAttribute?.('data-value')
    || element?.id
    || `${prefix}-${index}`;
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
    } else if (value === true) {
      element.setAttribute?.(attr, '');
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

function compactProps(props = {}) {
  return Object.fromEntries(Object.entries(props).filter(([, value]) => value !== undefined));
}

export function createAosZagTabs(context = {}) {
  if (!context.id) throw new Error('createAosZagTabs requires an id');

  let currentProps = compactProps({
    id: context.id,
    value: context.value,
    defaultValue: context.defaultValue,
    activationMode: context.activationMode,
    loopFocus: context.loopFocus ?? true,
    orientation: context.orientation ?? 'horizontal',
    onValueChange: context.onValueChange,
    onFocusChange: context.onFocusChange,
  });
  let value = currentProps.value ?? currentProps.defaultValue ?? null;
  let focusedValue = value;
  const cleanups = new Set();

  function notifyValue(nextValue) {
    currentProps.onValueChange?.({ value: nextValue });
  }

  function notifyFocus(nextValue) {
    currentProps.onFocusChange?.({ focusedValue: nextValue, value: nextValue });
  }

  function setValue(nextValue, options = {}) {
    if (!nextValue || nextValue === value) return connect();
    value = nextValue;
    focusedValue = nextValue;
    if (!options.silent) notifyValue(nextValue);
    return connect();
  }

  function setFocusedValue(nextValue) {
    if (!nextValue || nextValue === focusedValue) return connect();
    focusedValue = nextValue;
    notifyFocus(nextValue);
    if ((currentProps.activationMode || 'automatic') === 'automatic') setValue(nextValue);
    return connect();
  }

  function getRootProps(extra = {}) {
    return mergeProps({
      id: currentProps.id,
      'data-scope': 'tabs',
      'data-part': 'root',
    }, extra);
  }

  function getListProps(extra = {}) {
    return mergeProps({
      role: 'tablist',
      'aria-orientation': currentProps.orientation || 'horizontal',
      'data-scope': 'tabs',
      'data-part': 'list',
    }, extra);
  }

  function getTriggerProps(props = {}, extra = {}) {
    const tabValue = props.value;
    const selected = tabValue === value;
    return mergeProps({
      id: `${currentProps.id}-trigger-${tabValue}`,
      role: 'tab',
      type: 'button',
      tabindex: selected ? '0' : '-1',
      'aria-selected': selected ? 'true' : 'false',
      'aria-controls': `${currentProps.id}-content-${tabValue}`,
      'data-scope': 'tabs',
      'data-part': 'trigger',
      'data-value': tabValue,
      onClick: () => setValue(tabValue),
      onFocus: () => {
        focusedValue = tabValue;
        notifyFocus(tabValue);
      },
      onKeyDown: (event) => handleTriggerKeydown(event, tabValue),
    }, extra);
  }

  function getContentProps(props = {}, extra = {}) {
    const tabValue = props.value;
    const selected = tabValue === value;
    return mergeProps({
      id: `${currentProps.id}-content-${tabValue}`,
      role: 'tabpanel',
      tabindex: '0',
      'aria-labelledby': `${currentProps.id}-trigger-${tabValue}`,
      'data-scope': 'tabs',
      'data-part': 'content',
      'data-value': tabValue,
      hidden: selected ? false : true,
    }, extra);
  }

  function valuesFromDocument() {
    const root = currentRoot || context.getRootNode?.() || globalThis.document;
    return Array.from(root?.querySelectorAll?.(TRIGGER_SELECTOR) || []).map((el, index) => valueForElement(el, index));
  }

  function handleTriggerKeydown(event, tabValue) {
    const keys = currentProps.orientation === 'vertical'
      ? ['ArrowUp', 'ArrowDown', 'Home', 'End']
      : ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const values = valuesFromDocument();
    const index = values.indexOf(tabValue);
    if (index < 0) return;
    event.preventDefault?.();
    const last = values.length - 1;
    let nextIndex = index;
    if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = last;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = index <= 0 ? (currentProps.loopFocus ? last : 0) : index - 1;
    else nextIndex = index >= last ? (currentProps.loopFocus ? 0 : last) : index + 1;
    setFocusedValue(values[nextIndex]);
  }

  function cleanupBindings() {
    for (const cleanup of cleanups) cleanup();
    cleanups.clear();
  }

  let currentRoot = null;

  function bindRoot(element, extraProps = {}) {
    const cleanup = setAttrs(element, getRootProps(extraProps));
    cleanups.add(cleanup);
    return cleanup;
  }

  function bindList(element, extraProps = {}) {
    const cleanup = setAttrs(element, getListProps(extraProps));
    cleanups.add(cleanup);
    return cleanup;
  }

  function bindTrigger(element, extraProps = {}, index = 0) {
    const tabValue = extraProps.value || valueForElement(element, index);
    const cleanup = setAttrs(element, getTriggerProps({ value: tabValue }, extraProps.extra || {}));
    cleanups.add(cleanup);
    return cleanup;
  }

  function bindContent(element, extraProps = {}, index = 0) {
    const tabValue = extraProps.value || valueForElement(element, index, 'content');
    const cleanup = setAttrs(element, getContentProps({ value: tabValue }, extraProps.extra || {}));
    cleanups.add(cleanup);
    return cleanup;
  }

  function bindMany(root, selector, binder, getProps = null) {
    const elements = Array.from(root?.querySelectorAll?.(selector) || []);
    elements.forEach((element, index) => binder(element, getProps?.(element, index) || {}, index));
    return elements.length;
  }

  function bind(root, options = {}) {
    cleanupBindings();
    currentRoot = root;
    bindRoot(options.root || root?.querySelector?.(ROOT_SELECTOR) || root, options.rootProps || {});
    bindList(options.list || root?.querySelector?.(LIST_SELECTOR), options.listProps || {});
    bindTriggers(root, options.triggerSelector || TRIGGER_SELECTOR, options.getTriggerProps || null);
    bindContents(root, options.contentSelector || CONTENT_SELECTOR, options.getContentProps || null);
    return connect();
  }

  function bindTriggers(root, selector = TRIGGER_SELECTOR, getProps = null) {
    return bindMany(root, selector, bindTrigger, getProps);
  }

  function bindContents(root, selector = CONTENT_SELECTOR, getProps = null) {
    return bindMany(root, selector, bindContent, getProps);
  }

  function connect() {
    const api = {
      value,
      focusedValue,
      getRootProps,
      getListProps,
      getTriggerProps,
      getContentProps,
      setValue,
    };
    return {
      api,
      service: null,
      value,
      focusedValue,
      state: value,
      send: () => {},
      getRootProps,
      getListProps,
      getTriggerProps,
      getContentProps,
      setValue,
    };
  }

  return {
    bind,
    bindMany,
    bindRoot,
    bindList,
    bindTrigger,
    bindContent,
    bindTriggers,
    bindContents,
    cleanupBindings,
    connect,
    destroy() {
      cleanupBindings();
    },
    send: () => {},
    service: null,
    spreadProps: setAttrs,
    update(nextContext = {}) {
      currentProps = compactProps({ ...currentProps, ...nextContext });
      if (nextContext.value !== undefined) {
        value = nextContext.value;
        focusedValue = nextContext.value;
      }
      return connect();
    },
    setValue,
  };
}
