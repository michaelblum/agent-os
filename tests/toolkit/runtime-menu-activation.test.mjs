import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MENU_ACTIVATION_PHASES,
  MENU_ACTIVATION_SCHEMA_VERSION,
  MENU_ACTIVATION_TERMINAL_PHASES,
  advanceMenuActivation,
  createMenuActivationRequest,
  isMenuActivationPhase,
  isTerminalMenuActivationPhase,
  normalizeMenuActivationInput,
  normalizeMenuActivationPhase,
  normalizeMenuActivationTransition,
} from '../../packages/toolkit/runtime/menu-activation.js';

test('menu activation phases are canonical and terminal phases are explicit', () => {
  assert.deepEqual(MENU_ACTIVATION_PHASES, [
    'requested',
    'item_transition',
    'menu_transition',
    'surface_transition',
    'completed',
    'cancelled',
    'failed',
  ]);
  assert.deepEqual(MENU_ACTIVATION_TERMINAL_PHASES, ['completed', 'cancelled', 'failed']);
  assert.equal(isMenuActivationPhase('surface_transition'), true);
  assert.equal(isTerminalMenuActivationPhase('surface_transition'), false);
  assert.equal(isTerminalMenuActivationPhase('failed'), true);
  assert.throws(() => normalizeMenuActivationPhase('done-ish'), /unknown menu activation phase/);
});

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
  assert.deepEqual(request.lifecycle.map((entry) => entry.phase), ['requested']);
  assert.deepEqual(request.input_source, {
    kind: 'gesture',
    source: 'sigil.avatar',
  });
  assert.equal(request.action, 'wikiGraph');
  assert.deepEqual(request.item, {
    id: 'wiki-graph',
    label: 'Wiki Graph',
    action: 'wikiGraph',
  });
  assert.equal(request.surface.kind, 'markdown-workbench');
  assert.deepEqual(request.target_surface, request.surface);
  assert.equal(request.transition.preset, 'wiki-brain-zoom-dissolve');
});

test('menu activation descriptors accept object input and string transition shorthands', () => {
  const request = createMenuActivationRequest({
    id: 'activation-input',
    menuId: 'sigil.radial',
    input: { kind: 'click', device: 'mouse', button: 0 },
    source: 'sigil.radial-target-surface',
    item: { id: 'context-menu' },
    targetSurface: { kind: 'context-menu', canvas_id: 'sigil-context-menu' },
    transition: 'default-menu-open',
  });

  assert.deepEqual(request.input_source, {
    kind: 'click',
    source: 'sigil.radial-target-surface',
    device: 'mouse',
    button: 0,
  });
  assert.equal(request.input, 'click');
  assert.equal(request.source, 'sigil.radial-target-surface');
  assert.equal(request.surface.canvas_id, 'sigil-context-menu');
  assert.equal(request.target_surface.canvas_id, 'sigil-context-menu');
  assert.deepEqual(normalizeMenuActivationInput('keyboard', 'shortcut'), {
    kind: 'keyboard',
    source: 'shortcut',
  });
  assert.deepEqual(normalizeMenuActivationTransition('fade-through'), { preset: 'fade-through' });
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
  assert.equal(completed.previous_phase, 'requested');
  assert.equal(completed.result.canvas_id, 'sigil-agent-terminal');
  assert.equal(request.phase, 'requested');
  assert.deepEqual(completed.lifecycle.map((entry) => entry.phase), ['requested', 'completed']);
});

test('createMenuActivationRequest rejects anonymous items', () => {
  assert.throws(() => createMenuActivationRequest({ item: {} }), /requires an item id or action/);
});

test('activation advancement rejects non-contract phases', () => {
  const request = createMenuActivationRequest({
    id: 'activation-bad-phase',
    menuId: 'sigil.radial',
    item: { id: 'wiki-graph' },
  });

  assert.throws(() => advanceMenuActivation(request, 'opening'), /unknown menu activation phase/);
});
