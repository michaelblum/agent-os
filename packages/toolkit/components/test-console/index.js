import { emit } from '../../runtime/bridge.js';
import {
  TEST_CONSOLE_MESSAGE_TYPES,
  TEST_CONSOLE_SCHEMA_VERSION,
  TEST_CONSOLE_SURFACE,
  createTestConsoleHumanResponse,
  createTestConsoleState,
  loadTestConsolePayload,
  renderTestConsoleHtml,
  requestTestConsoleOpenEvidence,
  requestTestConsoleRetry,
  testConsoleSnapshot,
} from './model.js';
import { applyTestConsoleSemantics } from './semantics.js';

function messageType(message = {}) {
  return String(message.type || '');
}

function messagePayload(message = {}) {
  return message.payload && typeof message.payload === 'object' ? message.payload : message;
}

function matchesType(type, expected) {
  if (type === expected) return true;
  if (type === expected.replace(/^test_console\./, '')) return true;
  return false;
}

export default function TestConsole(options = {}) {
  const state = createTestConsoleState(options.initialState || {});
  let host = null;
  let rootEl = null;
  let noteEl = null;

  function publish(result) {
    window.__testConsoleLastEmission = result;
    emit(result.type, result);
  }

  function sync() {
    const snapshot = testConsoleSnapshot(state);
    window.__testConsoleState = snapshot;
    if (host) host.setTitle(snapshot.step_id ? `Test Console - ${snapshot.title}` : 'Test Console V0');
    if (!rootEl) return;
    rootEl.innerHTML = renderTestConsoleHtml(snapshot);
    applyTestConsoleSemantics(rootEl, state);
    wireControls();
  }

  function currentSummary(kind) {
    const note = noteEl?.value?.trim?.() || '';
    if (note) return note;
    if (kind === 'note') return 'Supervisor note recorded from the test console.';
    return '';
  }

  function captureResponse(kind) {
    try {
      const result = createTestConsoleHumanResponse(state, {
        response: kind,
        summary: currentSummary(kind),
      });
      publish(result);
      sync();
    } catch (error) {
      state.last_result = {
        type: TEST_CONSOLE_MESSAGE_TYPES.humanResponseCaptured,
        schema_version: TEST_CONSOLE_SCHEMA_VERSION,
        status: 'rejected',
        reason: String(error?.message || error),
      };
      sync();
    }
  }

  function requestRetry() {
    const result = requestTestConsoleRetry(state);
    publish(result);
    sync();
  }

  function requestOpenEvidence(ref) {
    const result = requestTestConsoleOpenEvidence(state, { ref });
    publish(result);
    sync();
  }

  function wireControls() {
    noteEl = rootEl.querySelector('#test-console-note');
    noteEl?.addEventListener('input', (event) => {
      state.note = String(event.target.value || '');
      window.__testConsoleState = testConsoleSnapshot(state);
    });

    rootEl.querySelector('[data-action="confirm"]')?.addEventListener('click', () => captureResponse('confirmed'));
    rootEl.querySelector('[data-action="fail"]')?.addEventListener('click', () => captureResponse('failed'));
    rootEl.querySelector('[data-action="blocked"]')?.addEventListener('click', () => captureResponse('blocked'));
    rootEl.querySelector('[data-action="add-note"]')?.addEventListener('click', () => captureResponse('note'));
    rootEl.querySelector('[data-action="retry"]')?.addEventListener('click', () => requestRetry());
    rootEl.querySelectorAll('[data-action="open-evidence"]').forEach((button) => {
      button.addEventListener('click', () => requestOpenEvidence(button.dataset.ref || ''));
    });
  }

  return {
    manifest: {
      name: TEST_CONSOLE_SURFACE,
      title: 'Test Console V0',
      accepts: [
        TEST_CONSOLE_MESSAGE_TYPES.load,
        'load',
      ],
      emits: [
        TEST_CONSOLE_MESSAGE_TYPES.humanResponseCaptured,
        TEST_CONSOLE_MESSAGE_TYPES.retryRequested,
        TEST_CONSOLE_MESSAGE_TYPES.evidenceOpenRequested,
      ],
      channelPrefix: TEST_CONSOLE_SURFACE,
      defaultSize: { w: 880, h: 720 },
    },

    render(host_) {
      host = host_;
      host.contentEl.style.overflow = 'hidden';
      rootEl = document.createElement('div');
      rootEl.className = 'test-console-root';
      sync();
      return rootEl;
    },

    onMessage(message = {}) {
      const type = messageType(message);
      if (matchesType(type, TEST_CONSOLE_MESSAGE_TYPES.load)) {
        loadTestConsolePayload(state, messagePayload(message));
        sync();
      }
    },

    serialize() {
      return {
        run: state.run,
        step: state.step,
        operating_path: state.operating_path,
        evidence_refs: state.evidence_refs,
        artifact_refs: state.artifact_refs,
        bridge: state.bridge,
        note: state.note,
        last_result: state.last_result,
      };
    },

    restore(savedState) {
      if (!savedState) return;
      loadTestConsolePayload(state, savedState);
      if (savedState.last_result) state.last_result = savedState.last_result;
      sync();
    },
  };
}
