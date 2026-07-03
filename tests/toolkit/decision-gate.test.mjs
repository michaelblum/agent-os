import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDecisionGate } from '../../packages/toolkit/components/decision-gate/index.js';
import { expandGatePresetFields } from '../../shared/gate/presets.mjs';
import { FakeEvent, createFakeDocument } from './dom-fixture.mjs';

function baseRequest(overrides = {}) {
  const request = {
    schema_version: 'aos.gate.request.v1',
    prompt: { title: 'Continue?', body: null },
    ui: { variant: 'freetext' },
    timeout_ms: 20000,
    ...overrides,
  };
  if (!Array.isArray(request.fields)) {
    request.fields = expandGatePresetFields(request.ui?.variant || 'freetext', request);
  }
  return request;
}

function mount(request) {
  const document = createFakeDocument();
  const container = document.createElement('section');
  document.body.appendChild(container);
  const gate = createDecisionGate(container, { request });
  return { document, container, gate };
}

function timerHarness() {
  const document = createFakeDocument();
  let time = 0;
  const frames = [];
  document.defaultView.performance.now = () => time;
  document.defaultView.requestAnimationFrame = (callback) => {
    frames.push(callback);
    return frames.length;
  };
  document.defaultView.cancelAnimationFrame = () => {};
  document.defaultView.setTimeout = () => 0;
  return {
    document,
    tick(ms) {
      time += ms;
      const callback = frames.shift();
      callback?.(time);
    },
  };
}

function flushAsyncSubmit() {
  return new Promise((resolve) => setImmediate(resolve));
}

function nodeListLike(items) {
  const list = {
    length: items.length,
    item(index) {
      return items[index] || null;
    },
    *[Symbol.iterator]() {
      yield* items;
    },
  };
  items.forEach((item, index) => {
    list[index] = item;
  });
  return list;
}

test('renders title', () => {
  const { container } = mount(baseRequest({ prompt: { title: 'Pick a path', body: null } }));

  assert.equal(container.querySelector('.aos-gate-title')?.textContent, 'Pick a path');
});

test('body omitted when null', () => {
  const { container } = mount(baseRequest({ prompt: { title: 'No body' } }));

  assert.equal(container.querySelector('.aos-gate-body'), null);
});

test('canonical yes_no_with_escape fields render three options and hide text initially', () => {
  const { container } = mount(baseRequest({ ui: { variant: 'yes_no_with_escape' } }));

  assert.equal(container.querySelectorAll('.aos-segmented button').length, 3);
  assert.equal(container.querySelectorAll('.aos-form-field')[1].classList.contains('hidden'), true);
});

test('conditional field reveals', () => {
  const { container } = mount(baseRequest({ ui: { variant: 'yes_no_with_escape' } }));
  const buttons = container.querySelectorAll('.aos-segmented button');
  const textField = container.querySelectorAll('.aos-form-field')[1];

  buttons[2].dispatchEvent(new FakeEvent('click', { bubbles: true }));

  assert.equal(textField.classList.contains('hidden'), false);
});

test('submit resolves with values', () => {
  const { container, document } = mount(baseRequest({ ui: { variant: 'freetext' } }));
  const input = container.querySelector('.aos-text-input');
  input.value = 'ship it';
  input.dispatchEvent(new FakeEvent('input', { bubbles: true }));

  container.querySelector('.aos-gate-submit').dispatchEvent(new FakeEvent('click', { bubbles: true }));

  assert.equal(document.defaultView.__gateResult, JSON.stringify({ text: 'ship it' }));
});

test('custom async submit disables repeated submits and reports terminal success', async () => {
  const { container, document } = mount(baseRequest({ ui: { variant: 'freetext' } }));
  const submitted = [];
  container.replaceChildren();
  createDecisionGate(container, {
    request: baseRequest({ ui: { variant: 'freetext' } }),
    onSubmit: async (value) => {
      submitted.push(value);
      return { state: 'submitted', duplicate: false };
    },
  });
  const input = container.querySelector('.aos-text-input');
  input.value = 'bridge';
  input.dispatchEvent(new FakeEvent('input', { bubbles: true }));
  const button = container.querySelector('.aos-gate-submit');

  button.dispatchEvent(new FakeEvent('click', { bubbles: true }));
  button.dispatchEvent(new FakeEvent('click', { bubbles: true }));
  await Promise.resolve();

  assert.deepEqual(submitted, [{ text: 'bridge' }]);
  assert.equal(button.disabled, true);
  assert.equal(container.querySelector('.aos-gate-status').textContent, 'Submitted.');
  assert.equal(document.defaultView.__gateResult, JSON.stringify({ text: 'bridge' }));
});

test('custom async duplicate submit reports already submitted terminal state', async () => {
  const { container } = mount(baseRequest({ ui: { variant: 'freetext' } }));
  container.replaceChildren();
  createDecisionGate(container, {
    request: baseRequest({ ui: { variant: 'freetext' } }),
    onSubmit: async () => ({ state: 'submitted', duplicate: true }),
  });
  const input = container.querySelector('.aos-text-input');
  input.value = 'bridge';
  input.dispatchEvent(new FakeEvent('input', { bubbles: true }));

  container.querySelector('.aos-gate-submit').dispatchEvent(new FakeEvent('click', { bubbles: true }));
  await Promise.resolve();

  assert.equal(container.querySelector('.aos-gate-status').textContent, 'Already submitted.');
});

test('pending async submit ignores Escape and resolves with submit result', async () => {
  const document = createFakeDocument();
  const container = document.createElement('section');
  document.body.appendChild(container);
  let finishSubmit;
  createDecisionGate(container, {
    request: baseRequest({ ui: { variant: 'freetext' } }),
    onSubmit: async () => new Promise((resolve) => {
      finishSubmit = () => resolve({ state: 'submitted' });
    }),
  });
  const input = container.querySelector('.aos-text-input');
  input.value = 'bridge';
  input.dispatchEvent(new FakeEvent('input', { bubbles: true }));

  container.querySelector('.aos-gate-submit').dispatchEvent(new FakeEvent('click', { bubbles: true }));
  document.dispatchEvent(new FakeEvent('keydown', { key: 'Escape' }));
  finishSubmit();
  await flushAsyncSubmit();

  assert.equal(document.defaultView.__gateResult, JSON.stringify({ text: 'bridge' }));
  assert.equal(container.querySelector('.aos-gate-status').textContent, 'Submitted.');
});

test('pending async submit ignores timer expiry and resolves with submit result', async () => {
  const harness = timerHarness();
  const container = harness.document.createElement('section');
  harness.document.body.appendChild(container);
  let finishSubmit;
  createDecisionGate(container, {
    request: baseRequest({
      timeout_ms: 50,
      ui: { variant: 'freetext', timer: { visible: true } },
    }),
    onSubmit: async () => new Promise((resolve) => {
      finishSubmit = () => resolve({ state: 'submitted' });
    }),
  });
  const input = container.querySelector('.aos-text-input');
  input.value = 'bridge';
  input.dispatchEvent(new FakeEvent('input', { bubbles: true }));

  container.querySelector('.aos-gate-submit').dispatchEvent(new FakeEvent('click', { bubbles: true }));
  harness.tick(60);
  finishSubmit();
  await flushAsyncSubmit();

  assert.equal(harness.document.defaultView.__gateResult, JSON.stringify({ text: 'bridge' }));
  assert.equal(container.querySelector('.aos-gate-status').textContent, 'Submitted.');
});

test('Enter on a text field submits', () => {
  const { container, document } = mount(baseRequest({ ui: { variant: 'freetext' } }));
  const input = container.querySelector('.aos-text-input');
  input.value = 'keyboard';
  input.dispatchEvent(new FakeEvent('input', { bubbles: true }));

  input.dispatchEvent(new FakeEvent('keydown', { key: 'Enter', bubbles: true }));

  assert.equal(document.defaultView.__gateResult, JSON.stringify({ text: 'keyboard' }));
});

test('dismiss resolves no-answer envelope', () => {
  const { container, document } = mount(baseRequest());

  container.querySelector('.aos-gate-dismiss').dispatchEvent(new FakeEvent('click', { bubbles: true }));

  assert.equal(document.defaultView.__gateResult, JSON.stringify({ result: null, status: 'dismissed' }));
});

test('Escape resolves no-answer envelope', () => {
  const { document } = mount(baseRequest());

  document.dispatchEvent(new FakeEvent('keydown', { key: 'Escape' }));

  assert.equal(document.defaultView.__gateResult, JSON.stringify({ result: null, status: 'dismissed' }));
});

test('Tab cycles through fields and action buttons', () => {
  const { container, document } = mount(baseRequest({ ui: { variant: 'freetext' } }));
  const root = container.children[0];
  const querySelectorAll = root.querySelectorAll.bind(root);
  root.querySelectorAll = (selector) => nodeListLike(querySelectorAll(selector));
  const dismiss = container.querySelector('.aos-gate-dismiss');
  const submit = container.querySelector('.aos-gate-submit');

  submit.focus();
  document.dispatchEvent(new FakeEvent('keydown', { key: 'Tab' }));
  assert.equal(document.activeElement, dismiss);

  document.dispatchEvent(new FakeEvent('keydown', { key: 'Tab', shiftKey: true }));
  assert.equal(document.activeElement, submit);
});

test('resolve is idempotent', () => {
  const { container, document } = mount(baseRequest({ ui: { variant: 'freetext' } }));
  const resolvedEvents = [];
  document.addEventListener('gate:resolved', (event) => resolvedEvents.push(event.detail.value));
  const input = container.querySelector('.aos-text-input');
  input.value = 'first';
  input.dispatchEvent(new FakeEvent('input', { bubbles: true }));
  container.querySelector('.aos-gate-submit').dispatchEvent(new FakeEvent('click', { bubbles: true }));

  container.querySelector('.aos-gate-dismiss').dispatchEvent(new FakeEvent('click', { bubbles: true }));

  assert.equal(document.defaultView.__gateResult, JSON.stringify({ text: 'first' }));
  assert.deepEqual(resolvedEvents, [{ text: 'first' }]);
});

test('invalid submit does not resolve', () => {
  const { container, document } = mount(baseRequest({ ui: { variant: 'freetext' } }));

  container.querySelector('.aos-gate-submit').dispatchEvent(new FakeEvent('click', { bubbles: true }));

  assert.equal(document.defaultView.__gateResult, undefined);
});

test('timer expiry resolves timeout envelope', () => {
  const harness = timerHarness();
  const container = harness.document.createElement('section');
  harness.document.body.appendChild(container);
  createDecisionGate(container, {
    request: baseRequest({
      timeout_ms: 50,
      ui: { variant: 'freetext', timer: { visible: true } },
    }),
  });

  harness.tick(60);

  assert.equal(harness.document.defaultView.__gateResult, JSON.stringify({ result: null, status: 'timeout' }));
});

test('approve/deny preset renders deny as danger', () => {
  const { container } = mount(baseRequest({ ui: { variant: 'approve_deny' } }));
  const buttons = container.querySelectorAll('.aos-segmented button');

  assert.equal(buttons.length, 2);
  assert.equal(buttons[1].classList.contains('danger'), true);
});
