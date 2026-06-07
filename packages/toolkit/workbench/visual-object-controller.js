import { applyVisualObjectDescriptorMutation } from './visual-object-contract.js';

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function handlerFor(handlers = {}, key = '') {
  return handlers instanceof Map ? handlers.get(key) : handlers?.[key];
}

function invokeHandler(handler, context) {
  if (typeof handler !== 'function') {
    return { status: 'missing' };
  }
  return {
    status: 'called',
    value: handler(context),
  };
}

export function applyVisualObjectControllerUpdate(descriptor = {}, value, state = {}, {
  routeHandlers = {},
  rendererSyncHandlers = {},
  validate = true,
} = {}) {
  const mutation = applyVisualObjectDescriptorMutation(state, descriptor, value, { validate });
  const context = {
    descriptor,
    state,
    mutation,
  };
  const route = text(mutation.route);
  const routeResult = invokeHandler(handlerFor(routeHandlers, route), context);
  const sync = mutation.renderer_sync.map((label) => ({
    label,
    ...invokeHandler(handlerFor(rendererSyncHandlers, label), context),
  }));

  return {
    descriptor_id: mutation.descriptor_id,
    state_path: mutation.state_path,
    route: mutation.route,
    value: mutation.value,
    previous_value: mutation.previous_value,
    route_outcome: {
      route,
      ...routeResult,
    },
    sync_outcomes: sync,
  };
}
