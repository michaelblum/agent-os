import { connect, machine } from '@zag-js/number-input';
import { createZagAdapter, mergeProps } from './shared.js';

export function createAosZagNumberInput(context = {}) {
  return createZagAdapter({
    name: 'NumberInput',
    machine,
    connect,
    props: (ctx) => ({
      id: ctx.id,
      ids: ctx.ids,
      getRootNode: ctx.getRootNode,
      value: ctx.value,
      defaultValue: ctx.defaultValue,
      min: ctx.min,
      max: ctx.max,
      step: ctx.step,
      largeStep: ctx.largeStep,
      allowMouseWheel: ctx.allowMouseWheel,
      clampValueOnBlur: ctx.clampValueOnBlur,
      focusInputOnChange: ctx.focusInputOnChange,
      formatOptions: ctx.formatOptions,
      locale: ctx.locale,
      name: ctx.name,
      form: ctx.form,
      disabled: ctx.disabled,
      readOnly: ctx.readOnly,
      invalid: ctx.invalid,
      required: ctx.required,
      onValueChange: ctx.onValueChange,
      onFocusChange: ctx.onFocusChange,
    }),
    selectors: {
      root: '[data-aos-number-input-root]',
      label: '[data-aos-number-input-label]',
      input: '[data-aos-number-input-input]',
      incrementTrigger: '[data-aos-number-input-increment-trigger]',
      decrementTrigger: '[data-aos-number-input-decrement-trigger]',
    },
    snapshot: (api, service) => ({
      api,
      service: service.service,
      value: api.value,
      valueAsNumber: api.valueAsNumber,
      focused: api.focused,
      state: service.service.state.get(),
      send: service.send,
      getRootProps: (extra = {}) => mergeProps(api.getRootProps(), extra),
      getLabelProps: (extra = {}) => mergeProps(api.getLabelProps(), extra),
      getInputProps: (extra = {}) => mergeProps(api.getInputProps(), extra),
      getIncrementTriggerProps: (extra = {}) => mergeProps(api.getIncrementTriggerProps(), extra),
      getDecrementTriggerProps: (extra = {}) => mergeProps(api.getDecrementTriggerProps(), extra),

      setValue: api.setValue,
    }),
    bindings: {
      root: { alias: 'Root', getter: 'getRootProps' },
      label: { alias: 'Label', getter: 'getLabelProps' },
      input: { alias: 'Input', getter: 'getInputProps' },
      incrementTrigger: { alias: 'IncrementTrigger', getter: 'getIncrementTriggerProps' },
      decrementTrigger: { alias: 'DecrementTrigger', getter: 'getDecrementTriggerProps' },

    },
    actions: {
      setValue: (api, value) => api.setValue(value),
    },
  }, context);
}
