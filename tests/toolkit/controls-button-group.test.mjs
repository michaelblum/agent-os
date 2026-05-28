import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createButtonGroup } from '../../packages/toolkit/controls/button-group.js';
import { FakeEvent, createFakeDocument } from './dom-fixture.mjs';

const options = [
  { value: 'a', label: 'A' },
  { value: 'b', label: 'B' },
  { value: 'c', label: 'C', danger: true },
];

test('createButtonGroup returns shape and reflects initial value', () => {
  const document = createFakeDocument();
  const group = createButtonGroup({ document, options, value: 'b' });
  const buttons = group.el.querySelectorAll('button');

  assert.equal(typeof group.getValue, 'function');
  assert.equal(typeof group.setValue, 'function');
  assert.equal(typeof group.getUxTreeFragment, 'function');
  assert.equal(typeof group.on, 'function');
  assert.equal(typeof group.destroy, 'function');
  assert.equal(buttons[1].getAttribute('aria-pressed'), 'true');
  assert.equal(buttons[2].classList.contains('danger'), true);
});

test('button group setValue and keyboard navigation update value', () => {
  const document = createFakeDocument();
  const group = createButtonGroup({ document, options, value: 'a' });
  const changes = [];
  group.on('change', (value) => changes.push(value));

  group.setValue('b');
  assert.equal(group.getValue(), 'b');
  assert.deepEqual(changes, ['b']);

  const buttons = group.el.querySelectorAll('button');
  buttons[1].dispatchEvent(new FakeEvent('keydown', { key: 'ArrowRight' }));
  assert.equal(group.getValue(), 'c');
  assert.equal(buttons[2].getAttribute('aria-pressed'), 'true');
});

test('createButtonGroup exposes a UX tree fragment for current selected value', () => {
  const document = createFakeDocument();
  const group = createButtonGroup({ document, id: 'view-mode', label: 'View Mode', options, value: 'a' });

  group.setValue('c', { emit: false });

  const fragment = group.getUxTreeFragment();
  const optionNode = fragment.nodes.find((node) => node.id === 'view-mode.c');

  assert.equal(fragment.validation.ok, true);
  assert.equal(fragment.nodes[0].id, 'view-mode');
  assert.equal(fragment.nodes[0].metadata.state.value, 'c');
  assert.equal(optionNode.metadata.state.selected, true);
  assert.deepEqual(fragment.relations.map((relation) => relation.relation_type), ['owns', 'owns', 'owns']);
});

test('button group UX tree selection matches pressed DOM state for string-equivalent values', () => {
  const document = createFakeDocument();
  const group = createButtonGroup({
    document,
    id: 'numeric',
    options: [{ value: 1, label: 'One' }],
    value: 1,
  });

  group.setValue('1', { emit: false });

  const button = group.el.querySelectorAll('button')[0];
  const fragment = group.getUxTreeFragment();
  const optionNode = fragment.nodes.find((node) => node.id === 'numeric.1');

  assert.equal(button.getAttribute('aria-pressed'), 'true');
  assert.equal(optionNode.metadata.state.selected, true);
  assert.equal(optionNode.metadata.state.selected, button.getAttribute('aria-pressed') === 'true');
});
