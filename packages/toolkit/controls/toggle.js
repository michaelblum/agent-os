import { createEventHub, dispatchDomEvent, ownerDocument } from './_events.js';
import { attributeParts, escapeHtml } from './_html.js';
import { createToggleUxTreeFragment } from './ux-tree.js';

export function renderToggleHtml(config = {}) {
  const wrapperClasses = ['aos-toggle'];
  for (const name of String(config.className || '').split(/\s+/).filter(Boolean)) wrapperClasses.push(name);
  const inputParts = [
    'type="checkbox"',
    'class="aos-toggle-input"',
  ];
  if (config.id) inputParts.push(`id="${escapeHtml(config.id)}"`);
  if (config.name) inputParts.push(`name="${escapeHtml(config.name)}"`);
  if (config.checked) inputParts.push('checked');
  if (config.disabled) inputParts.push('disabled');
  if (config.ariaLabel) inputParts.push(`aria-label="${escapeHtml(config.ariaLabel)}"`);
  inputParts.push(...attributeParts(config));
  return `
    <label class="${escapeHtml(wrapperClasses.join(' '))}">
      <input ${inputParts.join(' ')}>
      <span class="aos-toggle-switch"><span class="aos-toggle-thumb"></span></span>
      ${config.label ? `<span>${escapeHtml(config.label)}</span>` : ''}
    </label>
  `.trim();
}

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
  input.disabled = !!config.disabled;
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
    getUxTreeFragment(options = {}) {
      return createToggleUxTreeFragment({
        ...config,
        checked: !!input.checked,
        disabled: !!input.disabled,
      }, options);
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
