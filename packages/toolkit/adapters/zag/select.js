import {
  mergeProps,
} from './vendor/menu-runtime.mjs';
import {
  connect as zagConnect,
  machine as zagSelectMachine,
} from '@zag-js/select';
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

export function createAosZagSelect(context = {}) {
  const itemSelector = context.itemSelector || DEFAULT_ITEM_SELECTOR;

  return createZagAdapter({
    name: 'Select',
    machine: zagSelectMachine,
    connect: zagConnect,
    props(currentContext) {
      return {
        id: currentContext.id,
        collection: currentContext.collection,
        getRootNode: currentContext.getRootNode,
        value: currentContext.value,
        placeholder: currentContext.placeholder,
        disabled: currentContext.disabled,
        multiple: currentContext.multiple,
        open: currentContext.open,
        ids: currentContext.ids,
        name: currentContext.name,
        form: currentContext.form,
        autoComplete: currentContext.autoComplete,
        invalid: currentContext.invalid,
        readOnly: currentContext.readOnly,
        required: currentContext.required,
        closeOnSelect: currentContext.closeOnSelect,
        highlightedValue: currentContext.highlightedValue,
        defaultHighlightedValue: currentContext.defaultHighlightedValue,
        defaultOpen: currentContext.defaultOpen,
        defaultValue: currentContext.defaultValue,
        loopFocus: currentContext.loopFocus,
        composite: currentContext.composite,
        deselectable: currentContext.deselectable,
        positioning: currentContext.positioning,
        translations: currentContext.translations,
        scrollToIndexFn: currentContext.scrollToIndexFn,
        onSelect: currentContext.onSelect,
        onHighlightChange: currentContext.onHighlightChange,
        onValueChange: currentContext.onValueChange,
        onOpenChange: currentContext.onOpenChange,
      };
    },
    validate(currentContext) {
      if (!currentContext.collection) throw new Error('createAosZagSelect requires a collection');
    },
    selectors: {
      trigger: '[data-aos-select-trigger]',
      content: '[data-aos-select-content]',
      item: itemSelector,
    },
    transientProps: ['itemSelector'],
    snapshot(selectApi, service) {
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
    },
    bindings: {
      trigger: {
        getter: 'getTriggerProps',
      },
      content: {
        root: true,
        getter: 'getContentProps',
      },
      item({ api, currentProps, element, extraProps, index }) {
        const value = extraProps.value || valueForElement(element, index);
        const item = extraProps.item || currentProps.collection.find(value) || {
          value,
          label: extraProps.valueText || itemText(element, null, value),
          disabled: extraProps.disabled ?? element?.disabled,
        };
        setDatasetFlag(element, 'aosSelectItem', true);
        return {
          key: value,
          props: mergeProps(api.getItemProps({ item }), extraProps.extra || {}),
          cleanup() {
            setDatasetFlag(element, 'aosSelectItem', false);
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
