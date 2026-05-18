import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAccordion,
  createCollapsible,
  createDialog,
  createMenu,
  createPopover,
  createSplitter,
  createTooltip,
  renderCollapsibleHtml,
} from '../../packages/toolkit/controls/index.js';
import { createDocument, patchSpreadSupport } from './zag-adapter-test-utils.mjs';

function patchedDocument() {
  const document = createDocument();
  const originalCreateElement = document.createElement.bind(document);
  document.createElement = (...args) => patchSpreadSupport(originalCreateElement(...args));
  return document;
}

test('createCollapsible renders and mounts semantic Zag parts', () => {
  const document = patchedDocument();
  const control = createCollapsible({ document, label: 'Details' });
  control.mount();

  const trigger = control.el.querySelector('[data-aos-collapsible-trigger]');
  const content = control.el.querySelector('[data-aos-collapsible-content]');

  assert.equal(control.el.matches('[data-aos-collapsible-root]'), true);
  assert.equal(control.el.getAttribute('data-part'), 'root');
  assert.equal(trigger.getAttribute('aria-controls'), content.id);
  assert.equal(typeof control.open, 'function');
  assert.equal(typeof control.close, 'function');
  assert.match(renderCollapsibleHtml({ label: 'A <B>' }), /A &lt;B&gt;/);
  control.destroy();
});

test('createAccordion mounts item values from data-value, data-id, and id', () => {
  const document = patchedDocument();
  const root = document.createElement('div');
  root.dataset.aosAccordionRoot = '';
  for (const attrs of [
    { value: 'data-value-item' },
    { id: 'data-id-item' },
    { elementId: 'element-id-item' },
  ]) {
    const item = document.createElement('section');
    item.dataset.aosAccordionItem = '';
    if (attrs.value) item.dataset.value = attrs.value;
    if (attrs.id) item.dataset.id = attrs.id;
    if (attrs.elementId) item.setAttribute('id', attrs.elementId);
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.dataset.aosAccordionItemTrigger = '';
    if (attrs.value) trigger.dataset.value = attrs.value;
    if (attrs.id) trigger.dataset.id = attrs.id;
    if (attrs.elementId) trigger.setAttribute('id', `${attrs.elementId}-trigger`);
    const content = document.createElement('div');
    content.dataset.aosAccordionItemContent = '';
    if (attrs.value) content.dataset.value = attrs.value;
    if (attrs.id) content.dataset.id = attrs.id;
    if (attrs.elementId) content.setAttribute('id', `${attrs.elementId}-content`);
    item.append(trigger, content);
    root.appendChild(item);
  }
  document.body.appendChild(root);

  const control = createAccordion({ document, root, defaultValue: ['data-value-item'] });
  control.mount(root);

  const accordionItems = Array.from(root.querySelectorAll('[data-aos-accordion-item]'));
  assert.equal(accordionItems.find((item) => item.dataset.value === 'data-value-item').getAttribute('data-part'), 'item');
  assert.equal(accordionItems.find((item) => item.dataset.id === 'data-id-item').getAttribute('data-part'), 'item');
  assert.equal(typeof control.setValue, 'function');
  control.destroy();
});

test('createSplitter binds panels and resize triggers', () => {
  const document = patchedDocument();
  const control = createSplitter({
    document,
    panels: [{ id: 'left', size: 40 }, { id: 'right', size: 60 }],
  });
  control.mount();

  const panel = control.el.querySelector('[data-aos-splitter-panel]');
  const trigger = control.el.querySelector('[data-aos-splitter-resize-trigger]');

  assert.equal(control.el.getAttribute('data-part'), 'root');
  assert.equal(panel.getAttribute('data-part'), 'panel');
  assert.equal(trigger.getAttribute('data-part'), 'resize-trigger');
  assert.equal(typeof control.getSizes, 'function');
  control.destroy();
});

test('createPopover and createDialog expose open close helpers with focus parts', () => {
  const document = patchedDocument();
  const popover = createPopover({ document, title: 'Popover' });
  const dialog = createDialog({ document, title: 'Dialog', description: 'Details' });

  popover.mount();
  dialog.mount();

  assert.equal(popover.el.querySelector('[data-aos-popover-trigger]').getAttribute('aria-haspopup'), 'dialog');
  assert.equal(dialog.el.querySelector('[data-aos-dialog-content]').getAttribute('role'), 'dialog');
  assert.equal(typeof popover.open, 'function');
  assert.equal(typeof dialog.close, 'function');

  popover.destroy();
  dialog.destroy();
});

test('createMenu binds neutral trigger, content, and disabled items', () => {
  const document = patchedDocument();
  const control = createMenu({
    document,
    items: [
      { value: 'open', label: 'Open' },
      { value: 'disabled', label: 'Disabled', disabled: true },
    ],
  });
  control.mount();

  const trigger = control.el.querySelector('[data-aos-menu-trigger]');
  const items = control.el.querySelectorAll('[data-aos-menu-item]');

  assert.equal(trigger.getAttribute('aria-haspopup'), 'menu');
  assert.equal(items[0].getAttribute('role'), 'menuitem');
  assert.equal(items[1].getAttribute('aria-disabled'), 'true');
  assert.equal(typeof control.open, 'function');
  control.destroy();
});

test('createTooltip binds trigger, positioner, and content parts', () => {
  const document = patchedDocument();
  const control = createTooltip({ document, label: 'Hint', content: 'More info' });
  control.mount();

  assert.equal(control.el.querySelector('[data-aos-tooltip-trigger]').getAttribute('data-part'), 'trigger');
  assert.equal(control.el.querySelector('[data-aos-tooltip-positioner]').getAttribute('data-part'), 'positioner');
  assert.equal(control.el.querySelector('[data-aos-tooltip-content]').textContent, 'More info');
  control.destroy();
});
