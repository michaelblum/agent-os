import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  handleNumberFieldKeydown,
  handleNumberFieldWheel,
  stepNumberField,
  wheelDirection,
} from '../../packages/toolkit/controls/number-field.js';

function fakeInput(props = {}) {
  const events = [];
  class FakeEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.bubbles = !!init.bubbles;
    }
  }
  const ownerDocument = {
    activeElement: null,
    defaultView: { Event: FakeEvent },
  };
  const input = {
    value: props.value ?? '1',
    step: props.step ?? '0.01',
    min: props.min ?? '',
    max: props.max ?? '',
    disabled: props.disabled ?? false,
    readOnly: props.readOnly ?? false,
    dataset: props.dataset ?? { aosControl: 'number-field' },
    ownerDocument,
    events,
    getAttribute(name) {
      return this[name] ?? null;
    },
    dispatchEvent(event) {
      events.push({ type: event.type, bubbles: event.bubbles });
      return true;
    },
    matches(selector) {
      if (selector === '[data-aos-control~="number-field"]') {
        return String(this.dataset.aosControl || '').split(/\s+/).includes('number-field');
      }
      return false;
    },
    closest(selector) {
      return this.matches(selector) ? this : null;
    },
  };
  ownerDocument.activeElement = props.active === false ? null : input;
  return input;
}

function fakeWheel(input, props = {}) {
  return {
    target: input,
    deltaX: props.deltaX ?? 0,
    deltaY: props.deltaY ?? -1,
    shiftKey: !!props.shiftKey,
    altKey: !!props.altKey,
    defaultPrevented: !!props.defaultPrevented,
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true;
    },
    stopPropagation() {
      this.stopped = true;
    },
  };
}

function fakeKey(input, props = {}) {
  return {
    target: input,
    key: props.key ?? 'ArrowUp',
    shiftKey: !!props.shiftKey,
    altKey: !!props.altKey,
    metaKey: !!props.metaKey,
    ctrlKey: !!props.ctrlKey,
    defaultPrevented: !!props.defaultPrevented,
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true;
    },
    stopPropagation() {
      this.stopped = true;
    },
  };
}

test('stepNumberField updates value and dispatches input/change events', () => {
  const input = fakeInput({ value: '1', step: '0.01' });

  const result = stepNumberField(input, 1);

  assert.equal(result.applied, true);
  assert.equal(input.value, '1.01');
  assert.deepEqual(input.events, [
    { type: 'input', bubbles: true },
    { type: 'change', bubbles: true },
  ]);
});

test('number field wheel follows focused app-control semantics', () => {
  const input = fakeInput({ value: '1', step: '0.01' });
  const event = fakeWheel(input, { deltaY: -8 });

  assert.equal(handleNumberFieldWheel(event), true);
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  assert.equal(input.value, '1.01');
});

test('number field wheel ignores unfocused fields', () => {
  const input = fakeInput({ value: '1', active: false });
  const event = fakeWheel(input, { deltaY: -8 });

  assert.equal(handleNumberFieldWheel(event), false);
  assert.equal(event.prevented, false);
  assert.equal(input.value, '1');
});

test('number field modifiers use coarse and fine stepping', () => {
  const coarse = fakeInput({ value: '1', step: '0.01' });
  assert.equal(handleNumberFieldWheel(fakeWheel(coarse, { deltaY: -1, shiftKey: true })), true);
  assert.equal(coarse.value, '1.1');

  const fine = fakeInput({ value: '1', step: '0.01' });
  assert.equal(handleNumberFieldWheel(fakeWheel(fine, { deltaY: -1, altKey: true })), true);
  assert.equal(fine.value, '1.001');
});

test('number field arrow keys step focused controls without browser double-step', () => {
  const input = fakeInput({ value: '2', step: '1' });
  const down = fakeKey(input, { key: 'ArrowDown' });

  assert.equal(handleNumberFieldKeydown(down), true);
  assert.equal(down.prevented, true);
  assert.equal(input.value, '1');

  const up = fakeKey(input, { key: 'ArrowUp', shiftKey: true });
  assert.equal(handleNumberFieldKeydown(up), true);
  assert.equal(input.value, '11');
});

test('number field stepping respects min and max bounds', () => {
  const input = fakeInput({ value: '1', step: '1', min: '0', max: '1' });

  const result = stepNumberField(input, 1);

  assert.equal(result.applied, false);
  assert.equal(result.reason, 'unchanged');
  assert.equal(input.value, '1');
  assert.deepEqual(input.events, []);
});

test('wheelDirection maps vertical and horizontal deltas to numeric directions', () => {
  assert.equal(wheelDirection({ deltaY: -1, deltaX: 0 }), 1);
  assert.equal(wheelDirection({ deltaY: 1, deltaX: 0 }), -1);
  assert.equal(wheelDirection({ deltaY: 0, deltaX: -4 }), 1);
  assert.equal(wheelDirection({ deltaY: 0, deltaX: 0 }), 0);
});
