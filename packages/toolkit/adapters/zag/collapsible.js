import { connect, machine } from '@zag-js/collapsible';
import { createZagAdapter, mergeProps } from './shared.js';

export function createAosZagCollapsible(context = {}) {
  return createZagAdapter({
    name: 'Collapsible',
    machine,
    connect,
    props: (ctx) => ({
      id: ctx.id,
      ids: ctx.ids,
      getRootNode: ctx.getRootNode,
      open: ctx.open,
      defaultOpen: ctx.defaultOpen,
      disabled: ctx.disabled,
      onOpenChange: ctx.onOpenChange,
      onExitComplete: ctx.onExitComplete,
    }),
    selectors: {
      root: '[data-aos-collapsible-root]',
      trigger: '[data-aos-collapsible-trigger]',
      content: '[data-aos-collapsible-content]',
    },
    snapshot: (api, service) => ({
      api,
      service: service.service,
      open: api.open,
      state: service.service.state.get(),
      send: service.send,
      getRootProps: (extra = {}) => mergeProps(api.getRootProps(), extra),
      getTriggerProps: (extra = {}) => mergeProps(api.getTriggerProps(), extra),
      getContentProps: (extra = {}) => mergeProps(api.getContentProps(), extra),
    }),
    bindings: {
      root: { alias: 'Root', getter: 'getRootProps' },
      trigger: { alias: 'Trigger', getter: 'getTriggerProps' },
      content: { alias: 'Content', getter: 'getContentProps' },
    },
    actions: {
      open: (api) => api.setOpen(true),
      close: (api) => api.setOpen(false),
    },
  }, context);
}
