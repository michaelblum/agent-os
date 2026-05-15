import { createEventHub, dispatchDomEvent, ownerDocument } from './_events.js';
import { attributeParts, escapeHtml } from './_html.js';

const VARIANTS = new Set(['primary', 'secondary', 'danger', 'ghost']);

function buttonClassName(config = {}) {
  const classes = config.includeBaseClass === false ? [] : ['aos-button'];
  const variant = config.variant || 'secondary';
  if (variant && variant !== 'secondary' && VARIANTS.has(variant)) classes.push(variant);
  for (const name of String(config.className || '').split(/\s+/).filter(Boolean)) classes.push(name);
  return classes.join(' ');
}

function normalizedAttributeConfig(config = {}) {
  if (typeof config.rawAttributes === 'string') {
    return { ...config, rawAttributes: [config.rawAttributes] };
  }
  return config;
}

export function renderButtonHtml(config = {}) {
  const parts = [
    `class="${escapeHtml(buttonClassName(config))}"`,
    `type="${escapeHtml(config.type || 'button')}"`,
  ];
  if (config.id) parts.push(`id="${escapeHtml(config.id)}"`);
  if (config.title) parts.push(`title="${escapeHtml(config.title)}"`);
  if (config.ariaLabel) parts.push(`aria-label="${escapeHtml(config.ariaLabel)}"`);
  if (config.ariaPressed !== undefined) parts.push(`aria-pressed="${config.ariaPressed ? 'true' : 'false'}"`);
  if (config.disabled) {
    parts.push('disabled');
    parts.push('aria-disabled="true"');
  }
  if (config.pressed !== undefined) parts.push(`aria-pressed="${config.pressed ? 'true' : 'false'}"`);
  parts.push(...attributeParts(normalizedAttributeConfig(config)));
  return `<button ${parts.join(' ')}>${escapeHtml(config.label ?? '')}</button>`;
}

export function createButton(config = {}) {
  const doc = ownerDocument(config);
  const hub = createEventHub();
  const el = doc.createElement('button');
  el.type = 'button';
  el.classList.add('aos-button');

  const applyVariant = (variant) => {
    for (const name of VARIANTS) el.classList.remove(name);
    if (variant && variant !== 'secondary' && VARIANTS.has(variant)) {
      el.classList.add(variant);
    }
  };

  const setLabel = (label = '') => {
    el.textContent = String(label);
  };

  const setDisabled = (disabled = false) => {
    const next = !!disabled;
    el.disabled = next;
    el.setAttribute('aria-disabled', String(next));
  };

  const click = (event) => {
    if (el.disabled) return;
    config.onClick?.(event);
    hub.emit('click', event);
  };

  applyVariant(config.variant || 'secondary');
  setLabel(config.label ?? '');
  setDisabled(config.disabled);
  el.addEventListener('click', click);

  return {
    el,
    setLabel,
    setDisabled,
    on(type, callback) {
      return type === 'click' ? hub.on(type, callback) : () => {};
    },
    destroy() {
      el.removeEventListener('click', click);
      hub.clear();
    },
  };
}
