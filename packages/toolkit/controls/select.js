import { createAosZagSelect } from '../adapters/zag/select.js';
import { createEventHub, dispatchDomEvent, ownerDocument } from './_events.js';

let nextSelectId = 0;

function stringValue(value) {
  return value === undefined || value === null ? '' : String(value);
}

function normalizedOptions(options = []) {
  return (Array.isArray(options) ? options : []).map((option) => {
    const rawValue = option.value ?? '';
    const value = stringValue(rawValue);
    return {
      ...option,
      rawValue,
      value,
      label: option.label ?? value,
    };
  });
}

function selectId(config = {}) {
  if (config.id) return String(config.id);
  nextSelectId += 1;
  return `aos-select-${nextSelectId}`;
}

function optionCollection(options) {
  return {
    items: options,
    find(value) {
      const textValue = stringValue(value);
      return options.find((option) => option.value === textValue) || null;
    },
  };
}

function applyDataset(element, dataset = {}) {
  if (!element?.dataset || !dataset || typeof dataset !== 'object') return;
  for (const [key, value] of Object.entries(dataset)) {
    if (value !== undefined && value !== null) element.dataset[key] = String(value);
  }
}

function applyAttributes(element, attributes = {}) {
  if (!element || !attributes || typeof attributes !== 'object') return;
  for (const [key, value] of Object.entries(attributes)) {
    if (value === false || value === undefined || value === null) element.removeAttribute?.(key);
    else if (value === true) element.setAttribute(key, '');
    else element.setAttribute(key, String(value));
  }
}

function applyClassName(element, className) {
  for (const name of String(className || '').split(/\s+/).filter(Boolean)) {
    element.classList.add(name);
  }
}

function selectedOption(options, value) {
  return options.find((option) => option.value === value) || null;
}

export function createSelect(config = {}) {
  const doc = ownerDocument(config);
  const hub = createEventHub();
  const el = doc.createElement('div');
  const id = selectId(config);
  const labelEl = config.label ? doc.createElement('div') : null;
  const trigger = doc.createElement('button');
  const valueEl = doc.createElement('span');
  const indicator = doc.createElement('span');
  const content = doc.createElement('div');
  let options = normalizedOptions(config.options);
  let value = stringValue(config.value ?? options[0]?.value ?? '');
  let disabled = !!config.disabled;
  let suppressAdapterChange = false;

  el.classList.add('aos-control-stack', 'aos-select-control');
  el.dataset.aosSelectRoot = '';
  el.dataset.state = 'closed';
  if (config.name) el.dataset.name = String(config.name);
  applyClassName(el, config.className);
  applyDataset(el, config.dataset);
  applyAttributes(el, config.attributes);

  if (labelEl) {
    labelEl.classList.add('aos-control-label');
    labelEl.dataset.aosSelectLabel = '';
    labelEl.textContent = String(config.label);
    el.appendChild(labelEl);
  }

  trigger.type = 'button';
  trigger.classList.add('aos-select', 'aos-select-trigger');
  trigger.dataset.aosSelectTrigger = '';
  if (config.ariaLabel) trigger.setAttribute('aria-label', config.ariaLabel);

  valueEl.classList.add('aos-select-value');
  valueEl.dataset.aosSelectValue = '';
  indicator.classList.add('aos-select-indicator');
  indicator.dataset.aosSelectIndicator = '';
  indicator.setAttribute('aria-hidden', 'true');
  trigger.append(valueEl, indicator);

  content.classList.add('aos-select-content');
  content.dataset.aosSelectContent = '';

  el.append(trigger, content);

  const currentValue = () => {
    const selected = selectedOption(options, value);
    return selected ? selected.rawValue : value;
  };

  const adapter = createAosZagSelect({
    id,
    collection: optionCollection(options),
    value: value === '' ? [] : [value],
    disabled,
    closeOnSelect: true,
    onValueChange(details = {}) {
      value = stringValue(details.value?.[0] ?? '');
      sync();
      if (!suppressAdapterChange) emitChange();
    },
    onOpenChange() {
      sync();
    },
  });

  function emitChange() {
    const payloadValue = currentValue();
    config.onChange?.(payloadValue);
    hub.emit('change', payloadValue);
    dispatchDomEvent(el, 'change', { value: payloadValue });
  }

  function createItem(option) {
    const item = doc.createElement('button');
    item.type = 'button';
    item.classList.add('aos-select-item');
    item.dataset.value = option.value;
    item.textContent = option.label ?? option.value;
    item.disabled = !!option.disabled;
    applyDataset(item, option.dataset);
    applyAttributes(item, option.attributes);
    return item;
  }

  function renderItems() {
    content.replaceChildren();
    for (const option of options) content.appendChild(createItem(option));
  }

  function sync() {
    const snapshot = adapter.connect();
    const selected = selectedOption(options, value);
    valueEl.textContent = selected?.label ?? value;
    trigger.disabled = disabled;
    trigger.setAttribute('aria-expanded', String(snapshot.open));
    trigger.setAttribute('data-state', snapshot.open ? 'open' : 'closed');
    content.hidden = !snapshot.open;
    content.setAttribute('data-state', snapshot.open ? 'open' : 'closed');
    el.dataset.state = snapshot.open ? 'open' : 'closed';
    el.dataset.value = value;
    for (const item of content.querySelectorAll('[data-value]')) {
      const selectedItem = item.dataset.value === value;
      item.classList.toggle('selected', selectedItem);
      item.setAttribute('aria-selected', String(selectedItem));
      item.disabled = !!selectedOption(options, item.dataset.value)?.disabled;
    }
  }

  function bindAll() {
    adapter.cleanupBindings();
    adapter.bind(el);
    sync();
  }

  renderItems();
  bindAll();

  return {
    el,
    getValue() {
      return currentValue();
    },
    getOptions() {
      return options.map((option) => ({ ...option }));
    },
    setOptions(nextOptions = [], update = {}) {
      options = normalizedOptions(nextOptions);
      const requested = update.value !== undefined ? stringValue(update.value) : value;
      value = options.some((option) => option.value === requested)
        ? requested
        : stringValue(options[0]?.value ?? '');
      renderItems();
      suppressAdapterChange = true;
      adapter.update({
        collection: optionCollection(options),
        value: value === '' ? [] : [value],
      });
      suppressAdapterChange = false;
      bindAll();
      if (update.emit) emitChange();
    },
    setValue(nextValue, update = {}) {
      value = stringValue(nextValue);
      suppressAdapterChange = true;
      adapter.setValue(value === '' ? [] : [value]);
      suppressAdapterChange = false;
      bindAll();
      if (update.emit) emitChange();
    },
    setDisabled(nextDisabled = true) {
      disabled = !!nextDisabled;
      adapter.update({ disabled });
      bindAll();
    },
    open() {
      adapter.open();
      sync();
    },
    close() {
      adapter.close();
      sync();
    },
    on(type, callback) {
      return type === 'change' ? hub.on(type, callback) : () => {};
    },
    destroy() {
      adapter.destroy();
      hub.clear();
    },
  };
}
