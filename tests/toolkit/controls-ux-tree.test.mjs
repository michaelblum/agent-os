import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTROL_UX_TREE_RUNTIME_STATE,
  createButtonGroupUxTreeFragment,
  createButtonUxTreeFragment,
  createToggleUxTreeFragment,
} from '../../packages/toolkit/controls/index.js';
import { uxTreeBindingsForGesture, uxTreeRelationsByType } from '../../packages/toolkit/runtime/ux-tree.js';

function assertJsonOnly(value) {
  assert.deepEqual(JSON.parse(JSON.stringify(value)), value);
}

function assertSourceRefs(value, expected) {
  assert.deepEqual(value.source_refs, [
    expected,
    { id: 'toolkit-controls-ux-tree', kind: 'source', ref: 'packages/toolkit/controls/ux-tree.js' },
  ]);
}

test('button UX tree fragment describes activation gestures without runtime callbacks', () => {
  const fragment = createButtonUxTreeFragment({
    id: 'save-button',
    label: 'Save',
    variant: 'primary',
    disabled: true,
    onClick() {},
    document: { createElement() {} },
  });

  assert.equal(fragment.validation.ok, true);
  assertSourceRefs(fragment, { id: 'toolkit-controls-button', kind: 'source', ref: 'packages/toolkit/controls/button.js' });
  assert.equal(fragment.metadata.runtime_state, CONTROL_UX_TREE_RUNTIME_STATE);
  assert.deepEqual(fragment.nodes.map((node) => node.id), ['save-button']);
  assert.equal(fragment.nodes[0].metadata.state.disabled, true);
  assert.equal(fragment.commands[0].handler_ref, 'toolkit.controls.button.activate');
  assert.deepEqual(fragment.bindings.map((binding) => binding.gesture), [
    'pointer.left.click',
    'keyboard.enter',
    'keyboard.space',
  ]);
  assertJsonOnly(fragment);
  assert.doesNotMatch(JSON.stringify(fragment), /onClick|createElement/);
});

test('toggle UX tree fragment describes change gestures and current state as data', () => {
  const fragment = createToggleUxTreeFragment({
    id: 'snap-toggle',
    label: 'Snap',
    checked: true,
    disabled: false,
    name: 'snap',
    onChange() {},
  });

  assert.equal(fragment.validation.ok, true);
  assertSourceRefs(fragment, { id: 'toolkit-controls-toggle', kind: 'source', ref: 'packages/toolkit/controls/toggle.js' });
  assert.equal(fragment.nodes[0].role, 'switch');
  assert.deepEqual(fragment.nodes[0].metadata.state, {
    checked: true,
    disabled: false,
    name: 'snap',
  });
  assert.equal(fragment.commands[0].id, 'snap-toggle.toggle');
  assert.equal(fragment.commands[0].handler_ref, 'toolkit.controls.toggle.change');
  assert.deepEqual(fragment.bindings.map((binding) => binding.gesture), [
    'pointer.left.click',
    'keyboard.space',
  ]);
  assertJsonOnly(fragment);
});

test('segmented button group UX tree fragment owns option nodes and maps select/navigation gestures', () => {
  const fragment = createButtonGroupUxTreeFragment({
    id: 'view-mode',
    label: 'View Mode',
    value: 'preview',
    options: [
      { value: 'edit', label: 'Edit' },
      { value: 'preview', label: 'Preview' },
      { value: 'diff', label: 'Diff', danger: true },
    ],
  });

  assert.equal(fragment.validation.ok, true);
  assertSourceRefs(fragment, { id: 'toolkit-controls-button-group', kind: 'source', ref: 'packages/toolkit/controls/button-group.js' });
  assert.deepEqual(fragment.nodes.map((node) => node.id), [
    'view-mode',
    'view-mode.edit',
    'view-mode.preview',
    'view-mode.diff',
  ]);
  assert.deepEqual(fragment.nodes[0].children, ['view-mode.edit', 'view-mode.preview', 'view-mode.diff']);
  assert.equal(fragment.nodes[2].metadata.state.selected, true);
  assert.equal(fragment.commands.find((command) => command.id === 'view-mode.preview.select').parameters.value, 'preview');
  assert.deepEqual(uxTreeRelationsByType(fragment, 'owns').map((relation) => relation.to_node_id), [
    'view-mode.edit',
    'view-mode.preview',
    'view-mode.diff',
  ]);
  assert.deepEqual(uxTreeBindingsForGesture(fragment, {
    nodeId: 'view-mode.preview',
    gesture: 'pointer.left.click',
  }).map((binding) => binding.command_id), ['view-mode.preview.select']);
  assert.deepEqual(uxTreeBindingsForGesture(fragment, {
    nodeId: 'view-mode.preview',
    gesture: 'keyboard.arrow_right',
  }).map((binding) => binding.command_id), ['view-mode.select_next']);
  assert.deepEqual(uxTreeBindingsForGesture(fragment, {
    nodeId: 'view-mode.preview',
    gesture: 'keyboard.arrow_left',
  }).map((binding) => binding.command_id), ['view-mode.select_previous']);
  assertJsonOnly(fragment);
});

test('control UX tree helpers reject unsafe handler refs', () => {
  assert.throws(
    () => createButtonUxTreeFragment({ id: 'unsafe', uxHandlerRef: 'alert(1)' }),
    /allowlisted reference/,
  );
});
