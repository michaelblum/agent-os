import { connect, machine } from '@zag-js/slider';
import { createZagAdapter, mergeProps } from './shared.js';

export function createAosZagSlider(context = {}) {
  return createZagAdapter({
    name: 'Slider',
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
      minStepsBetweenThumbs: ctx.minStepsBetweenThumbs,
      orientation: ctx.orientation,
      dir: ctx.dir,
      disabled: ctx.disabled,
      readOnly: ctx.readOnly,
      invalid: ctx.invalid,
      name: ctx.name,
      form: ctx.form,
      getAriaValueText: ctx.getAriaValueText,
      onValueChange: ctx.onValueChange,
      onValueChangeEnd: ctx.onValueChangeEnd,
    }),
    selectors: {
      root: '[data-aos-slider-root]',
      label: '[data-aos-slider-label]',
      control: '[data-aos-slider-control]',
      track: '[data-aos-slider-track]',
      range: '[data-aos-slider-range]',
      output: '[data-aos-slider-output]',
      thumb: '[data-index]',
    },
    snapshot: (api, service) => ({
      api,
      service: service.service,
      value: api.value,
      focused: api.focused,
      state: service.service.state.get(),
      send: service.send,
      getRootProps: (extra = {}) => mergeProps(api.getRootProps(), extra),
      getLabelProps: (extra = {}) => mergeProps(api.getLabelProps(), extra),
      getControlProps: (extra = {}) => mergeProps(api.getControlProps(), extra),
      getTrackProps: (extra = {}) => mergeProps(api.getTrackProps(), extra),
      getRangeProps: (extra = {}) => mergeProps(api.getRangeProps(), extra),
      getValueTextProps: (extra = {}) => mergeProps(api.getValueTextProps(), extra),
      getOutputProps: (extra = {}) => mergeProps(api.getValueTextProps(), extra),
      getThumbProps: (props, extra = {}) => mergeProps(api.getThumbProps(props), extra),
      setValue: api.setValue,
    }),
    bindings: {
      root: { alias: 'Root', getter: 'getRootProps' },
      label: { alias: 'Label', getter: 'getLabelProps' },
      control: { alias: 'Control', getter: 'getControlProps' },
      track: { alias: 'Track', getter: 'getTrackProps' },
      range: { alias: 'Range', getter: 'getRangeProps' },
      output: { alias: 'Output', getter: 'getValueTextProps' },
      thumb: ({ api, element, extraProps, index }) => {
        const value = extraProps.value || element?.dataset?.value || element?.dataset?.id || element?.id || `thumb-${index}`;
        return { key: value, props: mergeProps(api.getThumbProps({ index }), extraProps.extra || {}) };
      },
    },
    actions: {
      setValue: (api, value) => api.setValue(value),
    },
  }, context);
}
