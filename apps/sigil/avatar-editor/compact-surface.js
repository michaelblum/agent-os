import { toolkitSpecifier } from '../renderer/live-modules/content-roots.js';
import { buildSigilAvatarCompactSurfaceViewModel } from './surface-view-model.js';

const { createAosZagTabs } = await import(toolkitSpecifier('adapters/zag/tabs.js', {
  local: '../../../packages/toolkit/adapters/zag/tabs.js',
}));
const { createButton } = await import(toolkitSpecifier('controls/button.js', {
  local: '../../../packages/toolkit/controls/button.js',
}));
const { createForm } = await import(toolkitSpecifier('panel/form.js', {
  local: '../../../packages/toolkit/panel/form.js',
}));
const { bindVisualObjectForm } = await import(toolkitSpecifier('workbench/visual-object-form-binding.js', {
  local: '../../../packages/toolkit/workbench/visual-object-form-binding.js',
}));

const COMPACT_SURFACE_VIEW_MODEL_TYPE = 'sigil.avatar.compact_control_surface.view_model';

function isCompactSurfaceViewModel(value = {}) {
  return value?.type === COMPACT_SURFACE_VIEW_MODEL_TYPE;
}

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function keyPart(value, fallback = 'item') {
  return text(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || fallback;
}

function appendClass(element, ...names) {
  for (const name of names.flatMap((item) => String(item || '').split(/\s+/))) {
    if (name) element.classList.add(name);
  }
}

function setData(element, name, value) {
  if (value === undefined || value === null || value === false) return;
  element.dataset[name] = String(value);
}

function sectionFormFields(section = {}) {
  return [{
    kind: 'section',
    id: section.key,
    key: section.key,
    label: section.label,
    controls: arrayValue(section.controls),
  }];
}

function projectionFormFields(controls = []) {
  if (!controls.length) return [];
  return [{
    kind: 'section',
    id: 'projection-tools',
    key: 'projection-tools',
    label: 'Surface Shortcuts',
    controls,
  }];
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function visualObjectBindingOptions({ input, viewModel, options }) {
  const binding = objectValue(options.visualObjectBinding);
  const state = binding.state || options.visualObjectState;
  const hasHandlers = binding.routeHandlers || binding.rendererSyncHandlers
    || options.visualObjectRouteHandlers || options.visualObjectRendererSyncHandlers;
  if (!state && !hasHandlers && !options.visualObjectBinding) return null;
  const descriptors = arrayValue(binding.descriptors).length
    ? binding.descriptors
    : arrayValue(viewModel.visual_object_descriptors).length
      ? viewModel.visual_object_descriptors
      : arrayValue(input.visual_object_descriptors);
  if (!state) {
    throw new TypeError('Sigil avatar compact visualObjectBinding requires caller-owned state.');
  }
  if (!descriptors.length) {
    throw new TypeError('Sigil avatar compact visualObjectBinding requires visual object descriptors from the model or view model.');
  }
  return {
    descriptors,
    state,
    routeHandlers: binding.routeHandlers || options.visualObjectRouteHandlers || {},
    rendererSyncHandlers: binding.rendererSyncHandlers || options.visualObjectRendererSyncHandlers || {},
    validate: binding.validate ?? options.visualObjectValidate ?? true,
  };
}

function createHub() {
  const listeners = new Map();
  return {
    on(type, callback) {
      if (typeof callback !== 'function') return () => {};
      const set = listeners.get(type) || new Set();
      set.add(callback);
      listeners.set(type, set);
      return () => set.delete(callback);
    },
    emit(type, payload) {
      for (const callback of listeners.get(type) || []) callback(payload);
    },
    clear() {
      listeners.clear();
    },
  };
}

function createElement(doc, tagName, className = '') {
  const element = doc.createElement(tagName);
  appendClass(element, className);
  return element;
}

function createHeader(doc, viewModel) {
  const headerEl = createElement(doc, 'header', 'sigil-avatar-control-surface__header');
  const titleEl = createElement(doc, 'div', 'sigil-avatar-control-surface__title');
  const metaEl = createElement(doc, 'div', 'sigil-avatar-control-surface__meta');

  titleEl.textContent = 'Avatar';
  metaEl.textContent = text(viewModel.avatar_id, 'avatar-main');
  headerEl.append(titleEl, metaEl);
  return headerEl;
}

function createProjectionTools({
  doc,
  root,
  viewModel,
  emit,
  projectionButtons,
  projectionForms,
  options,
}) {
  const tools = arrayValue(viewModel.projection_tools);
  if (!tools.length) return null;

  const toolsEl = createElement(doc, 'section', 'sigil-avatar-control-surface__projection-tools');
  const titleEl = createElement(doc, 'div', 'sigil-avatar-control-surface__projection-title');
  const actionsEl = createElement(doc, 'div', 'sigil-avatar-control-surface__projection-actions');
  const formEl = createElement(doc, 'div', 'sigil-avatar-control-surface__projection-form');
  const actionControls = tools.filter((control) => control.kind === 'button');
  const formControls = tools.filter((control) => control.kind !== 'button');

  titleEl.textContent = 'Shortcuts';
  toolsEl.append(titleEl);

  if (actionControls.length) {
    toolsEl.appendChild(actionsEl);
    for (const control of actionControls) {
      const button = createButton({
        document: doc,
        label: control.label,
        variant: 'ghost',
        className: 'sigil-avatar-control-surface__projection-action',
        dataset: {
          sigilProjectionToolId: control.id,
          sigilProjectionActionId: control.action_id || control.id,
        },
      });
      button.on('click', (event) => {
        const payload = {
          control,
          action_id: control.action_id || control.id,
          avatar_id: viewModel.avatar_id,
          view_model: viewModel,
          event,
        };
        options.onProjectionAction?.(payload);
        emit('projection-action', payload);
      });
      projectionButtons.set(control.id, button);
      actionsEl.appendChild(button.el);
    }
  }

  if (formControls.length) {
    toolsEl.appendChild(formEl);
    const form = createForm(formEl, projectionFormFields(formControls), {
      document: doc,
      onChange(values) {
        const payload = {
          values,
          controls: formControls,
          avatar_id: viewModel.avatar_id,
          view_model: viewModel,
        };
        options.onProjectionChange?.(payload);
        emit('projection-change', payload);
      },
    });
    projectionForms.set('projection-tools', form);
  }

  root.appendChild(toolsEl);
  return toolsEl;
}

function createSection({
  doc,
  panelEl,
  tab,
  section,
  viewModel,
  forms,
  visualObjectBinding,
  visualObjectBindingDisposers,
  options,
  emit,
}) {
  const sectionEl = createElement(doc, 'section', 'sigil-avatar-control-surface__section');
  const sectionKey = section.key || 'section';
  const formKey = `${tab.key}:${sectionKey}`;

  setData(sectionEl, 'sigilAvatarTab', tab.key);
  setData(sectionEl, 'sigilAvatarSection', sectionKey);
  setData(sectionEl, 'sigilAvatarFacet', section.facet_key);
  setData(sectionEl, 'sigilAvatarObjectIds', arrayValue(section.object_ids).join(' '));

  const form = createForm(sectionEl, sectionFormFields(section), {
    document: doc,
    onChange(values) {
      const payload = {
        tab,
        section,
        values,
        avatar_id: viewModel.avatar_id,
        view_model: viewModel,
      };
      options.onControlChange?.(payload);
      options.onSectionChange?.(payload);
      emit('control-change', payload);
      emit('section-change', payload);
    },
  });
  if (visualObjectBinding) {
    visualObjectBindingDisposers.add(bindVisualObjectForm(form, visualObjectBinding));
  }

  forms.set(formKey, {
    key: formKey,
    tab,
    section,
    form,
    el: sectionEl,
  });
  panelEl.appendChild(sectionEl);
}

function activeTabFromTabsAdapter(tabsAdapter) {
  return tabsAdapter.connect().value;
}

export function createSigilAvatarCompactControlSurface(container, input = {}, options = {}) {
  if (!container?.appendChild && !options.document?.createElement) {
    throw new Error('createSigilAvatarCompactControlSurface requires a DOM container');
  }

  const doc = options.document || container.ownerDocument;
  const viewModel = isCompactSurfaceViewModel(input)
    ? input
    : buildSigilAvatarCompactSurfaceViewModel(input, options);
  const tabs = arrayValue(viewModel.tabs);
  const projectionTools = arrayValue(viewModel.projection_tools);
  const hasProjectionTools = projectionTools.length > 0;
  const renderedTabs = hasProjectionTools
    ? [...tabs, { key: 'shortcuts', label: 'Tools', object_ids: [] }]
    : tabs;
  const firstTab = options.defaultTab
    || renderedTabs.find((tab) => tab.key === options.value)?.key
    || renderedTabs[0]?.key
    || 'alpha';
  const hub = createHub();
  const rootEl = createElement(doc, 'section', [
    'sigil-avatar-control-surface',
    options.className,
  ].join(' '));
  const tabRootEl = createElement(doc, 'div', 'sigil-avatar-control-surface__tabs aos-tab-shell');
  const tabListEl = createElement(doc, 'div', 'sigil-avatar-control-surface__tab-list aos-tabs');
  const panelStackEl = createElement(doc, 'div', 'sigil-avatar-control-surface__panels aos-tab-panels');
  const forms = new Map();
  const projectionForms = new Map();
  const projectionButtons = new Map();
  const panelEls = new Map();
  const triggerEls = new Map();
  const visualObjectBinding = visualObjectBindingOptions({ input, viewModel, options });
  const visualObjectBindingDisposers = new Set();
  let destroyed = false;

  rootEl.setAttribute('data-sigil-avatar-control-surface', '');
  rootEl.setAttribute('data-aos-tabs-root', '');
  rootEl.dataset.sigilTheme = 'avatar-control-surface';
  rootEl.dataset.avatarId = String(viewModel.avatar_id || '');
  rootEl.dataset.themedSurface = String(viewModel.metadata?.themed_surface || '');
  rootEl.dataset.surfaceLayoutKind = String(viewModel.metadata?.surface_layout_kind || '');
  tabListEl.setAttribute('data-aos-tabs-list', '');
  tabListEl.setAttribute('data-density', 'compact');
  tabListEl.setAttribute('data-layout', 'equal');

  rootEl.appendChild(createHeader(doc, viewModel));
  rootEl.appendChild(tabRootEl);
  tabRootEl.append(tabListEl, panelStackEl);

  const tabsAdapter = createAosZagTabs({
    id: options.id || `sigil-avatar-control-surface-${keyPart(viewModel.avatar_id, 'avatar')}`,
    defaultValue: firstTab,
    getRootNode: () => rootEl,
    onValueChange(details = {}) {
      const payload = {
        value: details.value,
        avatar_id: viewModel.avatar_id,
        view_model: viewModel,
      };
      options.onTabChange?.(payload);
      hub.emit('tab-change', payload);
    },
  });

  tabsAdapter.bindRoot(rootEl);
  tabsAdapter.bindList(tabListEl);

  function createTabPanel(tab, index) {
    const tabKey = tab.key || `tab-${index}`;
    const triggerEl = createElement(doc, 'button', 'sigil-avatar-control-surface__tab aos-tab');
    const panelEl = createElement(doc, 'section', 'sigil-avatar-control-surface__panel aos-tab-content');

    triggerEl.textContent = text(tab.label, tabKey);
    triggerEl.dataset.value = tabKey;
    triggerEl.setAttribute('data-aos-tabs-trigger', '');
    setData(triggerEl, 'sigilAvatarObjectIds', arrayValue(tab.object_ids).join(' '));

    panelEl.dataset.value = tabKey;
    panelEl.setAttribute('data-aos-tabs-content', '');
    setData(panelEl, 'sigilAvatarTab', tabKey);
    setData(panelEl, 'sigilAvatarObjectIds', arrayValue(tab.object_ids).join(' '));

    tabListEl.appendChild(triggerEl);
    panelStackEl.appendChild(panelEl);
    triggerEls.set(tabKey, triggerEl);
    panelEls.set(tabKey, panelEl);
    tabsAdapter.bindTrigger(triggerEl, { value: tabKey }, index);
    tabsAdapter.bindContent(panelEl, { value: tabKey }, index);

    return { tabKey, panelEl };
  }

  tabs.forEach((tab, index) => {
    const { tabKey, panelEl } = createTabPanel(tab, index);

    for (const section of arrayValue(tab.sections)) {
      createSection({
        doc,
        panelEl,
        tab: { ...tab, key: tabKey },
        section,
        viewModel,
        forms,
        visualObjectBinding,
        visualObjectBindingDisposers,
        options,
        emit: hub.emit,
      });
    }
  });

  if (hasProjectionTools) {
    const { panelEl } = createTabPanel({
      key: 'shortcuts',
      label: 'Tools',
      object_ids: [],
    }, tabs.length);
    createProjectionTools({
      doc,
      root: panelEl,
      viewModel,
      emit: hub.emit,
      projectionButtons,
      projectionForms,
      options,
    });
  }

  container.appendChild(rootEl);

  return {
    el: rootEl,
    viewModel,
    tabsAdapter,
    forms,
    projectionForms,
    projectionButtons,
    getActiveTab() {
      return activeTabFromTabsAdapter(tabsAdapter);
    },
    setActiveTab(key) {
      tabsAdapter.setValue(key);
    },
    getValues() {
      const values = {};
      for (const { tab, section, form } of forms.values()) {
        const tabKey = tab.key;
        values[tabKey] ||= {};
        values[tabKey][section.key] = form.getValues();
      }
      if (projectionForms.size) {
        values.projection_tools = {};
        for (const [key, form] of projectionForms) values.projection_tools[key] = form.getValues();
      }
      return values;
    },
    getForm(key) {
      return forms.get(key)?.form || null;
    },
    getSection(key) {
      return forms.get(key) || null;
    },
    getProjectionForm(key = 'projection-tools') {
      return projectionForms.get(key) || null;
    },
    getControlRecords() {
      const records = [];
      for (const { tab, section, form } of forms.values()) {
        records.push(...form.getControlRecords().map((record) => ({
          ...record,
          tab: { key: tab.key, label: tab.label },
          section: { key: section.key, label: section.label },
          surface: 'sigil.avatar.compact_control_surface',
        })));
      }
      for (const [key, form] of projectionForms) {
        records.push(...form.getControlRecords().map((record) => ({
          ...record,
          projection: true,
          section: { key, label: 'Surface Shortcuts' },
          surface: 'sigil.avatar.compact_control_surface',
        })));
      }
      return records;
    },
    getControlRecordByDescriptorId(descriptorId) {
      for (const { form } of forms.values()) {
        const record = form.getControlRecords().find((item) => item.descriptor_id === descriptorId);
        if (record) return {
          ...record,
          surface: 'sigil.avatar.compact_control_surface',
        };
      }
      for (const form of projectionForms.values()) {
        const record = form.getControlRecords().find((item) => item.descriptor_id === descriptorId);
        if (record) return {
          ...record,
          projection: true,
          surface: 'sigil.avatar.compact_control_surface',
        };
      }
      return null;
    },
    refreshVisibility() {
      for (const entry of forms.values()) entry.form.refreshVisibility?.();
      for (const form of projectionForms.values()) form.refreshVisibility?.();
    },
    on(type, callback) {
      return hub.on(type, callback);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const { form } of forms.values()) form.destroy();
      for (const dispose of visualObjectBindingDisposers) dispose();
      for (const form of projectionForms.values()) form.destroy();
      for (const button of projectionButtons.values()) button.destroy();
      tabsAdapter.destroy();
      forms.clear();
      projectionForms.clear();
      projectionButtons.clear();
      panelEls.clear();
      triggerEls.clear();
      visualObjectBindingDisposers.clear();
      hub.clear();
      rootEl.remove?.();
    },
  };
}
