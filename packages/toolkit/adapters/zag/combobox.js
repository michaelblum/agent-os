import {
  mergeProps,
} from './vendor/menu-runtime.mjs';
import {
  connect as zagConnect,
  machine as zagComboboxMachine,
} from '@zag-js/combobox';
import {
  createZagAdapter,
  normalizeProps,
  setDatasetFlag,
  valueForElement,
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
  const itemSelector = context.itemSelector || DEFAULT_ITEM_SELECTOR;

  return createZagAdapter({
    name: 'Combobox',
    machine: zagComboboxMachine,
    connect: zagConnect,
    props(currentContext) {
      return {
        id: currentContext.id,
        collection: currentContext.collection,
        getRootNode: currentContext.getRootNode,
        value: currentContext.value,
        inputValue: currentContext.inputValue,
        placeholder: currentContext.placeholder,
        disabled: currentContext.disabled,
        multiple: currentContext.multiple,
        allowCustomValue: currentContext.allowCustomValue,
        open: currentContext.open,
        ids: currentContext.ids,
        name: currentContext.name,
        form: currentContext.form,
        autoFocus: currentContext.autoFocus,
        invalid: currentContext.invalid,
        readOnly: currentContext.readOnly,
        required: currentContext.required,
        closeOnSelect: currentContext.closeOnSelect,
        highlightedValue: currentContext.highlightedValue,
        defaultHighlightedValue: currentContext.defaultHighlightedValue,
        defaultInputValue: currentContext.defaultInputValue,
        defaultOpen: currentContext.defaultOpen,
        defaultValue: currentContext.defaultValue,
        loopFocus: currentContext.loopFocus,
        openOnClick: currentContext.openOnClick,
        openOnKeyPress: currentContext.openOnKeyPress,
        composite: currentContext.composite,
        positioning: currentContext.positioning,
        translations: currentContext.translations,
        scrollToIndexFn: currentContext.scrollToIndexFn,
        onHighlightChange: currentContext.onHighlightChange,
        onInputValueChange: currentContext.onInputValueChange,
        onValueChange: currentContext.onValueChange,
        onOpenChange: currentContext.onOpenChange,
      };
    },
    validate(currentContext) {
      if (!currentContext.collection) throw new Error('createAosZagCombobox requires a collection');
    },
    selectors: {
      root: null,
      input: '[data-aos-combobox-input]',
      trigger: '[data-aos-combobox-trigger]',
      content: '[data-aos-combobox-content]',
      item: itemSelector,
    },
    transientProps: ['itemSelector'],
    snapshot(comboboxApi, service) {
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
    },
    bindings: {
      root: {
        root: true,
        getter: 'getRootProps',
      },
      input: {
        getter: 'getInputProps',
      },
      trigger: {
        getter: 'getTriggerProps',
      },
      content: {
        getter: 'getContentProps',
      },
      item({ api, currentProps, element, extraProps, index }) {
        const value = extraProps.value || valueForElement(element, index);
        const item = extraProps.item || currentProps.collection.find(value) || {
          value,
          label: extraProps.valueText || itemText(element, null, value),
          disabled: extraProps.disabled ?? element?.disabled,
        };
        setDatasetFlag(element, 'aosComboboxItem', true);
        return {
          key: value,
          props: mergeProps(api.getItemProps({ item }), extraProps.extra || {}),
          cleanup() {
            setDatasetFlag(element, 'aosComboboxItem', false);
          },
        };
      },
    },
    actions: {
      open(api) {
        api.setOpen(true);
      },
      close(api) {
        api.setOpen(false);
      },
    },
  }, context);
}

export { mergeProps, normalizeProps };
