import { esc } from '../../runtime/bridge.js';
import {
  applyWorkRecordPatchResult,
  buildWorkRecordPatchRequest,
  createWorkRecordWorkbenchState,
  evidenceArtifacts,
  executionMapJson,
  openWorkRecord,
  updateWorkRecordExecutionMapJson,
  updateWorkRecordIntent,
  workRecordDiagnostics,
  workRecordWorkbenchSnapshot,
} from './model.js';

function el(tag, className, textContent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (textContent !== undefined) node.textContent = textContent;
  return node;
}

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function artifactLabel(artifact = {}) {
  return text(artifact.label || artifact.title || artifact.kind || artifact.path, 'artifact');
}

function renderEvidenceList(record = {}) {
  const artifacts = evidenceArtifacts(record);
  if (artifacts.length === 0) {
    return '<p class="work-record-muted">No evidence artifacts attached.</p>';
  }
  return (
    '<ol class="work-record-artifacts">'
      + artifacts.map((artifact) => (
        '<li>'
          + `<strong>${esc(artifactLabel(artifact))}</strong>`
          + `<span>${esc(text(artifact.path || artifact.url || artifact.id, 'no path'))}</span>`
          + `<em>${esc(text(artifact.kind, 'artifact'))}</em>`
        + '</li>'
      )).join('')
    + '</ol>'
  );
}

function renderHealth(record = {}) {
  const health = record.next_health || record.health || {};
  const state = text(health.state, 'unknown');
  const reason = text(health.reason);
  return (
    `<div class="work-record-health-state" data-health="${esc(state)}">`
      + `<strong>${esc(state)}</strong>`
      + `<span>${esc(reason || 'No health reason recorded')}</span>`
    + '</div>'
  );
}

function renderSummary(record = {}) {
  const diagnostics = workRecordDiagnostics(record);
  const rows = [
    ['Record', diagnostics.record_id],
    ['Type', diagnostics.record_type],
    ['Surface', diagnostics.surface || 'none'],
    ['Action', diagnostics.action_verb || 'none'],
    ['Artifacts', String(diagnostics.artifact_count)],
    ['Execution keys', diagnostics.execution_map_keys.join(', ') || 'none'],
  ];
  return rows.map(([label, value]) => (
    `<div class="work-record-summary-row"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`
  )).join('');
}

export default function WorkRecordWorkbench(options = {}) {
  let host = null;
  const state = createWorkRecordWorkbenchState({ record: options.record || null });
  const dom = {};

  function emit(type, payload) {
    if (host?.emit) host.emit(type, payload);
  }

  function syncTitle() {
    const record = state.record || {};
    host?.setTitle?.(`Work Record - ${record.id}${state.dirty ? ' *' : ''}`);
  }

  function syncDebugState() {
    window.__workRecordWorkbenchState = workRecordWorkbenchSnapshot(state);
  }

  function sync({ replaceEditorValues = false } = {}) {
    const record = state.record || {};
    const intent = record.intent || {};
    dom.recordId.textContent = record.id;
    dom.recordType.textContent = record.type;
    dom.dirty.textContent = state.dirty ? 'Unsaved changes' : 'Saved';
    dom.dirty.dataset.dirty = state.dirty ? 'true' : 'false';
    dom.summary.innerHTML = renderSummary(record);
    dom.health.innerHTML = renderHealth(record);
    dom.evidence.innerHTML = renderEvidenceList(record);
    dom.status.textContent = state.lastResult
      ? `${state.lastResult.status}: ${state.lastResult.message || state.lastResult.reason || state.lastResult.type}`
      : 'No edits yet';

    if (replaceEditorValues) {
      dom.intentNl.value = String(intent.nl || '');
      dom.intentPurpose.value = String(intent.purpose || '');
      dom.intentAcceptance.value = String(intent.acceptance || '');
      dom.executionMap.value = executionMapJson(record);
    }

    syncTitle();
    syncDebugState();
  }

  function handleIntentInput() {
    updateWorkRecordIntent(state, {
      nl: dom.intentNl.value,
      purpose: dom.intentPurpose.value,
      acceptance: dom.intentAcceptance.value,
    });
    sync();
  }

  function applyExecutionMapEditor() {
    const result = updateWorkRecordExecutionMapJson(state, dom.executionMap.value);
    if (result.status === 'applied') {
      dom.executionMap.value = executionMapJson(state.record);
    }
    sync();
    return result;
  }

  function requestSave() {
    const result = applyExecutionMapEditor();
    if (result.status !== 'applied') return null;
    const request = buildWorkRecordPatchRequest(state);
    state.lastResult = {
      type: 'work_record.patch.requested',
      schema_version: request.schema_version,
      status: 'pending',
      record_id: state.record.id,
      message: 'waiting for owner',
    };
    emit('patch.requested', request);
    sync();
    return request;
  }

  function revert() {
    openWorkRecord(state, { type: 'work_record.open', record: state.savedRecord });
    sync({ replaceEditorValues: true });
  }

  function render() {
    const root = el('div', 'work-record-root');
    root.innerHTML = `
      <header class="work-record-toolbar">
        <div class="work-record-file">
          <strong data-role="record-id"></strong>
          <span data-role="record-type"></span>
          <em data-role="dirty"></em>
        </div>
        <div class="work-record-actions">
          <button type="button" data-action="apply-json">Apply JSON</button>
          <button type="button" data-action="revert">Revert</button>
          <button type="button" data-action="save">Save</button>
        </div>
      </header>
      <main class="work-record-main">
        <section class="work-record-intent" aria-label="Work record intent">
          <label>
            <span>Intent</span>
            <textarea data-role="intent-nl" spellcheck="true" aria-label="Natural language intent"></textarea>
          </label>
          <div class="work-record-intent-grid">
            <label>
              <span>Purpose</span>
              <textarea data-role="intent-purpose" spellcheck="true" aria-label="Intent purpose"></textarea>
            </label>
            <label>
              <span>Acceptance</span>
              <textarea data-role="intent-acceptance" spellcheck="true" aria-label="Acceptance condition"></textarea>
            </label>
          </div>
        </section>
        <section class="work-record-json" aria-label="Execution map JSON">
          <div class="work-record-section-title">Execution Map JSON</div>
          <textarea data-role="execution-map" spellcheck="false" aria-label="Execution map JSON editor"></textarea>
        </section>
        <aside class="work-record-inspector" aria-label="Work record health and evidence">
          <section>
            <strong>Summary</strong>
            <div data-role="summary"></div>
          </section>
          <section>
            <strong>Health</strong>
            <div data-role="health"></div>
          </section>
          <section>
            <strong>Evidence</strong>
            <div data-role="evidence"></div>
          </section>
          <section>
            <strong>Status</strong>
            <p data-role="status"></p>
          </section>
        </aside>
      </main>
    `;

    dom.recordId = root.querySelector('[data-role="record-id"]');
    dom.recordType = root.querySelector('[data-role="record-type"]');
    dom.dirty = root.querySelector('[data-role="dirty"]');
    dom.summary = root.querySelector('[data-role="summary"]');
    dom.health = root.querySelector('[data-role="health"]');
    dom.evidence = root.querySelector('[data-role="evidence"]');
    dom.status = root.querySelector('[data-role="status"]');
    dom.intentNl = root.querySelector('[data-role="intent-nl"]');
    dom.intentPurpose = root.querySelector('[data-role="intent-purpose"]');
    dom.intentAcceptance = root.querySelector('[data-role="intent-acceptance"]');
    dom.executionMap = root.querySelector('[data-role="execution-map"]');

    for (const input of [dom.intentNl, dom.intentPurpose, dom.intentAcceptance]) {
      input.addEventListener('input', handleIntentInput);
    }
    dom.executionMap.addEventListener('blur', applyExecutionMapEditor);
    root.querySelector('[data-action="apply-json"]').addEventListener('click', applyExecutionMapEditor);
    root.querySelector('[data-action="revert"]').addEventListener('click', revert);
    root.querySelector('[data-action="save"]').addEventListener('click', requestSave);

    sync({ replaceEditorValues: true });
    return root;
  }

  function onMessage(message = {}) {
    const type = message.type || message.payload?.type;
    if (type === 'work_record.open') {
      openWorkRecord(state, message);
      sync({ replaceEditorValues: true });
    } else if (type === 'work_record.patch.result') {
      applyWorkRecordPatchResult(state, message);
      sync();
    }
  }

  return {
    manifest: {
      name: 'work-record-workbench',
      title: 'Work Record Workbench',
      accepts: ['work_record.open', 'work_record.patch.result'],
      emits: ['work-record-workbench/patch.requested'],
      channelPrefix: 'work-record-workbench',
      defaultSize: { w: 1180, h: 720 },
    },

    render(host_) {
      host = host_;
      host.contentEl.style.overflow = 'hidden';
      return render();
    },

    onMessage,

    serialize() {
      return workRecordWorkbenchSnapshot(state);
    },
  };
}
