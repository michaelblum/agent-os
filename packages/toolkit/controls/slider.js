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

function sliderAosRef(config = {}, id = rootId(config)) {
  if (config.aosRef) return String(config.aosRef);
  const surface = String(config.surface || config.surfaceId || '').trim();
  return surface ? `${surface}:${id}` : id;
}

function sliderName(config = {}, id = '') {
  return String(config.ariaLabel || config.label || config.name || id || 'Slider');
}

function sliderSemanticParts(config = {}, values = [], id = rootId(config)) {
  const min = finiteNumber(config.min, 0);
  const max = finiteNumber(config.max, 100);
  const step = finiteNumber(config.step, 1);
  const orientation = String(config.orientation || 'horizontal');
  const parts = [
    'role="slider"',
    `aria-label="${escapeHtml(sliderName(config, id))}"`,
    `aria-valuemin="${escapeHtml(min)}"`,
    `aria-valuemax="${escapeHtml(max)}"`,
    `aria-valuenow="${escapeHtml(values[0] ?? min)}"`,
    `aria-valuetext="${escapeHtml(outputText(values, config.unit))}"`,
    `aria-orientation="${escapeHtml(orientation)}"`,
    `data-aos-ref="${escapeHtml(sliderAosRef(config, id))}"`,
    `data-aos-surface="${escapeHtml(config.surface || config.surfaceId || '')}"`,
    `data-semantic-target-id="${escapeHtml(config.semanticTargetId || id)}"`,
    `data-aos-actions="${values.length === 1 ? 'drag set-value' : 'drag'}"`,
    `data-aos-values="${escapeHtml(JSON.stringify(values))}"`,
    `data-aos-min="${escapeHtml(min)}"`,
    `data-aos-max="${escapeHtml(max)}"`,
    `data-aos-step="${escapeHtml(step)}"`,
    `data-aos-thumb-count="${escapeHtml(values.length)}"`,
  ];
  if (config.disabled) parts.push('aria-disabled="true"');
  return parts.filter((part) => !part.endsWith('=""'));
}

export function renderSliderHtml(config = {}) {
  const values = sliderValues(config.value, config.min);
  const id = rootId(config);
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
      <div class="aos-slider-control" data-aos-slider-control ${sliderSemanticParts(config, values, id).join(' ')}>
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
  let pendingBind = false;

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
      scheduleBindAll();
      if (!suppressAdapterChange) emitChange();
    },
    onValueChangeEnd(details = {}) {
      values = sliderValues(details.value, config.min);
      updateOutput();
      scheduleBindAll();
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

  function syncSemanticMetadata() {
    const min = finiteNumber(config.min, 0);
    const max = finiteNumber(config.max, 100);
    const step = finiteNumber(config.step, 1);
    controlEl.setAttribute('role', 'slider');
    controlEl.setAttribute('aria-label', sliderName(config, id));
    controlEl.setAttribute('aria-valuemin', String(min));
    controlEl.setAttribute('aria-valuemax', String(max));
    controlEl.setAttribute('aria-valuenow', String(values[0] ?? min));
    controlEl.setAttribute('aria-valuetext', outputText(values, config.unit));
    controlEl.setAttribute('aria-orientation', String(config.orientation || 'horizontal'));
    controlEl.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    controlEl.dataset.aosRef = sliderAosRef(config, id);
    controlEl.dataset.aosSurface = String(config.surface || config.surfaceId || '');
    controlEl.dataset.semanticTargetId = String(config.semanticTargetId || id);
    controlEl.dataset.aosActions = values.length === 1 ? 'drag set-value' : 'drag';
    controlEl.dataset.aosValues = JSON.stringify(values);
    controlEl.dataset.aosMin = String(min);
    controlEl.dataset.aosMax = String(max);
    controlEl.dataset.aosStep = String(step);
    controlEl.dataset.aosThumbCount = String(values.length);
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
    pendingBind = false;
    syncSemanticMetadata();
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

  function scheduleBindAll() {
    if (pendingBind) return;
    pendingBind = true;
    const defer = globalThis.queueMicrotask || ((callback) => Promise.resolve().then(callback));
    defer(() => {
      if (pendingBind) bindAll();
    });
  }

  syncThumbs();
  updateOutput();
  syncSemanticMetadata();
  bindAll();

  function handleSemanticAction(event) {
    const detail = event?.detail || {};
    const action = detail.action || detail.primitive;
    if (disabled || values.length !== 1) return;
    if (action !== 'set-value' && action !== 'drag') return;
    const nextValue = finiteNumber(detail.value ?? detail.toValue ?? detail.to_value, NaN);
    if (!Number.isFinite(nextValue)) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    const min = finiteNumber(config.min, 0);
    const max = finiteNumber(config.max, 100);
    const clamped = Math.min(Math.max(nextValue, min), max);
    values = [clamped];
    syncThumbs();
    updateOutput();
    syncSemanticMetadata();
    suppressAdapterChange = true;
    adapter.setValue(values);
    suppressAdapterChange = false;
    bindAll();
    emitChange();
    emitCommit();
  }

  el.addEventListener('aos:semantic-action', handleSemanticAction);

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
      syncSemanticMetadata();
      bindAll();
    },
    on(type, callback) {
      return type === 'change' || type === 'commit' ? hub.on(type, callback) : () => {};
    },
    destroy() {
      el.removeEventListener('aos:semantic-action', handleSemanticAction);
      adapter.destroy();
      hub.clear();
    },
  };
}
