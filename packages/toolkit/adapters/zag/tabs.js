import { connect, machine } from '@zag-js/tabs';
import { createZagAdapter, mergeProps } from './shared.js';

export function createAosZagTabs(context = {}) {
  return createZagAdapter({
    name: 'Tabs',
    machine,
    connect,
    props: (ctx) => ({
      id: ctx.id,
      ids: ctx.ids,
      getRootNode: ctx.getRootNode,
      value: ctx.value,
      defaultValue: ctx.defaultValue,
      activationMode: ctx.activationMode,
      loopFocus: ctx.loopFocus,
      orientation: ctx.orientation,
      dir: ctx.dir,
      composite: ctx.composite,
      deselectable: ctx.deselectable,
      navigate: ctx.navigate,
      onValueChange: ctx.onValueChange,
      onFocusChange: ctx.onFocusChange,
    }),
    selectors: {
      root: '[data-aos-tabs-root]',
      list: '[data-aos-tabs-list]',
      trigger: '[data-value]',
      content: '[data-aos-tabs-content]',
    },
    snapshot: (api, service) => ({
      api,
      service: service.service,
      value: api.value,
      focusedValue: api.focusedValue,
      state: service.service.state.get(),
      send: service.send,
      getRootProps: (extra = {}) => mergeProps(api.getRootProps(), extra),
      getListProps: (extra = {}) => mergeProps(api.getListProps(), extra),
      getTriggerProps: (props, extra = {}) => mergeProps(api.getTriggerProps(props), extra),
      getContentProps: (props, extra = {}) => mergeProps(api.getContentProps(props), extra),
      setValue: api.setValue,
    }),
    bindings: {
      root: { alias: 'Root', getter: 'getRootProps' },
      list: { alias: 'List', getter: 'getListProps' },
      trigger: ({ api, element, extraProps, index }) => {
        const value = extraProps.value || element?.dataset?.value || element?.dataset?.id || element?.id || `trigger-${index}`;
        return { key: value, props: mergeProps(api.getTriggerProps({ value }), extraProps.extra || {}) };
      },
      content: ({ api, element, extraProps, index }) => {
        const value = extraProps.value || element?.dataset?.value || element?.dataset?.id || element?.id || `content-${index}`;
        return { key: value, props: mergeProps(api.getContentProps({ value }), extraProps.extra || {}) };
      },
    },
    actions: {
      setValue: (api, value) => api.setValue(value),
    },
  }, context);
}
