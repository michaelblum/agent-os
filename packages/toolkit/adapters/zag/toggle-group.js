import { connect, machine } from '@zag-js/toggle-group';
import { createZagAdapter, mergeProps } from './shared.js';

export function createAosZagToggleGroup(context = {}) {
  return createZagAdapter({
    name: 'ToggleGroup',
    machine,
    connect,
    props: (ctx) => ({
      id: ctx.id,
      ids: ctx.ids,
      getRootNode: ctx.getRootNode,
      value: ctx.value,
      defaultValue: ctx.defaultValue,
      multiple: ctx.multiple,
      orientation: ctx.orientation,
      dir: ctx.dir,
      loopFocus: ctx.loopFocus,
      disabled: ctx.disabled,
      rovingFocus: ctx.rovingFocus,
      onValueChange: ctx.onValueChange,
    }),
    selectors: {
      root: '[data-aos-toggle-group-root]',
      item: '[data-aos-toggle-group-item]',
    },
    snapshot: (api, service) => ({
      api,
      service: service.service,
      value: api.value,
      state: service.service.state.get(),
      send: service.send,
      getRootProps: (extra = {}) => mergeProps(api.getRootProps(), extra),
      getItemProps: (props, extra = {}) => mergeProps(api.getItemProps(props), extra),
      setValue: api.setValue,
    }),
    bindings: {
      root: { alias: 'Root', getter: 'getRootProps' },
      item: ({ api, element, extraProps, index }) => {
        const value = extraProps.value || element?.dataset?.value || element?.dataset?.id || element?.id || `item-${index}`;
        return { key: value, props: mergeProps(api.getItemProps({ value }), extraProps.extra || {}) };
      },
    },
    actions: {
      setValue: (api, value) => api.setValue(value),
    },
  }, context);
}
