// number-field.js - reusable numeric field interaction behavior for AOS panels.
//
// AOS panels render in WKWebView, but toolkit controls should still feel like
// app controls. This module owns wheel/key stepping and emits normal DOM events
// so panels can stay focused on their domain state.

const DEFAULT_SELECTOR = '[data-aos-control~="number-field"]';
const DEFAULT_STEP = 1;
const DEFAULT_FINE_MULTIPLIER = 0.1;
const DEFAULT_COARSE_MULTIPLIER = 10;

function finiteNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function attrValue(input, name) {
  if (!input) return null;
  const attr = input.getAttribute?.(name);
  if (attr !== undefined && attr !== null) return attr;
  return input[name] ?? null;
}

function dataValue(input, name) {
  if (!input?.dataset) return null;
  return input.dataset[name] ?? null;
}

function numericAttr(input, name, fallback = null) {
  const raw = attrValue(input, name);
  if (raw === '' || raw === null || raw === undefined || raw === 'any') return fallback;
  return finiteNumber(raw, fallback);
}

function dataNumber(input, name, fallback = null) {
  const raw = dataValue(input, name);
  if (raw === '' || raw === null || raw === undefined || raw === 'any') return fallback;
  return finiteNumber(raw, fallback);
}

function decimalPlaces(value) {
  const text = String(value ?? '');
  if (!text || !Number.isFinite(Number(text))) return 0;
  const lower = text.toLowerCase();
  if (lower.includes('e-')) {
    const [, exponent = '0'] = lower.split('e-');
    return Math.max(0, Number.parseInt(exponent, 10) || 0);
  }
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}

function formatNumber(value, precisionHint = DEFAULT_STEP, currentValue = '') {
  const places = Math.min(12, Math.max(
    decimalPlaces(precisionHint),
    decimalPlaces(currentValue),
  ));
  return Number.parseFloat(value.toFixed(places)).toString();
}

function clamp(value, min, max) {
  let next = value;
  if (min !== null) next = Math.max(min, next);
  if (max !== null) next = Math.min(max, next);
  return next;
}

function dispatchBubblingEvent(input, type) {
  const EventCtor = input?.ownerDocument?.defaultView?.Event || globalThis.Event;
  let event = null;
  if (typeof EventCtor === 'function') {
    try {
      event = new EventCtor(type, { bubbles: true });
    } catch {
      event = null;
    }
  }
  input?.dispatchEvent?.(event || { type, bubbles: true });
}

function matchesSelector(target, selector) {
  if (!target) return false;
  if (typeof target.matches === 'function') return target.matches(selector);
  if (selector === DEFAULT_SELECTOR) {
    return String(target.dataset?.aosControl || '').split(/\s+/).includes('number-field');
  }
  return false;
}

function closestNumberField(target, selector) {
  if (!target) return null;
  if (typeof target.closest === 'function') return target.closest(selector);
  return matchesSelector(target, selector) ? target : null;
}

function isEnabledNumberField(input) {
  return !!input && !input.disabled && !input.readOnly;
}

function activeElementStateFor(input) {
  const ownerDocument = input?.ownerDocument;
  if (ownerDocument && 'activeElement' in ownerDocument) {
    return { known: true, active: ownerDocument.activeElement };
  }
  const document = globalThis.document;
  if (document && 'activeElement' in document) {
    return { known: true, active: document.activeElement };
  }
  return { known: false, active: null };
}

function shouldHandleField(input, options = {}) {
  if (!isEnabledNumberField(input)) return false;
  if (options.requireFocus === false) return true;
  const { known, active } = activeElementStateFor(input);
  return !known || active === input;
}

export function numberFieldBaseStep(input, options = {}) {
  const configured = dataNumber(input, 'aosStep', null)
    ?? numericAttr(input, 'step', null)
    ?? finiteNumber(options.step, DEFAULT_STEP);
  return configured && configured > 0 ? configured : DEFAULT_STEP;
}

export function numberFieldStepForEvent(input, event = {}, options = {}) {
  let step = numberFieldBaseStep(input, options);
  if (event.shiftKey) {
    step = dataNumber(input, 'aosStepCoarse', null)
      ?? (step * finiteNumber(options.coarseMultiplier, DEFAULT_COARSE_MULTIPLIER));
  }
  if (event.altKey) {
    step = dataNumber(input, 'aosStepFine', null)
      ?? (step * finiteNumber(options.fineMultiplier, DEFAULT_FINE_MULTIPLIER));
  }
  return step;
}

export function stepNumberField(input, direction = 1, options = {}) {
  if (!isEnabledNumberField(input)) return { applied: false, reason: 'disabled' };
  const normalizedDirection = direction < 0 ? -1 : direction > 0 ? 1 : 0;
  if (normalizedDirection === 0) return { applied: false, reason: 'no_direction' };

  const currentText = String(input.value ?? '');
  const current = finiteNumber(currentText, dataNumber(input, 'aosDefaultValue', 0) ?? 0);
  const step = finiteNumber(options.step, null) ?? numberFieldStepForEvent(input, options.event, options);
  const min = numericAttr(input, 'min', null);
  const max = numericAttr(input, 'max', null);
  const next = clamp(current + (normalizedDirection * step), min, max);
  const formatted = formatNumber(next, step, currentText);
  if (formatted === currentText) {
    return { applied: false, reason: 'unchanged', value: next };
  }

  input.value = formatted;
  if (options.dispatch !== false) {
    dispatchBubblingEvent(input, 'input');
    if (options.commit !== false) dispatchBubblingEvent(input, 'change');
  }
  options.onStep?.(next, { input, direction: normalizedDirection, step, event: options.event || null });
  return { applied: true, value: next, text: formatted, step, direction: normalizedDirection };
}

export function wheelDirection(event = {}) {
  const deltaY = finiteNumber(event.deltaY, 0);
  const deltaX = finiteNumber(event.deltaX, 0);
  if (Math.abs(deltaY) >= Math.abs(deltaX) && deltaY !== 0) return deltaY < 0 ? 1 : -1;
  if (deltaX !== 0) return deltaX < 0 ? 1 : -1;
  return 0;
}

export function handleNumberFieldWheel(event, options = {}) {
  if (!event || event.defaultPrevented) return false;
  const selector = options.selector || DEFAULT_SELECTOR;
  const input = closestNumberField(event.target, selector);
  if (!shouldHandleField(input, options)) return false;
  const direction = wheelDirection(event);
  if (!direction) return false;

  event.preventDefault?.();
  event.stopPropagation?.();
  stepNumberField(input, direction, { ...options, event, commit: options.commitOnWheel !== false });
  return true;
}

export function handleNumberFieldKeydown(event, options = {}) {
  if (!event || event.defaultPrevented || event.metaKey || event.ctrlKey) return false;
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return false;
  const selector = options.selector || DEFAULT_SELECTOR;
  const input = closestNumberField(event.target, selector);
  if (!shouldHandleField(input, options)) return false;

  event.preventDefault?.();
  event.stopPropagation?.();
  const direction = event.key === 'ArrowUp' ? 1 : -1;
  stepNumberField(input, direction, { ...options, event, commit: options.commitOnKey !== false });
  return true;
}

export function wireNumberFieldControls(root, options = {}) {
  if (!root?.addEventListener) return { dispose() {} };
  const wheel = (event) => handleNumberFieldWheel(event, options);
  const keydown = (event) => handleNumberFieldKeydown(event, options);
  root.addEventListener('wheel', wheel, { passive: false });
  root.addEventListener('keydown', keydown);
  return {
    dispose() {
      root.removeEventListener?.('wheel', wheel);
      root.removeEventListener?.('keydown', keydown);
    },
  };
}
