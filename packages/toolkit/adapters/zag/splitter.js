import { connect, machine } from '@zag-js/splitter';
import { createZagAdapter, mergeProps } from './shared.js';

export function createAosZagSplitter(context = {}) {
  return createZagAdapter({
    name: 'Splitter',
    machine,
    connect,
    props: (ctx) => ({
      id: ctx.id,
      ids: ctx.ids,
      getRootNode: ctx.getRootNode,
      panels: ctx.panels,
      orientation: ctx.orientation,
      dir: ctx.dir,
      size: ctx.size,
      defaultSize: ctx.defaultSize,
      onSizeChange: ctx.onSizeChange,
      onSizeChangeEnd: ctx.onSizeChangeEnd,
    }),
    selectors: {
      root: '[data-aos-splitter-root]',
      panel: '[data-aos-splitter-panel]',
      resizeTrigger: '[data-aos-splitter-resize-trigger]',
    },
    snapshot: (api, service) => ({
      api,
      service: service.service,
      panels: api.panels,
      state: service.service.state.get(),
      send: service.send,
      getRootProps: (extra = {}) => mergeProps(api.getRootProps(), extra),
      getPanelProps: (props, extra = {}) => mergeProps(api.getPanelProps(props), extra),
      getResizeTriggerProps: (props, extra = {}) => mergeProps(api.getResizeTriggerProps(props), extra),
      getSizes: api.getSizes,
      setSizes: api.setSizes,
    }),
    bindings: {
      root: { alias: 'Root', getter: 'getRootProps' },
      panel: ({ api, element, extraProps, index }) => {
        const value = extraProps.value || element?.dataset?.value || element?.dataset?.id || element?.id || `panel-${index}`;
        return { key: value, props: mergeProps(api.getPanelProps({ id: value }), extraProps.extra || {}) };
      },
      resizeTrigger: ({ api, element, extraProps, index }) => {
        const value = extraProps.value || element?.dataset?.value || element?.dataset?.id || element?.id || 'a:b';
        return { key: value, props: mergeProps(api.getResizeTriggerProps({ id: value }), extraProps.extra || {}) };
      },
    },
    actions: {

    },
  }, context);
}
