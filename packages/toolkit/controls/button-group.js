import { createEventHub, dispatchDomEvent, ownerDocument } from './_events.js';
import { buttonGroupOptionValueMatches, createButtonGroupUxTreeFragment } from './ux-tree.js';

export function createButtonGroup(config = {}) {
  const doc = ownerDocument(config);
  const hub = createEventHub();
  const options = Array.isArray(config.options) ? config.options : [];
  const el = doc.createElement('div');
  const buttons = [];
  let value = config.value ?? null;

  el.classList.add('aos-segmented');
  el.setAttribute('role', 'group');

  const emitChange = () => {
    config.onChange?.(value);
    hub.emit('change', value);
    dispatchDomEvent(el, 'change', { value });
  };

  const renderPressed = () => {
    for (const button of buttons) {
      const selected = buttonGroupOptionValueMatches(button.dataset.value, value);
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('active', selected);
      button.tabIndex = selected || value === null ? 0 : -1;
    }
  };

  const setValue = (nextValue, options = {}) => {
    const normalized = nextValue === undefined ? null : nextValue;
    if (value === normalized) {
      renderPressed();
      return;
    }
    value = normalized;
    renderPressed();
    if (options.emit !== false) emitChange();
  };

  const selectIndex = (index) => {
    if (!buttons.length) return;
    const normalized = (index + buttons.length) % buttons.length;
    buttons[normalized].focus?.();
    setValue(options[normalized]?.value ?? null);
  };

  options.forEach((option, index) => {
    const button = doc.createElement('button');
    button.type = 'button';
    button.textContent = option.label ?? String(option.value ?? '');
    button.dataset.value = String(option.value);
    if (option.danger) button.classList.add('danger');
    button.addEventListener('click', () => setValue(option.value));
    button.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault?.();
        selectIndex(index + 1);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault?.();
        selectIndex(index - 1);
      }
    });
    buttons.push(button);
    el.appendChild(button);
  });

  renderPressed();

  return {
    el,
    getValue() {
      return value;
    },
    setValue,
    getUxTreeFragment(fragmentOptions = {}) {
      return createButtonGroupUxTreeFragment({
        ...config,
        options,
        value,
      }, fragmentOptions);
    },
    on(type, callback) {
      return type === 'change' ? hub.on(type, callback) : () => {};
    },
    destroy() {
      hub.clear();
      el.replaceChildren?.();
    },
  };
}
