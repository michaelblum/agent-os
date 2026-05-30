import { createAosZagSlider } from '../adapters/zag/slider.js';
import { createEventHub, dispatchDomEvent, ownerDocument } from './_events.js';
import { attributeParts, escapeHtml } from './_html.js';

let nextSliderId = 0;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function sliderValues(value, fallback = 0) {
  const base = finiteNumber(fallback, 0);
  const values = (Array.isArray(value) ? value : [value])
    .map((item) => finiteNumber(item, base));
  return values.length ? values : [base];
}

function publicValue(values = []) {
  return values.length === 1 ? values[0] : [...values];
}

function outputText(values = [], unit = '') {
  const text = values
    .map((value) => Number.parseFloat(finiteNumber(value, 0).toFixed(4)).toString())
    .join(' - ');
  return unit ? `${text} ${unit}` : text;
}

function dataPart(element, name) {
  element.setAttribute(name, '');
}

function rootId(config = {}) {
  if (config.id) return String(config.id);
  nextSliderId += 1;
  return `aos-slider-${nextSliderId}`;
}

export function renderSliderHtml(config = {}) {
  const values = sliderValues(config.value, config.min);
  const rootParts = [
    'class="aos-slider"',
    'data-aos-slider-root',
  ];
  if (config.id) rootParts.push(`id="${escapeHtml(config.id)}"`);
  if (config.ariaLabel) rootParts.push(`aria-label="${escapeHtml(config.ariaLabel)}"`);
  if (config.disabled) rootParts.push('data-disabled');
  rootParts.push(...attributeParts(config));

  const label = config.label
    ? `<div class="aos-slider-label" data-aos-slider-label>${escapeHtml(config.label)}</div>`
    : '';
  const thumbs = values
    .map((_, index) => `<div class="aos-slider-thumb" data-aos-slider-thumb data-index="${index}"></div>`)
    .join('');
  const output = config.output === false
    ? ''
    : `<output class="aos-slider-output" data-aos-slider-output>${escapeHtml(outputText(values, config.unit))}</output>`;
  return `
    <div ${rootParts.join(' ')}>
      ${label}
      <div class="aos-slider-control" data-aos-slider-control>
        <div class="aos-slider-track" data-aos-slider-track>
          <div class="aos-slider-range" data-aos-slider-range></div>
        </div>
        ${thumbs}
      </div>
      ${output}
    </div>
  `.trim();
}

export function createSlider(config = {}) {
  const doc = ownerDocument(config);
  const hub = createEventHub();
  const el = doc.createElement('div');
  const controlEl = doc.createElement('div');
  const trackEl = doc.createElement('div');
  const rangeEl = doc.createElement('div');
  const outputEl = config.output === false ? null : doc.createElement('output');
  const labelEl = config.label ? doc.createElement('div') : null;
  const id = rootId(config);
  let values = sliderValues(config.value, config.min);
  let disabled = !!config.disabled;
  let suppressAdapterChange = false;
  let thumbEls = [];

  el.classList.add('aos-slider');
  dataPart(el, 'data-aos-slider-root');
  controlEl.classList.add('aos-slider-control');
  dataPart(controlEl, 'data-aos-slider-control');
  trackEl.classList.add('aos-slider-track');
  dataPart(trackEl, 'data-aos-slider-track');
  rangeEl.classList.add('aos-slider-range');
  dataPart(rangeEl, 'data-aos-slider-range');
  trackEl.appendChild(rangeEl);
  controlEl.appendChild(trackEl);

  if (labelEl) {
    labelEl.classList.add('aos-slider-label');
    dataPart(labelEl, 'data-aos-slider-label');
    labelEl.textContent = String(config.label);
    el.appendChild(labelEl);
  }
  el.appendChild(controlEl);
  if (outputEl) {
    outputEl.classList.add('aos-slider-output');
    dataPart(outputEl, 'data-aos-slider-output');
    el.appendChild(outputEl);
  }

  const adapter = createAosZagSlider({
    id,
    getRootNode: config.getRootNode || (() => doc),
    defaultValue: values,
    min: config.min,
    max: config.max,
    step: config.step,
    minStepsBetweenThumbs: config.minStepsBetweenThumbs,
    orientation: config.orientation,
    disabled,
    name: config.name,
    onValueChange(details = {}) {
      values = sliderValues(details.value, config.min);
      syncThumbs();
      updateOutput();
      bindAll();
      if (!suppressAdapterChange) emitChange();
    },
    onValueChangeEnd(details = {}) {
      values = sliderValues(details.value, config.min);
      updateOutput();
      if (!suppressAdapterChange) emitCommit();
    },
  });

  function emitChange() {
    const value = publicValue(values);
    config.onChange?.(value);
    hub.emit('change', value);
    dispatchDomEvent(el, 'change', { value, values: [...values] });
  }

  function emitCommit() {
    const value = publicValue(values);
    config.onCommit?.(value);
    hub.emit('commit', value);
    dispatchDomEvent(el, 'commit', { value, values: [...values] });
  }

  function updateOutput() {
    if (outputEl) outputEl.textContent = outputText(values, config.unit);
  }

  function createThumb(index) {
    const thumb = doc.createElement('div');
    thumb.classList.add('aos-slider-thumb');
    thumb.dataset.index = String(index);
    dataPart(thumb, 'data-aos-slider-thumb');
    return thumb;
  }

  function syncThumbs() {
    while (thumbEls.length > values.length) thumbEls.pop()?.remove?.();
    while (thumbEls.length < values.length) {
      const thumb = createThumb(thumbEls.length);
      thumbEls.push(thumb);
      controlEl.appendChild(thumb);
    }
    thumbEls.forEach((thumb, index) => {
      thumb.dataset.index = String(index);
    });
  }

  function bindAll() {
    adapter.cleanupBindings();
    adapter.bindRoot(el);
    if (labelEl) adapter.bindLabel(labelEl);
    adapter.bindControl(controlEl);
    adapter.bindTrack(trackEl);
    adapter.bindRange(rangeEl);
    if (outputEl) adapter.bindOutput(outputEl);
    thumbEls.forEach((thumb, index) => {
      adapter.bindThumb(thumb, { value: String(index) }, index);
    });
  }

  syncThumbs();
  updateOutput();
  bindAll();

  return {
    el,
    getValue() {
      return publicValue(values);
    },
    getValues() {
      return [...values];
    },
    setValue(value, options = {}) {
      values = sliderValues(value, config.min);
      syncThumbs();
      updateOutput();
      suppressAdapterChange = true;
      adapter.setValue(values);
      suppressAdapterChange = false;
      bindAll();
      if (options.emit) emitChange();
    },
    setDisabled(nextDisabled = true) {
      disabled = !!nextDisabled;
      adapter.update({ disabled });
      bindAll();
    },
    on(type, callback) {
      return type === 'change' || type === 'commit' ? hub.on(type, callback) : () => {};
    },
    destroy() {
      adapter.destroy();
      hub.clear();
    },
  };
}
