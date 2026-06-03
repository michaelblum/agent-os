import { mergeProps } from './shared.js';

const ROOT_SELECTOR = '[data-aos-slider-root]';
const LABEL_SELECTOR = '[data-aos-slider-label]';
const CONTROL_SELECTOR = '[data-aos-slider-control]';
const TRACK_SELECTOR = '[data-aos-slider-track]';
const RANGE_SELECTOR = '[data-aos-slider-range]';
const OUTPUT_SELECTOR = '[data-aos-slider-output]';
const THUMB_SELECTOR = '[data-aos-slider-thumb]';

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function valuesFor(value, fallback = 0) {
  const base = finiteNumber(fallback, 0);
  const values = (Array.isArray(value) ? value : [value]).map((item) => finiteNumber(item, base));
  return values.length ? values : [base];
}

function setAttrs(element, props = {}) {
  if (!element) return () => {};
  const previous = new Map();
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith('on') && typeof value === 'function') {
      const eventName = key.slice(2).toLowerCase();
      element.addEventListener?.(eventName, value);
      previous.set(key, () => element.removeEventListener?.(eventName, value));
      continue;
    }
    const attr = key === 'className' ? 'class' : key;
    previous.set(attr, element.getAttribute?.(attr));
    if (value === false || value === undefined || value === null) {
      element.removeAttribute?.(attr);
      if (value === false && attr in element) element[attr] = false;
    } else if (value === true) {
      element.setAttribute?.(attr, '');
      if (attr in element) element[attr] = true;
    } else {
      element.setAttribute?.(attr, String(value));
    }
  }
  return () => {
    for (const [key, value] of previous) {
      if (typeof value === 'function') value();
      else if (value === null || value === undefined) element.removeAttribute?.(key);
      else element.setAttribute?.(key, value);
    }
  };
}

function compactProps(props = {}) {
  return Object.fromEntries(Object.entries(props).filter(([, value]) => value !== undefined));
}

function percentFor(value, min, max) {
  const span = Math.max(1, max - min);
  return Math.min(100, Math.max(0, ((value - min) / span) * 100));
}

function valueText(values = []) {
  return values.map((value) => Number.parseFloat(finiteNumber(value, 0).toFixed(4)).toString()).join(' - ');
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function quantize(value, step, min) {
  const normalizedStep = finiteNumber(step, 1);
  const snap = normalizedStep > 0 ? normalizedStep : 1;
  return Number.parseFloat((Math.round((value - min) / snap) * snap + min).toFixed(6));
}

export function createAosZagSlider(context = {}) {
  if (!context.id) throw new Error('createAosZagSlider requires an id');

  let currentProps = compactProps({
    id: context.id,
    value: context.value,
    defaultValue: context.defaultValue,
    min: context.min,
    max: context.max,
    step: context.step,
    minStepsBetweenThumbs: context.minStepsBetweenThumbs,
    orientation: context.orientation || 'horizontal',
    disabled: context.disabled,
    readOnly: context.readOnly,
    invalid: context.invalid,
    name: context.name,
    form: context.form,
    getAriaValueText: context.getAriaValueText,
    onValueChange: context.onValueChange,
    onValueChangeEnd: context.onValueChangeEnd,
  });
  let values = valuesFor(currentProps.value ?? currentProps.defaultValue, currentProps.min);
  const cleanups = new Set();
  const min = () => finiteNumber(currentProps.min, 0);
  const max = () => finiteNumber(currentProps.max, 100);
  const disabled = () => !!currentProps.disabled;
  const step = () => {
    const configured = finiteNumber(currentProps.step, 1);
    return configured > 0 ? configured : 1;
  };
  let controlElement = null;
  let activePointer = null;
  let activeThumbIndex = 0;

  function getRootProps(extra = {}) {
    return mergeProps({
      id: currentProps.id,
      'data-scope': 'slider',
      'data-part': 'root',
      'data-orientation': currentProps.orientation || 'horizontal',
      'data-disabled': disabled() ? '' : undefined,
    }, extra);
  }

  function getLabelProps(extra = {}) {
    return mergeProps({
      id: `${currentProps.id}-label`,
      'data-scope': 'slider',
      'data-part': 'label',
    }, extra);
  }

  function getControlProps(extra = {}) {
    return mergeProps({
      'data-scope': 'slider',
      'data-part': 'control',
      'data-orientation': currentProps.orientation || 'horizontal',
    }, extra);
  }

  function getTrackProps(extra = {}) {
    return mergeProps({
      'data-scope': 'slider',
      'data-part': 'track',
      'data-orientation': currentProps.orientation || 'horizontal',
    }, extra);
  }

  function getRangeProps(extra = {}) {
    const sorted = [...values].sort((a, b) => a - b);
    const start = sorted.length > 1 ? percentFor(sorted[0], min(), max()) : 0;
    const end = percentFor(sorted[sorted.length - 1] ?? min(), min(), max());
    return mergeProps({
      'data-scope': 'slider',
      'data-part': 'range',
      style: `left:${start}%;width:${Math.max(0, end - start)}%;`,
    }, extra);
  }

  function getValueTextProps(extra = {}) {
    return mergeProps({
      'data-scope': 'slider',
      'data-part': 'value-text',
    }, extra);
  }

  function getThumbProps(props = {}, extra = {}) {
    const index = finiteNumber(props.index, 0);
    const value = finiteNumber(values[index], min());
    const ariaValueText = currentProps.getAriaValueText?.({ value, index, values: [...values] });
    return mergeProps({
      id: `${currentProps.id}-thumb-${index}`,
      role: 'slider',
      tabindex: disabled() ? '-1' : '0',
      'aria-valuemin': min(),
      'aria-valuemax': max(),
      'aria-valuenow': value,
      'aria-valuetext': ariaValueText,
      'aria-disabled': disabled() ? 'true' : undefined,
      'data-scope': 'slider',
      'data-part': 'thumb',
      'data-index': index,
      style: `left:${percentFor(value, min(), max())}%;`,
    }, extra);
  }

  function api() {
    return {
      value: [...values],
      focused: false,
      getRootProps,
      getLabelProps,
      getControlProps,
      getTrackProps,
      getRangeProps,
      getValueTextProps,
      getThumbProps,
      setValue(nextValue) {
        setValue(nextValue);
      },
    };
  }

  function snapshot() {
    const sliderApi = api();
    return {
      api: sliderApi,
      service: null,
      value: [...values],
      focused: false,
      state: 'idle',
      send: () => {},
      getRootProps,
      getLabelProps,
      getControlProps,
      getTrackProps,
      getRangeProps,
      getValueTextProps,
      getOutputProps: getValueTextProps,
      getThumbProps,
      setValue,
    };
  }

  function cleanupBindings() {
    for (const cleanup of cleanups) cleanup();
    cleanups.clear();
    controlElement = null;
  }

  function bindPart(element, props) {
    const cleanup = setAttrs(element, props);
    cleanups.add(cleanup);
    return cleanup;
  }

  function bindRoot(element, extra = {}) {
    return bindPart(element, getRootProps(extra));
  }

  function bindLabel(element, extra = {}) {
    return bindPart(element, getLabelProps(extra));
  }

  function pointerClientX(event = {}) {
    return finiteNumber(event.clientX ?? event.x ?? event.pageX ?? event.screenX, null);
  }

  function nearestThumbIndex(value) {
    if (values.length <= 1) return 0;
    let nearest = 0;
    let distance = Infinity;
    values.forEach((item, index) => {
      const nextDistance = Math.abs(item - value);
      if (nextDistance < distance) {
        nearest = index;
        distance = nextDistance;
      }
    });
    return nearest;
  }

  function valueFromPointer(event = {}) {
    const rect = controlElement?.getBoundingClientRect?.();
    const x = pointerClientX(event);
    if (!rect || x === null || rect.width <= 0) return null;
    const nextMin = min();
    const nextMax = max();
    const ratio = clamp((x - rect.left) / rect.width, 0, 1);
    const rawValue = nextMin + ((nextMax - nextMin) * ratio);
    return clamp(quantize(rawValue, step(), nextMin), nextMin, nextMax);
  }

  function applyPointerValue(event = {}, { commit = false } = {}) {
    const nextValue = valueFromPointer(event);
    if (nextValue === null) return false;
    const nextValues = [...values];
    const index = activeThumbIndex ?? nearestThumbIndex(nextValue);
    nextValues[index] = nextValue;
    values = nextValues;
    currentProps.onValueChange?.({ value: [...values] });
    if (commit) currentProps.onValueChangeEnd?.({ value: [...values] });
    return true;
  }

  function endPointerDrag(event = {}) {
    if (!activePointer) return;
    applyPointerValue(event, { commit: true });
    activePointer = null;
    const doc = controlElement?.ownerDocument;
    const view = doc?.defaultView;
    const target = doc || view;
    target?.removeEventListener?.('pointermove', handlePointerMove);
    target?.removeEventListener?.('pointerup', endPointerDrag);
    target?.removeEventListener?.('pointercancel', endPointerDrag);
    target?.removeEventListener?.('mousemove', handlePointerMove);
    target?.removeEventListener?.('mouseup', endPointerDrag);
  }

  function handlePointerMove(event = {}) {
    if (!activePointer) return;
    if (event.pointerId !== undefined && activePointer.pointerId !== null && event.pointerId !== activePointer.pointerId) return;
    event.preventDefault?.();
    applyPointerValue(event);
  }

  function startPointerDrag(event = {}) {
    if (disabled()) return;
    const pointerId = event.pointerId ?? null;
    const initialValue = valueFromPointer(event);
    if (initialValue === null) return;
    event.preventDefault?.();
    activeThumbIndex = nearestThumbIndex(initialValue);
    activePointer = { pointerId };
    controlElement?.setPointerCapture?.(pointerId);
    applyPointerValue(event);
    const doc = controlElement?.ownerDocument;
    const view = doc?.defaultView;
    const target = doc || view;
    target?.addEventListener?.('pointermove', handlePointerMove);
    target?.addEventListener?.('pointerup', endPointerDrag);
    target?.addEventListener?.('pointercancel', endPointerDrag);
    target?.addEventListener?.('mousemove', handlePointerMove);
    target?.addEventListener?.('mouseup', endPointerDrag);
  }

  function bindControl(element, extra = {}) {
    controlElement = element || controlElement;
    const cleanup = bindPart(element, getControlProps(extra));
    if (element) {
      element.addEventListener?.('pointerdown', startPointerDrag);
      element.addEventListener?.('mousedown', startPointerDrag);
      cleanups.add(() => {
        element.removeEventListener?.('pointerdown', startPointerDrag);
        element.removeEventListener?.('mousedown', startPointerDrag);
      });
    }
    return cleanup;
  }

  function bindTrack(element, extra = {}) {
    return bindPart(element, getTrackProps(extra));
  }

  function bindRange(element, extra = {}) {
    return bindPart(element, getRangeProps(extra));
  }

  function bindOutput(element, extra = {}) {
    return bindPart(element, getValueTextProps(extra));
  }

  function bindThumb(element, extraProps = {}, index = 0) {
    return bindPart(element, getThumbProps({ index }, extraProps.extra || {}));
  }

  function bindMany(root, selector, binder, getProps = null) {
    const elements = Array.from(root?.querySelectorAll?.(selector) || []);
    elements.forEach((element, index) => binder(element, getProps?.(element, index) || {}, index));
    return elements.length;
  }

  function bind(root, options = {}) {
    cleanupBindings();
    bindRoot(options.root || root?.querySelector?.(ROOT_SELECTOR) || root, options.rootProps || {});
    bindLabel(options.label || root?.querySelector?.(LABEL_SELECTOR), options.labelProps || {});
    bindControl(options.control || root?.querySelector?.(CONTROL_SELECTOR), options.controlProps || {});
    bindTrack(options.track || root?.querySelector?.(TRACK_SELECTOR), options.trackProps || {});
    bindRange(options.range || root?.querySelector?.(RANGE_SELECTOR), options.rangeProps || {});
    bindOutput(options.output || root?.querySelector?.(OUTPUT_SELECTOR), options.outputProps || {});
    bindThumbs(root, options.thumbSelector || THUMB_SELECTOR, options.getThumbProps || null);
    return snapshot();
  }

  function bindThumbs(root, selector = THUMB_SELECTOR, getProps = null) {
    return bindMany(root, selector, bindThumb, getProps);
  }

  function setValue(nextValue) {
    values = valuesFor(nextValue, currentProps.min);
    currentProps.onValueChange?.({ value: [...values] });
    currentProps.onValueChangeEnd?.({ value: [...values] });
    return snapshot();
  }

  return {
    bind,
    bindMany,
    bindRoot,
    bindLabel,
    bindControl,
    bindTrack,
    bindRange,
    bindOutput,
    bindThumb,
    bindThumbs,
    cleanupBindings,
    connect: snapshot,
    destroy() {
      cleanupBindings();
    },
    send: () => {},
    service: null,
    spreadProps: setAttrs,
    update(nextContext = {}) {
      currentProps = compactProps({ ...currentProps, ...nextContext });
      if (nextContext.value !== undefined) values = valuesFor(nextContext.value, currentProps.min);
      return snapshot();
    },
    setValue,
  };
}
