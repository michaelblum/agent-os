import { createEventHub, dispatchDomEvent, ownerDocument } from './_events.js';

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
