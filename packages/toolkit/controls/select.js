import { createEventHub, dispatchDomEvent, ownerDocument } from './_events.js';
import { attributeParts, escapeHtml } from './_html.js';

function renderOptionHtml(option = {}, selectedValue) {
  const value = option.value ?? '';
  const parts = [`value="${escapeHtml(value)}"`];
  if (option.disabled) parts.push('disabled');
  if (String(value) === String(selectedValue ?? '')) parts.push('selected');
  parts.push(...attributeParts(option));
  return `<option ${parts.join(' ')}>${escapeHtml(option.label ?? String(value))}</option>`;
}

export function renderSelectHtml(config = {}) {
  const selectClasses = ['aos-select'];
  for (const name of String(config.className || '').split(/\s+/).filter(Boolean)) selectClasses.push(name);
  const selectParts = [`class="${escapeHtml(selectClasses.join(' '))}"`];
  if (config.id) selectParts.push(`id="${escapeHtml(config.id)}"`);
  if (config.name) selectParts.push(`name="${escapeHtml(config.name)}"`);
  if (config.ariaLabel) selectParts.push(`aria-label="${escapeHtml(config.ariaLabel)}"`);
  if (config.disabled) selectParts.push('disabled');
  selectParts.push(...attributeParts(config));
  const options = (Array.isArray(config.options) ? config.options : [])
    .map((option) => renderOptionHtml(option, config.value))
    .join('');
  const select = `<select ${selectParts.join(' ')}>${options}</select>`;
  if (!config.label) return select;

  const wrapperTag = config.wrapperTag || 'div';
  const wrapperClasses = config.wrapperClassName || 'aos-control-stack';
  const labelTag = wrapperTag === 'label' ? 'span' : 'label';
  const label = `<${labelTag} class="aos-control-label">${escapeHtml(config.label)}</${labelTag}>`;
  return `<${wrapperTag} class="${escapeHtml(wrapperClasses)}">${label}${select}</${wrapperTag}>`;
}

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
