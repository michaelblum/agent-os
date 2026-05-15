import { connect, machine } from '@zag-js/accordion';
import { createZagAdapter, mergeProps } from './shared.js';

export function createAosZagAccordion(context = {}) {
  return createZagAdapter({
    name: 'Accordion',
    machine,
    connect,
    props: (ctx) => ({
      id: ctx.id,
      ids: ctx.ids,
      getRootNode: ctx.getRootNode,
      value: ctx.value,
      defaultValue: ctx.defaultValue,
      multiple: ctx.multiple,
      collapsible: ctx.collapsible,
      orientation: ctx.orientation,
      dir: ctx.dir,
      onValueChange: ctx.onValueChange,
      onFocusChange: ctx.onFocusChange,
    }),
    selectors: {
      root: '[data-aos-accordion-root]',
      item: '[data-value]',
      itemTrigger: '[data-aos-accordion-item-trigger]',
      itemContent: '[data-aos-accordion-item-content]',
    },
    snapshot: (api, service) => ({
      api,
      service: service.service,
      value: api.value,
      focusedValue: api.focusedValue,
      state: service.service.state.get(),
      send: service.send,
      getRootProps: (extra = {}) => mergeProps(api.getRootProps(), extra),
      getItemProps: (props, extra = {}) => mergeProps(api.getItemProps(props), extra),
      getItemTriggerProps: (props, extra = {}) => mergeProps(api.getItemTriggerProps(props), extra),
      getItemContentProps: (props, extra = {}) => mergeProps(api.getItemContentProps(props), extra),
      setValue: api.setValue,
    }),
    bindings: {
      root: { alias: 'Root', getter: 'getRootProps' },
      item: ({ api, element, extraProps, index }) => {
        const value = extraProps.value || element?.dataset?.value || element?.dataset?.id || element?.id || `item-${index}`;
        return { key: value, props: mergeProps(api.getItemProps({ value }), extraProps.extra || {}) };
      },
      itemTrigger: ({ api, element, extraProps, index }) => {
        const value = extraProps.value || element?.dataset?.value || element?.dataset?.id || element?.id || `itemTrigger-${index}`;
        return { key: value, props: mergeProps(api.getItemTriggerProps({ value }), extraProps.extra || {}) };
      },
      itemContent: ({ api, element, extraProps, index }) => {
        const value = extraProps.value || element?.dataset?.value || element?.dataset?.id || element?.id || `itemContent-${index}`;
        return { key: value, props: mergeProps(api.getItemContentProps({ value }), extraProps.extra || {}) };
      },
    },
    actions: {
      setValue: (api, value) => api.setValue(value),
    },
  }, context);
}
