import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSigilAvatarEditorModel } from '../../apps/sigil/avatar-editor/model.js';
import { buildSigilAvatarCompactSurfaceViewModel } from '../../apps/sigil/avatar-editor/surface-view-model.js';
import sigilMenu from '../../apps/sigil/renderer/radial-menu/sigil-radial-menu.json' with { type: 'json' };
import default3d from '../../packages/toolkit/runtime/radial-menu/default-3d.json' with { type: 'json' };
import { createSlider } from '../../packages/toolkit/controls/slider.js';
import { createForm } from '../../packages/toolkit/panel/form.js';
import { resolveRadialMenuConfig } from '../../packages/toolkit/runtime/radial-menu-config.js';
import { createRadialMenuVisualObjectDescriptors } from '../../packages/toolkit/workbench/radial-menu-subject.js';
import {
  createToolkitSliderVisualObjectDescriptor,
  createVisualObjectDescriptor,
} from '../../packages/toolkit/workbench/visual-object-contract.js';
import {
  applyVisualObjectFormFieldChange,
  bindVisualObjectForm,
  findVisualObjectFormDescriptor,
} from '../../packages/toolkit/workbench/visual-object-form-binding.js';
import { createDocument, patchSpreadSupport } from './zag-adapter-test-utils.mjs';

function createPatchedDocument() {
  const document = createDocument();
  const createElement = document.createElement.bind(document);
  document.createElement = (tagName) => patchSpreadSupport(createElement(tagName));
  return document;
}

function avatarState() {
  return {
    avatar: {
      shape: {
        type: 12,
        stellationFactor: 0.25,
        params: {
          cylinder: { height: 2.4, sides: 9 },
          tetartoid: { a: 0.8, b: 1.2, c: 1.6 },
          torus: { radius: 1.1, tube: 0.25, arc: 0.75 },
          box: { width: 1.4, height: 0.8, depth: 2.1 },
        },
        tesseron: { enabled: false, proportion: 0.5, matchMother: true },
      },
      appearance: { opacity: 0.8, edgeOpacity: 0.6, colors: { face: ['#112233', '#445566'] } },
      effects: {
        omega: { enabled: true, shape: { type: 8, params: { tetartoid: {}, torus: {}, cylinder: {}, box: {} }, tesseron: {} } },
        lightning: { enabled: true },
        aura: {},
        phenomena: {},
        magnetic: {},
        trail: {},
      },
    },
  };
}

function radialState() {
  return {
    radial_menu: {
      'sigil.radial.main': {
        selected_item_id: 'wiki-graph',
        items: {
          'wiki-graph': {
            geometry: { radiusScale: 1 },
            hidden: false,
          },
        },
      },
    },
  };
}

function resolvedSigilMenu() {
  return resolveRadialMenuConfig(sigilMenu, {
    allowExtends: {
      'aos://toolkit/runtime/radial-menu/default-3d.json': default3d,
    },
  });
}

test('form binding resolves Sigil avatar surface metadata to descriptors and controller handlers', () => {
  const state = avatarState();
  const model = buildSigilAvatarEditorModel(state);
  const viewModel = buildSigilAvatarCompactSurfaceViewModel(model);
  const alphaControls = viewModel.tabs.find((tab) => tab.key === 'alpha').sections.flatMap((section) => section.controls);
  const opacityControl = alphaControls.find((control) => control.descriptor_id === 'sigil-menu-opacity');
  const calls = [];

  const result = applyVisualObjectFormFieldChange({
    id: opacityControl.id,
    value: '0.42',
    field: opacityControl,
    binding: opacityControl.binding,
  }, {
    descriptors: model.visual_object_descriptors,
    state,
    routeHandlers: {
      'canvas_object.effects.patch': ({ mutation }) => calls.push(['route', mutation.descriptor_id, mutation.value]),
    },
    rendererSyncHandlers: {
      updatePrimaryAppearance: ({ mutation }) => calls.push(['sync', mutation.descriptor_id, mutation.value]),
    },
  });

  assert.equal(result.field_id, opacityControl.id);
  assert.equal(result.binding.descriptor_id, 'sigil.avatar.primary-polyhedron.avatar.appearance.opacity');
  assert.equal(result.update.route, 'canvas_object.effects.patch');
  assert.equal(state.avatar.appearance.opacity, 0.42);
  assert.deepEqual(calls, [
    ['route', 'sigil.avatar.primary-polyhedron.avatar.appearance.opacity', 0.42],
    ['sync', 'sigil.avatar.primary-polyhedron.avatar.appearance.opacity', 0.42],
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
});

test('form binding applies radial menu transform and strict boolean routes from field changes', () => {
  const descriptors = createRadialMenuVisualObjectDescriptors({
    menu: resolvedSigilMenu(),
    selectedItemId: 'wiki-graph',
  });
  const state = radialState();
  const calls = [];
  const options = {
    descriptors,
    state,
    routeHandlers: {
      'canvas_object.transform.patch': ({ mutation }) => calls.push(['route', mutation.route, mutation.descriptor_id, mutation.value]),
      'canvas_object.visibility.patch': ({ mutation }) => calls.push(['route', mutation.route, mutation.descriptor_id, mutation.value]),
    },
    rendererSyncHandlers: {
      resolveRadialMenuConfig: ({ mutation }) => calls.push(['sync', 'resolveRadialMenuConfig', mutation.descriptor_id]),
      renderRadialMenuPreview: ({ mutation }) => calls.push(['sync', 'renderRadialMenuPreview', mutation.descriptor_id]),
    },
  };

  const radius = applyVisualObjectFormFieldChange({
    id: 'radiusScale',
    descriptor_id: 'radial-menu-sigil.radial.main-wiki-graph-radius-scale',
    value: '1.75',
  }, options);
  const visible = applyVisualObjectFormFieldChange({
    id: 'visible',
    binding: {
      state_path: 'radial_menu.sigil.radial.main.items.wiki-graph.hidden',
      route: 'canvas_object.visibility.patch',
    },
    value: 'false',
  }, options);

  assert.equal(radius.update.value, 1.75);
  assert.equal(visible.update.value, true);
  assert.equal(state.radial_menu['sigil.radial.main'].items['wiki-graph'].geometry.radiusScale, 1.75);
  assert.equal(state.radial_menu['sigil.radial.main'].items['wiki-graph'].hidden, true);
  assert.deepEqual(calls, [
    ['route', 'canvas_object.transform.patch', 'radial-menu-sigil.radial.main-wiki-graph-radius-scale', 1.75],
    ['sync', 'resolveRadialMenuConfig', 'radial-menu-sigil.radial.main-wiki-graph-radius-scale'],
    ['sync', 'renderRadialMenuPreview', 'radial-menu-sigil.radial.main-wiki-graph-radius-scale'],
    ['route', 'canvas_object.visibility.patch', 'radial-menu-sigil.radial.main-wiki-graph-visible', true],
    ['sync', 'resolveRadialMenuConfig', 'radial-menu-sigil.radial.main-wiki-graph-visible'],
    ['sync', 'renderRadialMenuPreview', 'radial-menu-sigil.radial.main-wiki-graph-visible'],
  ]);
});

test('bound toolkit slider form updates through setValue without replacing the root element', () => {
  const document = createPatchedDocument();
  const container = document.createElement('section');
  document.body.appendChild(container);
  const descriptor = createToolkitSliderVisualObjectDescriptor({
    id: 'toolkit-slider-opacity',
    label: 'Opacity',
    state_path: 'toolkit.controls.opacity.value',
    min: 0,
    max: 1,
    step: 0.05,
    object_ids: ['dom.aos-slider.opacity'],
  });
  const state = { toolkit: { controls: { opacity: { value: 0.2 } } } };
  const form = createForm(container, [{
    id: 'opacity',
    descriptor_id: descriptor.id,
    kind: 'slider',
    value: 0.2,
    min: 0,
    max: 1,
    step: 0.05,
  }]);
  const field = form.getField('opacity');
  const root = field.control.el;

  bindVisualObjectForm(form, {
    descriptors: [descriptor],
    state,
    routeHandlers: {
      'dom_toolkit.control.value.patch': ({ mutation }) => mutation.state_path,
    },
    rendererSyncHandlers: {
      syncDomControlValue: ({ mutation }) => field.control.setValue(mutation.value),
    },
  });
  field.control.setValue(0.65, { emit: true });

  assert.equal(state.toolkit.controls.opacity.value, 0.65);
  assert.equal(field.control.el, root);
  assert.equal(field.control.getValue(), 0.65);
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
});

test('form binding rejects projection-only and missing descriptor bindings clearly', () => {
  const projection = createVisualObjectDescriptor({
    id: 'preview-resource',
    label: 'Preview',
    kind: 'resource',
    projection: { classification: 'projection_only', reason: 'runtime-or-world-projection' },
  });

  assert.throws(
    () => applyVisualObjectFormFieldChange({ id: 'preview-resource', value: true }, { descriptors: [projection], state: {} }),
    /Projection-only descriptor preview-resource cannot be used as a form binding/,
  );
  assert.throws(
    () => applyVisualObjectFormFieldChange({ id: 'missing', value: true }, { descriptors: [], state: {} }),
    /Missing visual object descriptor binding for form field missing/,
  );
  assert.equal(findVisualObjectFormDescriptor({ binding: { state_path: 'missing.path' } }, [projection]), null);
});

test('standalone toolkit slider can still sync through the same form-field payload shape', () => {
  const document = createPatchedDocument();
  const slider = createSlider({ document, value: 0.1, min: 0, max: 1, step: 0.05 });
  const descriptor = createToolkitSliderVisualObjectDescriptor({
    id: 'toolkit-slider-opacity',
    label: 'Opacity',
    state_path: 'toolkit.controls.opacity.value',
    min: 0,
    max: 1,
    step: 0.05,
    object_ids: ['dom.aos-slider.opacity'],
  });
  const root = slider.el;
  const state = { toolkit: { controls: { opacity: { value: 0.1 } } } };

  applyVisualObjectFormFieldChange({
    id: 'opacity',
    value: '0.7',
    binding: { descriptor_id: descriptor.id },
  }, {
    descriptors: [descriptor],
    state,
    routeHandlers: { 'dom_toolkit.control.value.patch': () => undefined },
    rendererSyncHandlers: { syncDomControlValue: ({ mutation }) => slider.setValue(mutation.value) },
  });

  assert.equal(slider.el, root);
  assert.equal(slider.getValue(), 0.7);
  assert.equal(state.toolkit.controls.opacity.value, 0.7);
});
