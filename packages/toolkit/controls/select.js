import { createEventHub, dispatchDomEvent, ownerDocument } from './_events.js';

export function createSelect(config = {}) {
  const doc = ownerDocument(config);
  const hub = createEventHub();
  const el = doc.createElement('div');
  const select = doc.createElement('select');

  el.classList.add('aos-control-stack');
  select.classList.add('aos-select');

  if (config.label) {
    const label = doc.createElement('label');
    label.classList.add('aos-control-label');
    label.textContent = String(config.label);
    el.appendChild(label);
  }

  for (const option of Array.isArray(config.options) ? config.options : []) {
    const optionEl = doc.createElement('option');
    optionEl.value = option.value;
    optionEl.textContent = option.label ?? String(option.value ?? '');
    optionEl.disabled = !!option.disabled;
    select.appendChild(optionEl);
  }

  if (config.value !== undefined) select.value = config.value;
  el.appendChild(select);

  const emitChange = () => {
    config.onChange?.(select.value);
    hub.emit('change', select.value);
    dispatchDomEvent(el, 'change', { value: select.value });
  };

  select.addEventListener('change', emitChange);

  return {
    el,
    getValue() {
      return select.value;
    },
    setValue(value, options = {}) {
      select.value = value ?? '';
      if (options.emit) emitChange();
    },
    on(type, callback) {
      return type === 'change' ? hub.on(type, callback) : () => {};
    },
    destroy() {
      select.removeEventListener('change', emitChange);
      hub.clear();
    },
  };
}
