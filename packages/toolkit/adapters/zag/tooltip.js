import { connect, machine } from '@zag-js/tooltip';
import { createZagAdapter, mergeProps } from './shared.js';

export function createAosZagTooltip(context = {}) {
  return createZagAdapter({
    name: 'Tooltip',
    machine,
    connect,
    props: (ctx) => ({
      id: ctx.id,
      ids: ctx.ids,
      getRootNode: ctx.getRootNode,
      open: ctx.open,
      defaultOpen: ctx.defaultOpen,
      openDelay: ctx.openDelay,
      closeDelay: ctx.closeDelay,
      closeOnPointerDown: ctx.closeOnPointerDown,
      closeOnEscape: ctx.closeOnEscape,
      interactive: ctx.interactive,
      disabled: ctx.disabled,
      positioning: ctx.positioning,
      onOpenChange: ctx.onOpenChange,
    }),
    selectors: {
      trigger: '[data-aos-tooltip-trigger]',
      positioner: '[data-aos-tooltip-positioner]',
      content: '[data-aos-tooltip-content]',
    },
    snapshot: (api, service) => ({
      api,
      service: service.service,
      open: api.open,
      state: service.service.state.get(),
      send: service.send,
      getTriggerProps: (extra = {}) => mergeProps(api.getTriggerProps(), extra),
      getPositionerProps: (extra = {}) => mergeProps(api.getPositionerProps(), extra),
      getContentProps: (extra = {}) => mergeProps(api.getContentProps(), extra),
    }),
    bindings: {
      trigger: { alias: 'Trigger', getter: 'getTriggerProps' },
      positioner: { alias: 'Positioner', getter: 'getPositionerProps' },
      content: { alias: 'Content', getter: 'getContentProps' },
    },
    actions: {
      open: (api) => api.setOpen(true),
      close: (api) => api.setOpen(false),
    },
  }, context);
}
