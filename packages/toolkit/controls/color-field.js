import { createEventHub, dispatchDomEvent, ownerDocument } from './_events.js';
import { attributeParts, escapeHtml } from './_html.js';

function colorValue(value, fallback = '#000000') {
  const text = String(value ?? '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text : fallback;
}

export function renderColorFieldHtml(config = {}) {
  const value = colorValue(config.value, config.fallback || '#000000');
  const inputParts = [
    'type="color"',
    'class="aos-color-input"',
    `value="${escapeHtml(value)}"`,
  ];
  if (config.id) inputParts.push(`id="${escapeHtml(config.id)}"`);
  if (config.name) inputParts.push(`name="${escapeHtml(config.name)}"`);
  if (config.ariaLabel) inputParts.push(`aria-label="${escapeHtml(config.ariaLabel)}"`);
  if (config.disabled) inputParts.push('disabled');
  inputParts.push(...attributeParts(config));

  const label = config.label ? `<span>${escapeHtml(config.label)}</span>` : '';
  return `<label class="aos-color-field">${label}<input ${inputParts.join(' ')}></label>`;
}

export function createColorField(config = {}) {
  const doc = ownerDocument(config);
  const hub = createEventHub();
  const el = doc.createElement('label');
  const input = doc.createElement('input');

  el.classList.add('aos-color-field');
  input.type = 'color';
  input.classList.add('aos-color-input');
  input.value = colorValue(config.value, config.fallback || '#000000');
  if (config.disabled) input.disabled = true;

  if (config.label) {
    const label = doc.createElement('span');
    label.textContent = String(config.label);
    el.appendChild(label);
  }

  el.appendChild(input);

  const emitChange = () => {
    const value = input.value;
    config.onChange?.(value);
    hub.emit('change', value);
    dispatchDomEvent(el, 'change', { value });
  };

  input.addEventListener('input', emitChange);
  input.addEventListener('change', emitChange);

  return {
    el,
    getValue() {
      return input.value;
    },
    setValue(value, options = {}) {
      input.value = colorValue(value, config.fallback || '#000000');
      if (options.emit) emitChange();
    },
    setDisabled(disabled = true) {
      input.disabled = !!disabled;
    },
    on(type, callback) {
      return type === 'change' ? hub.on(type, callback) : () => {};
    },
    destroy() {
      input.removeEventListener('input', emitChange);
      input.removeEventListener('change', emitChange);
      hub.clear();
    },
  };
}
