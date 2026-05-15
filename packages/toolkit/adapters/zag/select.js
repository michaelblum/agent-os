import {
  VanillaMachine,
  mergeProps,
  normalizeProps,
  spreadProps as zagSpreadProps,
} from './vendor/menu-runtime.mjs';
import {
  connect as zagConnect,
  machine as zagSelectMachine,
} from '@zag-js/select';

const DEFAULT_ITEM_SELECTOR = '[data-value]';

function compactProps(props = {}) {
  return Object.fromEntries(
    Object.entries(props).filter(([, value]) => value !== undefined)
  );
}

function valueForElement(element, index = 0) {
  return element?.dataset?.value
    || element?.getAttribute?.('data-value')
    || element?.value
    || element?.id
    || `item-${index}`;
}

function itemText(element, item, value) {
  return element?.getAttribute?.('aria-label')
    || element?.getAttribute?.('title')
    || element?.textContent?.trim()
    || item?.label
    || item?.name
    || value;
}

function setDatasetFlag(element, name, enabled) {
  if (!element?.dataset) return;
  if (enabled) element.dataset[name] = '';
  else delete element.dataset[name];
}

function applyProps(element, props, machineId) {
  if (!element) return () => {};
  return zagSpreadProps(element, props, machineId);
}

export function createAosZagSelect(context = {}) {
  const {
    id,
    collection,
    getRootNode,
    itemSelector = DEFAULT_ITEM_SELECTOR,
  } = context;

  if (!id) throw new Error('createAosZagSelect requires an id');
  if (!collection) throw new Error('createAosZagSelect requires a collection');

  let currentProps = {
    id,
    collection,
    getRootNode,
    value: context.value,
    placeholder: context.placeholder,
    disabled: context.disabled,
    multiple: context.multiple,
    open: context.open,
    ids: context.ids,
    name: context.name,
    form: context.form,
    autoComplete: context.autoComplete,
    invalid: context.invalid,
    readOnly: context.readOnly,
    required: context.required,
    closeOnSelect: context.closeOnSelect,
    highlightedValue: context.highlightedValue,
    defaultHighlightedValue: context.defaultHighlightedValue,
    defaultOpen: context.defaultOpen,
    defaultValue: context.defaultValue,
    loopFocus: context.loopFocus,
    composite: context.composite,
    deselectable: context.deselectable,
    positioning: context.positioning,
    translations: context.translations,
    scrollToIndexFn: context.scrollToIndexFn,
    onSelect: context.onSelect,
    onHighlightChange: context.onHighlightChange,
    onValueChange: context.onValueChange,
    onOpenChange: context.onOpenChange,
  };
  currentProps = compactProps(currentProps);

  let currentOnStateChange = context.onStateChange;
  const service = new VanillaMachine(zagSelectMachine, () => currentProps);
  const cleanups = new Set();

  function api() {
    return zagConnect(service.service, normalizeProps);
  }

  function notify() {
    currentOnStateChange?.(connect());
  }

  service.start();
  const unsubscribe = service.subscribe(notify);

  function connect() {
    const selectApi = api();
    return {
      api: selectApi,
      service: service.service,
      open: selectApi.open,
      value: selectApi.value,
      selectedItems: selectApi.selectedItems,
      highlightedValue: selectApi.highlightedValue ?? null,
      highlightedItem: selectApi.highlightedItem ?? null,
      state: service.service.state.get(),
      send: service.send,
      getTriggerProps(extra = {}) {
        return mergeProps(selectApi.getTriggerProps(), extra);
      },
      getContentProps(extra = {}) {
        return mergeProps(selectApi.getContentProps(), extra);
      },
      getItemProps(item, extra = {}) {
        return mergeProps(selectApi.getItemProps({ item }), extra);
      },
      getLabelProps(extra = {}) {
        return mergeProps(selectApi.getLabelProps(), extra);
      },
      setOpen: selectApi.setOpen,
      setValue: selectApi.setValue,
      selectValue: selectApi.selectValue,
      clearValue: selectApi.clearValue,
    };
  }

  function update(nextContext = {}) {
    currentOnStateChange = nextContext.onStateChange ?? currentOnStateChange;
    currentProps = compactProps({
      ...currentProps,
      ...nextContext,
      positioning: nextContext.positioning
        ? {
            ...(currentProps.positioning || {}),
            ...nextContext.positioning,
          }
        : currentProps.positioning,
    });
    delete currentProps.itemSelector;
    delete currentProps.onStateChange;
    service.updateProps(() => currentProps);
    return connect();
  }

  function cleanupBindings() {
    for (const cleanup of cleanups) cleanup();
    cleanups.clear();
  }

  function bindTrigger(element, extraProps = {}) {
    const cleanup = applyProps(
      element,
      connect().getTriggerProps(extraProps),
      `${id}:trigger`
    );
    cleanups.add(cleanup);
    return cleanup;
  }

  function bindContent(element, extraProps = {}) {
    const cleanup = applyProps(
      element,
      connect().getContentProps(extraProps),
      `${id}:content`
    );
    cleanups.add(cleanup);
    return cleanup;
  }

  function bindItem(element, props = {}, index = 0) {
    const value = props.value || valueForElement(element, index);
    const item = props.item || currentProps.collection.find(value) || {
      value,
      label: props.valueText || itemText(element, null, value),
      disabled: props.disabled ?? element?.disabled,
    };
    const itemProps = connect().getItemProps(item, props.extra || {});
    setDatasetFlag(element, 'aosSelectItem', true);
    const cleanup = applyProps(element, itemProps, `${id}:item:${value}`);
    cleanups.add(() => {
      setDatasetFlag(element, 'aosSelectItem', false);
      cleanup();
    });
    return cleanup;
  }

  function bindItems(root, selector = itemSelector, getProps = null) {
    const elements = Array.from(root?.querySelectorAll?.(selector) || []);
    elements.forEach((element, index) => bindItem(element, getProps?.(element, index) || {}, index));
    return elements.length;
  }

  function bind(root, options = {}) {
    cleanupBindings();
    bindTrigger(options.trigger || root?.querySelector?.('[data-aos-select-trigger]') || null, options.triggerProps || {});
    bindContent(options.content || root?.querySelector?.('[data-aos-select-content]') || root, options.contentProps || {});
    bindItems(root, options.itemSelector || itemSelector, options.getItemProps || null);
    return connect();
  }

  function open() {
    connect().api.setOpen(true);
    return connect();
  }

  function close() {
    connect().api.setOpen(false);
    return connect();
  }

  function destroy() {
    cleanupBindings();
    unsubscribe?.();
    service.stop();
  }

  return {
    bind,
    bindTrigger,
    bindContent,
    bindItem,
    bindItems,
    cleanupBindings,
    close,
    connect,
    destroy,
    open,
    send: service.send,
    service: service.service,
    spreadProps: applyProps,
    update,
  };
}

export { mergeProps, normalizeProps };
