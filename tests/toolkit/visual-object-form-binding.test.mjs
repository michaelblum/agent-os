import { test } from 'node:test';
import assert from 'node:assert/strict';
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

function radialState() {
  return {
    radial_menu: {
      'example.radial.main': {
        selected_item_id: 'inspect',
        items: {
          inspect: {
            geometry: { radiusScale: 1 },
            hidden: false,
          },
        },
      },
    },
  };
}

function resolvedExampleMenu() {
  return resolveRadialMenuConfig({
    kind: 'aos.radial_menu_3d',
    schema_version: '2026-05-16',
    id: 'example.radial.main',
    extends: 'aos://toolkit/runtime/radial-menu/default-3d.json',
    items: [{
      id: 'inspect',
      label: 'Inspect',
      action: 'inspect',
      geometry: { type: 'glyph', glyph: 'inspect', radiusScale: 1 },
    }],
  }, {
    allowExtends: {
      'aos://toolkit/runtime/radial-menu/default-3d.json': default3d,
    },
  });
}

test('form binding applies radial menu transform and strict boolean routes from field changes', () => {
  const descriptors = createRadialMenuVisualObjectDescriptors({
    menu: resolvedExampleMenu(),
    selectedItemId: 'inspect',
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
    descriptor_id: 'radial-menu-example.radial.main-inspect-radius-scale',
    value: '1.75',
  }, options);
  const visible = applyVisualObjectFormFieldChange({
    id: 'visible',
    binding: {
      state_path: 'radial_menu.example.radial.main.items.inspect.hidden',
      route: 'canvas_object.visibility.patch',
    },
    value: 'false',
  }, options);

  assert.equal(radius.update.value, 1.75);
  assert.equal(visible.update.value, true);
  assert.equal(state.radial_menu['example.radial.main'].items.inspect.geometry.radiusScale, 1.75);
  assert.equal(state.radial_menu['example.radial.main'].items.inspect.hidden, true);
  assert.deepEqual(calls, [
    ['route', 'canvas_object.transform.patch', 'radial-menu-example.radial.main-inspect-radius-scale', 1.75],
    ['sync', 'resolveRadialMenuConfig', 'radial-menu-example.radial.main-inspect-radius-scale'],
    ['sync', 'renderRadialMenuPreview', 'radial-menu-example.radial.main-inspect-radius-scale'],
    ['route', 'canvas_object.visibility.patch', 'radial-menu-example.radial.main-inspect-visible', true],
    ['sync', 'resolveRadialMenuConfig', 'radial-menu-example.radial.main-inspect-visible'],
    ['sync', 'renderRadialMenuPreview', 'radial-menu-example.radial.main-inspect-visible'],
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
