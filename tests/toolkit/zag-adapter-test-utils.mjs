import { FakeElement, createFakeDocument } from './dom-fixture.mjs';

globalThis.requestAnimationFrame ??= (callback) => {
  callback();
  return 0;
};
globalThis.cancelAnimationFrame ??= () => {};

export async function flushMachine() {
  await Promise.resolve();
  await Promise.resolve();
}

export function patchSpreadSupport(element) {
  element.getRootNode ??= function getRootNode() {
    return this.ownerDocument;
  };
  element.scrollTo ??= () => {};
  element.focus ??= () => {};
  element.blur ??= () => {};
  element.style.setProperty ??= function setProperty(name, value) {
    this[name] = value;
  };
  element.style.removeProperty ??= function removeProperty(name) {
    delete this[name];
  };
  element.removeAttribute ??= function removeAttribute(name) {
    this.attributes.delete(name);
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      delete this.dataset[key];
    }
  };
  element.hasAttribute ??= function hasAttribute(name) {
    return this.attributes.has(name);
  };
  element.toggleAttribute ??= function toggleAttribute(name, enabled) {
    if (enabled) this.setAttribute(name, '');
    else this.removeAttribute(name);
  };
  for (const child of element.children || []) patchSpreadSupport(child);
  return element;
}

export function createDocument() {
  const document = createFakeDocument();
  document.defaultView.requestAnimationFrame = globalThis.requestAnimationFrame;
  document.defaultView.cancelAnimationFrame = globalThis.cancelAnimationFrame;
  document.defaultView.document = document;
  document.defaultView.HTMLElement = FakeElement;
  document.defaultView.Element = FakeElement;
  document.defaultView.Node = FakeElement;
  document.defaultView.HTMLInputElement = FakeElement;
  document.defaultView.HTMLTextAreaElement = FakeElement;
  document.defaultView.KeyboardEvent = class KeyboardEvent {};
  document.defaultView.MutationObserver = class MutationObserver {
    observe() {}
    disconnect() {}
  };
  document.defaultView.addEventListener ??= document.addEventListener;
  document.defaultView.removeEventListener ??= document.removeEventListener;
  document.defaultView.getComputedStyle ??= () => ({
    getPropertyValue: () => '',
    overflow: 'visible',
    overflowX: 'visible',
    overflowY: 'visible',
    position: 'static',
  });
  const findById = (node, id) => {
    if (node.id === id) return node;
    for (const child of node.children || []) {
      const match = findById(child, id);
      if (match) return match;
    }
    return null;
  };
  document.getElementById = (id) => {
    if (document.body.id === id) return document.body;
    return findById(document.body, id);
  };
  document.querySelectorAll = (selector) => document.body.querySelectorAll(selector);
  document.querySelector = (selector) => document.body.querySelector(selector);
  patchSpreadSupport(document.body);
  globalThis.document = document;
  globalThis.window = document.defaultView;
  globalThis.CSS ??= { escape: (value) => String(value) };
  return document;
}
