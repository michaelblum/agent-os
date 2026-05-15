import { connect, machine } from '@zag-js/popover';
import { createZagAdapter, mergeProps } from './shared.js';

export function createAosZagPopover(context = {}) {
  return createZagAdapter({
    name: 'Popover',
    machine,
    connect,
    props: (ctx) => ({
      id: ctx.id,
      ids: ctx.ids,
      getRootNode: ctx.getRootNode,
      open: ctx.open,
      defaultOpen: ctx.defaultOpen,
      modal: ctx.modal,
      portalled: ctx.portalled,
      autoFocus: ctx.autoFocus,
      closeOnEscape: ctx.closeOnEscape,
      closeOnInteractOutside: ctx.closeOnInteractOutside,
      positioning: ctx.positioning,
      onOpenChange: ctx.onOpenChange,
      onEscapeKeyDown: ctx.onEscapeKeyDown,
      onInteractOutside: ctx.onInteractOutside,
      onPointerDownOutside: ctx.onPointerDownOutside,
      onFocusOutside: ctx.onFocusOutside,
    }),
    selectors: {
      trigger: '[data-aos-popover-trigger]',
      anchor: '[data-aos-popover-anchor]',
      positioner: '[data-aos-popover-positioner]',
      content: '[data-aos-popover-content]',
      title: '[data-aos-popover-title]',
      description: '[data-aos-popover-description]',
      closeTrigger: '[data-aos-popover-close-trigger]',
    },
    snapshot: (api, service) => ({
      api,
      service: service.service,
      open: api.open,
      state: service.service.state.get(),
      send: service.send,
      getTriggerProps: (extra = {}) => mergeProps(api.getTriggerProps(), extra),
      getAnchorProps: (extra = {}) => mergeProps(api.getAnchorProps(), extra),
      getPositionerProps: (extra = {}) => mergeProps(api.getPositionerProps(), extra),
      getContentProps: (extra = {}) => mergeProps(api.getContentProps(), extra),
      getTitleProps: (extra = {}) => mergeProps(api.getTitleProps(), extra),
      getDescriptionProps: (extra = {}) => mergeProps(api.getDescriptionProps(), extra),
      getCloseTriggerProps: (extra = {}) => mergeProps(api.getCloseTriggerProps(), extra),
    }),
    bindings: {
      trigger: { alias: 'Trigger', getter: 'getTriggerProps' },
      anchor: { alias: 'Anchor', getter: 'getAnchorProps' },
      positioner: { alias: 'Positioner', getter: 'getPositionerProps' },
      content: { alias: 'Content', getter: 'getContentProps' },
      title: { alias: 'Title', getter: 'getTitleProps' },
      description: { alias: 'Description', getter: 'getDescriptionProps' },
      closeTrigger: { alias: 'CloseTrigger', getter: 'getCloseTriggerProps' },

    },
    actions: {
      open: (api) => api.setOpen(true),
      close: (api) => api.setOpen(false),
    },
  }, context);
}
