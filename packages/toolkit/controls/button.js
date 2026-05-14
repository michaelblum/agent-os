import { createEventHub, dispatchDomEvent, ownerDocument } from './_events.js';

const VARIANTS = new Set(['primary', 'secondary', 'danger', 'ghost']);

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
