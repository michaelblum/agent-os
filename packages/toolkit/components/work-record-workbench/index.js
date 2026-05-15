import { esc } from '../../runtime/bridge.js';
import { createButton } from '../../controls/button.js';
import { createButtonGroup } from '../../controls/button-group.js';
import { createTextarea } from '../../controls/textarea.js';
import { createFixedSidebarPane, createSplitPane } from '../../panel/layouts/split-pane.js';
import {
  renderWorkbenchSectionTitle,
  renderWorkbenchSummaryRows,
  renderWorkbenchToolbar,
} from '../../shell/index.js';
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
  workRecordIsReadOnly,
  workRecordVerifierCheck,
  workRecordWorkbenchSnapshot,
} from './model.js';

function el(tag, className, textContent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (textContent !== undefined) node.textContent = textContent;
  return node;
}

function textareaEl(config = {}) {
  return createTextarea({ document, ...config }).el;
}

function buttonEl(config = {}) {
  return createButton({ document, ...config }).el;
}

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
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
  const state = text(health.state || health.verdict, 'unknown');
  const reason = text(health.reason);
  return (
    `<div class="work-record-health-state" data-health="${esc(state)}">`
      + `<strong>${esc(state)}</strong>`
      + `<span>${esc(reason || 'No health reason recorded')}</span>`
    + '</div>'
  );
}

function renderPostconditions(record = {}) {
  const postconditions = arrayValue(objectValue(record.execution_map).postconditions);
  if (postconditions.length === 0) {
    return '<p class="work-record-muted">No execution-map postconditions recorded.</p>';
  }
  return (
    '<ol class="work-record-compact-list">'
      + postconditions.map((postcondition) => (
        '<li>'
          + `<strong>${esc(text(postcondition.id, 'postcondition'))}</strong>`
          + `<span>${esc(text(postcondition.description || postcondition.kind))}</span>`
        + '</li>'
      )).join('')
    + '</ol>'
  );
}

function renderClaims(record = {}) {
  const claims = arrayValue(record.claims);
  if (claims.length === 0) {
    return '<p class="work-record-muted">No claims recorded.</p>';
  }
  return (
    '<ol class="work-record-compact-list">'
      + claims.map((claim) => (
        '<li>'
          + `<strong>${esc(text(claim.id, 'claim'))}</strong>`
          + `<span>${esc(text(claim.text || claim.acceptance))}</span>`
        + '</li>'
      )).join('')
    + '</ol>'
  );
}

function renderClaimResults(record = {}) {
  const results = arrayValue(record.claim_results);
  if (results.length === 0) {
    return '<p class="work-record-muted">No claim results recorded.</p>';
  }
  return (
    '<ol class="work-record-compact-list">'
      + results.map((result) => (
        '<li>'
          + `<strong>${esc(text(result.claim_id, result.id || 'claim result'))}</strong>`
          + `<span>${esc(text(result.status, 'unknown'))}: ${esc(text(result.reason))}</span>`
        + '</li>'
      )).join('')
    + '</ol>'
  );
}

function renderVerifierReport(record = {}) {
  const report = objectValue(record.verifier_report);
  const check = workRecordVerifierCheck(record);
  if (!text(report.id)) {
    return '<p class="work-record-muted">No verifier report recorded.</p>';
  }
  const indexes = objectValue(report.derived_indexes);
  const diagnosticCount = arrayValue(check.diagnostics).length;
  return (
    '<div class="work-record-verifier-report">'
      + renderWorkbenchSummaryRows({
        rowClassName: 'work-record-summary-row',
        rows: [
          ['Report', text(report.id)],
          ['Checker', text(check.status, 'unknown')],
          ['Diagnostics', String(diagnosticCount)],
          ['Verified', arrayValue(indexes.verified).join(', ') || 'none'],
          ['Failed', arrayValue(indexes.failed).join(', ') || 'none'],
          ['Unverified', arrayValue(indexes.unverified).join(', ') || 'none'],
        ],
      })
    + '</div>'
  );
}

function renderSummary(record = {}) {
  const diagnostics = workRecordDiagnostics(record);
  const rows = [
    ['Record', diagnostics.record_id],
    ['Type', diagnostics.record_type],
    ['Mode', diagnostics.read_only ? 'read-only' : 'editable'],
    ['Surface', diagnostics.surface || 'none'],
    ['Action', diagnostics.action_verb || 'none'],
    ['Artifacts', String(diagnostics.artifact_count)],
    ['Claims', String(diagnostics.claim_count)],
    ['Claim results', String(diagnostics.claim_result_count)],
    ['Postconditions', String(diagnostics.postcondition_count)],
    ['Execution keys', diagnostics.execution_map_keys.join(', ') || 'none'],
  ];
  return renderWorkbenchSummaryRows({ rowClassName: 'work-record-summary-row', rows });
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
    const readOnly = workRecordIsReadOnly(record);
    dom.recordId.textContent = record.id;
    dom.recordType.textContent = record.type;
    dom.dirty.textContent = readOnly ? 'Read-only' : (state.dirty ? 'Unsaved changes' : 'Saved');
    dom.dirty.dataset.dirty = state.dirty ? 'true' : 'false';
    dom.dirty.dataset.readOnly = readOnly ? 'true' : 'false';
    dom.summary.innerHTML = renderSummary(record);
    dom.health.innerHTML = renderHealth(record);
    dom.postconditions.innerHTML = renderPostconditions(record);
    dom.evidence.innerHTML = renderEvidenceList(record);
    dom.claims.innerHTML = renderClaims(record);
    dom.claimResults.innerHTML = renderClaimResults(record);
    dom.verifierReport.innerHTML = renderVerifierReport(record);
    dom.status.textContent = state.lastResult
      ? `${state.lastResult.status}: ${state.lastResult.message || state.lastResult.reason || state.lastResult.type}`
      : (readOnly ? 'Opened read-only' : 'No edits yet');

    for (const input of [dom.intentNl, dom.intentPurpose, dom.intentAcceptance, dom.executionMap]) {
      input.readOnly = readOnly;
    }
    dom.applyJson.disabled = readOnly;
    dom.revert.disabled = readOnly;
    dom.save.disabled = readOnly;

    if (replaceEditorValues) {
      dom.intentNl.value = String(intent.nl || intent.summary || '');
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
    if (workRecordIsReadOnly(state.record)) {
      state.lastResult = {
        type: 'work_record.patch.requested',
        schema_version: state.record.schema_version,
        status: 'rejected',
        record_id: state.record.id,
        reason: 'read_only',
        message: 'Work Record v0 opens read-only in this workbench.',
      };
      sync();
      return null;
    }
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
    openWorkRecord(state, { type: 'work_record.open', record: state.savedRecord, source: state.source });
    sync({ replaceEditorValues: true });
  }

  function render() {
    const root = el('div', 'work-record-root');
    root.innerHTML = `
      ${renderWorkbenchToolbar({
        tag: 'header',
        className: 'work-record-toolbar',
        content: `
        <div class="work-record-file">
          <strong data-role="record-id"></strong>
          <span data-role="record-type"></span>
          <em data-role="dirty"></em>
        </div>
        <div class="work-record-actions"></div>
        `,
      })}
      <main class="work-record-main">
        <div class="work-record-editor-stack">
          <section class="work-record-intent" aria-label="Work record intent">
            <label>
              <span>Intent</span>
            </label>
            <div class="work-record-intent-grid">
              <label>
                <span>Purpose</span>
              </label>
              <label>
                <span>Acceptance</span>
              </label>
            </div>
          </section>
          <section class="work-record-json" aria-label="Execution map JSON">
            ${renderWorkbenchSectionTitle({ title: 'Execution Map JSON', baseClassName: 'work-record-section-title' })}
          </section>
        </div>
        <aside class="work-record-inspector" aria-label="Work record health and evidence">
          <section>
            ${renderWorkbenchSectionTitle({ tag: 'strong', title: 'Summary', baseClassName: '' })}
            <div data-role="summary"></div>
          </section>
          <section>
            ${renderWorkbenchSectionTitle({ tag: 'strong', title: 'Health', baseClassName: '' })}
            <div data-role="health"></div>
          </section>
          <section>
            ${renderWorkbenchSectionTitle({ tag: 'strong', title: 'Postconditions', baseClassName: '' })}
            <div data-role="postconditions"></div>
          </section>
          <section>
            ${renderWorkbenchSectionTitle({ tag: 'strong', title: 'Evidence', baseClassName: '' })}
            <div data-role="evidence"></div>
          </section>
          <section>
            ${renderWorkbenchSectionTitle({ tag: 'strong', title: 'Claims', baseClassName: '' })}
            <div data-role="claims"></div>
          </section>
          <section>
            ${renderWorkbenchSectionTitle({ tag: 'strong', title: 'Claim Results', baseClassName: '' })}
            <div data-role="claim-results"></div>
          </section>
          <section>
            ${renderWorkbenchSectionTitle({ tag: 'strong', title: 'Verifier Report', baseClassName: '' })}
            <div data-role="verifier-report"></div>
          </section>
          <section>
            ${renderWorkbenchSectionTitle({ tag: 'strong', title: 'Status', baseClassName: '' })}
            <p data-role="status"></p>
          </section>
        </aside>
      </main>
    `;

    const intentLabels = root.querySelectorAll('.work-record-intent label');
    intentLabels[0]?.appendChild(textareaEl({
      spellcheck: true,
      ariaLabel: 'Natural language intent',
      dataset: { role: 'intent-nl' },
    }));
    intentLabels[1]?.appendChild(textareaEl({
      spellcheck: true,
      ariaLabel: 'Intent purpose',
      dataset: { role: 'intent-purpose' },
    }));
    intentLabels[2]?.appendChild(textareaEl({
      spellcheck: true,
      ariaLabel: 'Acceptance condition',
      dataset: { role: 'intent-acceptance' },
    }));
    root.querySelector('.work-record-json')?.appendChild(textareaEl({
      spellcheck: false,
      ariaLabel: 'Execution map JSON editor',
      dataset: { role: 'execution-map' },
    }));
    const actions = createButtonGroup({ document, options: [] }).el;
    actions.classList.add('work-record-action-group');
    actions.append(
      buttonEl({ label: 'Apply JSON', dataset: { action: 'apply-json' } }),
      buttonEl({ label: 'Revert', dataset: { action: 'revert' } }),
      buttonEl({ label: 'Save', dataset: { action: 'save' } })
    );
    root.querySelector('.work-record-actions')?.appendChild(actions);

    dom.recordId = root.querySelector('[data-role="record-id"]');
    dom.recordType = root.querySelector('[data-role="record-type"]');
    dom.dirty = root.querySelector('[data-role="dirty"]');
    dom.summary = root.querySelector('[data-role="summary"]');
    dom.health = root.querySelector('[data-role="health"]');
    dom.postconditions = root.querySelector('[data-role="postconditions"]');
    dom.evidence = root.querySelector('[data-role="evidence"]');
    dom.claims = root.querySelector('[data-role="claims"]');
    dom.claimResults = root.querySelector('[data-role="claim-results"]');
    dom.verifierReport = root.querySelector('[data-role="verifier-report"]');
    dom.status = root.querySelector('[data-role="status"]');
    dom.intentNl = root.querySelector('[data-role="intent-nl"]');
    dom.intentPurpose = root.querySelector('[data-role="intent-purpose"]');
    dom.intentAcceptance = root.querySelector('[data-role="intent-acceptance"]');
    dom.executionMap = root.querySelector('[data-role="execution-map"]');
    dom.applyJson = root.querySelector('[data-action="apply-json"]');
    dom.revert = root.querySelector('[data-action="revert"]');
    dom.save = root.querySelector('[data-action="save"]');

    const narrowLayout = typeof window !== 'undefined'
      && window.matchMedia?.('(max-width: 980px)')?.matches;
    createFixedSidebarPane({
      root: root.querySelector('.work-record-main'),
      mainPane: root.querySelector('.work-record-editor-stack'),
      sidebarPane: root.querySelector('.work-record-inspector'),
      orientation: narrowLayout ? 'vertical' : 'horizontal',
      side: 'end',
      openSize: narrowLayout ? 220 : 280,
      closedSize: 0,
      minMain: narrowLayout ? 640 : 680,
      maxSidebar: narrowLayout ? 280 : 360,
      dividerSize: 0,
      initiallyOpen: true,
      ariaLabel: 'Resize work record editor and inspector panes',
    });
    createSplitPane({
      root: root.querySelector('.work-record-editor-stack'),
      startPane: root.querySelector('.work-record-intent'),
      endPane: root.querySelector('.work-record-json'),
      orientation: narrowLayout ? 'vertical' : 'horizontal',
      initialRatio: 0.46,
      minStart: 320,
      minEnd: 360,
      dividerSize: 0,
      ariaLabel: 'Resize work record intent and JSON panes',
    });

    for (const input of [dom.intentNl, dom.intentPurpose, dom.intentAcceptance]) {
      input.addEventListener('input', handleIntentInput);
    }
    dom.executionMap.addEventListener('blur', applyExecutionMapEditor);
    dom.applyJson.addEventListener('click', applyExecutionMapEditor);
    dom.revert.addEventListener('click', revert);
    dom.save.addEventListener('click', requestSave);

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
