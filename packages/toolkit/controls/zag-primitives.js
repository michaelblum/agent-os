import { createEventHub, dispatchDomEvent, ownerDocument } from './_events.js';
import { escapeHtml } from './_html.js';
import {
  createAosZagAccordion,
  createAosZagCollapsible,
  createAosZagDialog,
  createAosZagMenu,
  createAosZagPopover,
  createAosZagSplitter,
  createAosZagTooltip,
} from '../adapters/zag/index.js';

let nextId = 0;

function controlId(prefix) {
  nextId += 1;
  return `${prefix}-${nextId}`;
}

function docFor(config = {}) {
  return config.root?.ownerDocument || ownerDocument(config);
}

function button(doc, label, dataset, className = 'aos-button') {
  const el = doc.createElement('button');
  el.type = 'button';
  el.setAttribute('class', className);
  el.textContent = String(label ?? '');
  for (const [key, value] of Object.entries(dataset || {})) el.dataset[key] = value;
  return el;
}

function div(doc, dataset, className = '') {
  const el = doc.createElement('div');
  if (className) el.setAttribute('class', className);
  for (const [key, value] of Object.entries(dataset || {})) el.dataset[key] = value;
  return el;
}

function dispatchState(el, type, detail) {
  dispatchDomEvent(el, type, detail);
}

function createPrimitiveController({ adapter, el, bind, updateAdapter, onDestroy }) {
  let mounted = false;

  function mount(root = el) {
    el = root;
    bind(root);
    mounted = true;
    return api;
  }

  const api = {
    get el() {
      return el;
    },
    mount,
    update(next = {}) {
      const snapshot = updateAdapter?.(next) || adapter.update(next);
      if (mounted) bind(el);
      return snapshot;
    },
    connect() {
      return adapter.connect();
    },
    destroy() {
      onDestroy?.();
      adapter.destroy();
      mounted = false;
    },
  };

  return api;
}

export function createCollapsible(config = {}) {
  const doc = docFor(config);
  const hub = createEventHub();
  const el = config.root || div(doc, { aosCollapsibleRoot: '' }, 'aos-collapsible');
  if (!config.root) {
    el.append(
      button(doc, config.label || 'Toggle', { aosCollapsibleTrigger: '' }),
      div(doc, { aosCollapsibleContent: '' }, 'aos-collapsible__content')
    );
  }
  const adapter = createAosZagCollapsible({
    ...config,
    id: config.id || controlId('aos-collapsible'),
    getRootNode: config.getRootNode || (() => doc),
    onOpenChange(details) {
      config.onOpenChange?.(details);
      config.onChange?.(details.open);
      hub.emit('change', { open: details.open });
      dispatchState(el, 'change', { open: details.open });
    },
  });
  const controller = createPrimitiveController({
    adapter,
    el,
    bind(root) {
      const rootPart = root.matches?.('[data-aos-collapsible-root]')
        ? root
        : root.querySelector?.('[data-aos-collapsible-root]');
      if (rootPart) adapter.bindRoot(rootPart);
      root.querySelectorAll?.('[data-aos-collapsible-trigger]')?.forEach((element, index) => {
        adapter.bindTrigger(element, {}, index);
      });
      root.querySelectorAll?.('[data-aos-collapsible-content]')?.forEach((element, index) => {
        adapter.bindContent(element, {}, index);
      });
    },
  });
  return Object.assign(controller, {
    open() {
      return adapter.open();
    },
    close() {
      return adapter.close();
    },
    on(type, callback) {
      return type === 'change' ? hub.on(type, callback) : () => {};
    },
    destroy() {
      hub.clear();
      adapter.destroy();
    },
  });
}

function itemValue(element, index, fallback) {
  return element?.dataset?.value || element?.dataset?.id || element?.id || `${fallback}-${index}`;
}

function accordionValue(element, index) {
  let current = element;
  while (current) {
    if (current.matches?.('[data-aos-accordion-item]')) return itemValue(current, index, 'item');
    current = current.parentElement;
  }
  return itemValue(element, index, 'item');
}

export function createAccordion(config = {}) {
  const doc = docFor(config);
  const hub = createEventHub();
  const el = config.root || div(doc, { aosAccordionRoot: '' }, 'aos-accordion');
  if (!config.root) {
    for (const item of config.items || []) {
      const itemEl = div(doc, { aosAccordionItem: '', value: item.value }, 'aos-accordion__item');
      itemEl.append(
        button(doc, item.label ?? item.value, { aosAccordionItemTrigger: '', value: item.value }),
        div(doc, { aosAccordionItemContent: '', value: item.value }, 'aos-accordion__content')
      );
      itemEl.children[1].textContent = String(item.content ?? '');
      el.appendChild(itemEl);
    }
  }
  const adapter = createAosZagAccordion({
    ...config,
    id: config.id || controlId('aos-accordion'),
    getRootNode: config.getRootNode || (() => doc),
    onValueChange(details) {
      config.onValueChange?.(details);
      config.onChange?.(details.value);
      hub.emit('change', { value: details.value });
      dispatchState(el, 'change', { value: details.value });
    },
  });
  const controller = createPrimitiveController({
    adapter,
    el,
    bind(root) {
      adapter.bindRoot(root.matches?.('[data-aos-accordion-root]') ? root : root.querySelector('[data-aos-accordion-root]') || root);
      root.querySelectorAll?.('[data-aos-accordion-item]')?.forEach((element, index) => {
        adapter.bindItem(element, { value: itemValue(element, index, 'item') }, index);
      });
      root.querySelectorAll?.('[data-aos-accordion-item-trigger]')?.forEach((element, index) => {
        adapter.bindItemTrigger(element, { value: accordionValue(element, index) }, index);
      });
      root.querySelectorAll?.('[data-aos-accordion-item-content]')?.forEach((element, index) => {
        adapter.bindItemContent(element, { value: accordionValue(element, index) }, index);
      });
    },
  });
  return Object.assign(controller, {
    setValue(value) {
      return adapter.setValue(value);
    },
    on(type, callback) {
      return type === 'change' ? hub.on(type, callback) : () => {};
    },
    destroy() {
      hub.clear();
      adapter.destroy();
    },
  });
}

export function createSplitter(config = {}) {
  const doc = docFor(config);
  const el = config.root || div(doc, { aosSplitterRoot: '' }, 'aos-splitter');
  const splitterPanels = config.panels || [{ id: 'a', size: 50 }, { id: 'b', size: 50 }];
  if (!config.root) {
    splitterPanels.forEach((panel, index) => {
      el.appendChild(div(doc, { aosSplitterPanel: '', value: panel.id || `panel-${index}` }, 'aos-splitter__panel'));
      if (index < splitterPanels.length - 1) {
        const nextId = splitterPanels[index + 1]?.id || `panel-${index + 1}`;
        el.appendChild(button(doc, '', { aosSplitterResizeTrigger: '', value: `${panel.id || `panel-${index}`}:${nextId}` }, 'aos-splitter__resize-trigger'));
      }
    });
  }
  const adapter = createAosZagSplitter({
    ...config,
    panels: splitterPanels,
    id: config.id || controlId('aos-splitter'),
    getRootNode: config.getRootNode || (() => doc),
  });
  const controller = createPrimitiveController({
    adapter,
    el,
    bind(root) {
      const rootPart = root.matches?.('[data-aos-splitter-root]')
        ? root
        : root.querySelector?.('[data-aos-splitter-root]');
      if (rootPart) adapter.bindRoot(rootPart);
      root.querySelectorAll?.('[data-aos-splitter-panel]')?.forEach((element, index) => {
        adapter.bindPanel(element, { value: itemValue(element, index, 'panel') }, index);
      });
      root.querySelectorAll?.('[data-aos-splitter-resize-trigger]')?.forEach((element, index) => {
        adapter.bindResizeTrigger(element, { value: itemValue(element, index, 'resize-trigger') }, index);
      });
    },
  });
  return Object.assign(controller, {
    getSizes() {
      return adapter.connect().getSizes?.();
    },
    setSizes(sizes) {
      return adapter.connect().setSizes?.(sizes);
    },
  });
}

function createOverlayPrimitive(config, kind, createAdapter, parts) {
  const doc = docFor(config);
  const hub = createEventHub();
  const dataPrefix = `aos${kind[0].toUpperCase()}${kind.slice(1)}`;
  const el = config.root || div(doc, {}, `aos-${kind}`);
  if (!config.root) {
    el.appendChild(button(doc, config.label || kind, { [`${dataPrefix}Trigger`]: '' }));
    if (parts.includes('backdrop')) el.appendChild(div(doc, { [`${dataPrefix}Backdrop`]: '' }, `aos-${kind}__backdrop`));
    const positioner = div(doc, { [`${dataPrefix}Positioner`]: '' }, `aos-${kind}__positioner`);
    const content = div(doc, { [`${dataPrefix}Content`]: '' }, `aos-${kind}__content`);
    if (parts.includes('title')) {
      const title = doc.createElement('h2');
      title.dataset[`${dataPrefix}Title`] = '';
      title.textContent = String(config.title || '');
      content.appendChild(title);
    }
    if (parts.includes('description')) {
      const description = doc.createElement('p');
      description.dataset[`${dataPrefix}Description`] = '';
      description.textContent = String(config.description || '');
      content.appendChild(description);
    }
    content.appendChild(button(doc, config.closeLabel || 'Close', { [`${dataPrefix}CloseTrigger`]: '' }, 'aos-button ghost'));
    positioner.appendChild(content);
    el.appendChild(positioner);
  }
  const adapter = createAdapter({
    ...config,
    id: config.id || controlId(`aos-${kind}`),
    getRootNode: config.getRootNode || (() => doc),
    onOpenChange(details) {
      config.onOpenChange?.(details);
      config.onChange?.(details.open);
      hub.emit('change', { open: details.open });
      dispatchState(el, 'change', { open: details.open });
    },
  });
  const controller = createPrimitiveController({
    adapter,
    el,
    bind(root) {
      adapter.bind(root);
    },
  });
  return Object.assign(controller, {
    open() {
      return adapter.open();
    },
    close() {
      return adapter.close();
    },
    on(type, callback) {
      return type === 'change' ? hub.on(type, callback) : () => {};
    },
    destroy() {
      hub.clear();
      adapter.destroy();
    },
  });
}

export function createPopover(config = {}) {
  return createOverlayPrimitive(config, 'popover', createAosZagPopover, ['title', 'description']);
}

export function createDialog(config = {}) {
  return createOverlayPrimitive(config, 'dialog', createAosZagDialog, ['backdrop', 'title', 'description']);
}

export function createMenu(config = {}) {
  const doc = docFor(config);
  const hub = createEventHub();
  const el = config.root || div(doc, {}, 'aos-menu');
  if (!config.root) {
    el.appendChild(button(doc, config.label || 'Menu', { aosMenuTrigger: '' }));
    const content = div(doc, { aosMenuContent: '' }, 'aos-menu__content');
    for (const item of config.items || []) {
      const itemEl = button(doc, item.label ?? item.value, { value: item.value, aosMenuItem: '' }, 'aos-menu__item');
      itemEl.disabled = !!item.disabled;
      content.appendChild(itemEl);
    }
    el.appendChild(content);
  }
  const adapter = createAosZagMenu({
    ...config,
    id: config.id || controlId('aos-menu'),
    getRootNode: config.getRootNode || (() => doc),
    onSelect(details) {
      config.onSelect?.(details);
      hub.emit('select', details);
      dispatchState(el, 'select', details);
    },
  });
  const controller = createPrimitiveController({
    adapter,
    el,
    bind(root) {
      const trigger = root.querySelector?.('[data-aos-menu-trigger]');
      if (trigger) adapter.bindTrigger(trigger);
      const content = root.querySelector?.('[data-aos-menu-content]') || root.querySelector?.('.aos-menu__content') || root;
      adapter.bindContent(content);
      adapter.bindItems(root, config.itemSelector, (element) => ({
        disabled: element.disabled || element.getAttribute?.('aria-disabled') === 'true',
      }));
    },
  });
  return Object.assign(controller, {
    open(details) {
      return adapter.open(details);
    },
    close(details) {
      return adapter.close(details);
    },
    on(type, callback) {
      return type === 'select' ? hub.on(type, callback) : () => {};
    },
    destroy() {
      hub.clear();
      adapter.destroy();
    },
  });
}

export function createTooltip(config = {}) {
  const doc = docFor(config);
  const el = config.root || div(doc, {}, 'aos-tooltip');
  if (!config.root) {
    el.append(
      button(doc, config.label || 'Info', { aosTooltipTrigger: '' }),
      div(doc, { aosTooltipPositioner: '' }, 'aos-tooltip__positioner')
    );
    const content = div(doc, { aosTooltipContent: '' }, 'aos-tooltip__content');
    content.textContent = String(config.content || '');
    el.children[1].appendChild(content);
  }
  const adapter = createAosZagTooltip({
    ...config,
    id: config.id || controlId('aos-tooltip'),
    getRootNode: config.getRootNode || (() => doc),
  });
  const controller = createPrimitiveController({
    adapter,
    el,
    bind(root) {
      adapter.bind(root);
    },
  });
  return Object.assign(controller, {
    open() {
      return adapter.open();
    },
    close() {
      return adapter.close();
    },
  });
}

export function renderCollapsibleHtml(config = {}) {
  const id = escapeHtml(config.id || '');
  return `<div class="aos-collapsible" data-aos-collapsible-root${id ? ` id="${id}"` : ''}>`
    + `<button class="aos-button" type="button" data-aos-collapsible-trigger>${escapeHtml(config.label || 'Toggle')}</button>`
    + `<div class="aos-collapsible__content" data-aos-collapsible-content>${escapeHtml(config.content || '')}</div>`
    + '</div>';
}
