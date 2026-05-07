import { applySemanticTargetAttributes } from '../../runtime/semantic-targets.js';

export const TEST_CONSOLE_SURFACE = 'test-console-v0';
export const TEST_CONSOLE_URL = 'aos://toolkit/components/test-console/index.html';

const REF_IDS = Object.freeze({
  root: 'root',
  confirm: 'response-confirm',
  fail: 'response-fail',
  blocked: 'response-blocked',
  note: 'response-note',
  noteInput: 'response-note-input',
  retry: 'retry',
  openEvidence: 'open-evidence',
});

function refPart(part) {
  return String(part || 'unknown')
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9:_-]/g, '-');
}

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function setDataset(element, name, value) {
  if (!element?.dataset) return;
  if (value === undefined || value === null || value === '') {
    delete element.dataset[name];
    return;
  }
  element.dataset[name] = String(value);
}

export function testConsoleAosRef(...parts) {
  return [TEST_CONSOLE_SURFACE, ...parts].map(refPart).join(':');
}

export function testConsoleSemanticRefs() {
  return Object.fromEntries(
    Object.entries(REF_IDS).map(([key, value]) => [key, testConsoleAosRef(value)]),
  );
}

export function applyTestConsoleSemanticTarget(element, target = {}, options = {}) {
  if (!element) return null;
  const preservedText = options.preserveText ? element.textContent : null;
  const preservedValue = options.preserveValue ? element.value : null;
  const normalized = applySemanticTargetAttributes(element, {
    id: target.id,
    role: target.role || 'AXButton',
    name: target.name,
    action: target.action,
    aosRef: target.aosRef || testConsoleAosRef(target.id),
    surface: TEST_CONSOLE_SURFACE,
    enabled: target.enabled,
    selected: target.selected,
    current: target.current,
    value: target.value,
  }, {
    idPrefix: options.idPrefix === undefined ? TEST_CONSOLE_SURFACE : options.idPrefix,
    visibleLabel: options.visibleLabel,
  });
  if (options.preserveText) element.textContent = preservedText;
  if (options.preserveValue) element.value = preservedValue;
  return normalized;
}

export function applyTestConsoleSemantics(rootEl, state = {}) {
  if (!rootEl?.querySelector) return;

  rootEl.id = rootEl.id || 'test-console-root';
  rootEl.setAttribute?.('role', 'group');
  rootEl.setAttribute?.('aria-label', 'Supervised run test console');
  setDataset(rootEl, 'aosRef', testConsoleAosRef('root'));
  setDataset(rootEl, 'aosAction', 'inspect_console');
  setDataset(rootEl, 'aosSurface', TEST_CONSOLE_SURFACE);
  setDataset(rootEl, 'semanticTargetId', 'root');

  applyTestConsoleSemanticTarget(rootEl.querySelector('[data-action="confirm"]'), {
    id: REF_IDS.confirm,
    name: 'Confirm supervised step',
    action: 'human_response.confirmed',
    enabled: !!state.step,
  }, {
    preserveText: true,
  });

  applyTestConsoleSemanticTarget(rootEl.querySelector('[data-action="fail"]'), {
    id: REF_IDS.fail,
    name: 'Fail supervised step',
    action: 'human_response.failed',
    enabled: !!state.step,
  }, {
    preserveText: true,
  });

  applyTestConsoleSemanticTarget(rootEl.querySelector('[data-action="blocked"]'), {
    id: REF_IDS.blocked,
    name: 'Block supervised step',
    action: 'human_response.blocked',
    enabled: !!state.step,
  }, {
    preserveText: true,
  });

  applyTestConsoleSemanticTarget(rootEl.querySelector('[data-action="add-note"]'), {
    id: REF_IDS.note,
    name: 'Add supervised step note',
    action: 'human_response.note',
    enabled: !!state.step,
  }, {
    preserveText: true,
  });

  const noteInput = rootEl.querySelector('#test-console-note');
  applyTestConsoleSemanticTarget(noteInput, {
    id: REF_IDS.noteInput,
    role: 'AXTextArea',
    name: 'Supervisor note',
    action: 'edit_human_response_note',
    value: noteInput?.value ?? state.note,
    enabled: !!state.step,
  }, {
    idPrefix: null,
    preserveValue: true,
  });

  applyTestConsoleSemanticTarget(rootEl.querySelector('[data-action="retry"]'), {
    id: REF_IDS.retry,
    name: 'Request supervised step retry',
    action: 'retry_requested',
    enabled: !!state.step,
  }, {
    preserveText: true,
  });

  rootEl.querySelectorAll?.('[data-action="open-evidence"]').forEach((button) => {
    const ref = text(button.dataset?.ref, 'evidence');
    const targetId = `evidence-open-${refPart(ref)}`;
    applyTestConsoleSemanticTarget(button, {
      id: targetId,
      name: `Open evidence ${ref}`,
      action: 'open_evidence',
      aosRef: testConsoleAosRef('evidence', 'open', refPart(ref)),
      enabled: !!state.step,
    }, {
      preserveText: true,
    });
  });
}
