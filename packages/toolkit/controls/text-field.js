import { createEventHub, dispatchDomEvent, ownerDocument } from './_events.js';
import { applyDictationTextValue } from './dictation.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderTextFieldHtml(config = {}) {
  const classNames = ['aos-text-input'];
  if (config.className) classNames.push(...String(config.className).split(/\s+/).filter(Boolean));
  const parts = [
    `type="${escapeHtml(config.type || 'text')}"`,
    `class="${escapeHtml(classNames.join(' '))}"`,
  ];
  if (config.id) parts.push(`id="${escapeHtml(config.id)}"`);
  if (config.name) parts.push(`name="${escapeHtml(config.name)}"`);
  if (config.value !== undefined) parts.push(`value="${escapeHtml(config.value)}"`);
  if (config.placeholder) parts.push(`placeholder="${escapeHtml(config.placeholder)}"`);
  if (config.ariaLabel) parts.push(`aria-label="${escapeHtml(config.ariaLabel)}"`);
  if (config.maxLength !== undefined) parts.push(`maxlength="${escapeHtml(Number(config.maxLength))}"`);
  if (config.spellcheck !== undefined) parts.push(`spellcheck="${config.spellcheck ? 'true' : 'false'}"`);
  for (const [name, value] of Object.entries(config.attributes || {})) {
    if (value === undefined || value === null || value === false) continue;
    parts.push(value === true ? escapeHtml(name) : `${escapeHtml(name)}="${escapeHtml(value)}"`);
  }
  if (config.rawAttributes) parts.push(String(config.rawAttributes));
  for (const [name, value] of Object.entries(config.dataset || {})) {
    if (value === undefined || value === null) continue;
    const attrName = `data-${String(name).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
    parts.push(`${escapeHtml(attrName)}="${escapeHtml(value)}"`);
  }
  return `<input ${parts.join(' ')}>`;
}

export function createTextField(config = {}) {
  const doc = ownerDocument(config);
  const hub = createEventHub();
  const el = doc.createElement('div');
  const input = doc.createElement('input');
  const errorEl = doc.createElement('div');
  let error = null;

  el.classList.add('aos-control-stack');
  if (config.label) {
    const label = doc.createElement('label');
    label.classList.add('aos-control-label');
    label.textContent = String(config.label);
    label.appendChild(input);
    el.appendChild(label);
  } else {
    el.appendChild(input);
  }

  input.type = 'text';
  input.classList.add('aos-text-input');
  input.value = config.value ?? '';
  if (config.placeholder) input.placeholder = String(config.placeholder);
  if (config.maxLength !== undefined) input.maxLength = Number(config.maxLength);

  errorEl.classList.add('aos-field-error');
  errorEl.hidden = true;
  el.appendChild(errorEl);

  const setError = (message) => {
    error = message || null;
    input.classList.toggle('error', !!error);
    errorEl.hidden = !error;
    errorEl.textContent = error || '';
  };

  const validate = () => {
    if (typeof config.validate !== 'function') return true;
    const message = config.validate(input.value);
    setError(message);
    return !message;
  };

  const emitChange = () => {
    validate();
    config.onChange?.(input.value);
    hub.emit('change', input.value);
    dispatchDomEvent(el, 'change', { value: input.value });
  };

  const emitCommit = () => {
    validate();
    config.onCommit?.(input.value);
    hub.emit('commit', input.value);
    dispatchDomEvent(el, 'commit', { value: input.value });
  };

  const keydown = (event) => {
    if (event.key === 'Enter') emitCommit();
  };

  const applyDictationTranscript = (transcript, options = {}) => {
    const result = applyDictationTextValue(input, transcript, options);
    validate();
    if (options.emit !== false) emitChange();
    if (options.commit) emitCommit();
    return result;
  };

  input.addEventListener('input', emitChange);
  input.addEventListener('blur', emitCommit);
  input.addEventListener('keydown', keydown);
  validate();

  return {
    el,
    getValue() {
      return input.value;
    },
    setValue(value, options = {}) {
      input.value = value ?? '';
      validate();
      if (options.emit) emitChange();
    },
    setError,
    applyDictationTranscript,
    on(type, callback) {
      return type === 'change' || type === 'commit' ? hub.on(type, callback) : () => {};
    },
    destroy() {
      input.removeEventListener('input', emitChange);
      input.removeEventListener('blur', emitCommit);
      input.removeEventListener('keydown', keydown);
      hub.clear();
    },
  };
}
