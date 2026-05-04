import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MENU_ACTIVATION_SCHEMA_VERSION,
  advanceMenuActivation,
  createMenuActivationRequest,
} from '../../packages/toolkit/runtime/menu-activation.js';

test('createMenuActivationRequest normalizes menu item activation', () => {
  const request = createMenuActivationRequest({
    id: 'activation-1',
    menuId: 'sigil.radial',
    input: 'gesture',
    source: 'sigil.avatar',
    item: {
      id: 'wiki-graph',
      label: 'Wiki Graph',
      action: 'wikiGraph',
    },
    surface: {
      kind: 'markdown-workbench',
      subject: { id: 'wiki:aos/concepts/example.md' },
    },
    transition: { preset: 'wiki-brain-zoom-dissolve' },
  });

  assert.equal(request.type, 'aos.menu.activation');
  assert.equal(request.schema_version, MENU_ACTIVATION_SCHEMA_VERSION);
  assert.equal(request.id, 'activation-1');
  assert.equal(request.menu_id, 'sigil.radial');
  assert.equal(request.phase, 'requested');
  assert.equal(request.action, 'wikiGraph');
  assert.deepEqual(request.item, {
    id: 'wiki-graph',
    label: 'Wiki Graph',
    action: 'wikiGraph',
  });
  assert.equal(request.surface.kind, 'markdown-workbench');
  assert.equal(request.transition.preset, 'wiki-brain-zoom-dissolve');
});

test('advanceMenuActivation preserves request identity while updating phase', () => {
  const request = createMenuActivationRequest({
    id: 'activation-2',
    menuId: 'sigil.radial',
    item: { id: 'agent-terminal' },
  });
  const completed = advanceMenuActivation(request, 'completed', {
    result: { canvas_id: 'sigil-agent-terminal' },
  });

  assert.equal(completed.id, request.id);
  assert.equal(completed.phase, 'completed');
  assert.equal(completed.result.canvas_id, 'sigil-agent-terminal');
  assert.equal(request.phase, 'requested');
});

test('createMenuActivationRequest rejects anonymous items', () => {
  assert.throws(() => createMenuActivationRequest({ item: {} }), /requires an item id or action/);
});
