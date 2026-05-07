import {
  TEST_CONSOLE_SURFACE,
  TEST_CONSOLE_URL,
  testConsoleSemanticRefs,
} from './semantics.js';

export { TEST_CONSOLE_SURFACE, TEST_CONSOLE_URL };

export const TEST_CONSOLE_SCHEMA_VERSION = '2026-05-06-test-console-v0';
export const TEST_CONSOLE_MESSAGE_TYPES = Object.freeze({
  load: 'test_console.load',
  humanResponseCaptured: 'test_console.human_response.captured',
  retryRequested: 'test_console.retry.requested',
  evidenceOpenRequested: 'test_console.evidence.open.requested',
});

const RESPONSE_EVENT_TYPES = Object.freeze({
  confirmed: 'supervised.human.confirmed',
  failed: 'supervised.human.failed',
  blocked: 'supervised.human.blocked',
  note: 'supervised.human.note',
});

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cloneJson(value) {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value));
}

function slugPart(value, fallback = 'item') {
  return text(value, fallback)
    .replace(/[^a-zA-Z0-9:_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || fallback;
}

function timestampSlug(value) {
  return text(value, new Date().toISOString())
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function evidenceRefObject(item) {
  if (typeof item === 'string') {
    return {
      id: `evidence-ref:${slugPart(item)}`,
      ref: item,
      relationship: 'step_reference',
      kind: 'work_record_evidence_ref',
      summary: item,
    };
  }
  const source = objectValue(item);
  const ref = text(source.ref ?? source.id, '');
  if (!ref) return null;
  return {
    id: text(source.id, `evidence-ref:${slugPart(ref)}`),
    ref,
    relationship: text(source.relationship, 'step_reference'),
    kind: text(source.kind, 'work_record_evidence_ref'),
    summary: text(source.summary, ref),
  };
}

function artifactRefObject(item) {
  if (typeof item === 'string') {
    return {
      id: `artifact-ref:${slugPart(item)}`,
      ref: item,
      relationship: 'artifact_reference',
      kind: 'artifact_ref',
      summary: item,
    };
  }
  const source = objectValue(item);
  const ref = text(source.ref ?? source.id, '');
  if (!ref) return null;
  return {
    id: text(source.id, `artifact-ref:${slugPart(ref)}`),
    ref,
    relationship: text(source.relationship, 'artifact_reference'),
    kind: text(source.kind ?? source.subject_type, 'artifact_ref'),
    summary: text(source.summary ?? source.description, ref),
  };
}

function uniqueRefs(items) {
  const byRef = new Map();
  for (const item of items) {
    if (!item?.ref) continue;
    if (!byRef.has(item.ref)) byRef.set(item.ref, item);
  }
  return [...byRef.values()];
}

function collectEvidenceRefs(run, step, supplied = []) {
  const items = [
    ...arrayValue(supplied),
    ...arrayValue(run?.evidence_refs),
  ].map(evidenceRefObject);

  for (const check of arrayValue(step?.automated_checks)) {
    for (const ref of arrayValue(check.evidence_refs)) {
      items.push(evidenceRefObject({
        id: `evidence-ref:${slugPart(ref)}`,
        ref,
        relationship: 'automated_check_receipt',
        kind: 'work_record_evidence_ref',
        summary: text(check.description, ref),
      }));
    }
  }

  for (const ref of arrayValue(step?.human_request?.evidence_refs)) {
    items.push(evidenceRefObject({
      id: `evidence-ref:${slugPart(ref)}`,
      ref,
      relationship: 'human_request_context',
      kind: 'work_record_evidence_ref',
      summary: ref,
    }));
  }

  return uniqueRefs(items.filter(Boolean));
}

function collectArtifactRefs(run, step, supplied = []) {
  const referenceArtifacts = arrayValue(run?.references)
    .filter((ref) => ref?.layer === 'artifacts' || /artifact/i.test(`${ref?.subject_type || ''} ${ref?.relationship || ''} ${ref?.role || ''}`));
  const items = [
    ...arrayValue(supplied),
    ...arrayValue(run?.metadata?.artifact_refs),
    ...arrayValue(step?.metadata?.artifact_refs),
    ...referenceArtifacts,
  ].map(artifactRefObject);
  return uniqueRefs(items.filter(Boolean));
}

function firstStepFromPayload(payload = {}) {
  const run = payload.run ?? (payload.type === 'aos.supervised_run' ? payload : null);
  if (payload.step) return payload.step;
  if (payload.current_step) return payload.current_step;
  if (payload.currentStep) return payload.currentStep;
  const index = Number.isInteger(payload.step_index) ? payload.step_index : 0;
  return arrayValue(run?.steps)[index] ?? null;
}

function runFromPayload(payload = {}) {
  return payload.run ?? (payload.type === 'aos.supervised_run' ? payload : null);
}

function maxTimelineSequence(run) {
  return arrayValue(run?.timeline).reduce((max, event) => {
    const sequence = Number(event?.sequence);
    return Number.isFinite(sequence) ? Math.max(max, sequence) : max;
  }, 0);
}

function defaultSummary(kind, state) {
  const expectation = text(state.step?.expectation?.text || state.step?.label, 'the supervised step');
  switch (kind) {
    case 'confirmed':
      return `Confirmed: ${expectation}`;
    case 'failed':
      return `Failed: ${expectation}`;
    case 'blocked':
      return `Blocked: ${expectation}`;
    case 'note':
      return `Note: ${expectation}`;
    default:
      return expectation;
  }
}

function checkTone(status) {
  switch (status) {
    case 'passed':
      return 'passed';
    case 'failed':
      return 'failed';
    case 'blocked':
      return 'blocked';
    default:
      return 'muted';
  }
}

function statusLabel(status) {
  return text(status, 'unknown').replace(/_/g, ' ');
}

function renderRefRows(refs, emptyText, kind) {
  if (!refs.length) return `<div class="test-console-empty">${escapeHtml(emptyText)}</div>`;
  return `
    <ul class="test-console-ref-list">
      ${refs.map((item) => `
        <li class="test-console-ref-row">
          <div>
            <code>${escapeHtml(item.ref)}</code>
            <span>${escapeHtml(item.summary)}</span>
          </div>
          ${kind === 'evidence' ? `<button type="button" data-action="open-evidence" data-ref="${escapeHtml(item.ref)}">Open evidence</button>` : ''}
        </li>
      `).join('')}
    </ul>
  `;
}

function renderChecks(checks) {
  if (!checks.length) {
    return '<div class="test-console-empty">No automated checks supplied.</div>';
  }
  return `
    <div class="test-console-check-list">
      ${checks.map((check) => `
        <article class="test-console-check">
          <div class="test-console-check-header">
            <span class="test-console-status tone-${checkTone(check.status)}">${escapeHtml(statusLabel(check.status))}</span>
            <strong>${escapeHtml(check.description)}</strong>
          </div>
          <dl>
            <div><dt>Kind</dt><dd>${escapeHtml(check.check?.kind || 'unknown')}</dd></div>
            <div><dt>Expected</dt><dd>${escapeHtml(check.check?.expected ?? '')}</dd></div>
            <div><dt>Actual</dt><dd>${escapeHtml(check.check?.actual ?? '')}</dd></div>
          </dl>
          <div class="test-console-evidence-inline">
            ${arrayValue(check.evidence_refs).map((ref) => `<code>${escapeHtml(ref)}</code>`).join('')}
          </div>
        </article>
      `).join('')}
    </div>
  `;
}

export function createTestConsoleState(initial = {}) {
  const state = {
    schema_version: TEST_CONSOLE_SCHEMA_VERSION,
    status: 'empty',
    run: null,
    step: null,
    operating_path: '',
    evidence_refs: [],
    artifact_refs: [],
    note: '',
    human_responses: [],
    emitted_events: [],
    last_result: null,
    sequence_base: 0,
  };
  if (Object.keys(objectValue(initial)).length > 0) {
    loadTestConsolePayload(state, initial);
  }
  return state;
}

export function loadTestConsolePayload(state, payload = {}) {
  const source = objectValue(payload);
  const run = runFromPayload(source);
  const step = firstStepFromPayload(source);
  state.run = run ? cloneJson(run) : null;
  state.step = step ? cloneJson(step) : null;
  state.operating_path = text(source.operating_path ?? run?.operating_path ?? step?.metadata?.operating_path, '');
  state.evidence_refs = collectEvidenceRefs(run, step, source.evidence_refs);
  state.artifact_refs = collectArtifactRefs(run, step, source.artifact_refs);
  state.note = text(source.note, state.note);
  state.status = state.step ? 'ready' : 'empty';
  state.sequence_base = maxTimelineSequence(run);
  state.last_result = {
    type: TEST_CONSOLE_MESSAGE_TYPES.load,
    schema_version: TEST_CONSOLE_SCHEMA_VERSION,
    status: state.step ? 'loaded' : 'empty',
    run_ref: text(run?.id, ''),
    step_ref: text(step?.id, ''),
    operating_path: state.operating_path,
  };
  return state.last_result;
}

export function testConsoleSnapshot(state = {}) {
  const step = state.step;
  const run = state.run;
  return {
    schema_version: TEST_CONSOLE_SCHEMA_VERSION,
    surface: TEST_CONSOLE_SURFACE,
    url: TEST_CONSOLE_URL,
    status: state.status || 'empty',
    semantic_refs: testConsoleSemanticRefs(),
    run_id: text(run?.id, ''),
    step_id: text(step?.id, ''),
    operating_path: text(state.operating_path, ''),
    title: text(step?.label || run?.label, 'No supervised step loaded'),
    step_status: text(step?.status, ''),
    instruction: {
      id: text(step?.instruction?.id, ''),
      text: text(step?.instruction?.text, 'No instruction supplied.'),
    },
    expectation: {
      id: text(step?.expectation?.id, ''),
      text: text(step?.expectation?.text, 'No expected result supplied.'),
      acceptance: text(step?.expectation?.acceptance, ''),
    },
    automated_checks: arrayValue(step?.automated_checks).map((check) => cloneJson(check)),
    human_request: cloneJson(step?.human_request || null),
    evidence_refs: cloneJson(state.evidence_refs || []),
    artifact_refs: cloneJson(state.artifact_refs || []),
    note: text(state.note, ''),
    last_result: cloneJson(state.last_result || null),
    last_response: cloneJson(state.last_result?.response || null),
    boundaries: {
      supplied_state_only: true,
      file_backed_bridge: false,
      daemon_event_bus: false,
      public_test_run_command: false,
      replay_repair_macro: false,
      work_record_mutation: false,
      second_evidence_viewer: false,
    },
  };
}

export function createTestConsoleHumanResponse(state, options = {}) {
  if (!state?.step) {
    throw new Error('test console cannot emit a human response without a loaded step');
  }
  const kind = text(options.response ?? options.kind, 'confirmed');
  if (!Object.hasOwn(RESPONSE_EVENT_TYPES, kind)) {
    throw new Error(`unsupported supervised-run human response kind: ${kind}`);
  }
  const respondedAt = text(options.responded_at ?? options.now, new Date().toISOString());
  const stepRef = text(state.step.id);
  const requestRef = text(state.step.human_request?.id, `request:${slugPart(stepRef)}:default`);
  const suffix = `${kind}:${timestampSlug(respondedAt)}`;
  const responseId = text(options.id, `response:${slugPart(stepRef)}:${suffix}`);
  const eventId = text(options.event_ref, `event:${slugPart(stepRef)}:human-${suffix}`);
  const summary = text(options.summary, defaultSummary(kind, state));
  const authorDisplayName = text(options.author?.display_name, 'Operator');
  const author = {
    kind: text(options.author?.kind, 'human'),
    id: text(options.author?.id, 'human:operator'),
    ...(authorDisplayName ? { display_name: authorDisplayName } : {}),
  };
  const response = {
    id: responseId,
    event_ref: eventId,
    step_ref: stepRef,
    request_ref: requestRef,
    response: kind,
    author,
    source: {
      kind: text(options.source?.kind, 'console'),
      id: text(options.source?.id, TEST_CONSOLE_SURFACE),
      channel: text(options.source?.channel, 'aos.canvas'),
    },
    responded_at: respondedAt,
    summary,
    evidence_refs: arrayValue(options.evidence_refs).map((ref) => text(ref)).filter(Boolean),
    metadata: {
      operating_path: text(state.operating_path, ''),
      surface: TEST_CONSOLE_SURFACE,
    },
  };
  const timelineEvent = {
    id: eventId,
    sequence: state.sequence_base + state.human_responses.length + 1,
    type: RESPONSE_EVENT_TYPES[kind],
    at: respondedAt,
    source: {
      kind: author.kind,
      id: author.id,
      ...(author.display_name ? { display_name: author.display_name } : {}),
    },
    step_ref: stepRef,
    human_response_ref: responseId,
    summary,
  };
  const result = {
    type: TEST_CONSOLE_MESSAGE_TYPES.humanResponseCaptured,
    schema_version: TEST_CONSOLE_SCHEMA_VERSION,
    status: 'captured',
    run_ref: text(state.run?.id, ''),
    step_ref: stepRef,
    operating_path: text(state.operating_path, ''),
    response,
    timeline_event: timelineEvent,
  };
  state.human_responses.push(response);
  state.emitted_events.push(timelineEvent);
  state.last_result = result;
  return result;
}

export function requestTestConsoleRetry(state, options = {}) {
  const result = {
    type: TEST_CONSOLE_MESSAGE_TYPES.retryRequested,
    schema_version: TEST_CONSOLE_SCHEMA_VERSION,
    status: 'requested',
    run_ref: text(state?.run?.id, ''),
    step_ref: text(state?.step?.id, ''),
    operating_path: text(state?.operating_path, ''),
    reason: text(options.reason, 'human_requested_retry'),
    replay_started: false,
    repair_started: false,
    macro_playback_started: false,
  };
  if (state) state.last_result = result;
  return result;
}

export function requestTestConsoleOpenEvidence(state, options = {}) {
  const ref = text(options.ref || state?.evidence_refs?.[0]?.ref, '');
  const result = {
    type: TEST_CONSOLE_MESSAGE_TYPES.evidenceOpenRequested,
    schema_version: TEST_CONSOLE_SCHEMA_VERSION,
    status: ref ? 'requested' : 'rejected',
    run_ref: text(state?.run?.id, ''),
    step_ref: text(state?.step?.id, ''),
    operating_path: text(state?.operating_path, ''),
    evidence_ref: ref,
    viewer_started: false,
    second_evidence_viewer_started: false,
  };
  if (state) state.last_result = result;
  return result;
}

export function renderTestConsoleHtml(snapshot = {}) {
  const loaded = !!snapshot.step_id;
  const lastJson = snapshot.last_result
    ? JSON.stringify(snapshot.last_result, null, 2)
    : 'No response emitted yet.';
  return `
    <div class="test-console-shell" data-status="${escapeHtml(snapshot.status)}">
      <header class="test-console-header">
        <div>
          <div class="test-console-kicker">Operating path</div>
          <code class="test-console-path">${escapeHtml(snapshot.operating_path || 'not supplied')}</code>
        </div>
        <div>
          <h2>${escapeHtml(snapshot.title)}</h2>
          <p>${escapeHtml(snapshot.run_id || 'No run id supplied')} ${snapshot.step_id ? `- ${escapeHtml(snapshot.step_id)}` : ''}</p>
        </div>
        <span class="test-console-status tone-${loaded ? checkTone(snapshot.step_status) : 'muted'}">${escapeHtml(statusLabel(snapshot.step_status || snapshot.status))}</span>
      </header>

      <main class="test-console-main">
        <section class="test-console-section">
          <div class="test-console-section-title">
            <span>Instruction</span>
            <code>${escapeHtml(snapshot.instruction?.id || 'instruction')}</code>
          </div>
          <p>${escapeHtml(snapshot.instruction?.text)}</p>
        </section>

        <section class="test-console-section">
          <div class="test-console-section-title">
            <span>Expected result</span>
            <code>${escapeHtml(snapshot.expectation?.id || 'expectation')}</code>
          </div>
          <p>${escapeHtml(snapshot.expectation?.text)}</p>
          ${snapshot.expectation?.acceptance ? `<div class="test-console-acceptance">${escapeHtml(snapshot.expectation.acceptance)}</div>` : ''}
        </section>

        <section class="test-console-section">
          <div class="test-console-section-title">
            <span>Automated checks</span>
            <code>${escapeHtml(String(arrayValue(snapshot.automated_checks).length))}</code>
          </div>
          ${renderChecks(arrayValue(snapshot.automated_checks))}
        </section>

        <section class="test-console-section test-console-response">
          <div class="test-console-section-title">
            <span>Human response</span>
            <code>${escapeHtml(snapshot.human_request?.id || 'request')}</code>
          </div>
          <p>${escapeHtml(snapshot.human_request?.prompt || 'Record a supervised-run response for this step.')}</p>
          <label for="test-console-note">Note</label>
          <textarea id="test-console-note" rows="3" placeholder="Optional supervisor note">${escapeHtml(snapshot.note || '')}</textarea>
          <div class="test-console-actions">
            <button type="button" data-action="confirm" ${loaded ? '' : 'disabled'}>Confirm</button>
            <button type="button" data-action="fail" ${loaded ? '' : 'disabled'}>Fail</button>
            <button type="button" data-action="blocked" ${loaded ? '' : 'disabled'}>Blocked</button>
            <button type="button" data-action="add-note" ${loaded ? '' : 'disabled'}>Add note</button>
            <button type="button" data-action="retry" ${loaded ? '' : 'disabled'}>Retry</button>
          </div>
        </section>

        <section class="test-console-section test-console-refs">
          <div>
            <div class="test-console-section-title">
              <span>Evidence refs</span>
              <code>${escapeHtml(String(arrayValue(snapshot.evidence_refs).length))}</code>
            </div>
            ${renderRefRows(arrayValue(snapshot.evidence_refs), 'No evidence refs supplied.', 'evidence')}
          </div>
          <div>
            <div class="test-console-section-title">
              <span>Artifact refs</span>
              <code>${escapeHtml(String(arrayValue(snapshot.artifact_refs).length))}</code>
            </div>
            ${renderRefRows(arrayValue(snapshot.artifact_refs), 'No artifact refs supplied.', 'artifact')}
          </div>
        </section>

        <section class="test-console-section test-console-last-result">
          <div class="test-console-section-title">
            <span>Response JSON</span>
            <code>${escapeHtml(snapshot.last_response?.response || snapshot.last_result?.status || 'pending')}</code>
          </div>
          <pre>${escapeHtml(lastJson)}</pre>
        </section>
      </main>
    </div>
  `;
}
