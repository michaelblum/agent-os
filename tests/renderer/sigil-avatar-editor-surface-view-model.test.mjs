import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSigilAvatarEditorModel,
} from '../../apps/sigil/avatar-editor/model.js';
import {
  buildSigilAvatarCompactSurfaceViewModel,
  buildSigilAvatarWikiBrowserObjectGraphViewModel,
} from '../../apps/sigil/avatar-editor/surface-view-model.js';

function avatarState(overrides = {}) {
  return {
    avatar: {
      shape: {
        type: 12,
        tesseron: { enabled: false, proportion: 0.5, matchMother: true },
        params: {
          tetartoid: { a: 0.8, b: 1.2, c: 1.6 },
          torus: { radius: 1.1, tube: 0.25, arc: 0.75 },
          cylinder: { topRadius: 0.4, bottomRadius: 1.3, height: 2.4, sides: 9 },
          box: { width: 1.4, height: 0.8, depth: 2.1 },
        },
      },
      appearance: {
        colors: {
          face: ['#112233', '#445566'],
          edge: ['#ffffff', '#88ccff'],
          aura: ['#4488ff', '#0044aa'],
          lightning: ['#ffffff', '#00ffff'],
          magnetic: ['#4488ff', '#0044aa'],
        },
      },
      effects: {
        omega: {
          enabled: true,
          shape: {
            type: 8,
            params: {
              tetartoid: { a: 1.8, b: 1.4, c: 1.2 },
              torus: { radius: 0.9, tube: 0.35, arc: 0.5 },
              cylinder: { topRadius: 0.6, bottomRadius: 1.1, height: 1.8, sides: 7 },
              box: { width: 0.9, height: 1.2, depth: 1.7 },
            },
            tesseron: { enabled: false, proportion: 0.45, matchMother: true },
          },
        },
      },
    },
    currentGeometryType: 12,
    omegaGeometryType: 8,
    tetartoidA: 0.8,
    tetartoidB: 1.2,
    tetartoidC: 1.6,
    torusRadius: 1.1,
    torusTube: 0.25,
    torusArc: 0.75,
    cylinderTopRadius: 0.4,
    cylinderBottomRadius: 1.3,
    cylinderHeight: 2.4,
    cylinderSides: 9,
    boxWidth: 1.4,
    boxHeight: 0.8,
    boxDepth: 2.1,
    isOmegaEnabled: true,
    tesseron: { enabled: false, proportion: 0.5, matchMother: true },
    omegaTesseron: { enabled: false, proportion: 0.45, matchMother: true },
    colors: {
      face: ['#112233', '#445566'],
      edge: ['#ffffff', '#88ccff'],
      aura: ['#4488ff', '#0044aa'],
      lightning: ['#ffffff', '#00ffff'],
      magnetic: ['#4488ff', '#0044aa'],
    },
    ...overrides,
  };
}

function tabByKey(viewModel, key) {
  return viewModel.tabs.find((tab) => tab.key === key);
}

function controlsForTab(viewModel, key) {
  return tabByKey(viewModel, key).sections.flatMap((section) => section.controls);
}

test('compact avatar surface view model maps object graph tabs to toolkit form controls', () => {
  const viewModel = buildSigilAvatarCompactSurfaceViewModel(avatarState());

  assert.equal(viewModel.type, 'sigil.avatar.compact_control_surface.view_model');
  assert.equal(viewModel.invocation, 'avatar_right_click');
  assert.equal(viewModel.layout, 'tabs');
  assert.equal(viewModel.object_graph.kind, 'sigil.avatar.object_graph');
  assert.deepEqual(viewModel.tabs.map((tab) => tab.key), ['alpha', 'omega', 'effects', 'travel']);

  const alphaControls = controlsForTab(viewModel, 'alpha');
  const alphaGeometry = alphaControls.find((control) => control.descriptor_id === 'sigil-menu-shape-select');
  assert.equal(alphaGeometry.kind, 'select');
  assert.equal(alphaGeometry.toolkit_control.namespace, 'packages/toolkit/controls');
  assert.equal(alphaGeometry.binding.route, 'canvas_object.transform.patch');
  assert.deepEqual(alphaGeometry.binding.object_ids, ['avatar.primary.shape', 'avatar.primary.tesseron']);
  assert.ok(alphaGeometry.options.some((option) => option.value === 12 && option.label === 'Dodecahedron'));
  assert.ok(alphaGeometry.options.some((option) => option.value === 6 && option.label === 'Box'));
  assert.ok(alphaGeometry.options.some((option) => option.value === 93 && option.label === 'Prism'));
  const alphaOpacity = alphaControls.find((control) => control.descriptor_id === 'sigil-menu-opacity');
  assert.equal(alphaOpacity.kind, 'slider');
  assert.equal(alphaOpacity.toolkit_control.kind, 'slider');
  assert.equal(alphaOpacity.min, 0);
  assert.equal(alphaOpacity.max, 1);
  assert.equal(alphaOpacity.step, 0.01);
  const prismHeight = alphaControls.find((control) => control.descriptor_id === 'sigil-menu-prism-height');
  assert.equal(prismHeight.kind, 'slider');
  assert.equal(prismHeight.binding.state_path, 'avatar.shape.params.cylinder.height');
  assert.equal(prismHeight.value, 2.4);
  assert.equal(prismHeight.visible_when.field, alphaGeometry.id);
  assert.equal(prismHeight.visible_when.equals, 93);

  const omegaControls = controlsForTab(viewModel, 'omega');
  const omegaEnabled = omegaControls.find((control) => control.descriptor_id === 'sigil-menu-omega-enabled');
  assert.equal(omegaEnabled.kind, 'checkbox');
  assert.equal(omegaEnabled.binding.state_path, 'avatar.effects.omega.enabled');
  assert.ok(omegaEnabled.binding.object_ids.includes('avatar.omega.shape'));
  const omegaGeometry = omegaControls.find((control) => control.descriptor_id === 'sigil-menu-omega-shape');
  const omegaTetartoidB = omegaControls.find((control) => control.descriptor_id === 'sigil-menu-omega-tetartoid-b');
  assert.equal(omegaTetartoidB.kind, 'slider');
  assert.equal(omegaTetartoidB.binding.state_path, 'avatar.effects.omega.shape.params.tetartoid.b');
  assert.equal(omegaTetartoidB.value, 1.4);
  assert.equal(omegaTetartoidB.visible_when.field, omegaGeometry.id);
  assert.equal(omegaTetartoidB.visible_when.equals, 90);

  const effectControls = controlsForTab(viewModel, 'effects');
  const lightning = effectControls.find((control) => control.descriptor_id === 'sigil-menu-lightning');
  assert.equal(lightning.kind, 'checkbox');
  assert.equal(lightning.binding.group_key, 'lightning-effects');
  assert.deepEqual(lightning.binding.object_ids, ['avatar.effects.lightning']);
});

test('compact avatar surface separates projection shortcuts from canonical avatar controls', () => {
  const viewModel = buildSigilAvatarCompactSurfaceViewModel(avatarState());
  const inspector = viewModel.projection_tools.find((control) => control.descriptor_id === 'toggle-inspector');
  const gridMode = viewModel.projection_tools.find((control) => control.descriptor_id === 'sigil-menu-grid-mode');

  assert.equal(inspector.kind, 'button');
  assert.equal(inspector.canonical_avatar_edit, false);
  assert.equal(inspector.action_id, 'surface-inspector');
  assert.deepEqual(inspector.binding.object_ids, []);

  assert.equal(gridMode.kind, 'select');
  assert.equal(gridMode.canonical_avatar_edit, false);
  assert.equal(gridMode.binding.route, 'world-context.patch');
  assert.deepEqual(gridMode.options.map((option) => option.value), ['off', 'flat', '3d']);
});

test('wiki browser avatar graph view model exposes drilldown nodes from the same object graph', () => {
  const model = buildSigilAvatarEditorModel(avatarState());
  const viewModel = buildSigilAvatarWikiBrowserObjectGraphViewModel(model);

  assert.equal(viewModel.type, 'sigil.avatar.wiki_browser_object_graph.view_model');
  assert.equal(viewModel.layout, 'object_graph_drilldown');
  assert.equal(viewModel.root_object_id, 'avatar.main');
  assert.equal(viewModel.metadata.canonical_model, 'sigil.avatar.object_graph');

  const root = viewModel.nodes.find((node) => node.object_id === 'avatar.main');
  assert.equal(root.role, 'root');
  assert.ok(root.edges.some((edge) => edge.to === 'avatar.effects.lightning'));

  const primary = viewModel.nodes.find((node) => node.object_id === 'avatar.primary.shape');
  assert.ok(primary.groups.some((group) => group.key === 'primary-polyhedron'));

  const lightning = viewModel.nodes.find((node) => node.object_id === 'avatar.effects.lightning');
  assert.ok(lightning.groups.some((group) => group.key === 'lightning-effects'));
});
