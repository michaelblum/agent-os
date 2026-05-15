import { connect, machine } from '@zag-js/editable';
import { createZagAdapter, mergeProps } from './shared.js';

export function createAosZagEditable(context = {}) {
  return createZagAdapter({
    name: 'Editable',
    machine,
    connect,
    props: (ctx) => ({
      id: ctx.id,
      ids: ctx.ids,
      getRootNode: ctx.getRootNode,
      value: ctx.value,
      defaultValue: ctx.defaultValue,
      placeholder: ctx.placeholder,
      activationMode: ctx.activationMode,
      autoResize: ctx.autoResize,
      disabled: ctx.disabled,
      readOnly: ctx.readOnly,
      invalid: ctx.invalid,
      maxLength: ctx.maxLength,
      name: ctx.name,
      form: ctx.form,
      selectOnFocus: ctx.selectOnFocus,
      submitMode: ctx.submitMode,
      translations: ctx.translations,
      onValueChange: ctx.onValueChange,
      onValueCommit: ctx.onValueCommit,
      onValueRevert: ctx.onValueRevert,
      onEditChange: ctx.onEditChange,
    }),
    selectors: {
      root: '[data-aos-editable-root]',
      preview: '[data-aos-editable-preview]',
      input: '[data-aos-editable-input]',
      editTrigger: '[data-aos-editable-edit-trigger]',
      submitTrigger: '[data-aos-editable-submit-trigger]',
      cancelTrigger: '[data-aos-editable-cancel-trigger]',
    },
    snapshot: (api, service) => ({
      api,
      service: service.service,
      value: api.value,
      editing: api.editing,
      state: service.service.state.get(),
      send: service.send,
      getRootProps: (extra = {}) => mergeProps(api.getRootProps(), extra),
      getPreviewProps: (extra = {}) => mergeProps(api.getPreviewProps(), extra),
      getInputProps: (extra = {}) => mergeProps(api.getInputProps(), extra),
      getEditTriggerProps: (extra = {}) => mergeProps(api.getEditTriggerProps(), extra),
      getSubmitTriggerProps: (extra = {}) => mergeProps(api.getSubmitTriggerProps(), extra),
      getCancelTriggerProps: (extra = {}) => mergeProps(api.getCancelTriggerProps(), extra),
      setValue: api.setValue,
    }),
    bindings: {
      root: { alias: 'Root', getter: 'getRootProps' },
      preview: { alias: 'Preview', getter: 'getPreviewProps' },
      input: { alias: 'Input', getter: 'getInputProps' },
      editTrigger: { alias: 'EditTrigger', getter: 'getEditTriggerProps' },
      submitTrigger: { alias: 'SubmitTrigger', getter: 'getSubmitTriggerProps' },
      cancelTrigger: { alias: 'CancelTrigger', getter: 'getCancelTriggerProps' },

    },
    actions: {
      setValue: (api, value) => api.setValue(value),
    },
  }, context);
}
