import { createButtonGroup } from '../controls/button-group.js';
import { createCheckboxGroup } from '../controls/checkbox-group.js';
import { createColorField } from '../controls/color-field.js';
import { createSelect } from '../controls/select.js';
import { createSlider } from '../controls/slider.js';
import { createTextField } from '../controls/text-field.js';
import { createTextarea } from '../controls/textarea.js';
import { createToggle } from '../controls/toggle.js';
import { dispatchDomEvent } from '../controls/_events.js';
import { wireNumberFieldControls } from '../controls/number-field.js';
import { normalizeSemanticTarget } from '../runtime/semantic-targets.js';

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

function isEmptyValue(value) {
  return value === null
    || value === undefined
    || value === ''
    || (Array.isArray(value) && value.length === 0);
}

function isRequiredField(field) {
  if (field?.required !== undefined) return !!field.required;
  return !field?.optional;
}

function scalarEqual(a, b) {
  if (a === b) return true;
  const aNumber = Number(a);
  const bNumber = Number(b);
  if (String(a ?? '').trim() !== ''
    && String(b ?? '').trim() !== ''
    && Number.isFinite(aNumber)
    && Number.isFinite(bNumber)) {
    return aNumber === bNumber;
  }
  return String(a ?? '') === String(b ?? '');
}

function equalValue(a, b) {
  if (Array.isArray(a)) return a.some((value) => scalarEqual(value, b));
  if (Array.isArray(b)) return b.some((value) => scalarEqual(a, value));
  return scalarEqual(a, b);
}

function createNumberField(doc, field) {
  const input = doc.createElement('input');
  input.type = 'number';
  input.classList.add('aos-number-field');
  input.dataset.aosControl = 'number-field';
  if (field.placeholder) input.placeholder = String(field.placeholder);
  if (field.min !== undefined) input.min = field.min;
  if (field.max !== undefined) input.max = field.max;
  if (field.step !== undefined) input.step = field.step;
  if (field.value !== undefined) input.value = field.value;
  const wire = wireNumberFieldControls(input, { requireFocus: false });
  const listeners = new Set();
  const emit = () => {
    const value = input.value === '' ? null : Number(input.value);
    for (const callback of listeners) callback(value);
  };
  input.addEventListener('input', emit);
  input.addEventListener('change', emit);
  return {
    el: input,
    getValue() {
      return input.value === '' ? null : Number(input.value);
    },
    setValue(value, options = {}) {
      input.value = value ?? '';
      if (options.emit) emit();
    },
    on(type, callback) {
      if (type !== 'change' || typeof callback !== 'function') return () => {};
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    destroy() {
      input.removeEventListener('input', emit);
      input.removeEventListener('change', emit);
      wire.dispose();
      listeners.clear();
    },
  };
}

function setControlDisabled(control, disabled) {
  if (typeof control?.setDisabled === 'function') {
    control.setDisabled(disabled);
    return;
  }
  const targets = [];
  if (control?.el?.matches?.('button,input,select,textarea')) targets.push(control.el);
  if (typeof control?.el?.querySelectorAll === 'function') {
    targets.push(...control.el.querySelectorAll('button,input,select,textarea'));
  }
  for (const target of targets) target.disabled = !!disabled;
}

function controlForField(doc, field) {
  const common = { document: doc };
  switch (field.kind) {
    case 'exclusive_choice':
    case 'radio_group':
      return createButtonGroup({
        ...common,
        options: field.options || [],
        value: field.value ?? null,
      });
    case 'multi_choice':
      return createCheckboxGroup({
        ...common,
        options: field.options || [],
        value: field.value || [],
      });
    case 'boolean':
    case 'checkbox':
      return createToggle({
        ...common,
        checked: !!(field.value ?? field.checked),
        label: field.control_label,
      });
    case 'text':
      return createTextField({
        ...common,
        value: field.value ?? '',
        placeholder: field.placeholder,
        maxLength: field.maxLength ?? field.max_length,
        validate: field.validate,
      });
    case 'textarea':
      return createTextarea({
        ...common,
        value: field.value ?? '',
        placeholder: field.placeholder,
        rows: field.rows,
        maxLength: field.maxLength ?? field.max_length,
        spellcheck: field.spellcheck,
        readOnly: field.readOnly ?? field.read_only,
      });
    case 'number':
      return createNumberField(doc, field);
    case 'slider':
      return createSlider({
        ...common,
        value: field.value,
        min: field.min,
        max: field.max,
        step: field.step,
        unit: field.unit,
        output: field.output,
      });
    case 'color':
    case 'color_control':
      return createColorField({
        ...common,
        value: field.value,
      });
    case 'select':
      return createSelect({
        ...common,
        options: field.options || [],
        value: field.value,
      });
    default:
      return createTextField({
        ...common,
        value: field.value ?? '',
        placeholder: field.placeholder,
        validate: field.validate,
      });
  }
}

function metadataValue(value) {
  if (value === undefined || value === null || value === '') return null;
  if (Array.isArray(value)) return value.join(' ');
  return String(value);
}

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function semanticRoleForField(field = {}) {
  switch (field.kind) {
    case 'exclusive_choice':
    case 'radio_group':
      return 'radiogroup';
    case 'multi_choice':
      return 'group';
    case 'boolean':
    case 'checkbox':
      return 'checkbox';
    case 'slider':
      return 'slider';
    case 'select':
      return 'combobox';
    case 'textarea':
      return 'textbox';
    case 'number':
    case 'text':
    default:
      return 'textbox';
  }
}

function optionElementFor(control = null, option = {}, index = 0) {
  const elements = typeof control?.el?.querySelectorAll === 'function'
    ? Array.from(control.el.querySelectorAll('button,[data-value]'))
    : [];
  return elements.find((element) => element.dataset?.value === String(option.value))
    || elements[index]
    || null;
}

function controlOptions(field = {}, control = null) {
  if (typeof control?.getOptions === 'function') {
    return control.getOptions().map((option, index) => {
      const element = optionElementFor(control, option, index);
      return {
        value: option.rawValue ?? option.value,
        label: text(option.label, option.value),
        enabled: !option.disabled,
        selected: element?.getAttribute?.('aria-selected') === 'true'
          || element?.getAttribute?.('aria-pressed') === 'true'
          || element?.classList?.contains?.('selected') === true
          || element?.classList?.contains?.('active') === true,
        frame: rectForElement(element),
      };
    });
  }
  if (!Array.isArray(field.options)) return [];
  return field.options.map((option, index) => {
    const element = optionElementFor(control, option, index);
    return {
      value: option.value,
      label: text(option.label, option.value),
      enabled: !option.disabled,
      selected: element?.getAttribute?.('aria-pressed') === 'true'
        || element?.getAttribute?.('aria-selected') === 'true'
        || element?.classList?.contains?.('active') === true
        || element?.classList?.contains?.('selected') === true,
      frame: rectForElement(element),
    };
  });
}

function rectForElement(element) {
  if (typeof element?.getBoundingClientRect !== 'function') return null;
  const rect = element.getBoundingClientRect();
  const left = Number(rect.left);
  const top = Number(rect.top);
  const width = Number(rect.width);
  const height = Number(rect.height);
  if (![left, top, width, height].every(Number.isFinite)) return null;
  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}

function focusTargetForRecord(record = {}) {
  const el = record.control?.el;
  if (!el) return null;
  if (typeof el.matches === 'function' && el.matches('button,input,select,textarea,[tabindex]')) return el;
  return typeof el.querySelector === 'function'
    ? el.querySelector('button,input,select,textarea,[tabindex]')
    : null;
}

function interactionTargetForRecord(record = {}) {
  if (record.field.kind === 'slider') {
    return record.control?.el?.querySelector?.('[data-aos-slider-control]') || record.control?.el || record.el;
  }
  return focusTargetForRecord(record) || record.control?.el || record.el;
}

function controlActionsForRecord(record = {}) {
  const actions = [];
  if (record.hidden) return actions;
  if (['exclusive_choice', 'radio_group'].includes(record.field.kind)) actions.push('select');
  else if (record.field.kind === 'slider') actions.push('drag', 'set-value');
  else if (record.field.kind === 'select') actions.push('open', 'select');
  else if (['boolean', 'checkbox', 'multi_choice'].includes(record.field.kind)) actions.push('toggle');
  else actions.push('focus', 'set-value');
  return actions;
}

function controlRecordFor(record = {}, options = {}) {
  const field = record.field || {};
  const descriptorId = field.descriptor_id ?? field.binding?.descriptor_id ?? field.id;
  const target = interactionTargetForRecord(record);
  const value = record.control?.getValue?.();
  const normalized = normalizeSemanticTarget({
    id: descriptorId,
    role: field.role || semanticRoleForField(field),
    name: field.label ?? field.control_label ?? field.id,
    value,
    enabled: !record.hidden && !target?.disabled,
    frame: rectForElement(target),
    surface: field.surface || options.surface || 'toolkit.panel.form',
    metadata: { ...record.el.dataset },
  });
  return {
    ...normalized,
    id: field.id,
    descriptor_id: descriptorId,
    ref: normalized.aosRef,
    kind: field.kind || 'text',
    options: controlOptions(field, record.control),
    hidden: !!record.hidden,
    actions: controlActionsForRecord(record),
  };
}

function applyFieldMetadata(fieldEl, field) {
  const binding = field.binding && typeof field.binding === 'object' ? field.binding : {};
  fieldEl.dataset.aosFieldId = String(field.id);
  fieldEl.dataset.aosFieldKind = String(field.kind || 'text');
  const metadata = {
    descriptorId: field.descriptor_id ?? binding.descriptor_id,
    statePath: field.state_path ?? field.path ?? binding.state_path,
    route: field.route ?? binding.route,
    objectIds: field.object_ids ?? binding.object_ids,
    groupKey: field.group_key ?? binding.group_key,
    facetKey: field.facet_key ?? binding.facet_key,
    bindingId: field.binding_id ?? binding.id,
  };
  for (const [key, value] of Object.entries(metadata)) {
    const text = metadataValue(value);
    if (text !== null) fieldEl.dataset[key] = text;
  }
}

function isSectionItem(item = {}) {
  return item.kind === 'section' || Array.isArray(item.fields) || Array.isArray(item.controls);
}

export function createForm(container, fields = [], options = {}) {
  if (!container?.ownerDocument?.createElement && !options.document?.createElement) {
    throw new Error('createForm requires a DOM container');
  }
  const doc = options.document || container.ownerDocument;
  const hub = createHub();
  const formEl = doc.createElement('div');
  const records = new Map();
  const sections = [];
  let destroyed = false;
  let disabled = false;

  formEl.classList.add('aos-form');
  container.appendChild(formEl);

  const currentValues = () => {
    const values = {};
    for (const [id, record] of records) {
      if (record.hidden) continue;
      values[id] = record.control.getValue();
    }
    return values;
  };

  const evaluateVisibility = () => {
    const allValues = {};
    for (const [id, record] of records) allValues[id] = record.control.getValue();
    for (const record of records.values()) {
      const condition = record.field.visible_when;
      const hidden = !!condition && !equalValue(allValues[condition.field], condition.equals);
      record.hidden = hidden;
      record.el.classList.toggle('hidden', hidden);
    }
    for (const section of sections) {
      const hidden = section.fieldIds.length > 0
        && section.fieldIds.every((id) => records.get(id)?.hidden);
      section.el.classList.toggle('hidden', hidden);
    }
  };

  const fieldChangePayload = (record) => {
    if (!record) return null;
    return {
      id: record.field.id,
      field_id: record.field.id,
      value: record.control.getValue(),
      field: record.field,
      binding: record.field.binding && typeof record.field.binding === 'object'
        ? { ...record.field.binding }
        : null,
      metadata: { ...record.el.dataset },
      values: currentValues(),
    };
  };

  const emitChange = (record = null) => {
    evaluateVisibility();
    const values = currentValues();
    const fieldChange = fieldChangePayload(record);
    options.onChange?.(values);
    hub.emit('change', values);
    if (fieldChange) {
      options.onFieldChange?.(fieldChange);
      hub.emit('field-change', fieldChange);
      dispatchDomEvent(formEl, 'field-change', { value: fieldChange });
    }
    dispatchDomEvent(formEl, 'change', { value: values });
  };

  const appendField = (field, parentEl, section = null) => {
    if (!field?.id) return;
    const fieldEl = doc.createElement('div');
    fieldEl.classList.add('aos-form-field');
    applyFieldMetadata(fieldEl, field);
    if (field.label) {
      const labelEl = doc.createElement('div');
      labelEl.classList.add('aos-control-label');
      labelEl.textContent = String(field.label);
      fieldEl.appendChild(labelEl);
    }
    const control = controlForField(doc, field);
    control.on?.('change', () => emitChange(records.get(field.id)));
    setControlDisabled(control, disabled);
    fieldEl.appendChild(control.el);
    parentEl.appendChild(fieldEl);
    records.set(field.id, { field, el: fieldEl, control, hidden: false });
    section?.fieldIds.push(field.id);
  };

  const appendSection = (sectionItem, parentEl) => {
    const sectionEl = doc.createElement('section');
    const fieldsEl = doc.createElement('div');
    const section = { el: sectionEl, fieldIds: [] };
    sectionEl.classList.add('aos-form-section');
    if (sectionItem.id) sectionEl.dataset.aosSectionId = String(sectionItem.id);
    if (sectionItem.key) sectionEl.dataset.aosSectionKey = String(sectionItem.key);
    fieldsEl.classList.add('aos-form-section-fields');
    if (sectionItem.label || sectionItem.title || sectionItem.description) {
      const headerEl = doc.createElement('div');
      headerEl.classList.add('aos-form-section-header');
      if (sectionItem.label || sectionItem.title) {
        const titleEl = doc.createElement('div');
        titleEl.classList.add('aos-form-section-title');
        titleEl.textContent = String(sectionItem.label || sectionItem.title);
        headerEl.appendChild(titleEl);
      }
      if (sectionItem.description) {
        const descriptionEl = doc.createElement('div');
        descriptionEl.classList.add('aos-form-section-description');
        descriptionEl.textContent = String(sectionItem.description);
        headerEl.appendChild(descriptionEl);
      }
      sectionEl.appendChild(headerEl);
    }
    sectionEl.appendChild(fieldsEl);
    parentEl.appendChild(sectionEl);
    sections.push(section);
    for (const field of sectionItem.fields || sectionItem.controls || []) {
      if (isSectionItem(field)) appendSection(field, fieldsEl);
      else appendField(field, fieldsEl, section);
    }
  };

  for (const field of fields) {
    if (isSectionItem(field)) appendSection(field, formEl);
    else appendField(field, formEl);
  }

  evaluateVisibility();

  return {
    el: formEl,
    getValues: currentValues,
    isValid() {
      for (const record of records.values()) {
        if (record.hidden) continue;
        const value = record.control.getValue();
        if (isRequiredField(record.field) && isEmptyValue(value)) return false;
        if (typeof record.field.validate === 'function' && record.field.validate(value)) return false;
      }
      return true;
    },
    setValues(values = {}) {
      for (const [id, value] of Object.entries(values)) {
        records.get(id)?.control.setValue?.(value, { emit: false });
      }
      emitChange();
    },
    setDisabled(nextDisabled = true) {
      disabled = !!nextDisabled;
      for (const record of records.values()) setControlDisabled(record.control, disabled);
    },
    refreshVisibility() {
      evaluateVisibility();
    },
    getField(id) {
      const record = records.get(id);
      if (!record) return null;
      return {
        id,
        el: record.el,
        control: record.control,
        field: record.field,
        hidden: record.hidden,
      };
    },
    getControlRecord(id) {
      const record = records.get(id);
      return record ? controlRecordFor(record, options) : null;
    },
    getControlRecords() {
      return Array.from(records.values(), (record) => controlRecordFor(record, options));
    },
    focus() {
      for (const record of records.values()) {
        if (record.hidden) continue;
        const target = typeof record.control.el.querySelector === 'function'
          ? record.control.el.querySelector('button,input,select,textarea,[tabindex]')
          : null;
        (target || record.control.el).focus?.();
        return;
      }
    },
    on(type, callback) {
      return ['change', 'field-change'].includes(type) ? hub.on(type, callback) : () => {};
    },
    onChange(callback) {
      return hub.on('change', callback);
    },
    onFieldChange(callback) {
      return hub.on('field-change', callback);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const record of records.values()) record.control.destroy?.();
      records.clear();
      hub.clear();
      formEl.remove?.();
    },
  };
}
