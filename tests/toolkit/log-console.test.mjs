import { test } from 'node:test';
import assert from 'node:assert/strict';
import LogConsole from '../../packages/toolkit/components/log-console/index.js';

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.className = '';
    this.id = '';
    this.parentElement = null;
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this._textContent = '';
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    this.scrollHeight = this.children.length;
    return child;
  }

  removeChild(child) {
    this.children = this.children.filter((entry) => entry !== child);
    child.parentElement = null;
    return child;
  }

  get firstChild() {
    return this.children[0] || null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  get textContent() {
    return this._textContent;
  }

  set textContent(value) {
    this._textContent = String(value);
  }

  set innerHTML(value) {
    this.children = [];
    this._textContent = String(value).replace(/<br>/g, '').replace(/<[^>]+>/g, '');
    const spanPattern = /<span class="([^"]+)">([\s\S]*?)<\/span>/g;
    let match;
    while ((match = spanPattern.exec(String(value)))) {
      const span = new FakeElement('span');
      span.className = match[1];
      span.textContent = match[2].replace(/<br>/g, '').replace(/<[^>]+>/g, '');
      this.appendChild(span);
    }
  }

  get innerHTML() {
    return this._textContent;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    const matches = (node) => {
      if (selector === '.entry:not(.input-safety-countdown)') {
        return node.className.split(/\s+/).includes('entry') &&
          !node.className.split(/\s+/).includes('input-safety-countdown');
      }
      if (selector.startsWith('.')) {
        const cls = selector.slice(1);
        return node.className.split(/\s+/).includes(cls);
      }
      return false;
    };
    const visit = (node) => {
      for (const child of node.children) {
        if (matches(child)) results.push(child);
        visit(child);
      }
    };
    visit(this);
    return results;
  }
}

test('log console renders one serialized input safety countdown block', (t) => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement(tagName) {
      return new FakeElement(tagName);
    },
  };
  t.after(() => {
    globalThis.document = previousDocument;
  });

  const titles = [];
  const component = LogConsole();
  const root = component.render({ setTitle: (title) => titles.push(title) });

  component.onMessage({
    type: 'input_safety_countdown',
    payload: {
      title: 'AOS input passthrough',
      remaining: 12,
      deadline: '2026-05-11T12:00:12Z',
      active: true,
    },
  });
  component.onMessage({
    type: 'input_safety_countdown',
    payload: {
      title: 'AOS input passthrough',
      remaining: 11,
      deadline: '2026-05-11T12:00:12Z',
      active: true,
    },
  });

  assert.equal(root.querySelectorAll('.input-safety-countdown').length, 1);
  const state = component.serialize();
  assert.equal(state.entries.length, 0);
  assert.equal(state.input_safety_countdown.active, true);
  assert.equal(state.input_safety_countdown.remaining, 11);
  assert.equal(state.input_safety_countdown.deadline, '2026-05-11T12:00:12Z');
  assert.match(state.input_safety_countdown.text, /AOS input passthrough/);
  assert.ok(titles.at(-1).startsWith('Log'));
});
