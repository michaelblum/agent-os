export class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = !!init.bubbles;
    this.detail = init.detail;
    this.key = init.key;
    this.shiftKey = !!init.shiftKey;
    this.defaultPrevented = false;
  }

  preventDefault() {
    this.defaultPrevented = true;
  }
}

class FakeClassList {
  constructor() {
    this.items = new Set();
  }

  add(...names) {
    for (const name of names) this.items.add(name);
  }

  remove(...names) {
    for (const name of names) this.items.delete(name);
  }

  contains(name) {
    return this.items.has(name);
  }

  toggle(name, force) {
    const shouldAdd = force === undefined ? !this.items.has(name) : !!force;
    if (shouldAdd) this.items.add(name);
    else this.items.delete(name);
    return shouldAdd;
  }

  toString() {
    return [...this.items].join(' ');
  }
}

export class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.nodeName = this.tagName;
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.dataset = {};
    this.classList = new FakeClassList();
    this.listeners = new Map();
    this.style = {};
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.indeterminate = false;
    this.value = '';
    this.type = '';
    this.tabIndex = 0;
  }

  append(...children) {
    for (const child of children) this.appendChild(child);
  }

  appendChild(child) {
    child.parentElement = this;
    child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    this.children = [];
    for (const child of children) this.appendChild(child);
  }

  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'class') {
      this.classList = new FakeClassList();
      this.classList.add(...String(value).split(/\s+/).filter(Boolean));
    } else if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.dataset[key] = String(value);
    } else {
      this[name] = String(value);
    }
  }

  getAttribute(name) {
    if (this.attributes.has(name)) return this.attributes.get(name);
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      return this.dataset[key] ?? null;
    }
    if (this[name] !== undefined && this[name] !== false) return String(this[name]);
    return null;
  }

  addEventListener(type, callback) {
    const set = this.listeners.get(type) || new Set();
    set.add(callback);
    this.listeners.set(type, set);
  }

  removeEventListener(type, callback) {
    this.listeners.get(type)?.delete(callback);
  }

  dispatchEvent(event) {
    event.target ||= this;
    for (const callback of this.listeners.get(event.type) || []) callback(event);
    if (event.bubbles && this.parentElement) this.parentElement.dispatchEvent(event);
    else if (event.bubbles) this.ownerDocument?.dispatchEvent?.(event);
    return true;
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  matches(selector) {
    if (selector.includes(',')) return selector.split(',').some((part) => this.matches(part.trim()));
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    if (selector.startsWith('[') && selector.endsWith(']')) {
      const body = selector.slice(1, -1);
      if (body.includes('~=')) {
        const [name, quoted] = body.split('~=');
        const value = quoted.replace(/^["']|["']$/g, '');
        return String(this.getAttribute(name) || '').split(/\s+/).includes(value);
      }
      return this.getAttribute(body) !== null;
    }
    const attrMatch = selector.match(/^([a-z]+)\[([^=]+)=["']?([^"'\]]+)["']?\]$/i);
    if (attrMatch) {
      const [, tagName, attr, value] = attrMatch;
      return this.tagName.toLowerCase() === tagName.toLowerCase() && this.getAttribute(attr) === value;
    }
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    if (selector.includes(' ')) {
      const parts = selector.trim().split(/\s+/);
      let current = [this];
      for (const part of parts) {
        current = current.flatMap((node) => node.querySelectorAll(part));
      }
      return current;
    }
    const results = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (child.matches(selector)) results.push(child);
        visit(child);
      }
    };
    visit(this);
    return results;
  }
}

export function createFakeDocument() {
  const listeners = new Map();
  const doc = {
    activeElement: null,
    defaultView: {
      Event: FakeEvent,
      CustomEvent: FakeEvent,
      performance: { now: () => 0 },
      setTimeout: (callback) => {
        callback();
        return 0;
      },
    },
    createElement(tagName) {
      return new FakeElement(tagName, doc);
    },
    createElementNS(_namespace, tagName) {
      return new FakeElement(tagName, doc);
    },
    addEventListener(type, callback) {
      const set = listeners.get(type) || new Set();
      set.add(callback);
      listeners.set(type, set);
    },
    removeEventListener(type, callback) {
      listeners.get(type)?.delete(callback);
    },
    dispatchEvent(event) {
      event.target ||= doc;
      for (const callback of listeners.get(event.type) || []) callback(event);
      return true;
    },
  };
  doc.body = doc.createElement('body');
  return doc;
}
