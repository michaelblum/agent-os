import { connect, machine } from '@zag-js/switch';
import { createZagAdapter, mergeProps } from './shared.js';

export function createAosZagSwitch(context = {}) {
  return createZagAdapter({
    name: 'Switch',
    machine,
    connect,
    props: (ctx) => ({
      id: ctx.id,
      ids: ctx.ids,
      getRootNode: ctx.getRootNode,
      checked: ctx.checked,
      defaultChecked: ctx.defaultChecked,
      name: ctx.name,
      form: ctx.form,
      value: ctx.value,
      disabled: ctx.disabled,
      readOnly: ctx.readOnly,
      invalid: ctx.invalid,
      required: ctx.required,
      onCheckedChange: ctx.onCheckedChange,
    }),
    selectors: {
      root: '[data-aos-switch-root]',
      label: '[data-aos-switch-label]',
      control: '[data-aos-switch-control]',
      thumb: '[data-aos-switch-thumb]',
      hiddenInput: '[data-aos-switch-hidden-input]',
    },
    snapshot: (api, service) => ({
      api,
      service: service.service,
      checked: api.checked,
      focused: api.focused,
      state: service.service.state.get(),
      send: service.send,
      getRootProps: (extra = {}) => mergeProps(api.getRootProps(), extra),
      getLabelProps: (extra = {}) => mergeProps(api.getLabelProps(), extra),
      getControlProps: (extra = {}) => mergeProps(api.getControlProps(), extra),
      getThumbProps: (extra = {}) => mergeProps(api.getThumbProps(), extra),
      getHiddenInputProps: (extra = {}) => mergeProps(api.getHiddenInputProps(), extra),
      setChecked: api.setChecked,
    }),
    bindings: {
      root: { alias: 'Root', getter: 'getRootProps' },
      label: { alias: 'Label', getter: 'getLabelProps' },
      control: { alias: 'Control', getter: 'getControlProps' },
      thumb: { alias: 'Thumb', getter: 'getThumbProps' },
      hiddenInput: { alias: 'HiddenInput', getter: 'getHiddenInputProps' },

    },
    actions: {
      setChecked: (api, checked) => api.setChecked(checked),
    },
  }, context);
}
