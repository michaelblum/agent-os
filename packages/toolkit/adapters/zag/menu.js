import {
  VanillaMachine,
  connect as zagConnect,
  machine as zagMenuMachine,
  mergeProps,
  normalizeProps,
  spreadProps as zagSpreadProps,
} from './vendor/menu-runtime.mjs';

const DEFAULT_ITEM_SELECTOR = [
  '.ctx-trigger[data-ctx-open]',
  '[data-ctx-back]',
  '[data-sigil-action]',
  '[data-sigil-avatar-action]',
].join(', ');

function compactProps(props = {}) {
  return Object.fromEntries(
    Object.entries(props).filter(([, value]) => value !== undefined)
  );
}

function valueForElement(element, index = 0) {
  return element?.dataset?.ctxOpen
    || element?.dataset?.sigilAction
    || element?.dataset?.sigilAvatarAction
    || element?.dataset?.sigilFastTravelEffect
    || element?.dataset?.sigilLineTrailMode
    || element?.id
    || `item-${index}`;
}

function buttonText(element) {
  return element?.getAttribute?.('aria-label')
    || element?.getAttribute?.('title')
    || element?.textContent?.trim()
    || valueForElement(element);
}

function setDatasetFlag(element, name, enabled) {
  if (!element?.dataset) return;
  if (enabled) element.dataset[name] = '';
  else delete element.dataset[name];
}

function applyProps(element, props, machineId) {
  if (!element) return () => {};
  return zagSpreadProps(element, props, machineId);
}

export function createAosZagMenu(context = {}) {
  const {
    id = 'aos-menu',
    ids,
    getRootNode,
    itemSelector = DEFAULT_ITEM_SELECTOR,
    composite = true,
    loopFocus = true,
    typeahead = true,
    closeOnSelect = false,
    onOpenChange,
    onHighlightChange,
    onSelect,
    onStateChange,
  } = context;
  let currentProps = {
    id,
    ids,
    getRootNode,
    composite,
    loopFocus,
    typeahead,
    closeOnSelect,
    onOpenChange,
    onHighlightChange,
    onSelect,
    positioning: {
      strategy: 'fixed',
      placement: 'bottom-start',
      gutter: 0,
      ...(context.positioning || {}),
    },
  };
  const service = new VanillaMachine(zagMenuMachine, () => currentProps);
  const cleanups = new Set();

  function api() {
    return zagConnect(service.service, normalizeProps);
  }

  function notify() {
    onStateChange?.(connect());
  }

  service.start();
  const unsubscribe = service.subscribe(notify);

  function connect() {
    const menuApi = api();
    return {
      api: menuApi,
      service: service.service,
      open: menuApi.open,
      highlightedValue: menuApi.highlightedValue ?? null,
      state: service.service.state.get(),
      send: service.send,
      getContentProps(extra = {}) {
        return mergeProps(menuApi.getContentProps(), extra);
      },
      getItemProps(props = {}) {
        return menuApi.getItemProps(props);
      },
      setOpen: menuApi.setOpen,
      setHighlightedValue: menuApi.setHighlightedValue,
    };
  }

  function update(nextContext = {}) {
    currentProps = {
      ...currentProps,
      ...compactProps(nextContext),
      positioning: {
        ...(currentProps.positioning || {}),
        ...(nextContext.positioning || {}),
      },
    };
    service.updateProps(() => currentProps);
    return connect();
  }

  function cleanupBindings() {
    for (const cleanup of cleanups) cleanup();
    cleanups.clear();
  }

  function bindContent(element, extraProps = {}) {
    const cleanup = applyProps(
      element,
      connect().getContentProps(extraProps),
      `${id}:content`
    );
    cleanups.add(cleanup);
    return cleanup;
  }

  function bindItem(element, props = {}, index = 0) {
    const value = props.value || valueForElement(element, index);
    const itemProps = connect().getItemProps({
      closeOnSelect,
      value,
      valueText: props.valueText || buttonText(element),
      disabled: props.disabled ?? element?.disabled,
    });
    setDatasetFlag(element, 'aosZagMenuItem', true);
    const cleanup = applyProps(element, mergeProps(itemProps, props.extra || {}), `${id}:item:${value}`);
    cleanups.add(() => {
      setDatasetFlag(element, 'aosZagMenuItem', false);
      cleanup();
    });
    return cleanup;
  }

  function bindItems(root, selector = itemSelector, getProps = null) {
    const elements = Array.from(root?.querySelectorAll?.(selector) || []);
    elements.forEach((element, index) => bindItem(element, getProps?.(element, index) || {}, index));
    return elements.length;
  }

  function bind(root, options = {}) {
    cleanupBindings();
    bindContent(options.content || root, options.contentProps || {});
    bindItems(root, options.itemSelector || itemSelector, options.getItemProps || null);
    return connect();
  }

  function open(details = {}) {
    service.send({ type: 'OPEN', value: details.value });
    return connect();
  }

  function close(details = {}) {
    service.send({ type: 'CLOSE', restoreFocus: false, ...details });
    return connect();
  }

  function destroy() {
    cleanupBindings();
    unsubscribe?.();
    service.stop();
  }

  return {
    bind,
    bindContent,
    bindItem,
    bindItems,
    cleanupBindings,
    close,
    connect,
    destroy,
    open,
    send: service.send,
    service: service.service,
    spreadProps: applyProps,
    update,
  };
}

export { mergeProps, normalizeProps };
