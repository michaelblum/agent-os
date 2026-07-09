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

function appendClassNames(el, className) {
  for (const name of String(className || '').split(/\s+/).filter(Boolean)) {
    el.classList.add(name);
  }
}

function applyTextareaConfig(el, config = {}) {
  el.classList.add('aos-textarea');
  appendClassNames(el, config.className);
  if (config.id) el.id = String(config.id);
  if (config.name) el.name = String(config.name);
  if (config.placeholder) el.placeholder = String(config.placeholder);
  if (config.ariaLabel) el.setAttribute('aria-label', String(config.ariaLabel));
  if (config.rows !== undefined) el.rows = Number(config.rows);
  if (config.maxLength !== undefined) el.maxLength = Number(config.maxLength);
  if (config.spellcheck !== undefined) el.spellcheck = !!config.spellcheck;
  if (config.readOnly !== undefined) el.readOnly = !!config.readOnly;
  for (const [name, value] of Object.entries(config.attributes || {})) {
    if (value === undefined || value === null || value === false) continue;
    el.setAttribute(name, value === true ? '' : String(value));
  }
  if (config.rawAttributes) {
    for (const match of String(config.rawAttributes).matchAll(/([^\s=]+)="([^"]*)"/g)) {
      el.setAttribute(match[1], match[2]);
    }
  }
  for (const [name, value] of Object.entries(config.dataset || {})) {
    if (value === undefined || value === null) continue;
    el.dataset[name] = String(value);
  }
}

function textareaAttributeParts(config = {}) {
  const parts = ['class="aos-textarea'];
  const extraClass = String(config.className || '').trim();
  parts[0] += extraClass ? ` ${escapeHtml(extraClass)}"` : '"';
  if (config.id) parts.push(`id="${escapeHtml(config.id)}"`);
  if (config.name) parts.push(`name="${escapeHtml(config.name)}"`);
  if (config.placeholder) parts.push(`placeholder="${escapeHtml(config.placeholder)}"`);
  if (config.ariaLabel) parts.push(`aria-label="${escapeHtml(config.ariaLabel)}"`);
  if (config.rows !== undefined) parts.push(`rows="${escapeHtml(Number(config.rows))}"`);
  if (config.maxLength !== undefined) parts.push(`maxlength="${escapeHtml(Number(config.maxLength))}"`);
  if (config.spellcheck !== undefined) parts.push(`spellcheck="${config.spellcheck ? 'true' : 'false'}"`);
  if (config.readOnly) parts.push('readonly');
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
  return parts;
}

export function renderTextareaHtml(config = {}) {
  return `<textarea ${textareaAttributeParts(config).join(' ')}>${escapeHtml(config.value ?? '')}</textarea>`;
}

export function createTextarea(config = {}) {
  const doc = ownerDocument(config);
  const hub = createEventHub();
  const el = doc.createElement('textarea');

  applyTextareaConfig(el, config);
  el.value = config.value ?? '';

  const emitChange = () => {
    config.onChange?.(el.value);
    hub.emit('change', el.value);
    dispatchDomEvent(el, 'change', { value: el.value });
  };

  const emitCommit = () => {
    config.onCommit?.(el.value);
    hub.emit('commit', el.value);
    dispatchDomEvent(el, 'commit', { value: el.value });
  };

  const applyDictationTranscript = (transcript, options = {}) => {
    const result = applyDictationTextValue(el, transcript, options);
    if (options.emit !== false) emitChange();
    if (options.commit) emitCommit();
    return result;
  };

  el.addEventListener('input', emitChange);
  el.addEventListener('blur', emitCommit);

  return {
    el,
    getValue() {
      return el.value;
    },
    setValue(value, options = {}) {
      el.value = value ?? '';
      if (options.emit) emitChange();
    },
    setReadOnly(readOnly = true) {
      el.readOnly = !!readOnly;
    },
    applyDictationTranscript,
    on(type, callback) {
      return type === 'change' || type === 'commit' ? hub.on(type, callback) : () => {};
    },
    destroy() {
      el.removeEventListener('input', emitChange);
      el.removeEventListener('blur', emitCommit);
      hub.clear();
    },
  };
}
