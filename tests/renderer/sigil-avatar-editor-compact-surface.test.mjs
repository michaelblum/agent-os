import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createSigilAvatarCompactControlSurface,
} from '../../apps/sigil/avatar-editor/compact-surface.js';
import {
  buildSigilAvatarCompactSurfaceViewModel,
} from '../../apps/sigil/avatar-editor/surface-view-model.js';
import { FakeEvent } from '../toolkit/dom-fixture.mjs';
import { createDocument, patchSpreadSupport } from '../toolkit/zag-adapter-test-utils.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

function createPatchedDocument() {
  const document = createDocument();
  const createElement = document.createElement.bind(document);
  document.createElement = (tagName) => patchSpreadSupport(createElement(tagName));
  return document;
}

function avatarState(overrides = {}) {
  const avatar = {
    shape: {
      type: 12,
      size: { base: 153, min: 40, max: 400 },
      tesseron: { enabled: false, proportion: 0.5, matchMother: true },
      stellationFactor: 0.25,
      params: {
        tetartoid: { a: 0.8, b: 1.2, c: 1.6 },
        torus: { radius: 1.1, tube: 0.25, arc: 0.75 },
        cylinder: { topRadius: 0.4, bottomRadius: 1.3, height: 2.4, sides: 9 },
        box: { width: 1.4, height: 0.8, depth: 2.1 },
      },
    },
    appearance: {
      opacity: 0.8,
      edgeOpacity: 0.6,
      interiorEdges: false,
      specular: true,
      colors: {
        face: ['#112233', '#445566'],
        edge: ['#ffffff', '#88ccff'],
        aura: ['#4488ff', '#0044aa'],
        lightning: ['#ffffff', '#00ffff'],
        magnetic: ['#4488ff', '#0044aa'],
      },
    },
    effects: {
      aura: { reach: 1.4, intensity: 1.2 },
      phenomena: {
        pulsar: { enabled: false },
        accretion: { enabled: false },
        gamma: { enabled: true },
        neutrino: { enabled: false },
      },
      lightning: { enabled: true },
      magnetic: { enabled: true },
      trail: { enabled: true, length: 12, opacity: 0.45, fadeMs: 800, style: 'omega' },
      omega: {
        enabled: true,
        shape: {
          type: 8,
          tesseron: { enabled: false, proportion: 0.45, matchMother: true },
          stellationFactor: 0.1,
        },
        scale: 1.75,
        counterSpin: true,
        lockPosition: false,
      },
    },
  };
  return {
    avatar,
    currentGeometryType: 12,
    currentType: 12,
    avatarBase: 153,
    currentOpacity: 0.8,
    currentEdgeOpacity: 0.6,
    isInteriorEdgesEnabled: false,
    isSpecularEnabled: true,
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
    tesseron: { enabled: false, proportion: 0.5, matchMother: true },
    stellationFactor: 0.25,
    isOmegaEnabled: true,
    omegaGeometryType: 8,
    omegaType: 8,
    omegaTesseron: { enabled: false, proportion: 0.45, matchMother: true },
    omegaStellationFactor: 0.1,
    omegaScale: 1.75,
    omegaCounterSpin: true,
    omegaLockPosition: false,
    auraReach: 1.4,
    auraIntensity: 1.2,
    isPulsarEnabled: false,
    isAccretionEnabled: false,
    isGammaEnabled: true,
    isNeutrinosEnabled: false,
    isLightningEnabled: true,
    isMagneticEnabled: true,
    isTrailEnabled: true,
    trailLength: 12,
    trailOpacity: 0.45,
    trailFadeMs: 800,
    trailStyle: 'omega',
    transitionFastTravelEffect: 'line',
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

function mount(input = avatarState(), options = {}) {
  const document = createPatchedDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const surface = createSigilAvatarCompactControlSurface(container, input, {
    document,
    ...options,
  });
  return { document, container, surface };
}

function controlByDescriptor(viewModel, descriptorId) {
  for (const tab of viewModel.tabs) {
    for (const section of tab.sections) {
      const control = section.controls.find((item) => item.descriptor_id === descriptorId);
      if (control) return { tab, section, control };
    }
  }
  return null;
}

function containsElement(parent, child) {
  for (let cursor = child; cursor; cursor = cursor.parentElement) {
    if (cursor === parent) return true;
  }
  return false;
}

function setRect(element, rect) {
  element.getBoundingClientRect = () => ({
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
  });
}

test('compact avatar control surface renders toolkit tabs and section forms from the avatar object graph view model', () => {
  const viewModel = buildSigilAvatarCompactSurfaceViewModel(avatarState());
  const { surface } = mount(viewModel);
  const alphaGeometry = controlByDescriptor(viewModel, 'sigil-menu-shape-select').control;
  const alphaOpacity = controlByDescriptor(viewModel, 'sigil-menu-opacity').control;

  assert.equal(surface.el.getAttribute('data-sigil-avatar-control-surface'), '');
  assert.equal(surface.el.dataset.sigilTheme, 'avatar-control-surface');
  assert.equal(surface.el.dataset.themedSurface, 'sigil.avatar-control-surface');
  assert.equal(surface.el.querySelectorAll('[data-aos-tabs-trigger]').length, 5);
  assert.equal(surface.el.querySelector('[data-aos-tabs-trigger]').getAttribute('aria-selected'), 'true');
  assert.equal(surface.el.querySelectorAll('.aos-form-section').length >= 4, true);
  assert.equal(surface.el.querySelectorAll('[data-aos-slider-root]').length > 0, true);
  assert.equal(surface.el.querySelectorAll('[data-aos-select-trigger]').length > 0, true);
  assert.ok(Array.from(surface.el.querySelectorAll('[data-aos-tabs-trigger]'))
    .some((element) => element.dataset.value === 'shortcuts' && element.textContent === 'Tools'));

  const values = surface.getValues();
  assert.equal(values.alpha['primary-polyhedron'][alphaGeometry.id], 12);
  assert.equal(values.alpha['primary-polyhedron'][alphaOpacity.id], 0.8);
  assert.equal(surface.getForm('alpha:primary-polyhedron').getField(alphaOpacity.id).field.kind, 'slider');
  assert.equal(surface.getForm('alpha:primary-polyhedron').getField(alphaOpacity.id).field.max, 1);
});

test('compact avatar control surface renders Prism as a geometry option', () => {
  const viewModel = buildSigilAvatarCompactSurfaceViewModel(avatarState());
  const { surface } = mount(viewModel);
  const { control: alphaGeometry } = controlByDescriptor(viewModel, 'sigil-menu-shape-select');
  const field = surface.getForm('alpha:primary-polyhedron').getField(alphaGeometry.id);

  field.control.open();

  const options = Array.from(field.control.el.querySelectorAll('[data-aos-select-item]'));
  assert.ok(options.some((element) => element.dataset.value === '93' && element.textContent === 'Prism'));

  const prism = options.find((element) => element.dataset.value === '93');
  prism.dispatchEvent(new FakeEvent('click', { bubbles: true }));

  assert.equal(field.control.getValue(), 93);
});

test('compact avatar control surface reports form changes with tab, section, and avatar graph context', () => {
  const viewModel = buildSigilAvatarCompactSurfaceViewModel(avatarState());
  const changes = [];
  const { surface } = mount(viewModel, {
    onControlChange: (payload) => changes.push(payload),
  });
  const { control: alphaOpacity } = controlByDescriptor(viewModel, 'sigil-menu-opacity');
  const alphaForm = surface.getForm('alpha:primary-polyhedron');

  alphaForm.setValues({ [alphaOpacity.id]: 0.45 });

  assert.equal(changes.length, 1);
  assert.equal(changes[0].tab.key, 'alpha');
  assert.equal(changes[0].section.key, 'primary-polyhedron');
  assert.equal(changes[0].avatar_id, 'avatar-main');
  assert.equal(changes[0].values[alphaOpacity.id], 0.45);
});

test('compact avatar control surface exposes descriptor-addressed AOS control records', () => {
  const viewModel = buildSigilAvatarCompactSurfaceViewModel(avatarState());
  const { surface } = mount(viewModel);
  const { control: alphaOpacity } = controlByDescriptor(viewModel, 'sigil-menu-opacity');
  const form = surface.getForm('alpha:primary-polyhedron');
  const sliderControl = form.getField(alphaOpacity.id).control.el.querySelector('[data-aos-slider-control]');

  setRect(sliderControl, { left: 24, top: 84, width: 180, height: 28 });

  const record = surface.getControlRecordByDescriptorId('sigil-menu-opacity');
  const records = surface.getControlRecords();

  assert.equal(record.ref, 'aos.control:sigil-menu-opacity');
  assert.equal(record.role, 'AXSlider');
  assert.equal(record.name, 'Face Opacity');
  assert.equal(record.value, 0.8);
  assert.equal(record.surface, 'sigil.avatar.compact_control_surface');
  assert.deepEqual(record.bounds, { left: 24, top: 84, width: 180, height: 28 });
  assert.ok(records.some((item) => (
    item.descriptor_id === 'sigil-menu-fast-travel-effect'
    && item.role === 'AXRadioGroup'
    && item.options.some((option) => option.value === 'wormhole')
  )));
});

test('compact avatar control surface exposes AOS-native tab control records', () => {
  const { surface } = mount();
  const alphaTrigger = surface.el.querySelectorAll('[data-aos-tabs-trigger]')
    .find((element) => element.dataset.value === 'alpha');
  const omegaTrigger = surface.el.querySelectorAll('[data-aos-tabs-trigger]')
    .find((element) => element.dataset.value === 'omega');

  setRect(alphaTrigger, { left: 12, top: 20, width: 56, height: 24 });
  setRect(omegaTrigger, { left: 132, top: 20, width: 72, height: 24 });

  let alphaRecord = surface.getControlRecords().find((record) => record.ref === 'aos.tab:alpha');
  let omegaRecord = surface.getControlRecords().find((record) => record.ref === 'aos.tab:omega');

  assert.equal(alphaRecord.id, 'alpha');
  assert.equal(alphaRecord.value, 'alpha');
  assert.equal(alphaRecord.role, 'AXTab');
  assert.equal(alphaRecord.name, 'Alpha');
  assert.equal(alphaRecord.label, 'Alpha');
  assert.equal(alphaRecord.selected, true);
  assert.equal(alphaRecord.current, true);
  assert.equal(alphaRecord.enabled, true);
  assert.deepEqual(alphaRecord.bounds, { left: 12, top: 20, width: 56, height: 24 });
  assert.deepEqual(alphaRecord.actions, ['select']);
  assert.equal(alphaRecord.surface, 'sigil.avatar.compact_control_surface');

  assert.equal(omegaRecord.selected, false);
  assert.equal(omegaRecord.current, false);

  surface.setActiveTab('omega');
  alphaRecord = surface.getControlRecords().find((record) => record.ref === 'aos.tab:alpha');
  omegaRecord = surface.getControlRecords().find((record) => record.ref === 'aos.tab:omega');

  assert.equal(alphaRecord.selected, false);
  assert.equal(alphaRecord.current, false);
  assert.equal(omegaRecord.selected, true);
  assert.equal(omegaRecord.current, true);
});

test('compact avatar control surface can bind a real canonical control through visual object descriptors', () => {
  const state = avatarState();
  const viewModel = buildSigilAvatarCompactSurfaceViewModel(state);
  const routeCalls = [];
  const syncCalls = [];
  const controlChanges = [];
  const { surface } = mount(viewModel, {
    visualObjectBinding: {
      state,
      routeHandlers: {
        'canvas_object.effects.patch': ({ mutation }) => routeCalls.push({
          descriptor_id: mutation.descriptor_id,
          state_path: mutation.state_path,
          value: mutation.value,
        }),
      },
      rendererSyncHandlers: {
        updatePrimaryAppearance: ({ mutation }) => syncCalls.push({
          descriptor_id: mutation.descriptor_id,
          value: mutation.value,
        }),
      },
    },
    onControlChange: (payload) => controlChanges.push(payload),
  });
  const { control: alphaOpacity } = controlByDescriptor(viewModel, 'sigil-menu-opacity');
  const form = surface.getForm('alpha:primary-polyhedron');
  const field = form.getField(alphaOpacity.id);
  const root = field.control.el;

  field.control.setValue(0.42, { emit: true });

  assert.equal(state.avatar.appearance.opacity, 0.42);
  assert.deepEqual(routeCalls, [{
    descriptor_id: 'sigil.avatar.primary-polyhedron.avatar.appearance.opacity',
    state_path: 'avatar.appearance.opacity',
    value: 0.42,
  }]);
  assert.deepEqual(syncCalls, [{
    descriptor_id: 'sigil.avatar.primary-polyhedron.avatar.appearance.opacity',
    value: 0.42,
  }]);
  assert.equal(form.getField(alphaOpacity.id).control.el, root);
  assert.equal(JSON.parse(JSON.stringify(state.avatar)).appearance.opacity, 0.42);
  assert.equal(controlChanges.length, 1);
  assert.equal(controlChanges[0].values[alphaOpacity.id], 0.42);
});

test('compact avatar control surface reveals geometry parameter sliders for the selected shape', () => {
  const viewModel = buildSigilAvatarCompactSurfaceViewModel(avatarState());
  const { surface } = mount(viewModel);
  const { control: alphaGeometry } = controlByDescriptor(viewModel, 'sigil-menu-shape-select');
  const { control: prismSides } = controlByDescriptor(viewModel, 'sigil-menu-prism-sides');
  const { control: tetartoidA } = controlByDescriptor(viewModel, 'sigil-menu-tetartoid-a');
  const alphaForm = surface.getForm('alpha:primary-polyhedron');

  assert.equal(alphaForm.getField(prismSides.id).hidden, true);
  assert.equal(alphaForm.getField(tetartoidA.id).hidden, true);

  alphaForm.setValues({ [alphaGeometry.id]: 93 });

  assert.equal(alphaForm.getField(prismSides.id).hidden, false);
  assert.equal(alphaForm.getField(tetartoidA.id).hidden, true);
  assert.equal(alphaForm.getField(prismSides.id).field.kind, 'slider');
  assert.equal(alphaForm.getField(prismSides.id).field.max, 64);
  assert.equal(alphaForm.getValues()[prismSides.id], 9);

  alphaForm.setValues({ [alphaGeometry.id]: 90 });

  assert.equal(alphaForm.getField(prismSides.id).hidden, true);
  assert.equal(alphaForm.getField(tetartoidA.id).hidden, false);
  assert.equal(alphaForm.getValues()[tetartoidA.id], 0.8);
});

test('compact avatar surface theme hides inactive conditional form controls', () => {
  const css = readFileSync(`${repoRoot}/apps/sigil/theme/avatar-control-surface.css`, 'utf8');

  assert.match(css, /\.sigil-avatar-control-surface \.aos-form-section\.hidden,\s*\.sigil-avatar-control-surface \.aos-form-field\.hidden\s*\{\s*display: none;/);
});

test('compact avatar control surface can switch active tabs through the toolkit tabs adapter', () => {
  const { surface } = mount();
  const omegaTrigger = surface.el.querySelectorAll('[data-aos-tabs-trigger]')
    .find((element) => element.dataset.value === 'omega');
  const omegaPanel = surface.el.querySelectorAll('.sigil-avatar-control-surface__panel')
    .find((element) => element.dataset.value === 'omega');

  assert.equal(surface.getActiveTab(), 'alpha');
  surface.setActiveTab('omega');

  assert.equal(surface.getActiveTab(), 'omega');
  assert.equal(omegaTrigger.getAttribute('aria-selected'), 'true');
  assert.equal(omegaPanel.hidden, false);
});

test('compact avatar control surface keeps projection shortcuts separate from canonical avatar edit forms', () => {
  const projectionActions = [];
  const projectionChanges = [];
  const { surface } = mount(avatarState({ gridMode: 'off' }), {
    onProjectionAction: (payload) => projectionActions.push(payload),
    onProjectionChange: (payload) => projectionChanges.push(payload),
  });
  const inspector = surface.projectionButtons.get('toggle-inspector');
  const projectionForm = surface.getProjectionForm();
  const panels = Array.from(surface.el.querySelectorAll('[data-aos-tabs-content]'));
  const alphaPanel = panels.find((element) => element.dataset.value === 'alpha');
  const shortcutsPanel = panels.find((element) => element.dataset.value === 'shortcuts');

  assert.ok(inspector);
  assert.ok(projectionForm);
  assert.ok(shortcutsPanel);
  assert.equal(shortcutsPanel.hidden, true);
  assert.equal(containsElement(alphaPanel, inspector.el), false);
  assert.equal(containsElement(shortcutsPanel, inspector.el), true);
  assert.equal(surface.getValues().projection_tools['projection-tools']['sigil-menu-grid-mode'], 'off');

  surface.setActiveTab('shortcuts');

  assert.equal(shortcutsPanel.hidden, false);

  inspector.el.dispatchEvent(new FakeEvent('click', { bubbles: true }));
  projectionForm.setValues({ 'sigil-menu-grid-mode': 'grid' });

  assert.equal(projectionActions.length, 1);
  assert.equal(projectionActions[0].action_id, 'surface-inspector');
  assert.equal(projectionActions[0].avatar_id, 'avatar-main');
  assert.equal(projectionChanges.length, 1);
  assert.equal(projectionChanges[0].values['sigil-menu-grid-mode'], 'grid');
});

test('compact avatar control surface destroys toolkit forms, tabs, and projection controls', () => {
  const { container, surface } = mount();

  assert.equal(container.children.length, 1);
  surface.destroy();

  assert.equal(container.children.length, 0);
  assert.equal(surface.forms.size, 0);
  assert.equal(surface.projectionButtons.size, 0);
});
