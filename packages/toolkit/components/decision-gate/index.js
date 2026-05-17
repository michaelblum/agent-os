import { createTimerBar } from '../../controls/timer-bar.js';
import { createForm } from '../../panel/form.js';

const DEFAULT_TIMEOUT_MS = 20000;

const FALLBACK_FIELDS = [{ id: 'text', kind: 'text', placeholder: 'Your response...' }];

function decodeBase64Json(value) {
  const decode = typeof atob === 'function'
    ? atob
    : (input) => Buffer.from(input, 'base64').toString('utf8');
  return JSON.parse(decode(value));
}

function requestFromLocation(win) {
  const search = win?.location?.search || '';
  if (!search) return null;
  const params = new URLSearchParams(search);
  if (params.has('requestB64')) return decodeBase64Json(params.get('requestB64'));
  if (params.has('request')) return JSON.parse(decodeURIComponent(params.get('request')));
  return null;
}

function normalizeRequest(input) {
  const request = input && typeof input === 'object' ? input : {};
  const ui = request.ui && typeof request.ui === 'object' ? request.ui : {};
  const fields = Array.isArray(request.fields) && request.fields.length ? request.fields : FALLBACK_FIELDS;

  return {
    request,
    title: String(request.prompt?.title || 'Decision required'),
    body: request.prompt?.body ?? null,
    fields,
    submitLabel: ui.submit_label || ui.submitLabel || 'Submit',
    timer: ui.timer || {},
    timeoutMs: Number.isFinite(Number(request.timeout_ms)) ? Number(request.timeout_ms) : DEFAULT_TIMEOUT_MS,
  };
}

function makeDismissIcon(doc) {
  const svg = doc.createElementNS?.('http://www.w3.org/2000/svg', 'svg') || doc.createElement('svg');
  const first = doc.createElementNS?.('http://www.w3.org/2000/svg', 'path') || doc.createElement('path');
  const second = doc.createElementNS?.('http://www.w3.org/2000/svg', 'path') || doc.createElement('path');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  first.setAttribute('d', 'M4 4l8 8');
  second.setAttribute('d', 'M12 4l-8 8');
  svg.append(first, second);
  return svg;
}

function shake(button, win) {
  button.classList.add('shake');
  win.setTimeout?.(() => button.classList.remove('shake'), 400);
}

function hasHiddenAncestor(element, root) {
  let current = element;
  while (current && current !== root) {
    if (current.hidden || current.classList?.contains?.('hidden')) return true;
    current = current.parentElement;
  }
  return false;
}

export function createDecisionGate(container, options = {}) {
  if (!container?.ownerDocument?.createElement) {
    throw new Error('createDecisionGate requires a DOM container');
  }

  const doc = container.ownerDocument;
  const win = doc.defaultView || globalThis;
  win.__gateResult = undefined;

  let request = options.request || null;
  if (!request) request = requestFromLocation(win);

  const config = normalizeRequest(request);
  let resolved = false;
  let submitting = false;
  let form = null;
  let timer = null;

  const root = doc.createElement('div');
  const header = doc.createElement('div');
  const title = doc.createElement('h2');
  const dismiss = doc.createElement('button');
  const formRegion = doc.createElement('div');
  const actions = doc.createElement('div');
  const submit = doc.createElement('button');
  const status = doc.createElement('div');
  let body = null;
  let timerRegion = null;

  root.classList.add('aos-gate');
  header.classList.add('aos-gate-header');
  title.classList.add('aos-gate-title');
  dismiss.classList.add('aos-button', 'ghost', 'aos-gate-dismiss');
  formRegion.classList.add('aos-gate-form');
  actions.classList.add('aos-gate-actions');
  submit.classList.add('aos-button', 'primary', 'aos-gate-submit');
  status.classList.add('aos-gate-status');

  title.textContent = config.title;
  dismiss.type = 'button';
  dismiss.setAttribute('aria-label', 'Dismiss');
  dismiss.appendChild(makeDismissIcon(doc));
  submit.type = 'button';
  submit.textContent = config.submitLabel;
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  header.append(title, dismiss);
  root.appendChild(header);

  if (config.body !== null && config.body !== undefined && config.body !== '') {
    body = doc.createElement('div');
    body.classList.add('aos-gate-body');
    body.textContent = String(config.body);
    root.appendChild(body);
  }

  root.appendChild(formRegion);
  actions.appendChild(submit);
  root.appendChild(actions);
  root.appendChild(status);

  if (config.timer?.visible) {
    timerRegion = doc.createElement('div');
    timerRegion.classList.add('aos-gate-timer');
    root.appendChild(timerRegion);
  }

  container.replaceChildren?.();
  container.appendChild(root);

  const setStatus = (text, terminal = false) => {
    status.textContent = text ? String(text) : '';
    if (terminal) root.dataset.terminal = 'true';
  };

  const setControlsDisabled = (disabled) => {
    submit.disabled = disabled;
    dismiss.disabled = disabled;
    form?.setDisabled?.(disabled);
  };

  const resolve = (value) => {
    if (resolved) return;
    resolved = true;
    timer?.destroy?.();
    win.__gateResult = JSON.stringify(value);
    doc.dispatchEvent?.(new win.CustomEvent('gate:resolved', { detail: { value } }));
  };

  const resolveNoAnswer = (status) => {
    if (submitting) return;
    resolve({ result: null, status });
  };

  const submitGate = async () => {
    if (resolved || submitting) return;
    if (!form.isValid()) {
      shake(submit, win);
      return;
    }
    const values = form.getValues();
    if (typeof options.onSubmit !== 'function') {
      resolve(values);
      return;
    }
    submitting = true;
    setControlsDisabled(true);
    setStatus(options.pendingStatus || 'Submitting...');
    try {
      const result = await options.onSubmit(values);
      if (resolved) return;
      resolved = true;
      timer?.destroy?.();
      win.__gateResult = JSON.stringify(values);
      setStatus(result?.duplicate ? 'Already submitted.' : 'Submitted.', true);
      doc.dispatchEvent?.(new win.CustomEvent('gate:resolved', { detail: { value: values, result } }));
    } catch (error) {
      submitting = false;
      setControlsDisabled(false);
      setStatus(error?.message || 'Unable to submit.');
      doc.dispatchEvent?.(new win.CustomEvent('gate:error', { detail: { error } }));
    }
  };

  const keydown = (event) => {
    if (resolved) return;
    if (event.key === 'Escape') {
      event.preventDefault?.();
      resolveNoAnswer('dismissed');
      return;
    }
    if (event.key === 'Tab') {
      const focusable = root
        .querySelectorAll('button,input,select,textarea,[tabindex]')
        .filter((element) => !element.disabled && !hasHiddenAncestor(element, root));
      if (!focusable.length) return;
      const currentIndex = focusable.indexOf(doc.activeElement);
      const nextIndex = event.shiftKey
        ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
        : (currentIndex === focusable.length - 1 ? 0 : currentIndex + 1);
      event.preventDefault?.();
      focusable[nextIndex].focus?.();
      return;
    }
    if (event.key === 'Enter' && event.target?.matches?.('input[type="text"],textarea')) {
      event.preventDefault?.();
      submitGate();
    }
  };

  form = createForm(formRegion, config.fields, { document: doc });
  submit.addEventListener('click', submitGate);
  dismiss.addEventListener('click', () => resolveNoAnswer('dismissed'));
  doc.addEventListener?.('keydown', keydown);
  form.focus();

  if (timerRegion) {
    timer = createTimerBar({
      document: doc,
      totalMs: config.timeoutMs,
      display: config.timer.display,
      direction: config.timer.direction,
      flashThresholdMs: config.timer.flash_threshold_ms ?? config.timer.flashThresholdMs,
      flashIntervalMs: config.timer.flash_interval_ms ?? config.timer.flashIntervalMs,
      onExpire: () => resolveNoAnswer('timeout'),
    });
    timerRegion.appendChild(timer.el);
    timer.start();
  }

  return {
    el: root,
    form,
    resolve,
    setStatus,
    destroy() {
      timer?.destroy?.();
      form?.destroy?.();
      submit.removeEventListener('click', submitGate);
      doc.removeEventListener?.('keydown', keydown);
      root.remove?.();
    },
  };
}

export default function DecisionGate(options = {}) {
  return {
    manifest: {
      name: 'decision-gate',
      title: 'Decision Gate',
      accepts: [],
      emits: [],
      defaultSize: { w: 520, h: 360 },
    },
    render(host) {
      const container = host?.contentEl?.ownerDocument?.createElement
        ? host.contentEl.ownerDocument.createElement('div')
        : document.createElement('div');
      createDecisionGate(container, options);
      return container;
    },
  };
}
