import {
  VanillaMachine,
  mergeProps,
  normalizeProps,
  spreadProps as zagSpreadProps,
} from './vendor/menu-runtime.mjs';

export function compactProps(props = {}) {
  return Object.fromEntries(
    Object.entries(props).filter(([, value]) => value !== undefined)
  );
}

export function setDatasetFlag(element, name, enabled) {
  if (!element?.dataset) return;
  if (enabled) element.dataset[name] = '';
  else delete element.dataset[name];
}

export function valueForElement(element, index = 0) {
  return element?.dataset?.value
    || element?.getAttribute?.('data-value')
    || element?.value
    || element?.id
    || `item-${index}`;
}

export function applyProps(element, props, machineId) {
  if (!element) return () => {};
  return zagSpreadProps(element, props, machineId);
}

function defaultSnapshot(api, service) {
  return {
    api,
    service: service.service,
    state: service.service.state.get(),
    send: service.send,
  };
}

export function createZagAdapter(config, context = {}) {
  const {
    name,
    machine,
    connect,
    props,
    selectors = {},
    bindings,
    snapshot = defaultSnapshot,
    actions = {},
    transientProps = [],
    validate,
  } = config;
  const { id } = context;

  if (!id) throw new Error(`createAosZag${name} requires an id`);
  validate?.(context);

  let currentProps = compactProps(props(context));
  let currentOnStateChange = context.onStateChange;
  const service = new VanillaMachine(machine, () => currentProps);
  const cleanups = new Set();

  function api() {
    return connect(service.service, normalizeProps);
  }

  function getSnapshot() {
    return snapshot(api(), service, currentProps);
  }

  function notify() {
    currentOnStateChange?.(getSnapshot());
  }

  service.start();
  const unsubscribe = service.subscribe(notify);

  function update(nextContext = {}) {
    currentOnStateChange = nextContext.onStateChange ?? currentOnStateChange;
    currentProps = compactProps({
      ...currentProps,
      ...nextContext,
      positioning: nextContext.positioning
        ? {
            ...(currentProps.positioning || {}),
            ...nextContext.positioning,
          }
        : currentProps.positioning,
    });
    delete currentProps.onStateChange;
    for (const key of Object.keys(selectors)) delete currentProps[key];
    for (const key of transientProps) delete currentProps[key];
    service.updateProps(() => currentProps);
    return getSnapshot();
  }

  function cleanupBindings() {
    for (const cleanup of cleanups) cleanup();
    cleanups.clear();
  }

  function bindPart(part, element, extraProps = {}, index = 0) {
    const binding = bindings[part];
    if (!binding) throw new Error(`Unknown Zag ${name} binding: ${part}`);
    const result = typeof binding === 'function' ? binding({
      adapter: publicApi,
      api: api(),
      currentProps,
      element,
      extraProps,
      id,
      index,
    }) : {
      props: api()[binding.getter](extraProps),
    };
    const cleanup = applyProps(element, result.props, `${id}:${part}:${result.key ?? index}`);
    const wrappedCleanup = () => {
      result.cleanup?.();
      cleanup();
    };
    cleanups.add(wrappedCleanup);
    return cleanup;
  }

  function bindMany(root, part, selector = selectors[part], getProps = null) {
    const elements = Array.from(root?.querySelectorAll?.(selector) || []);
    elements.forEach((element, index) => bindPart(part, element, getProps?.(element, index) || {}, index));
    return elements.length;
  }

  function bind(root, options = {}) {
    cleanupBindings();
    for (const [part, binding] of Object.entries(bindings)) {
      if (binding.many || typeof binding === 'function') {
        const suffix = binding.alias || part[0].toUpperCase() + part.slice(1);
        bindMany(root, part, options[`${part}Selector`] || selectors[part], options[`get${suffix}Props`] || null);
        continue;
      }
      const element = options[part]
        || (selectors[part] ? root?.querySelector?.(selectors[part]) : null)
        || (binding.root ? root : null);
      bindPart(part, element, options[`${part}Props`] || {});
    }
    return getSnapshot();
  }

  const publicApi = {
    bind,
    bindMany,
    cleanupBindings,
    connect: getSnapshot,
    destroy() {
      cleanupBindings();
      unsubscribe?.();
      service.stop();
    },
    send: service.send,
    service: service.service,
    spreadProps: applyProps,
    update,
  };

  for (const [part, binding] of Object.entries(bindings)) {
    const suffix = binding.alias || part[0].toUpperCase() + part.slice(1);
    publicApi[`bind${suffix}`] = (element, extraProps = {}, index = 0) => bindPart(part, element, extraProps, index);
    if (binding.many || typeof binding === 'function') {
      publicApi[`bind${suffix}s`] = (root, selector = selectors[part], getProps = null) => bindMany(root, part, selector, getProps);
    }
  }

  for (const [actionName, action] of Object.entries(actions)) {
    publicApi[actionName] = (...args) => action(api(), ...args) ?? getSnapshot();
  }

  return publicApi;
}

export { mergeProps, normalizeProps, VanillaMachine };
