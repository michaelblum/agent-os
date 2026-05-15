import { createEventHub, dispatchDomEvent, ownerDocument } from './_events.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function dataAttributeName(name) {
  return `data-${String(name).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

export function renderCheckboxHtml(config = {}) {
  const labelClasses = ['aos-checkbox'];
  if (config.labelClass) labelClasses.push(...String(config.labelClass).split(/\s+/).filter(Boolean));
  const inputClasses = String(config.inputClass || '').split(/\s+/).filter(Boolean);
  const inputParts = ['type="checkbox"'];
  if (inputClasses.length) inputParts.push(`class="${escapeHtml(inputClasses.join(' '))}"`);
  if (config.value !== undefined) inputParts.push(`value="${escapeHtml(config.value)}"`);
  if (config.checked) inputParts.push('checked');
  for (const [name, value] of Object.entries(config.dataset || {})) {
    if (value === undefined || value === null) continue;
    inputParts.push(`${escapeHtml(dataAttributeName(name))}="${escapeHtml(value)}"`);
  }
  for (const [name, value] of Object.entries(config.attributes || {})) {
    if (value === undefined || value === null || value === false) continue;
    inputParts.push(value === true ? escapeHtml(name) : `${escapeHtml(name)}="${escapeHtml(value)}"`);
  }
  if (config.rawAttributes) inputParts.push(String(config.rawAttributes));
  const title = config.title ? ` title="${escapeHtml(config.title)}"` : '';
  return `<label class="${escapeHtml(labelClasses.join(' '))}"${title}><input ${inputParts.join(' ')}><span>${escapeHtml(config.label ?? '')}</span></label>`;
}

export function createCheckboxGroup(config = {}) {
  const doc = ownerDocument(config);
  const hub = createEventHub();
  const options = Array.isArray(config.options) ? config.options : [];
  const selected = new Set(Array.isArray(config.value) ? config.value.map(String) : []);
  const el = doc.createElement('div');
  const optionInputs = [];
  let selectAllInput = null;

  el.classList.add('aos-control-stack');
  el.setAttribute('role', 'group');

  const values = () => options
    .filter((option) => selected.has(String(option.value)))
    .map((option) => option.value);

  const updateInputs = () => {
    for (const { input, option } of optionInputs) {
      input.checked = selected.has(String(option.value));
    }
    if (selectAllInput) {
      selectAllInput.checked = optionInputs.length > 0 && optionInputs.every(({ input }) => input.checked);
      selectAllInput.indeterminate = optionInputs.some(({ input }) => input.checked) && !selectAllInput.checked;
    }
  };

  const emitChange = () => {
    const next = values();
    config.onChange?.(next);
    hub.emit('change', next);
    dispatchDomEvent(el, 'change', { value: next });
  };

  const setValue = (nextValue = [], opts = {}) => {
    selected.clear();
    for (const item of Array.isArray(nextValue) ? nextValue : []) selected.add(String(item));
    updateInputs();
    if (opts.emit !== false) emitChange();
  };

  const makeRow = (labelText, input) => {
    const label = doc.createElement('label');
    const text = doc.createElement('span');
    label.classList.add('aos-checkbox');
    text.textContent = String(labelText);
    label.append(input, text);
    return label;
  };

  if (options.length >= 3) {
    selectAllInput = doc.createElement('input');
    selectAllInput.type = 'checkbox';
    selectAllInput.addEventListener('change', () => {
      setValue(selectAllInput.checked ? options.map((option) => option.value) : []);
    });
    el.appendChild(makeRow('Select all', selectAllInput));
  }

  for (const option of options) {
    const input = doc.createElement('input');
    input.type = 'checkbox';
    input.value = option.value;
    input.addEventListener('change', () => {
      if (input.checked) selected.add(String(option.value));
      else selected.delete(String(option.value));
      updateInputs();
      emitChange();
    });
    optionInputs.push({ input, option });
    el.appendChild(makeRow(option.label ?? option.value, input));
  }

  updateInputs();

  return {
    el,
    getValue() {
      return values();
    },
    setValue,
    on(type, callback) {
      return type === 'change' ? hub.on(type, callback) : () => {};
    },
    destroy() {
      hub.clear();
      el.replaceChildren?.();
    },
  };
}
