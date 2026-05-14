import { createButtonGroup } from '../controls/button-group.js';
import { createCheckboxGroup } from '../controls/checkbox-group.js';
import { createSelect } from '../controls/select.js';
import { createTextField } from '../controls/text-field.js';
import { createToggle } from '../controls/toggle.js';
import { dispatchDomEvent } from '../controls/_events.js';
import { wireNumberFieldControls } from '../controls/number-field.js';

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

function equalValue(a, b) {
  if (Array.isArray(a)) return a.includes(b);
  return a === b;
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

function controlForField(doc, field) {
  const common = { document: doc };
  switch (field.kind) {
    case 'exclusive_choice':
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
      return createToggle({
        ...common,
        checked: !!field.value,
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
    case 'number':
      return createNumberField(doc, field);
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

export function createForm(container, fields = [], options = {}) {
  if (!container?.ownerDocument?.createElement && !options.document?.createElement) {
    throw new Error('createForm requires a DOM container');
  }
  const doc = options.document || container.ownerDocument;
  const hub = createHub();
  const formEl = doc.createElement('div');
  const records = new Map();
  let destroyed = false;

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
  };

  const emitChange = () => {
    evaluateVisibility();
    const values = currentValues();
    options.onChange?.(values);
    hub.emit('change', values);
    dispatchDomEvent(formEl, 'change', { value: values });
  };

  for (const field of fields) {
    if (!field?.id) continue;
    const fieldEl = doc.createElement('div');
    fieldEl.classList.add('aos-form-field');
    if (field.label) {
      const labelEl = doc.createElement('div');
      labelEl.classList.add('aos-control-label');
      labelEl.textContent = String(field.label);
      fieldEl.appendChild(labelEl);
    }
    const control = controlForField(doc, field);
    control.on?.('change', emitChange);
    fieldEl.appendChild(control.el);
    formEl.appendChild(fieldEl);
    records.set(field.id, { field, el: fieldEl, control, hidden: false });
  }

  evaluateVisibility();

  return {
    el: formEl,
    getValues: currentValues,
    isValid() {
      for (const record of records.values()) {
        if (record.hidden) continue;
        const value = record.control.getValue();
        if (!record.field.optional && isEmptyValue(value)) return false;
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
      return type === 'change' ? hub.on(type, callback) : () => {};
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
