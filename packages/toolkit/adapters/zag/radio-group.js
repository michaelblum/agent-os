import { connect, machine } from '@zag-js/radio-group';
import { createZagAdapter, mergeProps } from './shared.js';

export function createAosZagRadioGroup(context = {}) {
  return createZagAdapter({
    name: 'RadioGroup',
    machine,
    connect,
    props: (ctx) => ({
      id: ctx.id,
      ids: ctx.ids,
      getRootNode: ctx.getRootNode,
      value: ctx.value,
      defaultValue: ctx.defaultValue,
      name: ctx.name,
      form: ctx.form,
      orientation: ctx.orientation,
      dir: ctx.dir,
      disabled: ctx.disabled,
      readOnly: ctx.readOnly,
      invalid: ctx.invalid,
      required: ctx.required,
      onValueChange: ctx.onValueChange,
    }),
    selectors: {
      root: '[data-aos-radio-group-root]',
      label: '[data-aos-radio-group-label]',
      item: '[data-value]',
      radio: '[data-aos-radio-group-radio]',
      radioControl: '[data-aos-radio-group-radio-control]',
    },
    snapshot: (api, service) => ({
      api,
      service: service.service,
      value: api.value,
      state: service.service.state.get(),
      send: service.send,
      getRootProps: (extra = {}) => mergeProps(api.getRootProps(), extra),
      getLabelProps: (extra = {}) => mergeProps(api.getLabelProps(), extra),
      getItemProps: (props, extra = {}) => mergeProps(api.getItemProps(props), extra),
      getRadioProps: (props, extra = {}) => mergeProps(api.getItemProps(props), extra),
      getItemControlProps: (props, extra = {}) => mergeProps(api.getItemControlProps(props), extra),
      getRadioControlProps: (props, extra = {}) => mergeProps(api.getItemControlProps(props), extra),
      setValue: api.setValue,
    }),
    bindings: {
      root: { alias: 'Root', getter: 'getRootProps' },
      label: { alias: 'Label', getter: 'getLabelProps' },
      item: ({ api, element, extraProps, index }) => {
        const value = extraProps.value || element?.dataset?.value || element?.dataset?.id || element?.id || `item-${index}`;
        return { key: value, props: mergeProps(api.getItemProps({ value }), extraProps.extra || {}) };
      },
      radio: ({ api, element, extraProps, index }) => {
        const value = extraProps.value || element?.dataset?.value || element?.dataset?.id || element?.id || `radio-${index}`;
        return { key: value, props: mergeProps(api.getItemProps({ value }), extraProps.extra || {}) };
      },
      radioControl: ({ api, element, extraProps, index }) => {
        const value = extraProps.value || element?.dataset?.value || element?.dataset?.id || element?.id || `radioControl-${index}`;
        return { key: value, props: mergeProps(api.getItemControlProps({ value }), extraProps.extra || {}) };
      },
    },
    actions: {
      setValue: (api, value) => api.setValue(value),
    },
  }, context);
}
