import { connect, machine } from '@zag-js/tags-input';
import { createZagAdapter, mergeProps } from './shared.js';

export function createAosZagTagsInput(context = {}) {
  return createZagAdapter({
    name: 'TagsInput',
    machine,
    connect,
    props: (ctx) => ({
      id: ctx.id,
      ids: ctx.ids,
      getRootNode: ctx.getRootNode,
      value: ctx.value,
      defaultValue: ctx.defaultValue,
      inputValue: ctx.inputValue,
      defaultInputValue: ctx.defaultInputValue,
      name: ctx.name,
      form: ctx.form,
      disabled: ctx.disabled,
      readOnly: ctx.readOnly,
      invalid: ctx.invalid,
      required: ctx.required,
      max: ctx.max,
      maxLength: ctx.maxLength,
      delimiter: ctx.delimiter,
      addOnPaste: ctx.addOnPaste,
      allowEditTag: ctx.allowEditTag,
      blurBehavior: ctx.blurBehavior,
      editable: ctx.editable,
      translations: ctx.translations,
      validate: ctx.validate,
      onValueChange: ctx.onValueChange,
      onInputValueChange: ctx.onInputValueChange,
      onValueInvalid: ctx.onValueInvalid,
      onHighlightChange: ctx.onHighlightChange,
    }),
    selectors: {
      root: '[data-aos-tags-input-root]',
      label: '[data-aos-tags-input-label]',
      control: '[data-aos-tags-input-control]',
      input: '[data-aos-tags-input-input]',
      item: '[data-value]',
    },
    snapshot: (api, service) => ({
      api,
      service: service.service,
      value: api.value,
      state: service.service.state.get(),
      send: service.send,
      getRootProps: (extra = {}) => mergeProps(api.getRootProps(), extra),
      getLabelProps: (extra = {}) => mergeProps(api.getLabelProps(), extra),
      getControlProps: (extra = {}) => mergeProps(api.getControlProps(), extra),
      getInputProps: (extra = {}) => mergeProps(api.getInputProps(), extra),      getItemProps: (props, extra = {}) => mergeProps(api.getItemProps(props), extra),
      setValue: api.setValue, setInputValue: api.setInputValue,
    }),
    bindings: {
      root: { alias: 'Root', getter: 'getRootProps' },
      label: { alias: 'Label', getter: 'getLabelProps' },
      control: { alias: 'Control', getter: 'getControlProps' },
      input: { alias: 'Input', getter: 'getInputProps' },
      item: ({ api, element, extraProps, index }) => {
        const value = extraProps.value || element?.dataset?.value || element?.dataset?.id || element?.id || `item-${index}`;
        return { key: value, props: mergeProps(api.getItemProps({ index, value }), extraProps.extra || {}) };
      },
    },
    actions: {
      setValue: (api, value) => api.setValue(value),
      setInputValue: (api, value) => api.setInputValue(value),
    },
  }, context);
}
