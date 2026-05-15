import { esc } from '../../runtime/bridge.js';
import {
  PLAYBOOK_WORKBENCH_MESSAGE_TYPES,
  PLAYBOOK_WORKBENCH_SCHEMA_VERSION,
  PLAYBOOK_WORKBENCH_SURFACE,
  PLAYBOOK_WORKBENCH_WORK_RECORD_CANVAS_ID,
  createPlaybookWorkbenchState,
  loadPlaybookWorkbenchFixture,
  openPlaybookWorkbenchWorkRecord,
  playbookWorkbenchSnapshot,
  setPlaybookWorkbenchWorkflowGate,
  simulatePlaybookWorkbench,
} from './model.js';
import {
  applyPlaybookWorkbenchSemanticTarget,
  playbookWorkbenchAosRef,
  playbookWorkbenchSemanticRefs,
} from './semantics.js';
import { createSplitPane } from '../../panel/layouts/split-pane.js';
import {
  renderWorkbenchSectionTitle,
  renderWorkbenchSummaryRows,
  renderWorkbenchToolbar,
} from '../../shell/index.js';

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

function messagePayload(message = {}) {
  if (message?.payload && typeof message.payload === 'object') {
    return { ...message.payload, type: message.payload.type || message.type };
  }
  return message || {};
}

function messageType(message = {}) {
  return text(message.type || message.payload?.type);
}

function matchesType(type, fullType) {
  return type === fullType || type === fullType.replace(/^playbook_workbench\./, '');
}

function stableJson(value) {
  return JSON.stringify(value ?? {}, null, 2);
}

function summaryRows(rows = []) {
  return renderWorkbenchSummaryRows({ rowClassName: 'playbook-workbench-row', rows });
}

function compactList(items = [], empty = 'None') {
  const values = items.map((item) => text(item)).filter(Boolean);
  if (values.length === 0) return `<p class="playbook-workbench-muted">${esc(empty)}</p>`;
  return (
    '<ol class="playbook-workbench-list">'
      + values.map((item) => `<li>${esc(item)}</li>`).join('')
    + '</ol>'
  );
}

function renderDiagnostics(diagnostics = []) {
  if (diagnostics.length === 0) {
    return '<p class="playbook-workbench-muted">No diagnostics</p>';
  }
  return (
    '<ol class="playbook-workbench-list">'
      + diagnostics.map((diagnostic) => {
        const value = objectValue(diagnostic);
        return (
          '<li>'
            + `<strong>${esc(text(value.code, text(value.failure_class, 'diagnostic')))}</strong>`
            + `<span>${esc(text(value.message || value.reason))}</span>`
          + '</li>'
        );
      }).join('')
    + '</ol>'
  );
}

function applyRef(element, { id, name, role = 'AXGroup', action = '', enabled = true, value = null } = {}) {
  const existingText = element?.tagName?.toLowerCase?.() === 'button' ? element.textContent : '';
  const normalized = applyPlaybookWorkbenchSemanticTarget(element, {
    id,
    name,
    role,
    action,
    enabled,
    value,
    aosRef: playbookWorkbenchAosRef(id),
  });
  if (existingText) element.textContent = existingText;
  return normalized;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function postWorkRecordOpenToChild(host, childId, openMessage) {
  if (!host?.evalCanvas) return false;
  const encoded = btoa(JSON.stringify(openMessage));
  const expectedRecordId = text(openMessage?.record?.id);
  const script = `
(function () {
  if (!window.headsup || typeof window.headsup.receive !== "function") return "";
  if (!window.__workRecordWorkbenchState || !document.querySelector("[data-role='record-id']")) return "";
  window.headsup.receive(${JSON.stringify(encoded)});
  return window.__workRecordWorkbenchState?.record?.id === ${JSON.stringify(expectedRecordId)}
    ? ${JSON.stringify(expectedRecordId)}
    : "";
})()
`;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const result = await host.evalCanvas(childId, script, { timeoutMs: 3000 });
      if (result === expectedRecordId) return true;
    } catch {}
    await sleep(150);
  }
  return false;
}

export default function PlaybookWorkbench(options = {}) {
  let host = null;
  let rootEl = null;
  const refs = playbookWorkbenchSemanticRefs();
  const state = createPlaybookWorkbenchState(options);
  const dom = {};

  function emit(type, payload) {
    host?.emit?.(type, payload);
  }

  function syncTitle() {
    const step = state.step_summary || {};
    host?.setTitle?.(`Playbook Workbench V0 - ${text(step.id, 'waiting for fixture')}`);
  }

  function syncDebugState() {
    window.__playbookWorkbenchState = playbookWorkbenchSnapshot(state);
  }

  function sync() {
    const snapshot = playbookWorkbenchSnapshot(state);
    const step = snapshot.step_summary || {};
    const gate = snapshot.gate_status || {};
    const verifier = snapshot.verifier_summary || {};
    const record = snapshot.work_record_summary || {};
    const recordReady = !!text(record.id);
    const fixtureReady = snapshot.fixture_loaded === true;

    rootEl.dataset.status = snapshot.status;
    rootEl.dataset.fixtureLoaded = String(fixtureReady);
    rootEl.dataset.recordReady = String(recordReady);

    dom.stepDescriptor.innerHTML = fixtureReady
      ? summaryRows([
        ['Step', step.id],
        ['Label', step.label],
        ['Playbook', step.playbook_ref],
        ['Action', `${step.action?.verb || 'none'} ${step.action?.target || ''}`.trim()],
        ['Preconditions', String(step.precondition_count || 0)],
        ['Postconditions', String(step.postcondition_count || 0)],
        ['Claim promotions', String(step.claim_promotion_count || 0)],
      ])
      : '<p class="playbook-workbench-muted">Waiting for fixture</p>';
    dom.stepJson.textContent = fixtureReady ? stableJson(state.prototype.playbook_step) : '{}';
    dom.targetSummary.innerHTML = summaryRows([
      ['Dialect', step.target_dialect || 'none'],
      ['Target', step.target || 'none'],
      ['Target/ref', step.target_with_ref || 'none'],
      ['Ref', step.ref || 'none'],
      ['Semantic ref', step.semantic_ref || 'none'],
    ]);
    dom.gateRefs.innerHTML = compactList(gate.allowed_gate_refs || [], 'No declared gates');
    dom.gateStatus.innerHTML = summaryRows([
      ['Status', gate.status || 'unknown'],
      ['Reason', gate.reason || 'none'],
      ['Ref', gate.ref || 'none'],
      ['Token', gate.token_present ? 'present' : 'missing'],
    ]);
    dom.gateRef.value = text(state.workflow_gate.ref);
    dom.gateToken.value = text(state.workflow_gate.token);
    dom.simulate.disabled = !fixtureReady;
    dom.openWorkRecord.disabled = !recordReady;
    dom.verifierStatus.innerHTML = summaryRows([
      ['Status', verifier.status || 'not run'],
      ['Profile', verifier.profile_id || 'none'],
      ['Mutates record', verifier.mutates_record ? 'true' : 'false'],
      ['Diagnostics', String(verifier.diagnostics || 0)],
      ['Claims', String(verifier.claims || 0)],
      ['Evidence', String(verifier.evidence || 0)],
      ['Postconditions', String(verifier.postconditions || 0)],
      ['Replay gated', verifier.replay_gated ? 'true' : 'false'],
      ['Repair gated', verifier.repair_gated ? 'true' : 'false'],
    ]);
    dom.diagnostics.innerHTML = renderDiagnostics(snapshot.diagnostics);
    dom.workRecordSummary.innerHTML = recordReady
      ? summaryRows([
        ['Record', record.id],
        ['Origin', `${record.origin_kind || 'none'} ${record.origin_ref || ''}`.trim()],
        ['Run', record.run_id || 'none'],
        ['Health', record.health_verdict || 'unknown'],
        ['Steps', String(record.steps || 0)],
        ['Claims', String(record.claims || 0)],
        ['Evidence', String(record.evidence || 0)],
        ['Verifier report', record.verifier_report_id || 'none'],
        ['Replay policy', record.replay_policy?.mode || 'none'],
      ])
      : '<p class="playbook-workbench-muted">No Work Record emitted</p>';
    dom.workRecordJson.textContent = recordReady ? stableJson(state.record) : '{}';
    dom.handoff.innerHTML = summaryRows([
      ['Workbench', snapshot.work_record_open?.work_record_surface || 'work-record-workbench'],
      ['Canvas', snapshot.work_record_canvas_id || PLAYBOOK_WORKBENCH_WORK_RECORD_CANVAS_ID],
      ['Read-only open', snapshot.work_record_open?.read_only === true ? 'confirmed' : 'pending'],
      ['Open status', snapshot.work_record_open?.status || 'not requested'],
    ]);

    syncTitle();
    syncDebugState();
  }

  function applyGateFromInputs() {
    const result = setPlaybookWorkbenchWorkflowGate(state, {
      ref: dom.gateRef.value,
      token: dom.gateToken.value,
    });
    emit(PLAYBOOK_WORKBENCH_MESSAGE_TYPES.workflowGateSet, result);
    sync();
    return result;
  }

  function simulateFromCurrentGate() {
    applyGateFromInputs();
    const result = simulatePlaybookWorkbench(state);
    emit(PLAYBOOK_WORKBENCH_MESSAGE_TYPES.simulateResult, result);
    sync();
    return result;
  }

  async function openCurrentWorkRecord({ spawnChild = true } = {}) {
    const result = openPlaybookWorkbenchWorkRecord(state);
    sync();
    emit(PLAYBOOK_WORKBENCH_MESSAGE_TYPES.workRecordOpenResult, result);

    if (!spawnChild || !host?.spawnChild || !state.work_record_open?.open_message) {
      return result;
    }

    const childId = text(state.work_record_canvas_id, PLAYBOOK_WORKBENCH_WORK_RECORD_CANVAS_ID);
    try {
      await host.spawnChild({
        id: childId,
        url: state.work_record_workbench_url,
        frame: [80, 92, 1180, 720],
        interactive: true,
      });
    } catch (error) {
      const message = String(error?.message || error);
      if (!/ID_COLLISION|DUPLICATE/i.test(message)) {
        state.work_record_open.child_error = message;
      }
    }
    const posted = await postWorkRecordOpenToChild(host, childId, state.work_record_open.open_message);
    state.work_record_open.child_posted = posted;
    state.last_result = {
      ...result,
      child_posted: posted,
    };
    sync();
    emit(PLAYBOOK_WORKBENCH_MESSAGE_TYPES.workRecordOpenResult, state.last_result);
    return state.last_result;
  }

  function render() {
    rootEl = document.createElement('div');
    rootEl.className = 'playbook-workbench-root';
    applyRef(rootEl, {
      id: 'root',
      name: 'Playbook Workbench V0',
      value: 'fixture-backed report-only one-step shell',
    });
    rootEl.innerHTML = `
      ${renderWorkbenchToolbar({
        tag: 'header',
        className: 'playbook-workbench-toolbar',
        content: `
        <div class="playbook-workbench-title">
          <strong>Playbook Workbench V0</strong>
          <span data-role="surface">${esc(PLAYBOOK_WORKBENCH_SURFACE)}</span>
        </div>
        <label class="playbook-workbench-gate-field">
          <span>Gate ref</span>
          <input data-role="gate-ref" autocomplete="off" spellcheck="false">
        </label>
        <label class="playbook-workbench-gate-field">
          <span>Gate token</span>
          <input data-role="gate-token" autocomplete="off" spellcheck="false">
        </label>
        <button type="button" data-action="gate-apply">Apply Gate</button>
        <button type="button" data-action="simulate">Simulate</button>
        <button type="button" data-action="open-work-record">Open Work Record</button>
        `,
      })}
      <main class="playbook-workbench-main">
        <section class="playbook-workbench-pane playbook-workbench-step-pane" aria-label="Playbook step descriptor">
          ${renderWorkbenchSectionTitle({ title: 'Step Descriptor', baseClassName: 'playbook-workbench-pane-title' })}
          <div data-role="step-descriptor" class="playbook-workbench-summary"></div>
          ${renderWorkbenchSectionTitle({ title: 'Target / Ref', baseClassName: 'playbook-workbench-pane-title' })}
          <div data-role="target-summary" class="playbook-workbench-summary"></div>
          ${renderWorkbenchSectionTitle({ title: 'Descriptor JSON', baseClassName: 'playbook-workbench-pane-title' })}
          <pre data-role="step-json" class="playbook-workbench-code"></pre>
        </section>
        <div class="playbook-workbench-run-stack">
          <section class="playbook-workbench-pane playbook-workbench-run-pane" aria-label="Gate and verifier status">
            ${renderWorkbenchSectionTitle({ title: 'Declared Gates', baseClassName: 'playbook-workbench-pane-title' })}
            <div data-role="gate-refs"></div>
            ${renderWorkbenchSectionTitle({ title: 'Gate Status', baseClassName: 'playbook-workbench-pane-title' })}
            <div data-role="gate-status" class="playbook-workbench-summary"></div>
            ${renderWorkbenchSectionTitle({ title: 'Verifier Status', baseClassName: 'playbook-workbench-pane-title' })}
            <div data-role="verifier-status" class="playbook-workbench-summary"></div>
            ${renderWorkbenchSectionTitle({ title: 'Diagnostics', baseClassName: 'playbook-workbench-pane-title' })}
            <div data-role="diagnostics"></div>
          </section>
          <section class="playbook-workbench-pane playbook-workbench-record-pane" aria-label="Emitted Work Record summary">
            ${renderWorkbenchSectionTitle({ title: 'Work Record Summary', baseClassName: 'playbook-workbench-pane-title' })}
            <div data-role="work-record-summary" class="playbook-workbench-summary"></div>
            ${renderWorkbenchSectionTitle({ title: 'Read-only Handoff', baseClassName: 'playbook-workbench-pane-title' })}
            <div data-role="handoff" class="playbook-workbench-summary"></div>
            ${renderWorkbenchSectionTitle({ title: 'Emitted Record JSON', baseClassName: 'playbook-workbench-pane-title' })}
            <pre data-role="work-record-json" class="playbook-workbench-code"></pre>
          </section>
        </div>
      </main>
    `;

    dom.stepDescriptor = rootEl.querySelector('[data-role="step-descriptor"]');
    dom.stepJson = rootEl.querySelector('[data-role="step-json"]');
    dom.targetSummary = rootEl.querySelector('[data-role="target-summary"]');
    dom.gateRefs = rootEl.querySelector('[data-role="gate-refs"]');
    dom.gateStatus = rootEl.querySelector('[data-role="gate-status"]');
    dom.gateRef = rootEl.querySelector('[data-role="gate-ref"]');
    dom.gateToken = rootEl.querySelector('[data-role="gate-token"]');
    dom.gateApply = rootEl.querySelector('[data-action="gate-apply"]');
    dom.simulate = rootEl.querySelector('[data-action="simulate"]');
    dom.verifierStatus = rootEl.querySelector('[data-role="verifier-status"]');
    dom.diagnostics = rootEl.querySelector('[data-role="diagnostics"]');
    dom.workRecordSummary = rootEl.querySelector('[data-role="work-record-summary"]');
    dom.handoff = rootEl.querySelector('[data-role="handoff"]');
    dom.workRecordJson = rootEl.querySelector('[data-role="work-record-json"]');
    dom.openWorkRecord = rootEl.querySelector('[data-action="open-work-record"]');

    const narrowLayout = typeof window !== 'undefined'
      && window.matchMedia?.('(max-width: 1040px)')?.matches;
    createSplitPane({
      root: rootEl.querySelector('.playbook-workbench-main'),
      startPane: rootEl.querySelector('.playbook-workbench-step-pane'),
      endPane: rootEl.querySelector('.playbook-workbench-run-stack'),
      orientation: narrowLayout ? 'vertical' : 'horizontal',
      initialRatio: 0.34,
      minStart: narrowLayout ? 360 : 330,
      minEnd: narrowLayout ? 680 : 660,
      dividerSize: 0,
      ariaLabel: 'Resize playbook descriptor and report panes',
    });
    createSplitPane({
      root: rootEl.querySelector('.playbook-workbench-run-stack'),
      startPane: rootEl.querySelector('.playbook-workbench-run-pane'),
      endPane: rootEl.querySelector('.playbook-workbench-record-pane'),
      orientation: narrowLayout ? 'vertical' : 'horizontal',
      initialRatio: 0.43,
      minStart: narrowLayout ? 320 : 300,
      minEnd: narrowLayout ? 360 : 360,
      dividerSize: 0,
      ariaLabel: 'Resize verifier and work record panes',
    });

    applyRef(dom.stepDescriptor, { id: 'step-descriptor', name: 'Playbook step descriptor' });
    applyRef(dom.targetSummary, { id: 'target-summary', name: 'Playbook target and ref summary' });
    applyRef(dom.gateRef, { id: 'gate-ref', name: 'Workflow gate ref', role: 'AXTextField', action: 'set_gate_ref' });
    applyRef(dom.gateToken, { id: 'gate-token', name: 'Workflow gate token', role: 'AXTextField', action: 'set_gate_token' });
    applyRef(dom.gateApply, { id: 'gate-apply', name: 'Apply workflow gate', role: 'AXButton', action: 'apply_gate' });
    applyRef(dom.gateStatus, { id: 'gate-status', name: 'Workflow gate status' });
    applyRef(dom.simulate, { id: 'simulate', name: 'Simulate saved step', role: 'AXButton', action: 'simulate_once' });
    applyRef(dom.verifierStatus, { id: 'verifier-status', name: 'Report-only verifier status' });
    applyRef(dom.diagnostics, { id: 'diagnostics', name: 'Playbook workbench diagnostics' });
    applyRef(dom.workRecordSummary, { id: 'work-record-summary', name: 'Emitted Work Record summary' });
    applyRef(dom.openWorkRecord, { id: 'open-work-record', name: 'Open emitted Work Record read-only', role: 'AXButton', action: 'open_work_record' });

    dom.gateApply.addEventListener('click', applyGateFromInputs);
    dom.simulate.addEventListener('click', simulateFromCurrentGate);
    dom.openWorkRecord.addEventListener('click', () => {
      openCurrentWorkRecord().catch((error) => {
        state.last_result = {
          type: PLAYBOOK_WORKBENCH_MESSAGE_TYPES.workRecordOpenResult,
          schema_version: PLAYBOOK_WORKBENCH_SCHEMA_VERSION,
          status: 'rejected',
          reason: String(error?.message || error),
        };
        sync();
      });
    });

    sync();
    return rootEl;
  }

  return {
    manifest: {
      name: PLAYBOOK_WORKBENCH_SURFACE,
      title: 'Playbook Workbench V0',
      accepts: [
        PLAYBOOK_WORKBENCH_MESSAGE_TYPES.load,
        PLAYBOOK_WORKBENCH_MESSAGE_TYPES.workflowGateSet,
        PLAYBOOK_WORKBENCH_MESSAGE_TYPES.simulateRequested,
        PLAYBOOK_WORKBENCH_MESSAGE_TYPES.workRecordOpenRequested,
        'load',
        'workflow_gate.set',
        'simulate.requested',
        'work_record.open.requested',
      ],
      emits: [
        PLAYBOOK_WORKBENCH_MESSAGE_TYPES.workflowGateSet,
        PLAYBOOK_WORKBENCH_MESSAGE_TYPES.simulateResult,
        PLAYBOOK_WORKBENCH_MESSAGE_TYPES.workRecordOpenResult,
      ],
      channelPrefix: PLAYBOOK_WORKBENCH_SURFACE,
      defaultSize: { w: 1240, h: 760 },
    },

    render(host_) {
      host = host_;
      host.contentEl.style.overflow = 'hidden';
      return render();
    },

    onMessage(message = {}) {
      const type = messageType(message);
      const payload = messagePayload(message);
      if (matchesType(type, PLAYBOOK_WORKBENCH_MESSAGE_TYPES.load)) {
        loadPlaybookWorkbenchFixture(state, payload);
        sync();
      } else if (matchesType(type, PLAYBOOK_WORKBENCH_MESSAGE_TYPES.workflowGateSet)) {
        setPlaybookWorkbenchWorkflowGate(state, payload);
        sync();
      } else if (matchesType(type, PLAYBOOK_WORKBENCH_MESSAGE_TYPES.simulateRequested)) {
        simulatePlaybookWorkbench(state, payload);
        emit(PLAYBOOK_WORKBENCH_MESSAGE_TYPES.simulateResult, state.last_result);
        sync();
      } else if (matchesType(type, PLAYBOOK_WORKBENCH_MESSAGE_TYPES.workRecordOpenRequested)) {
        openCurrentWorkRecord({ spawnChild: payload.spawn_child !== false }).catch((error) => {
          state.last_result = {
            type: PLAYBOOK_WORKBENCH_MESSAGE_TYPES.workRecordOpenResult,
            schema_version: PLAYBOOK_WORKBENCH_SCHEMA_VERSION,
            status: 'rejected',
            reason: String(error?.message || error),
          };
          sync();
        });
      }
    },

    serialize() {
      return playbookWorkbenchSnapshot(state);
    },

    refs,
  };
}
