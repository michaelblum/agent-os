import {
  mergeProps,
} from './vendor/menu-runtime.mjs';
import {
  connect as zagConnect,
  machine as zagComboboxMachine,
} from '@zag-js/combobox';
import {
  applyProps,
  compactProps,
  normalizeProps,
  setDatasetFlag,
  valueForElement,
  VanillaMachine,
} from './shared.js';

const DEFAULT_ITEM_SELECTOR = '[data-value]';

function itemText(element, item, value) {
  return element?.getAttribute?.('aria-label')
    || element?.getAttribute?.('title')
    || element?.textContent?.trim()
    || item?.label
    || item?.name
    || value;
}

export function createAosZagCombobox(context = {}) {
  const {
    id,
    collection,
    getRootNode,
    itemSelector = DEFAULT_ITEM_SELECTOR,
  } = context;

  if (!id) throw new Error('createAosZagCombobox requires an id');
  if (!collection) throw new Error('createAosZagCombobox requires a collection');

  let currentProps = compactProps({
    id,
    collection,
    getRootNode,
    value: context.value,
    inputValue: context.inputValue,
    placeholder: context.placeholder,
    disabled: context.disabled,
    multiple: context.multiple,
    allowCustomValue: context.allowCustomValue,
    open: context.open,
    ids: context.ids,
    name: context.name,
    form: context.form,
    autoFocus: context.autoFocus,
    invalid: context.invalid,
    readOnly: context.readOnly,
    required: context.required,
    closeOnSelect: context.closeOnSelect,
    highlightedValue: context.highlightedValue,
    defaultHighlightedValue: context.defaultHighlightedValue,
    defaultInputValue: context.defaultInputValue,
    defaultOpen: context.defaultOpen,
    defaultValue: context.defaultValue,
    loopFocus: context.loopFocus,
    openOnClick: context.openOnClick,
    openOnKeyPress: context.openOnKeyPress,
    composite: context.composite,
    positioning: context.positioning,
    translations: context.translations,
    scrollToIndexFn: context.scrollToIndexFn,
    onHighlightChange: context.onHighlightChange,
    onInputValueChange: context.onInputValueChange,
    onValueChange: context.onValueChange,
    onOpenChange: context.onOpenChange,
  });

  let currentOnStateChange = context.onStateChange;
  const service = new VanillaMachine(zagComboboxMachine, () => currentProps);
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
    const comboboxApi = api();
    return {
      api: comboboxApi,
      service: service.service,
      open: comboboxApi.open,
      value: comboboxApi.value,
      inputValue: comboboxApi.inputValue,
      highlightedValue: comboboxApi.highlightedValue ?? null,
      highlightedItem: comboboxApi.highlightedItem ?? null,
      selectedItems: comboboxApi.selectedItems,
      state: service.service.state.get(),
      send: service.send,
      getRootProps(extra = {}) {
        return mergeProps(comboboxApi.getRootProps(), extra);
      },
      getInputProps(extra = {}) {
        return mergeProps(comboboxApi.getInputProps(), extra);
      },
      getTriggerProps(extra = {}) {
        return mergeProps(comboboxApi.getTriggerProps(), extra);
      },
      getContentProps(extra = {}) {
        return mergeProps(comboboxApi.getContentProps(), extra);
      },
      getItemProps(item, extra = {}) {
        return mergeProps(comboboxApi.getItemProps({ item }), extra);
      },
      getLabelProps(extra = {}) {
        return mergeProps(comboboxApi.getLabelProps(), extra);
      },
      setOpen: comboboxApi.setOpen,
      setValue: comboboxApi.setValue,
      setInputValue: comboboxApi.setInputValue,
      selectValue: comboboxApi.selectValue,
      clearValue: comboboxApi.clearValue,
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

  function bindRoot(element, extraProps = {}) {
    const cleanup = applyProps(
      element,
      connect().getRootProps(extraProps),
      `${id}:root`
    );
    cleanups.add(cleanup);
    return cleanup;
  }

  function bindInput(element, extraProps = {}) {
    const cleanup = applyProps(
      element,
      connect().getInputProps(extraProps),
      `${id}:input`
    );
    cleanups.add(cleanup);
    return cleanup;
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
    setDatasetFlag(element, 'aosComboboxItem', true);
    const cleanup = applyProps(element, itemProps, `${id}:item:${value}`);
    cleanups.add(() => {
      setDatasetFlag(element, 'aosComboboxItem', false);
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
    bindRoot(options.root || root, options.rootProps || {});
    bindInput(options.input || root?.querySelector?.('[data-aos-combobox-input]') || null, options.inputProps || {});
    bindTrigger(options.trigger || root?.querySelector?.('[data-aos-combobox-trigger]') || null, options.triggerProps || {});
    bindContent(options.content || root?.querySelector?.('[data-aos-combobox-content]') || null, options.contentProps || {});
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
    bindRoot,
    bindInput,
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
