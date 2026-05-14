import { createEventHub, dispatchDomEvent, ownerDocument } from './_events.js';

export function createToggle(config = {}) {
  const doc = ownerDocument(config);
  const hub = createEventHub();
  const el = doc.createElement('label');
  const input = doc.createElement('input');
  const switchEl = doc.createElement('span');
  const thumb = doc.createElement('span');

  el.classList.add('aos-toggle');
  input.type = 'checkbox';
  input.checked = !!config.checked;
  input.classList.add('aos-toggle-input');
  switchEl.classList.add('aos-toggle-switch');
  thumb.classList.add('aos-toggle-thumb');
  switchEl.appendChild(thumb);
  el.append(input, switchEl);

  if (config.label) {
    const label = doc.createElement('span');
    label.textContent = String(config.label);
    el.appendChild(label);
  }

  const emitChange = () => {
    const checked = input.checked;
    config.onChange?.(checked);
    hub.emit('change', checked);
    dispatchDomEvent(el, 'change', { value: checked });
  };

  input.addEventListener('change', emitChange);

  return {
    el,
    getValue() {
      return !!input.checked;
    },
    setValue(value, options = {}) {
      const next = !!value;
      if (input.checked === next) return;
      input.checked = next;
      if (options.emit) emitChange();
    },
    on(type, callback) {
      return type === 'change' ? hub.on(type, callback) : () => {};
    },
    destroy() {
      input.removeEventListener('change', emitChange);
      hub.clear();
    },
  };
}
