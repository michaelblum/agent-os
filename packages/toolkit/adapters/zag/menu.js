import {
  connect as zagConnect,
  machine as zagMenuMachine,
  mergeProps,
} from './vendor/menu-runtime.mjs';
import {
  createZagAdapter,
  normalizeProps,
  setDatasetFlag,
  valueForElement,
} from './shared.js';

const DEFAULT_ITEM_SELECTOR = '[data-value],[data-aos-menu-item]';

function buttonText(element, value) {
  return element?.getAttribute?.('aria-label')
    || element?.getAttribute?.('title')
    || element?.textContent?.trim()
    || value;
}

export function createAosZagMenu(context = {}) {
  const menuContext = { id: 'aos-menu', ...context };
  const itemSelector = menuContext.itemSelector || DEFAULT_ITEM_SELECTOR;
  const getItemValue = menuContext.getItemValue || valueForElement;
  const getItemText = menuContext.getItemText || buttonText;

  return createZagAdapter({
    name: 'Menu',
    machine: zagMenuMachine,
    connect: zagConnect,
    props(currentContext) {
      return {
        id: currentContext.id,
        ids: currentContext.ids,
        getRootNode: currentContext.getRootNode,
        composite: currentContext.composite ?? true,
        loopFocus: currentContext.loopFocus ?? true,
        typeahead: currentContext.typeahead ?? true,
        closeOnSelect: currentContext.closeOnSelect ?? false,
        onOpenChange: currentContext.onOpenChange,
        onHighlightChange: currentContext.onHighlightChange,
        onSelect: currentContext.onSelect,
        positioning: {
          strategy: 'fixed',
          placement: 'bottom-start',
          gutter: 0,
          ...(currentContext.positioning || {}),
        },
      };
    },
    selectors: {
      trigger: '[data-aos-menu-trigger]',
      content: null,
      item: itemSelector,
    },
    transientProps: ['itemSelector', 'getItemValue', 'getItemText'],
    snapshot(menuApi, service) {
      return {
      api: menuApi,
      service: service.service,
      open: menuApi.open,
      highlightedValue: menuApi.highlightedValue ?? null,
      state: service.service.state.get(),
      send: service.send,
      getContentProps(extra = {}) {
        return mergeProps(menuApi.getContentProps(), extra);
      },
      getTriggerProps(extra = {}) {
        return mergeProps(menuApi.getTriggerProps(), extra);
      },
      getItemProps(props = {}) {
        return menuApi.getItemProps(props);
      },
      setOpen: menuApi.setOpen,
      setHighlightedValue: menuApi.setHighlightedValue,
      };
    },
    bindings: {
      trigger: {
        alias: 'Trigger',
        getter: 'getTriggerProps',
      },
      content: {
        alias: 'Content',
        root: true,
        getter: 'getContentProps',
      },
      item({ api, currentProps, element, extraProps, index }) {
        const value = extraProps.value || getItemValue(element, index);
        const itemProps = api.getItemProps({
          closeOnSelect: currentProps.closeOnSelect,
          value,
          valueText: extraProps.valueText || getItemText(element, value, index),
          disabled: extraProps.disabled ?? element?.disabled,
        });
        setDatasetFlag(element, 'aosZagMenuItem', true);
        return {
          key: value,
          props: mergeProps(itemProps, extraProps.extra || {}),
          cleanup() {
            setDatasetFlag(element, 'aosZagMenuItem', false);
          },
        };
      },
    },
    actions: {
      open(api, details = {}) {
        api.setOpen(true);
        if (details.value) api.setHighlightedValue?.(details.value);
      },
      close(api, details = {}) {
        api.setOpen(false);
        if (details.restoreFocus) return;
      },
    },
  }, menuContext);
}

export { mergeProps, normalizeProps };
